/**
 * /admin/api/*: one router. The middleware has already checked the session,
 * so ctx.data.admin is the signed-in admin and ctx.data.store the store.
 *
 * A route is [method, pattern, handler, role]. Patterns take :params.
 * role 'owner' means staff get 403. Site modules add their routes in
 * ../_lib/modules.js; this file holds the parts every site has.
 */
import { hashPassword, verifyPassword, passwordProblem, tempPassword, makeCookie, clearCookie } from '../_lib/auth.js';
import { json, fail, readJson, csv, normalizeEmail } from '../_lib/http.js';
import { sendMail, siteName } from '../_lib/mail.js';
import { moduleRoutes, moduleNav, moduleSettings, moduleOverview, moduleFallback, integrations as siteIntegrations } from '../_lib/modules.js';
import { INTEGRATIONS, storableNames } from '../_lib/integrations.js';
import { dashboardKeys, siteLogo, withoutCore } from '../_lib/modules.js';
import { encrypt, hint } from '../_lib/secrets.js';

// ADMIN_INTEGRATIONS (comma list) overrides modules.js, for previews and tests.
let integrations = siteIntegrations;

const core = [
  ['GET', 'me', async ({ admin, env }) => json({ admin, site: siteName(env), logo: siteLogo, nav: moduleNav(env), without: withoutCore, emailReady: !!(env.RESEND_API_KEY && (env.ADMIN_FROM || env.CONTACT_FROM)) })],

  ['POST', 'logout', async () => json({ ok: true }, 200, { 'Set-Cookie': clearCookie() })],

  ['POST', 'password', async ({ admin, store, env, body }) => {
    const row = await store.adminById(admin.id);
    if (!row.must_change && !(await verifyPassword(body.current, row.password_hash))) return fail(400, 'Your current password is wrong.');
    const problem = passwordProblem(body.next);
    if (problem) return fail(400, problem);
    const password_hash = await hashPassword(body.next);
    await store.updateAdmin(admin.id, { password_hash, must_change: 0 });
    await store.audit(admin, 'password_changed', admin.email);
    // The old cookie dies with the old hash; hand back a fresh one.
    return json({ ok: true }, 200, { 'Set-Cookie': await makeCookie(env, { ...row, password_hash }) });
  }],

  // ---------- Admins (owner only) ----------
  ['GET', 'admins', async ({ store }) => json({ admins: await store.listAdmins() }), 'owner'],

  ['POST', 'admins', async ({ admin, store, env, body, request }) => {
    const email = normalizeEmail(body.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'Enter an email address.');
    if (await store.adminByEmail(email)) return fail(409, 'That email is already an admin.');
    const role = body.role === 'owner' ? 'owner' : 'staff';
    const temp = tempPassword();
    await store.createAdmin({ email, name: String(body.name || '').slice(0, 80), role, password_hash: await hashPassword(temp), must_change: true });
    const emailed = await sendMail(env, {
      to: email,
      subject: `You're an admin on ${siteName(env)}`,
      text: `${admin.name || admin.email} added you as ${role === 'owner' ? 'an owner' : 'staff'} on the ${siteName(env)} admin.\n\nSign in: ${new URL('/admin/login', request.url)}\nEmail: ${email}\nTemporary password: ${temp}\n\nYou'll choose your own password when you sign in.`,
    });
    await store.audit(admin, 'admin_added', email, { role, emailed });
    return json({ ok: true, emailed, temp: emailed ? undefined : temp });
  }, 'owner'],

  ['POST', 'admins/:id', async ({ admin, store, body, params }) => {
    const target = await store.adminById(params.id);
    if (!target) return fail(404, 'No such admin.');
    const fields = {};
    if (body.name !== undefined) fields.name = String(body.name).slice(0, 80);
    if (body.role) fields.role = body.role === 'owner' ? 'owner' : 'staff';
    if (body.disabled !== undefined) fields.disabled = body.disabled ? 1 : 0;
    const losingOwner = target.role === 'owner' && !target.disabled && (fields.role === 'staff' || fields.disabled === 1);
    if (losingOwner && (await store.countOwners()) <= 1) return fail(400, 'Keep at least one active owner.');
    if (String(target.id) === String(admin.id) && fields.disabled === 1) return fail(400, 'You can’t disable yourself.');
    await store.updateAdmin(target.id, fields);
    await store.audit(admin, 'admin_changed', target.email, fields);
    return json({ ok: true });
  }, 'owner'],

  ['POST', 'admins/:id/reset', async ({ admin, store, env, params, request }) => {
    const target = await store.adminById(params.id);
    if (!target) return fail(404, 'No such admin.');
    const temp = tempPassword();
    await store.updateAdmin(target.id, { password_hash: await hashPassword(temp), must_change: 1 });
    const emailed = await sendMail(env, {
      to: target.email,
      subject: `Your ${siteName(env)} admin password was reset`,
      text: `${admin.name || admin.email} reset your admin password.\n\nSign in: ${new URL('/admin/login', request.url)}\nTemporary password: ${temp}\n\nYou'll choose a new one when you sign in.`,
    });
    await store.audit(admin, 'admin_password_reset', target.email, { emailed });
    return json({ ok: true, emailed, temp: emailed ? undefined : temp });
  }, 'owner'],

  ['GET', 'audit', async ({ store }) => json({ rows: await store.listAudit(300) }), 'owner'],

  // ---------- Settings ----------
  ['GET', 'settings', async ({ store, env }) => json({ settings: await store.getSettings(), fallbackRecipients: env.CONTACT_TO || '' })],
  ['POST', 'settings', async ({ admin, store, body }) => {
    const allowed = ['form_recipients', ...moduleSettings];
    if (!allowed.includes(body.key)) return fail(400, 'Unknown setting.');
    await store.setSetting(body.key, body.value, admin.email);
    await store.audit(admin, 'setting_changed', body.key, body.value);
    return json({ ok: true });
  }, 'owner'],

  // ---------- Inbox ----------
  ['GET', 'inbox', async ({ store, url }) => {
    const status = url.searchParams.get('status') || 'open';
    const rows = await store.inboxList(status);
    if (url.searchParams.get('format') === 'csv') {
      return csv(rows, ['created_at', 'form', 'name', 'email', 'message', 'status', 'responded_by', 'responded_at', 'note'].map((k) => ({ key: k, label: k })), 'inbox.csv');
    }
    return json({ rows, counts: await store.inboxCounts() });
  }],
  ['POST', 'inbox/:id', async ({ admin, store, body, params }) => {
    const status = ['new', 'responded', 'archived', 'spam'].includes(body.status) ? body.status : null;
    const fields = {};
    if (status) Object.assign(fields, { status, responded_by: status === 'responded' ? admin.name || admin.email : null, responded_at: status === 'responded' ? new Date().toISOString() : null });
    if (body.note !== undefined) fields.note = String(body.note).slice(0, 2000);
    await store.inboxUpdate(params.id, fields);
    await store.audit(admin, 'inbox_update', 'form_submission:' + params.id, { status, note: body.note !== undefined });
    return json({ ok: true });
  }],

  // ---------- Analytics ----------
  ['GET', 'analytics', async ({ store, url }) => {
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 365);
    const a = await store.analytics(Date.now() - days * 86400000);
    return json({ days, ...a, conversion: a.visitors ? a.forms / a.visitors : 0 });
  }],

  // ---------- Setup ----------
  ['GET', 'setup', async ({ env, store, url }) => {
    const saved = Object.fromEntries((await store.listSecrets()).map((r) => [r.name, r]));
    const ctx = { store, origin: url.origin };
    const cards = await Promise.all(integrations.map(async (id) => {
      const it = INTEGRATIONS[id];
      let result;
      try { result = await it.check(env, ctx); } catch (err) { result = { status: 'problem', detail: 'Couldn’t reach the service: ' + err.message }; }
      return {
        id, label: it.label, optional: !!it.optional, what: it.what, needs: it.needs, steps: it.steps, ...result,
        fields: it.fields.map((f) => ({
          name: f.name, label: f.label, secret: !!f.secret, toggle: !!f.toggle, placeholder: f.placeholder || '', auto: !!f.auto, dashboardOnly: !!f.dashboardOnly || dashboardKeys.includes(f.name),
          source: env.__stored?.[f.name] ? 'admin' : env[f.name] ? 'dashboard' : null,
          hint: env.__stored?.[f.name] ? saved[f.name].hint : env[f.name] ? (f.secret ? 'set' : env[f.name]) : '',
          updated: saved[f.name] ? { at: saved[f.name].updated_at, by: saved[f.name].updated_by } : null,
        })),
        actions: Object.entries(it.actions || {}).map(([name, a]) => ({ name, label: a.label, confirm: a.confirm || '' })),
      };
    }));
    return json({ cards, broken: env.__broken || [] });
  }, 'owner'],

  ['POST', 'setup/:id/save', async ({ admin, env, store, body, params }) => {
    if (!integrations.includes(params.id)) return fail(404, 'Unknown service.');
    const allowed = storableNames([params.id]);
    const changed = [];
    for (const [name, raw] of Object.entries(body.values || {})) {
      if (!allowed.includes(name)) return fail(400, `${name} can’t be set here.`);
      if (env[name] && !env.__stored?.[name]) return fail(400, `${name} is set in the hosting dashboard; change it there.`);
      const value = String(raw ?? '').trim();
      const field = INTEGRATIONS[params.id].fields.find((f) => f.name === name);
      if (!value) { if (body.clear) { await store.deleteSecret(name); changed.push(name + ' (removed)'); } continue; }
      if (value.length > 500) return fail(400, `${field.label} looks too long.`);
      await store.putSecret(name, await encrypt(env, value), hint(value, field.secret), admin.email);
      changed.push(name);
    }
    await store.audit(admin, 'setup_saved', params.id, { changed });
    return json({ ok: true, changed });
  }, 'owner'],

  ['POST', 'setup/:id/action/:name', async ({ admin, env, store, params, url }) => {
    const action = INTEGRATIONS[params.id]?.actions?.[params.name];
    if (!integrations.includes(params.id) || !action) return fail(404, 'Unknown action.');
    const result = await action.run(env, { admin, store, origin: url.origin });
    for (const [name, value] of Object.entries(result.save || {})) {
      const field = INTEGRATIONS[params.id].fields.find((f) => f.name === name);
      await store.putSecret(name, await encrypt(env, value), hint(value, field?.secret ?? true), admin.email);
    }
    await store.audit(admin, 'setup_action', `${params.id}:${params.name}`, { ok: result.ok, message: result.message, saved: Object.keys(result.save || {}) });
    return json({ ok: result.ok, message: result.message }, result.ok ? 200 : 400);
  }, 'owner'],

  // ---------- Overview ----------
  ['GET', 'overview', async ({ store, env, ...rest }) => {
    const weekAgo = Date.now() - 7 * 86400000;
    const { visitors7, openMessages, latest } = await store.overview(weekAgo);
    // Cheap check (no calls out): services this site uses whose first key is missing.
    const setupMissing = integrations.filter((id) => {
      if (INTEGRATIONS[id].optional) return false;
      const first = INTEGRATIONS[id].fields.find((f) => !f.auto);
      return first && !env[first.name];
    }).map((id) => INTEGRATIONS[id].label);
    let extra = [];
    try { extra = await moduleOverview({ store, env, ...rest }); } catch (err) { console.error('moduleOverview', err); }
    return json({ visitors7, openMessages, latest, setupMissing, extra });
  }],
];

const routes = [...core, ...moduleRoutes];

function match(method, path) {
  const parts = path.split('/').filter(Boolean);
  for (const [m, pattern, handler, role] of routes) {
    if (m !== method) continue;
    const want = pattern.split('/');
    if (want.length !== parts.length) continue;
    const params = {};
    if (want.every((w, i) => (w.startsWith(':') ? ((params[w.slice(1)] = decodeURIComponent(parts[i])), true) : w === parts[i]))) return { handler, role, params };
  }
  return null;
}

export async function onRequest(ctx) {
  const { request, env, data, params: p } = ctx;
  integrations = env.ADMIN_INTEGRATIONS ? env.ADMIN_INTEGRATIONS.split(',') : siteIntegrations;
  const url = new URL(request.url);
  const path = [].concat(p.path || []).join('/');
  const hit = match(request.method, path);
  if (!hit) {
    if (!moduleFallback) return fail(404, 'Not found');
    if (request.method !== 'GET' && request.headers.get('X-Admin') !== '1') return fail(403, 'Missing X-Admin header');
    try {
      const res = await moduleFallback({ request, env: data.env || env, url, path, admin: data.admin, store: data.store, ctx });
      if (!res) return fail(404, 'Not found');
      if (request.method !== 'GET') await data.store.audit(data.admin, request.method.toLowerCase() + ' ' + path, null, { status: res.status });
      return res;
    } catch (err) {
      console.error('admin api (fallback)', path, err);
      return fail(500, 'Something went wrong. It’s in the logs.');
    }
  }
  if (hit.role === 'owner' && data.admin.role !== 'owner') return fail(403, 'Owners only');
  if (request.method !== 'GET' && request.headers.get('X-Admin') !== '1') return fail(403, 'Missing X-Admin header'); // blocks cross-site form posts
  const body = request.method === 'GET' ? {} : await readJson(request);
  try {
    return await hit.handler({ request, env: data.env || env, url, body, params: hit.params, admin: data.admin, store: data.store, ctx });
  } catch (err) {
    console.error('admin api', path, err);
    return fail(500, 'Something went wrong. It’s in the logs.');
  }
}
