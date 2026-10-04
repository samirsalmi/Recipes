import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MealPlanService, RecipeService, ShoppingListService } from '../../services';
import { MealType } from '../../models';

@Component({
  selector: 'app-meal-plan',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './meal-plan.component.html',
  styleUrls: ['./meal-plan.component.scss']
})
export class MealPlanComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private mealPlanService = inject(MealPlanService);
  private recipeService = inject(RecipeService);
  private shoppingListService = inject(ShoppingListService);

  mealPlan = this.mealPlanService.mealPlan;
  plansLoaded = this.mealPlanService.plansLoaded;
  recipes = this.recipeService.recipes;

  selectedDate = '';
  selectedMealType: MealType = 'Dinner';
  selectedRecipeId = '';
  selectedServings = 1;

  mealTypes: MealType[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

  ngOnInit(): void {
    // Check for addRecipe query param
    this.route.queryParams.subscribe(params => {
      if (params['addRecipe']) {
        this.selectedRecipeId = params['addRecipe'];
      }
    });

    // MealPlanService itself makes sure the current week's plan exists once it finishes
    // loading history from storage - no need to create one here.
  }

  previousWeek(): void {
    this.mealPlanService.goToPreviousWeek();
  }

  nextWeek(): void {
    this.mealPlanService.goToNextWeek();
  }

  goToThisWeek(): void {
    this.mealPlanService.goToCurrentWeek();
  }

  isCurrentWeek(): boolean {
    const plan = this.mealPlan();
    if (!plan) return false;
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today);
    monday.setDate(diff);
    return plan.startDate === monday.toISOString().split('T')[0];
  }

  formatWeekRange(): string {
    const plan = this.mealPlan();
    if (!plan) return '';
    const start = new Date(plan.startDate);
    const end = new Date(plan.endDate);
    const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startLabel} - ${endLabel}`;
  }

  getWeekDates(): string[] {
    return this.mealPlanService.getWeekDates();
  }

  getMealsForDate(date: string) {
    return this.mealPlanService.getMealsForDay(date);
  }

  getRecipeById(id: string) {
    return this.recipeService.getRecipeById(id);
  }

  addMeal(): void {
    if (this.selectedDate && this.selectedRecipeId) {
      this.mealPlanService.addMeal(
        this.selectedDate,
        this.selectedRecipeId,
        this.selectedMealType,
        this.selectedServings
      );
      this.selectedRecipeId = '';
      this.selectedServings = 1;
    }
  }

  removeMeal(mealId: string): void {
    this.mealPlanService.removeMeal(mealId);
  }

  generateShoppingList(): void {
    this.shoppingListService.generateFromMealPlan();
    this.router.navigate(['/shopping-list']);
  }

  clearDay(date: string): void {
    if (confirm('Clear all meals for this day?')) {
      this.mealPlanService.clearDay(date);
    }
  }

  getMealTypeColor(type: MealType): string {
    switch (type) {
      case 'Breakfast': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';
      case 'Lunch': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
      case 'Dinner': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
      case 'Snack': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
    }
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    const options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  }

  isToday(dateString: string): boolean {
    const today = new Date().toISOString().split('T')[0];
    return dateString === today;
  }
}
