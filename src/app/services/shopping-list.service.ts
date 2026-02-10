import { Injectable, signal, computed, inject } from '@angular/core';
import { ShoppingList, ShoppingItem, ShoppingListGroup, IngredientCategory, Ingredient } from '../models';
import { StorageService } from './storage.service';
import { RecipeService } from './recipe.service';
import { MealPlanService } from './meal-plan.service';

@Injectable({
  providedIn: 'root'
})
export class ShoppingListService {
  private storageService = inject(StorageService);
  private recipeService = inject(RecipeService);
  private mealPlanService = inject(MealPlanService);

  private shoppingListSignal = signal<ShoppingList | null>(null);

  readonly shoppingList = this.shoppingListSignal.asReadonly();

  constructor() {
    this.loadShoppingList();
  }

  private loadShoppingList(): void {
    this.storageService.getShoppingList().subscribe(list => {
      this.shoppingListSignal.set(list);
    });
  }

  // Create a new shopping list
  createShoppingList(name: string = 'Shopping List'): ShoppingList {
    const newList: ShoppingList = {
      id: this.generateId(),
      name,
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completed: false
    };

    this.shoppingListSignal.set(newList);
    this.saveShoppingList();
    return newList;
  }

  // Generate shopping list from recipes
  generateFromRecipes(recipeIds: string[], servingsMap?: Record<string, number>): void {
    const recipes = this.recipeService.getRecipesByIds(recipeIds);
    const itemsMap = new Map<string, ShoppingItem>();

    recipes.forEach(recipe => {
      const servings = servingsMap?.[recipe.id] || recipe.servings;
      const scaleFactor = servings / recipe.servings;

      recipe.ingredients.forEach(ingredient => {
        const key = `${ingredient.name.toLowerCase()}_${ingredient.category}`;
        const existingItem = itemsMap.get(key);

        if (existingItem) {
          // Combine quantities if same ingredient
          existingItem.quantity = Math.round((existingItem.quantity + ingredient.quantity * scaleFactor) * 100) / 100;
          if (!existingItem.recipeIds.includes(recipe.id)) {
            existingItem.recipeIds.push(recipe.id);
          }
        } else {
          itemsMap.set(key, {
            id: this.generateId(),
            name: ingredient.name,
            quantity: Math.round(ingredient.quantity * scaleFactor * 100) / 100,
            unit: ingredient.unit,
            category: ingredient.category,
            checked: false,
            recipeIds: [recipe.id]
          });
        }
      });
    });

    const items = Array.from(itemsMap.values());
    this.createShoppingList('Generated Shopping List');
    this.shoppingListSignal.update(list => list ? { ...list, items } : null);
    this.saveShoppingList();
  }

  // Generate shopping list from meal plan
  generateFromMealPlan(): void {
    const plannedRecipes = this.mealPlanService.getAllPlannedRecipes();
    const recipeIds = plannedRecipes.map(r => r.id);
    
    // Get servings from meal plan
    const plan = this.mealPlanService.mealPlan();
    const servingsMap: Record<string, number> = {};
    
    if (plan) {
      plan.days.forEach(day => {
        day.meals.forEach(meal => {
          if (!servingsMap[meal.recipeId]) {
            servingsMap[meal.recipeId] = 0;
          }
          servingsMap[meal.recipeId] += meal.servings;
        });
      });
    }

    this.generateFromRecipes(recipeIds, servingsMap);
  }

  // Add item to shopping list
  addItem(item: Omit<ShoppingItem, 'id' | 'checked'>): void {
    const currentList = this.shoppingListSignal();
    if (!currentList) {
      this.createShoppingList();
    }

    this.shoppingListSignal.update(list => {
      if (!list) return list;
      return {
        ...list,
        items: [...list.items, { ...item, id: this.generateId(), checked: false }],
        updatedAt: new Date().toISOString()
      };
    });

    this.saveShoppingList();
  }

  // Remove item from shopping list
  removeItem(itemId: string): void {
    const currentList = this.shoppingListSignal();
    if (!currentList) return;

    this.shoppingListSignal.update(list => {
      if (!list) return list;
      return {
        ...list,
        items: list.items.filter(item => item.id !== itemId),
        updatedAt: new Date().toISOString()
      };
    });

    this.saveShoppingList();
  }

  // Toggle item checked status
  toggleItemChecked(itemId: string): void {
    const currentList = this.shoppingListSignal();
    if (!currentList) return;

    this.shoppingListSignal.update(list => {
      if (!list) return list;
      return {
        ...list,
        items: list.items.map(item =>
          item.id === itemId ? { ...item, checked: !item.checked } : item
        ),
        updatedAt: new Date().toISOString()
      };
    });

    this.saveShoppingList();
  }

  // Update item
  updateItem(itemId: string, updates: Partial<ShoppingItem>): void {
    const currentList = this.shoppingListSignal();
    if (!currentList) return;

    this.shoppingListSignal.update(list => {
      if (!list) return list;
      return {
        ...list,
        items: list.items.map(item =>
          item.id === itemId ? { ...item, ...updates } : item
        ),
        updatedAt: new Date().toISOString()
      };
    });

    this.saveShoppingList();
  }

  // Clear checked items
  clearCheckedItems(): void {
    const currentList = this.shoppingListSignal();
    if (!currentList) return;

    this.shoppingListSignal.update(list => {
      if (!list) return list;
      return {
        ...list,
        items: list.items.filter(item => !item.checked),
        updatedAt: new Date().toISOString()
      };
    });

    this.saveShoppingList();
  }

  // Clear all items
  clearAllItems(): void {
    const currentList = this.shoppingListSignal();
    if (!currentList) return;

    this.shoppingListSignal.update(list => {
      if (!list) return list;
      return {
        ...list,
        items: [],
        updatedAt: new Date().toISOString()
      };
    });

    this.saveShoppingList();
  }

  // Get grouped items by category
  getGroupedItems(): ShoppingListGroup[] {
    const currentList = this.shoppingListSignal();
    if (!currentList) return [];

    const categoryOrder: IngredientCategory[] = [
      'Produce',
      'Dairy',
      'Meat',
      'Seafood',
      'Pantry',
      'Bakery',
      'Frozen',
      'Beverages',
      'Spices',
      'Other'
    ];

    const grouped = new Map<IngredientCategory, ShoppingItem[]>();

    currentList.items.forEach(item => {
      if (!grouped.has(item.category)) {
        grouped.set(item.category, []);
      }
      grouped.get(item.category)!.push(item);
    });

    return categoryOrder
      .filter(category => grouped.has(category))
      .map(category => ({
        category,
        items: grouped.get(category)!
      }));
  }

  // Get unchecked items
  getUncheckedItems(): ShoppingItem[] {
    const currentList = this.shoppingListSignal();
    if (!currentList) return [];
    return currentList.items.filter(item => !item.checked);
  }

  // Get checked items
  getCheckedItems(): ShoppingItem[] {
    const currentList = this.shoppingListSignal();
    if (!currentList) return [];
    return currentList.items.filter(item => item.checked);
  }

  // Get completion percentage
  getCompletionPercentage(): number {
    const currentList = this.shoppingListSignal();
    if (!currentList || currentList.items.length === 0) return 0;
    const checkedCount = currentList.items.filter(item => item.checked).length;
    return Math.round((checkedCount / currentList.items.length) * 100);
  }

  // Mark all as checked
  markAllChecked(): void {
    const currentList = this.shoppingListSignal();
    if (!currentList) return;

    this.shoppingListSignal.update(list => {
      if (!list) return list;
      return {
        ...list,
        items: list.items.map(item => ({ ...item, checked: true })),
        completed: true,
        updatedAt: new Date().toISOString()
      };
    });

    this.saveShoppingList();
  }

  // Mark all as unchecked
  markAllUnchecked(): void {
    const currentList = this.shoppingListSignal();
    if (!currentList) return;

    this.shoppingListSignal.update(list => {
      if (!list) return list;
      return {
        ...list,
        items: list.items.map(item => ({ ...item, checked: false })),
        completed: false,
        updatedAt: new Date().toISOString()
      };
    });

    this.saveShoppingList();
  }

  private saveShoppingList(): void {
    this.storageService.setShoppingList(this.shoppingListSignal()).subscribe();
  }

  private generateId(): string {
    return `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
