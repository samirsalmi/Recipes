import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './guards/auth.guard';

// Route table from docs/rework-plan.md section 3. Every route lazy-loads. Public: Discover,
// cuisine pages, recipe detail, cooking mode, credits (+ auth pages). Everything else needs
// an account (authGuard). Pages marked "phase 3" are minimal and get rebuilt next.
export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/discover/discover.component').then(m => m.DiscoverComponent), title: 'Mise' },
  { path: 'cuisines', loadComponent: () => import('./pages/cuisines/cuisines.component').then(m => m.CuisinesComponent), title: 'Mise - All cuisines' },
  { path: 'cuisines/:slug', loadComponent: () => import('./pages/cuisine/cuisine.component').then(m => m.CuisineComponent), title: 'Mise - Cuisine' },
  { path: 'recipes/new', loadComponent: () => import('./pages/recipe-editor/recipe-editor.component').then(m => m.RecipeEditorComponent), canActivate: [authGuard], title: 'Mise - Add a recipe' },
  { path: 'recipes/:id/edit', loadComponent: () => import('./pages/recipe-editor/recipe-editor.component').then(m => m.RecipeEditorComponent), canActivate: [authGuard], title: 'Mise - Edit recipe' },
  { path: 'recipes/:id', loadComponent: () => import('./pages/recipe-detail/recipe-detail.component').then(m => m.RecipeDetailComponent), title: 'Mise - Recipe' },
  { path: 'cook/:id', loadComponent: () => import('./pages/cook/cook.component').then(m => m.CookComponent), title: 'Mise - Cooking' },
  { path: 'plan', loadComponent: () => import('./pages/plan/plan.component').then(m => m.PlanComponent), canActivate: [authGuard], title: 'Mise - Plan' },
  { path: 'groceries', loadComponent: () => import('./pages/groceries/groceries.component').then(m => m.GroceriesComponent), canActivate: [authGuard], title: 'Mise - Groceries' },
  { path: 'cookbook', loadComponent: () => import('./pages/cookbook/cookbook.component').then(m => m.CookbookComponent), canActivate: [authGuard], title: 'Mise - Cookbook' },
  { path: 'household', loadComponent: () => import('./pages/household/household.component').then(m => m.HouseholdComponent), canActivate: [authGuard], title: 'Mise - Household' },
  { path: 'join/:code', loadComponent: () => import('./pages/join/join.component').then(m => m.JoinComponent), canActivate: [authGuard], title: 'Mise - Join a household' },
  { path: 'onboarding', loadComponent: () => import('./pages/onboarding/onboarding.component').then(m => m.OnboardingComponent), canActivate: [authGuard], title: 'Mise - Welcome' },
  { path: 'credits', loadComponent: () => import('./pages/credits/credits.component').then(m => m.CreditsComponent), title: 'Mise - Credits' },
  { path: 'login', loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent), canActivate: [guestGuard], title: 'Mise - Sign in' },
  { path: 'register', loadComponent: () => import('./pages/register/register.component').then(m => m.RegisterComponent), canActivate: [guestGuard], title: 'Mise - Create account' },
  // Old URLs from before the rework.
  { path: 'recipes', redirectTo: '', pathMatch: 'full' },
  { path: 'cooking/:id', redirectTo: 'cook/:id' },
  { path: 'meal-plan', redirectTo: 'plan' },
  { path: 'shopping-list', redirectTo: 'groceries' },
  { path: 'favorites', redirectTo: 'cookbook' },
  { path: 'my-recipes', redirectTo: 'cookbook' },
  { path: 'add-recipe', redirectTo: 'recipes/new' },
  { path: '**', redirectTo: '' },
];
