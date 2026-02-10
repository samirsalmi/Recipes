export type MealType = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack';

export interface PlannedMeal {
  id: string;
  recipeId: string;
  mealType: MealType;
  date: string; // ISO date string
  servings: number;
  notes?: string;
}

export interface DayPlan {
  date: string;
  meals: PlannedMeal[];
}

export interface WeeklyPlan {
  id: string;
  name: string;
  startDate: string; // ISO date string (Monday)
  endDate: string; // ISO date string (Sunday)
  days: DayPlan[];
  createdAt: string;
  updatedAt: string;
}
