/**
 * AuditLogPage.tsx
 * /audit-log — admin + manager only
 *
 * Tabs:
 *   1. All Activity    GET /api/audit-log
 *   2. Overrides Only  GET /api/audit-log/overrides
 *   3. By Customer     GET /api/audit-log/customer/:id
 */

import { useState, useCallback } from 'react';
import { fetchWithAuth } from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────
interface AuditEvent {
  id: string;
  source: string;
  action_type: string;
  customer_id: number | null;
  company_name: string | null;
  order_id: string | null;
  performed_by: string | null;
  performed_by_email: string | null;
  performed_by_name: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface OverrideEvent {
  id: number;
  customer_id: number;
  company_name: string | null;
  order_id: string;
  override_reason: string;
  overridden_by_email: string | null;
  overridden_by_name: string | null;
  created_at: string;
  expires_at: string | null;
  consumed_at: string | null;
  customer_balance_at_override: number | null;
  credit_limit_at_override: number | null;
  is_stale: boolean;
  is_expired: boolean;
}

interface OverrideSummary {
  total: number;
  consumed: number;
  expired: number;
  active: number;
  stale: number;
}

interface Paging {
  limit: number;
  offset: number;
  total: number;
  next_offset: number | null;
}

const ACTION_TYPES = [
  'all',
  'customer_created',
  'customer_updated',
  'customer_deleted',
  'credit_hold_placed',
  'credit_hold_released',
  'credit_limit_changed',
  'credit_terms_changed',
  'order_allowed_override',
  'order_created',
  'order_updated',
  'order_status_changed',
  'order_deleted',
  'order_blocked',
  'limit_changed',
  'terms_changed',
  'auto_released',
];

const SOURCE_COLORS: Record<string, string> = {
  audit_log: 'bg-blue-50 text-blue-700',
  credit_hold_log: 'bg-red-50 text-red-700',
  credit_hold_overrides: 'bg-orange-50 text-orange-700',
};

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString() : '—';

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function thirtyDaysAgo() {
  const d = new Date(Date.now() - 30 * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Shared filter bar ──────────────────────────────────────────────────────
function FilterBar({
  startDate, setStartDate,
  endDate, setEndDate,
  actionType, setActionType,
  userId, setUserId,
  customerId, setCustomerId,
  showCustomer = true,
  showActionType = true,
  onSearch,
  loading,
}: {
  startDate: string; setStartDate: (v: string) => void;
  endDate: string; setEndDate: (v: string) => void;
  actionType: string; setActionType: (v: string) => void;
  userId: string; setUserId: (v: string) => void;
  customerId: string; setCustomerId: (v: string) => void;
  showCustomer?: boolean;
  showActionType?: boolean;
  onSearch: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-3 items-end bg-white border rounded-lg p-4 shadow-sm">
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        From
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        To
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm" />
      </label>
      {showActionType && (
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Action Type
          <select value={actionType} onChange={(e) => setActionType(e.target.value)}
            className="border rounded px-2 py-1.5 text-sm">
            {ACTION_TYPES.map((t) => <option key={t} value={t}>{t === 'all' ? 'All Types' : t.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        User ID (optional)
        <input type="text" placeholder="UUID" value={userId} onChange={(e) => setUserId(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm w-40" />
      </label>
      {showCustomer && (
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Customer ID (optional)
          <input type="number" placeholder="123" value={customerId} onChange={(e) => setCustomerId(e.target.value)}
            className="border rounded px-2 py-1.5 text-sm w-28" />
        </label>
      )}
      <button
        onClick={onSearch}
        disabled={loading}
        className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 self-end"
      >
        {loading ? 'Loading…' : 'Search'}
      </button>
    </div>
  );
}

// ── Tab 1: All Activity ────────────────────────────────────────────────────
function AllActivityTab() {
  const [startDate, setStartDate] = useState(thirtyDaysAgo());
  const [endDate, setEndDate] = useState(localToday());
  const [actionType, setActionType] = useState('all');
  const [userId, setUserId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [paging, setPaging] = useState<Paging | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const load = useCallback(async (offset = 0) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
        limit: '100',
        offset: String(offset),
      });
      if (actionType !== 'all') params.set('action_type', actionType);
      if (userId.trim()) params.set('user_id', userId.trim());
      if (customerId.trim()) params.set('customer_id', customerId.trim());

      const res = await fetchWithAuth<{ events: AuditEvent[]; paging: Paging }>(`/api/audit-log?${params}`);
      setEvents(offset === 0 ? res.events : (prev) => [...prev, ...res.events]);
      setPaging(res.paging);
      setSearched(true);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, actionType, userId, customerId]);

  return (
    <div className="space-y-4">
      <FilterBar
        startDate={startDate} setStartDate={setStartDate}
        endDate={endDate} setEndDate={setEndDate}
        actionType={actionType} setActionType={setActionType}
        userId={userId} setUserId={setUserId}
        customerId={customerId} setCustomerId={setCustomerId}
        onSearch={() => load(0)}
        loading={loading}
      />
      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>}
      {searched && (
        <div className="bg-white border rounded-lg shadow-sm overflow-x-auto">
          {events.length === 0 && !loading ? (
            <p className="p-6 text-sm text-gray-400 text-center">No events found for the selected filters.</p>
          ) : (
            <>
              <div className="px-4 py-2 border-b text-xs text-gray-500">
                Showing {events.length} of {paging?.total ?? '?'} events
              </div>
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    {['When', 'Action', 'Customer', 'Order', 'Performed By', 'Notes', 'Source'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {events.map((ev) => (
                    <tr key={ev.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 whitespace-nowrap text-gray-500 text-xs">{fmtDate(ev.created_at)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{ev.action_type.replace(/_/g, ' ')}</span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">{ev.company_name ?? (ev.customer_id ? `#${ev.customer_id}` : '—')}</td>
                      <td className="px-4 py-2 whitespace-nowrap font-mono text-xs">{ev.order_id ?? '—'}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{ev.performed_by_name ?? ev.performed_by_email ?? 'system'}</td>
                      <td className="px-4 py-2 max-w-xs truncate text-gray-600">{ev.notes ?? '—'}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${SOURCE_COLORS[ev.source] ?? 'bg-gray-100 text-gray-600'}`}>
                          {ev.source.replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {paging?.next_offset != null && (
                <div className="p-3 text-center">
                  <button onClick={() => load(paging.next_offset!)} disabled={loading}
                    className="px-4 py-2 border rounded text-sm hover:bg-gray-50 disabled:opacity-50">
                    {loading ? 'Loading…' : 'Load More'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Overrides Only ─────────────────────────────────────────────────
function OverridesTab() {
  const [startDate, setStartDate] = useState(thirtyDaysAgo());
  const [endDate, setEndDate] = useState(localToday());
  const [userId, setUserId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [overrides, setOverrides] = useState<OverrideEvent[]>([]);
  const [summary, setSummary] = useState<OverrideSummary | null>(null);
  const [paging, setPaging] = useState<Paging | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const load = useCallback(async (offset = 0) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate, limit: '100', offset: String(offset) });
      if (userId.trim()) params.set('user_id', userId.trim());
      if (customerId.trim()) params.set('customer_id', customerId.trim());

      const res = await fetchWithAuth<{ overrides: OverrideEvent[]; summary: OverrideSummary; paging: Paging }>(`/api/audit-log/overrides?${params}`);
      setOverrides(offset === 0 ? res.overrides : (prev) => [...prev, ...res.overrides]);
      setSummary(res.summary);
      setPaging(res.paging);
      setSearched(true);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load overrides');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, userId, customerId]);

  return (
    <div className="space-y-4">
      <FilterBar
        startDate={startDate} setStartDate={setStartDate}
        endDate={endDate} setEndDate={setEndDate}
        actionType="" setActionType={() => {}}
        userId={userId} setUserId={setUserId}
        customerId={customerId} setCustomerId={setCustomerId}
        showActionType={false}
        onSearch={() => load(0)}
        loading={loading}
      />
      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {([
            { label: 'Total', value: summary.total, color: 'text-gray-800' },
            { label: 'Active', value: summary.active, color: 'text-green-600' },
            { label: 'Consumed', value: summary.consumed, color: 'text-blue-600' },
            { label: 'Expired', value: summary.expired, color: 'text-red-600' },
            { label: 'Stale (>7d)', value: summary.stale, color: 'text-yellow-600' },
          ]).map((s) => (
            <div key={s.label} className="bg-white border rounded-lg p-3 shadow-sm">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className={`text-xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {searched && (
        <div className="bg-white border rounded-lg shadow-sm overflow-x-auto">
          {overrides.length === 0 && !loading ? (
            <p className="p-6 text-sm text-gray-400 text-center">No overrides found.</p>
          ) : (
            <>
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    {['When', 'Customer', 'Order ID', 'Override Reason', 'Granted By', 'Balance at Time', 'Limit at Time', 'Expires', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {overrides.map((o) => (
                    <tr key={o.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-500">{fmtDate(o.created_at)}</td>
                      <td className="px-4 py-2 whitespace-nowrap font-medium">{o.company_name ?? `#${o.customer_id}`}</td>
                      <td className="px-4 py-2 font-mono text-xs">{o.order_id}</td>
                      <td className="px-4 py-2 max-w-xs truncate">{o.override_reason}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{o.overridden_by_name ?? o.overridden_by_email ?? '—'}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{fmt(o.customer_balance_at_override)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{fmt(o.credit_limit_at_override)}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-xs">{fmtDate(o.expires_at)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {o.consumed_at ? (
                          <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">Used</span>
                        ) : o.is_expired ? (
                          <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-600">Expired</span>
                        ) : o.is_stale ? (
                          <span className="px-2 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700">Stale</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">Active</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {paging?.next_offset != null && (
                <div className="p-3 text-center">
                  <button onClick={() => load(paging.next_offset!)} disabled={loading}
                    className="px-4 py-2 border rounded text-sm hover:bg-gray-50 disabled:opacity-50">
                    {loading ? 'Loading…' : 'Load More'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab 3: By Customer ────────────────────────────────────────────────────
function ByCustomerTab() {
  const [inputId, setInputId] = useState('');
  const [startDate, setStartDate] = useState(thirtyDaysAgo());
  const [endDate, setEndDate] = useState(localToday());
  const [actionType, setActionType] = useState('all');
  const [userId, setUserId] = useState('');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [paging, setPaging] = useState<Paging | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const load = useCallback(async (offset = 0) => {
    const id = parseInt(inputId, 10);
    if (!id) { setError('Enter a valid customer ID'); return; }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate, limit: '100', offset: String(offset) });
      if (actionType !== 'all') params.set('action_type', actionType);

      const res = await fetchWithAuth<{ events: AuditEvent[]; paging: Paging; company_name: string }>(`/api/audit-log/customer/${id}?${params}`);
      setEvents(offset === 0 ? res.events : (prev) => [...prev, ...res.events]);
      setPaging(res.paging);
      setCustomerName(res.company_name);
      setSearched(true);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load customer trail');
    } finally {
      setLoading(false);
    }
  }, [inputId, startDate, endDate, actionType]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-end">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Customer ID
          <input type="number" placeholder="123" value={inputId} onChange={(e) => setInputId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(0)}
            className="border rounded px-2 py-1.5 text-sm w-28" />
        </label>
      </div>
      <FilterBar
        startDate={startDate} setStartDate={setStartDate}
        endDate={endDate} setEndDate={setEndDate}
        actionType={actionType} setActionType={setActionType}
        userId={userId} setUserId={setUserId}
        customerId="" setCustomerId={() => {}}
        showCustomer={false}
        onSearch={() => load(0)}
        loading={loading}
      />
      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>}

      {searched && (
        <div className="bg-white border rounded-lg shadow-sm overflow-x-auto">
          {customerName && (
            <div className="px-4 py-3 border-b flex items-center gap-3">
              <span className="font-semibold text-gray-900">{customerName}</span>
              <span className="text-xs text-gray-500">{paging?.total ?? 0} total events</span>
            </div>
          )}
          {events.length === 0 && !loading ? (
            <p className="p-6 text-sm text-gray-400 text-center">No activity found for this customer.</p>
          ) : (
            <>
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    {['When', 'Action', 'Order', 'Performed By', 'Notes', 'Source'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {events.map((ev) => (
                    <tr key={ev.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 whitespace-nowrap text-xs text-gray-500">{fmtDate(ev.created_at)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{ev.action_type.replace(/_/g, ' ')}</span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{ev.order_id ?? '—'}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{ev.performed_by_name ?? ev.performed_by_email ?? 'system'}</td>
                      <td className="px-4 py-2 max-w-xs truncate text-gray-600">{ev.notes ?? '—'}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${SOURCE_COLORS[ev.source] ?? 'bg-gray-100 text-gray-600'}`}>
                          {ev.source.replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {paging?.next_offset != null && (
                <div className="p-3 text-center">
                  <button onClick={() => load(paging.next_offset!)} disabled={loading}
                    className="px-4 py-2 border rounded text-sm hover:bg-gray-50 disabled:opacity-50">
                    {loading ? 'Loading…' : 'Load More'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export function AuditLogPage() {
  const [tab, setTab] = useState<'all' | 'overrides' | 'customer'>('all');

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Customer Activity Audit Log</h1>
        <p className="text-sm text-gray-500 mt-0.5">Full record of every action taken on customers, orders, credit settings, and overrides — admin access only.</p>
      </div>

      {/* Tabs */}
      <div className="border-b flex gap-6">
        {([
          { id: 'all', label: 'All Activity' },
          { id: 'overrides', label: 'Overrides' },
          { id: 'customer', label: 'By Customer' },
        ] as { id: typeof tab; label: string }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'all' && <AllActivityTab />}
      {tab === 'overrides' && <OverridesTab />}
      {tab === 'customer' && <ByCustomerTab />}
    </div>
  );
}
