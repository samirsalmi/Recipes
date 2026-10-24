import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../components';
import { I18nService } from '../../i18n/i18n.service';
import { DietPref } from '../../models';
import { HouseholdService, ToastService } from '../../services';

const DIET_OPTIONS: { id: DietPref }[] = [
  { id: 'vegetarian' }, { id: 'vegan' }, { id: 'no-pork' }, { id: 'no-alcohol' }, { id: 'nut-free' }, { id: 'gluten-free' }, { id: 'dairy-free' },
];

/** /onboarding (after register): three skippable screens - who you cook for (size + diet),
 *  cook together (share your invite, or join with a code), plan your first week. */
@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page flex min-h-[80vh] max-w-md flex-col">
      <div class="flex items-center justify-between">
        <div class="flex gap-1.5" [attr.aria-label]="t('onb.step', { n: step() })">
          @for (i of [1, 2, 3]; track i) {
            <span class="h-1.5 w-8 rounded-full" [class.bg-primary]="i <= step()" [class.bg-sunken]="i > step()"></span>
          }
        </div>
        <a routerLink="/" class="btn-ghost -me-3">{{ t('onb.skip') }}</a>
      </div>

      @switch (step()) {
        @case (1) {
          <div class="mt-10 flex-1 animate-rise-in">
            <p class="eyebrow">{{ t('onb.step', { n: 1 }) }}</p>
            <h1 class="page-title mt-1">{{ t('onb.s1.title') }}</h1>
            <p class="mt-2 text-muted">{{ t('onb.s1.text') }}</p>
            <div class="mt-8 flex items-center justify-center gap-4">
              <button type="button" class="btn-icon h-14 w-14 border border-hairline" (click)="size.set(Math.max(1, size() - 1))" [attr.aria-label]="t('onb.fewer')"><app-icon name="minus" /></button>
              <span class="min-w-[7rem] text-center font-display text-4xl font-semibold">{{ i18n.n(size()) }}<span class="block font-sans text-sm font-normal text-muted">{{ t('common.people', { count: size() }) }}</span></span>
              <button type="button" class="btn-icon h-14 w-14 border border-hairline" (click)="size.set(Math.min(20, size() + 1))" [attr.aria-label]="t('onb.more')"><app-icon name="plus" /></button>
            </div>
            <p class="label mt-10">{{ t('onb.avoid') }}</p>
            <div class="flex flex-wrap gap-2">
              @for (d of dietOptions; track d.id) {
                <button type="button" class="chip" [class.chip-active]="diet().includes(d.id)" [attr.aria-pressed]="diet().includes(d.id)" (click)="toggleDiet(d.id)">{{ i18n.dietPref(d.id) }}</button>
              }
            </div>
          </div>
          <button type="button" class="btn-primary mt-8 w-full" (click)="saveBasics()">{{ t('onb.continue') }}</button>
        }
        @case (2) {
          <div class="mt-10 flex-1 animate-rise-in">
            <p class="eyebrow">{{ t('onb.step', { n: 2 }) }}</p>
            <h1 class="page-title mt-1">{{ t('onb.s2.title') }}</h1>
            <p class="mt-2 text-muted">{{ t('onb.s2.text') }}</p>
            @if (hh.household(); as h) {
              <div class="mt-6 rounded-card bg-primary-tint p-5">
                <p class="text-sm font-medium text-primary">{{ t('onb.s2.code') }}</p>
                <p class="mt-1 font-mono text-3xl font-semibold tracking-[0.18em]" dir="ltr">{{ h.inviteCode }}</p>
                <button type="button" class="btn-primary mt-4" (click)="shareInvite()"><app-icon name="share" [size]="18" /> {{ t('hh.shareInvite') }}</button>
              </div>
            }
            <div class="mt-6">
              <p class="label">{{ t('onb.s2.gotCode') }}</p>
              <form class="flex gap-2" (ngSubmit)="join()">
                <input name="code" class="input uppercase tracking-widest" placeholder="ABCD2345" dir="ltr" maxlength="12" [(ngModel)]="code" autocapitalize="characters" />
                <button type="submit" class="btn-secondary shrink-0" [disabled]="code.trim().length < 6">{{ t('hh.join') }}</button>
              </form>
            </div>
          </div>
          <button type="button" class="btn-primary mt-8 w-full" (click)="step.set(3)">{{ t('onb.continue') }}</button>
        }
        @case (3) {
          <div class="mt-10 flex-1 animate-rise-in">
            <p class="eyebrow">{{ t('onb.step', { n: 3 }) }}</p>
            <h1 class="page-title mt-1">{{ t('onb.s3.title') }}</h1>
            <p class="mt-2 text-muted">{{ t('onb.s3.text') }}</p>
            <div class="mt-8 space-y-3">
              <a routerLink="/plan" [queryParams]="{ fill: 1 }" class="btn-primary w-full"><app-icon name="sparkle" [size]="18" /> {{ t('onb.s3.suggest') }}</a>
              <a routerLink="/plan" class="btn-secondary w-full">{{ t('onb.s3.self') }}</a>
              <a routerLink="/" class="btn-ghost w-full">{{ t('onb.s3.browse') }}</a>
            </div>
          </div>
        }
      }
    </div>
  `,
})
export class OnboardingComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  readonly hh = inject(HouseholdService);
  private toast = inject(ToastService);
  private router = inject(Router);
  readonly Math = Math;

  readonly dietOptions = DIET_OPTIONS;
  readonly step = signal(1);
  readonly size = signal(2);
  readonly diet = signal<DietPref[]>([]);
  code = '';

  ngOnInit(): void {
    this.hh.load();
    const h = this.hh.household();
    if (h) {
      this.size.set(h.size);
      this.diet.set(h.diet);
    }
  }

  toggleDiet(id: DietPref): void {
    this.diet.update(list => (list.includes(id) ? list.filter(d => d !== id) : [...list, id]));
  }

  saveBasics(): void {
    this.hh.updateSettings({ size: this.size(), diet: this.diet() }).subscribe({
      next: () => this.step.set(2),
      error: () => this.toast.show(this.t('onb.saveFail'), 'error'),
    });
  }

  shareInvite(): void {
    const url = this.hh.inviteLink();
    const nav = navigator as Navigator & { share?: (data: { title: string; text: string; url: string }) => Promise<void> };
    if (nav.share) nav.share({ title: this.t('hh.inviteTitle'), text: this.t('onb.shareText', { url }), url }).catch(() => undefined);
    else navigator.clipboard?.writeText(url).then(() => this.toast.show(this.t('onb.linkCopied')));
  }

  join(): void {
    const code = this.code.trim().toUpperCase();
    if (code) this.router.navigate(['/join', code]);
  }
}
