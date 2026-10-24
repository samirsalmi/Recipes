import { Injectable, inject, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { AuthResponse, User } from '../models';
import { cacheUser, cachedUser, clearToken, getToken, initializedSignal, isAuthenticated, setToken, userSignal } from './auth-state';
import { environment } from '../../environments/environment';

const API_BASE = environment.apiBaseUrl;

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly currentUser = userSignal.asReadonly();
  readonly initialized = initializedSignal.asReadonly();
  readonly isAuthenticated = isAuthenticated;
  readonly isAdmin = computed(() => this.currentUser()?.isAdmin ?? false);

  constructor() {
    const token = getToken();
    if (!token) {
      initializedSignal.set(true);
      return;
    }
    this.http.get<User>(`${API_BASE}/auth/me`).subscribe({
      next: user => {
        userSignal.set(user);
        cacheUser(user);
        initializedSignal.set(true);
      },
      error: (err: { status?: number }) => {
        // Offline or server down: keep the session and use the last known profile, so the
        // cached grocery list still opens in the shop. Only a rejected token logs out.
        const cached = !err.status || err.status >= 500 ? cachedUser() : null;
        if (cached) {
          userSignal.set(cached);
        } else {
          clearToken();
        }
        initializedSignal.set(true);
      }
    });
  }

  register(username: string, password: string, name: string, language?: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${API_BASE}/auth/register`, { username, password, name, ...(language ? { language } : {}) })
      .pipe(tap(res => this.handleAuthResponse(res)));
  }

  login(username: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${API_BASE}/auth/login`, { username, password })
      .pipe(tap(res => this.handleAuthResponse(res)));
  }

  logout(): void {
    clearToken();
    userSignal.set(null);
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return getToken();
  }

  private handleAuthResponse(res: AuthResponse): void {
    setToken(res.access_token);
    userSignal.set(res.user);
    cacheUser(res.user);
  }
}
