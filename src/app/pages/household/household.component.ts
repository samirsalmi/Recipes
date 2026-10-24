import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AvatarComponent, IconComponent, LanguageSwitcherComponent } from '../../components';
import { activityText } from '../../i18n/activity';
import { I18nService } from '../../i18n/i18n.service';
import { ActivityEvent, DietPref, HouseholdSettingsUpdate, UnitSystem } from '../../models';
import { AuthService, DisplayPrefsService, HouseholdService, ThemeService, ToastService } from '../../services';

const DIET_OPTIONS: { id: DietPref }[] = [
  { id: 'vegetarian' }, { id: 'vegan' }, { id: 'no-pork' }, { id: 'no-alcohol' }, { id: 'nut-free' }, { id: 'gluten-free' }, { id: 'dairy-free' },
];

/** Collapses consecutive "groceries.mark" events by the same member into one entry:
 *  "got rice, milk and 13 more". Input and output are newest first. */
export function groupActivity(events: ActivityEvent[]): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    const item = String(e.payload['key'] ?? '').trim();
    if (prev && e.type === 'groceries.mark' && prev.type === 'groceries.mark' && prev.userId === e.userId) {
      const items = [...((prev.payload['items'] as string[]) ?? []), item].filter(Boolean);
      const itemNames = [...((prev.payload['itemNames'] as unknown[]) ?? []), e.payload['names'] ?? null];
      const shown = items.slice(0, 2).join(', ');
      const rest = items.length - 2;
      out[out.length - 1] = { ...prev, payload: { ...prev.payload, items, itemNames, summary: `got ${shown}${rest > 0 ? ` and ${rest} more` : ''}` } };
    } else {
      out.push(e.type === 'groceries.mark' ? { ...e, payload: { ...e.payload, items: item ? [item] : [], itemNames: item ? [e.payload['names'] ?? null] : [] } } : e);
    }
  }
  return out;
}

/** Relative time for the activity feed ("2 min ago", "yesterday"). */
export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** /household: members, invite (link + code, Web Share), join with a code, settings (cooking
 *  for, diet, units, prefer budget recipes), pantry staples editor, theme, recent activity,
 *  account (credits, leave, log out). */
@Component({
  selector: 'app-household',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, AvatarComponent, LanguageSwitcherComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page max-w-3xl">
      @if (hh.household(); as h) {
        <p class="eyebrow">{{ t('hh.eyebrow') }}</p>
        <div class="flex items-center gap-2">
          @if (editingName()) {
            <form class="mt-1 flex flex-1 gap-2" (ngSubmit)="saveName()">
              <input name="hname" class="input" [(ngModel)]="nameValue" [attr.aria-label]="t('hh.nameAria')" dir="auto" />
              <button type="submit" class="btn-primary" [disabled]="!nameValue.trim()">{{ t('common.save') }}</button>
            </form>
          } @else {
            <h1 class="page-title" dir="auto">{{ h.name }}</h1>
            <button type="button" class="btn-icon" (click)="startEditName(h.name)" [attr.aria-label]="t('hh.renameAria')"><app-icon name="edit" [size]="18" /></button>
          }
        </div>

        <!-- Members + invite -->
        <section class="card mt-6 p-5" aria-labelledby="members-title">
          <h2 id="members-title" class="section-title">{{ t('hh.cookingTogether') }}</h2>
          <ul class="mt-3 space-y-3">
            @for (m of h.members; track m.userId) {
              <li class="flex items-center gap-3">
                <app-avatar [name]="m.name" [size]="40" />
                <span class="min-w-0 flex-1">
                  <span class="block font-medium" dir="auto">{{ m.name }}{{ m.userId === h.myUserId ? ' ' + t('hh.you') : '' }}</span>
                  <span class="block text-sm text-muted"><bdi dir="ltr">&#64;{{ m.username }}</bdi>{{ m.role === 'owner' ? ' · ' + t('hh.owner') : '' }}</span>
                </span>
                @if (hh.isOwner() && m.userId !== h.myUserId) {
                  <button type="button" class="btn-ghost min-h-[36px] px-3" (click)="remove(m.userId, m.name)">{{ t('hh.remove') }}</button>
                }
              </li>
            }
          </ul>
          <div class="mt-5 rounded-2xl bg-primary-tint p-4">
            <p class="text-sm font-medium text-primary">{{ t('hh.invitePrompt') }}</p>
            <div class="mt-2 flex flex-wrap items-center gap-3">
              <p class="font-mono text-2xl font-semibold tracking-[0.18em]" dir="ltr" [attr.aria-label]="t('hh.inviteCodeAria')">{{ h.inviteCode }}</p>
              <button type="button" class="btn-icon" (click)="copy(h.inviteCode, t('hh.codeCopied'))" [attr.aria-label]="t('hh.copyCodeAria')"><app-icon name="copy" [size]="18" /></button>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" class="btn-primary" (click)="shareInvite()"><app-icon name="share" [size]="18" /> {{ t('hh.shareInvite') }}</button>
              @if (hh.isOwner()) {
                <button type="button" class="btn-ghost" (click)="regenerate()">{{ t('hh.newCode') }}</button>
              }
            </div>
          </div>
          <details class="mt-4">
            <summary class="cursor-pointer text-sm font-medium text-primary">{{ t('hh.haveCode') }}</summary>
            <form class="mt-2 flex gap-2" (ngSubmit)="joinWithCode()">
              <input name="code" class="input uppercase tracking-widest" placeholder="ABCD2345" dir="ltr" maxlength="12" [(ngModel)]="joinCode" autocapitalize="characters" />
              <button type="submit" class="btn-secondary shrink-0" [disabled]="joinCode.trim().length < 6">{{ t('hh.join') }}</button>
            </form>
          </details>
        </section>

        <!-- Settings -->
        <section class="card mt-4 space-y-6 p-5" aria-labelledby="settings-title">
          <h2 id="settings-title" class="section-title">{{ t('hh.yourKitchen') }}</h2>
          <div class="flex items-center justify-between gap-4">
            <span><span class="font-medium">{{ t('hh.cookingFor') }}</span><br /><span class="text-sm text-muted">{{ t('hh.cookingForHint') }}</span></span>
            <div class="flex items-center rounded-full border border-hairline p-0.5">
              <button type="button" class="btn-icon h-9 w-9" (click)="setSize(h.size - 1)" [disabled]="h.size <= 1" [attr.aria-label]="t('hh.fewerPeople')"><app-icon name="minus" [size]="16" /></button>
              <span class="min-w-[2.5rem] text-center font-semibold">{{ h.size }}</span>
              <button type="button" class="btn-icon h-9 w-9" (click)="setSize(h.size + 1)" [disabled]="h.size >= 20" [attr.aria-label]="t('hh.morePeople')"><app-icon name="plus" [size]="16" /></button>
            </div>
          </div>
          <fieldset>
            <legend class="label">{{ t('discover.diet') }}</legend>
            <p class="-mt-1 mb-2 text-sm text-muted">{{ t('hh.dietHint') }}</p>
            <div class="flex flex-wrap gap-2">
              @for (d of dietOptions; track d.id) {
                <button type="button" class="chip" [class.chip-active]="h.diet.includes(d.id)" [attr.aria-pressed]="h.diet.includes(d.id)" (click)="toggleDiet(d.id)">{{ i18n.dietPref(d.id) }}</button>
              }
            </div>
          </fieldset>
          <fieldset>
            <legend class="label">{{ t('detail.units') }}</legend>
            <div class="flex gap-2">
              @for (u of units; track u.id) {
                <button type="button" class="chip" [class.chip-active]="h.units === u.id" (click)="save({ units: u.id })">{{ t(u.label) }}</button>
              }
            </div>
          </fieldset>
          <label class="flex items-center justify-between gap-4">
            <span><span class="font-medium">{{ t('hh.preferBudget') }}</span><br /><span class="text-sm text-muted">{{ t('hh.preferBudgetHint') }}</span></span>
            <input type="checkbox" class="switch" [checked]="h.preferBudget" (change)="save({ preferBudget: !h.preferBudget })" />
          </label>
        </section>

        <!-- Staples -->
        <section id="staples" class="card mt-4 p-5" aria-labelledby="staples-title">
          <h2 id="staples-title" class="section-title">{{ t('hh.staples') }}</h2>
          <p class="mt-1 text-sm text-muted">{{ t('hh.staplesHint') }}</p>
          <div class="mt-3 flex flex-wrap gap-2">
            @for (s of h.pantryStaples; track s) {
              <span class="chip pe-1.5"><bdi>{{ stapleLabel(s) }}</bdi>
                <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-sunken" (click)="removeStaple(s)" [attr.aria-label]="t('hh.removeStaple', { name: stapleLabel(s) })"><app-icon name="x" [size]="14" /></button>
              </span>
            } @empty {
              <p class="text-sm text-muted">{{ t('hh.noStaples') }}</p>
            }
          </div>
          <form class="mt-3 flex gap-2" (ngSubmit)="addStaple()">
            <input name="staple" class="input" [placeholder]="t('hh.addStaplePlaceholder')" [(ngModel)]="newStaple" dir="auto" />
            <button type="submit" class="btn-secondary shrink-0" [disabled]="!newStaple.trim()">{{ t('common.add') }}</button>
          </form>
          @if (!isDefaultStaples()) {
            <button type="button" class="btn-ghost -ms-3 mt-2" (click)="save({ pantryStaples: null })">{{ t('hh.resetStaples') }}</button>
          }
        </section>

        <!-- Language -->
        <section class="card mt-4 p-5" aria-labelledby="language-title">
          <h2 id="language-title" class="section-title">{{ t('hh.language') }}</h2>
          <p class="mt-1 text-sm text-muted">{{ t('lang.hint') }}</p>
          <div class="mt-3"><app-language-switcher /></div>
        </section>

        <!-- Appearance -->
        <section class="card mt-4 p-5" aria-labelledby="theme-title">
          <h2 id="theme-title" class="section-title">{{ t('hh.appearance') }}</h2>
          <div class="mt-3 flex gap-2" role="radiogroup" [attr.aria-label]="t('hh.themeAria')">
            @for (th of themes; track th.id) {
              <button type="button" role="radio" class="chip" [class.chip-active]="themeChoice() === th.id" [attr.aria-checked]="themeChoice() === th.id" (click)="setTheme(th.id)">
                <app-icon [name]="th.icon" [size]="16" /> {{ i18n.tx('theme.' + th.id) }}
              </button>
            }
          </div>
          <label class="mt-4 flex items-center justify-between gap-4">
            <span><span class="font-medium">{{ t('hh.equiv') }}</span><br /><span class="text-sm text-muted">{{ t('hh.equivHint') }}</span></span>
            <input type="checkbox" class="switch" data-qa="equiv-toggle" [checked]="prefs.showEquivalents()" (change)="prefs.setShowEquivalents(!prefs.showEquivalents())" />
          </label>
        </section>

        <!-- Activity -->
        <section class="card mt-4 p-5" aria-labelledby="activity-title">
          <h2 id="activity-title" class="section-title">{{ t('hh.activity') }}</h2>
          <ul class="mt-3 space-y-3">
            @for (e of recent(); track e.id) {
              <li class="flex items-start gap-3 text-sm">
                <app-avatar [name]="e.userName ?? '?'" [size]="28" />
                <span class="min-w-0 flex-1"><span class="font-medium" dir="auto">{{ e.userName ?? t('common.someone') }}</span> {{ activity(e) }}
                  <span class="block text-xs text-muted">{{ ago(e.createdAt) }}</span></span>
              </li>
            } @empty {
              <li class="text-sm text-muted">{{ t('hh.nothingYet') }}</li>
            }
          </ul>
        </section>

        <!-- Account -->
        <section class="mt-6 space-y-2">
          <p class="text-sm text-muted">{{ t('hh.signedInAs', { name: auth.currentUser()?.name ?? '', username: auth.currentUser()?.username ?? '' }) }}</p>
          <div class="flex flex-wrap gap-2">
            <a routerLink="/credits" class="btn-ghost -ms-3">{{ t('hh.credits') }}</a>
            @if (h.members.length > 1) {
              <button type="button" class="btn-secondary" (click)="leave()">{{ t('hh.leave') }}</button>
            }
            <button type="button" class="btn-secondary" (click)="auth.logout()"><app-icon name="logout" [size]="18" /> {{ t('common.logOut') }}</button>
          </div>
        </section>
      } @else {
        <div class="space-y-4" aria-busy="true"><div class="skeleton h-10 w-2/3"></div><div class="skeleton h-48"></div><div class="skeleton h-48"></div></div>
      }
    </div>
  `,
})
export class HouseholdComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  readonly hh = inject(HouseholdService);
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);
  readonly prefs = inject(DisplayPrefsService);
  private toast = inject(ToastService);
  private router = inject(Router);

  readonly dietOptions = DIET_OPTIONS;
  readonly units: { id: UnitSystem; label: 'hh.unitsMetric' | 'hh.unitsUs' }[] = [{ id: 'metric', label: 'hh.unitsMetric' }, { id: 'us', label: 'hh.unitsUs' }];
  readonly themes = [
    { id: 'system', icon: 'sparkle' },
    { id: 'light', icon: 'sun' },
    { id: 'dark', icon: 'moon' },
  ] as const;
  readonly editingName = signal(false);
  readonly themeChoice = signal<'system' | 'light' | 'dark'>(this.theme.choice());
  nameValue = '';
  newStaple = '';
  joinCode = '';

  /** Newest first; a run of check-offs by the same person collapses into one line. */
  readonly recent = computed(() => groupActivity([...this.hh.activity()].reverse()).slice(0, 20));
  readonly isDefaultStaples = computed(() => {
    const h = this.hh.household();
    return !h || [...h.pantryStaples].sort().join() === [...h.defaultPantryStaples].sort().join();
  });

  ngOnInit(): void {
    if (!this.hh.household()) this.hh.load();
  }

  ago(iso: string): string {
    return this.i18n.ago(iso);
  }

  activity(e: ActivityEvent): string {
    return activityText(e, this.i18n);
  }

  /** A pantry staple (stored as its English canonical name) in the active language. */
  stapleLabel(canonical: string): string {
    return this.i18n.ingredientName({ name: canonical, names: this.hh.household()?.stapleNames?.[canonical] });
  }

  startEditName(name: string): void {
    this.nameValue = name;
    this.editingName.set(true);
  }

  saveName(): void {
    this.save({ name: this.nameValue.trim() });
    this.editingName.set(false);
  }

  setSize(size: number): void {
    if (size >= 1 && size <= 20) this.save({ size });
  }

  toggleDiet(id: DietPref): void {
    const diet = this.hh.household()?.diet ?? [];
    this.save({ diet: diet.includes(id) ? diet.filter(d => d !== id) : [...diet, id] });
  }

  addStaple(): void {
    const name = this.newStaple.trim().toLowerCase();
    if (!name) return;
    this.newStaple = '';
    this.save({ pantryStaples: [...(this.hh.household()?.pantryStaples ?? []), name] });
  }

  removeStaple(name: string): void {
    this.save({ pantryStaples: (this.hh.household()?.pantryStaples ?? []).filter(s => s !== name) });
  }

  setTheme(choice: 'system' | 'light' | 'dark'): void {
    this.themeChoice.set(choice);
    if (choice === 'system') this.theme.followSystem();
    else this.theme.setDarkMode(choice === 'dark');
  }

  regenerate(): void {
    if (!confirm(this.t('hh.confirmNewCode'))) return;
    this.hh.regenerateInviteCode().subscribe(() => this.toast.show(this.t('hh.newCodeReady')));
  }

  shareInvite(): void {
    const url = this.hh.inviteLink();
    const text = this.t('hh.inviteText', { url });
    const nav = navigator as Navigator & { share?: (data: { title: string; text: string; url: string }) => Promise<void> };
    if (nav.share) nav.share({ title: this.t('hh.inviteTitle'), text, url }).catch(() => undefined);
    else this.copy(url, this.t('hh.linkCopied'));
  }

  copy(text: string, message: string): void {
    navigator.clipboard?.writeText(text).then(() => this.toast.show(message), () => this.toast.show(text));
  }

  joinWithCode(): void {
    const code = this.joinCode.trim().toUpperCase();
    if (code) this.router.navigate(['/join', code]);
  }

  remove(userId: number, name: string): void {
    if (confirm(this.t('hh.confirmRemove', { name }))) {
      this.hh.removeMember(userId).subscribe(() => this.toast.show(this.t('hh.removed', { name })));
    }
  }

  leave(): void {
    if (confirm(this.t('hh.confirmLeave'))) {
      this.hh.leave().subscribe(() => this.toast.show(this.t('hh.left')));
    }
  }

  save(update: HouseholdSettingsUpdate): void {
    this.hh.updateSettings(update).subscribe({ error: err => this.toast.show(this.i18n.apiError(err, 'hh.couldNotSave'), 'error') });
  }
}
