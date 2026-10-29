import { randomToken, sha256, throttled, clientIp } from './_lib/auth.js';
import { page, forgotForm } from './_lib/pages.js';
import { sendMail, siteName } from './_lib/mail.js';

const SENT = 'If that email belongs to an admin, a reset link is on its way. It works once, for 30 minutes.';

export const onRequestGet = ({ env, data }) => page('Reset your password', siteName(data.env || env), forgotForm());

export async function onRequestPost({ request, env: rawEnv, data }) {
  const env = data.env || rawEnv;
  const store = data.store;
  const ip = clientIp(request);
  if (await throttled(store, ip)) return page('Reset your password', siteName(env), forgotForm('Too many tries. Wait 15 minutes.'), 429);
  await store.logLogin(ip, false); // counts toward the same limit, so this can't be used to spam inboxes

  const email = String((await request.formData()).get('email') || '').trim();
  const admin = email && (await store.adminByEmail(email));
  if (admin && !admin.disabled) {
    const token = randomToken();
    await store.saveResetToken(await sha256(token), admin.id, Date.now() + 30 * 60000);
    const link = new URL(`/admin/reset?t=${token}`, request.url).toString();
    const sent = await sendMail(env, {
      to: admin.email,
      subject: `Reset your ${siteName(env)} admin password`,
      text: `Someone asked to reset the ${siteName(env)} admin password for ${admin.email}.\n\nSet a new one here (works once, for 30 minutes):\n${link}\n\nIf it wasn't you, ignore this email.`,
    });
    await store.audit(admin, 'reset_requested', admin.email, { ip, emailed: sent });
  }
  return page('Reset your password', siteName(env), forgotForm(SENT, 'ok'));
}
