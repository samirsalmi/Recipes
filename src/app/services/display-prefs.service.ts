import { Injectable, signal } from '@angular/core';

const KEY = 'mise_equiv'; // '0' = off; absent = on

/** Per-device display preferences (not synced to the household): "Show metric equivalents"
 *  adds "(30 ml)" / "(≈ 120 g)" after kitchen-unit amounts. On by default. */
@Injectable({ providedIn: 'root' })
export class DisplayPrefsService {
  private readonly equivalents = signal(readStored());
  readonly showEquivalents = this.equivalents.asReadonly();

  setShowEquivalents(on: boolean): void {
    this.equivalents.set(on);
    try {
      if (on) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, '0');
    } catch {
      // storage unavailable: the choice just won't survive a reload
    }
  }
}

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}
