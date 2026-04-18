const { Resend } = require('resend');

function createMailer() {
  if (!process.env.RESEND_API_KEY) return null;
  const resend = new Resend(process.env.RESEND_API_KEY);

  return {
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

module.exports = { createMailer };
