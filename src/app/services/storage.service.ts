import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { Recipe, RecipeCreateInput, RecipeUpdateInput } from '../models';
import { environment } from '../../environments/environment';

const API_BASE = environment.apiBaseUrl;

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private http = inject(HttpClient);

  constructor() {}

  // Generic methods, backed by the FastAPI /api/storage/{key} endpoints
  get<T>(key: string): Observable<T | null> {
    return this.http.get<{ value: T | null }>(`${API_BASE}/storage/${key}`).pipe(
      map(res => res.value),
      catchError(error => {
        console.error(`Error reading from storage: ${key}`, error);
        return of(null);
      })
    );
  }

  set<T>(key: string, value: T): Observable<boolean> {
    return this.http.put(`${API_BASE}/storage/${key}`, { value }).pipe(
      map(() => true),
      catchError(error => {
        console.error(`Error writing to storage: ${key}`, error);
        return of(false);
      })
    );
  }

  remove(key: string): Observable<boolean> {
    return this.http.delete(`${API_BASE}/storage/${key}`).pipe(
      map(() => true),
      catchError(error => {
        console.error(`Error removing from storage: ${key}`, error);
        return of(false);
      })
    );
  }

  // Recipe catalog, backed by the FastAPI /api/recipes endpoints
  getRecipes(): Observable<Recipe[]> {
    return this.http.get<Recipe[]>(`${API_BASE}/recipes`).pipe(
      catchError(error => {
        console.error('Error fetching recipes', error);
        return of([]);
      })
    );
  }

  createRecipe(recipe: RecipeCreateInput): Observable<Recipe> {
    return this.http.post<Recipe>(`${API_BASE}/recipes`, recipe);
  }

  updateRecipe(id: string, payload: RecipeUpdateInput): Observable<Recipe> {
    return this.http.patch<Recipe>(`${API_BASE}/recipes/${id}`, payload);
  }

  deleteRecipe(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE}/recipes/${id}`);
  }

  // Resolves a recipe by id regardless of visibility ("unlisted", not deleted, once
  // private) - used to fall back for a recipe not in the discovery-backed catalog signal.
  getRecipeById(id: string): Observable<Recipe | null> {
    return this.http.get<Recipe>(`${API_BASE}/recipes/${id}`).pipe(
      catchError(() => of(null))
    );
  }

  getMyRecipes(): Observable<Recipe[]> {
    return this.http.get<Recipe[]>(`${API_BASE}/recipes/mine`).pipe(
      catchError(error => {
        console.error('Error fetching my recipes', error);
        return of([]);
      })
    );
  }

  twistRecipe(id: string): Observable<Recipe> {
    return this.http.post<Recipe>(`${API_BASE}/recipes/${id}/twist`, {});
  }

  getTwists(id: string): Observable<Recipe[]> {
    return this.http.get<Recipe[]>(`${API_BASE}/recipes/${id}/twists`).pipe(
      catchError(error => {
        console.error('Error fetching twists', error);
        return of([]);
      })
    );
  }

  setRecipeOfficial(id: string, isOfficial: boolean): Observable<Recipe> {
    return this.http.patch<Recipe>(`${API_BASE}/recipes/${id}/official`, { isOfficial });
  }

  // Uploads an image file (e.g. from the device camera) and returns its stored URL
  uploadImage(file: File): Observable<{ url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ url: string }>(`${API_BASE}/images`, formData);
  }

  // Specific methods for app data
  getFavorites(): Observable<string[]> {
    return this.get<string[]>('favorites') as Observable<string[]>;
  }

  setFavorites(favorites: string[]): Observable<boolean> {
    return this.set('favorites', favorites);
  }

  getUserRatings(): Observable<Record<string, number>> {
    return this.get<Record<string, number>>('ratings') as Observable<Record<string, number>>;
  }

  setUserRatings(ratings: Record<string, number>): Observable<boolean> {
    return this.set('ratings', ratings);
  }

  getCollections(): Observable<any[]> {
    return this.get<any[]>('collections') as Observable<any[]>;
  }

  setCollections(collections: any[]): Observable<boolean> {
    return this.set('collections', collections);
  }

  getMealPlan(): Observable<any> {
    return this.get<any>('mealPlan') as Observable<any>;
  }

  setMealPlan(mealPlan: any): Observable<boolean> {
    return this.set('mealPlan', mealPlan);
  }

  getShoppingList(): Observable<any> {
    return this.get<any>('shoppingList') as Observable<any>;
  }

  setShoppingList(shoppingList: any): Observable<boolean> {
    return this.set('shoppingList', shoppingList);
  }

  getRecipeNotes(recipeId: string): Observable<string> {
    return this.get<string>(`notes_${recipeId}`) as Observable<string>;
  }

  setRecipeNotes(recipeId: string, notes: string): Observable<boolean> {
    return this.set(`notes_${recipeId}`, notes);
  }

  getRecentViews(): Observable<string[]> {
    return this.get<string[]>('recentViews') as Observable<string[]>;
  }

  setRecentViews(views: string[]): Observable<boolean> {
    return this.set('recentViews', views);
  }

  getDarkMode(): Observable<boolean> {
    return this.get<boolean>('darkMode') as Observable<boolean>;
  }

  setDarkMode(enabled: boolean): Observable<boolean> {
    return this.set('darkMode', enabled);
  }
}
