/**
 * A stand-in for Cloudflare Pages so the kit runs on plain Node 22.5+:
 * D1 on node:sqlite with the real migrations, and the real handlers called
 * the way Pages calls them. Used by run.mjs (checks) and serve.mjs (preview).
 *
 * A site whose modules.js says adminStore.kind = 'supabase' (or any run with
 * ADMIN_TEST_STORE=supabase) gets Postgres instead: PGlite running the real
 * postgres/admin.sql, with Supabase's /rest/v1/rpc/<prefix>admin answered
 * from it. PGlite: `npm i -g @electric-sql/pglite`. A site's checks answer
 * its own PostgREST calls by setting `supabaseRest` (see below).
 *
 * q.get / q.all / q.run run SQL against whichever store is in use (write it
 * with ? placeholders and unprefixed table names; both are adjusted for
 * Postgres). `store` is the store the functions themselves open.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { existsSync } from 'node:fs';
/* The kit's own folder (migrations/, scripts/, test/) can sit anywhere in the
   site, e.g. tools/admin/ on a site whose repo root is served. The site root
   is the nearest folder above it that has functions/admin/. */
const kitDir = join(dirname(fileURLToPath(import.meta.url)), '..');
let root = kitDir;
while (!existsSync(join(root, 'functions', 'admin', '_middleware.js'))) {
  const up = dirname(root);
  if (up === root) throw new Error('functions/admin/_middleware.js not found above ' + kitDir);
  root = up;
}
const imp = (p) => import(new URL('file:///' + join(root, p).replace(/\\/g, '/')).href);

const siteModules = await imp('functions/admin/_lib/modules.js');
const storeCfg = siteModules.adminStore || { kind: 'd1' };
export const kind = process.env.ADMIN_TEST_STORE || storeCfg.kind || 'd1';
const prefix = kind === 'supabase' ? storeCfg.prefix || '' : '';
export { root, kitDir };

// ---------- D1 stand-in ----------
export const sqlite = new DatabaseSync(process.env.ADMIN_TEST_DB || ':memory:');
if (existsSync(join(kitDir, 'migrations'))) {
  for (const f of readdirSync(join(kitDir, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(join(kitDir, 'migrations', f), 'utf8'));
}

// ---------- Supabase stand-in (PGlite) ----------
async function loadPGlite() {
  try { return await import('@electric-sql/pglite'); } catch {}
  const { execSync } = await import('node:child_process');
  const globalRoot = execSync('npm root -g').toString().trim();
  const entry = join(globalRoot, '@electric-sql', 'pglite', 'dist', 'index.js');
  if (!existsSync(entry)) throw new Error('This site keeps its admin in Supabase: its checks need PGlite. Run: npm i -g @electric-sql/pglite');
  return import(new URL('file:///' + entry.replace(/\\/g, '/')).href);
}
export let pg = null;
const SUPABASE_URL = 'https://supabase.test';
if (kind === 'supabase') {
  const { PGlite } = await loadPGlite();
  pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role;");
  await pg.exec(readFileSync(join(kitDir, 'postgres', 'admin.sql'), 'utf8').replaceAll('{{p}}', prefix));
}
/* A site's checks answer its own PostgREST reads here: (url, opts) => Response or null. */
export let supabaseRest = null;
export const setSupabaseRest = (fn) => { supabaseRest = fn; };
const realFetch = globalThis.fetch;
if (kind === 'supabase') {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u === `${SUPABASE_URL}/rest/v1/rpc/${prefix}admin`) {
      const { op, args } = JSON.parse(opts.body);
      try {
        const res = await pg.query(`select ${prefix}admin($1, $2::jsonb) as r`, [op, JSON.stringify(args ?? {})]);
        return new Response(JSON.stringify(res.rows[0].r), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ message: err.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
    }
    if (u.startsWith(SUPABASE_URL) && supabaseRest) {
      const out = await supabaseRest(u, opts);
      if (out) return out;
    }
    if (u.startsWith(SUPABASE_URL)) return new Response(JSON.stringify({ message: 'not faked: ' + u }), { status: 404 });
    return realFetch(url, opts);
  };
}

const plain = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));
const toPg = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + ++i)
    .replace(/\b(admin_users|admin_login_attempts|admin_reset_tokens|admin_audit|admin_settings|admin_secrets|form_submissions|site_events)\b/g, prefix + '$1');
};
export const q = {
  get: async (sql, ...a) => (kind === 'supabase' ? plain((await pg.query(toPg(sql), a)).rows[0]) ?? null : sqlite.prepare(sql).get(...a) ?? null),
  all: async (sql, ...a) => (kind === 'supabase' ? (await pg.query(toPg(sql), a)).rows.map(plain) : sqlite.prepare(sql).all(...a)),
  run: async (sql, ...a) => (kind === 'supabase' ? pg.query(toPg(sql), a) : sqlite.prepare(sql).run(...a)),
};
const D1 = {
  prepare(sql) {
    const st = sqlite.prepare(sql); let args = [];
    const o = {
      bind: (...a) => { args = a; return o; },
      first: async () => st.get(...args) ?? null,
      all: async () => ({ results: st.all(...args) }),
      run: async () => { const r = st.run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    };
    return o;
  },
};

export const env = kind === 'supabase'
  ? { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'service-role-test', ADMIN_STORE: 'supabase', ADMIN_COOKIE_SECRET: 'test-secret', ADMIN_SITE_NAME: 'Test Site', CONTACT_TO: 'fallback@example.com' }
  : { ADMIN_DB: D1, ADMIN_COOKIE_SECRET: 'test-secret', ADMIN_SITE_NAME: 'Test Site', CONTACT_TO: 'fallback@example.com' };

const mw = await imp('functions/admin/_middleware.js');
const login = await imp('functions/admin/login.js');
const forgot = await imp('functions/admin/forgot.js');
const reset = await imp('functions/admin/reset.js');
const apiFn = await imp('functions/admin/api/[[path]].js');
const optional = (p) => (existsSync(join(root, p)) ? imp(p) : null);   // a site may not use the kit's form endpoint
const form = await optional('functions/api/form.js');
const track = await optional('functions/api/track.js');
/* A site's own functions, by path, for its own checks: siteRoutes['/api/contact'] = await import(...). */
export const siteRoutes = {};
export const auth = await imp('functions/admin/_lib/auth.js');
export const store = (await imp('functions/admin/_lib/store.js')).openStore(env);

// ---------- a tiny Pages ----------
export async function dispatch(request, e = env, staticFile = async (p) => new Response('static ' + p)) {
  const url = request.url;
  const method = request.method;
  const waits = [];
  const pathname = new URL(url).pathname;
  const handlerFor = () => {
    const pick = (mod) => mod['onRequest' + method[0] + method.slice(1).toLowerCase()] || mod.onRequest;
    if (pathname === '/admin/login') return pick(login);
    if (pathname === '/admin/forgot') return pick(forgot);
    if (pathname === '/admin/reset') return pick(reset);
    if (pathname.startsWith('/admin/api/')) return apiFn.onRequest;
    if (siteRoutes[pathname]) return pick(siteRoutes[pathname]);
    if (pathname === '/api/form' && form) return form.onRequestPost;
    if (pathname === '/api/track' && track) return track.onRequestPost;
    return async () => staticFile(pathname);
  };
  const ctx = { request, env: e, data: {}, waitUntil: (p) => waits.push(p), params: { path: pathname.replace('/admin/api/', '').split('/') } };
  ctx.next = () => handlerFor()(ctx);
  const res = pathname.startsWith('/admin') ? await mw.onRequest(ctx) : await ctx.next();
  await Promise.all(waits);
  return res;
}

export async function call(method, path, { body, cookie, form: isForm, headers = {}, ip = '1.1.1.1', e = env } = {}) {
  const h = { 'CF-Connecting-IP': ip, ...headers };
  if (cookie) h.Cookie = cookie;
  let payload;
  if (body !== undefined) {
    if (isForm) { payload = new URLSearchParams(body); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
    else { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  }
  const res = await dispatch(new Request('https://site.test' + path, { method, headers: h, body: payload }), e);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch {}
  const set = res.headers.get('Set-Cookie');
  return { status: res.status, json, text, location: res.headers.get('Location'), cookie: set ? set.split(';')[0] : null, headers: res.headers };
}

