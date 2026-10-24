import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { I18nService } from '../../i18n/i18n.service';
import { InvitePreview } from '../../models';
import { HouseholdService, ToastService } from '../../services';

/** /join/:code (authGuard keeps the code through login/register via returnUrl): shows which
 *  household the code belongs to and joins it on confirm. */
@Component({
  selector: 'app-join',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page flex min-h-[70vh] max-w-md flex-col justify-center">
      @if (preview(); as p) {
        <p class="eyebrow">{{ t('join.invited') }}</p>
        <h1 class="page-title mt-1" dir="auto">{{ t('join.title', { name: p.name }) }}</h1>
        <p class="mt-2 text-muted">{{ t('join.with', { names: i18n.list(p.memberNames) }) }}</p>
        <button type="button" class="btn-primary mt-6" (click)="join()" [disabled]="joining()">{{ joining() ? t('join.joining') : t('join.cta') }}</button>
        <a routerLink="/" class="btn-ghost mt-2">{{ t('join.notNow') }}</a>
      } @else if (error()) {
        <h1 class="page-title">{{ t('join.notFound') }}</h1>
        <p class="mt-2 text-muted">{{ error() }}</p>
        <a routerLink="/household" class="btn-primary mt-6">{{ t('join.goHousehold') }}</a>
      } @else {
        <div class="h-32 animate-pulse rounded-card bg-sunken"></div>
      }
    </div>
  `,
})
export class JoinComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  private hh = inject(HouseholdService);
  private router = inject(Router);
  private toast = inject(ToastService);
  readonly code = input.required<string>();

  readonly preview = signal<InvitePreview | null>(null);
  readonly error = signal('');
  readonly joining = signal(false);

  ngOnInit(): void {
    this.hh.previewInvite(this.code()).subscribe({
      next: p => this.preview.set(p),
      error: () => this.error.set(this.t('join.invalid')),
    });
  }

  join(): void {
    this.joining.set(true);
    this.hh.join(this.code()).subscribe({
      next: h => {
        this.toast.show(this.t('join.welcome', { name: h.name }));
        this.router.navigate(['/plan']);
      },
      error: err => {
        this.joining.set(false);
        this.toast.show(err.status === 400 ? this.t('join.already') : this.i18n.apiError(err, 'join.fail'), 'error');
      },
    });
  }
}
