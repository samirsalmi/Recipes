import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LanguageSwitcherComponent } from '../../components/language-switcher/language-switcher.component';
import { I18nService } from '../../i18n/i18n.service';
import { AuthService, safeReturnUrl } from '../../services';

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink, LanguageSwitcherComponent],
  templateUrl: './register.component.html',
})
export class RegisterComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  private authService = inject(AuthService);
  private router = inject(Router);
  /** Invite links survive sign-up: /join/CODE -> register -> back to the join page. */
  readonly returnUrl = safeReturnUrl(inject(ActivatedRoute).snapshot.queryParamMap.get('returnUrl'));

  name = '';
  username = '';
  password = '';
  isSubmitting = signal(false);
  errorMessage = signal('');

  get passwordTooShort(): boolean {
    return this.password.length > 0 && this.password.length < 8;
  }

  get usernameInvalid(): boolean {
    return this.username.length > 0 && (this.username.length < 3 || !USERNAME_PATTERN.test(this.username));
  }

  submit(): void {
    if (!this.name || !this.username || !this.password || this.passwordTooShort || this.usernameInvalid) return;

    this.isSubmitting.set(true);
    this.errorMessage.set('');

    this.authService.register(this.username, this.password, this.name, this.i18n.language()).subscribe({
      next: () => this.router.navigateByUrl(this.returnUrl ?? '/onboarding'),
      error: err => {
        this.isSubmitting.set(false);
        this.errorMessage.set(err.status === 409 ? this.t('auth.usernameTaken') : this.i18n.apiError(err, 'auth.generic'));
      }
    });
  }
}
