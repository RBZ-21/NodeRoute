import { useEffect, useState } from 'react';
import { Building2, Users, TrendingUp, DollarSign, AlertTriangle, CheckCircle2, Clock, XCircle, RefreshCw, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { StatusBadge } from '../components/ui/status-badge';
import { fetchListWithAuth, fetchWithAuth } from '../lib/api';
import { SuperadminGuard } from '../components/SuperadminGuard';
import { BillingDashboardPanel } from './superadmin/BillingDashboardPanel';

// ── Types ──────────────────────────────────────────────────────────────────────

type PlatformSummary = {
  total_companies:    number;
  active_companies:   number;
  trial_companies:    number;
  suspended_companies:number;
  total_users:        number;
  total_drivers:      number;
  total_orders_month: number;
  total_routes_month: number;
  mrr_estimate:       number;
  tier_breakdown:     { tier: string; count: number; mrr: number }[];
  recent_signups:     RecentSignup[];
  alerts:             PlatformAlert[];
  usage_trend:        UsageTick[];
};

type RecentSignup = {
  id: string;
  name: string;
  admin_email: string;
  plan: string;
  status: string;
  created_at: string;
  onboarding_completed: boolean;
};

type PlatformAlert = {
  id: string;
  type: 'warning' | 'error' | 'info';
  message: string;
  company_name?: string;
  created_at: string;
};

type UsageTick = {
  label: string;
  orders: number;
  routes: number;
};

const TIER_PRICE: Record<string, number> = {
  free: 0, starter: 99, pro: 249, enterprise: 499,
};

const tierColors = {
  free:       'gray',
  starter:    'blue',
  pro:        'purple',
  enterprise: 'yellow',
} as const;

const STATUS_ICON: Record<string, React.ReactNode> = {
  active:    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
  trial:     <Clock        className="h-3.5 w-3.5 text-amber-500" />,
  suspended: <XCircle      className="h-3.5 w-3.5 text-red-500" />,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number)    { return n.toLocaleString(); }
function fmtMrr(n: number) { return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n}`; }
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function SkeletonRow() {
  return <div className="h-4 w-full animate-pulse rounded bg-muted" />;
}

// ── Inner dashboard (rendered only after guard passes) ───────────────────────

function SuperadminDashboard() {
  const [summary, setSummary]     = useState<PlatformSummary | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error,   setError]       = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<PlatformSummary>('/api/superadmin/platform-summary');
      setSummary(data);
      setLastRefresh(new Date());
    } catch (err) {
      // Fallback: synthesise from /api/superadmin/companies if dedicated endpoint not yet built
      try {
        const arr = await fetchListWithAuth<{
          id: string; name: string; admin_email: string;
          plan?: string; status?: string; created_at?: string;
          onboarding_completed?: boolean; user_count?: number;
        }>('/api/superadmin/companies');
        const tierCounts: Record<string, number> = {};
        arr.forEach((c) => { const t = c.plan ?? 'free'; tierCounts[t] = (tierCounts[t] ?? 0) + 1; });
        const mrr = Object.entries(tierCounts).reduce(
          (sum, [tier, cnt]) => sum + (TIER_PRICE[tier] ?? 0) * cnt, 0,
        );

        setSummary({
          total_companies:     arr.length,
          active_companies:    arr.filter((c) => c.status === 'active').length,
          trial_companies:     arr.filter((c) => c.status === 'trial').length,
          suspended_companies: arr.filter((c) => c.status === 'suspended').length,
          total_users:         arr.reduce((s, c) => s + (c.user_count ?? 0), 0),
          total_drivers:       0,
          total_orders_month:  0,
          total_routes_month:  0,
          mrr_estimate:        mrr,
          tier_breakdown:      Object.entries(tierCounts).map(([tier, count]) => ({
            tier, count, mrr: (TIER_PRICE[tier] ?? 0) * count,
          })),
          recent_signups: arr
            .slice()
            .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
            .slice(0, 5)
            .map((c) => ({
              id: c.id, name: c.name, admin_email: c.admin_email ?? '',
              plan: c.plan ?? 'free', status: c.status ?? 'trial',
              created_at: c.created_at ?? new Date().toISOString(),
              onboarding_completed: c.onboarding_completed ?? false,
            })),
          alerts: [],
          usage_trend: [],
        });
        setLastRefresh(new Date());
      } catch {
        setError(String((err as Error).message || 'Could not load platform summary'));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Platform Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            NodeRoute SuperAdmin · Last refreshed {lastRefresh.toLocaleTimeString()}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Banner */}
      <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
        <strong>SuperAdmin View</strong> — Full platform visibility. Actions taken here affect all tenant companies.
        Use the <strong>All Companies</strong> page to inspect or suspend individual tenants.
      </div>

      {error && (
        <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* KPI bar */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={<Building2 className="h-5 w-5 text-primary" />}    label="Total Companies"   value={loading ? '—' : fmt(summary?.total_companies ?? 0)}    sub={loading ? '' : `${fmt(summary?.active_companies ?? 0)} active · ${fmt(summary?.trial_companies ?? 0)} trial`} />
        <KpiCard icon={<Users     className="h-5 w-5 text-sky-500" />}    label="Total Users"       value={loading ? '—' : fmt(summary?.total_users ?? 0)}          sub={loading ? '' : `${fmt(summary?.total_drivers ?? 0)} drivers`} />
        <KpiCard icon={<TrendingUp className="h-5 w-5 text-emerald-500" />} label="Orders This Month" value={loading ? '—' : fmt(summary?.total_orders_month ?? 0)} sub={loading ? '' : `${fmt(summary?.total_routes_month ?? 0)} routes run`} />
        <KpiCard icon={<DollarSign className="h-5 w-5 text-amber-500" />}  label="MRR Estimate"      value={loading ? '—' : fmtMrr(summary?.mrr_estimate ?? 0)}   sub="Based on active plan tiers" highlight />
      </div>

      <BillingDashboardPanel />

      {/* Tier breakdown + Alerts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Subscription Tier Breakdown</CardTitle>
            <CardDescription>Companies and MRR contribution per tier</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}</div>
            ) : (
              <div className="space-y-3">
                {(['enterprise', 'pro', 'starter', 'free'] as const).map((tier) => {
                  const row   = summary?.tier_breakdown?.find((t) => t.tier === tier);
                  const count = row?.count ?? 0;
                  const mrr   = row?.mrr   ?? 0;
                  const total = summary?.total_companies ?? 1;
                  return (
                    <div key={tier} className="flex items-center gap-3">
                      <StatusBadge status={tier} colorMap={tierColors} className="w-20 shrink-0 justify-center" />
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: total > 0 ? `${Math.round((count / total) * 100)}%` : '0%' }} />
                      </div>
                      <span className="text-xs font-semibold w-6 text-right">{count}</span>
                      <span className="text-xs text-muted-foreground w-12 text-right">{fmtMrr(mrr)}/mo</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Platform Alerts</CardTitle>
            <CardDescription>Suspended accounts, trial follow-ups, plan violations</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <SkeletonRow key={i} />)}</div>
            ) : (
              <div className="space-y-2">
                {(summary?.suspended_companies ?? 0) > 0 && (
                  <AlertRow type="error"   message={`${summary!.suspended_companies} suspended company(s) — may need attention`} />
                )}
                {(summary?.trial_companies ?? 0) > 0 && (
                  <AlertRow type="warning" message={`${summary!.trial_companies} company(s) on trial — consider follow-up`} />
                )}
                {(summary?.alerts ?? []).map((a) => (
                  <AlertRow key={a.id} type={a.type} message={a.message} company={a.company_name} />
                ))}
                {(summary?.suspended_companies ?? 0) === 0 && (summary?.trial_companies ?? 0) === 0 && (summary?.alerts ?? []).length === 0 && (
                  <div className="flex items-center gap-2 text-sm text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" /> No active alerts — platform is healthy.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent signups */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-sm">Recent Signups</CardTitle>
            <CardDescription>Last 5 companies to join the platform</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <a href="/companies" className="flex items-center gap-1 text-xs">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}</div>
          ) : (summary?.recent_signups ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No signups yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {(summary?.recent_signups ?? []).map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2.5 gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{c.name}</span>
                      {!c.onboarding_completed && (
                        <span className="shrink-0 text-xs rounded bg-amber-100 text-amber-700 px-1.5 py-0.5">Setup pending</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{c.admin_email}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={c.plan} colorMap={tierColors} />
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">{STATUS_ICON[c.status] ?? null}{c.status}</span>
                    <span className="text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick links */}
      <div className="grid gap-3 sm:grid-cols-3">
        <QuickLink href="/companies" label="All Companies"     description="View, inspect, suspend tenants"   icon={<Building2  className="h-5 w-5" />} />
        <QuickLink href="/superadmin/waitlist"  label="Waitlist"          description="Manage signup waitlist"          icon={<Users      className="h-5 w-5" />} />
        <QuickLink href="/settings"             label="Platform Settings" description="Global config & integrations"    icon={<TrendingUp className="h-5 w-5" />} />
      </div>
    </div>
  );
}

// ── Exported page (wrapped in guard) ───────────────────────────────────────────────

export function SuperadminPage() {
  return (
    <SuperadminGuard>
      <SuperadminDashboard />
    </SuperadminGuard>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, highlight = false }: {
  icon: React.ReactNode; label: string; value: string; sub: string; highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-amber-200 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/20' : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between"><CardDescription>{label}</CardDescription>{icon}</div>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {sub && <CardContent className="pt-0"><p className="text-xs text-muted-foreground">{sub}</p></CardContent>}
    </Card>
  );
}

function AlertRow({ type, message, company }: { type: 'warning' | 'error' | 'info'; message: string; company?: string }) {
  const colors = {
    warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
    error:   'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300',
    info:    'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300',
  };
  const icons = {
    warning: <AlertTriangle className="h-3.5 w-3.5 shrink-0" />,
    error:   <XCircle       className="h-3.5 w-3.5 shrink-0" />,
    info:    <CheckCircle2  className="h-3.5 w-3.5 shrink-0" />,
  };
  return (
    <div className={`flex items-start gap-2 rounded border px-2.5 py-2 text-xs ${colors[type]}`}>
      {icons[type]}<span>{company && <strong>{company}: </strong>}{message}</span>
    </div>
  );
}

function QuickLink({ href, label, description, icon }: { href: string; label: string; description: string; icon: React.ReactNode }) {
  return (
    <a href={href} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 hover:bg-muted/50 transition-colors">
      <div className="mt-0.5 rounded-md border border-border bg-muted p-1.5 text-muted-foreground">{icon}</div>
      <div><div className="font-medium text-sm">{label}</div><div className="text-xs text-muted-foreground">{description}</div></div>
      <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground mt-0.5" />
    </a>
  );
}
