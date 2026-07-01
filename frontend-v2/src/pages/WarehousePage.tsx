import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { StatCard } from '../components/ui/stat-card';
import { useToast } from '../components/ui/toast';
import { fetchWithAuth } from '../lib/api';
import { InventoryTab } from '../components/warehouse/InventoryTab';
import { ScansTab } from '../components/warehouse/ScansTab';
import { LocationsTab } from '../components/warehouse/LocationsTab';
import { ReturnsTab } from '../components/warehouse/ReturnsTab';
import type { WarehouseSummary } from '../components/warehouse/WarehouseTypes';

type Tab = 'inventory' | 'scans' | 'locations' | 'returns';

function ErrorBanner({ msg }: { msg: string }) {
  return <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{msg}</div>;
}

function NoticeBanner({ msg }: { msg: string }) {
  return <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{msg}</div>;
}

export function WarehousePage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('inventory');
  const [summary, setSummary] = useState<WarehouseSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const toast = useToast();
  const [error, setError] = useState('');

  function flash(msg: string) {
    toast.success(msg);
  }

  async function loadSummary() {
    setSummaryLoading(true);
    try {
      const data = await fetchWithAuth<WarehouseSummary>('/api/warehouse');
      setSummary(data);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load warehouse summary'));
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => { loadSummary(); }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'inventory', label: 'Inventory' },
    { key: 'scans', label: 'Scan Events' },
    { key: 'locations', label: 'Locations' },
    { key: 'returns', label: 'Returns' },
  ];

  return (
    <div className="space-y-5">
      {error ? <ErrorBanner msg={error} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Total SKUs" value={summaryLoading ? '—' : (summary?.inventory?.length ?? 0)} />
        <StatCard label="Pending Inbound" value={summaryLoading ? '—' : (summary?.pendingInbound ?? '—')} />
        <StatCard label="Today's Stops" value={summaryLoading ? '—' : (summary?.todayStops ?? '—')} />
        <StatCard label="Stops Completed" value={summaryLoading ? '—' : (summary?.todayStopsCompleted ?? '—')} />
        <StatCard label="Today's Scans" value={summaryLoading ? '—' : (summary?.todayScans ?? '—')} />
        <StatCard label="Open Returns" value={summaryLoading ? '—' : (summary?.openReturns ?? '—')} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => navigate('/inventory?tab=cycle-counts')}>Cycle Counts</Button>
        <Button variant="outline" onClick={() => navigate('/inventory?tab=availability')}>Availability</Button>
        <Button variant="outline" onClick={() => navigate('/inventory?tab=returns')}>Inventory Returns</Button>
      </div>

      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === t.key
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'inventory' && <InventoryTab initialInventory={summary?.inventory || []} onNotice={flash} onError={setError} />}
      {activeTab === 'scans' && <ScansTab onNotice={flash} onError={setError} />}
      {activeTab === 'locations' && <LocationsTab onNotice={flash} onError={setError} />}
      {activeTab === 'returns' && <ReturnsTab onNotice={flash} onError={setError} onSummaryRefresh={loadSummary} />}
    </div>
  );
}
