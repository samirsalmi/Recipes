import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, inject, input, output } from '@angular/core';
import { I18nService } from '../../i18n/i18n.service';
import { IconComponent } from '../icon/icon.component';

/** Mobile-first bottom sheet (the app's replacement for modals). Usage:
 *  `@if (open()) { <app-bottom-sheet title="Add to plan" (closed)="open.set(false)">...</app-bottom-sheet> }` */
@Component({
  selector: 'app-bottom-sheet',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sheet-backdrop" (click)="closed.emit()"></div>
    <section class="sheet outline-none" role="dialog" aria-modal="true" tabindex="-1" [attr.aria-label]="title()">
      <div class="sheet-handle"></div>
      <header class="flex items-center justify-between px-5 pb-2">
        <h2 class="font-display text-xl font-semibold">{{ title() }}</h2>
        <button type="button" class="btn-icon -me-2" (click)="closed.emit()" [attr.aria-label]="i18n.t('sheet.close')">
          <app-icon name="x" />
        </button>
      </header>
      <div class="px-5">
        <ng-content />
      </div>
    </section>
  `,
})
export class BottomSheetComponent implements AfterViewInit, OnDestroy {
  protected readonly i18n = inject(I18nService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private opener: HTMLElement | null = document.activeElement as HTMLElement | null;

  readonly title = input('');
  readonly closed = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  /** Move focus into the dialog, and give it back to the opener when the sheet closes. */
  ngAfterViewInit(): void {
    this.host.nativeElement.querySelector<HTMLElement>('.sheet')?.focus({ preventScroll: true });
  }

  ngOnDestroy(): void {
    if (this.opener && this.opener.isConnected) this.opener.focus({ preventScroll: true });
  }

  /** Keep Tab inside the open sheet. */
  @HostListener('keydown.tab', ['$event'])
  @HostListener('keydown.shift.tab', ['$event'])
  trapTab(event: Event): void {
    const e = event as KeyboardEvent;
    const items = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter(el => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === this.host.nativeElement.querySelector('.sheet'))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
