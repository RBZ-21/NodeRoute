const nodemailer = require('nodemailer');
const { Resend } = require('resend');

function withTimeout(promise, timeoutMs, provider) {
  if (!timeoutMs || timeoutMs <= 0) return promise;

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${provider || 'email provider'} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeoutPromise,
  ]);
}

function getConfiguredMailers() {
  const preferredProvider = String(process.env.EMAIL_PROVIDER || 'auto').toLowerCase();
  const smtpMailer = createSmtpMailer();
  const resendMailer = createResendMailer();
  const ordered = [];

  const pushMailer = (mailer) => {
    if (mailer) ordered.push(mailer);
  };

  if (preferredProvider === 'smtp') {
    pushMailer(smtpMailer);
    pushMailer(resendMailer);
    return ordered;
  }

  if (preferredProvider === 'resend') {
    pushMailer(resendMailer);
    pushMailer(smtpMailer);
    return ordered;
  }

  pushMailer(resendMailer);
  pushMailer(smtpMailer);
  return ordered;
}

function createSmtpMailer() {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM) return null;
  const timeoutMs = Number(process.env.EMAIL_SEND_TIMEOUT_MS || 5000);

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: String(SMTP_SECURE).toLowerCase() === 'true',
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  return {
    provider: 'smtp',
    sendMail: async ({ from, to, subject, html, text, attachments }) => transporter.sendMail({
      from: from || EMAIL_FROM,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html,
      text,
      attachments,
    }),
  };
}

function createResendMailer() {
  if (!process.env.RESEND_API_KEY) return null;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const timeoutMs = Number(process.env.EMAIL_SEND_TIMEOUT_MS || 5000);

  return {
    provider: 'resend',
    sendMail: async ({ from, to, subject, html, text, attachments }) => {
      const payload = {
        from: from || process.env.EMAIL_FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        ...(html ? { html } : { text }),
      };

      if (attachments?.length) {
        payload.attachments = attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
        }));
      }

      const { data, error } = await withTimeout(resend.emails.send(payload), timeoutMs, 'resend');
      if (error) throw new Error(error.message);
      return data;
    },
  };
}

function createMailer() {
  const mailers = getConfiguredMailers();
  if (!mailers.length) return null;

  const [primaryMailer, ...fallbackMailers] = mailers;
  if (!fallbackMailers.length) return primaryMailer;

  return {
    provider: primaryMailer.provider || 'unknown',
    sendMail: async (options) => {
      let lastError = null;
      for (const mailer of mailers) {
        try {
          return await mailer.sendMail(options);
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError || new Error('Email delivery failed');
    },
  };
}

function createConfiguredMailers() {
  return getConfiguredMailers();
}

module.exports = { createMailer, createConfiguredMailers };
