import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AvatarComponent, BottomSheetComponent, EmptyStateComponent, IconComponent, PickerChoice, RecipePickerComponent } from '../../components';
import { I18nService } from '../../i18n/i18n.service';
import { FillSuggestion, PLAN_SLOTS, PlanEntry, PlanSlot } from '../../models';
import { HouseholdService, MealPlanService, PlanDay, RecipeService, ToastService } from '../../services';
import { filterCuisineGroups, knownSelection, loadFillCuisines, saveFillCuisines, toggleCuisine } from '../../utils/fill-cuisines';
import { groupByRegion } from '../cuisines/cuisines.component';
import { addDays, startOfWeek, todayIso, weekDates } from '../../utils/dates';
import { optimizeImage } from '../../utils/image-url';
import { toPlanRecipeSummary } from '../../utils/picker';

type Sheet =
  | { kind: 'picker'; date: string; slot: PlanSlot; swapId?: number }
  | { kind: 'entry'; entry: PlanEntry }
  | { kind: 'fill' }
  | null;

/** /plan: the household's shared week. Mobile = agenda (a card per day, Breakfast / Lunch /
 *  Dinner, Snack when used); desktop = 7-column grid with drag-and-drop between cells. Add
 *  meal opens the picker sheet (favorites incl. household, recently cooked, quick, suggested,
 *  Leftovers / Eating out / free text); tapping a meal opens its actions (move, servings,
 *  swap, remove). Helpers: copy last week, fill empty dinners (incl. Budget week). */
@Component({
  selector: 'app-plan',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet, IconComponent, BottomSheetComponent, RecipePickerComponent, AvatarComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page lg:max-w-7xl">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div class="min-w-0">
          <p class="eyebrow flex items-center gap-2">
            {{ household.household()?.name ?? t('plan.yourKitchen') }}
            <span class="flex -space-x-1.5 rtl:space-x-reverse">
              @for (m of household.members(); track m.userId) { <app-avatar [name]="m.name" [size]="22" /> }
            </span>
          </p>
          <h1 class="page-title mt-1">{{ isThisWeek() ? t('plan.thisWeek') : weekTitle() }}</h1>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" class="btn-icon" (click)="plan.previousWeek()" [attr.aria-label]="t('plan.prevWeek')"><app-icon name="chevron-left" /></button>
          <button type="button" class="chip" (click)="plan.thisWeek()" [attr.aria-label]="t('plan.weekOf', { range: rangeLabel() })">{{ rangeLabel() }}</button>
          <button type="button" class="btn-icon" (click)="plan.nextWeek()" [attr.aria-label]="t('plan.nextWeek')"><app-icon name="chevron-right" /></button>
        </div>
      </header>

      <div class="mt-4 flex flex-wrap gap-2">
        <button type="button" class="btn-primary" data-qa="fill-dinners" (click)="openFill()"><app-icon name="sparkle" [size]="18" /> {{ t('plan.fillDinners') }}</button>
        <button type="button" class="btn-secondary" (click)="copyLastWeek()" [disabled]="busy()"><app-icon name="copy" [size]="18" /> {{ t('plan.copyLast') }}</button>
      </div>

      @if (!plan.loaded()) {
        <div class="mt-6 space-y-4" aria-busy="true">@for (i of [1, 2, 3]; track i) { <div class="skeleton h-40"></div> }</div>
      } @else {
        @if (!plan.entries().length) {
          <div class="mt-6 rounded-card border border-dashed border-hairline">
            <app-empty-state icon="plan" [title]="t('plan.emptyWeek')" [text]="t('plan.emptyWeekText')">
              <button type="button" class="btn-primary" data-qa="fill-dinners" (click)="openFill()">{{ t('plan.fillDinners') }}</button>
            </app-empty-state>
          </div>
        }

        <!-- Mobile / tablet agenda: planned meals per slot, then quick "+ slot" chips for the empty ones -->
        <div class="mt-6 grid gap-4 md:grid-cols-2 lg:hidden">
          @for (day of plan.days(); track day.date) {
            <section class="card p-4" [class.ring-2]="day.isToday" [class.ring-primary]="day.isToday" [attr.aria-label]="dayLabel(day.date)">
              <h2 class="flex items-center gap-2 font-display text-lg font-semibold">
                {{ dayLabel(day.date) }} @if (day.isToday) { <span class="badge-saffron">{{ t('common.today') }}</span> }
                @if (day.date < today) { <span class="text-xs font-normal text-muted">{{ t('plan.past') }}</span> }
              </h2>
              @for (slot of filledSlots(day); track slot.slot) {
                <div class="mt-3">
                  <div class="flex items-center justify-between">
                    <p class="eyebrow">{{ slotLabel(slot.slot) }}</p>
                    <button type="button" class="btn-icon -me-2 h-9 w-9 text-muted" data-qa="add-meal"
                            (click)="openPicker(day.date, slot.slot)" [attr.aria-label]="t('plan.addAnother', { slot: i18n.slotLower(slot.slot), day: dayLabel(day.date) })">
                      <app-icon name="plus" [size]="16" />
                    </button>
                  </div>
                  @for (e of slot.entries; track e.id) {
                    <button type="button" class="mt-1 flex w-full items-center gap-3 rounded-2xl p-1 text-start hover:bg-sunken" (click)="openEntry(e)" data-qa="plan-entry">
                      <ng-container *ngTemplateOutlet="thumbTpl; context: { $implicit: e }" />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate font-medium" dir="auto">{{ title(e) }}</span>
                        <span class="block text-xs text-muted">{{ entryMeta(e) }}</span>
                      </span>
                      @if (e.addedByName) { <app-avatar [name]="e.addedByName" [size]="24" /> }
                    </button>
                  }
                </div>
              }
              @if (emptySlots(day).length) {
                <div class="mt-3 flex flex-wrap gap-2" [class.border-t]="filledSlots(day).length" [class.border-hairline]="filledSlots(day).length" [class.pt-3]="filledSlots(day).length">
                  @for (slot of emptySlots(day); track slot) {
                    <button type="button" class="chip min-h-[36px] border-dashed text-muted" data-qa="add-meal"
                            (click)="openPicker(day.date, slot)" [attr.aria-label]="t('plan.addSlot', { slot: i18n.slotLower(slot), day: dayLabel(day.date) })">
                      <app-icon name="plus" [size]="14" /> {{ slotLabel(slot) }}
                    </button>
                  }
                </div>
              }
            </section>
          }
        </div>

        <!-- Desktop grid with drag-and-drop -->
        <div class="mt-6 hidden lg:block">
          <div class="grid grid-cols-[6rem_repeat(7,minmax(0,1fr))] gap-2">
            <div></div>
            @for (day of plan.days(); track day.date) {
              <div class="rounded-2xl px-2 py-2 text-center" [class.bg-primary-tint]="day.isToday">
                <p class="text-xs uppercase tracking-wide text-muted">{{ weekday(day.date) }}</p>
                <p class="font-display text-xl font-semibold" [class.text-primary]="day.isToday">{{ dayNumber(day.date) }}</p>
              </div>
            }
            @for (slot of slots; track slot) {
              <div class="pt-3 text-sm font-semibold text-muted">{{ slotLabel(slot) }}</div>
              @for (day of plan.days(); track day.date) {
                <div class="group rounded-2xl border border-hairline bg-surface p-1.5 transition-colors"
                     [class.min-h-[6rem]]="slot !== 'snack'" [class.min-h-[3rem]]="slot === 'snack'"
                     [class.border-primary]="dropTarget() === day.date + slot" [class.bg-primary-tint]="dropTarget() === day.date + slot"
                     (dragover)="onDragOver($event, day.date, slot)" (dragleave)="dropTarget.set(null)" (drop)="onDrop($event, day.date, slot)">
                  @for (e of entriesFor(day, slot); track e.id) {
                    <button type="button" draggable="true" (dragstart)="onDragStart($event, e)" (dragend)="dragging.set(null); dropTarget.set(null)"
                            (click)="openEntry(e)" data-qa="plan-entry"
                            class="mb-1.5 block w-full cursor-grab overflow-hidden rounded-xl bg-paper text-start shadow-soft active:cursor-grabbing"
                            [class.opacity-40]="dragging() === e.id" [attr.aria-label]="t('plan.entryAria', { title: title(e), servings: t('common.servings', { count: e.servings }) })">
                      @if (e.recipe?.image) {
                        <img [src]="thumb(e.recipe!.image)" alt="" class="aspect-[4/3] w-full object-cover" draggable="false" />
                      }
                      <span class="flex items-start gap-1 p-1.5">
                        <span class="line-clamp-2 flex-1 text-xs font-medium leading-snug" dir="auto">{{ title(e) }}</span>
                        @if (e.addedByName) { <app-avatar [name]="e.addedByName" [size]="18" /> }
                      </span>
                    </button>
                  }
                  <button type="button" class="flex h-8 w-full items-center justify-center rounded-xl text-muted opacity-0 transition-opacity hover:bg-sunken hover:text-primary focus:opacity-100 group-hover:opacity-100"
                          [class.opacity-100]="!entriesFor(day, slot).length && slot !== 'snack'"
                          (click)="openPicker(day.date, slot)" [attr.aria-label]="t('plan.addSlot', { slot: i18n.slotLower(slot), day: dayLabel(day.date) })" data-qa="add-meal">
                    <app-icon name="plus" [size]="18" />
                  </button>
                </div>
              }
            }
          </div>
          <p class="mt-3 text-xs text-muted">{{ t('plan.dragHint') }}</p>
        </div>
      }
    </div>

    <ng-template #thumbTpl let-e>
      @if (e.recipe?.image) {
        <img [src]="thumb(e.recipe.image)" alt="" class="h-12 w-12 shrink-0 rounded-xl object-cover" />
      } @else {
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sunken text-muted"><app-icon [name]="e.recipeId ? 'pot' : 'sparkle'" [size]="20" /></span>
      }
    </ng-template>

    @if (sheet(); as s) {
      @switch (s.kind) {
        @case ('picker') {
          <app-bottom-sheet [title]="pickerTitle()" (closed)="sheet.set(null)">
            <app-recipe-picker [slot]="$any(s).slot" [allowCustom]="!$any(s).swapId" (picked)="picked($event)" />
          </app-bottom-sheet>
        }
        @case ('entry') {
          <app-bottom-sheet [title]="title($any(s).entry)" (closed)="sheet.set(null)">
            <div class="space-y-5 pb-2">
              <p class="text-sm text-muted">{{ dayLabel($any(s).entry.date) }} · {{ slotLabel($any(s).entry.slot) }}{{ $any(s).entry.addedByName ? ' · ' + t('plan.addedBy', { name: $any(s).entry.addedByName }) : '' }}</p>
              @if ($any(s).entry.recipeId) {
                <a class="btn-secondary w-full" [routerLink]="['/recipes', $any(s).entry.recipeId]"><app-icon name="cookbook" [size]="18" /> {{ t('plan.openRecipe') }}</a>
              }
              <div class="flex items-center justify-between">
                <span class="label mb-0">{{ t('plan.servings') }}</span>
                <div class="flex items-center rounded-full border border-hairline p-0.5">
                  <button type="button" class="btn-icon h-9 w-9" (click)="setServings($any(s).entry, -1)" [disabled]="$any(s).entry.servings <= 1" [attr.aria-label]="t('detail.fewerServings')"><app-icon name="minus" [size]="16" /></button>
                  <span class="min-w-[2.5rem] text-center font-semibold">{{ $any(s).entry.servings }}</span>
                  <button type="button" class="btn-icon h-9 w-9" (click)="setServings($any(s).entry, 1)" [attr.aria-label]="t('detail.moreServings')"><app-icon name="plus" [size]="16" /></button>
                </div>
              </div>
              <fieldset>
                <legend class="label">{{ t('plan.moveTo') }}</legend>
                <div class="scroll-row -mx-5 px-5">
                  @for (d of moveDays(); track d) {
                    <button type="button" class="flex min-w-[3.75rem] shrink-0 flex-col items-center rounded-2xl border px-2 py-1.5 text-sm"
                            [class.border-primary]="moveDate() === d" [class.bg-primary]="moveDate() === d" [class.text-primary-on]="moveDate() === d"
                            [class.border-hairline]="moveDate() !== d" (click)="moveDate.set(d)">
                      <span class="text-xs opacity-80">{{ weekday(d) }}</span><span class="font-semibold">{{ dayNumber(d) }}</span>
                    </button>
                  }
                </div>
                <div class="mt-2 flex flex-wrap gap-2">
                  @for (sl of slots; track sl) {
                    <button type="button" class="chip" [class.chip-active]="moveSlot() === sl" (click)="moveSlot.set(sl)">{{ slotLabel(sl) }}</button>
                  }
                </div>
                @if (moveDate() !== $any(s).entry.date || moveSlot() !== $any(s).entry.slot) {
                  <button type="button" class="btn-primary mt-3 w-full" (click)="move($any(s).entry)">
                    {{ t('plan.moveButton', { day: dayLabel(moveDate()), slot: i18n.slotLower(moveSlot()) }) }}
                  </button>
                }
              </fieldset>
              <div class="flex gap-2">
                <button type="button" class="btn-secondary flex-1" (click)="openPicker($any(s).entry.date, $any(s).entry.slot, $any(s).entry.id)">
                  <app-icon name="copy" [size]="18" /> {{ t('plan.swapRecipe') }}
                </button>
                <button type="button" class="btn-danger flex-1" (click)="remove($any(s).entry)"><app-icon name="trash" [size]="18" /> {{ t('plan.remove') }}</button>
              </div>
            </div>
          </app-bottom-sheet>
        }
        @case ('fill') {
          <app-bottom-sheet [title]="budgetWeek() ? t('plan.budgetWeek') : t('plan.fillTitle')" (closed)="sheet.set(null)">
            <label class="mb-4 flex items-center justify-between gap-4 rounded-2xl bg-sunken p-3">
              <span><span class="font-medium">{{ t('plan.budgetWeek') }}</span><br /><span class="text-xs text-muted">{{ t('plan.budgetHint') }}</span></span>
              <input type="checkbox" class="switch" [checked]="budgetWeek()" (change)="setBudgetWeek(!budgetWeek())" />
            </label>
            <div class="mb-4 rounded-2xl bg-sunken p-3" data-qa="fill-cuisines">
              <button type="button" class="flex min-h-[44px] w-full items-center justify-between gap-3 text-start" data-qa="fill-cuisines-toggle"
                      [attr.aria-expanded]="cuisinesOpen()" aria-controls="fill-cuisines-panel" (click)="cuisinesOpen.set(!cuisinesOpen())">
                <span class="min-w-0">
                  <span class="block font-medium">{{ t('plan.cuisines') }}</span>
                  @if (selectedCuisines().length) { <span class="block truncate text-xs text-muted" data-qa="fill-cuisines-summary">{{ cuisineSummary() }}</span> }
                </span>
                <span class="chip-quiet shrink-0" [class.!bg-primary]="selectedCuisines().length" [class.!text-primary-on]="selectedCuisines().length" data-qa="fill-cuisines-count">{{ selectedCuisines().length ? i18n.n(selectedCuisines().length) : t('plan.cuisinesAny') }}</span>
              </button>
              @if (cuisinesOpen()) {
                <div id="fill-cuisines-panel" class="mt-2">
                  <p class="mb-2 text-xs text-muted">{{ t('plan.cuisinesHint') }}</p>
                  <div class="flex items-center gap-2">
                    <div class="relative flex-1">
                      <app-icon name="search" [size]="18" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
                      <input type="search" class="input ps-10" [placeholder]="t('plan.cuisinesSearch')" [attr.aria-label]="t('plan.cuisinesSearch')"
                             [value]="cuisineQuery()" (input)="cuisineQuery.set($any($event.target).value)" data-qa="fill-cuisines-search" />
                    </div>
                    <button type="button" class="btn-ghost min-h-[44px] shrink-0" [disabled]="!selectedCuisines().length" (click)="clearCuisines()" data-qa="fill-cuisines-clear">{{ t('plan.cuisinesClear') }}</button>
                  </div>
                  <div class="mt-2 max-h-[40vh] overflow-y-auto overscroll-contain pe-1" data-qa="fill-cuisines-list">
                    @for (g of cuisineGroups(); track g.region) {
                      <h3 class="mb-1.5 mt-3 text-xs font-semibold uppercase tracking-wide text-muted">{{ i18n.region(g.region) }}</h3>
                      <div class="flex flex-wrap gap-2" role="group" [attr.aria-label]="i18n.region(g.region)">
                        @for (c of g.cuisines; track c.name) {
                          <button type="button" class="chip min-h-[44px]" [class.chip-active]="selectedCuisines().includes(c.name)"
                                  [attr.aria-pressed]="selectedCuisines().includes(c.name)" [attr.data-cuisine]="c.name" data-qa="fill-cuisine-chip"
                                  (click)="toggleCuisineChoice(c.name)">
                            @if (selectedCuisines().includes(c.name)) { <app-icon name="check" [size]="16" /> }
                            {{ i18n.cuisine(c.name) }}
                          </button>
                        }
                      </div>
                    } @empty {
                      <p class="py-3 text-sm text-muted">{{ t('plan.cuisinesNone') }}</p>
                    }
                  </div>
                </div>
              }
            </div>
            @if (suggestions() === null) {
              <div class="space-y-2 pb-4">@for (i of [1, 2, 3]; track i) { <div class="skeleton h-16"></div> }</div>
            } @else if (!suggestions()!.length) {
              <p class="pb-6 text-muted" data-qa="fill-empty">{{ unfilled() > 0 && selectedCuisines().length ? t('plan.unfilled', { count: unfilled() }) : t('plan.allPlanned') }}</p>
            } @else {
              @if (unfilled() > 0 && selectedCuisines().length) {
                <p class="mb-3 rounded-xl bg-saffron/15 px-3 py-2 text-sm" role="status" data-qa="fill-unfilled">{{ t('plan.unfilled', { count: unfilled() }) }}</p>
              }
              <ul class="space-y-2">
                @for (sg of suggestions()!; track sg.date) {
                  <li>
                    <label class="flex items-center gap-3 rounded-2xl border border-hairline p-2 pe-3" [class.opacity-50]="skipped().has(sg.date)">
                      <input type="checkbox" class="h-5 w-5 accent-[rgb(var(--primary))]" [checked]="!skipped().has(sg.date)" (change)="toggleSkip(sg.date)" />
                      @if (sg.recipe.image) { <img [src]="thumb(sg.recipe.image)" alt="" class="h-12 w-12 rounded-xl object-cover" /> }
                      <span class="min-w-0 flex-1">
                        <span class="block text-xs text-muted">{{ dayLabel(sg.date) }}{{ sg.recipe.cuisine ? ' · ' + i18n.cuisine(sg.recipe.cuisine) : '' }}</span>
                        <span class="block truncate font-medium" dir="auto">{{ i18n.recipeName(sg.recipe) }}</span>
                      </span>
                    </label>
                  </li>
                }
              </ul>
              <div class="sheet-footer sticky -mx-5 mt-3 flex gap-2 border-t border-hairline bg-surface px-5 pt-3">
                <button type="button" class="btn-secondary" (click)="loadSuggestions()">{{ t('plan.shuffle') }}</button>
                <button type="button" class="btn-primary flex-1" (click)="confirm()" [disabled]="busy() || keptCount() === 0">{{ t('plan.addDinners', { count: keptCount() }) }}</button>
              </div>
            }
          </app-bottom-sheet>
        }
      }
    }
  `,
})
export class PlanComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  readonly plan = inject(MealPlanService);
  readonly household = inject(HouseholdService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);

  readonly slots = PLAN_SLOTS;
  readonly today = todayIso();
  readonly sheet = signal<Sheet>(null);
  readonly busy = signal(false);
  readonly suggestions = signal<FillSuggestion[] | null>(null);
  readonly budgetWeek = signal(false);
  private recipes = inject(RecipeService);
  readonly selectedCuisines = signal<string[]>([]);
  readonly cuisinesOpen = signal(false);
  readonly cuisineQuery = signal('');
  readonly unfilled = signal(0);
  private fillRequest = 0;
  private readonly allCuisineGroups = computed(() => groupByRegion(this.recipes.cuisines()));
  readonly cuisineGroups = computed(() =>
    filterCuisineGroups(this.allCuisineGroups(), this.cuisineQuery(), name => [this.i18n.cuisine(name), name]));
  readonly cuisineSummary = computed(() => {
    const picked = this.selectedCuisines();
    return `${this.t('plan.cuisinesSelected', { count: picked.length })}: ${this.i18n.list(picked.map(n => this.i18n.cuisine(n)))}`;
  });
  readonly skipped = signal<Set<string>>(new Set());
  readonly dragging = signal<number | null>(null);
  readonly dropTarget = signal<string | null>(null);
  readonly moveDate = signal('');
  readonly moveSlot = signal<PlanSlot>('dinner');

  readonly rangeLabel = computed(() => `${this.i18n.day(this.plan.weekStart())} - ${this.i18n.day(this.plan.weekEnd())}`);
  readonly isThisWeek = computed(() => this.plan.weekStart() === startOfWeek(this.today));
  readonly weekTitle = computed(() => this.t(this.plan.weekStart() > this.today ? 'plan.comingUp' : 'plan.lookingBack'));
  readonly keptCount = computed(() => (this.suggestions() ?? []).filter(s => !this.skipped().has(s.date)).length);
  readonly moveDays = computed(() => weekDates(this.plan.weekStart()).concat(weekDates(addDays(this.plan.weekStart(), 7))));
  readonly pickerTitle = computed(() => {
    const s = this.sheet();
    if (s?.kind !== 'picker') return '';
    return this.t(s.swapId ? 'plan.pickerSwap' : 'plan.pickerAdd', { slot: this.i18n.slotLower(s.slot), day: this.dayLabel(s.date) });
  });

  ngOnInit(): void {
    if (!this.plan.loaded()) {
      this.plan.load();
      this.plan.loadCooked();
    }
    if (this.route.snapshot.queryParamMap.get('fill')) this.openFill();
  }

  dayLabel(date: string): string {
    return date === this.today ? this.t('plan.todayDay', { day: this.i18n.day(date) }) : this.i18n.day(date);
  }

  weekday(date: string): string {
    return this.i18n.day(date, { weekday: 'short' });
  }

  dayNumber(date: string): string {
    return this.i18n.day(date, { day: 'numeric' });
  }

  slotLabel(slot: PlanSlot): string {
    return this.i18n.slot(slot);
  }

  title(e: PlanEntry): string {
    return e.recipe ? this.i18n.recipeName(e.recipe) : this.i18n.customMealTitle(e.customTitle);
  }

  entryMeta(e: PlanEntry): string {
    const time = e.recipe?.totalTime ? ` · ${this.t('common.minutes', { count: e.recipe.totalTime })}` : '';
    return this.t('plan.entryMeta', { servings: this.t('common.servings', { count: e.servings }), time });
  }

  thumb(url: string): string {
    return optimizeImage(url, 240);
  }

  filledSlots(day: PlanDay): PlanDay['slots'] {
    return day.slots.filter(s => s.entries.length);
  }

  emptySlots(day: PlanDay): PlanSlot[] {
    return day.slots.filter(s => !s.entries.length).map(s => s.slot);
  }

  entriesFor(day: PlanDay, slot: PlanSlot): PlanEntry[] {
    return day.slots.find(s => s.slot === slot)?.entries ?? [];
  }

  openPicker(date: string, slot: PlanSlot, swapId?: number): void {
    this.sheet.set({ kind: 'picker', date, slot, swapId });
  }

  openEntry(entry: PlanEntry): void {
    this.moveDate.set(entry.date);
    this.moveSlot.set(entry.slot);
    this.sheet.set({ kind: 'entry', entry });
  }

  private servingsTimers = new Map<number, number>();

  picked(choice: PickerChoice): void {
    const s = this.sheet();
    if (s?.kind !== 'picker') return;
    this.sheet.set(null);
    const recipe = choice.recipeId ? this.recipes.getRecipeById(choice.recipeId) : undefined;
    const summary = recipe ? toPlanRecipeSummary(recipe) : null;
    if (s.swapId && choice.recipeId) {
      this.plan.swapRecipe(s.swapId, choice.recipeId, summary).subscribe({ error: () => this.fail('plan.fail.swap') });
      return;
    }
    this.plan.addEntry({
      date: s.date,
      slot: s.slot,
      recipeId: choice.recipeId ?? null,
      customTitle: choice.customTitle ?? null,
      recipe: summary,
    }).subscribe({
      next: e => this.toast.show(this.t('plan.added', { title: this.title(e), day: this.dayLabel(e.date) })),
      error: () => this.fail('plan.fail.add'),
    });
  }

  /** The sheet shows the new number at once; one PATCH is sent after a short pause so
   *  repeated + / - taps collapse into the final value. */
  setServings(entry: PlanEntry, delta: number): void {
    const servings = Math.max(1, entry.servings + delta);
    this.sheet.set({ kind: 'entry', entry: { ...entry, servings } });
    const pending = this.servingsTimers.get(entry.id);
    if (pending) clearTimeout(pending);
    this.servingsTimers.set(entry.id, window.setTimeout(() => {
      this.servingsTimers.delete(entry.id);
      this.plan.setServings(entry.id, servings).subscribe({
        next: updated => {
          const open = this.sheet();
          if (open?.kind === 'entry' && open.entry.id === entry.id) {
            this.sheet.set({ kind: 'entry', entry: updated });
          }
        },
        error: () => {
          const open = this.sheet();
          const current = this.plan.entries().find(e => e.id === entry.id);
          if (current && open?.kind === 'entry') this.sheet.set({ kind: 'entry', entry: current });
          this.fail('plan.fail.servings');
        },
      });
    }, 250));
  }

  move(entry: PlanEntry): void {
    const date = this.moveDate();
    const slot = this.moveSlot();
    const pending = this.servingsTimers.get(entry.id);
    if (pending) {
      clearTimeout(pending);
      this.servingsTimers.delete(entry.id);
    }
    this.sheet.set(null);
    this.plan.moveEntry(entry.id, date, slot, entry.servings).subscribe({
      next: () => this.toast.show(this.t('plan.moved', { day: this.dayLabel(date), slot: this.i18n.slotLower(slot) })),
      error: () => this.fail('plan.fail.move'),
    });
  }

  remove(entry: PlanEntry): void {
    const pending = this.servingsTimers.get(entry.id);
    if (pending) {
      clearTimeout(pending);
      this.servingsTimers.delete(entry.id);
    }
    this.sheet.set(null);
    this.plan.removeEntry(entry.id).subscribe({ error: () => this.fail('plan.fail.remove') });
  }

  copyLastWeek(): void {
    this.busy.set(true);
    this.plan.copyLastWeek().subscribe({
      next: created => {
        this.busy.set(false);
        this.toast.show(created.length ? this.t('plan.copied', { count: created.length }) : this.t('plan.lastEmpty'));
      },
      error: () => {
        this.busy.set(false);
        this.fail('plan.fail.copy');
      },
    });
  }

  openFill(): void {
    this.budgetWeek.set(this.household.household()?.preferBudget ?? false);
    // The remembered cuisines, minus any the catalog no longer has.
    this.selectedCuisines.set(knownSelection(loadFillCuisines(), this.recipes.cuisines()));
    this.cuisinesOpen.set(false);
    this.cuisineQuery.set('');
    this.sheet.set({ kind: 'fill' });
    this.loadSuggestions();
  }

  toggleCuisineChoice(name: string): void {
    this.selectedCuisines.update(list => toggleCuisine(list, name));
    this.cuisineSelectionChanged();
  }

  clearCuisines(): void {
    this.selectedCuisines.set([]);
    this.cuisineSelectionChanged();
  }

  private cuisineSelectionChanged(): void {
    saveFillCuisines(this.selectedCuisines());
    this.loadSuggestions();
  }

  setBudgetWeek(on: boolean): void {
    this.budgetWeek.set(on);
    this.loadSuggestions();
  }

  loadSuggestions(): void {
    this.suggestions.set(null);
    this.skipped.set(new Set());
    const request = ++this.fillRequest;
    const emptyDays = this.plan.emptyFillDates().length;
    this.plan.fillSuggestions(this.budgetWeek(), 'dinner', this.selectedCuisines()).subscribe({
      next: list => {
        if (request !== this.fillRequest) return; // a newer selection superseded this answer
        this.unfilled.set(Math.max(0, emptyDays - list.length));
        this.suggestions.set(list);
      },
      error: () => {
        if (request !== this.fillRequest) return;
        this.unfilled.set(0);
        this.suggestions.set([]);
      },
    });
  }

  toggleSkip(date: string): void {
    this.skipped.update(set => {
      const next = new Set(set);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  }

  confirm(): void {
    const kept = (this.suggestions() ?? []).filter(s => !this.skipped().has(s.date));
    this.busy.set(true);
    this.plan.confirmSuggestions(kept).subscribe({
      next: () => {
        this.busy.set(false);
        this.sheet.set(null);
        this.toast.show(this.t('plan.planned', { count: kept.length }));
      },
      error: () => {
        this.busy.set(false);
        this.fail('plan.fail.fill');
      },
    });
  }

  // Drag and drop (desktop grid)
  onDragStart(event: DragEvent, entry: PlanEntry): void {
    this.dragging.set(entry.id);
    event.dataTransfer?.setData('text/plain', String(entry.id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onDragOver(event: DragEvent, date: string, slot: PlanSlot): void {
    if (this.dragging() === null) return;
    event.preventDefault();
    this.dropTarget.set(date + slot);
  }

  onDrop(event: DragEvent, date: string, slot: PlanSlot): void {
    event.preventDefault();
    const id = this.dragging() ?? Number(event.dataTransfer?.getData('text/plain'));
    this.dragging.set(null);
    this.dropTarget.set(null);
    const entry = this.plan.entries().find(e => e.id === id);
    if (!entry || (entry.date === date && entry.slot === slot)) return;
    this.plan.moveEntry(entry.id, date, slot).subscribe({ error: () => this.fail('plan.fail.move') });
  }

  private fail(key: 'plan.fail.swap' | 'plan.fail.add' | 'plan.fail.servings' | 'plan.fail.move' | 'plan.fail.remove' | 'plan.fail.copy' | 'plan.fail.fill'): void {
    this.toast.show(this.t(key), 'error');
  }
}
