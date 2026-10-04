import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

// Simple in-app replacement for native alert()/confirm() feedback - shows briefly and
// auto-dismisses instead of blocking the page.
@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private toastsSignal = signal<Toast[]>([]);
  readonly toasts = this.toastsSignal.asReadonly();

  private nextId = 0;

  show(message: string, type: ToastType = 'success', durationMs = 3000): void {
    const id = this.nextId++;
    this.toastsSignal.update(toasts => [...toasts, { id, message, type }]);
    setTimeout(() => this.dismiss(id), durationMs);
  }

  dismiss(id: number): void {
    this.toastsSignal.update(toasts => toasts.filter(t => t.id !== id));
  }
}
