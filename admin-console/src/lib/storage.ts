const AUTH_STORAGE_KEY = 'postback_admin_auth';

export interface StoredAppRole {
  app_id: number;
  app_name: string;
  role: 'admin' | 'operator' | 'analyst' | 'viewer';
}

export interface StoredAuth {
  token: string;
  user: {
    id: number;
    username: string;
    display_name?: string | null;
    is_super_admin?: boolean;
  };
  app_roles: StoredAppRole[];
  selected_app_id: number | null;
}

export function getStoredAuth(): StoredAuth | null {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export function setStoredAuth(auth: StoredAuth): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function clearStoredAuth(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}
