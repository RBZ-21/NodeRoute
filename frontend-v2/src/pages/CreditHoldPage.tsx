/**
 * CreditHoldPage.tsx
 * /credit-hold — admin/manager only
 *
 * Sections:
 *   1. Dashboard stats bar        GET /api/credit/dashboard
 *   2. Active holds table         GET /api/credit/holds/active
 *   3. Active overrides table     GET /api/credit/overrides
 *   4. Customer lookup panel      GET /api/credit/customer/:id/status
 *      └─ Place hold modal        POST .../hold
 *      └─ Release hold modal      POST .../release
 *      └─ Override modal          POST .../override
 *      └─ Settings modal          PATCH .../settings
 *      └─ History drawer          GET .../history
 */

import { useEffect, useState, useCallback } from 'react';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────
interface DashboardStats {
  customers_on_hold: number;
  customers_in_warning: number;
  total_past_due_balance: number;
  total_balance_at_risk: number;
  orders_blocked_today: number;
  active_overrides: number;
  overrides_pending_review: number;
  holds_auto_released_this_week: number;
}

interface ActiveHold {
  customer_id: number;
  company_name: string;
  credit_limit: number | null;
  current_balance: number;
  over_by: number;
  hold_reason: string;
  hold_placed_at: string;
  hold_placed_by: string | null;
  hold_notes: string | null;
  days_on_hold: number;
  oldest_unpaid_invoice_date: string | null;
  sales_rep: string | null;
}

interface CreditOverride {
  id: number;
  customer_id: number;
  company_name: string | null;
  order_id: string;
  override_reason: string;
  overridden_by_email: string | null;
  created_at: string;
  expires_at: string | null;
  consumed_at: string | null;
  is_stale: boolean;
  is_expired: boolean;
}

interface CustomerStatus {
  customer_id: number;
  company_name: string;
  credit_limit: number | null;
  current_balance: number;
  available_credit: number | null;
  credit_status: string;
  on_hold: boolean;
  hold_reason: string | null;
  hold_placed_at: string | null;
  hold_notes: string | null;
  auto_hold_enabled: boolean;
  warning_threshold_pct: number;
  credit_terms: string;
  avg_days_to_pay: number;
  last_payment_date: string | null;
  last_payment_amount: number | null;
  oldest_unpaid_invoice_date: string | null;
  days_past_due: number;
  should_be_on_hold: boolean;
}

interface HistoryEvent {
  id: number;
  event_type: string;
  created_at: string;
  performed_by_email: string | null;
  performed_by_name: string | null;
  notes: string | null;
  balance: number | null;
  previous_credit_limit: number | null;
  new_credit_limit: number | null;
}

const HOLD_REASONS = ['over_limit','past_due','manual','new_account','bounced_check','disputed_invoice'];
const CREDIT_TERMS = ['COD','NET7','NET14','NET21','NET30','NET45','NET60','NET90','PREPAY'];

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString() : '—';

function badge(reason: string) {
  const map: Record<string, string> = {
    over_limit: 'bg-red-100 text-red-700',
    past_due: 'bg-orange-100 text-orange-700',
    manual: 'bg-gray-100 text-gray-700',
    new_account: 'bg-blue-100 text-blue-700',
    bounced_check: 'bg-purple-100 text-purple-700',
    disputed_invoice: 'bg-yellow-100 text-yellow-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[reason] ?? 'bg-gray-100 text-gray-600'}`}>
      {reason.replace(/_/g, ' ')}
    </span>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function CreditHoldPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [holds, setHolds] = useState<ActiveHold[]>([]);
  const [overrides, setOverrides] = useState<CreditOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // customer lookup
  const [lookupId, setLookupId] = useState('');
  const [customer, setCustomer] = useState<CustomerStatus | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  // history drawer
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // modals
  const [holdModal, setHoldModal] = useState(false);
  const [releaseModal, setReleaseModal] = useState(false);
  const [overrideModal, setOverrideModal] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);

  // form state
  const [holdReason, setHoldReason] = useState('manual');
  const [holdNotes, setHoldNotes] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [overrideOrderId, setOverrideOrderId] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideExpires, setOverrideExpires] = useState('');
  const [settingsCreditLimit, setSettingsCreditLimit] = useState('');
  const [settingsTerms, setSettingsTerms] = useState('NET30');
  const [settingsThreshold, setSettingsThreshold] = useState('80');
  const [settingsAutoHold, setSettingsAutoHold] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // active tab
  const [tab, setTab] = useState<'holds' | 'overrides'>('holds');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, h, o] = await Promise.all([
        fetchWithAuth<DashboardStats>('/api/credit/dashboard'),
        fetchWithAuth<{ holds: ActiveHold[] }>('/api/credit/holds/active'),
        fetchWithAuth<CreditOverride[]>('/api/credit/overrides'),
      ]);
      setStats(s);
      setHolds(h.holds ?? []);
      setOverrides(o ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load credit data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  async function lookupCustomer() {
    const id = parseInt(lookupId, 10);
    if (!id) return;
    setLookupLoading(true);
    setLookupError(null);
    setCustomer(null);
    setHistory([]);
    try {
      const c = await fetchWithAuth<CustomerStatus>(`/api/credit/customer/${id}/status`);
      setCustomer(c);
      setSettingsCreditLimit(c.credit_limit != null ? String(c.credit_limit) : '');
      setSettingsTerms(c.credit_terms ?? 'NET30');
      setSettingsThreshold(String(c.warning_threshold_pct ?? 80));
      setSettingsAutoHold(c.auto_hold_enabled !== false);
    } catch (e: any) {
      setLookupError(e.message ?? 'Customer not found');
    } finally {
      setLookupLoading(false);
    }
  }

  async function loadHistory() {
    if (!customer) return;
    setHistoryLoading(true);
    try {
      const res = await fetchWithAuth<{ events: HistoryEvent[] }>(`/api/credit/customer/${customer.customer_id}/history?limit=50`);
      setHistory(res.events ?? []);
    } catch {}
    finally { setHistoryLoading(false); }
    setHistoryOpen(true);
  }

  async function doAction(url: string, body: object) {
    setActionLoading(true);
    setActionError(null);
    try {
      await sendWithAuth(url, 'POST', body);
      // refresh customer + dashboard
      const c = await fetchWithAuth<CustomerStatus>(`/api/credit/customer/${customer!.customer_id}/status`);
      setCustomer(c);
      await loadDashboard();
      setHoldModal(false); setReleaseModal(false); setOverrideModal(false);
      setHoldNotes(''); setReleaseNotes(''); setOverrideOrderId(''); setOverrideReason(''); setOverrideExpires('');
    } catch (e: any) {
      setActionError(e.message ?? 'Action failed');
    } finally {
      setActionLoading(false);
    }
  }

  async function doSettings() {
    if (!customer) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await sendWithAuth(`/api/credit/customer/${customer.customer_id}/settings`, 'PATCH', {
        credit_limit: settingsCreditLimit === '' ? null : parseFloat(settingsCreditLimit),
        credit_terms: settingsTerms,
        warning_threshold_pct: parseFloat(settingsThreshold),
        auto_hold_enabled: settingsAutoHold,
      });
      const c = await fetchWithAuth<CustomerStatus>(`/api/credit/customer/${customer.customer_id}/status`);
      setCustomer(c);
      setSettingsModal(false);
    } catch (e: any) {
      setActionError(e.message ?? 'Settings update failed');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Credit Hold Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">Monitor, place, and release customer credit holds</p>
        </div>
        <button onClick={loadDashboard} className="px-3 py-1.5 text-sm bg-white border rounded shadow-sm hover:bg-gray-50">↺ Refresh</button>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>}

      {/* ── Stats Bar ── */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {([
            { label: 'On Hold', value: stats.customers_on_hold, color: 'text-red-600' },
            { label: 'In Warning', value: stats.customers_in_warning, color: 'text-yellow-600' },
            { label: 'Past Due Balance', value: fmt(stats.total_past_due_balance), color: 'text-red-700' },
            { label: 'Balance at Risk', value: fmt(stats.total_balance_at_risk), color: 'text-orange-600' },
            { label: 'Orders Blocked Today', value: stats.orders_blocked_today, color: 'text-red-500' },
            { label: 'Active Overrides', value: stats.active_overrides, color: 'text-blue-600' },
            { label: 'Overrides Pending Review', value: stats.overrides_pending_review, color: 'text-purple-600' },
            { label: 'Auto-Released (7d)', value: stats.holds_auto_released_this_week, color: 'text-green-600' },
          ] as { label: string; value: string | number; color: string }[]).map((s) => (
            <div key={s.label} className="bg-white border rounded-lg p-4 shadow-sm">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className={`text-xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}
      {loading && !stats && <div className="text-sm text-gray-400">Loading dashboard…</div>}

      {/* ── Tabs ── */}
      <div className="border-b flex gap-6">
        {(['holds', 'overrides'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'holds' ? `Active Holds (${holds.length})` : `Overrides (${overrides.length})`}
          </button>
        ))}
      </div>

      {/* ── Active Holds Table ── */}
      {tab === 'holds' && (
        <div className="bg-white border rounded-lg shadow-sm overflow-x-auto">
          {holds.length === 0 && !loading ? (
            <p className="p-6 text-sm text-gray-400 text-center">No active holds 🎉</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  {['Customer','Balance','Limit','Over By','Reason','Days on Hold','Placed','Sales Rep'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {holds.map((h) => (
                  <tr key={h.customer_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                      <button
                        className="text-blue-600 hover:underline"
                        onClick={() => { setLookupId(String(h.customer_id)); }}
                      >
                        {h.company_name}
                      </button>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{fmt(h.current_balance)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{fmt(h.credit_limit)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-red-600 font-semibold">{fmt(h.over_by)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{badge(h.hold_reason)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{h.days_on_hold}d</td>
                    <td className="px-4 py-3 whitespace-nowrap">{fmtDate(h.hold_placed_at)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">{h.sales_rep ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Overrides Table ── */}
      {tab === 'overrides' && (
        <div className="bg-white border rounded-lg shadow-sm overflow-x-auto">
          {overrides.length === 0 && !loading ? (
            <p className="p-6 text-sm text-gray-400 text-center">No active overrides</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  {['Customer','Order ID','Reason','By','Created','Expires','Status'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {overrides.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{o.company_name ?? o.customer_id}</td>
                    <td className="px-4 py-3 font-mono text-xs">{o.order_id}</td>
                    <td className="px-4 py-3 max-w-xs truncate">{o.override_reason}</td>
                    <td className="px-4 py-3 text-gray-500">{o.overridden_by_email ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{fmtDate(o.created_at)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{fmtDate(o.expires_at)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {o.consumed_at ? (
                        <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500">Used</span>
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
          )}
        </div>
      )}

      {/* ── Customer Lookup Panel ── */}
      <div className="bg-white border rounded-lg shadow-sm p-5 space-y-4">
        <h2 className="text-base font-semibold text-gray-800">Customer Lookup</h2>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="Customer ID"
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && lookupCustomer()}
            className="border rounded px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={lookupCustomer}
            disabled={lookupLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {lookupLoading ? 'Loading…' : 'Look Up'}
          </button>
        </div>
        {lookupError && <p className="text-sm text-red-600">{lookupError}</p>}

        {customer && (
          <div className="space-y-4">
            {/* Status Header */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-bold text-gray-900">{customer.company_name}</span>
              {customer.on_hold ? (
                <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-semibold">ON HOLD</span>
              ) : customer.credit_status === 'warning' ? (
                <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-semibold">WARNING</span>
              ) : (
                <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold">GOOD STANDING</span>
              )}
              {customer.should_be_on_hold && !customer.on_hold && (
                <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs">⚠ Should be on hold</span>
              )}
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><p className="text-gray-500 text-xs">Credit Limit</p><p className="font-semibold">{fmt(customer.credit_limit)}</p></div>
              <div><p className="text-gray-500 text-xs">Current Balance</p><p className="font-semibold">{fmt(customer.current_balance)}</p></div>
              <div><p className="text-gray-500 text-xs">Available Credit</p><p className="font-semibold">{fmt(customer.available_credit)}</p></div>
              <div><p className="text-gray-500 text-xs">Terms</p><p className="font-semibold">{customer.credit_terms}</p></div>
              <div><p className="text-gray-500 text-xs">Avg Days to Pay</p><p className="font-semibold">{customer.avg_days_to_pay}d</p></div>
              <div><p className="text-gray-500 text-xs">Days Past Due</p><p className="font-semibold text-red-600">{customer.days_past_due}d</p></div>
              <div><p className="text-gray-500 text-xs">Last Payment</p><p className="font-semibold">{fmtDate(customer.last_payment_date)}</p></div>
              <div><p className="text-gray-500 text-xs">Last Pmt Amount</p><p className="font-semibold">{fmt(customer.last_payment_amount)}</p></div>
            </div>

            {customer.on_hold && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-sm">
                <p><span className="font-medium">Reason:</span> {customer.hold_reason?.replace(/_/g,' ')}</p>
                <p><span className="font-medium">Placed:</span> {fmtDate(customer.hold_placed_at)}</p>
                {customer.hold_notes && <p><span className="font-medium">Notes:</span> {customer.hold_notes}</p>}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2">
              {!customer.on_hold && (
                <button onClick={() => { setHoldModal(true); setActionError(null); }} className="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700">Place Hold</button>
              )}
              {customer.on_hold && (
                <button onClick={() => { setReleaseModal(true); setActionError(null); }} className="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700">Release Hold</button>
              )}
              <button onClick={() => { setOverrideModal(true); setActionError(null); }} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Grant Override</button>
              <button onClick={() => { setSettingsModal(true); setActionError(null); }} className="px-3 py-1.5 bg-gray-700 text-white rounded text-sm hover:bg-gray-800">Edit Settings</button>
              <button onClick={loadHistory} className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50">View History</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Place Hold Modal ── */}
      {holdModal && customer && (
        <Modal title="Place Credit Hold" onClose={() => setHoldModal(false)}>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
          <select value={holdReason} onChange={e => setHoldReason(e.target.value)} className="w-full border rounded px-3 py-2 text-sm mb-3">
            {HOLD_REASONS.map(r => <option key={r} value={r}>{r.replace(/_/g,' ')}</option>)}
          </select>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
          <textarea value={holdNotes} onChange={e => setHoldNotes(e.target.value)} rows={3} className="w-full border rounded px-3 py-2 text-sm mb-3" />
          {actionError && <p className="text-sm text-red-600 mb-2">{actionError}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setHoldModal(false)} className="px-4 py-2 border rounded text-sm">Cancel</button>
            <button
              disabled={actionLoading}
              onClick={() => doAction(`/api/credit/customer/${customer.customer_id}/hold`, { reason: holdReason, notes: holdNotes || undefined })}
              className="px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
            >
              {actionLoading ? 'Placing…' : 'Place Hold'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Release Hold Modal ── */}
      {releaseModal && customer && (
        <Modal title="Release Credit Hold" onClose={() => setReleaseModal(false)}>
          <label className="block text-sm font-medium text-gray-700 mb-1">Release Notes (required)</label>
          <textarea value={releaseNotes} onChange={e => setReleaseNotes(e.target.value)} rows={3} className="w-full border rounded px-3 py-2 text-sm mb-3" />
          {actionError && <p className="text-sm text-red-600 mb-2">{actionError}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setReleaseModal(false)} className="px-4 py-2 border rounded text-sm">Cancel</button>
            <button
              disabled={actionLoading || !releaseNotes.trim()}
              onClick={() => doAction(`/api/credit/customer/${customer.customer_id}/release`, { notes: releaseNotes })}
              className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {actionLoading ? 'Releasing…' : 'Release Hold'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Override Modal ── */}
      {overrideModal && customer && (
        <Modal title="Grant Order Override" onClose={() => setOverrideModal(false)}>
          <label className="block text-sm font-medium text-gray-700 mb-1">Order ID</label>
          <input value={overrideOrderId} onChange={e => setOverrideOrderId(e.target.value)} className="w-full border rounded px-3 py-2 text-sm mb-3" />
          <label className="block text-sm font-medium text-gray-700 mb-1">Override Reason</label>
          <input value={overrideReason} onChange={e => setOverrideReason(e.target.value)} className="w-full border rounded px-3 py-2 text-sm mb-3" />
          <label className="block text-sm font-medium text-gray-700 mb-1">Expires At (optional)</label>
          <input type="datetime-local" value={overrideExpires} onChange={e => setOverrideExpires(e.target.value)} className="w-full border rounded px-3 py-2 text-sm mb-3" />
          {actionError && <p className="text-sm text-red-600 mb-2">{actionError}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOverrideModal(false)} className="px-4 py-2 border rounded text-sm">Cancel</button>
            <button
              disabled={actionLoading || !overrideOrderId.trim() || !overrideReason.trim()}
              onClick={() => doAction(`/api/credit/customer/${customer.customer_id}/override`, {
                order_id: overrideOrderId,
                reason: overrideReason,
                expires_at: overrideExpires || undefined,
              })}
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {actionLoading ? 'Granting…' : 'Grant Override'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Settings Modal ── */}
      {settingsModal && customer && (
        <Modal title="Credit Settings" onClose={() => setSettingsModal(false)}>
          <label className="block text-sm font-medium text-gray-700 mb-1">Credit Limit (blank = unlimited)</label>
          <input type="number" value={settingsCreditLimit} onChange={e => setSettingsCreditLimit(e.target.value)} className="w-full border rounded px-3 py-2 text-sm mb-3" />
          <label className="block text-sm font-medium text-gray-700 mb-1">Credit Terms</label>
          <select value={settingsTerms} onChange={e => setSettingsTerms(e.target.value)} className="w-full border rounded px-3 py-2 text-sm mb-3">
            {CREDIT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="block text-sm font-medium text-gray-700 mb-1">Warning Threshold %</label>
          <input type="number" min={0} max={100} value={settingsThreshold} onChange={e => setSettingsThreshold(e.target.value)} className="w-full border rounded px-3 py-2 text-sm mb-3" />
          <label className="flex items-center gap-2 text-sm mb-4">
            <input type="checkbox" checked={settingsAutoHold} onChange={e => setSettingsAutoHold(e.target.checked)} />
            Auto-hold enabled
          </label>
          {actionError && <p className="text-sm text-red-600 mb-2">{actionError}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setSettingsModal(false)} className="px-4 py-2 border rounded text-sm">Cancel</button>
            <button
              disabled={actionLoading}
              onClick={doSettings}
              className="px-4 py-2 bg-gray-800 text-white rounded text-sm hover:bg-gray-900 disabled:opacity-50"
            >
              {actionLoading ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── History Drawer ── */}
      {historyOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="fixed inset-0 bg-black/30" onClick={() => setHistoryOpen(false)} />
          <div className="relative z-50 w-full max-w-lg bg-white shadow-xl flex flex-col h-full">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-semibold text-gray-900">Credit History — {customer?.company_name}</h2>
              <button onClick={() => setHistoryOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-3">
              {historyLoading && <p className="text-sm text-gray-400">Loading…</p>}
              {!historyLoading && history.length === 0 && <p className="text-sm text-gray-400">No history found.</p>}
              {history.map((ev) => (
                <div key={ev.id} className="border rounded p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium capitalize">{ev.event_type.replace(/_/g,' ')}</span>
                    <span className="text-gray-400 text-xs">{fmtDate(ev.created_at)}</span>
                  </div>
                  {ev.notes && <p className="text-gray-600 mt-1">{ev.notes}</p>}
                  <p className="text-gray-400 text-xs mt-1">By: {ev.performed_by_name ?? ev.performed_by_email ?? 'system'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reusable Modal Shell ───────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-50 bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
