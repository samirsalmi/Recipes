import { Injectable, signal } from '@angular/core';
import { Observable, from, of } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private readonly PREFIX = 'recipe_manager_';

  constructor() {}

  // Generic methods
  get<T>(key: string): Observable<T | null> {
    try {
      const item = localStorage.getItem(this.PREFIX + key);
      return of(item ? JSON.parse(item) : null);
    } catch (error) {
      console.error(`Error reading from storage: ${key}`, error);
      return of(null);
    }
  }

  set<T>(key: string, value: T): Observable<boolean> {
    try {
      localStorage.setItem(this.PREFIX + key, JSON.stringify(value));
      return of(true);
    } catch (error) {
      console.error(`Error writing to storage: ${key}`, error);
      return of(false);
    }
  }

  remove(key: string): Observable<boolean> {
    try {
      localStorage.removeItem(this.PREFIX + key);
      return of(true);
    } catch (error) {
      console.error(`Error removing from storage: ${key}`, error);
      return of(false);
    }
  }

  clear(): Observable<boolean> {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(this.PREFIX)) {
          localStorage.removeItem(key);
        }
      });
      return of(true);
    } catch (error) {
      console.error('Error clearing storage', error);
      return of(false);
    }
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
