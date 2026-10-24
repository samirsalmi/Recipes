import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { EMPTY, Observable, forkJoin, of, tap } from 'rxjs';
import { emptySlotDates } from '../utils/fill-cuisines';
import { CookedStat, FillSuggestion, PLAN_SLOTS, PlanEntry, PlanEntryCreate, PlanSlot, RecipeSummary } from '../models';
import { StorageService } from './storage.service';
import { HouseholdService } from './household.service';
import { isAuthenticated } from './auth-state';
import { requireLogin } from './auth-redirect';
import { addDays, startOfWeek, todayIso, weekDates } from '../utils/dates';

export interface PlanDay {
  date: string;
  isToday: boolean;
  slots: { slot: PlanSlot; entries: PlanEntry[] }[];
}

/** The household's shared plan for the visible week. Entries are server rows (ids assigned
 *  server-side); other members' changes arrive via HouseholdService activity polling. */
@Injectable({
  providedIn: 'root'
})
export class MealPlanService {
  private storage = inject(StorageService);
  private household = inject(HouseholdService);
  private router = inject(Router);

  private weekStartSignal = signal(startOfWeek(todayIso()));
  private entriesSignal = signal<PlanEntry[]>([]);
  private loadedSignal = signal(false);
  private cookedSignal = signal<CookedStat[]>([]);

  /** Monday of the visible week (YYYY-MM-DD). */
  readonly weekStart = this.weekStartSignal.asReadonly();
  readonly weekEnd = computed(() => addDays(this.weekStartSignal(), 6));
  readonly entries = this.entriesSignal.asReadonly();
  readonly loaded = this.loadedSignal.asReadonly();
  readonly cooked = this.cookedSignal.asReadonly();

  readonly days = computed<PlanDay[]>(() => {
    const today = todayIso();
    const entries = this.entriesSignal();
    return weekDates(this.weekStartSignal()).map(date => ({
      date,
      isToday: date === today,
      slots: PLAN_SLOTS.map(slot => ({
        slot,
        entries: entries.filter(e => e.date === date && e.slot === slot).sort((a, b) => a.position - b.position || a.id - b.id),
      })),
    }));
  });

  /** Today's entries (Discover's "Tonight" card). */
  readonly todayEntries = computed(() => this.entriesSignal().filter(e => e.date === todayIso()));

  /** recipeId -> times cooked (past plan entries of the household). */
  readonly cookedCounts = computed(() => new Map(this.cookedSignal().map(c => [c.recipeId, c.count])));

  constructor() {
    effect(() => {
      const authed = isAuthenticated();
      untracked(() => {
        if (authed) {
          this.load();
          this.loadCooked();
        } else {
          this.entriesSignal.set([]);
          this.cookedSignal.set([]);
          this.loadedSignal.set(false);
        }
      });
    });
    this.household.remoteEvents$.subscribe(events => {
      if (!events.length || events.some(e => e.type.startsWith('plan.') || e.type.startsWith('household.'))) this.load();
    });
  }

  load(): void {
    if (!isAuthenticated()) return;
    const start = this.weekStartSignal();
    this.storage.getPlan(start, addDays(start, 6)).subscribe(entries => {
      if (start !== this.weekStartSignal()) return; // user already moved on
      this.entriesSignal.set(entries ?? []);
      this.loadedSignal.set(true);
    });
  }

  loadCooked(): void {
    this.storage.getCookedStats(todayIso()).subscribe(stats => this.cookedSignal.set(stats));
  }

  goToWeek(dateInWeek: string): void {
    this.weekStartSignal.set(startOfWeek(dateInWeek));
    this.loadedSignal.set(false);
    this.load();
  }

  nextWeek(): void {
    this.goToWeek(addDays(this.weekStartSignal(), 7));
  }

  previousWeek(): void {
    this.goToWeek(addDays(this.weekStartSignal(), -7));
  }

  thisWeek(): void {
    this.goToWeek(todayIso());
  }

  /** Default servings = household size. Redirects guests to /login. The row appears at once
   *  (negative temporary id) and is swapped for the server row when it lands. */
  addEntry(entry: PlanEntryCreate): Observable<PlanEntry> {
    if (!requireLogin(this.router)) return EMPTY;
    const temporary: PlanEntry = {
      id: -Date.now(),
      date: entry.date,
      slot: entry.slot,
      position: this.nextPosition(entry.date, entry.slot),
      recipeId: entry.recipeId ?? null,
      recipe: entry.recipe ?? null,
      customTitle: entry.customTitle ?? null,
      servings: entry.servings ?? this.household.size(),
      addedBy: null,
      addedByName: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.entriesSignal.update(list => [...list, temporary]);
    return this.storage.addPlanEntry(entry).pipe(
      tap({
        next: created => {
          this.entriesSignal.update(list => [...list.filter(e => e.id !== temporary.id), created]);
        },
        error: () => this.entriesSignal.update(list => list.filter(e => e.id !== temporary.id)),
      })
    );
  }

  moveEntry(id: number, date: string, slot: PlanSlot, servings?: number): Observable<PlanEntry> {
    return this.patch(id, { date, slot, ...(servings === undefined ? {} : { servings }) }, { position: this.nextPosition(date, slot) });
  }

  setServings(id: number, servings: number): Observable<PlanEntry> {
    return this.patch(id, { servings });
  }

  swapRecipe(id: number, recipeId: string, recipe?: RecipeSummary | null): Observable<PlanEntry> {
    return this.patch(id, { recipeId }, { recipe: recipe ?? null });
  }

  /** Optimistic: the entry disappears at once and comes back if the server refuses. */
  removeEntry(id: number): Observable<void> {
    const before = this.entriesSignal();
    this.entriesSignal.set(before.filter(e => e.id !== id));
    return this.storage.deletePlanEntry(id).pipe(
      tap({ error: () => this.entriesSignal.set(before) })
    );
  }

  copyLastWeek(): Observable<PlanEntry[]> {
    const start = this.weekStartSignal();
    return this.storage.copyWeek(addDays(start, -7), start).pipe(tap(() => this.load()));
  }

  /** Proposals for empty dinners of the visible week (from today on); nothing is saved. */
  fillSuggestions(budget: boolean | null = null, slot: PlanSlot = 'dinner', cuisines: readonly string[] = []): Observable<FillSuggestion[]> {
    const { start, end } = this.fillRange();
    if (start > end) return of([]);
    return this.storage.fillSuggestions(start, end, slot, budget, cuisines);
  }

  /** The days "fill" works on: the visible week, from today on. */
  fillRange(): { start: string; end: string } {
    const today = todayIso();
    return { start: this.weekStartSignal() > today ? this.weekStartSignal() : today, end: this.weekEnd() };
  }

  /** Days in the fill range with nothing planned in `slot` (what a fill could at most cover). */
  emptyFillDates(slot: PlanSlot = 'dinner'): string[] {
    const { start, end } = this.fillRange();
    return start > end ? [] : emptySlotDates(start, end, this.entriesSignal(), slot);
  }

  /** Save the proposals the user kept. */
  confirmSuggestions(kept: FillSuggestion[]): Observable<PlanEntry[]> {
    if (!kept.length) return of([]);
    return forkJoin(
      kept.map(s => this.storage.addPlanEntry({ date: s.date, slot: s.slot, recipeId: s.recipeId, servings: s.servings }))
    ).pipe(tap(created => created.forEach(e => this.upsert(e))));
  }

  /** How many times the household planned a recipe in the past ("Cooked 3x"). */
  timesCooked(recipeId: string): number {
    return this.cookedCounts().get(recipeId) ?? 0;
  }

  /** Optimistic patch: the row changes at once and reverts if the server refuses. */
  private patch(
    id: number,
    patch: Parameters<StorageService['updatePlanEntry']>[1],
    local: Partial<PlanEntry> = {},
  ): Observable<PlanEntry> {
    const before = this.entriesSignal();
    this.entriesSignal.update(list => list.map(e => e.id === id ? { ...e, ...patch, ...local } : e));
    return this.storage.updatePlanEntry(id, patch).pipe(
      tap({
        next: updated => this.upsert(updated),
        error: () => this.entriesSignal.set(before),
      })
    );
  }

  private nextPosition(date: string, slot: PlanSlot): number {
    const positions = this.entriesSignal()
      .filter(e => e.date === date && e.slot === slot)
      .map(e => e.position);
    return (positions.length ? Math.max(...positions) : 0) + 1;
  }

  private upsert(entry: PlanEntry): void {
    const start = this.weekStartSignal();
    const inWeek = entry.date >= start && entry.date <= addDays(start, 6);
    this.entriesSignal.update(list => {
      const others = list.filter(e => e.id !== entry.id);
      return inWeek ? [...others, entry] : others;
    });
  }
}
