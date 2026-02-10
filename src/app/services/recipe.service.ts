import { Injectable, signal, computed, inject } from '@angular/core';
import { Observable, of, combineLatest, map } from 'rxjs';
import { Recipe, RecipeFilter, SortOption, Ingredient } from '../models';
import { MOCK_RECIPES } from '../data/mock-recipes';
import { StorageService } from './storage.service';

@Injectable({
  providedIn: 'root'
})
export class RecipeService {
  private storageService = inject(StorageService);
  
  // Signals for state management
  private recipesSignal = signal<Recipe[]>(MOCK_RECIPES);
  private favoritesSignal = signal<string[]>([]);
  private ratingsSignal = signal<Record<string, number>>({});
  private filterSignal = signal<RecipeFilter>({
    searchQuery: '',
    categories: [],
    difficulties: [],
    dietaryRestrictions: [],
    maxCookTime: undefined,
    minRating: undefined,
    cuisineTypes: []
  });
  private sortOptionSignal = signal<SortOption>('newest');
  private viewModeSignal = signal<'grid' | 'list'>('grid');

  // Computed signals
  readonly recipes = this.recipesSignal.asReadonly();
  readonly favorites = this.favoritesSignal.asReadonly();
  readonly ratings = this.ratingsSignal.asReadonly();
  readonly filter = this.filterSignal.asReadonly();
  readonly sortOption = this.sortOptionSignal.asReadonly();
  readonly viewMode = this.viewModeSignal.asReadonly();

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
    this.loadUserData();
  }

  private loadUserData(): void {
    combineLatest([
      this.storageService.getFavorites(),
      this.storageService.getUserRatings()
    ]).subscribe(([favorites, ratings]) => {
      this.favoritesSignal.set(favorites || []);
      this.ratingsSignal.set(ratings || {});
    });
  }

  // Recipe CRUD operations
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
      cuisineTypes: []
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
