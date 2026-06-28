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
export const POD_DRAFT_PHOTO_DB_NAME = 'noderoute-driver-pod-drafts';

const POD_DRAFT_PHOTO_STORE_NAME = 'photos';
const POD_DRAFT_PHOTO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type TokenStore = {
  token?: string;
  refreshToken?: string;
};

type PodDraftPhotoRecord = {
  id: string;
  stopId: string;
  blob: Blob;
  mimeType: string;
  createdAt: number;
  expiresAt: number;
};

let tokenCache: TokenStore = {};
let podDraftPhotoDbPromise: Promise<IDBDatabase | null> | null = null;

function indexedDbAvailable() {
  return typeof window !== 'undefined' && 'indexedDB' in window && !!window.indexedDB;
}

function openPodDraftPhotoDb() {
  if (!indexedDbAvailable()) return Promise.resolve(null);
  if (podDraftPhotoDbPromise) return podDraftPhotoDbPromise;

  podDraftPhotoDbPromise = new Promise((resolve) => {
    const request = window.indexedDB.open(POD_DRAFT_PHOTO_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(POD_DRAFT_PHOTO_STORE_NAME)) {
        db.createObjectStore(POD_DRAFT_PHOTO_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return podDraftPhotoDbPromise;
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read proof image draft.'));
    reader.readAsDataURL(blob);
  });
}

function sanitizeStopDraftForLocalStorage(draft: StopDraft): StopDraft {
  return {
    ...draft,
    proofImage: null,
    proofImageDraftId: draft.proofImageDraftId || null,
  };
}

function sanitizeStopDraftMap(map: Record<string, StopDraft>) {
  return Object.fromEntries(
    Object.entries(map).map(([stopId, draft]) => [stopId, sanitizeStopDraftForLocalStorage(draft)])
  ) as Record<string, StopDraft>;
}

export async function savePodDraftPhoto(stopId: string, dataUrl: string, existingId?: string | null) {
  const db = await openPodDraftPhotoDb();
  if (!db) return null;

  const id = existingId || `pod-${stopId}-${crypto.randomUUID()}`;
  const blob = await dataUrlToBlob(dataUrl);
  const now = Date.now();
  const record: PodDraftPhotoRecord = {
    id,
    stopId,
    blob,
    mimeType: blob.type || 'image/jpeg',
    createdAt: now,
    expiresAt: now + POD_DRAFT_PHOTO_TTL_MS,
  };

  return new Promise<string | null>((resolve) => {
    const tx = db.transaction(POD_DRAFT_PHOTO_STORE_NAME, 'readwrite');
    tx.objectStore(POD_DRAFT_PHOTO_STORE_NAME).put(record);
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => resolve(null);
  });
}

export async function loadPodDraftPhoto(id: string) {
  const db = await openPodDraftPhotoDb();
  if (!db) return null;

  const record = await new Promise<PodDraftPhotoRecord | null>((resolve) => {
    const tx = db.transaction(POD_DRAFT_PHOTO_STORE_NAME, 'readonly');
    const request = tx.objectStore(POD_DRAFT_PHOTO_STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
  if (!record) return null;
  if (record.expiresAt <= Date.now()) {
    await deletePodDraftPhoto(id);
    return null;
  }

  return blobToDataUrl(record.blob);
}

export async function deletePodDraftPhoto(id: string) {
  const db = await openPodDraftPhotoDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const tx = db.transaction(POD_DRAFT_PHOTO_STORE_NAME, 'readwrite');
    tx.objectStore(POD_DRAFT_PHOTO_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function clearPodDraftPhotos() {
  const db = await openPodDraftPhotoDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const tx = db.transaction(POD_DRAFT_PHOTO_STORE_NAME, 'readwrite');
    tx.objectStore(POD_DRAFT_PHOTO_STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function clearExpiredPodDraftPhotos() {
  const db = await openPodDraftPhotoDb();
  if (!db) return;
  const now = Date.now();

  await new Promise<void>((resolve) => {
    const tx = db.transaction(POD_DRAFT_PHOTO_STORE_NAME, 'readwrite');
    const store = tx.objectStore(POD_DRAFT_PHOTO_STORE_NAME);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as PodDraftPhotoRecord;
      if (record.expiresAt <= now) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function deleteLegacyTokenDb() {
  return new Promise<void>((resolve) => {
    if (!indexedDbAvailable()) {
      resolve();
      return;
    }
    const request = window.indexedDB.deleteDatabase('noderoute-driver-auth');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export async function initializeTokenStorage() {
  tokenCache = {};
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  await deleteLegacyTokenDb();
  return tokenCache;
}

export function loadToken() {
  return null;
}

export async function loadTokenAsync() {
  return null;
}

export function loadRefreshToken() {
  return null;
}

export async function loadRefreshTokenAsync() {
  return null;
}

export async function saveToken(token: string, refreshToken?: string) {
  tokenCache = {};
  void token;
  void refreshToken;
}

export async function clearToken() {
  tokenCache = {};
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  await deleteLegacyTokenDb();
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
    if (!parsed || typeof parsed !== 'object') return {};
    const sanitized = sanitizeStopDraftMap(parsed as Record<string, StopDraft>);
    if (JSON.stringify(sanitized) !== JSON.stringify(parsed)) {
      saveStopDraftMap(sanitized);
    }
    return sanitized;
  } catch {
    return {};
  }
}

function saveStopDraftMap(map: Record<string, StopDraft>) {
  window.localStorage.setItem(STOP_DRAFTS_KEY, JSON.stringify(sanitizeStopDraftMap(map)));
}

export function listStopDrafts() {
  return Object.values(loadStopDraftMap()).sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
}

export function loadStopDraft(stopId: string) {
  return loadStopDraftMap()[stopId] || null;
}

export function saveStopDraft(draft: StopDraft) {
  const map = loadStopDraftMap();
  map[draft.stopId] = sanitizeStopDraftForLocalStorage(draft);
  saveStopDraftMap(map);
}

export function clearStopDraft(stopId: string) {
  const map = loadStopDraftMap();
  const draft = map[stopId];
  if (draft?.proofImageDraftId) void deletePodDraftPhoto(draft.proofImageDraftId);
  delete map[stopId];
  saveStopDraftMap(map);
}

export function clearAllStopDrafts() {
  window.localStorage.removeItem(STOP_DRAFTS_KEY);
  void clearPodDraftPhotos();
}

/**
 * Clear every piece of driver data this module persists on the device: auth
 * tokens, the cached user, the bootstrap/route payload cache, the selected
 * route, all offline queues (temperature logs, stop notes), the offline route
 * pack, stop drafts, and the IndexedDB proof-of-delivery photo store.
 *
 * This is the single source of truth for device cleanup on logout. Any new
 * persisted key MUST be cleared here so sensitive route/customer/POD data does
 * not linger on shared or compromised devices.
 */
// FIX [C1]: collapse duplicate sensitive storage cleanup into one exported function.
export async function clearSensitiveStorage() {
  const { clearOfflineStatusConflicts, clearOfflineStatusQueue, deleteOfflineStatusIndexedDb } = await import('@/hooks/useOfflineQueue');

  // Auth material first (also removes the legacy token IndexedDB).
  await clearToken();
  clearUser();
  // Cached route/customer/invoice payloads and the selected route.
  clearCache();
  clearSelectedRouteId();
  clearOfflineRoutePackStatus();
  // Offline queues that may contain customer-identifying actions.
  clearQueuedTemperatureLogs();
  clearQueuedStopNoteUpdates();
  // Stop drafts in localStorage + proof photos in IndexedDB.
  clearAllStopDrafts();
  clearOfflineStatusConflicts();
  await clearOfflineStatusQueue();
  await deleteOfflineStatusIndexedDb();
  await clearPodDraftPhotos();
  await deleteLegacyTokenDb();
}

export const DRIVER_LOCAL_DATA_RETENTION_NOTICE =
  'Route details, stop notes, proof photos, and queued actions are stored on this device until they sync or you log out. Sign out to remove them from shared devices.';
