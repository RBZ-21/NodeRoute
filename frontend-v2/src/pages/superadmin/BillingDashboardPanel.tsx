import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { StatCard } from '../../components/ui/stat-card';
import { useBillingAnalytics, useBillingCatalog } from '../../hooks/useSuperadminBilling';
import { FeatureMatrixTable } from './FeatureMatrixTable';

function money(cents: number | null | undefined) {
  const value = Number(cents || 0) / 100;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function BillingDashboardPanel() {
  const catalog = useBillingCatalog();
  const analytics = useBillingAnalytics();
  const loading = catalog.isLoading || analytics.isLoading;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Billing MRR" value={loading ? '-' : money(analytics.data?.mrr_cents)} valueClassName="text-emerald-600" />
        <StatCard label="Billing ARR" value={loading ? '-' : money(analytics.data?.arr_cents)} valueClassName="text-sky-600" />
        <StatCard label="Custom Pricing" value={loading ? '-' : String(analytics.data?.custom_pricing_companies || 0)} valueClassName="" />
        <StatCard label="Enabled Add-ons" value={loading ? '-' : String(analytics.data?.enabled_addons || 0)} valueClassName="" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Tier Revenue</CardTitle>
            <CardDescription>Active MRR by workbook-backed tier.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(catalog.data?.tiers || []).map((tier) => {
              const row = analytics.data?.tier_breakdown.find((item) => item.tier === tier.code);
              return (
                <div key={tier.code} className="grid grid-cols-[7rem_1fr_5rem] items-center gap-3 text-sm">
                  <span className="font-medium">{tier.name}</span>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, (row?.count || 0) * 12)}%` }} />
                  </div>
                  <span className="text-right text-muted-foreground">{money(row?.mrr_cents)}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Feature Matrix</CardTitle>
            <CardDescription>Default package structure from the pricing workbook.</CardDescription>
          </CardHeader>
          <CardContent>
            {catalog.data ? <FeatureMatrixTable catalog={catalog.data} /> : <div className="text-sm text-muted-foreground">Loading feature matrix...</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
