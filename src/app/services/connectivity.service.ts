import { Injectable, signal } from '@angular/core';

/** Browser online/offline state as a signal (drives the offline banner). */
@Injectable({
  providedIn: 'root'
})
export class ConnectivityService {
  private onlineSignal = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly online = this.onlineSignal.asReadonly();

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => this.onlineSignal.set(true));
    window.addEventListener('offline', () => this.onlineSignal.set(false));
  }
}
