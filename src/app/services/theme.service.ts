import { Injectable, signal, inject, effect } from '@angular/core';
import { StorageService } from './storage.service';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private storageService = inject(StorageService);
  
  private darkModeSignal = signal<boolean>(false);

  readonly darkMode = this.darkModeSignal.asReadonly();

  constructor() {
    // Initialize theme from storage or system preference
    this.initializeTheme();

    // Save to storage whenever dark mode changes
    effect(() => {
      this.storageService.setDarkMode(this.darkModeSignal()).subscribe();
      this.applyTheme();
    });
  }

  private initializeTheme(): void {
    this.storageService.getDarkMode().subscribe(storedDarkMode => {
      if (storedDarkMode !== null) {
        this.darkModeSignal.set(storedDarkMode);
      } else {
        // Check system preference
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        this.darkModeSignal.set(prefersDark);
      }
    });

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      this.darkModeSignal.set(e.matches);
    });
  }

  toggleTheme(): void {
    this.darkModeSignal.update(current => !current);
  }

  setDarkMode(enabled: boolean): void {
    this.darkModeSignal.set(enabled);
  }

  private applyTheme(): void {
    const html = document.documentElement;
    if (this.darkModeSignal()) {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }
}
