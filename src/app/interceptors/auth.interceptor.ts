import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { clearToken, getToken, userSignal } from '../services/auth-state';
import { environment } from '../../environments/environment';

const API_BASE = environment.apiBaseUrl;

// Reads/writes auth state through the plain auth-state module rather than `inject(AuthService)`
// - injecting the service here would make it call back into this interceptor for the very
// request its own constructor fires (GET /auth/me), which Angular rejects as a circular
// dependency (NG0200).
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);

  if (!req.url.startsWith(API_BASE)) {
    return next(req);
  }

  const token = getToken();
  const authedReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authedReq).pipe(
    catchError(error => {
      // Only a *rejected* token is a session problem worth forcing a re-login for. A guest
      // hitting an account-only endpoint (favorites, meal plan, ...) with no token is an
      // expected 401 while browsing without an account - let the caller degrade gracefully
      // instead of bouncing them to /login.
      if (token && error.status === 401 && !req.url.includes('/auth/login') && !req.url.includes('/auth/register')) {
        clearToken();
        userSignal.set(null);
        router.navigate(['/login']);
      }
      return throwError(() => error);
    })
  );
};
