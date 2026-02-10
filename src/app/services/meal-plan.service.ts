import { Injectable, signal, computed, inject } from '@angular/core';
import { WeeklyPlan, DayPlan, PlannedMeal, MealType } from '../models';
import { StorageService } from './storage.service';
import { RecipeService } from './recipe.service';

@Injectable({
  providedIn: 'root'
})
export class MealPlanService {
  private storageService = inject(StorageService);
  private recipeService = inject(RecipeService);

  private mealPlanSignal = signal<WeeklyPlan | null>(null);

  readonly mealPlan = this.mealPlanSignal.asReadonly();

  constructor() {
    this.loadMealPlan();
  }

  private loadMealPlan(): void {
    this.storageService.getMealPlan().subscribe(plan => {
      this.mealPlanSignal.set(plan);
    });
  }

  // Initialize a new weekly plan
  createWeeklyPlan(name: string, startDate: string): WeeklyPlan {
    const endDate = this.getEndDate(startDate);
    const days: DayPlan[] = [];

    for (let i = 0; i < 7; i++) {
      const date = this.addDays(startDate, i);
      days.push({
        date,
        meals: []
      });
    }

    const newPlan: WeeklyPlan = {
      id: this.generateId(),
      name,
      startDate,
      endDate,
      days,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.mealPlanSignal.set(newPlan);
    this.saveMealPlan();
    return newPlan;
  }

  // Add a meal to a specific day
  addMeal(date: string, recipeId: string, mealType: MealType, servings: number = 1, notes?: string): void {
    const currentPlan = this.mealPlanSignal();
    if (!currentPlan) return;

    const newMeal: PlannedMeal = {
      id: this.generateId(),
      recipeId,
      mealType,
      date,
      servings,
      notes
    };

    this.mealPlanSignal.update(plan => {
      if (!plan) return plan;
      return {
        ...plan,
        days: plan.days.map(day =>
          day.date === date
            ? { ...day, meals: [...day.meals, newMeal] }
            : day
        ),
        updatedAt: new Date().toISOString()
      };
    });

    this.saveMealPlan();
  }

  // Remove a meal
  removeMeal(mealId: string): void {
    const currentPlan = this.mealPlanSignal();
    if (!currentPlan) return;

    this.mealPlanSignal.update(plan => {
      if (!plan) return plan;
      return {
        ...plan,
        days: plan.days.map(day => ({
          ...day,
          meals: day.meals.filter(meal => meal.id !== mealId)
        })),
        updatedAt: new Date().toISOString()
      };
    });

    this.saveMealPlan();
  }

  // Update a meal
  updateMeal(mealId: string, updates: Partial<PlannedMeal>): void {
    const currentPlan = this.mealPlanSignal();
    if (!currentPlan) return;

    this.mealPlanSignal.update(plan => {
      if (!plan) return plan;
      return {
        ...plan,
        days: plan.days.map(day => ({
          ...day,
          meals: day.meals.map(meal =>
            meal.id === mealId ? { ...meal, ...updates } : meal
          )
        })),
        updatedAt: new Date().toISOString()
      };
    });

    this.saveMealPlan();
  }

  // Get meals for a specific day
  getMealsForDay(date: string): PlannedMeal[] {
    const plan = this.mealPlanSignal();
    if (!plan) return [];
    const day = plan.days.find(d => d.date === date);
    return day ? day.meals : [];
  }

  // Get meals for a specific meal type across the week
  getMealsByType(mealType: MealType): PlannedMeal[] {
    const plan = this.mealPlanSignal();
    if (!plan) return [];
    return plan.days.flatMap(day => day.meals.filter(meal => meal.mealType === mealType));
  }

  // Get all planned recipes
  getAllPlannedRecipes() {
    const plan = this.mealPlanSignal();
    if (!plan) return [];
    const recipeIds = plan.days.flatMap(day => day.meals.map(meal => meal.recipeId));
    return this.recipeService.getRecipesByIds(recipeIds);
  }

  // Clear all meals for a day
  clearDay(date: string): void {
    const currentPlan = this.mealPlanSignal();
    if (!currentPlan) return;

    this.mealPlanSignal.update(plan => {
      if (!plan) return plan;
      return {
        ...plan,
        days: plan.days.map(day =>
          day.date === date ? { ...day, meals: [] } : day
        ),
        updatedAt: new Date().toISOString()
      };
    });

    this.saveMealPlan();
  }

  // Clear entire meal plan
  clearMealPlan(): void {
    this.mealPlanSignal.set(null);
    this.storageService.setMealPlan(null).subscribe();
  }

  // Get week dates
  getWeekDates(): string[] {
    const plan = this.mealPlanSignal();
    if (!plan) return [];
    return plan.days.map(day => day.date);
  }

  // Check if a recipe is planned
  isRecipePlanned(recipeId: string): boolean {
    const plan = this.mealPlanSignal();
    if (!plan) return false;
    return plan.days.some(day => day.meals.some(meal => meal.recipeId === recipeId));
  }

  private saveMealPlan(): void {
    this.storageService.setMealPlan(this.mealPlanSignal()).subscribe();
  }

  private generateId(): string {
    return `meal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getEndDate(startDate: string): string {
    return this.addDays(startDate, 6);
  }

  private addDays(dateString: string, days: number): string {
    const date = new Date(dateString);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }
}
