import { hashPassword, passwordProblem, sha256, makeCookie } from './_lib/auth.js';
import { page, resetForm } from './_lib/pages.js';
import { siteName } from './_lib/mail.js';

export function onRequestGet({ request, env: rawEnv, data }) {
  const env = data.env || rawEnv;
  const t = new URL(request.url).searchParams.get('t') || '';
  return page('Choose a new password', siteName(env), resetForm(t));
}

export async function onRequestPost({ request, env: rawEnv, data }) {
  const env = data.env || rawEnv;
  const store = data.store;
  const form = await request.formData();
  const t = String(form.get('t') || '');
  const password = String(form.get('password') || '');
  const problem = passwordProblem(password);
  if (problem) return page('Choose a new password', siteName(env), resetForm(t, problem), 400);

  const row = t && (await store.takeResetToken(await sha256(t)));
  if (!row) return page('Choose a new password', siteName(env), '<p class="auth-note error">That link has expired or was already used. <a href="/admin/forgot">Ask for a new one.</a></p>', 400);

  const password_hash = await hashPassword(password);
  await store.updateAdmin(row.admin_id, { password_hash, must_change: 0 });
  const admin = await store.adminById(row.admin_id);
  await store.audit(admin, 'password_reset', admin.email);
  return new Response(null, { status: 303, headers: { Location: '/admin/', 'Set-Cookie': await makeCookie(env, admin) } });
}
