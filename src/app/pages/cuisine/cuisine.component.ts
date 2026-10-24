import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AVATAR_TINTS, EmptyStateComponent, IconComponent, RecipeCardComponent, hash } from '../../components';
import { I18nService } from '../../i18n/i18n.service';
import { MealType } from '../../models';
import { FavoritesService, RecipeService, cuisineSlug } from '../../services';
import { optimizeImage } from '../../utils/image-url';

/** /cuisines/:slug (public): photo hero, region and counts, meal-type chips, the recipes. */
@Component({
  selector: 'app-cuisine',
  standalone: true,
  imports: [RouterLink, RecipeCardComponent, IconComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative h-56 overflow-hidden bg-sunken sm:h-72 lg:mx-auto lg:mt-6 lg:max-w-6xl lg:rounded-sheet">
      @if (heroImage()) {
        <img [src]="heroImage()" alt="" class="h-full w-full object-cover" />
      } @else {
        <div class="h-full w-full" [style.background]="tint()"></div>
      }
      <div class="scrim absolute inset-0"></div>
      <a routerLink="/" class="btn-icon absolute start-3 bg-surface/90 shadow-soft" style="top: calc(0.75rem + var(--safe-top))" [attr.aria-label]="t('cuisinePage.backTo')">
        <app-icon name="arrow-left" />
      </a>
      <div class="absolute inset-x-0 bottom-0 p-4 text-white sm:p-8">
        @if (region()) { <span class="photo-pill">{{ i18n.region(region()!) }}</span> }
        <h1 class="mt-2 font-display text-4xl font-semibold text-white">{{ name() ? i18n.cuisine(name()!) : t('cuisinePage.fallbackName') }}</h1>
        @if (list().length) {
          <p class="mt-1 text-sm text-white/90">{{ t('cuisinePage.stats', { recipes: t('common.recipes', { count: list().length }), traditional: traditionalCount(), budget: budgetCount() }) }}</p>
        }
      </div>
    </div>

    <div class="page pt-5">
      @if (mealTypes().length > 1) {
        <div class="scroll-row">
          <button type="button" class="chip" [class.chip-active]="meal() === null" (click)="meal.set(null)">{{ t('common.all') }}</button>
          @for (m of mealTypes(); track m) {
            <button type="button" class="chip" [class.chip-active]="meal() === m" (click)="meal.set(m)">{{ i18n.meal(m) }}</button>
          }
        </div>
      }
      @if (!recipes.recipesLoaded()) {
        <div class="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">@for (i of [1, 2, 3]; track i) { <div class="skeleton aspect-[4/3]"></div> }</div>
      }
      <div class="mt-5 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
        @for (r of shown(); track r.id) {
          <app-recipe-card [recipe]="r" [isFavorite]="favorites.myFavoriteIds().has(r.id)" (favoriteToggled)="favorites.toggleFavorite($event)" />
        }
      </div>
      @if (recipes.recipesLoaded() && !list().length) {
        <app-empty-state icon="discover" [title]="t('cuisinePage.empty')" [text]="t('cuisinePage.emptyText')">
          <a routerLink="/" class="btn-primary">{{ t('cuisinePage.backTo') }}</a>
        </app-empty-state>
      }
    </div>
  `,
})
export class CuisineComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  readonly recipes = inject(RecipeService);
  readonly favorites = inject(FavoritesService);
  /** Route param (withComponentInputBinding). */
  readonly slug = input.required<string>();

  readonly meal = signal<MealType | null>(null);
  readonly list = computed(() => this.recipes.recipes().filter(r => r.cuisine && cuisineSlug(r.cuisine) === this.slug()));
  readonly shown = computed(() => {
    const m = this.meal();
    return m ? this.list().filter(r => r.mealTypes.includes(m)) : this.list();
  });
  readonly mealTypes = computed(() => [...new Set(this.list().flatMap(r => r.mealTypes))]);
  readonly name = computed(() => this.list()[0]?.cuisine ?? null);
  readonly region = computed(() => this.list()[0]?.region ?? null);
  readonly traditionalCount = computed(() => this.list().filter(r => r.traditional).length);
  readonly budgetCount = computed(() => this.list().filter(r => r.budget === 'low').length);
  readonly heroImage = computed(() => {
    const withPhoto = this.list().filter(r => r.image);
    const pick = withPhoto.find(r => r.traditional) ?? withPhoto[0];
    return pick ? optimizeImage(pick.image, 1600) : '';
  });
  readonly tint = computed(() => AVATAR_TINTS[hash(this.slug()) % AVATAR_TINTS.length]);
}
