import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { FavoriteEntry } from '../models';
import { StorageService } from './storage.service';
import { isAuthenticated, userSignal } from './auth-state';
import { requireLogin } from './auth-redirect';

/** Favorites of the whole household (GET /api/favorites): yours drive the heart, the
 *  others' feed the planner's "Favorites (yours + household)" tab. */
@Injectable({
  providedIn: 'root'
})
export class FavoritesService {
  private storage = inject(StorageService);
  private router = inject(Router);

  private entriesSignal = signal<FavoriteEntry[]>([]);
  readonly entries = this.entriesSignal.asReadonly();

  readonly myFavoriteIds = computed(() => {
    const me = userSignal()?.id;
    return new Set(this.entriesSignal().filter(e => e.userId === me).map(e => e.recipeId));
  });

  /** recipeId -> names of the *other* household members who favorited it. */
  readonly householdFavorites = computed(() => {
    const me = userSignal()?.id;
    const out = new Map<string, string[]>();
    for (const e of this.entriesSignal()) {
      if (e.userId === me) continue;
      out.set(e.recipeId, [...(out.get(e.recipeId) ?? []), e.userName]);
    }
    return out;
  });

  constructor() {
    effect(() => {
      const authed = isAuthenticated();
      untracked(() => (authed ? this.load() : this.entriesSignal.set([])));
    });
  }

  load(): void {
    this.storage.getFavorites().subscribe(list => this.entriesSignal.set(list));
  }

  isFavorite(recipeId: string): boolean {
    return this.myFavoriteIds().has(recipeId);
  }

  /** Optimistic toggle; redirects guests to /login. */
  toggleFavorite(recipeId: string): void {
    if (!requireLogin(this.router)) return;
    const me = userSignal();
    if (!me) return;
    const before = this.entriesSignal();
    if (this.isFavorite(recipeId)) {
      this.entriesSignal.set(before.filter(e => !(e.userId === me.id && e.recipeId === recipeId)));
      this.storage.removeFavorite(recipeId).subscribe({ error: () => this.entriesSignal.set(before) });
    } else {
      this.entriesSignal.set([{ recipeId, userId: me.id, userName: me.name, createdAt: new Date().toISOString() }, ...before]);
      this.storage.addFavorite(recipeId).subscribe({ error: () => this.entriesSignal.set(before) });
    }
  }
}
