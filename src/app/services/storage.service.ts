import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import {
  ActivityPage,
  Aisle,
  IngredientAisleSaved,
  IngredientCheck,
  IngredientSuggestion,
  CookedStat,
  FavoriteEntry,
  FillSuggestion,
  GroceryList,
  Household,
  HouseholdSettingsUpdate,
  InvitePreview,
  PlanEntry,
  PlanEntryCreate,
  PlanEntryPatch,
  Recipe,
  RecipeCreateInput,
  RecipeDraft,
  RecipeUpdateInput,
  User,
} from '../models';
import { environment } from '../../environments/environment';

const API = environment.apiBaseUrl;

/** The app's only HTTP layer: every backend call goes through here and returns an
 *  Observable (domain services subscribe and keep the state in signals). Reads that a guest
 *  may legitimately hit (account-only data on public pages) resolve to null/[] on error
 *  instead of throwing (see frontend.md G13); writes surface their errors to the caller. */
@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private http = inject(HttpClient);

  // ---------- generic per-user key/value (/api/storage/{key}) ----------

  get<T>(key: string): Observable<T | null> {
    return this.http.get<{ value: T | null }>(`${API}/storage/${key}`).pipe(
      map(res => res.value),
      catchError(() => of(null))
    );
  }

  set<T>(key: string, value: T): Observable<boolean> {
    return this.http.put(`${API}/storage/${key}`, { value }).pipe(
      map(() => true),
      catchError(() => of(false))
    );
  }

  remove(key: string): Observable<boolean> {
    return this.http.delete(`${API}/storage/${key}`).pipe(
      map(() => true),
      catchError(() => of(false))
    );
  }

  getCollections(): Observable<any[] | null> {
    return this.get<any[]>('collections');
  }

  setCollections(collections: any[]): Observable<boolean> {
    return this.set('collections', collections);
  }

  getRecipeNotes(recipeId: string): Observable<string | null> {
    return this.get<string>(`notes_${recipeId}`);
  }

  setRecipeNotes(recipeId: string, notes: string): Observable<boolean> {
    return this.set(`notes_${recipeId}`, notes);
  }

  getRecentViews(): Observable<string[] | null> {
    return this.get<string[]>('recentViews');
  }

  setRecentViews(views: string[]): Observable<boolean> {
    return this.set('recentViews', views);
  }

  // ---------- recipes ----------

  getRecipes(): Observable<Recipe[]> {
    return this.http.get<Recipe[]>(`${API}/recipes`).pipe(catchError(() => of([])));
  }

  /** By id regardless of visibility; 404 -> null (see frontend.md G11). */
  getRecipeById(id: string): Observable<Recipe | null> {
    return this.http.get<Recipe>(`${API}/recipes/${id}`).pipe(catchError(() => of(null)));
  }

  getMyRecipes(): Observable<Recipe[]> {
    return this.http.get<Recipe[]>(`${API}/recipes/mine`).pipe(catchError(() => of([])));
  }

  createRecipe(recipe: RecipeCreateInput): Observable<Recipe> {
    return this.http.post<Recipe>(`${API}/recipes`, recipe);
  }

  updateRecipe(id: string, payload: RecipeUpdateInput): Observable<Recipe> {
    return this.http.patch<Recipe>(`${API}/recipes/${id}`, payload);
  }

  deleteRecipe(id: string): Observable<void> {
    return this.http.delete<void>(`${API}/recipes/${id}`);
  }

  /** "Copy to my recipes & edit" (a twist server-side). */
  copyRecipe(id: string): Observable<Recipe> {
    return this.http.post<Recipe>(`${API}/recipes/${id}/twist`, {});
  }

  importRecipeFromUrl(url: string): Observable<RecipeDraft> {
    return this.http.post<RecipeDraft>(`${API}/recipes/import-url`, { url });
  }

  /** Which typed ingredient names the dictionary does not know (any of English/French/Arabic).
   *  Errors resolve to [] so a failed check never blocks the form. */
  /** PATCH /auth/me: the account's own preferences (language, display name). */
  updateProfile(patch: { language?: string; name?: string }): Observable<User> {
    return this.http.patch<User>(`${API}/auth/me`, patch);
  }

  checkIngredients(names: string[]): Observable<IngredientCheck[]> {
    return this.http.post<{ items: IngredientCheck[] }>(`${API}/recipes/ingredient-check`, { names }).pipe(
      map(res => res.items),
      catchError(() => of([]))
    );
  }

  /** Type-ahead for the recipe form. Errors resolve to no suggestions; unsubscribing cancels the request. */
  suggestIngredients(q: string, lang: string, limit = 6): Observable<IngredientSuggestion[]> {
    const params = new HttpParams().set('q', q).set('lang', lang).set('limit', limit);
    return this.http.get<{ items: IngredientSuggestion[] }>(`${API}/recipes/ingredient-suggest`, { params }).pipe(
      map(res => res.items),
      catchError(() => of([]))
    );
  }

  /** Remember this household's aisle for an unknown ingredient name. */
  rememberIngredientAisle(name: string, aisle: Aisle): Observable<IngredientAisleSaved> {
    return this.http.put<IngredientAisleSaved>(`${API}/recipes/ingredient-aisles`, { name, aisle });
  }

  uploadImage(file: File): Observable<{ url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ url: string }>(`${API}/images`, formData);
  }

  // ---------- favorites ----------

  getFavorites(): Observable<FavoriteEntry[]> {
    return this.http.get<FavoriteEntry[]>(`${API}/favorites`).pipe(catchError(() => of([])));
  }

  addFavorite(recipeId: string): Observable<void> {
    return this.http.put<void>(`${API}/favorites/${recipeId}`, {});
  }

  removeFavorite(recipeId: string): Observable<void> {
    return this.http.delete<void>(`${API}/favorites/${recipeId}`);
  }

  // ---------- household ----------

  getHousehold(): Observable<Household | null> {
    return this.http.get<Household>(`${API}/household`).pipe(catchError(() => of(null)));
  }

  updateHousehold(update: HouseholdSettingsUpdate): Observable<Household> {
    return this.http.patch<Household>(`${API}/household`, update);
  }

  regenerateInviteCode(): Observable<Household> {
    return this.http.post<Household>(`${API}/household/invite-code`, {});
  }

  previewInvite(code: string): Observable<InvitePreview> {
    return this.http.get<InvitePreview>(`${API}/household/invite/${encodeURIComponent(code)}`);
  }

  joinHousehold(code: string, today: string): Observable<Household> {
    return this.http.post<Household>(`${API}/household/join`, { code, today });
  }

  leaveHousehold(): Observable<Household> {
    return this.http.post<Household>(`${API}/household/leave`, {});
  }

  removeMember(userId: number): Observable<Household> {
    return this.http.delete<Household>(`${API}/household/members/${userId}`);
  }

  getActivity(since: number | null): Observable<ActivityPage | null> {
    const params = since === null ? undefined : new HttpParams().set('since', since);
    return this.http.get<ActivityPage>(`${API}/household/activity`, { params }).pipe(catchError(() => of(null)));
  }

  // ---------- meal plan ----------

  getPlan(start: string, end: string): Observable<PlanEntry[] | null> {
    const params = new HttpParams().set('start', start).set('end', end);
    return this.http.get<PlanEntry[]>(`${API}/plan`, { params }).pipe(catchError(() => of(null)));
  }

  getCookedStats(before: string): Observable<CookedStat[]> {
    return this.http.get<CookedStat[]>(`${API}/plan/cooked`, { params: { before } }).pipe(catchError(() => of([])));
  }

  addPlanEntry(entry: PlanEntryCreate): Observable<PlanEntry> {
    return this.http.post<PlanEntry>(`${API}/plan`, entry);
  }

  updatePlanEntry(id: number, patch: PlanEntryPatch): Observable<PlanEntry> {
    return this.http.patch<PlanEntry>(`${API}/plan/${id}`, patch);
  }

  deletePlanEntry(id: number): Observable<void> {
    return this.http.delete<void>(`${API}/plan/${id}`);
  }

  copyWeek(fromStart: string, toStart: string): Observable<PlanEntry[]> {
    return this.http.post<PlanEntry[]>(`${API}/plan/copy-week`, { fromStart, toStart });
  }

  fillSuggestions(start: string, end: string, slot = 'dinner', budget: boolean | null = null, cuisines: readonly string[] = []): Observable<FillSuggestion[]> {
    return this.http.post<FillSuggestion[]>(`${API}/plan/fill-suggestions`, { start, end, slot, budget, ...(cuisines.length ? { cuisines } : {}) });
  }

  // ---------- groceries (every call returns the full recomputed list) ----------

  getGroceries(today: string): Observable<GroceryList | null> {
    return this.http.get<GroceryList>(`${API}/groceries`, { params: { today } }).pipe(catchError(() => of(null)));
  }

  setGroceryRange(start: string, end: string): Observable<GroceryList> {
    return this.http.put<GroceryList>(`${API}/groceries/range`, { start, end });
  }

  markGroceryItem(key: string, quantities?: Record<string, number | null>): Observable<GroceryList> {
    return this.http.post<GroceryList>(`${API}/groceries/mark`, { key, quantities: quantities ?? null });
  }

  unmarkGroceryItem(key: string): Observable<GroceryList> {
    return this.http.post<GroceryList>(`${API}/groceries/unmark`, { key });
  }

  setStaplePromoted(name: string, promoted: boolean): Observable<GroceryList> {
    return this.http.post<GroceryList>(`${API}/groceries/staples`, { name, promoted });
  }

  /** Add to / remove from the household staples (stored by canonical name). */
  setHouseholdStaple(name: string, staple: boolean, promoted?: boolean): Observable<GroceryList> {
    return this.http.post<GroceryList>(`${API}/groceries/household-staples`, { name, staple, promoted: promoted ?? null });
  }

  /** "I have N at home" for one item part; `quantity` null or 0 clears it. */
  setGroceryHave(key: string, quantity: number | null, unit: string | null): Observable<GroceryList> {
    return this.http.put<GroceryList>(`${API}/groceries/have`, { key, quantity, unit });
  }

  addGroceryExtra(name: string, quantity: string | null = null): Observable<GroceryList> {
    return this.http.post<GroceryList>(`${API}/groceries/extras`, { name, quantity });
  }

  updateGroceryExtra(id: number, patch: { name?: string; quantity?: string | null; checked?: boolean }): Observable<GroceryList> {
    return this.http.patch<GroceryList>(`${API}/groceries/extras/${id}`, patch);
  }

  deleteGroceryExtra(id: number): Observable<GroceryList> {
    return this.http.delete<GroceryList>(`${API}/groceries/extras/${id}`);
  }

  startNewShop(start: string, end: string): Observable<GroceryList> {
    return this.http.post<GroceryList>(`${API}/groceries/new-shop`, { start, end });
  }

  getGroceryShareText(): Observable<string> {
    return this.http.get<{ text: string }>(`${API}/groceries/share-text`).pipe(map(r => r.text));
  }

  markGroceriesSeen(): Observable<void> {
    return this.http.post<void>(`${API}/groceries/seen`, {}).pipe(catchError(() => of(undefined)));
  }
}
