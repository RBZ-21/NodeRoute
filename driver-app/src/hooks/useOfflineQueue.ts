import { useCallback, useEffect, useRef, useState } from 'react';
import type { OfflineStatusConflict, QueuedStatusAction, StatusAction } from '@/types';

const OFFLINE_STATUS_DB_NAME = 'noderoute-driver-offline-status';
const OFFLINE_STATUS_STORE_NAME = 'queues';
const OFFLINE_STATUS_QUEUE_RECORD_KEY = 'offlineStatusQueue';
export const OFFLINE_STATUS_QUEUE_KEY = 'offlineStatusQueue';
const CONFLICT_STORAGE_KEY = 'offlineStatusConflicts';

type UseOfflineQueueOptions = {
  isOnline: boolean;
  driverId: string | null;
  dispatchQueuedStatus: (entry: QueuedStatusAction) => Promise<void>;
  getServerStatus: (stopId: string) => string | null;
  onQueueChange?: (count: number) => void;
  onSyncStart?: (count: number) => void;
  onSyncComplete?: (count: number) => void;
  onUnauthorized?: () => Promise<void>;
};

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function statusForAction(action: StatusAction) {
  if (action === 'arrived') return 'arrived';
  if (action === 'delivered' || action === 'dropoff') return 'completed';
  if (action === 'failed') return 'failed';
  return 'skipped';
}

function localStorageAvailable() {
  try {
    window.localStorage.setItem('__nr_probe__', '1');
    window.localStorage.removeItem('__nr_probe__');
    return true;
  } catch {
    return false;
  }
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openOfflineStatusDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const request = window.indexedDB.open(OFFLINE_STATUS_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OFFLINE_STATUS_STORE_NAME)) {
        request.result.createObjectStore(OFFLINE_STATUS_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

async function readQueueFromIndexedDb() {
  const db = await openOfflineStatusDb();
  if (!db) return null;

  return new Promise<QueuedStatusAction[] | null>((resolve) => {
    const tx = db.transaction(OFFLINE_STATUS_STORE_NAME, 'readonly');
    const request = tx.objectStore(OFFLINE_STATUS_STORE_NAME).get(OFFLINE_STATUS_QUEUE_RECORD_KEY);
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result as QueuedStatusAction[] : []);
    request.onerror = () => resolve(null);
  });
}

async function writeQueueToIndexedDb(entries: QueuedStatusAction[]) {
  const db = await openOfflineStatusDb();
  if (!db) return false;

  return new Promise<boolean>((resolve) => {
    const tx = db.transaction(OFFLINE_STATUS_STORE_NAME, 'readwrite');
    tx.objectStore(OFFLINE_STATUS_STORE_NAME).put(entries, OFFLINE_STATUS_QUEUE_RECORD_KEY);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

async function readQueueFromLocalStorage() {
  if (!localStorageAvailable()) return [] as QueuedStatusAction[];
  const raw = window.localStorage.getItem(OFFLINE_STATUS_QUEUE_KEY);
  if (!raw) return [] as QueuedStatusAction[];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as QueuedStatusAction[] : [];
  } catch {
    return [] as QueuedStatusAction[];
  }
}

async function writeQueueToLocalStorage(entries: QueuedStatusAction[]) {
  if (!localStorageAvailable()) return;
  window.localStorage.setItem(OFFLINE_STATUS_QUEUE_KEY, JSON.stringify(entries));
}

export async function loadOfflineStatusQueue() {
  const indexedDbEntries = await readQueueFromIndexedDb();
  if (indexedDbEntries) return indexedDbEntries;
  return readQueueFromLocalStorage();
}

async function saveOfflineStatusQueue(entries: QueuedStatusAction[]) {
  const savedToIndexedDb = await writeQueueToIndexedDb(entries);
  if (!savedToIndexedDb) {
    await writeQueueToLocalStorage(entries);
    return;
  }

  if (localStorageAvailable()) {
    window.localStorage.setItem(OFFLINE_STATUS_QUEUE_KEY, JSON.stringify(entries));
  }
}

export async function clearOfflineStatusQueue() {
  await saveOfflineStatusQueue([]);
}

export async function deleteOfflineStatusIndexedDb() {
  dbPromise = null;
  if (!('indexedDB' in window)) return;

  await new Promise<void>((resolve) => {
    const request = window.indexedDB.deleteDatabase(OFFLINE_STATUS_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

function loadConflicts() {
  const raw = window.localStorage.getItem(CONFLICT_STORAGE_KEY);
  if (!raw) return [] as OfflineStatusConflict[];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as OfflineStatusConflict[] : [];
  } catch {
    return [] as OfflineStatusConflict[];
  }
}

function saveConflicts(conflicts: OfflineStatusConflict[]) {
  window.localStorage.setItem(CONFLICT_STORAGE_KEY, JSON.stringify(conflicts));
}

export function clearOfflineStatusConflicts() {
  window.localStorage.removeItem(CONFLICT_STORAGE_KEY);
}

function getConflictServerStatus(error: unknown, fallback: string | null) {
  const candidate = error as { details?: Record<string, unknown>; payload?: Record<string, unknown> };
  const details = candidate.details || candidate.payload || {};
  const serverStatus = details.serverStatus || details.server_status || details.currentStatus || details.current_status;
  return typeof serverStatus === 'string' && serverStatus.trim() ? serverStatus : fallback || 'unknown';
}

export function useOfflineQueue({
  isOnline,
  driverId,
  dispatchQueuedStatus,
  getServerStatus,
  onQueueChange,
  onSyncStart,
  onSyncComplete,
  onUnauthorized,
}: UseOfflineQueueOptions) {
  const [queuedStatusCount, setQueuedStatusCount] = useState(0);
  const [statusConflicts, setStatusConflicts] = useState<OfflineStatusConflict[]>(() => loadConflicts());
  const drainingRef = useRef(false);

  const updateQueue = useCallback(async (entries: QueuedStatusAction[]) => {
    await saveOfflineStatusQueue(entries);
    setQueuedStatusCount(entries.length);
    onQueueChange?.(entries.length);
  }, [onQueueChange]);

  useEffect(() => {
    void loadOfflineStatusQueue().then((entries) => {
      setQueuedStatusCount(entries.length);
      onQueueChange?.(entries.length);
    });
  }, [onQueueChange]);

  const enqueueStatusAction = useCallback(async (
    stopId: string,
    action: StatusAction,
    payload: Record<string, unknown> = {},
    id = crypto.randomUUID(),
  ) => {
    const entry: QueuedStatusAction = {
      id,
      stopId,
      action,
      payload,
      timestamp: Date.now(),
      driverId: driverId || 'unknown-driver',
    };
    const current = await loadOfflineStatusQueue();
    const nextQueue = [...current, entry];
    await updateQueue(nextQueue);
    return entry;
  }, [driverId, updateQueue]);

  const recordConflict = useCallback((entry: QueuedStatusAction, error: unknown) => {
    const conflict = {
      stopId: entry.stopId,
      localStatus: statusForAction(entry.action),
      serverStatus: getConflictServerStatus(error, getServerStatus(entry.stopId)),
      timestamp: Date.now(),
      action: entry.action,
      payload: entry.payload,
    } satisfies OfflineStatusConflict;

    console.warn('[offline-status-conflict]', {
      stopId: conflict.stopId,
      localStatus: conflict.localStatus,
      serverStatus: conflict.serverStatus,
      timestamp: conflict.timestamp,
    });

    setStatusConflicts((current) => {
      const next = [...current.filter((item) => item.stopId !== conflict.stopId), conflict];
      saveConflicts(next);
      return next;
    });
  }, [getServerStatus]);

  const drainOfflineStatusQueue = useCallback(async () => {
    if (!isOnline || drainingRef.current) return;
    const queued = await loadOfflineStatusQueue();
    if (!queued.length) return;

    drainingRef.current = true;
    onSyncStart?.(queued.length);
    const remaining: QueuedStatusAction[] = [];
    let syncedCount = 0;

    for (let index = 0; index < queued.length; index += 1) {
      const entry = queued[index];
      try {
        await dispatchQueuedStatus(entry);
        syncedCount += 1;
        await updateQueue(queued.slice(index + 1));
        await delay(50);
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 401) {
          remaining.push(...queued.slice(index));
          await updateQueue(remaining);
          if (onUnauthorized) await onUnauthorized();
          drainingRef.current = false;
          return;
        }
        if (status === 409) {
          recordConflict(entry, error);
          remaining.push(...queued.slice(index + 1));
          await updateQueue(remaining);
          await delay(50);
          continue;
        }

        remaining.push(...queued.slice(index));
        await updateQueue(remaining);
        drainingRef.current = false;
        return;
      }
    }

    await updateQueue([]);
    drainingRef.current = false;
    onSyncComplete?.(syncedCount);
  }, [dispatchQueuedStatus, isOnline, onSyncComplete, onSyncStart, onUnauthorized, recordConflict, updateQueue]);

  useEffect(() => {
    if (isOnline) {
      void drainOfflineStatusQueue();
    }
  }, [drainOfflineStatusQueue, isOnline]);

  const resolveStatusConflict = useCallback((stopId: string, resolution: 'keep-local' | 'accept-server') => {
    const conflict = statusConflicts.find((item) => item.stopId === stopId);
    if (!conflict) return null;

    setStatusConflicts((current) => {
      const next = current.filter((item) => item.stopId !== stopId);
      saveConflicts(next);
      return next;
    });

    return {
      resolution,
      conflict,
    };
  }, [statusConflicts]);

  return {
    queuedStatusCount,
    statusConflicts,
    enqueueStatusAction,
    drainOfflineStatusQueue,
    resolveStatusConflict,
  };
}
