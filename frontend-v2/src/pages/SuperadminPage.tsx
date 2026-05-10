/**
 * SuperadminPage — platform owner overview dashboard.
 *
 * Wrapped in SuperadminGuard at the top of the component tree.
 * No data is fetched before the guard has passed (guard renders null on failure,
 * so SuperadminDashboard never mounts).
 *
 * Exported as both SuperadminPage (used by nav.ts lazy import) and
 * SuperadminDashboard (internal sub-component, kept separate so the guard
 * wrap is always at the outermost level).
 */
import { useEffect, useState } from 'react';
import { SuperadminGuard } from '../components/SuperadminGuard';
import { fetchWithAuth } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

// ── Types ─────────────────────────────────────────────────────────────────────

type PlatformSummary = {
  total_companies:     number;
  active_companies:    number;
  trial_companies:     number;
  suspended_companies: number;
  total_users:         number;
  orders_last_30d:     number;
  onboarding_completed:number;
  onboarding_total:    number;
  by_plan:             { plan: string; count: number }[];
  recent_signups:      { id: string; name?: string; plan?: string; status?: string; created_at?: string }[];
};

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color = '' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <Card>
      <CardHeader className="space-y-1 pb-2">
        <CardDescription className="text-xs uppercase tracking-wide">{label}</CardDescription>
        <CardTitle className={`text-3xl font-bold ${color}`}>{value}</CardTitle>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardHeader>
    </Card>
  );
}

// ── Plan badge colour ─────────────────────────────────────────────────────────

const PLAN_COLORS: Record<string, string> = {
  starter:    'bg-slate-100 text-slate-700',
  pro:        'bg-blue-100 text-blue-700',
  enterprise: 'bg-violet-100 text-violet-700',
  unknown:    'bg-muted text-muted-foreground',
};

const STATUS_COLORS: Record<string, string> = {
  active:    'bg-emerald-100 text-emerald-700',
  trial:     'bg-amber-100 text-amber-700',
  suspended: 'bg-red-100 text-red-700',
};

// ── Dashboard (rendered only after guard passes) ──────────────────────────────

function SuperadminDashboard() {
  const [summary, setSummary]   = useState<PlatformSummary | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    fetchWithAuth<PlatformSummary>('/api/superadmin/platform-summary')
      .then((data) => { setSummary(data); setLoading(false); })
      .catch((err) => { setError(String(err?.message ?? err)); setLoading(false); });
  }, []);

  return (
    <div className="space-y-6">
      {/* Header banner */}
      <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
        <strong>SuperAdmin — Platform Overview</strong>
        <span className="ml-2 text-violet-600 dark:text-violet-400">
          You are viewing cross-tenant platform analytics.
        </span>
      </div>

      {loading && (
        <div className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm">
          Loading platform summary…
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {summary && (
        <>
          {/* KPI row */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Total Companies"  value={summary.total_companies}     color="" />
            <KpiCard label="Active"           value={summary.active_companies}    color="text-emerald-600" />
            <KpiCard label="Trial"            value={summary.trial_companies}     color="text-amber-600" />
            <KpiCard label="Suspended"        value={summary.suspended_companies} color="text-red-600" />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <KpiCard
              label="Total Users"
              value={summary.total_users}
              sub="Excludes superadmin accounts"
            />
            <KpiCard
              label="Orders (30 days)"
              value={summary.orders_last_30d.toLocaleString()}
            />
            <KpiCard
              label="Onboarding"
              value={`${summary.onboarding_completed} / ${summary.onboarding_total}`}
              sub="Companies completed setup wizard"
              color={summary.onboarding_completed < summary.onboarding_total ? 'text-amber-600' : 'text-emerald-600'}
            />
          </div>

          {/* Plan breakdown + recent signups */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Plan Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {summary.by_plan.length === 0 && (
                  <p className="text-sm text-muted-foreground">No plan data.</p>
                )}
                {summary.by_plan.map(({ plan, count }) => (
                  <div key={plan} className="flex items-center justify-between gap-3">
                    <span className={`text-xs rounded px-2 py-0.5 font-medium ${PLAN_COLORS[plan] ?? PLAN_COLORS.unknown}`}>
                      {plan}
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.round((count / Math.max(summary.total_companies, 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold w-6 text-right">{count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recent Signups</CardTitle>
                <CardDescription>Last 30 days</CardDescription>
              </CardHeader>
              <CardContent>
                {summary.recent_signups.length === 0 && (
                  <p className="text-sm text-muted-foreground">No recent signups.</p>
                )}
                <ul className="space-y-2">
                  {summary.recent_signups.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium truncate">{c.name ?? c.id}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {c.plan && (
                          <span className={`text-xs rounded px-1.5 py-0.5 ${PLAN_COLORS[c.plan] ?? PLAN_COLORS.unknown}`}>
                            {c.plan}
                          </span>
                        )}
                        {c.status && (
                          <span className={`text-xs rounded px-1.5 py-0.5 ${STATUS_COLORS[c.status] ?? ''}`}>
                            {c.status}
                          </span>
                        )}
                        {c.created_at && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(c.created_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ── Exported page component ───────────────────────────────────────────────────

export function SuperadminPage() {
  return (
    <SuperadminGuard>
      <SuperadminDashboard />
    </SuperadminGuard>
  );
}
