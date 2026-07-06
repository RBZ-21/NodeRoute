import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ApiError,
  deferStop,
  fetchBootstrapData,
  fetchCompanySettings,
  fetchInvoicePdf,
  login as loginRequest,
  logout as logoutRequest,
  markStopArrived,
  markStopDeparted,
  patchDeliveryStatus,
  patchStop,
  saveStopSignature,
  submitTemperatureLog,
  uploadProofOfDelivery,
} from '@/lib/api';
import {
  clearAllStopDrafts,
  clearStopDraft,
  clearQueuedStopNoteUpdates,
  clearQueuedTemperatureLogs,
  clearSensitiveStorage,
  deletePodDraftPhoto,
  enqueueStopNoteUpdate,
  enqueueTemperatureLog,
  loadOfflineRoutePackStatus,
  loadCache,
  loadPodDraftPhoto,
  loadQueuedStopNoteUpdates,
  loadQueuedTemperatureLogs,
  listStopDrafts,
  loadSelectedRouteId,
  loadUser,
  saveOfflineRoutePackStatus,
  savePodDraftPhoto,
  saveQueuedStopNoteUpdates,
  saveCache,
  saveQueuedTemperatureLogs,
  saveSelectedRouteId,
  saveUser,
  initializeTokenStorage,
} from '@/lib/storage';
import { extractStopItems, findLinkedDelivery, getCurrentRoute, getRouteInvoices, isArrivedStatus, isDeliveredStatus } from '@/lib/utils';
import type {
  BootstrapPayload,
  CompanySettings,
  DriverInvoice,
  DriverRoute,
  DriverStop,
  DriverUser,
  OfflineRoutePackStatus,
  OfflineStatusConflict,
  QueuedStatusAction,
  StatusAction,
  StopDraft,
} from '@/types';
import { useToast } from '@/hooks/useToast';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';

const defaultCompanySettings: CompanySettings = {
  forceDriverSignature: false,
  forceDriverProofOfDelivery: false,
  businessName: '',
};

type DriverAppContextValue = {
  token: string | null;
  user: DriverUser | null;
  routes: DriverRoute[];
  invoices: DriverInvoice[];
  companySettings: CompanySettings;
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
  queuedStatusCount: number;
  statusConflicts: OfflineStatusConflict[];
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
  getStopStatusConflict: (stopId: string) => OfflineStatusConflict | null;
  resolveStatusConflict: (stopId: string, resolution: 'keep-local' | 'accept-server') => Promise<void>;
  stopItems: (stop: DriverStop) => string[];
  markArrived: (stop: DriverStop) => Promise<void>;
  deferStopToEnd: (stop: DriverStop) => Promise<void>;
  captureSignature: (stop: DriverStop, signatureData: string, signerName?: string) => Promise<void>;
  markDelivered: (
    stop: DriverStop,
    proofImage: string | null,
    notes: string,
    options?: { deliveryMode?: 'standard' | 'drop_off' }
  ) => Promise<void>;
  markFailed: (stop: DriverStop, reason: string, notes: string) => Promise<void>;
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

function statusForAction(action: StatusAction) {
  if (action === 'arrived') return 'arrived';
  if (action === 'delivered' || action === 'dropoff') return 'completed';
  if (action === 'failed') return 'failed';
  return 'skipped';
}

export function DriverAppProvider({ children }: { children: ReactNode }) {
  const { pushToast } = useToast();
  const [token, setToken] = useState<string | null>(() => loadUser() ? 'cookie-session' : null);
  const [user, setUser] = useState<DriverUser | null>(() => loadUser());
  const [payload, setPayload] = useState<BootstrapPayload | null>(() => loadCache());
  const [selectedRouteId, setSelectedRouteIdState] = useState<string | null>(() => loadSelectedRouteId());
  const [loading, setLoading] = useState(() => !!loadUser());
  const [refreshing, setRefreshing] = useState(false);
  const [usingCachedData, setUsingCachedData] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [queuedTemperatureLogCount, setQueuedTemperatureLogCount] = useState(() => loadQueuedTemperatureLogs().length);
  const [queuedStopNoteCount, setQueuedStopNoteCount] = useState(() => loadQueuedStopNoteUpdates().length);
  const [stopDrafts, setStopDrafts] = useState<StopDraft[]>(() => listStopDrafts());
  const [preparingOfflineRoute, setPreparingOfflineRoute] = useState(false);
  const [offlineRoutePackStatus, setOfflineRoutePackStatus] = useState<OfflineRoutePackStatus | null>(() => loadOfflineRoutePackStatus());
  const [companySettings, setCompanySettings] = useState<CompanySettings>(defaultCompanySettings);

  const routes = payload?.routes || [];
  const invoices = payload?.invoices || [];
  const deliveries = payload?.deliveries || [];
  const currentRoute = getCurrentRoute(routes, selectedRouteId);
  const routeInvoices = getRouteInvoices(currentRoute, invoices);
  const lastSyncedAt = payload?.cachedAt || null;
  const {
    queuedStatusCount,
    statusConflicts,
    enqueueStatusAction,
    drainOfflineStatusQueue,
    resolveStatusConflict: resolveQueuedConflict,
  } = useOfflineQueue({
    isOnline,
    driverId: user?.id || null,
    dispatchQueuedStatus,
    getServerStatus: (stopId) => stopById(stopId)?.status || null,
    onSyncStart: (count) => {
      pushToast(`Syncing ${count} queued status action${count === 1 ? '' : 's'}...`, 'info');
    },
    onSyncComplete: (count) => {
      if (count > 0) {
        pushToast(
          count === 1
            ? '1 queued status action synced.'
            : `${count} queued status actions synced.`,
          'success',
        );
      }
      void refreshData(true);
    },
    onUnauthorized: logout,
  });

  useEffect(() => {
    void initializeTokenStorage().then(() => {
      if (loadUser()) {
        setToken('cookie-session');
        setLoading(true);
      } else {
        setLoading(false);
      }
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!token) return;
    void refreshData(true);
  }, [token]);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      void drainOfflineStatusQueue();
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
  }, [drainOfflineStatusQueue]);

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
        await submitTemperatureLog(entry.payload, entry.id);
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
        await patchStop(entry.stopId, { driver_notes: entry.driverNotes }, entry.id);
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
      const [nextPayload, nextCompanySettings] = await Promise.all([
        fetchBootstrapData(),
        fetchCompanySettings(),
      ]);
      const stampedPayload = {
        ...nextPayload,
        cachedAt: nextPayload.cachedAt || new Date().toISOString(),
      };
      setPayload(stampedPayload);
      setCompanySettings({
        ...defaultCompanySettings,
        ...nextCompanySettings,
      });
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
    saveUser(response.user);
    setToken('cookie-session');
    setUser(response.user);
    pushToast(`Welcome back, ${response.user.name || 'driver'}.`, 'success');
  }

  async function logout() {
    try {
      if (token) await logoutRequest();
    } catch {
      // Clear local state even if the network call fails.
    } finally {
      // Single source of truth for clearing all device-persisted driver data
      // (tokens, cached routes/customers, offline queues, stop drafts, POD photos).
      // FIX [C2]: clearSensitiveStorage owns offline status queue cleanup.
      await clearSensitiveStorage();
      setToken(null);
      setUser(null);
      setPayload(null);
      setCompanySettings(defaultCompanySettings);
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

  function getStopStatusConflict(stopId: string) {
    return statusConflicts.find((conflict) => conflict.stopId === stopId) || null;
  }

  function stopItems(stop: DriverStop) {
    return extractStopItems(stop, invoices, deliveries);
  }

  async function queueStatusAction(
    stop: DriverStop,
    action: StatusAction,
    payload: Record<string, unknown> = {},
    clientActionId = crypto.randomUUID(),
  ) {
    await enqueueStatusAction(stop.id, action, payload, clientActionId);
    applyStopPatchLocally(stop.id, { status: statusForAction(action) });
    pushToast(`Offline: ${stop.name || 'stop'} status queued for sync.`, 'info');
  }

  async function queuedDeliveryPayload(stop: DriverStop, proofImage: string | null, notes: string) {
    const payload: Record<string, unknown> = { notes };
    if (!proofImage) return payload;

    const proofImageDraftId = await savePodDraftPhoto(stop.id, proofImage);
    if (!proofImageDraftId) {
      throw new Error('Unable to save this proof photo securely for offline sync.');
    }
    payload.proofImageDraftId = proofImageDraftId;
    return payload;
  }

  async function dispatchQueuedStatus(entry: QueuedStatusAction) {
    const stop = stopById(entry.stopId) || { id: entry.stopId };

    if (entry.action === 'arrived') {
      await dispatchMarkArrived(stop, entry.id);
      return;
    }

    if (entry.action === 'skipped') {
      await dispatchDeferStop(stop, entry.id);
      return;
    }

    if (entry.action === 'delivered' || entry.action === 'dropoff') {
      const proofImageDraftId = typeof entry.payload.proofImageDraftId === 'string'
        ? entry.payload.proofImageDraftId
        : null;
      const proofImage = proofImageDraftId
        ? await loadPodDraftPhoto(proofImageDraftId)
        : (typeof entry.payload.proofImage === 'string' ? entry.payload.proofImage : null);
      if (proofImageDraftId && !proofImage) {
        throw new Error('Saved proof photo is no longer available on this device.');
      }
      await dispatchMarkDelivered(
        stop,
        proofImage,
        typeof entry.payload.notes === 'string' ? entry.payload.notes : '',
        { deliveryMode: entry.action === 'dropoff' ? 'drop_off' : 'standard', clientActionId: entry.id },
      );
      if (proofImageDraftId) await deletePodDraftPhoto(proofImageDraftId);
      return;
    }

    await dispatchMarkFailed(
      stop,
      typeof entry.payload.reason === 'string' ? entry.payload.reason : '',
      typeof entry.payload.notes === 'string' ? entry.payload.notes : '',
      entry.id,
    );
  }

  async function resolveStatusConflict(stopId: string, resolution: 'keep-local' | 'accept-server') {
    const resolved = resolveQueuedConflict(stopId, resolution);
    if (!resolved) return;

    if (resolution === 'accept-server') {
      await refreshData(true);
      pushToast('Server status kept for this stop.', 'info');
      return;
    }

    await enqueueStatusAction(stopId, resolved.conflict.action, {
      ...resolved.conflict.payload,
      conflictResolution: 'keep-local',
    });
    applyStopPatchLocally(stopId, { status: resolved.conflict.localStatus });
    pushToast('Local status queued to sync again.', 'info');
    if (navigator.onLine) void drainOfflineStatusQueue();
  }

  async function dispatchMarkArrived(stop: DriverStop, clientActionId?: string) {
    await markStopArrived(stop.id, clientActionId);
    const linkedDelivery = findLinkedDelivery(stop, deliveries);
    if (linkedDelivery?.orderDbId) {
      try {
        await patchDeliveryStatus(linkedDelivery.orderDbId, 'in-transit');
      } catch {
        // Stop arrival is the source of truth; delivery status is best-effort.
      }
    }
    applyStopPatchLocally(stop.id, { status: 'arrived', arrived_at: new Date().toISOString() });
  }

  async function markArrived(stop: DriverStop) {
    const clientActionId = crypto.randomUUID();
    if (!navigator.onLine) {
      await queueStatusAction(stop, 'arrived', {}, clientActionId);
      return;
    }

    try {
      await dispatchMarkArrived(stop, clientActionId);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        await queueStatusAction(stop, 'arrived', {}, clientActionId);
        return;
      }
      throw error;
    }
    pushToast(`Marked ${stop.name || 'stop'} as arrived.`, 'success');
    await refreshData(true);
  }

  async function dispatchDeferStop(stop: DriverStop, clientActionId?: string) {
    await deferStop(stop.id, clientActionId);
    applyStopPatchLocally(stop.id, { status: 'skipped' });
  }

  async function deferStopToEnd(stop: DriverStop) {
    const clientActionId = crypto.randomUUID();
    if (!navigator.onLine) {
      await queueStatusAction(stop, 'skipped', {}, clientActionId);
      return;
    }

    try {
      await dispatchDeferStop(stop, clientActionId);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        await queueStatusAction(stop, 'skipped', {}, clientActionId);
        return;
      }
      throw error;
    }
    pushToast(`Skipped ${stop.name || 'stop'} to the end of the route.`, 'success');
    await refreshData(true);
  }

  async function captureSignature(stop: DriverStop, signatureData: string, signerName?: string) {
    await saveStopSignature(stop.id, signatureData, signerName);
    applyStopPatchLocally(stop.id, {
      invoice_has_signature: true,
      invoice_status: stop.invoice_status || 'signed',
    });
    pushToast(`Saved signature for ${stop.name || 'stop'}.`, 'success');
  }

  async function dispatchMarkDelivered(
    stop: DriverStop,
    proofImage: string | null,
    notes: string,
    options: { deliveryMode?: 'standard' | 'drop_off'; clientActionId?: string } = {},
  ) {
    const activeStop = stopById(stop.id) || stop;
    const deliveryMode = options.deliveryMode === 'drop_off' ? 'drop_off' : 'standard';
    const cleanedNotes = notes.trim();
    const dropOffTag = deliveryMode === 'drop_off' ? 'Delivery method: Drop off (no signature captured).' : '';
    const combinedNotes = [dropOffTag, cleanedNotes].filter(Boolean).join('\n');

    if (deliveryMode !== 'drop_off' && companySettings.forceDriverSignature && !activeStop.invoice_has_signature) {
      throw new Error('Capture a customer signature before marking this stop delivered.');
    }

    if (companySettings.forceDriverProofOfDelivery && !activeStop.invoice_id) {
      throw new Error('This stop requires an invoice before a proof-of-delivery photo can be saved.');
    }

    if (companySettings.forceDriverProofOfDelivery && activeStop.invoice_id && !activeStop.invoice_has_proof_of_delivery && !proofImage) {
      throw new Error('Add a proof-of-delivery photo before marking this stop delivered.');
    }

    if (proofImage && activeStop.invoice_id) {
      await uploadProofOfDelivery(
        activeStop.invoice_id,
        proofImage,
        options.clientActionId ? `${options.clientActionId}-pod` : undefined,
      );
    }

    if (combinedNotes) {
      await patchStop(activeStop.id, { driver_notes: combinedNotes }, options.clientActionId ? `${options.clientActionId}-notes` : undefined);
    }

    if (!isArrivedStatus(activeStop.status) && !isDeliveredStatus(activeStop.status)) {
      try {
        await markStopArrived(activeStop.id, options.clientActionId ? `${options.clientActionId}-arrive` : undefined);
      } catch {
        // If an open dwell record already exists we can still continue to completion.
      }
    }

    try {
      await markStopDeparted(
        activeStop.id,
        deliveryMode === 'drop_off' ? { completion_type: 'drop_off' } : undefined,
        options.clientActionId ? `${options.clientActionId}-depart` : undefined,
      );
    } catch {
      await patchStop(activeStop.id, {
        status: 'completed',
        ...(combinedNotes ? { driver_notes: combinedNotes } : {}),
      }, options.clientActionId ? `${options.clientActionId}-complete` : undefined);
    }

    const linkedDelivery = findLinkedDelivery(activeStop, deliveries);
    if (linkedDelivery?.orderDbId) {
      try {
        await patchDeliveryStatus(linkedDelivery.orderDbId, 'delivered');
      } catch {
        // Delivery status sync is best-effort.
      }
    }

    applyStopPatchLocally(activeStop.id, {
      status: 'completed',
      driver_notes: combinedNotes || activeStop.driver_notes,
      invoice_has_proof_of_delivery: proofImage ? true : activeStop.invoice_has_proof_of_delivery,
      invoice_proof_of_delivery_uploaded_at: proofImage ? new Date().toISOString() : activeStop.invoice_proof_of_delivery_uploaded_at,
    });
  }

  async function markDelivered(
    stop: DriverStop,
    proofImage: string | null,
    notes: string,
    options: { deliveryMode?: 'standard' | 'drop_off' } = {},
  ) {
    const activeStop = stopById(stop.id) || stop;
    const clientActionId = crypto.randomUUID();
    if (!navigator.onLine) {
      const payload = await queuedDeliveryPayload(activeStop, proofImage, notes);
      await queueStatusAction(activeStop, options.deliveryMode === 'drop_off' ? 'dropoff' : 'delivered', payload, clientActionId);
      return;
    }

    try {
      await dispatchMarkDelivered(stop, proofImage, notes, { ...options, clientActionId });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        const payload = await queuedDeliveryPayload(activeStop, proofImage, notes);
        await queueStatusAction(activeStop, options.deliveryMode === 'drop_off' ? 'dropoff' : 'delivered', payload, clientActionId);
        return;
      }
      throw error;
    }

    pushToast(
      options.deliveryMode === 'drop_off'
        ? `Marked ${activeStop.name || 'stop'} as a drop-off delivery.`
        : `Marked ${activeStop.name || 'stop'} as delivered.`,
      'success'
    );
    await refreshData(true);
  }

  async function dispatchMarkFailed(stop: DriverStop, reason: string, notes: string, clientActionId?: string) {
    const trimmedReason = reason.trim();
    const trimmedNotes = notes.trim();
    const driverNotes = [
      `Exception: ${trimmedReason}`,
      trimmedNotes,
    ].filter(Boolean).join('\n');

    await patchStop(stop.id, {
      status: 'failed',
      driver_notes: driverNotes || `Marked failed at ${new Date().toLocaleTimeString()}`,
    }, clientActionId);
    applyStopPatchLocally(stop.id, {
      status: 'failed',
      driver_notes: driverNotes || `Marked failed at ${new Date().toLocaleTimeString()}`,
    });
  }

  async function markFailed(stop: DriverStop, reason: string, notes: string) {
    const clientActionId = crypto.randomUUID();
    if (!navigator.onLine) {
      await queueStatusAction(stop, 'failed', { reason, notes }, clientActionId);
      return;
    }

    try {
      await dispatchMarkFailed(stop, reason, notes, clientActionId);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        await queueStatusAction(stop, 'failed', { reason, notes }, clientActionId);
        return;
      }
      throw error;
    }
    pushToast(`Marked ${stop.name || 'stop'} as failed.`, 'success');
    await refreshData(true);
  }

  async function openInvoicePdf(invoiceId: string) {
    const blob = await fetchInvoicePdf(invoiceId);
    await openBlobInNewTab(blob, `invoice-${invoiceId}.pdf`);
  }

  async function submitLog(payload: Record<string, unknown>) {
    const clientActionId = crypto.randomUUID();
    if (!navigator.onLine) {
      enqueueTemperatureLog({
        id: clientActionId,
        createdAt: new Date().toISOString(),
        payload,
      });
      const nextCount = loadQueuedTemperatureLogs().length;
      setQueuedTemperatureLogCount(nextCount);
      pushToast('Offline: temperature log queued for sync.', 'info');
      return;
    }

    try {
      await submitTemperatureLog(payload, clientActionId);
      pushToast('Temperature log saved.', 'success');
    } catch (error) {
      if (!(error instanceof ApiError)) {
        enqueueTemperatureLog({
          id: clientActionId,
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
    const clientActionId = crypto.randomUUID();
    if (!navigator.onLine) {
      enqueueStopNoteUpdate({
        id: clientActionId,
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
      await patchStop(stopId, { driver_notes: trimmedNotes }, clientActionId);
      applyStopPatchLocally(stopId, { driver_notes: trimmedNotes });
      pushToast('Stop notes saved.', 'success');
    } catch (error) {
      if (!(error instanceof ApiError)) {
        enqueueStopNoteUpdate({
          id: clientActionId,
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
    await drainOfflineStatusQueue();
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
        companySettings,
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
        queuedStatusCount,
        statusConflicts,
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
        getStopStatusConflict,
        resolveStatusConflict,
        stopItems,
        markArrived,
        deferStopToEnd,
        captureSignature,
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
