import { IngredientCategory } from './recipe.model';

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  category: IngredientCategory;
  checked: boolean;
  recipeIds: string[]; // which recipes this item is from
  notes?: string;
}

export interface ShoppingList {
  id: string;
  name: string;
  items: ShoppingItem[];
  createdAt: string;
  updatedAt: string;
  completed: boolean;
}

export interface ShoppingListGroup {
  category: IngredientCategory;
  items: ShoppingItem[];
}
