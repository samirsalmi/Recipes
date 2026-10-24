import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, Subject, tap } from 'rxjs';
import { ActivityEvent, Household, HouseholdSettingsUpdate, InvitePreview } from '../models';
import { activityText } from '../i18n/activity';
import { I18nService } from '../i18n/i18n.service';
import { StorageService } from './storage.service';
import { ToastService } from './toast.service';
import { isAuthenticated, userSignal } from './auth-state';
import { todayIso } from '../utils/dates';

export const ACTIVITY_POLL_MS = 8000;
const FEED_SIZE = 50;

/** The caller's household (members, invite code, settings) and live updates: polls
 *  GET /api/household/activity?since=<cursor> every ~8 s while the tab is visible and
 *  immediately on focus/visibility, pauses while hidden. Other members' events are pushed
 *  on `remoteEvents$` (MealPlanService/GroceriesService refresh on them) and toasted. */
@Injectable({
  providedIn: 'root'
})
export class HouseholdService {
  private storage = inject(StorageService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private document = inject(DOCUMENT);

  private householdSignal = signal<Household | null>(null);
  private activitySignal = signal<ActivityEvent[]>([]);
  private cursor: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private remoteEventsSubject = new Subject<ActivityEvent[]>();

  readonly household = this.householdSignal.asReadonly();
  /** Most recent last; the Household page's activity feed. */
  readonly activity = this.activitySignal.asReadonly();
  readonly members = computed(() => this.householdSignal()?.members ?? []);
  readonly isOwner = computed(() => this.householdSignal()?.myRole === 'owner');
  /** Default servings for new plan entries. */
  readonly size = computed(() => this.householdSignal()?.size ?? 2);
  /** Batches of events made by *other* members since the last poll. */
  readonly remoteEvents$: Observable<ActivityEvent[]> = this.remoteEventsSubject.asObservable();

  private onVisible = () => {
    if (this.document.visibilityState === 'visible') this.pollNow();
  };

  constructor() {
    effect(() => {
      const authed = isAuthenticated();
      untracked(() => (authed ? this.start() : this.stop()));
    });
  }

  load(): void {
    this.storage.getHousehold().subscribe(h => this.householdSignal.set(h));
  }

  updateSettings(update: HouseholdSettingsUpdate): Observable<Household> {
    return this.storage.updateHousehold(update).pipe(tap(h => this.householdSignal.set(h)));
  }

  regenerateInviteCode(): Observable<Household> {
    return this.storage.regenerateInviteCode().pipe(tap(h => this.householdSignal.set(h)));
  }

  previewInvite(code: string): Observable<InvitePreview> {
    return this.storage.previewInvite(code);
  }

  join(code: string): Observable<Household> {
    return this.storage.joinHousehold(code, todayIso()).pipe(tap(h => this.switched(h)));
  }

  leave(): Observable<Household> {
    return this.storage.leaveHousehold().pipe(tap(h => this.switched(h)));
  }

  removeMember(userId: number): Observable<Household> {
    return this.storage.removeMember(userId).pipe(tap(h => this.householdSignal.set(h)));
  }

  /** Share link for the invite code (the /join/:code route). */
  inviteLink(): string {
    const code = this.householdSignal()?.inviteCode ?? '';
    return `${this.document.location.origin}/join/${code}`;
  }

  /** Poll immediately (also used after the user's own mutations if a page wants it). */
  pollNow(): void {
    if (this.polling || !isAuthenticated()) return;
    this.polling = true;
    this.storage.getActivity(this.cursor).subscribe({
      next: page => {
        this.polling = false;
        if (!page) return;
        const first = this.cursor === null;
        this.cursor = page.cursor;
        if (!page.events.length) return;
        this.activitySignal.update(list => [...list, ...page.events].slice(-FEED_SIZE));
        if (first) return; // initial page = history, not news
        const me = userSignal()?.id;
        const remote = page.events.filter(e => e.userId !== me);
        if (!remote.length) return;
        this.remoteEventsSubject.next(remote);
        if (remote.some(e => e.type.startsWith('household.'))) this.load();
        const last = remote[remote.length - 1];
        const extra = remote.length > 1 ? ` ${this.i18n.t('act.more', { count: remote.length - 1 })}` : '';
        this.toast.show(`${last.userName ?? this.i18n.t('common.someone')} ${activityText(last, this.i18n)}${extra}`, 'info', 4000);
      },
      error: () => (this.polling = false),
    });
  }

  private start(): void {
    this.load();
    this.cursor = null;
    this.activitySignal.set([]);
    this.pollNow();
    if (this.timer === null) {
      this.timer = setInterval(() => {
        if (this.document.visibilityState !== 'hidden') this.pollNow();
      }, ACTIVITY_POLL_MS);
      this.document.addEventListener('visibilitychange', this.onVisible);
      this.document.defaultView?.addEventListener('focus', this.onVisible);
    }
  }

  private stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.document.removeEventListener('visibilitychange', this.onVisible);
    this.document.defaultView?.removeEventListener('focus', this.onVisible);
    this.householdSignal.set(null);
    this.activitySignal.set([]);
    this.cursor = null;
  }

  /** After join/leave: a different household, so restart the feed from its history. */
  private switched(h: Household): void {
    this.householdSignal.set(h);
    this.cursor = null;
    this.activitySignal.set([]);
    this.pollNow();
    this.remoteEventsSubject.next([]); // let plan/groceries reload for the new household
  }
}
