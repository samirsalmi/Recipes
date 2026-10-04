import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, take } from 'rxjs';
import { AuthService } from '../services';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return toObservable(authService.initialized).pipe(
    filter(initialized => initialized),
    take(1),
    map(() => authService.isAuthenticated() ? true : router.createUrlTree(['/login']))
  );
};

export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return toObservable(authService.initialized).pipe(
    filter(initialized => initialized),
    take(1),
    map(() => authService.isAuthenticated() ? router.createUrlTree(['/']) : true)
  );
};
