import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, catchError, defer, tap, throwError } from 'rxjs';
import { AISLES, Aisle, AtHomeEntry, GroceryExtra, GroceryItem, GroceryList, OptionalExtra } from '../models';
import { I18nService } from '../i18n/i18n.service';
import { StorageService } from './storage.service';
import { HouseholdService } from './household.service';
import { isAuthenticated, userSignal } from './auth-state';
import { todayIso } from '../utils/dates';
import { applyHave, applyHouseholdStaple, applyStaple, toBase } from '../utils/grocery-have';

/** Items still to buy in an aisle: to-buy items plus unchecked extras (the "(n)" in the aisle heading). */
export function aisleRemaining(items: GroceryItem[], extras: GroceryExtra[]): number {
  return items.filter(i => i.state === 'to_buy').length + extras.filter(x => !x.checked).length;
}

function withProgress(list: GroceryList, items = list.items, extras = list.extras): GroceryList {
  const counted = items.filter(i => i.state !== 'no_longer_needed' && !i.staple);
  const done = counted.filter(i => i.state === 'in_cart' || i.state === 'covered').length
    + extras.filter(x => x.checked).length;
  return { ...list, items, extras, progress: { done, total: counted.length + extras.length } };
}

function applyItemState(list: GroceryList, key: string, state: GroceryItem['state']): GroceryList {
  const item = list.items.find(i => i.key === key);
  if (!item || item.state === state) return list;
  const items = list.items.map(i => i.key === key ? { ...i, state, isNew: false } : i);
  return withProgress(list, items);
}

export interface AisleGroup {
  aisle: Aisle;
  label: string;
  items: GroceryItem[];
  extras: GroceryExtra[];
  remaining: number;
}

/** The household's current shop. The list itself is computed server-side from the plan
 *  (backend/app/groceries.py); every mutation returns the whole recomputed list, which simply
 *  replaces the signal. Partner check-offs arrive via HouseholdService activity polling. */
@Injectable({
  providedIn: 'root'
})
export class GroceriesService {
  private storage = inject(StorageService);
  private household = inject(HouseholdService);
  private i18n = inject(I18nService);

  private listSignal = signal<GroceryList | null>(null);
  private busyKeysSignal = signal<Set<string>>(new Set());

  readonly list = this.listSignal.asReadonly();
  readonly loaded = computed(() => this.listSignal() !== null);
  private staleSignal = signal(false);
  /** True while the list shown is the last saved copy because the server could not be reached. */
  readonly stale = this.staleSignal.asReadonly();
  /** Item keys with a request in flight (for disabled checkboxes / spinners). */
  readonly busyKeys = this.busyKeysSignal.asReadonly();

  /** To-buy and in-cart items + unchecked/checked extras by aisle (fixed aisle order;
   *  in-cart sinks to the bottom of each aisle). Staples and "no longer needed" are separate. */
  readonly aisleGroups = computed<AisleGroup[]>(() => {
    const list = this.listSignal();
    if (!list) return [];
    return AISLES.map(({ id, label }) => {
      this.i18n.language(); // re-sort when the language changes
      const items = list.items
        .filter(i => i.aisle === id && !i.staple && i.state !== 'no_longer_needed')
        .sort((a, b) =>
          Number(a.state === 'in_cart' || a.state === 'covered') - Number(b.state === 'in_cart' || b.state === 'covered') ||
          this.i18n.ingredientName(a).localeCompare(this.i18n.ingredientName(b), this.i18n.language())
        );
      const extras = list.extras.filter(x => x.aisle === id).sort((a, b) => Number(a.checked) - Number(b.checked));
      return { aisle: id, label, items, extras, remaining: aisleRemaining(items, extras) };
    }).filter(g => g.items.length || g.extras.length);
  });

  /** "You probably have these" (collapsed). */
  readonly staples = computed(() => (this.listSignal()?.items ?? []).filter(i => i.staple && i.state !== 'no_longer_needed'));
  /** The pantry section: every staple the plan uses with its state (`have` / `need`), by name. */
  readonly pantry = computed(() => {
    this.i18n.language(); // re-sort when the language changes
    return (this.listSignal()?.items ?? [])
      .filter(i => !!i.pantryState && i.state !== 'no_longer_needed')
      .sort((a, b) => this.i18n.ingredientName(a).localeCompare(this.i18n.ingredientName(b), this.i18n.language()));
  });
  /** Amounts at home that match nothing the plan needs right now. */
  readonly atHome = computed<AtHomeEntry[]>(() => this.listSignal()?.atHome ?? []);
  /** "No longer needed - already bought". */
  readonly noLongerNeeded = computed(() => (this.listSignal()?.items ?? []).filter(i => i.state === 'no_longer_needed'));
  readonly optionalExtras = computed<OptionalExtra[]>(() => this.listSignal()?.optionalExtras ?? []);
  readonly progress = computed(() => this.listSignal()?.progress ?? { done: 0, total: 0 });
  readonly newCount = computed(() => (this.listSignal()?.items ?? []).filter(i => i.isNew).length);

  constructor() {
    effect(() => {
      const authed = isAuthenticated();
      untracked(() => {
        if (authed) {
          this.restoreCache();
          this.load();
        } else {
          this.listSignal.set(null);
          this.staleSignal.set(false);
          this.clearCache();
        }
      });
    });
    this.household.remoteEvents$.subscribe(events => {
      if (!events.length || events.some(e => /^(plan|groceries|household)\./.test(e.type))) this.load();
    });
  }

  load(): void {
    if (!isAuthenticated()) return;
    this.storage.getGroceries(todayIso()).subscribe(list => {
      if (list) {
        this.listSignal.set(list);
        this.staleSignal.set(false);
        this.saveCache(list);
      } else if (this.listSignal()) {
        this.staleSignal.set(true);
      }
    });
  }

  // Offline grocery list: the last server copy is kept per user so the list still opens in the
  // shop without signal. It is read-only data; check-offs need the server.
  private cacheKey(): string | null {
    const user = userSignal();
    return user ? `mise_groceries_${user.id}` : null;
  }

  private saveCache(list: GroceryList): void {
    const key = this.cacheKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch {
      // storage full or unavailable: the list just won't be available offline
    }
  }

  private restoreCache(): void {
    const key = this.cacheKey();
    if (!key || this.listSignal()) return;
    try {
      const raw = localStorage.getItem(key);
      if (raw) this.listSignal.set(JSON.parse(raw) as GroceryList);
    } catch {
      // corrupt cache: ignore
    }
  }

  private clearCache(): void {
    try {
      Object.keys(localStorage).filter(k => k.startsWith('mise_groceries_')).forEach(k => localStorage.removeItem(k));
    } catch {
      // ignore
    }
  }

  /** Check an item off (all parts at their current needed amounts), or uncheck it. */
  toggle(item: GroceryItem): Observable<GroceryList> {
    return item.state === 'to_buy' ? this.mark(item.key) : this.unmark(item.key);
  }

  /** Mark bought; `quantities` maps part key -> base-unit amount (partial purchase). */
  mark(key: string, quantities?: Record<string, number | null>): Observable<GroceryList> {
    return this.optimistic(key, list => applyItemState(list, key, 'in_cart'), () => this.storage.markGroceryItem(key, quantities), true);
  }

  /** Uncheck, or dismiss a "no longer needed" item. */
  unmark(key: string): Observable<GroceryList> {
    return this.optimistic(key, list => {
      const item = list.items.find(i => i.key === key);
      if (item?.state === 'no_longer_needed') return withProgress(list, list.items.filter(i => i.key !== key));
      const covered = !!item && item.parts.length > 0 && item.parts.every(p => p.needed !== null && (p.have ?? 0) >= p.needed);
      return applyItemState(list, key, covered ? 'covered' : 'to_buy');
    }, () => this.storage.unmarkGroceryItem(key), true);
  }

  /** "I need it" on a pantry staple, or "I have it" to put it back (any time). Optimistic,
   *  rolled back if the server refuses. */
  setStaplePromoted(name: string, promoted: boolean): Observable<GroceryList> {
    return this.optimistic(name, list => applyStaple(list, name, promoted), () => this.storage.setStaplePromoted(name, promoted), true);
  }

  /** "Add to staples" / "Remove from staples" on a grocery row: the item joins (or leaves) the
   *  household's staples. Optimistic, rolled back on error; `promoted` only matters when adding
   *  (false = tuck it into the pantry, used by Undo of a removal). Refreshes the household so
   *  the staples editor and other screens agree. */
  setHouseholdStaple(name: string, staple: boolean, promoted?: boolean): Observable<GroceryList> {
    return this.optimistic(name, list => applyHouseholdStaple(list, name, staple, promoted), () => this.storage.setHouseholdStaple(name, staple, promoted), true).pipe(
      tap(() => this.household.load()),
    );
  }

  /** "I have N at home" for one item part (`partKey` = "<canonical>|<family>"): `quantity` is in
   *  `unit` (null unit: the part's count / base unit); null or 0 clears it. Optimistic, rolled
   *  back on error; overlapping edits of the same part resolve to the latest one. */
  setHave(partKey: string, quantity: number | null, unit: string | null = null): Observable<GroceryList> {
    const base = quantity === null || quantity <= 0 ? null : toBase(quantity, unit);
    return this.optimistic(partKey, list => applyHave(list, partKey, base), () => this.storage.setGroceryHave(partKey, quantity, unit), false);
  }

  addExtra(name: string, quantity: string | null = null): Observable<GroceryList> {
    return this.apply(this.storage.addGroceryExtra(name, quantity));
  }

  /** One tap: an optional ingredient of a planned recipe becomes a manual extra. */
  addOptionalExtra(extra: OptionalExtra): Observable<GroceryList> {
    return this.addExtra(extra.name, extra.amount || null);
  }

  toggleExtra(extra: GroceryExtra): Observable<GroceryList> {
    const checked = !extra.checked;
    return this.optimistic(
      `extra:${extra.id}`,
      list => withProgress(list, list.items, list.extras.map(x => x.id === extra.id ? { ...x, checked } : x)),
      () => this.storage.updateGroceryExtra(extra.id, { checked }),
      true,
    );
  }

  updateExtra(id: number, patch: { name?: string; quantity?: string | null }): Observable<GroceryList> {
    return this.optimistic(
      `extra:${id}`,
      list => withProgress(list, list.items, list.extras.map(x => x.id === id ? { ...x, ...patch } : x)),
      () => this.storage.updateGroceryExtra(id, patch),
      true,
    );
  }

  removeExtra(id: number): Observable<GroceryList> {
    return this.optimistic(
      `extra:${id}`,
      list => withProgress(list, list.items, list.extras.filter(x => x.id !== id)),
      () => this.storage.deleteGroceryExtra(id),
      true,
    );
  }

  setRange(start: string, end: string): Observable<GroceryList> {
    return this.apply(this.storage.setGroceryRange(start, end));
  }

  /** Close the current trip and open a fresh one. */
  startNewShop(start: string, end: string): Observable<GroceryList> {
    return this.apply(this.storage.startNewShop(start, end));
  }

  shareText(): Observable<string> {
    return this.storage.getGroceryShareText();
  }

  /** Clears this user's "new" dots (call when the list has been seen). */
  markSeen(): void {
    this.storage.markGroceriesSeen().subscribe();
  }

  private readonly sequence = new Map<string, number>();

  private optimistic(
    key: string,
    predict: (list: GroceryList) => GroceryList,
    request: () => Observable<GroceryList>,
    busy: boolean,
  ): Observable<GroceryList> {
    return defer(() => {
      const seq = (this.sequence.get(key) ?? 0) + 1;
      this.sequence.set(key, seq);
      const before = this.listSignal();
      let guess: GroceryList | null = null;
      if (before) {
        guess = predict(before);
        if (guess !== before) this.listSignal.set(guess);
      }
      if (busy) this.busyKeysSignal.update(s => new Set(s).add(key));
      const latest = () => this.sequence.get(key) === seq;
      const request$ = request().pipe(
        tap(list => {
          if (latest()) this.accept(list); // a newer edit of the same part will bring the newest list
        }),
        catchError(error => {
          if (latest()) {
            // Put the old list back; if something else changed it meanwhile, reload instead.
            if (before && this.listSignal() === guess) this.listSignal.set(before);
            else this.load();
          }
          return throwError(() => error);
        }),
      );
      return busy
        ? request$.pipe(tap({ finalize: () => this.busyKeysSignal.update(s => { const n = new Set(s); n.delete(key); return n; }) }))
        : request$;
    });
  }

  private accept(list: GroceryList): void {
    this.listSignal.set(list);
    this.staleSignal.set(false);
    this.saveCache(list);
  }

  private apply(request: Observable<GroceryList>): Observable<GroceryList> {
    return request.pipe(tap(list => this.accept(list)));
  }
}
