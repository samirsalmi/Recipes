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

  // Every week the user has ever visited is kept (not just the current one), so planning
  // ahead or looking back doesn't erase anything - `activeStartDateSignal` just picks which
  // one `mealPlan` currently points at.
  private plansSignal = signal<WeeklyPlan[]>([]);
  private activeStartDateSignal = signal<string | null>(null);
  private plansLoadedSignal = signal(false);

  readonly mealPlan = computed(() => {
    const activeStart = this.activeStartDateSignal();
    return this.plansSignal().find(p => p.startDate === activeStart) ?? null;
  });
  readonly plansLoaded = this.plansLoadedSignal.asReadonly();

  constructor() {
    this.loadMealPlan();
  }

  private loadMealPlan(): void {
    this.storageService.getMealPlan().subscribe(stored => {
      // Older accounts have a single WeeklyPlan object stored under this key, from before
      // multi-week history existed - treat that as a one-item history instead of losing it.
      const plans: WeeklyPlan[] = Array.isArray(stored) ? stored : stored ? [stored as WeeklyPlan] : [];
      this.plansSignal.set(plans);
      this.plansLoadedSignal.set(true);

      const thisWeek = this.mondayOf(new Date());
      if (plans.some(p => p.startDate === thisWeek)) {
        this.activeStartDateSignal.set(thisWeek);
      } else {
        this.createWeeklyPlan('My Meal Plan', thisWeek);
      }
    });
  }

  // Initialize a new weekly plan for a given week, or replace the one already stored for it
  // (shouldn't normally happen - goToWeek() checks first - but keeps this safe to call directly).
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

    this.plansSignal.update(plans => [...plans.filter(p => p.startDate !== startDate), newPlan]);
    this.activeStartDateSignal.set(startDate);
    this.savePlans();
    return newPlan;
  }

  // Switches which week mealPlan() points at, creating an empty (persisted) plan for it if
  // this is the first time it's been visited.
  goToWeek(startDate: string): void {
    this.activeStartDateSignal.set(startDate);
    if (!this.plansSignal().some(p => p.startDate === startDate)) {
      this.createWeeklyPlan('My Meal Plan', startDate);
    }
  }

  goToCurrentWeek(): void {
    this.goToWeek(this.mondayOf(new Date()));
  }

  goToNextWeek(): void {
    this.goToWeek(this.addDays(this.activeOrCurrentStartDate(), 7));
  }

  goToPreviousWeek(): void {
    this.goToWeek(this.addDays(this.activeOrCurrentStartDate(), -7));
  }

  private activeOrCurrentStartDate(): string {
    return this.mealPlan()?.startDate ?? this.mondayOf(new Date());
  }

  // Add a meal to a specific day
  addMeal(date: string, recipeId: string, mealType: MealType, servings: number = 1, notes?: string): void {
    const newMeal: PlannedMeal = {
      id: this.generateId(),
      recipeId,
      mealType,
      date,
      servings,
      notes
    };

    this.updateActivePlan(plan => ({
      ...plan,
      days: plan.days.map(day =>
        day.date === date
          ? { ...day, meals: [...day.meals, newMeal] }
          : day
      ),
      updatedAt: new Date().toISOString()
    }));
  }

  // Remove a meal
  removeMeal(mealId: string): void {
    this.updateActivePlan(plan => ({
      ...plan,
      days: plan.days.map(day => ({
        ...day,
        meals: day.meals.filter(meal => meal.id !== mealId)
      })),
      updatedAt: new Date().toISOString()
    }));
  }

  // Update a meal
  updateMeal(mealId: string, updates: Partial<PlannedMeal>): void {
    this.updateActivePlan(plan => ({
      ...plan,
      days: plan.days.map(day => ({
        ...day,
        meals: day.meals.map(meal =>
          meal.id === mealId ? { ...meal, ...updates } : meal
        )
      })),
      updatedAt: new Date().toISOString()
    }));
  }

  // Get meals for a specific day
  getMealsForDay(date: string): PlannedMeal[] {
    const day = this.mealPlan()?.days.find(d => d.date === date);
    return day ? day.meals : [];
  }

  // Get meals for a specific meal type across the currently viewed week
  getMealsByType(mealType: MealType): PlannedMeal[] {
    const plan = this.mealPlan();
    if (!plan) return [];
    return plan.days.flatMap(day => day.meals.filter(meal => meal.mealType === mealType));
  }

  // Get all recipes planned in the currently viewed week (used by "Generate Shopping List",
  // which is scoped to whichever week is on screen, not the whole history)
  getAllPlannedRecipes() {
    const plan = this.mealPlan();
    if (!plan) return [];
    const recipeIds = plan.days.flatMap(day => day.meals.map(meal => meal.recipeId));
    return this.recipeService.getRecipesByIds(recipeIds);
  }

  // Clear all meals for a day (in the currently viewed week)
  clearDay(date: string): void {
    this.updateActivePlan(plan => ({
      ...plan,
      days: plan.days.map(day =>
        day.date === date ? { ...day, meals: [] } : day
      ),
      updatedAt: new Date().toISOString()
    }));
  }

  // Erases the entire meal-plan history (every week, not just the current one). No UI calls
  // this - it's a full reset, not "start a new week" (use goToNextWeek() for that).
  clearMealPlan(): void {
    this.plansSignal.set([]);
    this.activeStartDateSignal.set(null);
    this.storageService.setMealPlan([]).subscribe();
  }

  // Get dates for the currently viewed week
  getWeekDates(): string[] {
    const plan = this.mealPlan();
    if (!plan) return [];
    return plan.days.map(day => day.date);
  }

  // Check if a recipe is planned in the currently viewed week
  isRecipePlanned(recipeId: string): boolean {
    const plan = this.mealPlan();
    if (!plan) return false;
    return plan.days.some(day => day.meals.some(meal => meal.recipeId === recipeId));
  }

  private updateActivePlan(updater: (plan: WeeklyPlan) => WeeklyPlan): void {
    const activeStart = this.activeStartDateSignal();
    if (activeStart === null) return;
    this.plansSignal.update(plans => plans.map(p => (p.startDate === activeStart ? updater(p) : p)));
    this.savePlans();
  }

  private savePlans(): void {
    this.storageService.setMealPlan(this.plansSignal()).subscribe();
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

  private mondayOf(date: Date): string {
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date);
    monday.setDate(diff);
    return monday.toISOString().split('T')[0];
  }
}
