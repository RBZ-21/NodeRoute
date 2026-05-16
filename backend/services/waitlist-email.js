const { createMailer } = require('./email');

/**
 * Send a confirmation email to someone who just joined the waitlist.
 * @param {{ email: string, name?: string }} entry
 */
async function sendWaitlistConfirmationEmail({ email, name }) {
  const mailer = createMailer();
  if (!mailer) {
    console.warn('[waitlist-email] Email not configured — skipping confirmation email');
    return { sent: false, error: 'Email not configured on server' };
  }

  const greeting = name ? `Hi ${name},` : 'Hi there,';

  try {
    await mailer.sendMail({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "You're on the NodeRoute waitlist",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;color:#111">
          <h2 style="color:#00b894">NodeRoute</h2>
          <p>${greeting}</p>
          <p>Thanks for your interest in NodeRoute. You're on the list.</p>
          <p>I'm working with a small number of early teams right now, and I'll be in touch
          personally when there's a spot available.</p>
          <p>In the meantime, feel free to reply to this email if you have questions or
          want to tell me more about your delivery setup.</p>
          <p style="margin-top:32px">— Ryan<br>
          <span style="color:#888;font-size:13px">NodeRoute Systems</span></p>
          <p style="margin-top:24px;font-size:12px;color:#aaa">
            You received this because you signed up at noderoutesystems.com.
          </p>
        </div>
      `,
    });
    return { sent: true };
  } catch (err) {
    console.error('[waitlist-email] Failed to send confirmation:', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { sendWaitlistConfirmationEmail };
