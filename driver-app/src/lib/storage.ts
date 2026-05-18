import type { BootstrapPayload, DriverUser, OfflineRoutePackStatus, QueuedStopNoteUpdate, QueuedTemperatureLog, StopDraft } from '@/types';

export const TOKEN_STORAGE_KEY = 'nr_driver_token';
export const REFRESH_TOKEN_STORAGE_KEY = 'nr_driver_refresh_token';
export const USER_STORAGE_KEY = 'nr_driver_user';
export const CACHE_STORAGE_KEY = 'nr_driver_cache';
export const ROUTE_STORAGE_KEY = 'nr_driver_route';
export const TEMPERATURE_LOG_QUEUE_KEY = 'nr_driver_temperature_log_queue';
export const OFFLINE_ROUTE_PACK_KEY = 'nr_driver_offline_route_pack';
export const STOP_NOTE_QUEUE_KEY = 'nr_driver_stop_note_queue';
export const STOP_DRAFTS_KEY = 'nr_driver_stop_drafts';

type TokenStore = {
  token?: string;
  refreshToken?: string;
};

let tokenCache: TokenStore = {};
let tokenDbPromise: Promise<IDBDatabase> | null = null;

function openTokenDb() {
  if (tokenDbPromise) return tokenDbPromise;
  tokenDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open('noderoute-driver-auth', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('tokens');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return tokenDbPromise;
}

async function readTokenValue(key: string) {
  const db = await openTokenDb();
  return new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction('tokens', 'readonly');
    const request = tx.objectStore('tokens').get(key);
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
    request.onerror = () => reject(request.error);
  });
}

async function writeTokenValue(key: string, value: string) {
  const db = await openTokenDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('tokens', 'readwrite');
    tx.objectStore('tokens').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteTokenValue(key: string) {
  const db = await openTokenDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('tokens', 'readwrite');
    tx.objectStore('tokens').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function initializeTokenStorage() {
  const legacyToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
  if (legacyToken) {
    await writeTokenValue(TOKEN_STORAGE_KEY, legacyToken);
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }

  tokenCache = {
    token: await readTokenValue(TOKEN_STORAGE_KEY) || undefined,
    refreshToken: await readTokenValue(REFRESH_TOKEN_STORAGE_KEY) || undefined,
  };
  return tokenCache;
}

export function loadToken() {
  return tokenCache.token || null;
}

export async function loadTokenAsync() {
  if (tokenCache.token) return tokenCache.token;
  tokenCache.token = await readTokenValue(TOKEN_STORAGE_KEY) || undefined;
  return tokenCache.token || null;
}

export function loadRefreshToken() {
  return tokenCache.refreshToken || null;
}

export async function loadRefreshTokenAsync() {
  if (tokenCache.refreshToken) return tokenCache.refreshToken;
  tokenCache.refreshToken = await readTokenValue(REFRESH_TOKEN_STORAGE_KEY) || undefined;
  return tokenCache.refreshToken || null;
}

export async function saveToken(token: string, refreshToken?: string) {
  tokenCache.token = token;
  await writeTokenValue(TOKEN_STORAGE_KEY, token);
  if (refreshToken) {
    tokenCache.refreshToken = refreshToken;
    await writeTokenValue(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
  }
}

export async function clearToken() {
  tokenCache = {};
  await Promise.all([
    deleteTokenValue(TOKEN_STORAGE_KEY),
    deleteTokenValue(REFRESH_TOKEN_STORAGE_KEY),
  ]);
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
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

export function loadQueuedTemperatureLogs() {
  const raw = window.localStorage.getItem(TEMPERATURE_LOG_QUEUE_KEY);
  if (!raw) return [] as QueuedTemperatureLog[];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as QueuedTemperatureLog[] : [];
  } catch {
    return [];
  }
}

export function saveQueuedTemperatureLogs(entries: QueuedTemperatureLog[]) {
  window.localStorage.setItem(TEMPERATURE_LOG_QUEUE_KEY, JSON.stringify(entries));
}

export function enqueueTemperatureLog(entry: QueuedTemperatureLog) {
  const current = loadQueuedTemperatureLogs();
  current.push(entry);
  saveQueuedTemperatureLogs(current);
}

export function clearQueuedTemperatureLogs() {
  window.localStorage.removeItem(TEMPERATURE_LOG_QUEUE_KEY);
}

export function loadOfflineRoutePackStatus() {
  const raw = window.localStorage.getItem(OFFLINE_ROUTE_PACK_KEY);
  if (!raw) return null as OfflineRoutePackStatus | null;

  try {
    return JSON.parse(raw) as OfflineRoutePackStatus;
  } catch {
    return null;
  }
}

export function saveOfflineRoutePackStatus(status: OfflineRoutePackStatus) {
  window.localStorage.setItem(OFFLINE_ROUTE_PACK_KEY, JSON.stringify(status));
}

export function clearOfflineRoutePackStatus() {
  window.localStorage.removeItem(OFFLINE_ROUTE_PACK_KEY);
}

export function loadQueuedStopNoteUpdates() {
  const raw = window.localStorage.getItem(STOP_NOTE_QUEUE_KEY);
  if (!raw) return [] as QueuedStopNoteUpdate[];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as QueuedStopNoteUpdate[] : [];
  } catch {
    return [];
  }
}

export function saveQueuedStopNoteUpdates(entries: QueuedStopNoteUpdate[]) {
  window.localStorage.setItem(STOP_NOTE_QUEUE_KEY, JSON.stringify(entries));
}

export function enqueueStopNoteUpdate(entry: QueuedStopNoteUpdate) {
  const current = loadQueuedStopNoteUpdates();
  current.push(entry);
  saveQueuedStopNoteUpdates(current);
}

export function clearQueuedStopNoteUpdates() {
  window.localStorage.removeItem(STOP_NOTE_QUEUE_KEY);
}

function loadStopDraftMap() {
  const raw = window.localStorage.getItem(STOP_DRAFTS_KEY);
  if (!raw) return {} as Record<string, StopDraft>;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, StopDraft> : {};
  } catch {
    return {};
  }
}

function saveStopDraftMap(map: Record<string, StopDraft>) {
  window.localStorage.setItem(STOP_DRAFTS_KEY, JSON.stringify(map));
}

export function listStopDrafts() {
  return Object.values(loadStopDraftMap()).sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
}

export function loadStopDraft(stopId: string) {
  return loadStopDraftMap()[stopId] || null;
}

export function saveStopDraft(draft: StopDraft) {
  const map = loadStopDraftMap();
  map[draft.stopId] = draft;
  saveStopDraftMap(map);
}

export function clearStopDraft(stopId: string) {
  const map = loadStopDraftMap();
  delete map[stopId];
  saveStopDraftMap(map);
}

export function clearAllStopDrafts() {
  window.localStorage.removeItem(STOP_DRAFTS_KEY);
}
