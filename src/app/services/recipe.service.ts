import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, of, tap } from 'rxjs';
import {
  DietFilter,
  Recipe,
  RecipeCreateInput,
  RecipeDraft,
  RecipeFilter,
  RecipeUpdateInput,
} from '../models';
import { normalizeSearch, recipeSearchText } from '../i18n/search';
import { StorageService } from './storage.service';
import { isAuthenticated } from './auth-state';

export interface CuisineSummary {
  name: string;
  slug: string;
  region: string | null;
  count: number;
  image: string;
}

export const EMPTY_FILTER: RecipeFilter = {
  searchQuery: '',
  mealTypes: [],
  cuisines: [],
  diet: [],
  maxTotalTime: null,
  traditionalOnly: false,
  budgetFriendly: false,
};

export function cuisineSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const DIET_TESTS: Record<DietFilter, (r: Recipe) => boolean> = {
  vegetarian: r => r.diet.vegetarian || r.diet.vegan,
  vegan: r => r.diet.vegan,
  glutenFree: r => r.diet.glutenFree,
  dairyFree: r => r.diet.dairyFree || r.diet.vegan,
  noPork: r => !r.diet.containsPork,
  noAlcohol: r => !r.diet.containsAlcohol,
  nutFree: r => !r.diet.containsNuts,
};

/** The recipe catalog (discovery: root recipes, public + your own), Discover's filter state,
 *  scaling, recent views, and recipe CRUD. Favorites live in FavoritesService. */
@Injectable({
  providedIn: 'root'
})
export class RecipeService {
  private storage = inject(StorageService);

  private recipesSignal = signal<Recipe[]>([]);
  private recipesLoadedSignal = signal(false);
  private filterSignal = signal<RecipeFilter>({ ...EMPTY_FILTER });
  private recentViewsSignal = signal<string[]>([]);

  readonly recipes = this.recipesSignal.asReadonly();
  /** False until the catalog's first load resolves (see frontend.md G11). */
  readonly recipesLoaded = this.recipesLoadedSignal.asReadonly();
  readonly filter = this.filterSignal.asReadonly();

  readonly filteredRecipes = computed(() => {
    const f = this.filterSignal();
    const query = normalizeSearch(f.searchQuery.trim());
    return this.recipesSignal().filter(r => {
      // Matches names, cuisine and ingredients in every language (see recipeSearchText).
      if (query && !recipeSearchText(r).includes(query)) return false;
      if (f.mealTypes.length && !f.mealTypes.some(m => r.mealTypes.includes(m))) return false;
      if (f.cuisines.length && !f.cuisines.includes(r.cuisine ?? '')) return false;
      // Diet filters are AND: every selected one must hold (fixes the old OR behaviour, G4).
      if (!f.diet.every(d => DIET_TESTS[d](r))) return false;
      if (f.maxTotalTime !== null && (r.totalTime === null || r.totalTime > f.maxTotalTime)) return false;
      if (f.traditionalOnly && !r.traditional) return false;
      if (f.budgetFriendly && r.budget !== 'low') return false;
      return true;
    });
  });

  readonly hasActiveFilter = computed(() => {
    const f = this.filterSignal();
    return !!(f.searchQuery.trim() || f.mealTypes.length || f.cuisines.length || f.diet.length ||
      f.maxTotalTime !== null || f.traditionalOnly || f.budgetFriendly);
  });

  /** One entry per cuisine with a photo for the explorer row, most recipes first. */
  readonly cuisines = computed<CuisineSummary[]>(() => {
    const byName = new Map<string, CuisineSummary>();
    for (const r of this.recipesSignal()) {
      if (!r.cuisine) continue;
      const entry = byName.get(r.cuisine) ?? { name: r.cuisine, slug: cuisineSlug(r.cuisine), region: r.region, count: 0, image: '' };
      entry.count++;
      if (!entry.image && r.image) entry.image = r.image;
      byName.set(r.cuisine, entry);
    }
    return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  });

  readonly recentlyViewedRecipes = computed(() => {
    const all = this.recipesSignal();
    return this.recentViewsSignal()
      .map(id => all.find(r => r.id === id))
      .filter((r): r is Recipe => !!r);
  });

  constructor() {
    this.loadRecipes();
    // Reload on login/logout: the catalog includes the caller's own private recipes.
    effect(() => {
      const authed = isAuthenticated();
      untracked(() => {
        if (authed) {
          this.loadRecipes();
          this.storage.getRecentViews().subscribe(views => this.recentViewsSignal.set(views ?? []));
        } else {
          this.recentViewsSignal.set([]);
        }
      });
    });
  }

  loadRecipes(): void {
    this.storage.getRecipes().subscribe(recipes => {
      this.recipesSignal.set(recipes);
      this.recipesLoadedSignal.set(true);
    });
  }

  updateFilter(patch: Partial<RecipeFilter>): void {
    this.filterSignal.update(f => ({ ...f, ...patch }));
  }

  resetFilter(): void {
    this.filterSignal.set({ ...EMPTY_FILTER });
  }

  /** Sync lookup in the loaded catalog only - see resolveRecipe() for the safe version. */
  getRecipeById(id: string): Recipe | undefined {
    return this.recipesSignal().find(r => r.id === id);
  }

  getRecipesByIds(ids: string[]): Recipe[] {
    const all = this.recipesSignal();
    return ids.map(id => all.find(r => r.id === id)).filter((r): r is Recipe => !!r);
  }

  /** Catalog lookup, falling back to a direct fetch (private/unlisted recipes, twists) that
   *  is merged into the catalog signal. Resolves null only if the recipe truly doesn't exist. */
  resolveRecipe(id: string): Observable<Recipe | null> {
    const cached = this.getRecipeById(id);
    if (cached) return of(cached);
    return this.storage.getRecipeById(id).pipe(tap(r => r && this.mergeRecipe(r)));
  }

  /** Quantities scaled to `servings` (null quantities stay null). Nutrition is per serving
   *  and deliberately NOT scaled (old gotcha G9). Any new per-serving field needs a rule here. */
  scaleRecipe(recipe: Recipe, servings: number): Recipe {
    const factor = servings / (recipe.servings || 1);
    if (factor === 1) return recipe;
    return {
      ...recipe,
      servings,
      ingredients: recipe.ingredients.map(i => ({
        ...i,
        quantity: i.quantity === null ? null : Math.round(i.quantity * factor * 100) / 100,
      })),
    };
  }

  recordView(recipeId: string): void {
    if (!isAuthenticated()) return;
    const next = [recipeId, ...this.recentViewsSignal().filter(id => id !== recipeId)].slice(0, 12);
    this.recentViewsSignal.set(next);
    this.storage.setRecentViews(next).subscribe();
  }

  createRecipe(input: RecipeCreateInput): Observable<Recipe> {
    return this.storage.createRecipe(input).pipe(tap(r => this.mergeRecipe(r)));
  }

  updateRecipe(id: string, patch: RecipeUpdateInput): Observable<Recipe> {
    return this.storage.updateRecipe(id, patch).pipe(tap(r => this.mergeRecipe(r)));
  }

  deleteRecipe(id: string): Observable<void> {
    return this.storage.deleteRecipe(id).pipe(
      tap(() => this.recipesSignal.update(list => list.filter(r => r.id !== id)))
    );
  }

  /** "Copy to my recipes & edit": a private copy owned by the caller. */
  copyRecipe(id: string): Observable<Recipe> {
    return this.storage.copyRecipe(id).pipe(tap(r => this.mergeRecipe(r)));
  }

  loadMyRecipes(): Observable<Recipe[]> {
    return this.storage.getMyRecipes();
  }

  importFromUrl(url: string): Observable<RecipeDraft> {
    return this.storage.importRecipeFromUrl(url);
  }

  private mergeRecipe(recipe: Recipe): void {
    // Twists never appear in discovery; private ones stay reachable by id only.
    this.recipesSignal.update(list => {
      const idx = list.findIndex(r => r.id === recipe.id);
      if (idx >= 0) {
        const copy = [...list];
        copy[idx] = recipe;
        return copy;
      }
      return recipe.parentRecipeId ? list : [...list, recipe];
    });
  }
}
