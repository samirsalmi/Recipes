import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../i18n/i18n.service';
import { PlanSlot } from '../../models';
import { FavoritesService, HouseholdService, MealPlanService, RecipeService } from '../../services';
import { optimizeImage } from '../../utils/image-url';
import { PickerTab, pickerRecipes } from '../../utils/picker';
import { IconComponent } from '../icon/icon.component';

export interface PickerChoice {
  recipeId?: string;
  customTitle?: string;
}

const TABS: { id: PickerTab }[] = [{ id: 'favorites' }, { id: 'recent' }, { id: 'quick' }, { id: 'suggested' }];

/** Body of the Plan page's "Add meal" / "Swap" bottom sheet: search + tabs (favorites incl.
 *  household members', recently cooked, quick, suggested) and, when adding, the real-life
 *  entries Leftovers / Eating out / free text. Filtering lives in utils/picker.ts. */
@Component({
  selector: 'app-recipe-picker',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="relative block">
      <span class="sr-only">{{ t('discover.searchLabel') }}</span>
      <app-icon name="search" class="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted" [size]="18" />
      <input type="search" class="input ps-11" [placeholder]="t('picker.search')" [ngModel]="query()" (ngModelChange)="query.set($event)" />
    </label>

    @if (allowCustom() && !query()) {
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" class="chip" (click)="picked.emit({ customTitle: 'Leftovers' })">{{ t('plan.leftovers') }}</button>
        <button type="button" class="chip" (click)="picked.emit({ customTitle: 'Eating out' })">{{ t('plan.eatingOut') }}</button>
        <button type="button" class="chip" (click)="customOpen.set(!customOpen())"><app-icon name="edit" [size]="14" /> {{ t('picker.somethingElse') }}</button>
      </div>
      @if (customOpen()) {
        <form class="mt-2 flex gap-2" (ngSubmit)="custom()">
          <input name="custom" class="input" [placeholder]="t('picker.customPlaceholder')" [(ngModel)]="customTitle" dir="auto" />
          <button type="submit" class="btn-primary" [disabled]="!customTitle.trim()">{{ t('common.add') }}</button>
        </form>
      }
    }

    @if (!query()) {
      <div class="scroll-row mt-4" role="tablist">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" class="chip" [class.chip-active]="tab() === t.id" [attr.aria-selected]="tab() === t.id" (click)="tab.set(t.id)">{{ tabLabel(t.id) }}</button>
        }
      </div>
    }

    <ul class="mt-3 max-h-[45vh] space-y-1 overflow-y-auto pb-2">
      @for (r of list(); track r.id) {
        <li>
          <button type="button" class="flex w-full items-center gap-3 rounded-2xl p-2 text-start hover:bg-sunken" (click)="picked.emit({ recipeId: r.id })">
            @if (r.image) {
              <img [src]="thumb(r.image)" alt="" class="h-14 w-14 shrink-0 rounded-xl object-cover" loading="lazy" />
            } @else {
              <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary-tint text-primary"><app-icon name="pot" [size]="22" /></span>
            }
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium" dir="auto">{{ i18n.recipeName(r) }}</span>
              <span class="block truncate text-xs text-muted">
                {{ r.cuisine ? i18n.cuisine(r.cuisine) : '' }}@if (r.totalTime) { · {{ t('common.minutes', { count: r.totalTime }) }}}@if (r.budget === 'low') { · {{ t('picker.budget') }}}
                @if (favoredBy(r.id); as who) { · ♥ {{ who }} }
              </span>
            </span>
            <app-icon name="plus" [size]="18" class="text-primary" />
          </button>
        </li>
      } @empty {
        <li class="py-8 text-center text-sm text-muted">{{ emptyText() }}</li>
      }
    </ul>
  `,
})
export class RecipePickerComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  private recipes = inject(RecipeService);
  private favorites = inject(FavoritesService);
  private plan = inject(MealPlanService);
  private household = inject(HouseholdService);

  readonly slot = input<PlanSlot>('dinner');
  /** Offer Leftovers / Eating out / free text (not when swapping a recipe). */
  readonly allowCustom = input(true);
  readonly picked = output<PickerChoice>();

  readonly tabs = TABS;
  readonly tab = signal<PickerTab>('favorites');
  readonly query = signal('');
  readonly customOpen = signal(false);
  customTitle = '';

  readonly list = computed(() =>
    pickerRecipes(this.tab(), this.query(), {
      recipes: this.recipes.recipes(),
      myFavorites: this.favorites.myFavoriteIds(),
      householdFavorites: this.favorites.householdFavorites(),
      cooked: this.plan.cooked(),
      slot: this.slot(),
      plannedThisWeek: new Set(this.plan.entries().map(e => e.recipeId).filter((id): id is string => !!id)),
      preferBudget: this.household.household()?.preferBudget ?? false,
    }).slice(0, 60)
  );

  readonly emptyText = computed(() => {
    if (this.query()) return this.t('picker.empty.search');
    return this.t(`picker.empty.${this.tab()}`);
  });

  constructor() {
    // Start on a tab that has something in it.
    queueMicrotask(() => {
      if (!this.favorites.myFavoriteIds().size && !this.favorites.householdFavorites().size) this.tab.set('suggested');
    });
  }

  favoredBy(recipeId: string): string {
    const names = [...(this.favorites.myFavoriteIds().has(recipeId) ? [this.t('common.you')] : []), ...(this.favorites.householdFavorites().get(recipeId) ?? [])];
    return names.join(', ');
  }

  tabLabel(id: PickerTab): string {
    return this.t(`picker.tab.${id}`);
  }

  thumb(url: string): string {
    return optimizeImage(url, 160);
  }

  custom(): void {
    const title = this.customTitle.trim();
    if (title) this.picked.emit({ customTitle: title });
  }
}
