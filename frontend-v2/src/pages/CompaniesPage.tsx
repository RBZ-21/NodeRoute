import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { SelectInput } from '../components/ui/select-input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { StatCard } from '../components/ui/stat-card';
import { useToast } from '../components/ui/toast';
import { Modal } from '../components/ui/overlay-panel';
import { Input } from '../components/ui/input';
import { PageSkeleton } from '../components/layout/PageSkeleton';
import { TableEmptyState } from '../components/ui/data-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────────

type Company = {
  id: string;
  name: string;
  slug?: string;
  plan?: string;
  status?: 'active' | 'suspended' | 'trial';
  portal_ordering_enabled?: boolean;
  user_count?: number;
  admin_email?: string;
  created_at?: string;
  last_activity?: string;
  // company_config summary fields
  business_types?:       string[];
  enabled_units?:        string[];
  feat_catch_weight?:    boolean;
  feat_fsma?:            boolean;
  feat_cold_chain?:      boolean;
  feat_alcohol?:         boolean;
  feat_deposits?:        boolean;
  feat_case_to_each?:    boolean;
  catalog_template?:     string | null;
  onboarding_completed?: boolean;
};

type VerticalAnalytics = {
  total_companies:       number;
  onboarding_completed:  number;
  onboarding_incomplete: number;
  by_vertical: { type: string; count: number }[];
  feature_adoption: { flag: string; count: number; pct: number }[];
  tier_violations: { company_id: string; company_name: string; plan: string; flags_enabled: string[] }[];
};

type CompanyStats = { total: number; active: number; trial: number; suspended: number };

// ── Constants ─────────────────────────────────────────────────────────────────

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  seafood: 'Seafood', meat: 'Meat & Poultry', produce: 'Produce',
  dairy: 'Dairy & Frozen', liquor: 'Liquor/Beer/Wine', paper: 'Paper Goods',
  broadline: 'Broadline', wholesale: 'Wholesale',
};

const FEATURE_FLAG_LABELS: Record<string, string> = {
  feat_catch_weight: 'Catch Wt', feat_fsma: 'FSMA 204', feat_cold_chain: 'Cold Chain',
  feat_alcohol: 'Alcohol', feat_deposits: 'Deposits', feat_case_to_each: 'Case→Each',
};

const FEATURE_FLAG_OVERRIDES: { key: string; label: string }[] = [
  { key: 'feat_catch_weight',      label: 'Catch Weight' },
  { key: 'feat_fsma_lot_tracking', label: 'FSMA 204 Lot Tracking' },
  { key: 'feat_cold_chain_notes',  label: 'Cold Chain Notes' },
  { key: 'feat_alcohol_compliance',label: 'Alcohol Compliance' },
  { key: 'feat_deposit_tracking',  label: 'Deposit Tracking' },
  { key: 'feat_case_to_each',      label: 'Case-to-Each' },
];

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  trial:     'bg-amber-100 text-amber-700 border-amber-200',
  suspended: 'bg-red-100 text-red-700 border-red-200',
};

const VERTICAL_COLORS: Record<string, string> = {
  seafood: 'bg-blue-100 text-blue-700',   meat: 'bg-red-100 text-red-700',
  produce: 'bg-green-100 text-green-700', dairy: 'bg-purple-100 text-purple-700',
  liquor:  'bg-amber-100 text-amber-700', paper: 'bg-gray-100 text-gray-700',
  broadline:'bg-indigo-100 text-indigo-700', wholesale:'bg-cyan-100 text-cyan-700',
};

// ── Main component ─────────────────────────────────────────────────────────────

export function CompaniesPage() {
  const [companies, setCompanies]     = useState<Company[]>([]);
  const [analytics, setAnalytics]     = useState<VerticalAnalytics | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const toast = useToast();
  const [search, setSearch]           = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'trial' | 'suspended'>('all');
  const [impersonating, setImpersonating] = useState<string | null>(null);
  const [configDrawer, setConfigDrawer]   = useState<Company | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [companiesData, analyticsData] = await Promise.all([
        fetchWithAuth<Company[]>('/api/superadmin/companies'),
        fetchWithAuth<VerticalAnalytics>('/api/superadmin/analytics/verticals').catch(() => null),
      ]);
      setCompanies(Array.isArray(companiesData) ? companiesData : []);
      setAnalytics(analyticsData);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load companies'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const stats: CompanyStats = {
    total:     companies.length,
    active:    companies.filter((c) => c.status === 'active').length,
    trial:     companies.filter((c) => c.status === 'trial').length,
    suspended: companies.filter((c) => c.status === 'suspended').length,
  };

  const filtered = companies.filter((c) => {
    const matchSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.admin_email ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (c.slug ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  async function impersonate(company: Company) {
    setImpersonating(company.id);
    try {
      // The server sets the HttpOnly cookie directly — no token in the response body.
      // We only receive the impersonated user's profile for display purposes.
      const res = await sendWithAuth<{ ok: boolean; user: { id: string; name: string; email: string; role: string } }>(
        `/api/superadmin/companies/${company.id}/impersonate`, 'POST',
      );
      // Store display-only info: the banner reads nr_impersonating to know we're in impersonation mode.
      localStorage.setItem('nr_impersonating', company.name);
      localStorage.setItem('nr_user', JSON.stringify(res.user));
      window.location.href = '/dashboard';
    } catch (err) {
      toast.error(`Could not switch to ${company.name}: ${(err as Error).message}`);
    } finally {
      setImpersonating(null);
    }
  }

  async function toggleSuspend(company: Company) {
    const next = company.status === 'suspended' ? 'active' : 'suspended';
    if (!confirm(`Set ${company.name} to ${next}?`)) return;
    try {
      await sendWithAuth(`/api/superadmin/companies/${company.id}/status?status=${next}`, 'POST');
      await load();
    } catch (err) {
      toast.error(String((err as Error).message));
    }
  }

  // Paid add-on: toggle the Customer Portal Ordering feature per company.
  async function togglePortalOrdering(company: Company) {
    const next = !company.portal_ordering_enabled;
    if (!confirm(`${next ? 'Enable' : 'Disable'} online ordering for ${company.name}?`)) return;
    try {
      await sendWithAuth(`/api/superadmin/companies/${company.id}`, 'PATCH', { portal_ordering_enabled: next });
      await load();
    } catch (err) {
      toast.error(String((err as Error).message));
    }
  }

  return (
    <div className="space-y-5">
      {/* SuperAdmin banner */}
      <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
        <strong>SuperAdmin View</strong> — You are viewing all tenant companies across the NodeRoute platform.
        Use <strong>Inspect</strong> to temporarily switch into a company's context for troubleshooting.
      </div>

      {loading && <PageSkeleton />}
      {error   && <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>}

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Companies" value={stats.total.toLocaleString()} valueClassName="" />
        <StatCard label="Active"          value={stats.active.toLocaleString()} valueClassName="text-emerald-600" />
        <StatCard label="Trial"           value={stats.trial.toLocaleString()} valueClassName="text-amber-600" />
        <StatCard label="Suspended"       value={stats.suspended.toLocaleString()} valueClassName="text-red-600" />
      </div>

      {/* Vertical analytics toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Platform Analytics</h2>
        <Button variant="outline" size="sm" onClick={() => setShowAnalytics((v) => !v)}>
          {showAnalytics ? 'Hide' : 'Show'} Vertical Analytics
        </Button>
      </div>

      {showAnalytics && analytics && (
        <VerticalAnalyticsPanel analytics={analytics} />
      )}

      {/* Company table */}
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Tenant Companies</CardTitle>
            <CardDescription>All businesses using the NodeRoute platform.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Input
              placeholder="Search name, email, slug…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />
            <SelectInput
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="trial">Trial</option>
              <option value="suspended">Suspended</option>
            </SelectInput>
            <Button variant="outline" onClick={load}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="table-scroll-container overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Verticals</TableHead>
                  <TableHead>Features</TableHead>
                  <TableHead>Admin Email</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length ? filtered.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {company.name}
                        {company.onboarding_completed === false && (
                          <span className="text-xs rounded bg-amber-100 text-amber-700 px-1.5 py-0.5">Setup pending</span>
                        )}
                      </div>
                      {company.slug && <div className="text-xs text-muted-foreground font-mono">{company.slug}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(company.business_types ?? []).map((t) => (
                          <span key={t} className={`text-xs rounded px-1.5 py-0.5 font-medium ${VERTICAL_COLORS[t] ?? 'bg-muted text-muted-foreground'}`}>
                            {BUSINESS_TYPE_LABELS[t] ?? t}
                          </span>
                        ))}
                        {(company.business_types ?? []).length === 0 && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(FEATURE_FLAG_LABELS).map(([key, label]) => {
                          const on = company[key as keyof Company] === true;
                          return on ? (
                            <span key={key} className="text-xs rounded bg-primary/10 text-primary px-1.5 py-0.5">{label}</span>
                          ) : null;
                        })}
                        {!Object.keys(FEATURE_FLAG_LABELS).some((k) => company[k as keyof Company] === true) && (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{company.admin_email || '—'}</TableCell>
                    <TableCell>{company.plan || '—'}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[company.status ?? ''] ?? 'bg-muted text-muted-foreground border-border'}`}>
                        {company.status ?? 'unknown'}
                      </span>
                    </TableCell>
                    <TableCell>{company.user_count ?? '—'}</TableCell>
                    <TableCell>{company.created_at ? new Date(company.created_at).toLocaleDateString() : '—'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" disabled={impersonating === company.id} onClick={() => impersonate(company)}>
                          {impersonating === company.id ? 'Switching…' : 'Inspect'}
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          className={company.status === 'suspended' ? 'text-emerald-600' : 'text-red-600'}
                          onClick={() => toggleSuspend(company)}
                        >
                          {company.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfigDrawer(company)}>
                          Config
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className={company.portal_ordering_enabled ? 'text-primary' : 'text-muted-foreground'}
                          title="Customer Portal Ordering add-on"
                          onClick={() => togglePortalOrdering(company)}
                        >
                          {company.portal_ordering_enabled ? 'Ordering: On' : 'Ordering: Off'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableEmptyState
                    colSpan={9}
                    title="No companies match the current filters."
                    description="Clear the filters or refresh the tenant list to check for newly onboarded companies."
                    actionLabel="Refresh"
                    onAction={() => void load()}
                  />
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Config override drawer */}
      {configDrawer && (
        <ConfigOverrideDrawer
          company={configDrawer}
          onClose={() => setConfigDrawer(null)}
          onSaved={() => { setConfigDrawer(null); load(); }}
        />
      )}
    </div>
  );
}

// ── Vertical analytics panel ───────────────────────────────────────────────────

function VerticalAnalyticsPanel({ analytics }: { analytics: VerticalAnalytics }) {
  const totalCompanies = analytics.total_companies || 1; // avoid div/0

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* Companies by vertical */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Companies by Vertical</CardTitle>
          <CardDescription>
            {analytics.onboarding_completed} of {analytics.total_companies} completed onboarding
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {analytics.by_vertical.length === 0 && (
            <p className="text-sm text-muted-foreground">No vertical data yet.</p>
          )}
          {analytics.by_vertical.map(({ type, count }) => (
            <div key={type} className="flex items-center justify-between gap-3">
              <span className={`text-xs rounded px-1.5 py-0.5 font-medium ${VERTICAL_COLORS[type] ?? 'bg-muted text-muted-foreground'}`}>
                {BUSINESS_TYPE_LABELS[type] ?? type}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((count / totalCompanies) * 100)}%` }} />
              </div>
              <span className="text-xs font-semibold w-5 text-right">{count}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Feature flag adoption */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Feature Adoption</CardTitle>
          <CardDescription>Most-enabled features across all tenants</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {analytics.feature_adoption.map(({ flag, count, pct }) => (
            <div key={flag} className="flex items-center justify-between gap-3">
              <span className="text-xs truncate">{FEATURE_FLAG_LABELS[flag.replace('feat_fsma_lot_tracking', 'feat_fsma').replace('feat_cold_chain_notes','feat_cold_chain').replace('feat_alcohol_compliance','feat_alcohol').replace('feat_deposit_tracking','feat_deposits')] ?? flag}</span>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs font-semibold w-14 text-right text-muted-foreground">{count} ({pct}%)</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Tier violations */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Plan Tier Flags</CardTitle>
          <CardDescription>Companies using enterprise features on non-enterprise plans</CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.tier_violations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No violations detected.</p>
          ) : (
            <div className="space-y-2">
              {analytics.tier_violations.map((v) => (
                <div key={v.company_id} className="rounded border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-2 py-1.5 text-xs">
                  <div className="font-medium text-amber-800 dark:text-amber-300">{v.company_name}</div>
                  <div className="text-amber-700 dark:text-amber-400">
                    Plan: <strong>{v.plan}</strong> — using: {v.flags_enabled.join(', ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Config override drawer ────────────────────────────────────────────────────

function ConfigOverrideDrawer({
  company, onClose, onSaved,
}: { company: Company; onClose: () => void; onSaved: () => void }) {
  const [flags, setFlags] = useState<Record<string, boolean>>({
    feat_catch_weight:       company.feat_catch_weight    ?? false,
    feat_fsma_lot_tracking:  company.feat_fsma            ?? false,
    feat_cold_chain_notes:   company.feat_cold_chain      ?? false,
    feat_alcohol_compliance: company.feat_alcohol         ?? false,
    feat_deposit_tracking:   company.feat_deposits        ?? false,
    feat_case_to_each:       company.feat_case_to_each    ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      await sendWithAuth(`/api/superadmin/companies/${company.id}/config`, 'PATCH', flags);
      onSaved();
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      align="bottom"
      title={company.name}
      description="Override company_config feature flags (superadmin only)"
      onClose={onClose}
      widthClassName="max-w-md"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save Overrides'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-3">
          {FEATURE_FLAG_OVERRIDES.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-sm">{label}</span>
              <button
                type="button"
                role="switch"
                aria-checked={flags[key]}
                onClick={() => setFlags((f) => ({ ...f, [key]: !f[key] }))}
                className={`relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors ${flags[key] ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${flags[key] ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </Modal>
  );
}
