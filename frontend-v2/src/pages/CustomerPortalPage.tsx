import { CreditCard, Mail, Receipt, RefreshCw, LogOut, ShieldCheck, Waves } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { usePortalAuth } from '../hooks/usePortalAuth';
import { usePortalData } from '../hooks/usePortalData';
import { formatMoney, portalTabs } from './portal.types';
import type { PortalTab } from './portal.types';
import {
  ContactTab,
  FeatureCard,
  FishTab,
  InvoicesTab,
  LoadingCard,
  MiniStat,
  OrdersTab,
  PaymentsTab,
  PricingTab,
} from './PortalTabViews';

export function CustomerPortalPage() {
  const auth = usePortalAuth();
  const portal = usePortalData(auth.token, auth.setToken, auth.setMe);
  const [activeTab, setActiveTab] = useState<PortalTab>('orders');

  function logout() {
    auth.logout();
    portal.resetData();
  }

  if (!auth.token) {
    return (
      <div className="min-h-screen bg-enterprise-gradient">
        <div className="mx-auto flex min-h-screen max-w-[1320px] items-center justify-center p-4 md:p-6">
          <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1.2fr_430px]">
            <Card className="hidden border-border/80 bg-card/95 shadow-panel lg:block">
              <CardHeader className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                  <ShieldCheck className="h-4 w-4" />
                  Customer Portal V2
                </div>
                <CardTitle className="max-w-xl text-4xl leading-tight">
                  Orders, invoices, payments, and account details in one customer workspace.
                </CardTitle>
                <CardDescription className="max-w-lg text-base">
                  The portal now lives in the same modern UI system as the V2 dashboard while keeping the secure email-code sign in flow your customers already use.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <FeatureCard icon={Receipt} title="Invoice Access" description="Download invoice PDFs, track status, and review order history without waiting on office staff." />
                <FeatureCard icon={CreditCard} title="Payments Visibility" description="See open balance, payment configuration, and autopay status from the same portal session." />
                <FeatureCard icon={Mail} title="Contact Updates" description="Keep email, phone, address, and door code synced so deliveries arrive with the right details." />
                <FeatureCard icon={Waves} title="Fresh Fish Feed" description="Customers can browse in-stock seafood inventory from the portal without calling the office." />
              </CardContent>
            </Card>

            <Card className="border-border/80 bg-card/95 shadow-panel">
              <CardHeader className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                  <Mail className="h-4 w-4" />
                  Secure Portal Sign In
                </div>
                <CardTitle>{auth.authStep === 'email' ? 'Email your code' : 'Enter verification code'}</CardTitle>
                <CardDescription>
                  {auth.authStep === 'email'
                    ? 'Enter your customer email and we will send a short-lived sign-in code.'
                    : 'Use the 6-digit code from your inbox to finish signing in.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {auth.authError ? (
                  <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                    {auth.authError}
                  </div>
                ) : null}
                {auth.authMessage ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
                    {auth.authMessage}
                  </div>
                ) : null}
                <label className="space-y-1 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
                  <Input
                    type="email"
                    value={auth.email}
                    onChange={(e) => auth.setEmail(e.target.value)}
                    placeholder="you@restaurant.com"
                    autoComplete="email"
                    disabled={auth.authStep === 'code'}
                    required
                  />
                </label>
                {auth.authStep === 'code' ? (
                  <label className="space-y-1 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Verification Code</span>
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={auth.code}
                      onChange={(e) => auth.setCode(e.target.value)}
                      placeholder="Enter the 6-digit code"
                      required
                    />
                  </label>
                ) : null}
                {auth.authStep === 'email' ? (
                  <Button className="w-full" disabled={auth.authSubmitting || !auth.email.trim()} onClick={auth.requestCode}>
                    {auth.authSubmitting ? 'Sending Code...' : 'Email Verification Code'}
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <Button className="w-full" disabled={auth.authSubmitting || auth.code.trim().length !== 6} onClick={auth.verifyCode}>
                      {auth.authSubmitting ? 'Verifying...' : 'Verify and Sign In'}
                    </Button>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" disabled={auth.authSubmitting} onClick={auth.requestCode}>
                        Resend Code
                      </Button>
                      <Button variant="outline" className="flex-1" disabled={auth.authSubmitting} onClick={auth.resetLoginFlow}>
                        Use Another Email
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-enterprise-gradient">
      <div className="mx-auto max-w-[1320px] p-4 md:p-6">
        <header className="rounded-xl border border-border bg-card shadow-panel">
          <div className="flex flex-col gap-4 border-b border-border p-5 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                <Receipt className="h-4 w-4" />
                NodeRoute Customer Portal
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {auth.me?.name || portal.contact.name || auth.me?.email || 'Customer Workspace'}
              </h1>
              <p className="text-sm text-muted-foreground">
                Review orders, invoices, payments, and account details without leaving the portal.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void portal.loadPortalData('refresh')} disabled={portal.refreshing}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {portal.refreshing ? 'Refreshing...' : 'Refresh'}
              </Button>
              <Button variant="outline" onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>
          <div className="grid gap-4 p-4 lg:grid-cols-[1.2fr_0.8fr]">
            <Card className="border-border/80 bg-muted/20">
              <CardHeader>
                <CardDescription className="text-xs font-semibold uppercase tracking-wide">Open Balance</CardDescription>
                <CardTitle className="text-4xl">{formatMoney(portal.paymentBalance)}</CardTitle>
                <CardDescription>
                  {portal.openInvoiceCount} open invoice{portal.openInvoiceCount === 1 ? '' : 's'} waiting for action.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void portal.startCheckout()}
                  disabled={portal.paymentBusy || !portal.paymentsConfig?.enabled || portal.paymentBalance <= 0}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  {portal.paymentBusy ? 'Opening Checkout...' : 'Pay Online'}
                </Button>
                <Button variant="outline" onClick={() => setActiveTab('payments')}>
                  Payment Options
                </Button>
              </CardContent>
            </Card>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <MiniStat label="Orders" value={portal.orders.length.toString()} />
              <MiniStat label="Invoices" value={portal.invoices.length.toString()} />
              <MiniStat label="Saved Methods" value={portal.paymentMethods.length.toString()} />
            </div>
          </div>
        </header>

        {portal.error ? (
          <div className="mt-4 rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
            {portal.error}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {portalTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveTab(tab.id)}
                className="gap-2"
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </Button>
            );
          })}
        </div>

        <main className="mt-4">
          {portal.loading ? <LoadingCard message="Loading your customer portal..." /> : null}
          {!portal.loading && activeTab === 'orders' ? <OrdersTab orders={portal.orders} /> : null}
          {!portal.loading && activeTab === 'invoices' ? (
            <InvoicesTab invoices={portal.invoices} onDownload={(id) => void portal.downloadInvoice(id)} />
          ) : null}
          {!portal.loading && activeTab === 'payments' ? (
            <PaymentsTab
              config={portal.paymentsConfig}
              methods={portal.paymentMethods}
              autopay={portal.autopay}
              busy={portal.paymentBusy}
              onCheckout={() => void portal.startCheckout()}
              onRunAutopay={() => void portal.runAutopayNow()}
            />
          ) : null}
          {!portal.loading && activeTab === 'contact' ? (
            <ContactTab
              contact={portal.contact}
              onChange={portal.setContact}
              onSave={() => void portal.saveContact()}
              busy={portal.contactBusy}
              notice={portal.contactNotice}
            />
          ) : null}
          {!portal.loading && activeTab === 'pricing' ? (
            <PricingTab
              items={portal.pricingItems}
              markupPercent={portal.markupPercent}
              onMarkupChange={portal.setMarkupPercent}
            />
          ) : null}
          {!portal.loading && activeTab === 'fresh-fish' ? (
            <FishTab
              items={portal.filteredFish}
              query={portal.fishSearch}
              onQueryChange={portal.setFishSearch}
              totalItems={portal.inventory.length}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
