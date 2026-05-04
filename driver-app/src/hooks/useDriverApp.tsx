import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ApiError,
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
  clearCache,
  clearSelectedRouteId,
  clearToken,
  clearUser,
  loadCache,
  loadSelectedRouteId,
  loadToken,
  loadUser,
  saveCache,
  saveSelectedRouteId,
  saveToken,
  saveUser,
} from '@/lib/storage';
import { extractStopItems, findLinkedDelivery, getCurrentRoute, getRouteInvoices, isArrivedStatus, isDeliveredStatus } from '@/lib/utils';
import type { BootstrapPayload, DriverInvoice, DriverRoute, DriverStop, DriverUser } from '@/types';
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
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshData: (silent?: boolean) => Promise<void>;
  setSelectedRouteId: (routeId: string) => void;
  stopById: (stopId: string) => DriverStop | null;
  stopItems: (stop: DriverStop) => string[];
  markArrived: (stop: DriverStop) => Promise<void>;
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

  const routes = payload?.routes || [];
  const invoices = payload?.invoices || [];
  const deliveries = payload?.deliveries || [];
  const currentRoute = getCurrentRoute(routes, selectedRouteId);
  const routeInvoices = getRouteInvoices(currentRoute, invoices);

  useEffect(() => {
    if (!token) return;
    void refreshData(true);
  }, [token]);

  async function refreshData(silent = false) {
    if (!token) return;
    if (silent) setLoading(true);
    setRefreshing(!silent);

    try {
      const nextPayload = await fetchBootstrapData();
      setPayload(nextPayload);
      saveCache(nextPayload);
      setUsingCachedData(false);

      if (!selectedRouteId && nextPayload.routes[0]?.id) {
        setSelectedRouteIdState(nextPayload.routes[0].id);
        saveSelectedRouteId(nextPayload.routes[0].id);
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
      setToken(null);
      setUser(null);
      setPayload(null);
      setSelectedRouteIdState(null);
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
    try {
      await submitTemperatureLog(payload);
      pushToast('Temperature log saved.', 'success');
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        throw new Error('This backend currently restricts temperature logs to managers and admins.');
      }
      throw error;
    }
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
        login,
        logout,
        refreshData,
        setSelectedRouteId,
        stopById,
        stopItems,
        markArrived,
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
