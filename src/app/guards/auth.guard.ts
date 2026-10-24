import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, take } from 'rxjs';
import { AuthService } from '../services';

/** Account-only routes: waits for the session check, then sends guests to /login with a
 *  returnUrl so they come back (e.g. an invite link /join/CODE). */
export const authGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return toObservable(authService.initialized).pipe(
    filter(initialized => initialized),
    take(1),
    map(() => authService.isAuthenticated() ? true : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } }))
  );
};

/** /login and /register: logged-in users go home instead. */
export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return toObservable(authService.initialized).pipe(
    filter(initialized => initialized),
    take(1),
    map(() => authService.isAuthenticated() ? router.createUrlTree(['/']) : true)
  );
};
