import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearPortalSession, fetchPortalBlob, fetchPortalList, fetchWithPortalAuth, sendWithPortalAuth } from '../lib/portalApi';
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

function checkoutIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function usePortalData(token: string, setToken: (t: string) => void, setMe: (me: PortalMe | null) => void) {
  const isMountedRef = useRef(true);
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

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadPortalData = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (!token) return;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    setError('');

    const results = await Promise.allSettled([
      fetchWithPortalAuth<PortalMe>('/api/portal/me'),
      fetchPortalList<PortalOrder>('/api/portal/orders'),
      fetchPortalList<PortalInvoice>('/api/portal/invoices'),
      fetchWithPortalAuth<PortalContact>('/api/portal/contact'),
      fetchPortalList<SeafoodInventoryItem>('/api/portal/inventory'),
      fetchWithPortalAuth<PortalPaymentConfig>('/api/portal/payments/config'),
      fetchWithPortalAuth<PortalPaymentProfile>('/api/portal/payments/profile'),
    ] as const);

    if (!isMountedRef.current) return;

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
    if (results[1].status === 'fulfilled') setOrders(results[1].value);
    if (results[2].status === 'fulfilled') setInvoices(results[2].value);
    if (results[3].status === 'fulfilled') setContact(results[3].value || {});
    if (results[4].status === 'fulfilled') setInventory(results[4].value);
    if (results[5].status === 'fulfilled') setPaymentsConfig(results[5].value || null);
    if (results[6].status === 'fulfilled') setPaymentsProfile(results[6].value || null);

    setLoading(false);
    setRefreshing(false);
  }, [setMe, setToken, token]);

  useEffect(() => {
    if (!token) return;
    void loadPortalData('initial');
  }, [loadPortalData, token]);

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
      if (!isMountedRef.current) return;
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
        { idempotency_key: checkoutIdempotencyKey() }
      );
      if (!isMountedRef.current) return;
      if (!payload.checkout_url) throw new Error(payload.error || 'No checkout link was returned.');
      window.location.href = payload.checkout_url;
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(String((err as Error).message || 'Could not start checkout.'));
      setPaymentBusy(false);
    }
  }

  async function runAutopayNow() {
    setPaymentBusy(true);
    setError('');
    try {
      await sendWithPortalAuth('/api/portal/payments/autopay/charge-now', 'POST', {});
      if (!isMountedRef.current) return;
      await loadPortalData('refresh');
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(String((err as Error).message || 'Could not run autopay.'));
    } finally {
      if (isMountedRef.current) setPaymentBusy(false);
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
      if (!isMountedRef.current) return;
      setContactNotice('Contact preferences saved.');
    } catch (err) {
      if (!isMountedRef.current) return;
      setContactNotice(String((err as Error).message || 'Could not save contact details.'));
    } finally {
      if (isMountedRef.current) setContactBusy(false);
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
