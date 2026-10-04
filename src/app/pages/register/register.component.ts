import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services';

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss']
})
export class RegisterComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

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

    this.authService.register(this.username, this.password, this.name).subscribe({
      next: () => this.router.navigate(['/']),
      error: err => {
        this.isSubmitting.set(false);
        this.errorMessage.set(
          err.status === 409 ? 'That username is already taken.' : 'Something went wrong. Please try again.'
        );
      }
    });
  }
}
