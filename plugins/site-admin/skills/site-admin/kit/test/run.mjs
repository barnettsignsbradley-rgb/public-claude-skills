#!/usr/bin/env node
/**
 * End-to-end check of the kit's functions without Cloudflare: a D1 stand-in
 * on node:sqlite, the real migrations, and the real handlers called the way
 * Pages calls them. Run from the kit (or a site that copied it):
 *   node test/run.mjs
 * Needs Node 22.5+ (node:sqlite). Exits 1 on the first failed check.
 * ADMIN_TEST_STORE=supabase runs every check again on Postgres (PGlite).
 */
import { q, store, kind, auth, call, env } from './harness.mjs';
console.log(`store: ${kind}`);

let passed = 0;
function check(name, cond, extra) {
  if (!cond) { console.error('FAIL', name, extra ?? ''); process.exit(1); }
  passed++; console.log('ok  ', name);
}
const X = { 'X-Admin': '1' };

// ---------- seed the first owner the way scripts/admin-user.mjs does ----------
const temp = auth.tempPassword();
await store.createAdmin({ email: 'owner@example.com', name: 'Olive', role: 'owner', password_hash: await auth.hashPassword(temp), must_change: true });

let r = await call('GET', '/admin/');
check('signed out: page redirects to sign-in', r.status === 302 && /\/admin\/login$/.test(r.headers.get('Location')));
r = await call('GET', '/admin/api/me');
check('signed out: API is 401', r.status === 401);
r = await call('GET', '/admin/login');
check('sign-in page is public and noindex', r.status === 200 && r.headers.get('X-Robots-Tag').includes('noindex'));
r = await call('GET', '/admin/admin.css');
check('stylesheet is public', r.status === 200);
r = await call('GET', '/admin/', { e: { ...env, ADMIN_COOKIE_SECRET: '' } });
check('no cookie secret: fails closed', r.status === 503);

r = await call('POST', '/admin/login', { form: true, body: { email: 'owner@example.com', password: 'wrong-password' } });
check('wrong password refused', r.status === 401 && !r.cookie);
r = await call('POST', '/admin/login', { form: true, body: { email: 'OWNER@example.com ', password: temp } });
check('temp password signs in (email case-insensitive)', r.status === 303 && r.cookie?.startsWith('site_admin='));
let owner = r.cookie;

r = await call('GET', '/admin/api/me', { cookie: owner });
check('must_change flagged', r.json.admin.must_change === true && r.json.admin.role === 'owner');
r = await call('GET', '/admin/api/admins', { cookie: owner });
check('must_change blocks everything else', r.status === 403);
r = await call('POST', '/admin/api/password', { cookie: owner, body: { next: 'a-much-better-password' } });
check('writes need X-Admin header', r.status === 403);
r = await call('POST', '/admin/api/password', { cookie: owner, headers: X, body: { next: 'short' } });
check('short password refused', r.status === 400);
r = await call('POST', '/admin/api/password', { cookie: owner, headers: X, body: { next: 'a-much-better-password' } });
check('new password saved, fresh cookie issued', r.status === 200 && r.cookie);
const oldCookie = owner; owner = r.cookie;
r = await call('GET', '/admin/api/me', { cookie: oldCookie });
check('old session dies with the old password', r.status === 401);
r = await call('GET', '/admin/api/me', { cookie: owner });
check('new session works, must_change cleared', r.status === 200 && r.json.admin.must_change === false);
r = await call('GET', '/admin/api/me', { cookie: owner.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) });
check('tampered cookie refused', r.status === 401);

// ---------- admins ----------
r = await call('POST', '/admin/api/admins', { cookie: owner, headers: X, body: { email: 'Staff@Example.com', name: 'Sam', role: 'staff' } });
check('add staff: no email set up, temp password returned once', r.status === 200 && r.json.emailed === false && /^\w{4}-\w{4}-\w{4}-\w{4}$/.test(r.json.temp));
const staffTemp = r.json.temp;
r = await call('POST', '/admin/api/admins', { cookie: owner, headers: X, body: { email: 'staff@example.com' } });
check('duplicate admin refused', r.status === 409);
r = await call('GET', '/admin/api/admins', { cookie: owner });
const ownerId = r.json.admins.find((a) => a.role === 'owner').id;
const staffId = r.json.admins.find((a) => a.role === 'staff').id;
check('admins listed without hashes', r.json.admins.length === 2 && !('password_hash' in r.json.admins[0]));
r = await call('POST', `/admin/api/admins/${ownerId}`, { cookie: owner, headers: X, body: { role: 'staff' } });
check('last owner cannot be demoted', r.status === 400);
r = await call('POST', `/admin/api/admins/${ownerId}`, { cookie: owner, headers: X, body: { disabled: true } });
check('cannot disable yourself / last owner', r.status === 400);

r = await call('POST', '/admin/login', { form: true, body: { email: 'staff@example.com', password: staffTemp } });
let staff = r.cookie;
await call('POST', '/admin/api/password', { cookie: staff, headers: X, body: { next: 'staff-password-123' } }).then((x) => (staff = x.cookie));
r = await call('GET', '/admin/api/admins', { cookie: staff });
check('staff cannot see admins', r.status === 403);
r = await call('POST', '/admin/api/settings', { cookie: staff, headers: X, body: { key: 'form_recipients', value: {} } });
check('staff cannot change settings', r.status === 403);
r = await call('GET', '/admin/api/inbox', { cookie: staff });
check('staff can read the inbox', r.status === 200);
r = await call('POST', `/admin/api/admins/${staffId}`, { cookie: owner, headers: X, body: { disabled: true } });
r = await call('GET', '/admin/api/me', { cookie: staff });
check('disabling an admin ends their session now', r.status === 401);

// ---------- settings ----------
r = await call('POST', '/admin/api/settings', { cookie: owner, headers: X, body: { key: 'anything_else', value: 1 } });
check('unknown setting refused', r.status === 400);
r = await call('POST', '/admin/api/settings', { cookie: owner, headers: X, body: { key: 'form_recipients', value: { '*': ['team@example.com'], speaking: ['events@example.com'] } } });
check('form recipients saved', r.status === 200);

// ---------- forms ----------
r = await call('POST', '/api/form', { body: { form: 'contact', email: 'a@b.co', message: 'hi', website: 'spam.biz' } });
check('honeypot looks like success but stores nothing', r.json.ok && (await q.get('SELECT COUNT(*) n FROM form_submissions')).n === 0);
r = await call('POST', '/api/form', { body: { form: 'contact', email: 'not-an-email' } });
check('bad email refused', r.status === 400);
r = await call('POST', '/api/form', { form: true, body: { form: 'contact', name: 'Ann', email: 'ann@x.co', message: 'Hello there', phone: '555', visitor_id: 'v1' } });
check('form-encoded post stored', r.json.ok);
const row = await q.get('SELECT * FROM form_submissions');
check('extra fields kept as JSON, visitor linked', JSON.parse(row.fields).phone === '555' && row.visitor_id === 'v1' && row.status === 'new' && !row.emailed);
for (let i = 0; i < 4; i++) await call('POST', '/api/form', { ip: '9.9.9.9', body: { form: 'contact', message: 'm' + i } });
r = await call('POST', '/api/form', { ip: '9.9.9.9', body: { form: 'contact', message: 'm5' } });
check('5 per hour per IP, then 429', r.status === 200);
r = await call('POST', '/api/form', { ip: '9.9.9.9', body: { form: 'contact', message: 'm6' } });
check('6th message in an hour refused', r.status === 429);

// ---------- inbox ----------
r = await call('GET', '/admin/api/inbox', { cookie: owner });
check('inbox shows waiting messages with counts', r.json.rows.length === 6 && r.json.counts.new === 6);
r = await call('POST', `/admin/api/inbox/${row.id}`, { cookie: owner, headers: X, body: { status: 'responded', note: 'Called her back' } });
const after = await q.get('SELECT * FROM form_submissions WHERE id = ?', row.id);
check('responded checkbox records who and when', after.status === 'responded' && after.responded_by === 'Olive' && after.responded_at && after.note === 'Called her back');
r = await call('GET', '/admin/api/inbox?status=responded&format=csv', { cookie: owner });
check('CSV export', r.status === 200 && r.text.includes('Hello there') && r.headers.get('Content-Type').includes('text/csv'));

// ---------- analytics ----------
for (const [v, p] of [['v1', '/'], ['v1', '/about'], ['v2', '/'], ['v3', '/pricing']]) {
  await call('POST', '/api/track', { body: { visitor_id: v, type: 'pageview', path: p, referrer: v === 'v2' ? 'google.com' : null, device: 'desktop' } });
}
await call('POST', '/api/track', { headers: { 'User-Agent': 'Googlebot/2.1' }, body: { visitor_id: 'bot', type: 'pageview', path: '/' } });
r = await call('GET', '/admin/api/analytics?days=30', { cookie: owner });
check('analytics counts visitors, skips bots', r.json.visitors === 3 && r.json.views === 4 && r.json.pages[0].label === '/' && r.json.daily.length === 1);
check('referrers include Direct and google.com', r.json.refs.map((x) => x.label).sort().join() === 'Direct,google.com');
r = await call('GET', '/admin/api/overview', { cookie: owner });
check('overview totals', r.json.visitors7 === 3 && r.json.openMessages === 5);

// ---------- password reset by link ----------
r = await call('POST', '/admin/forgot', { form: true, ip: '7.7.7.7', body: { email: 'nobody@example.com' } });
check('forgot: same answer for unknown emails', r.status === 200 && r.text.includes('If that email belongs'));
const token = auth.randomToken();
await store.saveResetToken(await auth.sha256(token), ownerId, Date.now() + 60000);
r = await call('POST', '/admin/reset', { form: true, body: { t: token, password: 'reset-password-xyz' } });
check('reset link sets the password and signs in', r.status === 303 && r.cookie);
r = await call('POST', '/admin/reset', { form: true, body: { t: token, password: 'another-password-1' } });
check('reset link works once', r.status === 400);
r = await call('GET', '/admin/api/me', { cookie: owner });
check('reset ends the old session', r.status === 401);

// ---------- throttle ----------
for (let i = 0; i < 5; i++) await call('POST', '/admin/login', { form: true, ip: '6.6.6.6', body: { email: 'owner@example.com', password: 'nope-' + i } });
r = await call('POST', '/admin/login', { form: true, ip: '6.6.6.6', body: { email: 'owner@example.com', password: 'reset-password-xyz' } });
check('5 wrong tries from one IP locks it for 15 minutes, even with the right password', r.status === 429);
r = await call('POST', '/admin/login', { form: true, ip: '5.5.5.5', body: { email: 'owner@example.com', password: 'reset-password-xyz' } });
check('other IPs still sign in', r.status === 303);

r = await call('GET', '/admin/api/audit', { cookie: r.cookie });
check('audit log records the changes', ['admin_added', 'setting_changed', 'inbox_update', 'password_reset', 'sign_in'].every((a) => r.json.rows.some((x) => x.action === a)));


// ---------- Setup: keys saved in the admin, checks, the Stripe webhook button ----------
owner = (await call('POST', '/admin/login', { form: true, ip: '4.4.4.4', body: { email: 'owner@example.com', password: 'reset-password-xyz' } })).cookie;
const ALL = { ...env, ADMIN_INTEGRATIONS: 'admin,email,stripe,mailerlite,turnstile,tracking' };
const sent = [];
const hooks = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const auth = (opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || '';
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith('https://api.stripe.com/v1/')) {
    if (!auth.includes('sk_test_good')) return reply(401, { error: { message: 'Invalid API Key provided' } });
    const path = u.slice('https://api.stripe.com/v1/'.length);
    if (path === 'account') return reply(200, { id: 'acct_1', settings: { dashboard: { display_name: 'Example Test Co' } } });
    if (path.startsWith('webhook_endpoints?')) return reply(200, { data: hooks });
    if (path === 'webhook_endpoints' && opts.method === 'POST') {
      const form = new URLSearchParams(opts.body);
      const h = { id: 'we_' + hooks.length, url: form.get('url'), status: 'enabled', events: [...form.keys()].filter((k) => k.startsWith('enabled_events')).map((k) => form.get(k)) };
      hooks.push(h);
      return reply(200, { ...h, secret: 'whsec_made_by_test' });
    }
    if (path.startsWith('webhook_endpoints/') && opts.method === 'DELETE') { hooks.splice(hooks.findIndex((h) => h.id === path.split('/')[1]), 1); return reply(200, { deleted: true }); }
  }
  if (u === 'https://api.resend.com/domains') return auth.includes('re_good') ? reply(200, { data: [{ name: 'example.com', status: 'verified' }] }) : reply(401, { name: 'validation_error' });
  if (u === 'https://api.resend.com/emails') { sent.push(JSON.parse(opts.body)); return reply(200, { id: 'em_' + sent.length }); }
  if (u.startsWith('https://connect.mailerlite.com/')) return reply(200, { data: [], meta: { total: 7 } });
  if (u.startsWith('https://challenges.cloudflare.com/')) {
    const f = new URLSearchParams(opts.body);
    return reply(200, f.get('response') === 'good-token' ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] });
  }
  return realFetch(url, opts);
};
const card = (r, id) => r.json.cards.find((c) => c.id === id);

r = await call('GET', '/admin/api/setup', { cookie: owner, e: ALL });
check('setup lists every service with a status', r.status === 200 && card(r, 'stripe').status === 'missing' && card(r, 'email').status === 'missing' && card(r, 'admin').status === 'ok' && card(r, 'tracking').status === 'ok');
check('every card carries its how-to steps and needs', r.json.cards.every((c) => c.what && (c.steps?.length || c.id === 'admin') && c.needs?.length));
r = await call('GET', '/admin/api/overview', { cookie: owner, e: ALL });
check('overview lists what isn’t set up', r.json.setupMissing.includes('Payments (Stripe)') && r.json.setupMissing.includes('Email (Resend)') && !r.json.setupMissing.includes('Admin sign-in'));

r = await call('POST', '/admin/api/setup/stripe/save', { cookie: owner, e: ALL, headers: X, body: { values: { ADMIN_COOKIE_SECRET: 'x' } } });
check('the admin’s own secret can’t be stored from the page', r.status === 400);
r = await call('POST', '/admin/api/setup/email/save', { cookie: owner, e: { ...ALL, RESEND_API_KEY: 're_dashboard' }, headers: X, body: { values: { RESEND_API_KEY: 're_good_123456789' } } });
check('a key set in the dashboard can’t be overridden from the page', r.status === 400);

r = await call('POST', '/admin/api/setup/stripe/save', { cookie: owner, e: ALL, headers: X, body: { values: { STRIPE_SECRET_KEY: 'sk_test_bad_0000000000' } } });
r = await call('GET', '/admin/api/setup', { cookie: owner, e: ALL });
check('a refused Stripe key shows Stripe’s reason', card(r, 'stripe').status === 'problem' && /Invalid API Key/.test(card(r, 'stripe').detail));

r = await call('POST', '/admin/api/setup/stripe/save', { cookie: owner, e: ALL, headers: X, body: { values: { STRIPE_SECRET_KEY: 'sk_test_good_1234567890abcd' } } });
const row2 = await q.get("SELECT * FROM admin_secrets WHERE name = 'STRIPE_SECRET_KEY'");
check('saved key is encrypted at rest, only a hint kept', r.status === 200 && !row2.ciphertext.includes('sk_test') && row2.hint === 'sk_test_…abcd');
r = await call('GET', '/admin/api/setup', { cookie: owner, e: ALL });
check('the page never gets the key back', !JSON.stringify(r.json).includes('sk_test_good_1234567890abcd'));
const s1 = card(r, 'stripe');
check('working key: account, test mode, webhook still to make', s1.status === 'problem' && s1.facts.some((f) => f.includes('Example Test Co')) && s1.facts.some((f) => f.includes('TEST')) && s1.fields[0].source === 'admin');

r = await call('POST', '/admin/api/setup/stripe/action/webhook', { cookie: owner, e: ALL, headers: X, body: {} });
check('Create the webhook: made in Stripe, signing secret saved', r.status === 200 && hooks.length === 1 && hooks[0].url === 'https://site.test/api/stripe-webhook'
  && hooks[0].events.includes('checkout.session.completed') && (await q.get("SELECT COUNT(*) n FROM admin_secrets WHERE name = 'STRIPE_WEBHOOK_SECRET'")).n === 1);
r = await call('POST', '/admin/api/setup/stripe/action/webhook', { cookie: owner, e: ALL, headers: X, body: {} });
check('pressing it again replaces, never duplicates', hooks.length === 1);
r = await call('GET', '/admin/api/setup', { cookie: owner, e: ALL });
check('Stripe now shows Working', card(r, 'stripe').status === 'ok');

await call('POST', '/admin/api/setup/email/save', { cookie: owner, e: ALL, headers: X, body: { values: { RESEND_API_KEY: 're_good_123456789', ADMIN_FROM: 'Test Site <hello@example.com>' } } });
r = await call('GET', '/admin/api/setup', { cookie: owner, e: ALL });
check('email check confirms the from domain is verified', card(r, 'email').status === 'ok' && card(r, 'email').fields.find((f) => f.name === 'ADMIN_FROM').hint === 'Test Site <hello@example.com>');
r = await call('POST', '/admin/api/setup/email/action/test', { cookie: owner, e: ALL, headers: X, body: {} });
check('send-me-a-test goes to the signed-in owner', r.status === 200 && sent.at(-1).to[0] === 'owner@example.com');
const before = sent.length;
await call('POST', '/api/form', { ip: '3.3.3.3', e: ALL, body: { form: 'speaking', name: 'Bea', email: 'bea@x.co', message: 'Retreat in May?' } });
check('forms use the key saved in the admin, and the per-form recipients', sent.length === before + 1 && sent.at(-1).to[0] === 'events@example.com'
  && !!(await q.get("SELECT emailed FROM form_submissions WHERE name = 'Bea'")).emailed);

await call('POST', '/admin/api/setup/turnstile/save', { cookie: owner, e: ALL, headers: X, body: { values: { TURNSTILE_SITE_KEY: '0x4AAA', TURNSTILE_SECRET_KEY: '0xsecret', TURNSTILE_REQUIRED: '' } } });
r = await call('POST', '/api/form', { ip: '3.3.3.4', e: ALL, body: { form: 'contact', message: 'no widget on this page yet' } });
check('Turnstile saved but not required: pages without the widget still work', r.status === 200);
r = await call('POST', '/api/form', { ip: '3.3.3.5', e: ALL, body: { form: 'contact', message: 'bad token', 'cf-turnstile-response': 'nope' } });
check('a page with the widget is checked', r.status === 400);
await call('POST', '/admin/api/setup/turnstile/save', { cookie: owner, e: ALL, headers: X, body: { values: { TURNSTILE_REQUIRED: 'yes' } } });
r = await call('POST', '/api/form', { ip: '3.3.3.6', e: ALL, body: { form: 'contact', message: 'bot posting directly' } });
check('“Require it” refuses posts without a token', r.status === 400);
r = await call('POST', '/api/form', { ip: '3.3.3.7', e: ALL, body: { form: 'contact', message: 'real person', 'cf-turnstile-response': 'good-token' } });
check('…and accepts a real one', r.status === 200);

const { withStoredSecrets } = await import(new URL('../functions/admin/_lib/secrets.js', import.meta.url).href);
const rotated = await withStoredSecrets({ ...env, ADMIN_COOKIE_SECRET: 'a-new-secret' }, store);
check('rotating the admin secret flags saved keys to paste again', rotated.__broken.includes('STRIPE_SECRET_KEY') && !rotated.STRIPE_SECRET_KEY);

r = await call('GET', '/admin/api/audit', { cookie: owner });
check('setup changes are in the activity log', r.json.rows.some((x) => x.action === 'setup_saved') && r.json.rows.some((x) => x.action === 'setup_action'));
globalThis.fetch = realFetch;

console.log(`\n${passed} checks passed`);
