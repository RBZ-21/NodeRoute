import type { BootstrapPayload, DriverUser } from '@/types';

export const TOKEN_STORAGE_KEY = 'nr_driver_token';
export const USER_STORAGE_KEY = 'nr_driver_user';
export const CACHE_STORAGE_KEY = 'nr_driver_cache';
export const ROUTE_STORAGE_KEY = 'nr_driver_route';

export function loadToken() {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function saveToken(token: string) {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function loadUser() {
  const raw = window.localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as DriverUser;
  } catch {
    return null;
  }
}

export function saveUser(user: DriverUser) {
  window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function clearUser() {
  window.localStorage.removeItem(USER_STORAGE_KEY);
}

export function loadCache() {
  const raw = window.localStorage.getItem(CACHE_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as BootstrapPayload;
  } catch {
    return null;
  }
}

export function saveCache(payload: BootstrapPayload) {
  window.localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(payload));
}

export function clearCache() {
  window.localStorage.removeItem(CACHE_STORAGE_KEY);
}

export function loadSelectedRouteId() {
  return window.localStorage.getItem(ROUTE_STORAGE_KEY);
}

export function saveSelectedRouteId(routeId: string) {
  window.localStorage.setItem(ROUTE_STORAGE_KEY, routeId);
}

export function clearSelectedRouteId() {
  window.localStorage.removeItem(ROUTE_STORAGE_KEY);
}
