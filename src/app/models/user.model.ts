import type { Language } from '../i18n/config';

export interface User {
  id: number;
  username: string;
  name: string;
  isAdmin: boolean;
  /** Preferred UI language (en | fr | ar), saved with PATCH /auth/me. */
  language: Language;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}
