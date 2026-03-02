import { useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { fetchMe, login as loginApi, type LoginResponse } from '../lib/api';
import {
  clearStoredAuth,
  getStoredAuth,
  setStoredAuth,
  type StoredAuth
} from '../lib/storage';
import { AuthContext, type AuthContextValue } from './auth-context';

function toStoredAuth(data: LoginResponse, previousAppId: number | null): StoredAuth {
  const selectedAppId = previousAppId && data.app_roles.some((item) => item.app_id === previousAppId)
    ? previousAppId
    : (data.app_roles[0]?.app_id || null);

  return {
    token: data.token,
    user: data.user,
    app_roles: data.app_roles,
    selected_app_id: selectedAppId
  };
}

function mergeMeToStoredAuth(current: StoredAuth, meData: Omit<LoginResponse, 'token'>): StoredAuth {
  const selectedAppId = current.selected_app_id && meData.app_roles.some((item) => item.app_id === current.selected_app_id)
    ? current.selected_app_id
    : (meData.app_roles[0]?.app_id || null);

  return {
    ...current,
    user: meData.user,
    app_roles: meData.app_roles,
    selected_app_id: selectedAppId
  };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => getStoredAuth());

  const value = useMemo<AuthContextValue>(
    () => ({
      token: auth?.token || '',
      appRoles: auth?.app_roles || [],
      selectedAppId: auth?.selected_app_id || null,
      username: auth?.user?.username || '',
      isSuperAdmin: Boolean(auth?.user?.is_super_admin),
      login: async (username: string, password: string) => {
        const result = await loginApi(username, password);
        const stored = toStoredAuth(result, auth?.selected_app_id || null);
        setStoredAuth(stored);
        setAuth(stored);
      },
      logout: () => {
        clearStoredAuth();
        setAuth(null);
      },
      selectApp: (appId: number) => {
        if (!auth) {
          return;
        }
        const next = {
          ...auth,
          selected_app_id: appId
        };
        setStoredAuth(next);
        setAuth(next);
      },
      refreshProfile: async () => {
        if (!auth) {
          return;
        }
        const meData = await fetchMe();
        const next = mergeMeToStoredAuth(auth, meData);
        setStoredAuth(next);
        setAuth(next);
      }
    }),
    [auth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
