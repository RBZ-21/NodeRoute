const express = require('express');
const { supabase } = require('../services/supabase');
const { buildScopeFields, filterRowsByContext, insertRecordWithOptionalScope, executeWithOptionalScope } = require('../services/operating-context');
const { findOrCreateCustomer, createPaymentIntent } = require('../services/stripe');
const {
  PORTAL_PAYMENT_CURRENCY,
  AUTOPAY_METHOD_TYPES,
  isMissingPortalPaymentTables,
  paymentTablesUnavailableResponse,
  loadPortalPaymentState,
  isStripeProviderEnabled,
  listScopedCustomerInvoices,
  invoiceIsOpen,
  toMoney,
  recordPortalPaymentEvent,
} = require('./portal-payment-utils');

module.exports = function buildAutopayRouter({ authenticatePortalToken }) {
  const router = express.Router();

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

  return router;
};
