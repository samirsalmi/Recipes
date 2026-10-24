import { Component, inject } from '@angular/core';
import { I18nService } from '../../i18n/i18n.service';
import { ToastService } from '../../services';

/** Renders ToastService.toasts above the mobile tab bar (bottom-right on desktop). */
@Component({
  selector: 'app-toast',
  standalone: true,
  templateUrl: './toast.component.html'
})
export class ToastComponent {
  private toastService = inject(ToastService);
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  toasts = this.toastService.toasts;

  run(id: number, action: () => void): void {
    this.toastService.dismiss(id);
    action();
  }

  dismiss(id: number): void {
    this.toastService.dismiss(id);
  }
}
