// Pure logic behind the Plan page's recipe picker sheet (tabs + search), kept out of the
// component so it can be unit-tested.
import { CookedStat, MealType, PlanSlot, Recipe, RecipeSummary } from '../models';
import { normalizeSearch, recipeSearchText } from '../i18n/search';

export type PickerTab = 'favorites' | 'recent' | 'quick' | 'suggested';

/** The small recipe card embedded in a plan entry, for optimistic rows. */
export function toPlanRecipeSummary(recipe: Recipe): RecipeSummary {
  return {
    id: recipe.id,
    name: recipe.name,
    image: recipe.image,
    cuisine: recipe.cuisine,
    totalTime: recipe.totalTime,
    servings: recipe.servings,
    mealTypes: recipe.mealTypes,
    translations: recipe.translations,
  };
}

export interface PickerContext {
  recipes: Recipe[];
  /** Your favorites. */
  myFavorites: Set<string>;
  /** recipeId -> names of other household members who favorited it. */
  householdFavorites: Map<string, string[]>;
  cooked: CookedStat[];
  slot: PlanSlot;
  /** Recipe ids already planned in the visible week (pushed down in Suggested). */
  plannedThisWeek: Set<string>;
  preferBudget: boolean;
}

const SLOT_TYPES: Record<PlanSlot, MealType[]> = {
  breakfast: ['breakfast'],
  lunch: ['lunch', 'dinner', 'side'],
  dinner: ['dinner', 'lunch'],
  snack: ['snack', 'dessert', 'drink'],
};

export function matchesQuery(recipe: Recipe, query: string): boolean {
  const q = normalizeSearch(query.trim());
  if (!q) return true;
  return recipeSearchText(recipe).includes(q);
}

export function fitsSlot(recipe: Recipe, slot: PlanSlot): boolean {
  return !recipe.mealTypes.length || recipe.mealTypes.some(m => SLOT_TYPES[slot].includes(m));
}

/** The recipes a picker tab shows, already filtered by the search query. A non-empty query
 *  searches the whole catalog regardless of tab. */
export function pickerRecipes(tab: PickerTab, query: string, ctx: PickerContext): Recipe[] {
  const byId = new Map(ctx.recipes.map(r => [r.id, r]));
  if (query.trim()) {
    return ctx.recipes.filter(r => matchesQuery(r, query)).sort((a, b) => Number(fitsSlot(b, ctx.slot)) - Number(fitsSlot(a, ctx.slot)));
  }
  switch (tab) {
    case 'favorites': {
      const ids = [...ctx.myFavorites, ...[...ctx.householdFavorites.keys()].filter(id => !ctx.myFavorites.has(id))];
      return ids.map(id => byId.get(id)).filter((r): r is Recipe => !!r);
    }
    case 'recent':
      return ctx.cooked.map(c => byId.get(c.recipeId)).filter((r): r is Recipe => !!r);
    case 'quick':
      return ctx.recipes
        .filter(r => r.totalTime !== null && r.totalTime <= 30 && fitsSlot(r, ctx.slot))
        .sort((a, b) => (a.totalTime ?? 0) - (b.totalTime ?? 0));
    case 'suggested': {
      const cookedCount = new Map(ctx.cooked.map(c => [c.recipeId, c.count]));
      const score = (r: Recipe) =>
        (ctx.plannedThisWeek.has(r.id) ? 100 : 0) +
        (ctx.preferBudget ? ({ low: 0, medium: 2, high: 4 } as const)[r.budget ?? 'medium'] : 0) -
        (ctx.myFavorites.has(r.id) || ctx.householdFavorites.has(r.id) ? 3 : 0) -
        Math.min(cookedCount.get(r.id) ?? 0, 3);
      return ctx.recipes.filter(r => fitsSlot(r, ctx.slot)).sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
    }
  }
}
