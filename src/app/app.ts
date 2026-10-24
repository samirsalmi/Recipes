import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, skip } from 'rxjs';
import { AppNavComponent, TimerTrayComponent, ToastComponent } from './components';
import { I18nService } from './i18n/i18n.service';
import { ConnectivityService, ThemeService } from './services';

/** Shell: navigation (desktop top bar / mobile tab bar), the routed page, toasts. */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, AppNavComponent, ToastComponent, TimerTrayComponent],
  templateUrl: './app.html',
})
export class AppComponent {
  // Instantiated here so the theme class is applied before the first page renders.
  private theme = inject(ThemeService);
  protected connectivity = inject(ConnectivityService);
  // Instantiated here so <html lang dir> is right before the first page renders.
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  constructor() {
    // After each in-app navigation move focus to <main> so keyboard and screen-reader users start
    // at the new page instead of the old position (the skip link and tab bar stay reachable).
    inject(Router).events.pipe(filter(e => e instanceof NavigationEnd), skip(1)).subscribe(() => {
      setTimeout(() => document.getElementById('main')?.focus({ preventScroll: true }));
    });
  }
}
