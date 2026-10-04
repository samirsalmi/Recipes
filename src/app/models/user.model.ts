export interface User {
  id: number;
  username: string;
  name: string;
  isAdmin: boolean;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}
