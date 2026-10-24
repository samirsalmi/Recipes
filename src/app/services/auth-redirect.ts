import { Router } from '@angular/router';
import { isAuthenticated } from './auth-state';

/** For account-linked actions reachable from public pages (favorite, add to plan, notes):
 *  returns true when logged in; otherwise sends the user to /login (coming back to the
 *  current page afterwards) and returns false. See frontend.md G13. */
export function requireLogin(router: Router): boolean {
  if (isAuthenticated()) return true;
  router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
  return false;
}

/** A returnUrl query param is only followed when it is a same-app path ("/join/ABC"),
 *  never "//evil.com" or an absolute URL. */
export function safeReturnUrl(value: string | null): string | null {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : null;
}
