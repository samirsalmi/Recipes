import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, of, combineLatest, map, tap } from 'rxjs';
import { Recipe, RecipeCreateInput, RecipeFilter, RecipeUpdateInput, SortOption, Ingredient } from '../models';
import { StorageService } from './storage.service';
import { isAuthenticated } from './auth-state';

@Injectable({
  providedIn: 'root'
})
export class RecipeService {
  private storageService = inject(StorageService);
  private router = inject(Router);

  // Signals for state management
  private recipesSignal = signal<Recipe[]>([]);
  private favoritesSignal = signal<string[]>([]);
  private ratingsSignal = signal<Record<string, number>>({});
  private filterSignal = signal<RecipeFilter>({
    searchQuery: '',
    categories: [],
    difficulties: [],
    dietaryRestrictions: [],
    maxCookTime: undefined,
    minRating: undefined,
    cuisineTypes: [],
    originFilter: []
  });
  private sortOptionSignal = signal<SortOption>('newest');
  private viewModeSignal = signal<'grid' | 'list'>('grid');
  private recipesLoadedSignal = signal(false);
  private recentViewsSignal = signal<string[]>([]);

  // Computed signals
  readonly recipes = this.recipesSignal.asReadonly();
  readonly recipesLoaded = this.recipesLoadedSignal.asReadonly();
  readonly favorites = this.favoritesSignal.asReadonly();
  readonly ratings = this.ratingsSignal.asReadonly();
  readonly filter = this.filterSignal.asReadonly();
  readonly sortOption = this.sortOptionSignal.asReadonly();
  readonly viewMode = this.viewModeSignal.asReadonly();

  // Most-recent-first, dropping any id that no longer resolves in the discovery-backed
  // catalog (e.g. a recipe you viewed that later went private) - fine for a "nice to have"
  // feed, not worth a resolveRecipe() fallback per id here (see gotcha G11).
  readonly recentlyViewedRecipes = computed(() => {
    const all = this.recipesSignal();
    return this.recentViewsSignal()
      .map(id => all.find(r => r.id === id))
      .filter((r): r is Recipe => !!r);
  });

  // Filtered and sorted recipes
  readonly filteredRecipes = computed(() => {
    let recipes = [...this.recipesSignal()];
    const filter = this.filterSignal();
    const sortOption = this.sortOptionSignal();

    // Apply search filter
    if (filter.searchQuery) {
      const query = filter.searchQuery.toLowerCase();
      recipes = recipes.filter(recipe =>
        recipe.name.toLowerCase().includes(query) ||
        recipe.description.toLowerCase().includes(query) ||
        recipe.ingredients.some(ing => ing.name.toLowerCase().includes(query)) ||
        recipe.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }

    // Apply category filter
    if (filter.categories.length > 0) {
      recipes = recipes.filter(recipe => filter.categories.includes(recipe.category));
    }

    // Apply difficulty filter
    if (filter.difficulties.length > 0) {
      recipes = recipes.filter(recipe => filter.difficulties.includes(recipe.difficulty));
    }

    // Apply dietary restrictions filter
    if (filter.dietaryRestrictions.length > 0) {
      recipes = recipes.filter(recipe =>
        filter.dietaryRestrictions.some(restriction =>
          recipe.dietaryRestrictions.includes(restriction)
        )
      );
    }

    // Apply max cook time filter
    if (filter.maxCookTime !== undefined) {
      recipes = recipes.filter(recipe => recipe.totalTime <= filter.maxCookTime!);
    }

    // Apply min rating filter
    if (filter.minRating !== undefined) {
      recipes = recipes.filter(recipe => recipe.rating >= filter.minRating!);
    }

    // Apply cuisine type filter
    if (filter.cuisineTypes && filter.cuisineTypes.length > 0) {
      recipes = recipes.filter(recipe => filter.cuisineTypes!.includes(recipe.cuisineType));
    }

    // Apply official/community origin filter
    if (filter.originFilter && filter.originFilter.length > 0 && filter.originFilter.length < 2) {
      const wantOfficial = filter.originFilter.includes('official');
      recipes = recipes.filter(recipe => recipe.isOfficial === wantOfficial);
    }

    // Apply sorting
    switch (sortOption) {
      case 'alphabetical':
        recipes.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'cookingTime':
        recipes.sort((a, b) => a.totalTime - b.totalTime);
        break;
      case 'rating':
        recipes.sort((a, b) => b.rating - a.rating);
        break;
      case 'newest':
        recipes.sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());
        break;
      case 'oldest':
        recipes.sort((a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime());
        break;
    }

    return recipes;
  });

  readonly favoriteRecipes = computed(() => {
    return this.recipesSignal().filter(recipe => this.favoritesSignal().includes(recipe.id));
  });

  constructor() {
    this.loadRecipes();
    this.loadUserData();
  }

  private loadRecipes(): void {
    this.storageService.getRecipes().subscribe(recipes => {
      this.recipesSignal.set(recipes);
      this.recipesLoadedSignal.set(true);
    });
  }

  private loadUserData(): void {
    combineLatest([
      this.storageService.getFavorites(),
      this.storageService.getUserRatings(),
      this.storageService.getRecentViews()
    ]).subscribe(([favorites, ratings, recentViews]) => {
      this.favoritesSignal.set(favorites || []);
      this.ratingsSignal.set(ratings || {});
      this.recentViewsSignal.set(recentViews || []);
    });
  }

  // Recent views are account-linked (the storage endpoint requires a token), so skip silently
  // for guests rather than firing a write that would just fail (see gotcha G13).
  recordView(recipeId: string): void {
    if (!isAuthenticated()) return;
    const updated = [recipeId, ...this.recentViewsSignal().filter(id => id !== recipeId)].slice(0, 10);
    this.recentViewsSignal.set(updated);
    this.storageService.setRecentViews(updated).subscribe();
  }

  // Recipe CRUD operations
  createRecipe(recipe: RecipeCreateInput): Observable<Recipe> {
    return this.storageService.createRecipe(recipe).pipe(
      tap(newRecipe => this.recipesSignal.update(recipes => [...recipes, newRecipe]))
    );
  }

  updateRecipe(id: string, payload: RecipeUpdateInput): Observable<Recipe> {
    return this.storageService.updateRecipe(id, payload).pipe(
      tap(updated => this.mergeRecipe(updated))
    );
  }

  // recipesSignal only ever holds root recipes visible in discovery, so anything reached by
  // direct id - a private recipe you already favorited, a twist, someone's now-private
  // recipe you still have planned - needs this fallback (see frontend.md gotcha G11).
  resolveRecipe(id: string): Observable<Recipe | null> {
    const existing = this.getRecipeById(id);
    if (existing) return of(existing);
    return this.storageService.getRecipeById(id).pipe(
      tap(recipe => { if (recipe) this.mergeRecipe(recipe); })
    );
  }

  twistRecipe(id: string): Observable<Recipe> {
    return this.storageService.twistRecipe(id).pipe(
      tap(twist => this.mergeRecipe(twist))
    );
  }

  getTwists(id: string): Observable<Recipe[]> {
    return this.storageService.getTwists(id);
  }

  loadMyRecipes(): Observable<Recipe[]> {
    return this.storageService.getMyRecipes().pipe(
      tap(recipes => recipes.forEach(recipe => this.mergeRecipe(recipe)))
    );
  }

  setOfficial(id: string, isOfficial: boolean): Observable<Recipe> {
    return this.storageService.setRecipeOfficial(id, isOfficial).pipe(
      tap(updated => this.mergeRecipe(updated))
    );
  }

  deleteRecipe(id: string): Observable<void> {
    return this.storageService.deleteRecipe(id).pipe(
      tap(() => this.recipesSignal.update(recipes => recipes.filter(r => r.id !== id)))
    );
  }

  private mergeRecipe(recipe: Recipe): void {
    this.recipesSignal.update(recipes => {
      const index = recipes.findIndex(r => r.id === recipe.id);
      if (index === -1) return [...recipes, recipe];
      const copy = [...recipes];
      copy[index] = recipe;
      return copy;
    });
  }

  getRecipeById(id: string): Recipe | undefined {
    return this.recipesSignal().find(recipe => recipe.id === id);
  }

  getRecipesByIds(ids: string[]): Recipe[] {
    return this.recipesSignal().filter(recipe => ids.includes(recipe.id));
  }

  searchRecipes(query: string): Recipe[] {
    return this.recipesSignal().filter(recipe =>
      recipe.name.toLowerCase().includes(query.toLowerCase()) ||
      recipe.description.toLowerCase().includes(query.toLowerCase()) ||
      recipe.ingredients.some(ing => ing.name.toLowerCase().includes(query.toLowerCase()))
    );
  }

  // Filter operations
  updateFilter(filter: Partial<RecipeFilter>): void {
    this.filterSignal.update(current => ({ ...current, ...filter }));
  }

  resetFilter(): void {
    this.filterSignal.set({
      searchQuery: '',
      categories: [],
      difficulties: [],
      dietaryRestrictions: [],
      maxCookTime: undefined,
      minRating: undefined,
      cuisineTypes: [],
      originFilter: []
    });
  }

  // Sort operations
  setSortOption(option: SortOption): void {
    this.sortOptionSignal.set(option);
  }

  // View mode
  setViewMode(mode: 'grid' | 'list'): void {
    this.viewModeSignal.set(mode);
  }

  // Favorites operations
  toggleFavorite(recipeId: string): void {
    if (!isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }

    const currentFavorites = this.favoritesSignal();
    const newFavorites = currentFavorites.includes(recipeId)
      ? currentFavorites.filter(id => id !== recipeId)
      : [...currentFavorites, recipeId];
    
    this.favoritesSignal.set(newFavorites);
    this.storageService.setFavorites(newFavorites).subscribe();
  }

  isFavorite(recipeId: string): boolean {
    return this.favoritesSignal().includes(recipeId);
  }

  // Rating operations
  setRating(recipeId: string, rating: number): void {
    if (!isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }

    const currentRatings = this.ratingsSignal();
    const newRatings = { ...currentRatings, [recipeId]: rating };
    this.ratingsSignal.set(newRatings);
    this.storageService.setUserRatings(newRatings).subscribe();
  }

  getUserRating(recipeId: string): number | undefined {
    return this.ratingsSignal()[recipeId];
  }

  // Recipe scaling
  scaleRecipe(recipe: Recipe, servings: number): Recipe {
    const scaleFactor = servings / recipe.servings;
    
    return {
      ...recipe,
      servings,
      ingredients: recipe.ingredients.map(ing => ({
        ...ing,
        quantity: Math.round(ing.quantity * scaleFactor * 100) / 100
      })),
      nutrition: {
        ...recipe.nutrition,
        calories: Math.round(recipe.nutrition.calories * scaleFactor),
        protein: Math.round(recipe.nutrition.protein * scaleFactor * 10) / 10,
        carbs: Math.round(recipe.nutrition.carbs * scaleFactor * 10) / 10,
        fats: Math.round(recipe.nutrition.fats * scaleFactor * 10) / 10,
        fiber: recipe.nutrition.fiber ? Math.round(recipe.nutrition.fiber * scaleFactor * 10) / 10 : undefined,
        sugar: recipe.nutrition.sugar ? Math.round(recipe.nutrition.sugar * scaleFactor * 10) / 10 : undefined,
        sodium: recipe.nutrition.sodium ? Math.round(recipe.nutrition.sodium * scaleFactor) : undefined,
      }
    };
  }

  // Get unique values for filters
  getCategories(): string[] {
    return [...new Set(this.recipesSignal().map(r => r.category))];
  }

  getDifficulties(): string[] {
    return [...new Set(this.recipesSignal().map(r => r.difficulty))];
  }

  getDietaryRestrictions(): string[] {
    return [...new Set(this.recipesSignal().flatMap(r => r.dietaryRestrictions))];
  }

  getCuisineTypes(): string[] {
    return [...new Set(this.recipesSignal().map(r => r.cuisineType))];
  }

  // Get recipes by category
  getRecipesByCategory(category: string): Recipe[] {
    return this.recipesSignal().filter(r => r.category === category);
  }

  // Get recipes by cuisine
  getRecipesByCuisine(cuisine: string): Recipe[] {
    return this.recipesSignal().filter(r => r.cuisineType === cuisine);
  }

  // Get quick recipes (under 30 minutes)
  getQuickRecipes(): Recipe[] {
    return this.recipesSignal().filter(r => r.totalTime <= 30);
  }

  // Get easy recipes
  getEasyRecipes(): Recipe[] {
    return this.recipesSignal().filter(r => r.difficulty === 'Easy');
  }
}
