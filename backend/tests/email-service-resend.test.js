const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const emailServicePath = path.resolve(__dirname, '..', 'services', 'email.js');

function loadEmailServiceWithResendMock(send) {
  delete require.cache[emailServicePath];
  const originalLoad = Module._load;

  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === 'resend') {
      return {
        Resend: class ResendMock {
          constructor(apiKey) {
            this.apiKey = apiKey;
            this.emails = { send };
          }
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(emailServicePath);
  } finally {
    Module._load = originalLoad;
  }
}

test('Resend mailer forwards idempotency keys to SDK send options', async () => {
  const originalEnv = { ...process.env };
  const calls = [];

  try {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.EMAIL_FROM = 'NodeRoute <no-reply@example.com>';
    process.env.EMAIL_SEND_TIMEOUT_MS = '0';
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    const { createConfiguredMailers } = loadEmailServiceWithResendMock((payload, options) => {
      calls.push({ payload, options });
      return Promise.resolve({ data: { id: 'email_123' }, error: null });
    });

    const [mailer] = createConfiguredMailers();
    await mailer.sendMail({
      to: 'delivered@resend.dev',
      subject: 'Invite',
      html: '<p>Welcome</p>',
      idempotencyKey: 'user-invite/user-123',
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].options, { idempotencyKey: 'user-invite/user-123' });
    assert.deepEqual(calls[0].payload.to, ['delivered@resend.dev']);
  } finally {
    process.env = originalEnv;
    delete require.cache[emailServicePath];
  }
});
