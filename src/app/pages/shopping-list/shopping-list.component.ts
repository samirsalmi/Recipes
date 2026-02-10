import { Component, inject, OnInit, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ShoppingListService, RecipeService, MealPlanService } from '../../services';

@Component({
  selector: 'app-shopping-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './shopping-list.component.html',
  styleUrls: ['./shopping-list.component.scss']
})
export class ShoppingListComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private shoppingListService = inject(ShoppingListService);
  private recipeService = inject(RecipeService);
  private mealPlanService = inject(MealPlanService);

  shoppingList = this.shoppingListService.shoppingList;
  groupedItems = computed(() => this.shoppingListService.getGroupedItems());
  completionPercentage = computed(() => this.shoppingListService.getCompletionPercentage());

  ngOnInit(): void {
    // Check for addRecipe query param
    this.route.queryParams.subscribe(params => {
      if (params['addRecipe']) {
        this.shoppingListService.generateFromRecipes([params['addRecipe']]);
      }
    });

    // Initialize shopping list if not exists
    if (!this.shoppingListService.shoppingList()) {
      this.shoppingListService.createShoppingList();
    }
  }

  toggleItemChecked(itemId: string): void {
    this.shoppingListService.toggleItemChecked(itemId);
  }

  removeItem(itemId: string): void {
    this.shoppingListService.removeItem(itemId);
  }

  clearCheckedItems(): void {
    this.shoppingListService.clearCheckedItems();
  }

  clearAllItems(): void {
    if (confirm('Are you sure you want to clear all items?')) {
      this.shoppingListService.clearAllItems();
    }
  }

  markAllChecked(): void {
    this.shoppingListService.markAllChecked();
  }

  markAllUnchecked(): void {
    this.shoppingListService.markAllUnchecked();
  }

  generateFromMealPlan(): void {
    this.shoppingListService.generateFromMealPlan();
  }

  printList(): void {
    window.print();
  }

  navigateToRecipes(): void {
    this.router.navigate(['/recipes']);
  }

  navigateToMealPlan(): void {
    this.router.navigate(['/meal-plan']);
  }
}
