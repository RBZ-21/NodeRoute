import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ApiError,
  deferStop,
  fetchBootstrapData,
  fetchInvoicePdf,
  login as loginRequest,
  logout as logoutRequest,
  markStopArrived,
  markStopDeparted,
  patchDeliveryStatus,
  patchStop,
  submitTemperatureLog,
  uploadProofOfDelivery,
} from '@/lib/api';
import {
  clearAllStopDrafts,
  clearStopDraft,
  clearOfflineRoutePackStatus,
  clearQueuedStopNoteUpdates,
  clearQueuedTemperatureLogs,
  clearCache,
  clearSelectedRouteId,
  clearToken,
  clearUser,
  enqueueStopNoteUpdate,
  enqueueTemperatureLog,
  loadOfflineRoutePackStatus,
  loadCache,
  loadQueuedStopNoteUpdates,
  loadQueuedTemperatureLogs,
  listStopDrafts,
  loadSelectedRouteId,
  loadToken,
  loadUser,
  saveOfflineRoutePackStatus,
  saveQueuedStopNoteUpdates,
  saveCache,
  saveQueuedTemperatureLogs,
  saveSelectedRouteId,
  saveToken,
  saveUser,
} from '@/lib/storage';
import { extractStopItems, findLinkedDelivery, getCurrentRoute, getRouteInvoices, isArrivedStatus, isDeliveredStatus } from '@/lib/utils';
import type { BootstrapPayload, DriverInvoice, DriverRoute, DriverStop, DriverUser, OfflineRoutePackStatus, StopDraft } from '@/types';
import { useToast } from '@/hooks/useToast';

type DriverAppContextValue = {
  token: string | null;
  user: DriverUser | null;
  routes: DriverRoute[];
  invoices: DriverInvoice[];
  selectedRouteId: string | null;
  currentRoute: DriverRoute | null;
  routeInvoices: DriverInvoice[];
  loading: boolean;
  refreshing: boolean;
  usingCachedData: boolean;
  isOnline: boolean;
  lastSyncedAt: string | null;
  queuedTemperatureLogCount: number;
  queuedStopNoteCount: number;
  stopDrafts: StopDraft[];
  preparingOfflineRoute: boolean;
  offlineRoutePackStatus: OfflineRoutePackStatus | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshData: (silent?: boolean) => Promise<void>;
  prepareOfflineRoute: () => Promise<void>;
  saveStopNotes: (stopId: string, notes: string) => Promise<void>;
  syncOfflineWork: () => Promise<void>;
  clearOfflineDraft: (stopId: string) => void;
  clearOfflineDrafts: () => void;
  refreshOfflineDrafts: () => void;
  setSelectedRouteId: (routeId: string) => void;
  stopById: (stopId: string) => DriverStop | null;
  stopItems: (stop: DriverStop) => string[];
  markArrived: (stop: DriverStop) => Promise<void>;
  deferStopToEnd: (stop: DriverStop) => Promise<void>;
  markDelivered: (stop: DriverStop, proofImage: string | null, notes: string) => Promise<void>;
  markFailed: (stop: DriverStop, notes: string) => Promise<void>;
  openInvoicePdf: (invoiceId: string) => Promise<void>;
  submitLog: (payload: Record<string, unknown>) => Promise<void>;
};

const DriverAppContext = createContext<DriverAppContextValue | null>(null);

async function openBlobInNewTab(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = window.open(url, '_blank', 'noopener,noreferrer');
  if (!link) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function DriverAppProvider({ children }: { children: ReactNode }) {
  const { pushToast } = useToast();
  const [token, setToken] = useState<string | null>(() => loadToken());
  const [user, setUser] = useState<DriverUser | null>(() => loadUser());
  const [payload, setPayload] = useState<BootstrapPayload | null>(() => loadCache());
  const [selectedRouteId, setSelectedRouteIdState] = useState<string | null>(() => loadSelectedRouteId());
  const [loading, setLoading] = useState(() => !!loadToken());
  const [refreshing, setRefreshing] = useState(false);
  const [usingCachedData, setUsingCachedData] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [queuedTemperatureLogCount, setQueuedTemperatureLogCount] = useState(() => loadQueuedTemperatureLogs().length);
  const [queuedStopNoteCount, setQueuedStopNoteCount] = useState(() => loadQueuedStopNoteUpdates().length);
  const [stopDrafts, setStopDrafts] = useState<StopDraft[]>(() => listStopDrafts());
  const [preparingOfflineRoute, setPreparingOfflineRoute] = useState(false);
  const [offlineRoutePackStatus, setOfflineRoutePackStatus] = useState<OfflineRoutePackStatus | null>(() => loadOfflineRoutePackStatus());

  const routes = payload?.routes || [];
  const invoices = payload?.invoices || [];
  const deliveries = payload?.deliveries || [];
  const currentRoute = getCurrentRoute(routes, selectedRouteId);
  const routeInvoices = getRouteInvoices(currentRoute, invoices);
  const lastSyncedAt = payload?.cachedAt || null;

  useEffect(() => {
    if (!token) return;
    void refreshData(true);
  }, [token]);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      void flushQueuedTemperatureLogs();
      void flushQueuedStopNoteUpdates();
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  function applyStopPatchLocally(stopId: string, update: Partial<DriverStop>) {
    setPayload((current) => {
      if (!current) return current;
      const nextPayload = {
        ...current,
        routes: current.routes.map((route) => ({
          ...route,
          stops: route.stops.map((stop) => (
            stop.id === stopId
              ? { ...stop, ...update }
              : stop
          )),
        })),
      };
      saveCache(nextPayload);
      return nextPayload;
    });
  }

  function refreshStopDrafts() {
    setStopDrafts(listStopDrafts());
  }

  async function flushQueuedTemperatureLogs() {
    const queuedLogs = loadQueuedTemperatureLogs();
    if (!queuedLogs.length || !token) return;

    const remaining = [];
    let flushedCount = 0;

    for (let index = 0; index < queuedLogs.length; index += 1) {
      const entry = queuedLogs[index];
      try {
        await submitTemperatureLog(entry.payload);
        flushedCount += 1;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await logout();
          return;
        }
        remaining.push(...queuedLogs.slice(index));
        break;
      }
    }

    if (remaining.length) {
      saveQueuedTemperatureLogs(remaining);
      setQueuedTemperatureLogCount(remaining.length);
    } else {
      clearQueuedTemperatureLogs();
      setQueuedTemperatureLogCount(0);
    }

    if (flushedCount > 0) {
      pushToast(
        flushedCount === 1
          ? '1 queued temperature log synced.'
          : `${flushedCount} queued temperature logs synced.`,
        'success',
      );
    }
  }

  async function flushQueuedStopNoteUpdates() {
    const queuedUpdates = loadQueuedStopNoteUpdates();
    if (!queuedUpdates.length || !token) return;

    const remaining = [];
    let flushedCount = 0;

    for (let index = 0; index < queuedUpdates.length; index += 1) {
      const entry = queuedUpdates[index];
      try {
        await patchStop(entry.stopId, { driver_notes: entry.driverNotes });
        applyStopPatchLocally(entry.stopId, { driver_notes: entry.driverNotes });
        flushedCount += 1;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await logout();
          return;
        }
        remaining.push(...queuedUpdates.slice(index));
        break;
      }
    }

    if (remaining.length) {
      saveQueuedStopNoteUpdates(remaining);
      setQueuedStopNoteCount(remaining.length);
    } else {
      clearQueuedStopNoteUpdates();
      setQueuedStopNoteCount(0);
    }

    if (flushedCount > 0) {
      pushToast(
        flushedCount === 1
          ? '1 queued stop note synced.'
          : `${flushedCount} queued stop notes synced.`,
        'success',
      );
    }
  }

  async function refreshData(silent = false) {
    if (!token) return;
    if (silent) setLoading(true);
    setRefreshing(!silent);

    try {
      const nextPayload = await fetchBootstrapData();
      const stampedPayload = {
        ...nextPayload,
        cachedAt: nextPayload.cachedAt || new Date().toISOString(),
      };
      setPayload(stampedPayload);
      saveCache(stampedPayload);
      setUsingCachedData(false);
      if (queuedTemperatureLogCount > 0) {
        void flushQueuedTemperatureLogs();
      }
      if (queuedStopNoteCount > 0) {
        void flushQueuedStopNoteUpdates();
      }

      if (!selectedRouteId && stampedPayload.routes[0]?.id) {
        setSelectedRouteIdState(stampedPayload.routes[0].id);
        saveSelectedRouteId(stampedPayload.routes[0].id);
      }
    } catch (error) {
      const cached = loadCache();
      if (cached) {
        setPayload(cached);
        setUsingCachedData(true);
        if (!silent) {
          pushToast('Offline mode: showing your last synced route.', 'info');
        }
      } else if (error instanceof ApiError && error.status === 401) {
        await logout();
      } else {
        pushToast(error instanceof Error ? error.message : 'Unable to refresh route data.', 'error');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function login(email: string, password: string) {
    const response = await loginRequest(email, password);
    saveToken(response.token);
    saveUser(response.user);
    setToken(response.token);
    setUser(response.user);
    pushToast(`Welcome back, ${response.user.name || 'driver'}.`, 'success');
  }

  async function logout() {
    try {
      if (token) await logoutRequest();
    } catch {
      // Clear local state even if the network call fails.
    } finally {
      clearToken();
      clearUser();
      clearCache();
      clearSelectedRouteId();
      clearQueuedTemperatureLogs();
      clearOfflineRoutePackStatus();
      clearQueuedStopNoteUpdates();
      clearAllStopDrafts();
      setToken(null);
      setUser(null);
      setPayload(null);
      setSelectedRouteIdState(null);
      setQueuedTemperatureLogCount(0);
      setQueuedStopNoteCount(0);
      setStopDrafts([]);
      setOfflineRoutePackStatus(null);
    }
  }

  function setSelectedRouteId(routeId: string) {
    setSelectedRouteIdState(routeId);
    saveSelectedRouteId(routeId);
  }

  function stopById(stopId: string) {
    return routes.flatMap((route) => route.stops).find((stop) => stop.id === stopId) || null;
  }

  function stopItems(stop: DriverStop) {
    return extractStopItems(stop, invoices, deliveries);
  }

  async function markArrived(stop: DriverStop) {
    await markStopArrived(stop.id);
    const linkedDelivery = findLinkedDelivery(stop, deliveries);
    if (linkedDelivery?.orderDbId) {
      try {
        await patchDeliveryStatus(linkedDelivery.orderDbId, 'in-transit');
      } catch {
        // Stop arrival is the source of truth; delivery status is best-effort.
      }
    }
    pushToast(`Marked ${stop.name || 'stop'} as arrived.`, 'success');
    await refreshData(true);
  }

  async function deferStopToEnd(stop: DriverStop) {
    await deferStop(stop.id);
    pushToast(`Skipped ${stop.name || 'stop'} to the end of the route.`, 'success');
    await refreshData(true);
  }

  async function markDelivered(stop: DriverStop, proofImage: string | null, notes: string) {
    if (stop.invoice_id && !stop.invoice_has_proof_of_delivery && !proofImage) {
      throw new Error('Add a proof-of-delivery photo before marking this stop delivered.');
    }

    if (proofImage && stop.invoice_id) {
      await uploadProofOfDelivery(stop.invoice_id, proofImage);
    }

    if (notes.trim()) {
      await patchStop(stop.id, { driver_notes: notes.trim() });
    }

    if (!isArrivedStatus(stop.status) && !isDeliveredStatus(stop.status)) {
      try {
        await markStopArrived(stop.id);
      } catch {
        // If an open dwell record already exists we can still continue to completion.
      }
    }

    try {
      await markStopDeparted(stop.id);
    } catch {
      await patchStop(stop.id, { status: 'completed' });
    }

    const linkedDelivery = findLinkedDelivery(stop, deliveries);
    if (linkedDelivery?.orderDbId) {
      try {
        await patchDeliveryStatus(linkedDelivery.orderDbId, 'delivered');
      } catch {
        // Delivery status sync is best-effort.
      }
    }

    pushToast(`Marked ${stop.name || 'stop'} as delivered.`, 'success');
    await refreshData(true);
  }

  async function markFailed(stop: DriverStop, notes: string) {
    await patchStop(stop.id, {
      status: 'failed',
      driver_notes: notes.trim() || `Marked failed at ${new Date().toLocaleTimeString()}`,
    });
    pushToast(`Marked ${stop.name || 'stop'} as failed.`, 'success');
    await refreshData(true);
  }

  async function openInvoicePdf(invoiceId: string) {
    const blob = await fetchInvoicePdf(invoiceId);
    await openBlobInNewTab(blob, `invoice-${invoiceId}.pdf`);
  }

  async function submitLog(payload: Record<string, unknown>) {
    if (!navigator.onLine) {
      enqueueTemperatureLog({
        id: `temp-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        payload,
      });
      const nextCount = loadQueuedTemperatureLogs().length;
      setQueuedTemperatureLogCount(nextCount);
      pushToast('Offline: temperature log queued for sync.', 'info');
      return;
    }

    try {
      await submitTemperatureLog(payload);
      pushToast('Temperature log saved.', 'success');
    } catch (error) {
      if (!(error instanceof ApiError)) {
        enqueueTemperatureLog({
          id: `temp-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          payload,
        });
        const nextCount = loadQueuedTemperatureLogs().length;
        setQueuedTemperatureLogCount(nextCount);
        pushToast('Signal dropped: temperature log queued for sync.', 'info');
        return;
      }
      throw error;
    }
  }

  async function saveStopNotes(stopId: string, notes: string) {
    const trimmedNotes = notes.trim();
    if (!navigator.onLine) {
      enqueueStopNoteUpdate({
        id: `stop-note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        stopId,
        createdAt: new Date().toISOString(),
        driverNotes: trimmedNotes,
      });
      applyStopPatchLocally(stopId, { driver_notes: trimmedNotes });
      const nextCount = loadQueuedStopNoteUpdates().length;
      setQueuedStopNoteCount(nextCount);
      refreshStopDrafts();
      pushToast('Offline: stop notes queued for sync.', 'info');
      return;
    }

    try {
      await patchStop(stopId, { driver_notes: trimmedNotes });
      applyStopPatchLocally(stopId, { driver_notes: trimmedNotes });
      pushToast('Stop notes saved.', 'success');
    } catch (error) {
      if (!(error instanceof ApiError)) {
        enqueueStopNoteUpdate({
          id: `stop-note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          stopId,
          createdAt: new Date().toISOString(),
          driverNotes: trimmedNotes,
        });
        applyStopPatchLocally(stopId, { driver_notes: trimmedNotes });
        const nextCount = loadQueuedStopNoteUpdates().length;
        setQueuedStopNoteCount(nextCount);
        refreshStopDrafts();
        pushToast('Signal dropped: stop notes queued for sync.', 'info');
        return;
      }
      throw error;
    }
  }

  async function prepareOfflineRoute() {
    if (!currentRoute) {
      throw new Error('There is no active route to save offline.');
    }

    setPreparingOfflineRoute(true);
    try {
      if (navigator.onLine) {
        await refreshData(true);
      }

      const latestPayload = loadCache() || payload;
      const latestRoute = getCurrentRoute(latestPayload?.routes || [], currentRoute.id);
      const invoicesToCache = getRouteInvoices(latestRoute, latestPayload?.invoices || []);
      for (const invoice of invoicesToCache) {
        await fetchInvoicePdf(invoice.id);
      }

      const nextStatus = {
        routeId: currentRoute.id,
        preparedAt: new Date().toISOString(),
        invoiceCount: invoicesToCache.length,
      } satisfies OfflineRoutePackStatus;
      saveOfflineRoutePackStatus(nextStatus);
      setOfflineRoutePackStatus(nextStatus);
      pushToast(
        invoicesToCache.length
          ? `Offline pack ready with ${invoicesToCache.length} invoice PDF${invoicesToCache.length === 1 ? '' : 's'}.`
          : 'Offline pack ready. Route details are cached for this run.',
        'success',
      );
    } finally {
      setPreparingOfflineRoute(false);
    }
  }

  async function syncOfflineWork() {
    if (!navigator.onLine) {
      throw new Error('Reconnect to the internet before syncing queued driver work.');
    }

    await refreshData(true);
    await flushQueuedTemperatureLogs();
    await flushQueuedStopNoteUpdates();
    pushToast('Offline work sync complete.', 'success');
  }

  function clearOfflineDrafts() {
    clearAllStopDrafts();
    setStopDrafts([]);
    pushToast('Offline stop drafts cleared from this device.', 'info');
  }

  function clearOfflineDraft(stopId: string) {
    clearStopDraft(stopId);
    refreshStopDrafts();
    pushToast('Saved stop draft cleared from this device.', 'info');
  }

  return (
    <DriverAppContext.Provider
      value={{
        token,
        user,
        routes,
        invoices,
        selectedRouteId,
        currentRoute,
        routeInvoices,
        loading,
        refreshing,
        usingCachedData,
        isOnline,
        lastSyncedAt,
        queuedTemperatureLogCount,
        queuedStopNoteCount,
        stopDrafts,
        preparingOfflineRoute,
        offlineRoutePackStatus,
        login,
        logout,
        refreshData,
        prepareOfflineRoute,
        saveStopNotes,
        syncOfflineWork,
        clearOfflineDraft,
        clearOfflineDrafts,
        refreshOfflineDrafts: refreshStopDrafts,
        setSelectedRouteId,
        stopById,
        stopItems,
        markArrived,
        deferStopToEnd,
        markDelivered,
        markFailed,
        openInvoicePdf,
        submitLog,
      }}
    >
      {children}
    </DriverAppContext.Provider>
  );
}

export function useDriverApp() {
  const context = useContext(DriverAppContext);
  if (!context) throw new Error('useDriverApp must be used inside DriverAppProvider');
  return context;
}
