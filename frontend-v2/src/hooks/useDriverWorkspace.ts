import { useCallback, useState } from 'react';
import { fetchListWithAuth, fetchWithAuth } from '../lib/api';
import type { CompanySettings, DeliverySummary, DriverInvoice, DriverRoute, DriverStop, DwellRecord } from '../pages/driver.types';
import { upsertDwell } from '../pages/driver.types';

export function useDriverWorkspace() {
  const [routes, setRoutes]                   = useState<DriverRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [dwellRecords, setDwellRecords]       = useState<DwellRecord[]>([]);
  const [deliveries, setDeliveries]           = useState<DeliverySummary[]>([]);
  const [driverInvoices, setDriverInvoices]   = useState<DriverInvoice[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings>({});
  const [driverName, setDriverName]           = useState('Driver');
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const results = await Promise.allSettled([
      fetchListWithAuth<DriverRoute>('/api/driver/routes'),
      fetchListWithAuth<DwellRecord>('/api/dwell'),
      fetchListWithAuth<DeliverySummary>('/api/deliveries'),
      fetchListWithAuth<DriverInvoice>('/api/driver/invoices'),
      fetchWithAuth<CompanySettings>('/api/settings/company'),
    ] as const);

    const firstError = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (firstError) setError(String(firstError.reason?.message || 'Could not load the driver workspace.'));

    if (results[0].status === 'fulfilled') {
      const loadedRoutes = results[0].value;
      setRoutes(loadedRoutes);
      setSelectedRouteId((current) => current || loadedRoutes[0]?.id || '');
      setDriverName(loadedRoutes[0]?.driver || JSON.parse(localStorage.getItem('nr_user') || '{}')?.name || 'Driver');
    }
    if (results[1].status === 'fulfilled') setDwellRecords(results[1].value);
    if (results[2].status === 'fulfilled') setDeliveries(results[2].value);
    if (results[3].status === 'fulfilled') setDriverInvoices(results[3].value);
    if (results[4].status === 'fulfilled') setCompanySettings(results[4].value || {});

    setLoading(false);
  }, []);

  function applyDwell(record: DwellRecord) {
    setDwellRecords((current) => upsertDwell(current, record));
  }

  function updateStopInvoice(stopId: string, patch: Partial<DriverStop>) {
    setRoutes((current) =>
      current.map((route) => ({
        ...route,
        stops: (route.stops || []).map((stop) => (stop.id === stopId ? { ...stop, ...patch } : stop)),
      }))
    );
  }

  return {
    routes, setRoutes,
    selectedRouteId, setSelectedRouteId,
    dwellRecords,
    deliveries,
    driverInvoices,
    companySettings,
    driverName,
    loading,
    error, setError,
    load,
    applyDwell,
    updateStopInvoice,
  };
}
