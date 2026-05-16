const express = require('express');
const { supabase } = require('../services/supabase');
const { buildScopeFields, insertRecordWithOptionalScope, executeWithOptionalScope } = require('../services/operating-context');
const {
  portalMethodTypeForStripeType,
  findOrCreateCustomer,
  createSetupIntent,
  retrievePaymentMethod,
  attachPaymentMethod,
  detachPaymentMethod,
} = require('../services/stripe');
const {
  PORTAL_PAYMENT_PROVIDER,
  STRIPE_PUBLISHABLE_KEY,
  AUTOPAY_METHOD_TYPES,
  isMissingPortalPaymentTables,
  paymentTablesUnavailableResponse,
  normalizePaymentMethodType,
  sanitizePaymentMethod,
  loadPortalPaymentState,
  isStripeProviderEnabled,
  stripePaymentMethodSummary,
} = require('./portal-payment-utils');

module.exports = function buildPaymentMethodsRouter({ authenticatePortalToken }) {
  const router = express.Router();

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

  return router;
};
