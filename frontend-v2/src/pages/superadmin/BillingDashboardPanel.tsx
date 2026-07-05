import { DollarSign, PackageCheck, SlidersHorizontal, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { useBillingAnalytics, useBillingCatalog } from '../../hooks/useSuperadminBilling';
import { FeatureMatrixTable } from './FeatureMatrixTable';
import type { BillingAnalyticsResponse, BillingCatalogResponse, PlanTier } from './billing-types';

function money(cents: number | null | undefined) {
  return `$${((cents ?? 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function count(value: number | null | undefined) {
  return (value ?? 0).toLocaleString('en-US');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Could not load billing dashboard.');
}

function sortedTiers(catalog: BillingCatalogResponse | undefined) {
  return [...(catalog?.tiers ?? [])].sort((a, b) => a.display_order - b.display_order);
}

function tierAnalytics(analytics: BillingAnalyticsResponse | undefined, tier: PlanTier) {
  return analytics?.tier_breakdown.find((row) => row.tier === tier.code);
}

export function BillingDashboardPanel() {
  const catalogQuery = useBillingCatalog();
  const analyticsQuery = useBillingAnalytics();
  const catalog = catalogQuery.data;
  const analytics = analyticsQuery.data;
  const loading = catalogQuery.isLoading || analyticsQuery.isLoading;
  const error = catalogQuery.error || analyticsQuery.error;
  const tiers = sortedTiers(catalog);

  return (
    <section className="space-y-4" aria-labelledby="billing-dashboard-title">
      <div className="flex flex-col gap-1">
        <h2 id="billing-dashboard-title" className="text-lg font-semibold tracking-tight">
          Billing Dashboard
        </h2>
        <p className="text-sm text-muted-foreground">
          Catalog-backed subscription revenue, add-ons, and feature availability.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive" role="alert">
          {errorMessage(error)}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <BillingStatCard
          icon={<DollarSign className="h-5 w-5 text-emerald-500" />}
          label="Billing MRR"
          value={loading ? '...' : money(analytics?.mrr_cents)}
          sub={`${count(analytics?.active_companies)} active companies`}
        />
        <BillingStatCard
          icon={<TrendingUp className="h-5 w-5 text-sky-500" />}
          label="Billing ARR"
          value={loading ? '...' : money(analytics?.arr_cents)}
          sub="Annualized from current MRR"
        />
        <BillingStatCard
          icon={<SlidersHorizontal className="h-5 w-5 text-violet-500" />}
          label="Custom Pricing"
          value={loading ? '...' : count(analytics?.custom_pricing_companies)}
          sub="Companies with overrides"
        />
        <BillingStatCard
          icon={<PackageCheck className="h-5 w-5 text-amber-500" />}
          label="Enabled Add-ons"
          value={loading ? '...' : count(analytics?.enabled_addons)}
          sub="Active add-on entitlements"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Catalog Tier Revenue</CardTitle>
            <CardDescription>Revenue by workbook pricing tier</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, index) => (
                  <div key={index} className="h-12 animate-pulse rounded-md bg-muted" />
                ))}
              </div>
            ) : tiers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pricing catalog tiers are available.</p>
            ) : (
              <div className="divide-y divide-border">
                {tiers.map((tier) => {
                  const row = tierAnalytics(analytics, tier);
                  const companyCount = row?.count ?? 0;

                  return (
                    <div key={tier.code} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium text-sm">{tier.name} tier</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {money(tier.monthly_price_cents)}/mo list
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {tier.best_for || tier.included_scope || 'Catalog pricing tier'}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold">{money(row?.mrr_cents)} MRR</div>
                        <div className="text-xs text-muted-foreground">
                          {count(companyCount)} {companyCount === 1 ? 'company' : 'companies'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Feature Matrix</CardTitle>
            <CardDescription>Workbook feature availability by tier</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-48 animate-pulse rounded-md bg-muted" />
            ) : catalog ? (
              <FeatureMatrixTable catalog={catalog} />
            ) : (
              <p className="text-sm text-muted-foreground">No feature matrix is available.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function BillingStatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardDescription>{label}</CardDescription>
          {icon}
        </div>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
