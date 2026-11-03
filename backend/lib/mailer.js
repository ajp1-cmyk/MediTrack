// Delivers the one-time sign-in code.
//
// Two transports, chosen with MAIL_PROVIDER:
//
//   console (default) → prints the code in the server log. No account and no
//                       keys needed: the code appears in the terminal running the
//                       API (or the Netlify function log), which is enough for
//                       local development and for the course demo.
//   resend            → POST https://api.resend.com/emails with RESEND_API_KEY.
//                       Plain `fetch`, so the API keeps its small dependency
//                       footprint; any provider with the same shape can replace
//                       it in a dozen lines.
//
// A delivery failure is turned into a 502: the route then discards the code, so
// nothing usable is left behind when the email never left the building.
const { httpError } = require('./errors');

const PROVIDER = () => String(process.env.MAIL_PROVIDER || 'console').trim().toLowerCase();
const MAIL_FROM = () => process.env.MAIL_FROM || 'MediTrack <no-reply@meditrack.local>';
const RESEND_API_KEY = () => process.env.RESEND_API_KEY || '';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Which transport is active: 'console' or 'resend'. */
function provider() {
  return PROVIDER() === 'resend' ? 'resend' : 'console';
}

/** False when the chosen transport is missing its credentials. */
function configured() {
  return provider() !== 'resend' || Boolean(RESEND_API_KEY());
}

/** Subject + body for the code email (exported so tests can assert on it). */
function message({ code, expiresAt }) {
  const minutes = Math.max(
    1,
    Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000)
  );
  return {
    subject: `Your MediTrack sign-in code: ${code}`,
    text:
      `Your MediTrack sign-in code is ${code}.\n\n` +
      `It can be used once and expires in ${minutes} minute(s).\n` +
      'If you did not try to sign in, you can ignore this email.',
  };
}

async function sendWithConsole({ to, code, expiresAt }) {
  const { text } = message({ code, expiresAt });
  console.log(
    '\n┌─ [mail] one-time sign-in code ─────────────────────────────\n' +
      `│  to     ${to}\n` +
      `│  code   ${code}\n` +
      `│  ${text.split('\n').slice(2).join('\n│  ')}\n` +
      '└───────────────────────────────────────────────────────────'
  );
}

async function sendWithResend({ to, code, expiresAt }) {
  if (!RESEND_API_KEY()) {
    throw httpError(503, 'Email delivery is not configured on this server.');
  }

  const { subject, text } = message({ code, expiresAt });
  let res;

  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: MAIL_FROM(), to: [to], subject, text }),
    });
  } catch (err) {
    console.error(`[mail] could not reach Resend: ${err.message}`);
    throw httpError(502, 'Could not send the sign-in code. Please try again.');
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[mail] Resend answered ${res.status}: ${detail.slice(0, 300)}`);
    throw httpError(502, 'Could not send the sign-in code. Please try again.');
  }
}

/**
 * Send one sign-in code.
 *
 * @param {{ to: string, code: string, expiresAt: Date }} message
 * @returns {Promise<void>}
 */
async function sendOtpEmail(payload) {
  if (provider() === 'resend') return sendWithResend(payload);
  return sendWithConsole(payload);
}

module.exports = { sendOtpEmail, provider, configured, message };
