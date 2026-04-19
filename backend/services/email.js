const nodemailer = require('nodemailer');
const { Resend } = require('resend');

function createSmtpMailer() {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM) return null;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: String(SMTP_SECURE).toLowerCase() === 'true',
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

      const { data, error } = await resend.emails.send(payload);
      if (error) throw new Error(error.message);
      return data;
    },
  };
}

function createMailer() {
  return createResendMailer() || createSmtpMailer();
}

function createConfiguredMailers() {
  const mailers = [];
  const smtpMailer = createSmtpMailer();
  const resendMailer = createResendMailer();

  if (smtpMailer) mailers.push(smtpMailer);
  if (resendMailer) mailers.push(resendMailer);

  return mailers;
}

module.exports = { createMailer, createConfiguredMailers };
