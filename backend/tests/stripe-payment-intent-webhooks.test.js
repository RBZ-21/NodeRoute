const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}stripe.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}stripe-webhooks.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function installStripeVerifierStub(event) {
  const stripePath = require.resolve('../services/stripe');
  require.cache[stripePath] = {
    id: stripePath,
    filename: stripePath,
    loaded: true,
    exports: {
      verifyWebhookSignature() {
        return event;
      },
    },
  };
}

function invokeWebhookWithRequest(stripeWebhookHandler, request) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        resolve({ statusCode: this.statusCode, body: payload });
      },
    };
    stripeWebhookHandler(request, res);
  });
}

function invokeWebhook(stripeWebhookHandler) {
  return invokeWebhookWithRequest(stripeWebhookHandler, {
    body: Buffer.from('{}'),
    headers: { 'stripe-signature': 't=1,v1=test' },
  });
}

async function withWebhookHarness(event, run) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-stripe-pi-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();
  installStripeVerifierStub(event);

  try {
    const { supabase } = require('../services/supabase');
    const { stripeWebhookHandler } = require('../routes/stripe-webhooks');
    await run({ supabase, stripeWebhookHandler });
  } finally {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

test('payment_intent.succeeded marks the scoped invoice paid and is replay-safe', async () => {
  const event = {
    id: 'evt-pi-success',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi-success-1',
        amount_received: 4250,
        metadata: {
          invoice_id: 'inv-pi-success',
          company_id: 'company-stripe-a',
          location_id: 'loc-stripe-a',
        },
      },
    },
  };

  await withWebhookHarness(event, async ({ supabase, stripeWebhookHandler }) => {
    await supabase.from('invoices').insert({
      id: 'inv-pi-success',
      invoice_number: 'INV-PI-100',
      total: 42.5,
      status: 'sent',
      company_id: 'company-stripe-a',
      location_id: 'loc-stripe-a',
    });

    const first = await invokeWebhook(stripeWebhookHandler);
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.body, { received: true });

    const { data: invoice } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', 'inv-pi-success')
      .single();
    assert.equal(invoice.status, 'paid');
    assert.equal(invoice.payment_status, 'paid');
    assert.equal(invoice.stripe_payment_intent_id, 'pi-success-1');
    assert.ok(invoice.paid_at);

    const replay = await invokeWebhook(stripeWebhookHandler);
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.body, { received: true, replay: true });
  });
});

test('payment_intent.payment_failed records failed payment state without marking invoice paid', async () => {
  const event = {
    id: 'evt-pi-failed',
    type: 'payment_intent.payment_failed',
    data: {
      object: {
        id: 'pi-failed-1',
        amount: 4250,
        metadata: {
          invoice_id: 'inv-pi-failed',
          company_id: 'company-stripe-a',
          location_id: 'loc-stripe-a',
        },
        last_payment_error: { message: 'Bank account could not be debited' },
      },
    },
  };

  await withWebhookHarness(event, async ({ supabase, stripeWebhookHandler }) => {
    await supabase.from('invoices').insert({
      id: 'inv-pi-failed',
      invoice_number: 'INV-PI-101',
      total: 42.5,
      status: 'sent',
      company_id: 'company-stripe-a',
      location_id: 'loc-stripe-a',
    });

    const response = await invokeWebhook(stripeWebhookHandler);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { received: true });

    const { data: invoice } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', 'inv-pi-failed')
      .single();
    assert.equal(invoice.status, 'sent');
    assert.equal(invoice.payment_status, 'failed');
    assert.equal(invoice.payment_failure_reason, 'Bank account could not be debited');
    assert.equal(invoice.stripe_payment_intent_id, 'pi-failed-1');
    assert.ok(invoice.payment_failed_at);
  });
});

test('payment_intent.succeeded does not cross company scope from metadata', async () => {
  const event = {
    id: 'evt-pi-tenant-mismatch',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi-wrong-tenant',
        amount_received: 4250,
        metadata: {
          invoice_id: 'inv-pi-tenant-mismatch',
          company_id: 'company-stripe-b',
          location_id: 'loc-stripe-a',
        },
      },
    },
  };

  await withWebhookHarness(event, async ({ supabase, stripeWebhookHandler }) => {
    await supabase.from('invoices').insert({
      id: 'inv-pi-tenant-mismatch',
      invoice_number: 'INV-PI-102',
      total: 42.5,
      status: 'sent',
      company_id: 'company-stripe-a',
      location_id: 'loc-stripe-a',
    });

    const response = await invokeWebhook(stripeWebhookHandler);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { received: true });

    const { data: invoice } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', 'inv-pi-tenant-mismatch')
      .single();
    assert.equal(invoice.status, 'sent');
    assert.equal(invoice.payment_status, undefined);
    assert.equal(invoice.stripe_payment_intent_id, undefined);
  });
});

test('forged Stripe webhook payload is rejected without recording event or mutating invoices', async () => {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const previousWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const previousStripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-stripe-forged-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake_for_signature_verifier';
  clearBackendModuleCache();

  try {
    const { supabase } = require('../services/supabase');
    const { stripeWebhookHandler } = require('../routes/stripe-webhooks');

    await supabase.from('invoices').insert({
      id: 'inv-forged-webhook',
      invoice_number: 'INV-FORGED-100',
      total: 42.5,
      status: 'sent',
      company_id: 'company-stripe-a',
      location_id: 'loc-stripe-a',
    });

    const forgedEvent = Buffer.from(JSON.stringify({
      id: 'evt-forged-payment',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi-forged',
          amount_received: 4250,
          metadata: {
            invoice_id: 'inv-forged-webhook',
            company_id: 'company-stripe-a',
            location_id: 'loc-stripe-a',
          },
        },
      },
    }));
    const timestamp = Math.floor(Date.now() / 1000);

    const response = await invokeWebhookWithRequest(stripeWebhookHandler, {
      body: forgedEvent,
      headers: { 'stripe-signature': `t=${timestamp},v1=not-a-real-signature` },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /signature/i);

    const { data: invoice } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', 'inv-forged-webhook')
      .single();
    assert.equal(invoice.status, 'sent');
    assert.equal(invoice.payment_status, undefined);
    assert.equal(invoice.stripe_payment_intent_id, undefined);

    const { data: events } = await supabase
      .from('stripe_webhook_events')
      .select('*')
      .eq('event_id', 'evt-forged-payment');
    assert.deepEqual(events, []);
  } finally {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    if (previousWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousWebhookSecret;
    if (previousStripeSecretKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousStripeSecretKey;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
