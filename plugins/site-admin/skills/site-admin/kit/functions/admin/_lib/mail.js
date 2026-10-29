/**
 * Admin emails (reset links, new-admin passwords) through Resend.
 * Needs RESEND_API_KEY and ADMIN_FROM ("Site Admin <admin@domain>") on a
 * domain verified in Resend. Returns false when it can't send, and callers
 * then show the owner what to pass on by hand.
 */
export async function sendMail(env, msg) {
  return (await trySend(env, msg)).ok;
}

/* The same, with the reason when it fails: what Setup's "Send me a test" shows. */
export async function trySend(env, { to, subject, text }) {
  const from = env.ADMIN_FROM || env.CONTACT_FROM;   // CONTACT_FROM: what older sites already set
  if (!env.RESEND_API_KEY) return { ok: false, error: 'No RESEND_API_KEY on this deployment (a key added in the dashboard needs a redeploy, and Preview has its own list).' };
  if (!from) return { ok: false, error: 'No from address yet.' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => ({}));
  return { ok: false, error: `Resend said: ${body.message || 'HTTP ' + res.status}` };
}

import { siteLabel } from './modules.js';

export const siteName = (env) => env.ADMIN_SITE_NAME || siteLabel;
