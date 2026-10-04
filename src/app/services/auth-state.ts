import { computed, signal } from '@angular/core';
import { User } from '../models';

// Plain (non-DI) module state shared between AuthService and the HTTP interceptor.
// The interceptor must not `inject(AuthService)` - the very first request AuthService's own
// constructor makes (GET /auth/me) would then pass back through this interceptor while
// AuthService is still being constructed, which Angular rejects as a circular dependency
// (NG0200). Reading/writing this plain state avoids DI entirely.

const TOKEN_KEY = 'recipe_manager_auth_token';

export const userSignal = signal<User | null>(null);
export const initializedSignal = signal(false);
export const isAuthenticated = computed(() => userSignal() !== null);

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage unavailable - the session will just not survive a refresh
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}
