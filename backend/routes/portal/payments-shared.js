const { supabase } = require('../../services/supabase');
const {
  buildScopeFields,
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  scopeQueryByContext,
} = require('../../services/operating-context');
const { isOpenUnpaidInvoiceStatus } = require('../../services/invoice-delivery');
const {
  isStripeConfigured,
  isStripeTestMode,
  stripeKeyMode,
  stripeSecretKeyMode,
  portalMethodTypeForStripeType,
  findOrCreateCustomer,
  createSetupIntent,
  retrievePaymentMethod,
  attachPaymentMethod,
  detachPaymentMethod,
  createPaymentIntent,
  createCheckoutSession,
} = require('../../services/stripe');

const PORTAL_PAYMENT_ENABLED = String(process.env.PORTAL_PAYMENT_ENABLED || 'false').toLowerCase() === 'true';
const PORTAL_PAYMENT_PROVIDER = String(process.env.PORTAL_PAYMENT_PROVIDER || 'manual').toLowerCase();
const PORTAL_PAYMENT_SUPPORT_EMAIL = process.env.PORTAL_PAYMENT_SUPPORT_EMAIL || process.env.EMAIL_FROM || 'support@noderoute.com';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const PORTAL_PAYMENT_CURRENCY = String(process.env.PORTAL_PAYMENT_CURRENCY || 'usd').toLowerCase();
const PORTAL_PAYMENT_STUB_CHECKOUT_URL = process.env.PORTAL_PAYMENT_STUB_CHECKOUT_URL || '';
const STRIPE_ALLOW_LIVE_MODE = String(process.env.STRIPE_ALLOW_LIVE_MODE || 'false').toLowerCase() === 'true';
const AUTOPAY_METHOD_TYPES = ['debit_card', 'ach_bank'];

function isMissingPortalPaymentTables(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('relation') && (
    message.includes('portal_payment_methods') ||
    message.includes('portal_payment_settings') ||
    message.includes('portal_payment_events')
  );
}

function paymentTablesUnavailableResponse(res) {
  return res.status(503).json({
    error: 'Portal payment tables are not installed yet. Run supabase-portal-payments-migration.sql first.',
    code: 'PORTAL_PAYMENT_TABLES_MISSING',
  });
}

function normalizePaymentMethodType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'debit' || normalized === 'debitcard' || normalized === 'debit_card') return 'debit_card';
  if (normalized === 'ach' || normalized === 'bank' || normalized === 'ach_bank') return 'ach_bank';
  return normalized;
}

function sanitizePaymentMethod(method) {
  return {
    id: method.id,
    method_type: method.method_type,
    provider: method.provider || PORTAL_PAYMENT_PROVIDER,
    payment_method_ref: method.payment_method_ref || null,
    label: method.label || null,
    is_default: !!method.is_default,
    status: method.status || 'active',
    brand: method.brand || null,
    last4: method.last4 || null,
    exp_month: method.exp_month || null,
    exp_year: method.exp_year || null,
    bank_name: method.bank_name || null,
    account_last4: method.account_last4 || null,
    routing_last4: method.routing_last4 || null,
    account_type: method.account_type || null,
    created_at: method.created_at || null,
    updated_at: method.updated_at || null,
  };
}

function defaultAutopaySettings() {
  return {
    enabled: false,
    autopay_day_of_month: 1,
    method_id: null,
    max_amount: null,
    last_run_at: null,
    next_run_at: null,
  };
}

async function loadPortalPaymentState(req) {
  const [{ data: methodsRaw, error: methodsError }, { data: settingsRaw, error: settingsError }] = await Promise.all([
    supabase
      .from('portal_payment_methods')
      .select('*')
      .eq('customer_email', req.customerEmail)
      .order('created_at', { ascending: false }),
    supabase
      .from('portal_payment_settings')
      .select('*')
      .eq('customer_email', req.customerEmail)
      .order('updated_at', { ascending: false })
      .limit(1),
  ]);

  if (methodsError) throw methodsError;
  if (settingsError) throw settingsError;

  const methods = filterRowsByContext(methodsRaw || [], req.portalContext)
    .filter((method) => String(method.status || 'active').toLowerCase() !== 'archived')
    .map(sanitizePaymentMethod);
  const settingsRow = filterRowsByContext(settingsRaw || [], req.portalContext)[0] || null;

  return {
    methods,
    settings: settingsRow
      ? {
          enabled: !!settingsRow.autopay_enabled,
          autopay_day_of_month: settingsRow.autopay_day_of_month || 1,
          method_id: settingsRow.method_id || null,
          max_amount: settingsRow.max_amount || null,
          last_run_at: settingsRow.last_run_at || null,
          next_run_at: settingsRow.next_run_at || null,
        }
      : defaultAutopaySettings(),
  };
}

function stripePublishableKeyMode() {
  return stripeKeyMode(STRIPE_PUBLISHABLE_KEY);
}

function stripePaymentMode() {
  const secretMode = stripeSecretKeyMode();
  const publishableMode = stripePublishableKeyMode();
  if (secretMode === 'live' || publishableMode === 'live') return 'live';
  if (secretMode === 'test' && publishableMode === 'test') return 'test';
  if (secretMode === 'missing' && publishableMode === 'missing') return 'missing';
  return 'unknown';
}

function isStripeLiveModeAllowed() {
  return STRIPE_ALLOW_LIVE_MODE && stripeSecretKeyMode() === 'live' && stripePublishableKeyMode() === 'live';
}

function stripeCheckoutReadiness() {
  if (!PORTAL_PAYMENT_ENABLED) {
    return {
      ready: false,
      mode: stripePaymentMode(),
      code: 'PAYMENT_NOT_CONFIGURED',
      message: 'Online payments are not configured yet. Please use manual payment instructions.',
    };
  }

  if (PORTAL_PAYMENT_PROVIDER !== 'stripe') {
    return {
      ready: false,
      mode: stripePaymentMode(),
      code: 'PAYMENT_PROVIDER_NOT_READY',
      message: 'Checkout provider not wired yet. Configure your payment provider server-side.',
    };
  }

  if (!isStripeConfigured() || !STRIPE_PUBLISHABLE_KEY) {
    return {
      ready: false,
      mode: stripePaymentMode(),
      code: 'STRIPE_TEST_KEYS_MISSING',
      message: 'Stripe checkout preview requires test API keys. Set STRIPE_SECRET_KEY=sk_test_... and STRIPE_PUBLISHABLE_KEY=pk_test_...',
    };
  }

  if (isStripeTestMode() && stripePublishableKeyMode() === 'test') {
    return { ready: true, mode: 'test', code: 'STRIPE_TEST_MODE_READY', message: 'Stripe test mode preview is ready.' };
  }

  if (isStripeLiveModeAllowed()) {
    return { ready: true, mode: 'live', code: 'STRIPE_LIVE_MODE_READY', message: 'Stripe live mode is explicitly enabled.' };
  }

  return {
    ready: false,
    mode: stripePaymentMode(),
    code: 'STRIPE_TEST_MODE_REQUIRED',
    message: 'Stripe checkout preview is test mode only. Use sk_test_ and pk_test_ keys; live keys are blocked.',
  };
}

function stripePaymentConfigFlags() {
  const readiness = stripeCheckoutReadiness();
  return {
    mode: readiness.mode,
    test_mode: readiness.mode === 'test',
    checkout_preview: PORTAL_PAYMENT_PROVIDER === 'stripe' && readiness.mode === 'test',
    live_mode_blocked:
      PORTAL_PAYMENT_PROVIDER === 'stripe' &&
      readiness.mode === 'live' &&
      !STRIPE_ALLOW_LIVE_MODE,
    readiness_code: readiness.code,
  };
}

function isStripeProviderEnabled() {
  const readiness = stripeCheckoutReadiness();
  return PORTAL_PAYMENT_PROVIDER === 'stripe' && readiness.ready;
}

function openInvoiceStatuses() {
  return new Set(['pending', 'signed', 'sent', 'delivered', 'overdue']);
}

function invoiceIsOpen(invoice) {
  return isOpenUnpaidInvoiceStatus(invoice?.status);
}

async function listScopedCustomerInvoices(email, portalContext) {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .ilike('customer_email', email)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return filterRowsByContext(data || [], portalContext);
}

function toMoney(value) {
  return parseFloat((parseFloat(value || 0) || 0).toFixed(2));
}

async function recordPortalPaymentEvent(req, payload) {
  return insertRecordWithOptionalScope(
    supabase,
    'portal_payment_events',
    {
      ...buildScopeFields(req.portalContext),
      customer_email: req.customerEmail,
      event_type: payload.event_type,
      amount: toMoney(payload.amount),
      currency: payload.currency || PORTAL_PAYMENT_CURRENCY,
      method_id: payload.method_id || null,
      method_type: payload.method_type || null,
      provider: payload.provider || PORTAL_PAYMENT_PROVIDER,
      status: payload.status || 'queued',
      message: payload.message || null,
      created_at: new Date().toISOString(),
    },
    req.portalContext
  );
}

function stripePaymentMethodSummary(paymentMethod) {
  if (!paymentMethod) return null;
  if (paymentMethod.type === 'us_bank_account') {
    return {
      method_type: 'ach_bank',
      brand: null,
      last4: null,
      exp_month: null,
      exp_year: null,
      bank_name: paymentMethod.us_bank_account?.bank_name || null,
      account_last4: paymentMethod.us_bank_account?.last4 || null,
      routing_last4: paymentMethod.us_bank_account?.routing_number
        ? String(paymentMethod.us_bank_account.routing_number).slice(-4)
        : null,
      account_type: paymentMethod.us_bank_account?.account_type || null,
    };
  }
  return {
    method_type: 'debit_card',
    brand: paymentMethod.card?.brand || null,
    last4: paymentMethod.card?.last4 || null,
    exp_month: paymentMethod.card?.exp_month || null,
    exp_year: paymentMethod.card?.exp_year || null,
    bank_name: null,
    account_last4: null,
    routing_last4: null,
    account_type: null,
  };
}

async function portalInvoiceBalanceSummary(email, portalContext) {
  const { data, error } = await supabase
    .from('invoices')
    .select('id,total,status,customer_email,company_id,location_id,created_at')
    .ilike('customer_email', email)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const scopedInvoices = filterRowsByContext(data || [], portalContext);
  const openInvoices = scopedInvoices.filter(invoiceIsOpen);
  const openBalance = openInvoices.reduce((sum, invoice) => sum + (parseFloat(invoice.total) || 0), 0);
  return {
    invoiceCount: scopedInvoices.length,
    openInvoiceCount: openInvoices.length,
    openBalance: parseFloat(openBalance.toFixed(2)),
    openInvoices,
  };
}

async function ensureStripePortalCustomer(req) {
  return findOrCreateCustomer({
    email: req.customerEmail,
    name: req.customerName,
    metadata: {
      portal_customer_email: req.customerEmail,
      company_id: req.portalContext.companyId || '',
      location_id: req.portalContext.activeLocationId || '',
    },
  });
}

module.exports = {
  AUTOPAY_METHOD_TYPES,
  PORTAL_PAYMENT_CURRENCY,
  PORTAL_PAYMENT_ENABLED,
  PORTAL_PAYMENT_PROVIDER,
  PORTAL_PAYMENT_STUB_CHECKOUT_URL,
  PORTAL_PAYMENT_SUPPORT_EMAIL,
  STRIPE_PUBLISHABLE_KEY,
  STRIPE_ALLOW_LIVE_MODE,
  attachPaymentMethod,
  buildScopeFields,
  createCheckoutSession,
  createPaymentIntent,
  createSetupIntent,
  defaultAutopaySettings,
  detachPaymentMethod,
  ensureStripePortalCustomer,
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  invoiceIsOpen,
  isMissingPortalPaymentTables,
  isStripeProviderEnabled,
  scopeQueryByContext,
  stripeCheckoutReadiness,
  stripePaymentConfigFlags,
  stripePaymentMode,
  stripePublishableKeyMode,
  listScopedCustomerInvoices,
  loadPortalPaymentState,
  normalizePaymentMethodType,
  paymentTablesUnavailableResponse,
  portalInvoiceBalanceSummary,
  portalMethodTypeForStripeType,
  recordPortalPaymentEvent,
  retrievePaymentMethod,
  sanitizePaymentMethod,
  stripePaymentMethodSummary,
  supabase,
  toMoney,
};
