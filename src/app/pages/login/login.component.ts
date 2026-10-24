import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LanguageSwitcherComponent } from '../../components/language-switcher/language-switcher.component';
import { I18nService } from '../../i18n/i18n.service';
import { AuthService, safeReturnUrl } from '../../services';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink, LanguageSwitcherComponent],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  private authService = inject(AuthService);
  private router = inject(Router);

  /** Where the authGuard (or requireLogin) sent us from, e.g. /join/CODE. */
  readonly returnUrl = safeReturnUrl(inject(ActivatedRoute).snapshot.queryParamMap.get('returnUrl'));

  username = '';
  password = '';
  isSubmitting = signal(false);
  errorMessage = signal('');

  submit(): void {
    if (!this.username || !this.password) return;
    this.isSubmitting.set(true);
    this.errorMessage.set('');
    this.authService.login(this.username, this.password).subscribe({
      next: () => this.router.navigateByUrl(this.returnUrl ?? '/'),
      error: err => {
        this.isSubmitting.set(false);
        this.errorMessage.set(err.status === 401 ? this.t('auth.badLogin') : this.i18n.apiError(err, 'auth.generic'));
      }
    });
  }
}

