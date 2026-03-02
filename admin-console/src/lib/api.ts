import axios from 'axios';
import { getStoredAuth } from './storage';

const apiBase = import.meta.env.VITE_API_BASE || '';

export const api = axios.create({
  baseURL: apiBase
});

api.interceptors.request.use((config) => {
  const auth = getStoredAuth();

  if (auth?.token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${auth.token}`;
  }

  if (auth?.selected_app_id) {
    config.headers = config.headers || {};
    config.headers['x-app-id'] = String(auth.selected_app_id);
  }

  return config;
});

export type Platform = 'facebook' | 'tiktok';
export type UserRole = 'admin' | 'operator' | 'analyst' | 'viewer';

export interface JobsFilterParams {
  campaign?: string;
  platform?: Platform;
}

export interface PlatformConfigPayload {
  enabled: boolean;
  endpoint_url: string | null;
  access_token: string | null;
  config_json: Record<string, unknown>;
}

export interface PlatformPixelPayload {
  display_name?: string;
  pixel_key?: string;
  enabled?: boolean;
  endpoint_url?: string | null;
  access_token?: string | null;
  priority?: number;
  config_json?: Record<string, unknown>;
}

export interface SdkEventPayload {
  event_name: string;
  event_time?: string;
  event_uid?: string;
  oa_uid?: string;
  ifa?: string;
  event_id?: string;
  destinations?: Platform[];
  user_data?: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
}

export interface AttributionRulePayload {
  rule_name: string;
  lookback_window_hours: number;
  click_priority: Array<'click_id' | 'ttclid' | 'fbc'>;
  allow_event_side_create: boolean;
  activate: boolean;
}

export interface LoginResponse {
  token: string;
  user: {
    id: number;
    username: string;
    display_name?: string | null;
    is_super_admin?: boolean;
  };
  app_roles: Array<{
    app_id: number;
    app_name: string;
    role: UserRole;
  }>;
}

export interface AuthAppRow {
  id: number;
  name: string;
  api_key: string;
  is_active: boolean;
  created_at: string;
  role: UserRole | 'admin';
}

export interface CreateUserPayload {
  username: string;
  password: string;
  display_name?: string;
  role: UserRole;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post('/auth/login', { username, password });
  return data;
}

export async function fetchMe(): Promise<Omit<LoginResponse, 'token'>> {
  const { data } = await api.get('/auth/me');
  return data;
}

export async function fetchAuthApps(): Promise<{ apps: AuthAppRow[] }> {
  const { data } = await api.get('/auth/apps');
  return data;
}

export async function createAuthApp(name: string): Promise<{ app: AuthAppRow; app_roles: LoginResponse['app_roles'] }> {
  const { data } = await api.post('/auth/apps', { name });
  return data;
}

export async function createUser(payload: CreateUserPayload): Promise<unknown> {
  const { data } = await api.post('/admin/users', payload);
  return data;
}

export async function fetchUsers(): Promise<unknown> {
  const { data } = await api.get('/admin/users');
  return data;
}

export async function updateUserRole(userId: number, role: UserRole): Promise<unknown> {
  const { data } = await api.patch(`/admin/users/${userId}/role`, { role });
  return data;
}

export async function updateUserStatus(userId: number, isActive: boolean): Promise<unknown> {
  const { data } = await api.patch(`/admin/users/${userId}/status`, { is_active: isActive });
  return data;
}

export async function fetchHealth(): Promise<{status: string; db: string; worker_mode: boolean}> {
  const { data } = await api.get('/health');
  return data;
}

export async function fetchJobs(limit = 50, filters?: JobsFilterParams): Promise<unknown> {
  const params = new URLSearchParams();
  params.set('limit', String(limit));

  if (filters?.campaign) {
    params.set('campaign', filters.campaign);
  }

  if (filters?.platform) {
    params.set('platform', filters.platform);
  }

  const { data } = await api.get(`/admin/jobs?${params.toString()}`);
  return data;
}

export async function fetchClickEvents(limit = 50): Promise<unknown> {
  const { data } = await api.get(`/admin/click-events?limit=${limit}`);
  return data;
}

export async function fetchPlatformConfigs(): Promise<unknown> {
  const { data } = await api.get('/admin/platform-configs');
  return data;
}

export async function savePlatformConfig(platform: Platform, payload: PlatformConfigPayload): Promise<unknown> {
  const { data } = await api.patch(`/admin/platform-configs/${platform}`, payload);
  return data;
}

export async function fetchPlatformPixels(): Promise<unknown> {
  const { data } = await api.get('/admin/platform-pixels');
  return data;
}

export async function createPlatformPixel(platform: Platform, payload: PlatformPixelPayload): Promise<unknown> {
  const { data } = await api.post(`/admin/platform-pixels/${platform}`, payload);
  return data;
}

export async function updatePlatformPixel(pixelId: number, payload: PlatformPixelPayload): Promise<unknown> {
  const { data } = await api.patch(`/admin/platform-pixels/${pixelId}`, payload);
  return data;
}

export async function deletePlatformPixel(pixelId: number): Promise<unknown> {
  const { data } = await api.delete(`/admin/platform-pixels/${pixelId}`);
  return data;
}

export async function sendSdkEvent(payload: SdkEventPayload): Promise<unknown> {
  const { data } = await api.post('/admin/sdk/events', payload);
  return data;
}

export async function fetchRules(): Promise<unknown> {
  const { data } = await api.get('/admin/attribution-rules');
  return data;
}

export async function createRule(payload: AttributionRulePayload): Promise<unknown> {
  const { data } = await api.post('/admin/attribution-rules', payload);
  return data;
}

export async function activateRule(version: number): Promise<unknown> {
  const { data } = await api.post(`/admin/attribution-rules/${version}/activate`);
  return data;
}

export async function fetchMappings(): Promise<unknown> {
  const { data } = await api.get('/admin/event-mappings');
  return data;
}

export async function saveMapping(platform: Platform, internalEventName: string, platformEventName: string): Promise<unknown> {
  const { data } = await api.put(`/admin/event-mappings/${platform}`, {
    internal_event_name: internalEventName,
    platform_event_name: platformEventName,
    is_active: true
  });
  return data;
}

export async function fetchSqlQueries(): Promise<unknown> {
  const { data } = await api.get('/admin/analytics/sql-queries');
  return data;
}

export async function saveSqlQuery(queryName: string, sqlTemplate: string): Promise<unknown> {
  const { data } = await api.put(`/admin/analytics/sql-queries/${queryName}`, {
    sql_template: sqlTemplate,
    activate: true
  });
  return data;
}

export async function runAnalytics(queryName: string, from: string, to: string): Promise<unknown> {
  const { data } = await api.get(`/admin/analytics/run/${queryName}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  return data;
}

export function buildTrackingUrl(params: {
  appKey: string;
  redirect: string;
  platform?: string;
  ttclid?: string;
  fbc?: string;
  campaign?: string;
  appendClickId?: boolean;
}): string {
  const base = import.meta.env.VITE_TRACK_BASE || window.location.origin;
  const url = new URL('/track/click', base);
  url.searchParams.set('app_key', params.appKey);
  url.searchParams.set('redirect', params.redirect);

  if (params.platform) url.searchParams.set('platform', params.platform);
  if (params.ttclid) url.searchParams.set('ttclid', params.ttclid);
  if (params.fbc) url.searchParams.set('fbc', params.fbc);
  if (params.campaign) url.searchParams.set('campaign', params.campaign);
  if (params.appendClickId) url.searchParams.set('append_click_id', 'true');

  return url.toString();
}
