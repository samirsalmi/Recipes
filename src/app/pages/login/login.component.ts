import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

  username = '';
  password = '';
  isSubmitting = signal(false);
  errorMessage = signal('');

  submit(): void {
    if (!this.username || !this.password) return;

    this.isSubmitting.set(true);
    this.errorMessage.set('');

    this.authService.login(this.username, this.password).subscribe({
      next: () => this.router.navigate(['/']),
      error: err => {
        this.isSubmitting.set(false);
        this.errorMessage.set(
          err.status === 401 ? 'Incorrect username or password.' : 'Something went wrong. Please try again.'
        );
      }
    });
  }
}
