import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

const KEY = 'mise_theme'; // 'light' | 'dark'; absent = follow the OS

/** Dark mode: puts the `dark` class on <html> (Tailwind `dark:` variants + the dark token
 *  set in styles.scss). An explicit choice is remembered per device in localStorage;
 *  otherwise the OS preference is followed live. */
@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private document = inject(DOCUMENT);
  private media = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
  private explicit = signal<'light' | 'dark' | null>(readStored());
  private systemDark = signal(this.media?.matches ?? false);

  /** 'system' when following the OS. */
  readonly choice = computed(() => this.explicit() ?? 'system');
  readonly darkMode = computed(() => {
    const explicit = this.explicit();
    return explicit ? explicit === 'dark' : this.systemDark();
  });

  constructor() {
    this.media?.addEventListener?.('change', e => this.systemDark.set(e.matches));
    effect(() => this.document.documentElement.classList.toggle('dark', this.darkMode()));
  }

  toggleTheme(): void {
    this.setDarkMode(!this.darkMode());
  }

  setDarkMode(enabled: boolean): void {
    const value = enabled ? 'dark' : 'light';
    this.explicit.set(value);
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // storage unavailable: the choice just won't survive a reload
    }
  }

  /** Back to following the OS setting. */
  followSystem(): void {
    this.explicit.set(null);
    try {
      localStorage.removeItem(KEY);
    } catch {
      // ignore
    }
  }
}

function readStored(): 'light' | 'dark' | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}
