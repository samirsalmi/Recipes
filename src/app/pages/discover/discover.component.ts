import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AVATAR_TINTS, BottomSheetComponent, EmptyStateComponent, IconComponent, LanguageSwitcherComponent, RecipeCardComponent, hash } from '../../components';
import { I18nService } from '../../i18n/i18n.service';
import { DietFilter, MealType, Recipe, RecipeFilter } from '../../models';
import { AuthService, CuisineSummary, FavoritesService, MealPlanService, RecipeService } from '../../services';
import { todayIso } from '../../utils/dates';
import { optimizeImage } from '../../utils/image-url';
import { groupByRegion } from '../cuisines/cuisines.component';

/** Chip ids; labels come from the dictionaries (`mealPlural.<id>`, `diet.<id>`, `discover.time.<n>`). */
const MEAL_CHIPS: { id: MealType }[] = [
  { id: 'breakfast' }, { id: 'lunch' }, { id: 'dinner' }, { id: 'dessert' }, { id: 'snack' }, { id: 'side' },
];

const DIET_CHIPS: { id: DietFilter }[] = [
  { id: 'vegetarian' }, { id: 'vegan' }, { id: 'glutenFree' }, { id: 'dairyFree' }, { id: 'noPork' }, { id: 'noAlcohol' }, { id: 'nutFree' },
];

const TIME_CHOICES: { value: number | null; key: 'any' | '30' | '45' | '60' }[] = [
  { value: null, key: 'any' },
  { value: 30, key: '30' },
  { value: 45, key: '45' },
  { value: 60, key: '60' },
];

interface Shelf {
  id: 'heritage' | 'budget' | 'quick' | 'veg' | 'breakfast' | 'sweet' | 'oldBooks';
  title: string;
  subtitle: string;
  recipes: Recipe[];
  /** Filter applied by "See all" (none = no link). */
  seeAll?: Partial<RecipeFilter>;
}

/** Stable-per-day shuffle so shelves feel fresh without jumping around within a day. */
function dailyShuffle<T extends { id: string }>(list: T[], salt: string): T[] {
  const day = todayIso();
  return [...list].sort((a, b) => hash(day + salt + a.id) - hash(day + salt + b.id));
}

/** Discover (/): search + filter sheet, "Tonight", cuisine explorer, meal-type row, curated
 *  shelves (Heritage dishes and Feed everyone for less first), then the full catalog. Any
 *  search/filter switches to a results grid. */
@Component({
  selector: 'app-discover',
  standalone: true,
  imports: [RouterLink, RecipeCardComponent, IconComponent, BottomSheetComponent, EmptyStateComponent, LanguageSwitcherComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="flex items-end justify-between gap-4">
        <div class="min-w-0">
          <p class="eyebrow">{{ greeting() }}</p>
          <h1 class="page-title mt-1">{{ t('discover.title') }}</h1>
        </div>
        <span class="font-display text-2xl font-semibold text-primary lg:hidden" aria-hidden="true">Mise</span>
      </header>
      @if (!auth.isAuthenticated()) {
        <div class="mt-3 lg:hidden"><app-language-switcher [compact]="true" /></div>
      }

      <div class="mt-5 flex gap-2">
        <label class="relative block min-w-0 flex-1">
          <span class="sr-only">{{ t('discover.searchLabel') }}</span>
          <app-icon name="search" class="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted" [size]="20" />
          <input type="search" class="input ps-12" [placeholder]="t('discover.searchPlaceholder')" data-qa="search"
                 [value]="filter().searchQuery" (input)="recipes.updateFilter({ searchQuery: $any($event.target).value })" />
        </label>
        <button type="button" class="btn-secondary relative shrink-0 px-4" (click)="filtersOpen.set(true)" data-qa="open-filters"
                [attr.aria-label]="filterCount() ? t('discover.filtersActive', { count: filterCount() }) : t('discover.filters')">
          <app-icon name="filter" [size]="20" />
          <span class="hidden sm:inline">{{ t('discover.filters') }}</span>
          @if (filterCount()) {
            <span class="absolute -end-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-white">{{ filterCount() }}</span>
          }
        </button>
      </div>

      @if (!recipes.recipesLoaded()) {
        <div class="mt-6 space-y-6" aria-busy="true" [attr.aria-label]="t('common.loadingRecipes')">
          <div class="skeleton h-24"></div>
          <div class="flex gap-4 overflow-hidden">@for (i of [1, 2, 3, 4, 5, 6]; track i) { <div class="skeleton h-20 w-20 shrink-0 rounded-full"></div> }</div>
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">@for (i of [1, 2, 3, 4]; track i) { <div class="skeleton aspect-[4/3]"></div> }</div>
        </div>
      } @else if (recipes.hasActiveFilter()) {
        <!-- Results mode -->
        <div class="mt-4 flex flex-wrap items-center gap-2">
          @for (chip of activeChips(); track chip.label) {
            <button type="button" class="chip chip-active" (click)="chip.clear()" [attr.aria-label]="t('discover.removeFilter', { label: chip.label })">
              {{ chip.label }} <app-icon name="x" [size]="14" />
            </button>
          }
          <button type="button" class="btn-ghost min-h-[36px] px-3" (click)="recipes.resetFilter()">{{ t('common.clearAll') }}</button>
        </div>
        <p class="mt-4 text-sm text-muted" aria-live="polite">{{ t('discover.resultCount', { count: results().length }) }}</p>
        <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          @for (r of results(); track r.id) {
            <app-recipe-card [recipe]="r" [isFavorite]="favorites.myFavoriteIds().has(r.id)" (favoriteToggled)="favorites.toggleFavorite($event)" />
          }
        </div>
        @if (!results().length) {
          <app-empty-state icon="search" [title]="t('discover.nothingMatches')" [text]="t('discover.nothingMatchesText')">
            <button type="button" class="btn-primary" (click)="recipes.resetFilter()">{{ t('discover.clearFilters') }}</button>
          </app-empty-state>
        }
      } @else {
        <!-- Tonight -->
        @if (tonight(); as t) {
          <a [routerLink]="t.recipeId ? ['/recipes', t.recipeId] : ['/plan']" class="card mt-5 flex items-center gap-4 p-3 pe-4">
            @if (t.recipe?.image) {
              <img [src]="thumb(t.recipe!.image, 240)" alt="" class="h-20 w-20 shrink-0 rounded-2xl object-cover" />
            } @else {
              <span class="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-primary-tint text-primary"><app-icon name="pot" [size]="28" /></span>
            }
            <div class="min-w-0 flex-1">
              <span class="badge-saffron">{{ i18n.t('discover.tonight') }}</span>
              <p dir="auto" class="mt-1 line-clamp-2 font-display text-lg font-semibold leading-snug">{{ tonightTitle(t) }}</p>
              @if (t.addedByName) { <p class="text-xs text-muted">{{ i18n.t('discover.tonightMeta', { servings: i18n.t('common.servings', { count: t.servings }), name: t.addedByName }) }}</p> }
            </div>
            @if (t.recipeId) {
              <span class="btn-primary hidden shrink-0 sm:inline-flex"><app-icon name="pot" [size]="18" /> {{ i18n.t('discover.cook') }}</span>
            }
          </a>
        } @else if (auth.isAuthenticated() && plan.loaded()) {
          <a routerLink="/plan" class="mt-5 flex items-center gap-3 rounded-card border border-dashed border-hairline p-4 text-muted hover:border-primary/50">
            <app-icon name="plan" [size]="22" class="text-primary" />
            <span class="flex-1 text-sm">{{ t('discover.nothingTonight') }} <span class="font-semibold text-primary">{{ t('discover.planWeek') }}</span></span>
            <app-icon name="chevron-right" [size]="18" />
          </a>
        }

        <!-- Cuisine explorer -->
        <section class="mt-8" aria-labelledby="cuisines-title">
          <div class="flex items-baseline justify-between">
            <h2 id="cuisines-title" class="section-title">{{ t('discover.aroundWorld') }}</h2>
            <a routerLink="/cuisines" class="btn-ghost -me-3 min-h-[36px] px-3">{{ t('discover.allCount', { count: recipes.cuisines().length }) }}</a>
          </div>
          <div class="scroll-row mt-3">
            @for (c of cuisineRow(); track c.slug) {
              <a [routerLink]="['/cuisines', c.slug]" class="flex w-[76px] shrink-0 flex-col items-center gap-1.5 text-center">
                @if (c.image) {
                  <img [src]="thumb(c.image, 200)" [alt]="" loading="lazy" class="h-[72px] w-[72px] rounded-full object-cover ring-2 ring-surface shadow-soft" />
                } @else {
                  <span class="flex h-[72px] w-[72px] items-center justify-center rounded-full font-display text-xl font-semibold text-white shadow-soft"
                        [style.background]="monogramTint(c.name)" aria-hidden="true">{{ monogram(i18n.cuisine(c.name)) }}</span>
                }
                <span class="line-clamp-2 text-xs font-medium leading-tight">{{ i18n.cuisine(c.name) }}</span>
              </a>
            }
          </div>
        </section>

        <!-- Meal types -->
        <section class="mt-6" [attr.aria-label]="t('discover.mealTypes')">
          <div class="scroll-row">
            @for (m of mealChips; track m.id) {
              <button type="button" class="chip" (click)="recipes.updateFilter({ mealTypes: [m.id] })">{{ i18n.mealPlural(m.id) }}</button>
            }
          </div>
        </section>

        <!-- Shelves -->
        @for (shelf of shelves(); track shelf.id) {
          <section class="mt-9" [attr.aria-labelledby]="'shelf-' + shelf.id">
            <div class="flex items-end justify-between gap-3">
              <div class="min-w-0">
                <h2 [id]="'shelf-' + shelf.id" class="section-title">{{ shelf.title }}</h2>
                <p class="text-sm text-muted">{{ shelf.subtitle }}</p>
              </div>
              @if (shelf.seeAll) {
                <button type="button" class="btn-ghost min-h-[36px] shrink-0 px-3" (click)="recipes.updateFilter(shelf.seeAll!)">{{ t('common.seeAll') }}</button>
              }
            </div>
            <div class="scroll-row mt-3 lg:grid lg:grid-cols-5 lg:gap-4 lg:overflow-visible">
              @for (r of shelf.recipes; track r.id) {
                <div class="w-[46vw] max-w-[260px] shrink-0 sm:w-56 lg:w-auto lg:max-w-none lg:[&:nth-child(n+6)]:hidden">
                  <app-recipe-card [recipe]="r" [isFavorite]="favorites.myFavoriteIds().has(r.id)" (favoriteToggled)="favorites.toggleFavorite($event)" />
                </div>
              }
            </div>
          </section>
        }

        <!-- Everything -->
        <section class="mt-10" aria-labelledby="all-title">
          <h2 id="all-title" class="section-title">{{ t('discover.allRecipes') }}</h2>
          <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            @for (r of allRecipes(); track r.id) {
              <app-recipe-card [recipe]="r" [isFavorite]="favorites.myFavoriteIds().has(r.id)" (favoriteToggled)="favorites.toggleFavorite($event)" />
            }
          </div>
          @if (!allRecipes().length) {
            <app-empty-state icon="cookbook" [title]="t('discover.noRecipes')" [text]="t('discover.noRecipesText')" />
          }
        </section>
      }

      <footer class="mt-12 text-center text-xs text-muted">
        {{ t('discover.footer') }} <a routerLink="/credits" class="underline">{{ t('discover.credits') }}</a>
      </footer>
    </div>

    @if (filtersOpen()) {
      <app-bottom-sheet [title]="t('discover.sheetTitle')" (closed)="filtersOpen.set(false)">
        <div class="space-y-6">
          <fieldset>
            <legend class="label">{{ t('discover.meal') }}</legend>
            <div class="flex flex-wrap gap-2">
              @for (m of mealChips; track m.id) {
                <button type="button" class="chip" [class.chip-active]="filter().mealTypes.includes(m.id)" [attr.aria-pressed]="filter().mealTypes.includes(m.id)" (click)="toggleMeal(m.id)">{{ i18n.mealPlural(m.id) }}</button>
              }
            </div>
          </fieldset>
          <fieldset>
            <legend class="label">{{ t('discover.time') }}</legend>
            <div class="flex flex-wrap gap-2">
              @for (tc of timeChoices; track tc.key) {
                <button type="button" class="chip" [class.chip-active]="filter().maxTotalTime === tc.value" (click)="recipes.updateFilter({ maxTotalTime: tc.value })">{{ timeLabel(tc.key) }}</button>
              }
            </div>
          </fieldset>
          <fieldset>
            <legend class="label">{{ t('discover.diet') }}</legend>
            <div class="flex flex-wrap gap-2">
              @for (d of dietChips; track d.id) {
                <button type="button" class="chip" [class.chip-active]="filter().diet.includes(d.id)" [attr.aria-pressed]="filter().diet.includes(d.id)" (click)="toggleDiet(d.id)">{{ i18n.diet(d.id) }}</button>
              }
            </div>
          </fieldset>
          <fieldset class="space-y-3">
            <legend class="label">{{ t('discover.kind') }}</legend>
            <label class="flex items-center justify-between gap-4">
              <span><span class="font-medium">{{ t('discover.traditional') }}</span><br /><span class="text-sm text-muted">{{ t('discover.traditionalHint') }}</span></span>
              <input type="checkbox" class="switch" [checked]="filter().traditionalOnly" (change)="recipes.updateFilter({ traditionalOnly: !filter().traditionalOnly })" />
            </label>
            <label class="flex items-center justify-between gap-4">
              <span><span class="font-medium">{{ t('discover.budgetFriendly') }}</span><br /><span class="text-sm text-muted">{{ t('discover.budgetHint') }}</span></span>
              <input type="checkbox" class="switch" [checked]="filter().budgetFriendly" (change)="recipes.updateFilter({ budgetFriendly: !filter().budgetFriendly })" />
            </label>
          </fieldset>
          <fieldset>
            <legend class="label">{{ t('discover.cuisine') }}</legend>
            @for (g of cuisineGroups(); track g.region) {
              <details class="border-b border-hairline py-2 last:border-0" [open]="regionHasSelection(g.cuisines)">
                <summary class="flex cursor-pointer list-none items-center justify-between py-1 text-sm font-medium">
                  <span>{{ i18n.region(g.region) }} <span class="font-normal text-muted">({{ i18n.n(g.cuisines.length) }})</span></span>
                  <app-icon name="chevron-down" [size]="16" class="text-muted" />
                </summary>
                <div class="mt-2 flex flex-wrap gap-2">
                  @for (c of g.cuisines; track c.slug) {
                    <button type="button" class="chip" [class.chip-active]="filter().cuisines.includes(c.name)" (click)="toggleCuisine(c.name)">{{ i18n.cuisine(c.name) }}</button>
                  }
                </div>
              </details>
            }
          </fieldset>
          <div class="sheet-footer sticky -mx-5 flex gap-2 border-t border-hairline bg-surface px-5 pt-3">
            <button type="button" class="btn-secondary" (click)="recipes.resetFilter()">{{ t('common.reset') }}</button>
            <button type="button" class="btn-primary flex-1" (click)="filtersOpen.set(false)">{{ t('discover.show', { count: results().length }) }}</button>
          </div>
        </div>
      </app-bottom-sheet>
    }
  `,
})
export class DiscoverComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  readonly recipes = inject(RecipeService);
  readonly favorites = inject(FavoritesService);
  readonly plan = inject(MealPlanService);
  readonly auth = inject(AuthService);

  readonly mealChips = MEAL_CHIPS;
  readonly dietChips = DIET_CHIPS;
  readonly timeChoices = TIME_CHOICES;
  readonly filter = this.recipes.filter;
  readonly results = this.recipes.filteredRecipes;
  readonly filtersOpen = signal(false);

  readonly filterCount = computed(() => {
    const f = this.filter();
    return f.mealTypes.length + f.cuisines.length + f.diet.length + (f.maxTotalTime !== null ? 1 : 0) +
      (f.traditionalOnly ? 1 : 0) + (f.budgetFriendly ? 1 : 0);
  });

  readonly activeChips = computed(() => {
    const f = this.filter();
    const r = this.recipes;
    const i18n = this.i18n;
    const chips: { label: string; clear: () => void }[] = [];
    if (f.searchQuery.trim()) chips.push({ label: `"${f.searchQuery.trim()}"`, clear: () => r.updateFilter({ searchQuery: '' }) });
    for (const m of f.mealTypes) chips.push({ label: i18n.mealPlural(m), clear: () => r.updateFilter({ mealTypes: f.mealTypes.filter(x => x !== m) }) });
    for (const c of f.cuisines) chips.push({ label: i18n.cuisine(c), clear: () => r.updateFilter({ cuisines: f.cuisines.filter(x => x !== c) }) });
    for (const d of f.diet) chips.push({ label: i18n.diet(d), clear: () => r.updateFilter({ diet: f.diet.filter(x => x !== d) }) });
    if (f.maxTotalTime !== null) chips.push({ label: i18n.t('discover.chipTime', { count: f.maxTotalTime }), clear: () => r.updateFilter({ maxTotalTime: null }) });
    if (f.traditionalOnly) chips.push({ label: i18n.t('discover.traditional'), clear: () => r.updateFilter({ traditionalOnly: false }) });
    if (f.budgetFriendly) chips.push({ label: i18n.t('discover.budgetFriendly'), clear: () => r.updateFilter({ budgetFriendly: false }) });
    return chips;
  });

  readonly tonight = computed(() => {
    const today = this.plan.todayEntries();
    return today.find(e => e.slot === 'dinner') ?? today.find(e => e.slot === 'lunch') ?? today[0] ?? null;
  });

  readonly greeting = computed(() => {
    const name = this.auth.currentUser()?.name?.split(' ')[0];
    const hour = new Date().getHours();
    const part = this.t(hour < 12 ? 'greeting.morning' : hour < 18 ? 'greeting.afternoon' : 'greeting.evening');
    return name ? this.t('greeting.withName', { greeting: part, name }) : part;
  });

  /** Cuisines with a representative photo: prefer a traditional recipe that has one. */
  readonly cuisineRow = computed<CuisineSummary[]>(() => {
    const all = this.recipes.recipes();
    return this.recipes.cuisines().map(c => {
      const own = all.filter(r => r.cuisine === c.name && r.image);
      const pick = own.find(r => r.traditional) ?? own[0];
      return { ...c, image: pick?.image ?? '' };
    });
  });

  readonly shelves = computed<Shelf[]>(() => {
    const all = this.recipes.recipes();
    const pick = (salt: string, list: Recipe[]) => dailyShuffle(list, salt).slice(0, 12);
    const t = this.t;
    const shelves: Shelf[] = [
      { id: 'heritage', title: t('discover.shelf.heritage'), subtitle: t('discover.shelf.heritageSub'), recipes: pick('h', all.filter(r => r.traditional)), seeAll: { traditionalOnly: true } },
      { id: 'budget', title: t('discover.shelf.budget'), subtitle: t('discover.shelf.budgetSub'), recipes: pick('b', all.filter(r => r.budget === 'low')), seeAll: { budgetFriendly: true } },
      { id: 'quick', title: t('discover.shelf.quick'), subtitle: t('discover.shelf.quickSub'), recipes: pick('q', all.filter(r => r.totalTime !== null && r.totalTime <= 30 && r.mealTypes.some(m => m === 'dinner' || m === 'lunch'))), seeAll: { maxTotalTime: 30 } },
      { id: 'veg', title: t('discover.shelf.veg'), subtitle: t('discover.shelf.vegSub'), recipes: pick('v', all.filter(r => r.diet.vegetarian || r.diet.vegan)), seeAll: { diet: ['vegetarian'] } },
      { id: 'breakfast', title: t('discover.shelf.breakfast'), subtitle: t('discover.shelf.breakfastSub'), recipes: pick('br', all.filter(r => r.mealTypes.includes('breakfast'))), seeAll: { mealTypes: ['breakfast'] } },
      { id: 'sweet', title: t('discover.shelf.sweet'), subtitle: t('discover.shelf.sweetSub'), recipes: pick('s', all.filter(r => r.mealTypes.includes('dessert'))), seeAll: { mealTypes: ['dessert'] } },
      { id: 'oldBooks', title: t('discover.shelf.oldBooks'), subtitle: t('discover.shelf.oldBooksSub'), recipes: pick('o', all.filter(r => !!r.source?.year && r.source.year < 1930)) },
    ];
    return shelves.filter(s => s.recipes.length >= 2);
  });

  readonly cuisineGroups = computed(() =>
    groupByRegion(this.recipes.cuisines()).map(g => ({
      ...g,
      cuisines: [...g.cuisines].sort((a, b) => this.i18n.cuisine(a.name).localeCompare(this.i18n.cuisine(b.name), this.i18n.language())),
    }))
  );
  readonly allRecipes = computed(() => {
    const locale = this.i18n.language();
    return [...this.recipes.recipes()].sort((a, b) => this.i18n.recipeName(a).localeCompare(this.i18n.recipeName(b), locale));
  });

  timeLabel(key: 'any' | '30' | '45' | '60'): string {
    return this.t(`discover.time.${key}`);
  }

  tonightTitle(e: { recipe: Parameters<I18nService['recipeName']>[0] | null; customTitle: string | null }): string {
    return e.recipe ? this.i18n.recipeName(e.recipe) : this.i18n.customMealTitle(e.customTitle);
  }

  thumb(url: string, width: number): string {
    return optimizeImage(url, width);
  }

  monogram(name: string): string {
    return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }

  monogramTint(name: string): string {
    return AVATAR_TINTS[hash(name) % AVATAR_TINTS.length];
  }

  toggleMeal(id: MealType): void {
    const current = this.filter().mealTypes;
    this.recipes.updateFilter({ mealTypes: current.includes(id) ? current.filter(m => m !== id) : [...current, id] });
  }

  toggleDiet(id: DietFilter): void {
    const current = this.filter().diet;
    this.recipes.updateFilter({ diet: current.includes(id) ? current.filter(d => d !== id) : [...current, id] });
  }

  regionHasSelection(cuisines: CuisineSummary[]): boolean {
    return cuisines.some(c => this.filter().cuisines.includes(c.name));
  }

  toggleCuisine(name: string): void {
    const current = this.filter().cuisines;
    this.recipes.updateFilter({ cuisines: current.includes(name) ? current.filter(c => c !== name) : [...current, name] });
  }
}
