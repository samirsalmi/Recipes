import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent),
    canActivate: [guestGuard],
    title: 'Recipe Manager - Sign In'
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register.component').then(m => m.RegisterComponent),
    canActivate: [guestGuard],
    title: 'Recipe Manager - Create Account'
  },
  // Browsing is public: home, the recipe catalog, recipe detail, and cooking mode need no account.
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
    path: 'recipes/:id/edit',
    loadComponent: () => import('./pages/edit-recipe/edit-recipe.component').then(m => m.EditRecipeComponent),
    canActivate: [authGuard],
    title: 'Recipe Manager - Edit Recipe'
  },
  {
    path: 'cooking/:id',
    loadComponent: () => import('./pages/cooking-mode/cooking-mode.component').then(m => m.CookingModeComponent),
    title: 'Recipe Manager - Cooking Mode'
  },
  // Account-linked features: require login.
  {
    path: 'add-recipe',
    loadComponent: () => import('./pages/add-recipe/add-recipe.component').then(m => m.AddRecipeComponent),
    canActivate: [authGuard],
    title: 'Recipe Manager - Add Recipe'
  },
  {
    path: 'meal-plan',
    loadComponent: () => import('./pages/meal-plan/meal-plan.component').then(m => m.MealPlanComponent),
    canActivate: [authGuard],
    title: 'Recipe Manager - Meal Plan'
  },
  {
    path: 'favorites',
    loadComponent: () => import('./pages/favorites/favorites.component').then(m => m.FavoritesComponent),
    canActivate: [authGuard],
    title: 'Recipe Manager - Favorites'
  },
  {
    path: 'collections',
    loadComponent: () => import('./pages/collections/collections.component').then(m => m.CollectionsComponent),
    canActivate: [authGuard],
    title: 'Recipe Manager - Collections'
  },
  {
    path: 'shopping-list',
    loadComponent: () => import('./pages/shopping-list/shopping-list.component').then(m => m.ShoppingListComponent),
    canActivate: [authGuard],
    title: 'Recipe Manager - Shopping List'
  },
  {
    path: 'my-recipes',
    loadComponent: () => import('./pages/my-recipes/my-recipes.component').then(m => m.MyRecipesComponent),
    canActivate: [authGuard],
    title: 'Recipe Manager - My Recipes'
  },
  {
    path: '**',
    redirectTo: '',
    pathMatch: 'full'
  }
];
