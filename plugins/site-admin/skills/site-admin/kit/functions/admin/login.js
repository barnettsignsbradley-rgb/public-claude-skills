import { verifyPassword, makeCookie, throttled, clientIp } from './_lib/auth.js';
import { page, loginForm } from './_lib/pages.js';
import { siteName } from './_lib/mail.js';

export const onRequestGet = ({ env, data }) => page('Sign in', siteName(data.env || env), loginForm());

export async function onRequestPost({ request, env: rawEnv, data }) {
  const env = data.env || rawEnv;
  const store = data.store;
  const ip = clientIp(request);
  const form = await request.formData();
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');

  if (await throttled(store, ip)) {
    return page('Sign in', siteName(env), loginForm('Too many tries. Wait 15 minutes and try again.', email), 429);
  }
  const admin = email && (await store.adminByEmail(email));
  const ok = !!admin && !admin.disabled && (await verifyPassword(password, admin.password_hash));
  await store.logLogin(ip, ok);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 600));
    return page('Sign in', siteName(env), loginForm('That email and password don’t match.', email), 401);
  }

  await store.updateAdmin(admin.id, { last_login_at: new Date().toISOString() });
  await store.audit(admin, 'sign_in', null, { ip });
  return new Response(null, { status: 303, headers: { Location: '/admin/', 'Set-Cookie': await makeCookie(env, admin) } });
}
