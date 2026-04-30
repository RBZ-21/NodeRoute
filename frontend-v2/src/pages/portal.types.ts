import { CreditCard, Fish, LifeBuoy, Mail, Package, Receipt } from 'lucide-react';

export type PortalTab = 'orders' | 'invoices' | 'payments' | 'contact' | 'pricing' | 'fresh-fish';

export type PortalMe = {
  email: string;
  name: string;
};

export type PortalOrder = {
  id: string;
  order_number?: string;
  customer_name?: string;
  customer_address?: string;
  items?: Array<Record<string, unknown>>;
  status?: string;
  notes?: string;
  created_at?: string;
  driver_name?: string;
};

export type PortalInvoice = {
  id: string;
  invoice_number?: string;
  customer_name?: string;
  customer_address?: string;
  items?: Array<Record<string, unknown>>;
  subtotal?: number | string;
  tax?: number | string;
  total?: number | string;
  status?: string;
  driver_name?: string;
  created_at?: string;
  signed_at?: string;
  sent_at?: string;
};

export type PortalContact = {
  email?: string;
  name?: string;
  phone?: string;
  address?: string;
  company?: string;
  door_code?: string;
};

export type SeafoodInventoryItem = {
  description?: string;
  category?: string;
  unit?: string;
  on_hand_qty?: number | string;
  on_hand_weight?: number | string;
  cost?: number | string;
  updated_at?: string;
  created_at?: string;
};

export type PortalBalance = {
  invoiceCount: number;
  openInvoiceCount: number;
  openBalance: number;
};

export type PaymentMethod = {
  id: string;
  method_type?: string;
  provider?: string;
  label?: string | null;
  is_default?: boolean;
  brand?: string | null;
  last4?: string | null;
  bank_name?: string | null;
  account_last4?: string | null;
};

export type PortalAutopay = {
  enabled?: boolean;
  autopay_day_of_month?: number | null;
  method_id?: string | null;
  max_amount?: number | string | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
};

export type PortalPaymentConfig = {
  enabled?: boolean;
  provider?: string;
  support_email?: string;
  currency?: string;
  balance?: PortalBalance;
  payment_methods?: PaymentMethod[];
  autopay?: PortalAutopay;
};

export type PortalPaymentProfile = {
  balance?: PortalBalance;
  payment_methods?: PaymentMethod[];
  autopay?: PortalAutopay;
};

export type PortalAuthStart = {
  challengeId: string;
  maskedEmail?: string;
  name?: string;
  expiresInSeconds?: number;
};

export const portalTabs: Array<{ id: PortalTab; label: string; icon: typeof Package }> = [
  { id: 'orders', label: 'Orders', icon: Package },
  { id: 'invoices', label: 'Invoices', icon: Receipt },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'contact', label: 'Contact Info', icon: Mail },
  { id: 'pricing', label: 'Pricing Help', icon: LifeBuoy },
  { id: 'fresh-fish', label: 'Fresh Fish', icon: Fish },
];

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatMoney(value: number | string | undefined | null): string {
  return asNumber(value, 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatDate(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString();
}

export function statusVariant(status: string | undefined): 'warning' | 'secondary' | 'success' | 'neutral' {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'pending') return 'warning';
  if (normalized === 'in_process' || normalized === 'processed') return 'secondary';
  if (normalized === 'signed' || normalized === 'sent' || normalized === 'paid' || normalized === 'invoiced') return 'success';
  return 'neutral';
}

export function invoiceItemsSnippet(items: Array<Record<string, unknown>> | undefined) {
  const list = Array.isArray(items) ? items : [];
  return list
    .slice(0, 3)
    .map((item) => String(item.description || item.name || item.item || 'Item'))
    .join(', ');
}

export function paymentMethodLabel(method: PaymentMethod) {
  if (method.method_type === 'ach_bank') {
    return `${method.bank_name || 'Bank Account'} •••• ${method.account_last4 || '----'}`;
  }
  return `${method.brand || 'Card'} •••• ${method.last4 || '----'}`;
}
