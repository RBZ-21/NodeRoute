import { useEffect, useMemo, useState } from 'react';
import { clearPortalSession, fetchPortalBlob, fetchWithPortalAuth, getPortalToken, sendWithPortalAuth } from '../lib/portalApi';
import type {
  PortalContact,
  PortalInvoice,
  PortalMe,
  PortalOrder,
  PortalPaymentConfig,
  PortalPaymentProfile,
  SeafoodInventoryItem,
} from '../pages/portal.types';
import { asNumber } from '../pages/portal.types';

export function usePortalData(token: string, setToken: (t: string) => void, setMe: (me: PortalMe | null) => void) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [orders, setOrders] = useState<PortalOrder[]>([]);
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [contact, setContact] = useState<PortalContact>({});
  const [inventory, setInventory] = useState<SeafoodInventoryItem[]>([]);
  const [paymentsConfig, setPaymentsConfig] = useState<PortalPaymentConfig | null>(null);
  const [paymentsProfile, setPaymentsProfile] = useState<PortalPaymentProfile | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactNotice, setContactNotice] = useState('');
  const [markupPercent, setMarkupPercent] = useState('18');
  const [fishSearch, setFishSearch] = useState('');

  async function loadPortalData(mode: 'initial' | 'refresh' = 'initial') {
    if (!getPortalToken()) return;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    setError('');

    const results = await Promise.allSettled([
      fetchWithPortalAuth<PortalMe>('/api/portal/me'),
      fetchWithPortalAuth<PortalOrder[]>('/api/portal/orders'),
      fetchWithPortalAuth<PortalInvoice[]>('/api/portal/invoices'),
      fetchWithPortalAuth<PortalContact>('/api/portal/contact'),
      fetchWithPortalAuth<SeafoodInventoryItem[]>('/api/portal/inventory'),
      fetchWithPortalAuth<PortalPaymentConfig>('/api/portal/payments/config'),
      fetchWithPortalAuth<PortalPaymentProfile>('/api/portal/payments/profile'),
    ]);

    const firstError = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (firstError) {
      const message = String(firstError.reason?.message || 'Could not load the customer portal right now.');
      setError(message);
      if (message.toLowerCase().includes('session')) {
        clearPortalSession();
        setToken('');
      }
    }

    if (results[0].status === 'fulfilled') setMe(results[0].value);
    if (results[1].status === 'fulfilled') setOrders(Array.isArray(results[1].value) ? results[1].value : []);
    if (results[2].status === 'fulfilled') setInvoices(Array.isArray(results[2].value) ? results[2].value : []);
    if (results[3].status === 'fulfilled') setContact(results[3].value || {});
    if (results[4].status === 'fulfilled') setInventory(Array.isArray(results[4].value) ? results[4].value : []);
    if (results[5].status === 'fulfilled') setPaymentsConfig(results[5].value || null);
    if (results[6].status === 'fulfilled') setPaymentsProfile(results[6].value || null);

    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    if (!token) return;
    void loadPortalData('initial');
  }, [token]);

  function resetData() {
    setOrders([]);
    setInvoices([]);
    setInventory([]);
    setPaymentsConfig(null);
    setPaymentsProfile(null);
    setError('');
  }

  async function downloadInvoice(invoiceId: string) {
    try {
      const blob = await fetchPortalBlob(`/api/portal/invoices/${invoiceId}/pdf`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      setError(String((err as Error).message || 'Could not download that invoice.'));
    }
  }

  async function startCheckout() {
    setPaymentBusy(true);
    setError('');
    try {
      const payload = await sendWithPortalAuth<{ checkout_url?: string; error?: string }>(
        '/api/portal/payments/create-checkout-session',
        'POST',
        {}
      );
      if (!payload.checkout_url) throw new Error(payload.error || 'No checkout link was returned.');
      window.location.href = payload.checkout_url;
    } catch (err) {
      setError(String((err as Error).message || 'Could not start checkout.'));
      setPaymentBusy(false);
    }
  }

  async function runAutopayNow() {
    setPaymentBusy(true);
    setError('');
    try {
      await sendWithPortalAuth('/api/portal/payments/autopay/charge-now', 'POST', {});
      await loadPortalData('refresh');
    } catch (err) {
      setError(String((err as Error).message || 'Could not run autopay.'));
    } finally {
      setPaymentBusy(false);
    }
  }

  async function saveContact() {
    setContactBusy(true);
    setContactNotice('');
    try {
      await Promise.all([
        sendWithPortalAuth('/api/portal/contact', 'PATCH', {
          name: contact.name || '',
          phone: contact.phone || '',
          address: contact.address || '',
          company: contact.company || '',
        }),
        sendWithPortalAuth('/api/portal/doorcode', 'PATCH', {
          door_code: contact.door_code || '',
        }),
      ]);
      setContactNotice('Contact preferences saved.');
    } catch (err) {
      setContactNotice(String((err as Error).message || 'Could not save contact details.'));
    } finally {
      setContactBusy(false);
    }
  }

  const paymentBalance = paymentsConfig?.balance?.openBalance ?? paymentsProfile?.balance?.openBalance ?? 0;
  const openInvoiceCount = paymentsConfig?.balance?.openInvoiceCount ?? paymentsProfile?.balance?.openInvoiceCount ?? 0;
  const paymentMethods = paymentsProfile?.payment_methods ?? paymentsConfig?.payment_methods ?? [];
  const autopay = paymentsProfile?.autopay ?? paymentsConfig?.autopay ?? {};

  const pricingItems = useMemo(() => {
    const seen = new Map<string, { description: string; unit: string; unitPrice: number }>();
    invoices.forEach((invoice) => {
      const items = Array.isArray(invoice.items) ? invoice.items : [];
      items.forEach((item) => {
        const description = String(item.description || item.name || item.item || '').trim();
        if (!description) return;
        const key = description.toLowerCase();
        const candidate = {
          description,
          unit: String(item.unit || ''),
          unitPrice: asNumber(item.unit_price ?? item.price ?? item.cost, 0),
        };
        const existing = seen.get(key);
        if (!existing || candidate.unitPrice > existing.unitPrice) seen.set(key, candidate);
      });
    });
    return [...seen.values()].sort((a, b) => a.description.localeCompare(b.description));
  }, [invoices]);

  const filteredFish = useMemo(() => {
    const query = fishSearch.trim().toLowerCase();
    if (!query) return inventory;
    return inventory.filter((item) => {
      const haystack = `${item.description || ''} ${item.category || ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [fishSearch, inventory]);

  return {
    loading, refreshing, error,
    orders, invoices,
    contact, setContact,
    inventory,
    paymentsConfig, paymentsProfile,
    paymentBusy, contactBusy, contactNotice,
    markupPercent, setMarkupPercent,
    fishSearch, setFishSearch,
    paymentBalance, openInvoiceCount, paymentMethods, autopay,
    pricingItems, filteredFish,
    loadPortalData, resetData,
    downloadInvoice, startCheckout, runAutopayNow, saveContact,
  };
}
