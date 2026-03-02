import { createContext } from 'react';
import type { StoredAppRole } from '../lib/storage';

export interface AuthContextValue {
  token: string;
  appRoles: StoredAppRole[];
  selectedAppId: number | null;
  username: string;
  isSuperAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  selectApp: (appId: number) => void;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
