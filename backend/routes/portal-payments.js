const express = require('express');
const { supabase } = require('../services/supabase');
const {
  buildScopeFields,
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
} = require('../services/operating-context');
const {
  isStripeConfigured,
  portalMethodTypeForStripeType,
  findOrCreateCustomer,
  createSetupIntent,
  retrievePaymentMethod,
  attachPaymentMethod,
  detachPaymentMethod,
  createPaymentIntent,
  createCheckoutSession,
} = require('../services/stripe');

const PORTAL_PAYMENT_ENABLED = String(process.env.PORTAL_PAYMENT_ENABLED || 'false').toLowerCase() === 'true';
const PORTAL_PAYMENT_PROVIDER = String(process.env.PORTAL_PAYMENT_PROVIDER || 'manual').toLowerCase();
const PORTAL_PAYMENT_SUPPORT_EMAIL = process.env.PORTAL_PAYMENT_SUPPORT_EMAIL || process.env.EMAIL_FROM || 'support@noderoute.com';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const PORTAL_PAYMENT_CURRENCY = String(process.env.PORTAL_PAYMENT_CURRENCY || 'usd').toLowerCase();
const PORTAL_PAYMENT_STUB_CHECKOUT_URL = process.env.PORTAL_PAYMENT_STUB_CHECKOUT_URL || '';
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

function isStripeProviderEnabled() {
  return PORTAL_PAYMENT_ENABLED && PORTAL_PAYMENT_PROVIDER === 'stripe' && !!STRIPE_PUBLISHABLE_KEY && isStripeConfigured();
}

function openInvoiceStatuses() {
  return new Set(['pending', 'signed', 'sent']);
}

function invoiceIsOpen(invoice) {
  return openInvoiceStatuses().has(String(invoice?.status || '').toLowerCase());
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
    .select('id,total,status')
    .ilike('customer_email', email)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const scopedInvoices = filterRowsByContext(data || [], portalContext);
  const openInvoices = scopedInvoices.filter(invoiceIsOpen);
  const openBalance = openInvoices.reduce((sum, invoice) => sum + (parseFloat(invoice.total) || 0), 0);
  return {
    invoiceCount: scopedInvoices.length,
    openInvoiceCount: openInvoices.length,
    openBalance: parseFloat(openBalance.toFixed(2)),
  };
}

module.exports = function buildPaymentsRouter({ authenticatePortalToken }) {
  const router = express.Router();

  // GET /api/portal/payments/config
  router.get('/payments/config', authenticatePortalToken, async (req, res) => {
    try {
      const balance = await portalInvoiceBalanceSummary(req.customerEmail, req.portalContext);
      const paymentState = await loadPortalPaymentState(req);
      const providerEnabled =
        (isStripeProviderEnabled()) ||
        (PORTAL_PAYMENT_ENABLED && PORTAL_PAYMENT_PROVIDER === 'stub' && !!PORTAL_PAYMENT_STUB_CHECKOUT_URL);

      return res.json({
        enabled: providerEnabled,
        provider: PORTAL_PAYMENT_PROVIDER,
        publishable_key: PORTAL_PAYMENT_PROVIDER === 'stripe' ? STRIPE_PUBLISHABLE_KEY : null,
        currency: PORTAL_PAYMENT_CURRENCY,
        support_email: PORTAL_PAYMENT_SUPPORT_EMAIL,
        manual_payment_available: true,
        supported_method_types: AUTOPAY_METHOD_TYPES,
        supports_autopay: true,
        balance,
        payment_methods: paymentState.methods,
        autopay: paymentState.settings,
      });
    } catch (error) {
      if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
      return res.status(500).json({ error: error.message || 'Could not load payment configuration' });
    }
  });

  // GET /api/portal/payments/profile
  router.get('/payments/profile', authenticatePortalToken, async (req, res) => {
    try {
      const [balance, paymentState] = await Promise.all([
        portalInvoiceBalanceSummary(req.customerEmail, req.portalContext),
        loadPortalPaymentState(req),
      ]);
      return res.json({
        customer_email: req.customerEmail,
        supported_method_types: AUTOPAY_METHOD_TYPES,
        payment_methods: paymentState.methods,
        autopay: paymentState.settings,
        balance,
      });
    } catch (error) {
      if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
      return res.status(500).json({ error: error.message || 'Could not load payment profile' });
    }
  });

  // POST /api/portal/payments/setup-intent
  router.post('/payments/setup-intent', authenticatePortalToken, async (req, res) => {
    try {
      if (!isStripeProviderEnabled()) {
        return res.status(501).json({
          error: 'Stripe setup intents are not configured yet.',
          code: 'STRIPE_NOT_CONFIGURED',
        });
      }

      const methodType = normalizePaymentMethodType(req.body.method_type || 'debit_card');
      if (!AUTOPAY_METHOD_TYPES.includes(methodType)) {
        return res.status(400).json({ error: 'method_type must be debit_card or ach_bank' });
      }

      const customer = await findOrCreateCustomer({
        email: req.customerEmail,
        name: req.customerName,
        metadata: {
          portal_customer_email: req.customerEmail,
          company_id: req.portalContext.companyId || '',
          location_id: req.portalContext.activeLocationId || '',
        },
      });
      const setupIntent = await createSetupIntent({
        customerId: customer.id,
        methodType,
        metadata: {
          customer_email: req.customerEmail,
          company_id: req.portalContext.companyId || '',
          location_id: req.portalContext.activeLocationId || '',
        },
      });

      return res.json({
        provider: 'stripe',
        publishable_key: STRIPE_PUBLISHABLE_KEY,
        customer_id: customer.id,
        setup_intent_id: setupIntent.id,
        client_secret: setupIntent.client_secret,
        method_type: methodType,
      });
    } catch (error) {
      if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
      return res.status(500).json({ error: error.message || 'Could not create setup intent' });
    }
  });

  // POST /api/portal/payments/methods
  router.post('/payments/methods', authenticatePortalToken, async (req, res) => {
    try {
      const requestedMethodType = normalizePaymentMethodType(req.body.method_type);
      let methodType = requestedMethodType;
      if (!AUTOPAY_METHOD_TYPES.includes(methodType)) {
        return res.status(400).json({ error: 'method_type must be debit_card or ach_bank' });
      }

      const paymentMethodRef = String(req.body.payment_method_ref || '').trim();
      if (!paymentMethodRef) return res.status(400).json({ error: 'payment_method_ref is required' });

      const existingState = await loadPortalPaymentState(req);
      const nowIso = new Date().toISOString();
      const isDefault = req.body.is_default === true || req.body.is_default === 'true' || !existingState.methods.length;
      const provider = String(req.body.provider || PORTAL_PAYMENT_PROVIDER || 'manual').toLowerCase();
      let stripeSummary = null;

      if (provider === 'stripe') {
        if (!isStripeProviderEnabled()) {
          return res.status(501).json({ error: 'Stripe is not configured on this environment' });
        }
        const customer = await findOrCreateCustomer({
          email: req.customerEmail,
          name: req.customerName,
          metadata: {
            portal_customer_email: req.customerEmail,
            company_id: req.portalContext.companyId || '',
            location_id: req.portalContext.activeLocationId || '',
          },
        });
        await attachPaymentMethod({ paymentMethodId: paymentMethodRef, customerId: customer.id });
        const stripeMethod = await retrievePaymentMethod(paymentMethodRef);
        stripeSummary = stripePaymentMethodSummary(stripeMethod);
        const normalizedStripeType = portalMethodTypeForStripeType(stripeMethod.type);
        if (requestedMethodType && requestedMethodType !== normalizedStripeType) {
          return res.status(400).json({ error: 'Selected method type does not match Stripe payment method type' });
        }
        methodType = normalizedStripeType;
      } else {
        if (methodType === 'debit_card') {
          const last4 = String(req.body.last4 || '').trim();
          const expMonth = Number(req.body.exp_month);
          const expYear = Number(req.body.exp_year);
          if (!/^\d{4}$/.test(last4)) return res.status(400).json({ error: 'Debit card last4 must be 4 digits' });
          if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) return res.status(400).json({ error: 'exp_month must be 1-12' });
          if (!Number.isInteger(expYear) || expYear < new Date().getFullYear()) return res.status(400).json({ error: 'exp_year is invalid' });
        }
        if (methodType === 'ach_bank') {
          const accountLast4 = String(req.body.account_last4 || '').trim();
          if (!/^\d{4}$/.test(accountLast4)) return res.status(400).json({ error: 'ACH account_last4 must be 4 digits' });
        }
      }

      const insertPayload = {
        ...buildScopeFields(req.portalContext),
        customer_email: req.customerEmail,
        method_type: methodType,
        provider,
        label: String(req.body.label || '').trim() || null,
        payment_method_ref: paymentMethodRef,
        is_default: isDefault,
        status: 'active',
        brand: methodType === 'debit_card' ? (stripeSummary?.brand ?? (String(req.body.brand || '').trim() || null)) : null,
        last4: methodType === 'debit_card' ? (stripeSummary?.last4 ?? String(req.body.last4 || '').trim()) : null,
        exp_month: methodType === 'debit_card' ? (stripeSummary?.exp_month ?? Number(req.body.exp_month)) : null,
        exp_year: methodType === 'debit_card' ? (stripeSummary?.exp_year ?? Number(req.body.exp_year)) : null,
        bank_name: methodType === 'ach_bank' ? (stripeSummary?.bank_name ?? (String(req.body.bank_name || '').trim() || null)) : null,
        account_last4: methodType === 'ach_bank' ? (stripeSummary?.account_last4 ?? String(req.body.account_last4 || '').trim()) : null,
        routing_last4: methodType === 'ach_bank' ? (stripeSummary?.routing_last4 ?? (String(req.body.routing_last4 || '').trim() || null)) : null,
        account_type: methodType === 'ach_bank'
          ? (stripeSummary?.account_type ?? (String(req.body.account_type || '').trim().toLowerCase() || null))
          : null,
        created_at: nowIso,
        updated_at: nowIso,
      };

      const insertResult = await insertRecordWithOptionalScope(supabase, 'portal_payment_methods', insertPayload, req.portalContext);
      if (insertResult.error) throw insertResult.error;

      if (isDefault) {
        for (const existingMethod of existingState.methods) {
          if (existingMethod.id === insertResult.data.id) continue;
          await supabase
            .from('portal_payment_methods')
            .update({ is_default: false, updated_at: nowIso })
            .eq('id', existingMethod.id);
        }
      }

      return res.json({
        message: 'Payment method saved',
        method: sanitizePaymentMethod(insertResult.data),
      });
    } catch (error) {
      if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
      return res.status(500).json({ error: error.message || 'Could not save payment method' });
    }
  });

  // DELETE /api/portal/payments/methods/:id
  router.delete('/payments/methods/:id', authenticatePortalToken, async (req, res) => {
    try {
      const methodId = String(req.params.id || '').trim();
      if (!methodId) return res.status(400).json({ error: 'Payment method id is required' });

      const paymentState = await loadPortalPaymentState(req);
      const target = paymentState.methods.find((method) => method.id === methodId);
      if (!target) return res.status(404).json({ error: 'Payment method not found' });

      if (String(target.provider || '').toLowerCase() === 'stripe' && target.payment_method_ref) {
        try {
          await detachPaymentMethod(target.payment_method_ref);
        } catch (error) {
          // Continue archival in NodeRoute even if Stripe already detached / unavailable.
        }
      }

      const archiveResult = await executeWithOptionalScope(
        (candidate) => supabase.from('portal_payment_methods').update(candidate).eq('id', methodId).select('*').single(),
        { status: 'archived', is_default: false, updated_at: new Date().toISOString() }
      );
      if (archiveResult.error) throw archiveResult.error;

      if (target.is_default) {
        const remaining = paymentState.methods.filter((method) => method.id !== methodId);
        if (remaining[0]) {
          await supabase
            .from('portal_payment_methods')
            .update({ is_default: true, updated_at: new Date().toISOString() })
            .eq('id', remaining[0].id);
        }
      }

      return res.json({ message: 'Payment method removed' });
    } catch (error) {
      if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
      return res.status(500).json({ error: error.message || 'Could not remove payment method' });
    }
  });

  // PATCH /api/portal/payments/autopay
  router.patch('/payments/autopay', authenticatePortalToken, async (req, res) => {
    try {
      const paymentState = await loadPortalPaymentState(req);
      const enabled = req.body.enabled === true || req.body.enabled === 'true';
      const methodId = String(req.body.method_id || '').trim() || null;
      const dayOfMonth = Math.max(1, Math.min(28, Number(req.body.autopay_day_of_month || 1)));
      const maxAmount = req.body.max_amount == null || req.body.max_amount === ''
        ? null
        : parseFloat(req.body.max_amount);

      if (enabled) {
        if (!methodId) return res.status(400).json({ error: 'method_id is required when enabling autopay' });
        const methodExists = paymentState.methods.some((method) => method.id === methodId);
        if (!methodExists) return res.status(400).json({ error: 'Selected payment method is not available' });
      }

      const nextRun = enabled
        ? (() => {
            const now = new Date();
            const next = new Date(now);
            next.setUTCDate(1);
            next.setUTCHours(12, 0, 0, 0);
            next.setUTCDate(dayOfMonth);
            if (next.getTime() <= now.getTime()) next.setUTCMonth(next.getUTCMonth() + 1);
            return next.toISOString();
          })()
        : null;

      const nowIso = new Date().toISOString();
      const payload = {
        ...buildScopeFields(req.portalContext),
        customer_email: req.customerEmail,
        autopay_enabled: enabled,
        method_id: enabled ? methodId : null,
        autopay_day_of_month: enabled ? dayOfMonth : 1,
        max_amount: Number.isFinite(maxAmount) ? maxAmount : null,
        next_run_at: nextRun,
        updated_at: nowIso,
      };

      const { data: existingRows, error: existingErr } = await supabase
        .from('portal_payment_settings')
        .select('*')
        .eq('customer_email', req.customerEmail)
        .order('updated_at', { ascending: false })
        .limit(10);
      if (existingErr) throw existingErr;
      const existing = filterRowsByContext(existingRows || [], req.portalContext)[0] || null;

      const writeResult = existing?.id
        ? await executeWithOptionalScope(
            (candidate) => supabase.from('portal_payment_settings').update(candidate).eq('id', existing.id).select('*').single(),
            payload
          )
        : await insertRecordWithOptionalScope(supabase, 'portal_payment_settings', payload, req.portalContext);

      if (writeResult.error) throw writeResult.error;
      return res.json({
        message: 'Autopay settings updated',
        autopay: {
          enabled: !!writeResult.data.autopay_enabled,
          method_id: writeResult.data.method_id || null,
          autopay_day_of_month: writeResult.data.autopay_day_of_month || 1,
          max_amount: writeResult.data.max_amount || null,
          next_run_at: writeResult.data.next_run_at || null,
          last_run_at: writeResult.data.last_run_at || null,
        },
      });
    } catch (error) {
      if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
      return res.status(500).json({ error: error.message || 'Could not update autopay settings' });
    }
  });

  // POST /api/portal/payments/autopay/charge-now
  router.post('/payments/autopay/charge-now', authenticatePortalToken, async (req, res) => {
    try {
      if (!isStripeProviderEnabled()) {
        return res.status(501).json({ error: 'Stripe autopay is not configured', code: 'STRIPE_NOT_CONFIGURED' });
      }

      const [invoices, paymentState] = await Promise.all([
        listScopedCustomerInvoices(req.customerEmail, req.portalContext),
        loadPortalPaymentState(req),
      ]);
      const openInvoices = invoices.filter(invoiceIsOpen);
      const openBalance = toMoney(openInvoices.reduce((sum, invoice) => sum + toMoney(invoice.total), 0));

      if (!paymentState.settings.enabled && req.body?.force !== true) {
        return res.status(400).json({ error: 'Autopay is not enabled', code: 'AUTOPAY_DISABLED' });
      }
      if (openBalance <= 0) {
        return res.status(400).json({ error: 'No open balance to pay', code: 'NO_OPEN_BALANCE' });
      }

      const method = paymentState.methods.find((m) => m.id === paymentState.settings.method_id) || null;
      if (!method) return res.status(400).json({ error: 'Autopay method is missing', code: 'AUTOPAY_METHOD_MISSING' });
      if (String(method.provider || '').toLowerCase() !== 'stripe') {
        return res.status(400).json({ error: 'Autopay method must be a Stripe payment method', code: 'AUTOPAY_METHOD_INVALID' });
      }

      const customer = await findOrCreateCustomer({
        email: req.customerEmail,
        name: req.customerName,
        metadata: {
          portal_customer_email: req.customerEmail,
          company_id: req.portalContext.companyId || '',
          location_id: req.portalContext.activeLocationId || '',
        },
      });

      const maxAmount = Number.isFinite(parseFloat(paymentState.settings.max_amount))
        ? toMoney(paymentState.settings.max_amount)
        : null;
      let runningTotal = 0;
      const processed = [];
      const failures = [];

      for (const invoice of openInvoices) {
        const amount = toMoney(invoice.total);
        if (maxAmount != null && runningTotal + amount > maxAmount) break;
        try {
          const intent = await createPaymentIntent({
            amount,
            currency: PORTAL_PAYMENT_CURRENCY,
            customerId: customer.id,
            paymentMethodId: method.payment_method_ref,
            description: `NodeRoute invoice ${invoice.invoice_number || invoice.id}`,
            metadata: {
              source: 'autopay_charge_now',
              customer_email: req.customerEmail,
              invoice_id: invoice.id,
              company_id: req.portalContext.companyId || '',
              location_id: req.portalContext.activeLocationId || '',
            },
            idempotencyKey: `portal-autopay-${invoice.id}-${Date.now()}`,
          });

          const status = String(intent.status || 'queued');
          await recordPortalPaymentEvent(req, {
            event_type: 'autopay_charge_now',
            amount,
            method_id: method.id,
            method_type: method.method_type,
            provider: 'stripe',
            status,
            message: `Stripe payment intent ${intent.id}`,
          });

          if (status === 'succeeded') {
            await supabase.from('invoices').update({ status: 'paid', sent_at: new Date().toISOString() }).eq('id', invoice.id);
          }

          runningTotal += amount;
          processed.push({
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number || null,
            amount,
            intent_id: intent.id,
            status,
          });
        } catch (error) {
          failures.push({
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number || null,
            amount,
            error: error.message,
          });
          await recordPortalPaymentEvent(req, {
            event_type: 'autopay_charge_now',
            amount,
            method_id: method.id,
            method_type: method.method_type,
            provider: 'stripe',
            status: 'failed',
            message: error.message,
          });
        }
      }

      await supabase
        .from('portal_payment_settings')
        .update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('customer_email', req.customerEmail);

      return res.json({
        message: processed.length
          ? `Processed ${processed.length} invoice payment${processed.length === 1 ? '' : 's'} via autopay.`
          : 'No invoice payments were processed.',
        attempted_open_balance: openBalance,
        charged_amount: toMoney(runningTotal),
        processed,
        failures,
      });
    } catch (error) {
      if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
      return res.status(500).json({ error: error.message || 'Could not trigger autopay charge' });
    }
  });

  // POST /api/portal/payments/create-checkout-session
  router.post('/payments/create-checkout-session', authenticatePortalToken, async (req, res) => {
    try {
      const balance = await portalInvoiceBalanceSummary(req.customerEmail, req.portalContext);
      if (balance.openBalance <= 0) {
        return res.status(400).json({ error: 'No open balance to pay', code: 'NO_OPEN_BALANCE' });
      }

      if (!PORTAL_PAYMENT_ENABLED) {
        return res.status(501).json({
          error: 'Online payments are not configured yet. Please use manual payment instructions.',
          code: 'PAYMENT_NOT_CONFIGURED',
          support_email: PORTAL_PAYMENT_SUPPORT_EMAIL,
        });
      }

      if (isStripeProviderEnabled()) {
        const customer = await findOrCreateCustomer({
          email: req.customerEmail,
          name: req.customerName,
          metadata: {
            portal_customer_email: req.customerEmail,
            company_id: req.portalContext.companyId || '',
            location_id: req.portalContext.activeLocationId || '',
          },
        });
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        const session = await createCheckoutSession({
          customerId: customer.id,
          amount: balance.openBalance,
          currency: PORTAL_PAYMENT_CURRENCY,
          successUrl: `${baseUrl}/portal?payment=success`,
          cancelUrl: `${baseUrl}/portal?payment=cancelled`,
          metadata: {
            source: 'portal_checkout',
            customer_email: req.customerEmail,
            company_id: req.portalContext.companyId || '',
            location_id: req.portalContext.activeLocationId || '',
          },
        });

        await recordPortalPaymentEvent(req, {
          event_type: 'checkout_session_created',
          amount: balance.openBalance,
          provider: 'stripe',
          status: 'queued',
          message: `Stripe checkout session ${session.id}`,
        });

        return res.json({
          checkout_url: session.url,
          provider: 'stripe',
          amount_due: balance.openBalance,
          session_id: session.id,
        });
      }

      if (PORTAL_PAYMENT_PROVIDER === 'stub' && PORTAL_PAYMENT_STUB_CHECKOUT_URL) {
        const ref = `portal_${Date.now()}`;
        return res.json({
          checkout_url: `${PORTAL_PAYMENT_STUB_CHECKOUT_URL}${PORTAL_PAYMENT_STUB_CHECKOUT_URL.includes('?') ? '&' : '?'}ref=${encodeURIComponent(ref)}`,
          provider: 'stub',
          amount_due: balance.openBalance,
        });
      }

      return res.status(501).json({
        error: 'Checkout provider not wired yet. Configure your payment provider server-side.',
        code: 'PAYMENT_PROVIDER_NOT_READY',
        support_email: PORTAL_PAYMENT_SUPPORT_EMAIL,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Could not start checkout session' });
    }
  });

  // POST /api/portal/invoices/:id/pay
  router.post('/invoices/:id/pay', authenticatePortalToken, async (req, res) => {
    try {
      if (!isStripeProviderEnabled()) {
        return res.status(501).json({ error: 'Stripe payments are not configured', code: 'STRIPE_NOT_CONFIGURED' });
      }

      const invoiceId = String(req.params.id || '').trim();
      if (!invoiceId) return res.status(400).json({ error: 'Invoice id is required' });

      const { data: invoiceRow, error: invoiceError } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .ilike('customer_email', req.customerEmail)
        .single();
      if (invoiceError || !invoiceRow) return res.status(404).json({ error: 'Invoice not found' });
      if (!filterRowsByContext([invoiceRow], req.portalContext).length) return res.status(404).json({ error: 'Invoice not found' });
      if (!invoiceIsOpen(invoiceRow)) return res.status(400).json({ error: 'Invoice is not open for payment' });

      const amount = toMoney(invoiceRow.total);
      if (amount <= 0) return res.status(400).json({ error: 'Invoice amount must be greater than zero' });

      const paymentState = await loadPortalPaymentState(req);
      const requestedMethodId = String(req.body?.method_id || '').trim();
      const method = paymentState.methods.find((candidate) =>
        candidate.id === (requestedMethodId || paymentState.settings.method_id || '')
        || (!!candidate.is_default && !requestedMethodId && !paymentState.settings.method_id)
      );
      if (!method) {
        return res.status(400).json({ error: 'No default payment method available. Add a payment method first.' });
      }
      if (String(method.provider || '').toLowerCase() !== 'stripe') {
        return res.status(400).json({ error: 'Only Stripe payment methods are supported for this action.' });
      }

      const customer = await findOrCreateCustomer({
        email: req.customerEmail,
        name: req.customerName,
        metadata: {
          portal_customer_email: req.customerEmail,
          company_id: req.portalContext.companyId || '',
          location_id: req.portalContext.activeLocationId || '',
        },
      });

      const intent = await createPaymentIntent({
        amount,
        currency: PORTAL_PAYMENT_CURRENCY,
        customerId: customer.id,
        paymentMethodId: method.payment_method_ref,
        description: `NodeRoute invoice ${invoiceRow.invoice_number || invoiceRow.id}`,
        metadata: {
          source: 'portal_invoice_pay',
          customer_email: req.customerEmail,
          invoice_id: invoiceRow.id,
          company_id: req.portalContext.companyId || '',
          location_id: req.portalContext.activeLocationId || '',
        },
        idempotencyKey: `portal-invoice-pay-${invoiceRow.id}-${Date.now()}`,
      });

      const paymentStatus = String(intent.status || 'queued');
      await recordPortalPaymentEvent(req, {
        event_type: 'invoice_pay',
        amount,
        method_id: method.id,
        method_type: method.method_type,
        provider: 'stripe',
        status: paymentStatus,
        message: `Stripe payment intent ${intent.id}`,
      });

      if (paymentStatus === 'succeeded') {
        await supabase.from('invoices').update({ status: 'paid', sent_at: new Date().toISOString() }).eq('id', invoiceRow.id);
      }

      return res.json({
        message: paymentStatus === 'succeeded'
          ? 'Invoice paid successfully.'
          : `Payment is ${paymentStatus}. We will update the invoice once final settlement is confirmed.`,
        invoice_id: invoiceRow.id,
        payment_intent_id: intent.id,
        status: paymentStatus,
      });
    } catch (error) {
      if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
      return res.status(500).json({ error: error.message || 'Could not charge invoice' });
    }
  });

  return router;
};
