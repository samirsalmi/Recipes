import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent),
    title: 'Recipe Manager - Home'
  },
  {
    path: 'recipes',
    loadComponent: () => import('./pages/recipes/recipes.component').then(m => m.RecipesComponent),
    title: 'Recipe Manager - Recipes'
  },
  {
    path: 'recipes/:id',
    loadComponent: () => import('./pages/recipe-detail/recipe-detail.component').then(m => m.RecipeDetailComponent),
    title: 'Recipe Manager - Recipe Details'
  },
  {
    path: 'cooking/:id',
    loadComponent: () => import('./pages/cooking-mode/cooking-mode.component').then(m => m.CookingModeComponent),
    title: 'Recipe Manager - Cooking Mode'
  },
  {
    path: 'meal-plan',
    loadComponent: () => import('./pages/meal-plan/meal-plan.component').then(m => m.MealPlanComponent),
    title: 'Recipe Manager - Meal Plan'
  },
  {
    path: 'favorites',
    loadComponent: () => import('./pages/favorites/favorites.component').then(m => m.FavoritesComponent),
    title: 'Recipe Manager - Favorites'
  },
  {
    path: 'collections',
    loadComponent: () => import('./pages/collections/collections.component').then(m => m.CollectionsComponent),
    title: 'Recipe Manager - Collections'
  },
  {
    path: 'shopping-list',
    loadComponent: () => import('./pages/shopping-list/shopping-list.component').then(m => m.ShoppingListComponent),
    title: 'Recipe Manager - Shopping List'
  },
  {
    path: '**',
    redirectTo: '',
    pathMatch: 'full'
  }
];
