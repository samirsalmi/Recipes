import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { BottomSheetComponent, IconComponent } from '../../components';
import { I18nService } from '../../i18n/i18n.service';
import { ImagePlaceholderComponent } from '../../components/ui/image-placeholder/image-placeholder.component';
import { Ingredient, PLAN_SLOTS, PlanSlot, Recipe, UnitSystem } from '../../models';
import {
  AuthService,
  CollectionService,
  FavoritesService,
  HouseholdService,
  MealPlanService,
  RecipeService,
  StorageService,
  TimerService,
  ToastService,
  requireLogin,
} from '../../services';
import { formatQuantity } from '../../utils/ingredient-parser';
import { addDays, todayIso } from '../../utils/dates';
import { optimizeImage } from '../../utils/image-url';
import { toPlanRecipeSummary } from '../../utils/picker';
import { StepPart, splitStepTimers } from '../../utils/timers';
import { toUnitSystem } from '../../utils/units';
import { equivalentName } from '../../utils/unit-equivalent';

interface IngredientGroup {
  name: string | null;
  items: { index: number; ing: Ingredient }[];
}

type Sheet = 'plan' | 'menu' | 'collection' | null;

/** /recipes/:id (public): full-bleed hero, facts, servings stepper + metric/US toggle,
 *  ingredient checklist (groups, optional label), steps with tappable timers, tips, notes,
 *  "Cooked N times", source + photo credit, sticky mobile action bar (Add to plan / Cook /
 *  heart) and an overflow menu (copy & edit, collection, share, print, owner edit /
 *  visibility / delete). Resolves the recipe G11-safe (catalog, then by-id fetch). */
@Component({
  selector: 'app-recipe-detail',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, BottomSheetComponent, ImagePlaceholderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (recipe(); as r) {
      <article class="pb-36 lg:pb-12">
        <div class="relative aspect-[4/3] max-h-[68vh] w-full overflow-hidden bg-sunken sm:aspect-[16/9] lg:mx-auto lg:mt-6 lg:max-w-6xl lg:rounded-sheet">
          @if (r.image && !imageFailed()) {
            <img [src]="hero()" [alt]="recipeName()" class="h-full w-full object-cover" [style.view-transition-name]="'recipe-' + r.id" (error)="imageFailed.set(true)" />
          } @else {
            <app-image-placeholder />
          }
          <div class="scrim absolute inset-0"></div>
          <div class="print-hide absolute inset-x-3 flex justify-between" style="top: calc(0.75rem + var(--safe-top))">
            <button type="button" class="btn-icon bg-surface/90 shadow-soft" (click)="back()" [attr.aria-label]="t('detail.back')"><app-icon name="arrow-left" /></button>
            <button type="button" class="btn-icon bg-surface/90 shadow-soft" (click)="sheet.set('menu')" [attr.aria-label]="t('detail.moreActions')" data-qa="overflow-menu"><app-icon name="more" /></button>
          </div>
          <div class="absolute inset-x-0 bottom-0 p-4 sm:p-8">
            <div class="flex flex-wrap gap-1.5">
              @if (r.traditional) { <span class="photo-pill">{{ t('detail.traditional') }}</span> }
              @if (r.budget === 'low') { <span class="photo-pill"><app-icon name="coins" [size]="13" /> {{ t('card.budget') }}</span> }
              @if (!r.isPublic) { <span class="photo-pill"><app-icon name="eye-off" [size]="13" /> {{ t('detail.private') }}</span> }
            </div>
            <h1 class="mt-2 font-display text-3xl font-semibold leading-tight text-white sm:text-5xl" dir="auto">{{ recipeName() }}</h1>
          </div>
        </div>

        <div class="mx-auto max-w-3xl px-4 sm:px-6">
          <div class="mt-4 flex flex-wrap gap-2">
            @if (r.cuisine) { <a class="chip-quiet hover:text-ink" [routerLink]="['/cuisines', slug(r.cuisine)]">{{ i18n.cuisine(r.cuisine) }}</a> }
            @if (r.totalTime) { <span class="chip-quiet"><app-icon name="clock" [size]="14" /> {{ t('common.minutes', { count: r.totalTime }) }}</span> }
            @if (r.difficulty) { <span class="chip-quiet">{{ i18n.difficulty(r.difficulty) }}</span> }
            @if (r.budget) { <span class="chip-quiet"><app-icon name="coins" [size]="14" /> {{ t('detail.budgetChip', { level: i18n.budgetLevel(r.budget) }) }}</span> }
            @if (r.diet.vegan) { <span class="chip-quiet"><app-icon name="leaf" [size]="14" /> {{ t('diet.vegan') }}</span> }
            @else if (r.diet.vegetarian) { <span class="chip-quiet"><app-icon name="leaf" [size]="14" /> {{ t('diet.vegetarian') }}</span> }
            @if (r.diet.glutenFree) { <span class="chip-quiet">{{ t('diet.glutenFree') }}</span> }
            @if (cookedCount() > 0) { <span class="chip-quiet"><app-icon name="check" [size]="14" /> {{ t('detail.cooked', { count: cookedCount() }) }}</span> }
          </div>
          @if (description()) { <p class="mt-4 text-lg leading-relaxed" dir="auto">{{ description() }}</p> }
          @if (isOriginal()) {
            <p class="mt-2 text-sm text-muted">{{ t('detail.writtenForMise') }}</p>
          } @else if (r.source?.title) {
            <p class="mt-2 text-sm text-muted">{{ t('detail.adaptedFrom') }} <em dir="auto">{{ r.source!.title }}</em><bdi>{{ sourceByline() }}</bdi></p>
          } @else if (r.author) {
            <p class="mt-2 text-sm text-muted">{{ t('detail.by', { author: r.author }) }}</p>
          }

          <div class="print-hide mt-6 hidden gap-3 lg:flex">
            <button type="button" class="btn-primary" (click)="openPlanSheet()" data-qa="add-to-plan"><app-icon name="plus" [size]="18" /> {{ t('detail.addToPlan') }}</button>
            @if (r.steps.length) { <a [routerLink]="['/cook', r.id]" class="btn-secondary"><app-icon name="pot" [size]="18" /> {{ t('detail.cook') }}</a> }
            <button type="button" class="btn-secondary" (click)="favorites.toggleFavorite(r.id)" [attr.aria-pressed]="isFavorite()">
              <app-icon name="heart" [size]="18" [filled]="isFavorite()" [class.text-accent]="isFavorite()" /> {{ isFavorite() ? t('detail.savedBtn') : t('detail.save') }}
            </button>
          </div>

          <section class="mt-8" aria-labelledby="ingredients-title">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 id="ingredients-title" class="section-title">{{ t('detail.ingredients') }}</h2>
              <div class="flex items-center gap-2">
                <div class="flex rounded-full border border-hairline bg-surface p-0.5 text-xs font-semibold" role="group" [attr.aria-label]="t('detail.units')">
                  <button type="button" class="rounded-full px-3 py-1.5" [class.bg-primary]="units() === 'metric'" [class.text-primary-on]="units() === 'metric'" (click)="units.set('metric')">{{ t('detail.metric') }}</button>
                  <button type="button" class="rounded-full px-3 py-1.5" [class.bg-primary]="units() === 'us'" [class.text-primary-on]="units() === 'us'" (click)="units.set('us')">{{ t('detail.us') }}</button>
                </div>
                <div class="flex items-center rounded-full border border-hairline bg-surface p-0.5">
                  <button type="button" class="btn-icon h-9 w-9" (click)="changeServings(-1)" [disabled]="servings() <= 1" [attr.aria-label]="t('detail.fewerServings')"><app-icon name="minus" [size]="16" /></button>
                  <span class="min-w-[4.5rem] text-center text-sm font-semibold" aria-live="polite">{{ t('common.servings', { count: servings() }) }}</span>
                  <button type="button" class="btn-icon h-9 w-9" (click)="changeServings(1)" [attr.aria-label]="t('detail.moreServings')"><app-icon name="plus" [size]="16" /></button>
                </div>
              </div>
            </div>
            @for (group of groups(); track $index) {
              @if (group.name) { <h3 class="eyebrow mt-5">{{ group.name }}</h3> }
              <ul class="mt-1 divide-y divide-hairline">
                @for (row of group.items; track row.index) {
                  <li>
                    <button type="button" class="flex w-full items-start gap-3 py-2.5 text-start" (click)="toggleChecked(row.index)"
                            role="checkbox" [attr.aria-checked]="checked().has(row.index)">
                      <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors"
                            [class.border-primary]="checked().has(row.index)" [class.bg-primary]="checked().has(row.index)"
                            [class.text-primary-on]="checked().has(row.index)" [class.border-hairline]="!checked().has(row.index)">
                        @if (checked().has(row.index)) { <app-icon name="check" [size]="14" /> }
                      </span>
                      <span class="w-[4.5rem] shrink-0 font-semibold tabular-nums" dir="auto" [class.opacity-50]="checked().has(row.index)">{{ amount(row.ing) }}@if (equivalent(row.ing); as eq) { {{ ' ' }}<bdi class="block text-xs font-normal text-muted" data-qa="unit-equivalent">{{ eq }}</bdi> }</span>
                      <span dir="auto" class="min-w-0 flex-1" [class.line-through]="checked().has(row.index)" [class.opacity-50]="checked().has(row.index)">
                        <bdi>{{ i18n.ingredientName(row.ing) }}</bdi>@if (row.ing.note) {<span class="text-muted">{{ t('common.listSeparator') }} <bdi>{{ row.ing.note }}</bdi></span>}
                        @if (row.ing.optional) { <span class="chip-quiet ms-1 align-middle">{{ t('detail.optionalTag') }}</span> }
                      </span>
                    </button>
                  </li>
                }
              </ul>
            }
          </section>

          @if (r.steps.length) {
            <section class="mt-10" aria-labelledby="steps-title">
              <div class="flex items-center justify-between">
                <h2 id="steps-title" class="section-title">{{ t('detail.method') }}</h2>
                <a [routerLink]="['/cook', r.id]" class="btn-ghost print-hide min-h-[36px] px-3"><app-icon name="pot" [size]="16" /> {{ t('detail.cookingMode') }}</a>
              </div>
              <ol class="mt-3 space-y-5">
                @for (parts of stepParts(); track $index) {
                  <li class="flex gap-4">
                    <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-tint font-semibold text-primary">{{ $index + 1 }}</span>
                    <p class="pt-1 leading-relaxed" dir="auto">
                      @for (part of parts; track $index) {
                        @if (part.timer) {
                          <button type="button" class="mx-0.5 inline-flex items-center gap-1 rounded-full bg-saffron/25 px-2 py-0.5 font-semibold text-ink hover:bg-saffron/40"
                                  (click)="startTimer(part, $any(r))" [attr.aria-label]="t('timers.startFor', { text: part.text })"><app-icon name="timer" [size]="14" />{{ part.text }}</button>
                        } @else {<span>{{ part.text }}</span>}
                      }
                    </p>
                  </li>
                }
              </ol>
            </section>
          }

          @if (r.tips.length) {
            <section class="mt-10 rounded-card bg-primary-tint p-5">
              <h2 class="section-title">{{ t('detail.tips') }}</h2>
              <ul class="mt-2 list-disc space-y-1 ps-5">
                @for (tip of tips(); track $index) { <li dir="auto">{{ tip }}</li> }
              </ul>
            </section>
          }

          @if (r.nutrition?.calories) {
            <p class="mt-6 text-sm text-muted">{{ t('common.kcal', { count: r.nutrition!.calories! }) }}</p>
          }

          <section class="print-hide mt-10" aria-labelledby="notes-title">
            <h2 id="notes-title" class="section-title">{{ t('detail.yourNotes') }}</h2>
            @if (auth.isAuthenticated()) {
              <textarea class="textarea mt-3" rows="3" [placeholder]="t('detail.notesPlaceholder')" [(ngModel)]="notes" dir="auto"></textarea>
              <div class="mt-2 flex items-center gap-3">
                <button type="button" class="btn-secondary" (click)="saveNotes()" [disabled]="notes === savedNotes()">{{ t('detail.saveNote') }}</button>
                @if (notes === savedNotes() && savedNotes()) { <span class="text-sm text-muted">{{ t('common.saved') }}</span> }
              </div>
            } @else {
              <p class="mt-2 text-sm text-muted"><a routerLink="/login" [queryParams]="{ returnUrl: '/recipes/' + r.id }" class="font-semibold text-primary">{{ t('common.signIn') }}</a> {{ t('detail.signInNotes') }}</p>
            }
          </section>

          <footer class="mt-10 space-y-1 border-t border-hairline pt-4 text-xs text-muted">
            @if (isOriginal()) {
              <p>
                {{ t('detail.recipeLabel') }} {{ t('detail.writtenFor') }}{{ r.source!.adaptation ? ' - ' + r.source!.adaptation : '' }}
                @if (r.source!.url) { · <a [href]="r.source!.url" target="_blank" rel="noopener" class="underline">{{ t('detail.reference') }}</a> }
              </p>
            } @else if (r.source) {
              <p>
                {{ t('detail.recipeLabel') }} @if (r.source.url) { <a [href]="r.source.url" target="_blank" rel="noopener" class="underline">{{ r.source.title || r.source.url }}</a> } @else { {{ r.source.title }} }
                {{ r.source.license ? '(' + r.source.license + ')' : '' }}
                @if (r.source.adaptation) { - {{ r.source.adaptation }} }
              </p>
            }
            @if (r.imageCredit) {
              <p>
                {{ t('detail.photoLabel') }} {{ r.imageCredit.author }}{{ r.imageCredit.license ? ', ' + r.imageCredit.license : '' }}
                @if (r.imageCredit.pageUrl) { - <a [href]="r.imageCredit.pageUrl" target="_blank" rel="noopener" class="underline">{{ t('detail.sourceLink') }}</a> }
              </p>
            }
          </footer>
        </div>

        <!-- Sticky mobile action bar (above the tab bar) -->
        <div class="print-hide fixed inset-x-0 z-20 flex gap-2 border-t border-hairline bg-surface/95 px-4 py-2 backdrop-blur-sm lg:hidden"
             style="bottom: calc(56px + var(--safe-bottom))">
          <button type="button" class="btn-primary flex-1" (click)="openPlanSheet()" data-qa="add-to-plan"><app-icon name="plus" [size]="18" /> {{ t('detail.addToPlan') }}</button>
          @if (r.steps.length) { <a [routerLink]="['/cook', r.id]" class="btn-secondary"><app-icon name="pot" [size]="18" /> {{ t('detail.cook') }}</a> }
          <button type="button" class="btn-icon border border-hairline" (click)="favorites.toggleFavorite(r.id)"
                  [attr.aria-pressed]="isFavorite()" [attr.aria-label]="isFavorite() ? t('card.removeFavorite') : t('card.addFavorite')">
            <app-icon name="heart" [filled]="isFavorite()" [class.text-accent]="isFavorite()" />
          </button>
        </div>
      </article>

      @switch (sheet()) {
        @case ('plan') {
          <app-bottom-sheet [title]="t('detail.planSheet')" (closed)="sheet.set(null)">
            <form class="space-y-5 pb-2" (ngSubmit)="addToPlan(r)">
              <fieldset>
                <legend class="label">{{ t('detail.day') }}</legend>
                <div class="scroll-row -mx-5 px-5">
                  @for (d of dayOptions; track d.value) {
                    <button type="button" class="flex min-w-[4rem] shrink-0 flex-col items-center rounded-2xl border px-3 py-2 text-sm"
                            [class.border-primary]="planDay() === d.value" [class.bg-primary]="planDay() === d.value" [class.text-primary-on]="planDay() === d.value"
                            [class.border-hairline]="planDay() !== d.value" (click)="planDay.set(d.value)">
                      <span class="text-xs opacity-80">{{ dayTop(d) }}</span><span class="font-semibold">{{ i18n.day(d.value, { day: 'numeric' }) }}</span>
                    </button>
                  }
                </div>
              </fieldset>
              <fieldset>
                <legend class="label">{{ t('detail.meal') }}</legend>
                <div class="flex flex-wrap gap-2">
                  @for (s of slots; track s) {
                    <button type="button" class="chip" [class.chip-active]="planSlot() === s" (click)="planSlot.set(s)">{{ i18n.slot(s) }}</button>
                  }
                </div>
              </fieldset>
              <div class="flex items-center justify-between">
                <span class="label mb-0">{{ t('detail.servingsLabel') }}</span>
                <div class="flex items-center rounded-full border border-hairline p-0.5">
                  <button type="button" class="btn-icon h-9 w-9" (click)="planServings.set(Math.max(1, planServings() - 1))" [attr.aria-label]="t('detail.fewerServings')"><app-icon name="minus" [size]="16" /></button>
                  <span class="min-w-[2.5rem] text-center font-semibold">{{ planServings() }}</span>
                  <button type="button" class="btn-icon h-9 w-9" (click)="planServings.set(planServings() + 1)" [attr.aria-label]="t('detail.moreServings')"><app-icon name="plus" [size]="16" /></button>
                </div>
              </div>
              <button type="submit" class="btn-primary w-full" [disabled]="busy()">{{ busy() ? t('detail.adding') : t('detail.addTo', { day: dayName(planDay()), slot: i18n.slotLower(planSlot()) }) }}</button>
            </form>
          </app-bottom-sheet>
        }
        @case ('menu') {
          <app-bottom-sheet [title]="recipeName()" (closed)="sheet.set(null)">
            <ul class="pb-2">
              <li><button type="button" class="menu-row" (click)="copyAndEdit(r)"><app-icon name="copy" /> {{ t('detail.copyEdit') }}</button></li>
              <li><button type="button" class="menu-row" (click)="openCollections()"><app-icon name="folder" /> {{ t('detail.addCollection') }}</button></li>
              <li><button type="button" class="menu-row" (click)="share(r)"><app-icon name="share" /> {{ t('common.share') }}</button></li>
              <li><button type="button" class="menu-row" (click)="print()"><app-icon name="print" /> {{ t('common.print') }}</button></li>
              @if (isOwner()) {
                <li class="my-1 border-t border-hairline"></li>
                <li><a class="menu-row" [routerLink]="['/recipes', r.id, 'edit']"><app-icon name="edit" /> {{ t('detail.editRecipe') }}</a></li>
                <li><button type="button" class="menu-row" (click)="toggleVisibility(r)"><app-icon [name]="r.isPublic ? 'eye-off' : 'eye'" /> {{ r.isPublic ? t('detail.makePrivate') : t('detail.makePublic') }}</button></li>
                <li><button type="button" class="menu-row text-accent" (click)="remove(r)"><app-icon name="trash" /> {{ t('detail.deleteRecipe') }}</button></li>
              }
            </ul>
          </app-bottom-sheet>
        }
        @case ('collection') {
          <app-bottom-sheet [title]="t('detail.addCollection')" (closed)="sheet.set(null)">
            <ul class="space-y-1">
              @for (c of collections.collections(); track c.id) {
                <li>
                  <button type="button" class="menu-row" (click)="toggleInCollection(c.id, r.id)">
                    <app-icon [name]="c.recipeIds.includes(r.id) ? 'check' : 'folder'" [class.text-primary]="c.recipeIds.includes(r.id)" />
                    <span class="flex-1">{{ c.name }}</span><span class="text-sm text-muted">{{ c.recipeIds.length }}</span>
                  </button>
                </li>
              } @empty {
                <li class="py-2 text-sm text-muted">{{ t('detail.noCollections') }}</li>
              }
            </ul>
            <form class="mt-3 flex gap-2 pb-2" (ngSubmit)="createCollection(r.id)">
              <input name="newCollection" class="input" [placeholder]="t('detail.newCollection')" [(ngModel)]="newCollection" />
              <button type="submit" class="btn-primary" [disabled]="!newCollection.trim()">{{ t('common.create') }}</button>
            </form>
          </app-bottom-sheet>
        }
      }
    } @else if (missing()) {
      <div class="page text-center">
        <h1 class="page-title mt-10">{{ t('detail.notFound') }}</h1>
        <p class="mt-2 text-muted">{{ t('detail.notFoundText') }}</p>
        <a routerLink="/" class="btn-primary mt-6">{{ t('detail.backDiscover') }}</a>
      </div>
    } @else {
      <div aria-busy="true" [attr.aria-label]="t('common.loadingRecipe')">
        <div class="skeleton aspect-[4/3] max-h-[60vh] w-full rounded-none lg:mx-auto lg:mt-6 lg:max-w-6xl lg:rounded-sheet"></div>
        <div class="mx-auto mt-6 max-w-3xl space-y-3 px-4"><div class="skeleton h-6 w-2/3"></div><div class="skeleton h-4 w-full"></div><div class="skeleton h-4 w-5/6"></div></div>
      </div>
    }
  `,
  styles: [`
    .menu-row { display: flex; width: 100%; min-height: 48px; align-items: center; gap: 0.875rem; border-radius: 1rem; padding: 0 0.75rem; text-align: start; font-weight: 500; }
    .menu-row:hover { background: rgb(var(--sunken)); }
  `],
})
export class RecipeDetailComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  readonly favorites = inject(FavoritesService);
  readonly auth = inject(AuthService);
  readonly collections = inject(CollectionService);
  private recipes = inject(RecipeService);
  private plan = inject(MealPlanService);
  private household = inject(HouseholdService);
  private storage = inject(StorageService);
  private timers = inject(TimerService);
  private toast = inject(ToastService);
  private router = inject(Router);

  /** Route param (withComponentInputBinding). */
  readonly id = input.required<string>();
  readonly Math = Math;

  readonly recipe = signal<Recipe | null>(null);
  readonly missing = signal(false);
  readonly imageFailed = signal(false);
  readonly servings = signal(4);
  readonly units = signal<UnitSystem>('metric');
  readonly checked = signal<Set<number>>(new Set());
  readonly sheet = signal<Sheet>(null);
  readonly busy = signal(false);
  readonly savedNotes = signal('');
  notes = '';
  newCollection = '';
  private resolving: string | null = null;

  readonly scaled = computed(() => {
    const r = this.recipe();
    return r ? this.recipes.scaleRecipe(r, this.servings()) : null;
  });
  readonly groups = computed<IngredientGroup[]>(() => {
    const out: IngredientGroup[] = [];
    (this.scaled()?.ingredients ?? []).forEach((ing, index) => {
      const last = out[out.length - 1];
      if (last && last.name === ing.group) last.items.push({ index, ing });
      else out.push({ name: ing.group, items: [{ index, ing }] });
    });
    return out;
  });
  readonly recipeName = computed(() => {
    const r = this.recipe();
    return r ? this.i18n.recipeName(r) : '';
  });
  readonly description = computed(() => {
    const r = this.recipe();
    return r ? this.i18n.recipeDescription(r) : '';
  });
  readonly tips = computed(() => {
    const r = this.recipe();
    return r ? this.i18n.recipeTips(r) : [];
  });
  readonly stepParts = computed<StepPart[][]>(() => {
    const r = this.recipe();
    return r ? this.i18n.recipeSteps(r).map(text => splitStepTimers(text)) : [];
  });
  readonly hero = computed(() => optimizeImage(this.recipe()?.image ?? '', 1600));
  readonly isFavorite = computed(() => this.favorites.myFavoriteIds().has(this.id()));
  readonly cookedCount = computed(() => this.plan.cookedCounts().get(this.id()) ?? 0);
  /** license "Original": written for the app (no free source), shown as "Written for Mise". */
  readonly isOriginal = computed(() => this.recipe()?.source?.license === 'Original');
  readonly sourceByline = computed(() => {
    const src = this.recipe()?.source;
    return [src?.author, src?.year].filter(Boolean).map(v => `${this.t('common.listSeparator')} ${v}`).join('');
  });

  // Add-to-plan sheet
  readonly slots = PLAN_SLOTS;
  readonly planDay = signal(todayIso());
  readonly planSlot = signal<PlanSlot>('dinner');
  readonly planServings = signal(2);
  readonly dayOptions = Array.from({ length: 14 }, (_, i) => {
    const value = addDays(todayIso(), i);
    return { value, index: i };
  });

  constructor() {
    effect(() => {
      const id = this.id();
      const loaded = this.recipes.recipesLoaded();
      const found = this.recipes.recipes().find(r => r.id === id && !r.summary);
      untracked(() => {
        if (found) {
          if (this.recipe()?.id !== found.id) this.opened(found);
          this.recipe.set(found);
          this.missing.set(false);
          return;
        }
        if (!loaded || this.resolving === id) return;
        this.resolving = id;
        // Not in the discovery catalog (private/unlisted or a copy): fetch by id; a hit is
        // merged into the catalog, which re-runs this effect.
        this.recipes.resolveRecipe(id).subscribe(r => {
          if (!r && this.id() === id) this.missing.set(true);
        });
      });
    });
    // Household unit preference is the default; the toggle overrides it on this page.
    effect(() => {
      const units = this.household.household()?.units;
      if (units) untracked(() => this.units.set(units));
    });
  }

  isOwner(): boolean {
    const r = this.recipe();
    return !!r && r.ownerId !== null && r.ownerId === this.auth.currentUser()?.id;
  }

  slug(cuisine: string): string {
    return cuisine.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  amount(ing: Ingredient): string {
    const converted = toUnitSystem({ quantity: ing.quantity, unit: ing.unit }, this.units());
    if (converted.quantity === null) return '';
    return this.i18n.amount(formatQuantity(converted.quantity), converted.unit && converted.unit !== 'piece' ? converted.unit : null, converted.quantity);
  }

  /** "(30 ml)" / "(≈ 120 g)" for the amount as displayed (after the metric/US toggle). */
  equivalent(ing: Ingredient): string {
    const shown = toUnitSystem({ quantity: ing.quantity, unit: ing.unit }, this.units());
    return this.i18n.equivalent(shown.quantity, shown.unit, equivalentName(ing), true);
  }

  dayTop(d: { value: string; index: number }): string {
    return d.index === 0 ? this.t('common.today') : d.index === 1 ? this.t('common.tomorrowShort') : this.i18n.day(d.value, { weekday: 'short' });
  }

  dayName(iso: string): string {
    return iso === todayIso() ? this.t('common.today') : this.i18n.day(iso);
  }

  changeServings(delta: number): void {
    this.servings.update(s => Math.min(100, Math.max(1, s + delta)));
  }

  toggleChecked(index: number): void {
    this.checked.update(set => {
      const next = new Set(set);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }

  startTimer(part: StepPart, r: Recipe): void {
    if (!part.timer) return;
    this.timers.start(part.text, part.timer.minutes, r.name);
    this.toast.show(this.t('timers.started', { text: part.text }));
  }

  back(): void {
    if (history.length > 1) history.back();
    else this.router.navigate(['/']);
  }

  openPlanSheet(): void {
    if (!requireLogin(this.router)) return;
    this.planServings.set(this.household.size());
    this.planDay.set(todayIso());
    this.sheet.set('plan');
  }

  addToPlan(r: Recipe): void {
    this.busy.set(true);
    const day = this.planDay();
    this.sheet.set(null);
    this.plan.addEntry({
      date: day,
      slot: this.planSlot(),
      recipeId: r.id,
      servings: this.planServings(),
      recipe: toPlanRecipeSummary(r),
    }).subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.show(this.t('detail.addedToPlan', { day: this.dayName(day), slot: this.i18n.slotLower(this.planSlot()) }));
      },
      error: () => {
        this.busy.set(false);
        this.toast.show(this.i18n.apiError(null, 'detail.couldNotAdd'), 'error');
      },
    });
  }

  saveNotes(): void {
    const r = this.recipe();
    if (!r || !requireLogin(this.router)) return;
    const value = this.notes;
    this.storage.setRecipeNotes(r.id, value).subscribe(ok => {
      if (ok) this.savedNotes.set(value);
      else this.toast.show(this.t('detail.couldNotNote'), 'error');
    });
  }

  copyAndEdit(r: Recipe): void {
    if (!requireLogin(this.router)) return;
    this.sheet.set(null);
    this.recipes.copyRecipe(r.id).subscribe({
      next: copy => this.router.navigate(['/recipes', copy.id, 'edit']),
      error: err => this.toast.show(this.i18n.apiError(err, 'detail.couldNotCopy'), 'error'),
    });
  }

  openCollections(): void {
    if (!requireLogin(this.router)) return;
    this.sheet.set('collection');
  }

  toggleInCollection(collectionId: string, recipeId: string): void {
    if (this.collections.isRecipeInCollection(collectionId, recipeId)) this.collections.removeRecipeFromCollection(collectionId, recipeId);
    else this.collections.addRecipeToCollection(collectionId, recipeId);
  }

  createCollection(recipeId: string): void {
    const name = this.newCollection.trim();
    if (!name) return;
    const c = this.collections.createCollection(name);
    this.collections.addRecipeToCollection(c.id, recipeId);
    this.newCollection = '';
    this.toast.show(this.t('detail.addedToCollection', { name }));
  }

  share(r: Recipe): void {
    this.sheet.set(null);
    const url = location.href;
    const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> };
    if (nav.share) nav.share({ title: this.i18n.recipeName(r), url }).catch(() => undefined);
    else navigator.clipboard?.writeText(url).then(() => this.toast.show(this.t('detail.linkCopied')));
  }

  print(): void {
    this.sheet.set(null);
    setTimeout(() => window.print(), 50);
  }

  toggleVisibility(r: Recipe): void {
    this.sheet.set(null);
    this.recipes.updateRecipe(r.id, { isPublic: !r.isPublic }).subscribe({
      next: updated => {
        this.recipe.set(updated);
        this.toast.show(this.t(updated.isPublic ? 'detail.nowPublic' : 'detail.nowPrivate'));
      },
      error: err => this.toast.show(this.i18n.apiError(err, 'detail.couldNotVisibility'), 'error'),
    });
  }

  remove(r: Recipe): void {
    if (!confirm(this.t('detail.confirmDelete', { name: this.i18n.recipeName(r) }))) return;
    this.sheet.set(null);
    this.recipes.deleteRecipe(r.id).subscribe({
      next: () => {
        this.toast.show(this.t('detail.deleted'));
        this.router.navigate(['/cookbook']);
      },
      error: err => this.toast.show(this.i18n.apiError(err, 'detail.couldNotDelete'), 'error'),
    });
  }

  private opened(r: Recipe): void {
    this.servings.set(r.servings);
    this.imageFailed.set(false);
    this.checked.set(new Set());
    this.recipes.recordView(r.id);
    if (this.auth.isAuthenticated()) {
      this.storage.getRecipeNotes(r.id).subscribe(n => {
        this.notes = n ?? '';
        this.savedNotes.set(n ?? '');
      });
    }
  }
}
