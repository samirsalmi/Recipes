import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { I18nService } from '../../i18n/i18n.service';
import { TranslationKey } from '../../i18n/en';
import { AuthService, GroceriesService, ThemeService } from '../../services';
import { LanguageSwitcherComponent } from '../language-switcher/language-switcher.component';
import { IconComponent } from '../icon/icon.component';

export interface NavItem {
  path: string;
  /** Translation key of the label. */
  label: TranslationKey;
  icon: string;
}

/** The five destinations (docs/rework-plan.md section 3), shared by both navs. */
export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'nav.discover', icon: 'discover' },
  { path: '/plan', label: 'nav.plan', icon: 'plan' },
  { path: '/groceries', label: 'nav.groceries', icon: 'groceries' },
  { path: '/cookbook', label: 'nav.cookbook', icon: 'cookbook' },
  { path: '/household', label: 'nav.household', icon: 'household' },
];

/** App navigation: a top bar on desktop (>= lg) and a bottom tab bar with safe-area padding
 *  on mobile. Rendered once in app.html. */
@Component({
  selector: 'app-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent, LanguageSwitcherComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Desktop top bar -->
    <header class="sticky top-0 z-30 hidden border-b border-hairline bg-paper/90 backdrop-blur-sm lg:block">
      <nav class="mx-auto flex h-16 max-w-6xl items-center gap-2 px-8" [attr.aria-label]="t('nav.main')">
        <a routerLink="/" class="me-6 font-display text-2xl font-semibold text-primary">Mise</a>
        @for (item of items; track item.path) {
          <a [routerLink]="item.path" routerLinkActive="bg-primary-tint text-primary"
             [routerLinkActiveOptions]="{ exact: item.path === '/' }"
             class="relative inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium text-muted hover:text-ink">
            <app-icon [name]="item.icon" [size]="18" />
            {{ t(item.label) }}
            @if (item.path === '/groceries' && newGroceries() > 0) {
              <span class="new-dot" [attr.aria-label]="t('nav.newItems')"></span>
            }
          </a>
        }
        <span class="flex-1"></span>
        <app-language-switcher [compact]="true" />
        <button type="button" class="btn-icon" (click)="theme.toggleTheme()"
                [attr.aria-label]="theme.darkMode() ? t('nav.toLight') : t('nav.toDark')">
          <app-icon [name]="theme.darkMode() ? 'sun' : 'moon'" [size]="20" />
        </button>
        @if (auth.isAuthenticated()) {
          <span class="ms-2 text-sm text-muted">{{ auth.currentUser()?.name }}</span>
          <button type="button" class="btn-icon" (click)="auth.logout()" [attr.aria-label]="t('nav.logOut')">
            <app-icon name="logout" [size]="20" />
          </button>
        } @else {
          <a routerLink="/login" class="btn-ghost">{{ t('common.signIn') }}</a>
          <a routerLink="/register" class="btn-primary">{{ t('common.createAccount') }}</a>
        }
      </nav>
    </header>

    <!-- Mobile bottom tab bar -->
    <nav class="tab-bar" [attr.aria-label]="t('nav.main')">
      @for (item of items; track item.path) {
        <a [routerLink]="item.path" routerLinkActive="tab-item-active" [routerLinkActiveOptions]="{ exact: item.path === '/' }"
           #rla="routerLinkActive" class="tab-item" [attr.aria-current]="rla.isActive ? 'page' : null">
          <span class="relative">
            <app-icon [name]="item.icon" [size]="24" />
            @if (item.path === '/groceries' && newGroceries() > 0) {
              <span class="new-dot absolute -end-1 -top-0.5" [attr.aria-label]="t('nav.newItems')"></span>
            }
          </span>
          {{ t(item.label) }}
        </a>
      }
    </nav>
  `,
})
export class AppNavComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);
  private groceries = inject(GroceriesService);

  readonly items = NAV_ITEMS;
  readonly newGroceries = this.groceries.newCount;
}
