// Mirrors backend/app/routers/plan.py. Dates are plain local YYYY-MM-DD strings end to end.
import { MealType, RecipeTranslations } from './recipe.model';

export type PlanSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const PLAN_SLOTS: PlanSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Small recipe payload embedded in plan entries (works for members' private recipes too). */
export interface RecipeSummary {
  id: string;
  name: string;
  image: string;
  cuisine: string | null;
  totalTime: number | null;
  servings: number;
  mealTypes: MealType[];
  translations?: RecipeTranslations | null;
}

export interface PlanEntry {
  id: number;
  date: string;
  slot: PlanSlot;
  position: number;
  recipeId: string | null;
  recipe: RecipeSummary | null;
  /** Leftovers / Eating out / free text when there's no recipe. */
  customTitle: string | null;
  servings: number;
  addedBy: number | null;
  addedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanEntryCreate {
  date: string;
  slot: PlanSlot;
  recipeId?: string | null;
  customTitle?: string | null;
  servings?: number;
}

export interface PlanEntryPatch {
  date?: string;
  slot?: PlanSlot;
  position?: number;
  recipeId?: string;
  customTitle?: string;
  servings?: number;
}

export interface FillSuggestion {
  date: string;
  slot: PlanSlot;
  recipeId: string;
  recipe: RecipeSummary;
  servings: number;
}

export interface CookedStat {
  recipeId: string;
  count: number;
  lastDate: string;
}
