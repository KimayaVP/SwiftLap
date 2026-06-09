// Transactional email via SMTP — provider-agnostic (Resend / SendGrid / Mailgun /
// SES all expose SMTP). Best-effort and self-gating: if SMTP_* env isn't set it
// silently no-ops, so sign-up never breaks when email isn't configured yet.
//
// Required env to go live (set on Render):
//   SMTP_HOST   e.g. smtp.resend.com
//   SMTP_PORT   587 (STARTTLS) or 465 (implicit TLS)
//   SMTP_USER   provider username (Resend: "resend")
//   SMTP_PASS   provider API key / SMTP password   ← secret
//   MAIL_FROM   e.g. "SwiftLap <hello@swiftlap.in>"   (defaults below)
//   APP_URL     e.g. https://swiftlap.in              (link target in the email)
const nodemailer = require('nodemailer');

const FROM = process.env.MAIL_FROM || 'SwiftLap <contact@swiftlap.in>';
const APP_URL = process.env.APP_URL || 'https://swiftlap.in';

let transporter = null;
let resolved = false;
function getTransport() {
  if (resolved) return transporter;
  resolved = true;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return (transporter = null);
  const port = parseInt(SMTP_PORT || '587', 10);
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,            // 465 = implicit TLS; 587 = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

function isConfigured() { return !!getTransport(); }

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Branded "Deep Ocean" welcome email. Never throws.
async function sendWelcomeEmail(to, name) {
  const t = getTransport();
  if (!t || !to) return false;
  const first = escapeHtml((name || '').split(' ')[0] || 'there');
  const subject = 'Welcome to SwiftLap 🏊';
  const text =
`Hi ${(name || '').split(' ')[0] || 'there'},

Welcome to SwiftLap! Your account is ready.

Track your times, set goals, follow your training, and climb the leaderboard.

Open SwiftLap: ${APP_URL}

See you in the pool,
The SwiftLap team`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0E1A26;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px;color:#ffffff;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:.5px;">🌊 SwiftLap</div>
    </div>
    <div style="background:#0A2540;border-radius:16px;padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#ffffff;">Welcome, ${first}! 🏊</h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#cbd5e1;">
        Your SwiftLap account is ready. Track your times, set goals, follow your training plan, and climb the leaderboard.
      </p>
      <div style="text-align:center;margin:24px 0 8px;">
        <a href="${escapeHtml(APP_URL)}" style="display:inline-block;background:linear-gradient(135deg,#0AB6BC,#1FD1B8);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:14px;">Open SwiftLap</a>
      </div>
    </div>
    <p style="text-align:center;margin:20px 0 0;font-size:12px;color:#64748b;">See you in the pool — the SwiftLap team</p>
  </div>
</body></html>`;

  try {
    await t.sendMail({ from: FROM, to, subject, text, html });
    return true;
  } catch (e) {
    // Welcome email is non-critical — never let it break sign-up.
    return false;
  }
}

module.exports = { sendWelcomeEmail, isConfigured };
