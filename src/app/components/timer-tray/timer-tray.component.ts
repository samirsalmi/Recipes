import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18nService } from '../../i18n/i18n.service';
import { TimerService } from '../../services';
import { formatCountdown } from '../../utils/timers';
import { IconComponent } from '../icon/icon.component';

/** Floating stack of running kitchen timers (any page), above the mobile tab bar. */
@Component({
  selector: 'app-timer-tray',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (timers.timers().length) {
      <div class="fixed start-3 z-40 flex max-w-[calc(100vw-1.5rem)] flex-col gap-2 lg:bottom-6 lg:start-6"
           style="bottom: calc(4.75rem + var(--safe-bottom))" [attr.aria-label]="t('timers.label')">
        @for (t of timers.timers(); track t.id) {
          <div class="flex items-center gap-2 rounded-full py-1.5 ps-4 pe-1.5 shadow-soft"
               [class.bg-ink]="!t.done" [class.text-paper]="!t.done" [class.bg-accent]="t.done" [class.text-white]="t.done"
               [class.animate-pulse]="t.done" role="timer" [attr.aria-label]="t.label">
            <app-icon name="timer" [size]="18" />
            <span class="min-w-0 truncate text-sm">
              <span class="font-semibold tabular-nums">{{ t.done ? i18n.t('timers.done') : countdown(t) }}</span>
              <span class="opacity-80"> · {{ t.label }}</span>
            </span>
            @if (!t.done) {
              <button type="button" class="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10"
                      (click)="timers.togglePause(t.id)" [attr.aria-label]="t.pausedRemainingMs !== null ? i18n.t('timers.resume') : i18n.t('timers.pause')">
                <span class="text-xs font-bold">{{ t.pausedRemainingMs !== null ? '▶' : 'II' }}</span>
              </button>
            }
            <button type="button" class="inline-flex h-9 items-center justify-center rounded-full px-2 text-xs font-semibold hover:bg-white/10"
                    (click)="timers.extend(t.id)" [attr.aria-label]="i18n.t('timers.addMinute')">+1</button>
            <button type="button" class="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10"
                    (click)="timers.dismiss(t.id)" [attr.aria-label]="i18n.t('timers.dismiss')"><app-icon name="x" [size]="16" /></button>
          </div>
        }
      </div>
    }
  `,
})
export class TimerTrayComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  readonly timers = inject(TimerService);

  countdown(t: Parameters<TimerService['remaining']>[0]): string {
    this.timers.now(); // re-render every tick
    return formatCountdown(this.timers.remaining(t));
  }
}
