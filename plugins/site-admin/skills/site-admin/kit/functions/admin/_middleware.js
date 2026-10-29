/**
 * Guards everything under /admin. Signed-out visitors reach only the sign-in,
 * forgot and reset pages (and the stylesheet they use). The API answers 401;
 * pages redirect to /admin/login. Every response gets no-store and noindex.
 */
import { currentAdmin } from './_lib/auth.js';
import { openStore } from './_lib/store.js';
import { SECURITY_HEADERS, fail } from './_lib/http.js';
import { withStoredSecrets } from './_lib/secrets.js';

const PUBLIC = new Set(['/admin/login', '/admin/forgot', '/admin/reset', '/admin/admin.css', '/admin/theme.css']);
// A freshly reset admin may only do these until they choose a new password.
const MUST_CHANGE_OK = new Set(['/admin', '/admin/', '/admin/index.html', '/admin/admin.js', '/admin/kit.js', '/admin/modules.js', '/admin/api/me', '/admin/api/password', '/admin/api/logout']);

export async function onRequest(ctx) {
  const { request, env, next } = ctx;
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

  let res;
  if (!env.ADMIN_COOKIE_SECRET) {
    res = path === '/admin/admin.css' || path === '/admin/theme.css' ? await next() : notSetUp();
  } else if (PUBLIC.has(path)) {
    ctx.data.store = openStore(env);
    ctx.data.env = await withStoredSecrets(env, ctx.data.store);
    res = await next();
  } else {
    const store = openStore(env);
    const admin = await currentAdmin(request, env, store);
    if (!admin) {
      res = path.startsWith('/admin/api/') ? fail(401, 'Signed out') : Response.redirect(new URL('/admin/login', request.url).toString(), 302);
    } else {
      const row = await store.adminById(admin.id);
      if (row.must_change && !MUST_CHANGE_OK.has(path)) {
        res = path.startsWith('/admin/api/') ? fail(403, 'Choose a new password first') : Response.redirect(new URL('/admin', request.url).toString(), 302);
      } else {
        ctx.data.admin = { ...admin, must_change: !!row.must_change };
        ctx.data.store = store;
        ctx.data.env = await withStoredSecrets(env, store);
        res = await next();
      }
    }
  }

  res = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

/* Shown instead of the admin until the one dashboard secret exists, with the steps to add it. */
function notSetUp() {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Admin isn’t set up yet</title><link rel="stylesheet" href="/admin/admin.css"><link rel="stylesheet" href="/admin/theme.css">
<body class="auth"><main class="auth-card"><h1>Admin isn’t set up yet</h1>
<p>It needs one secret before it opens. Everything else (Stripe, email, lists) is set up from inside the admin.</p>
<ol class="steps">
<li>Make a random value of 32 or more letters and numbers (a password manager’s generator works).</li>
<li>Cloudflare dashboard → Workers &amp; Pages → this project → Settings → Variables and Secrets → Add. Type: Secret. Name: <code>ADMIN_COOKIE_SECRET</code>. Paste the value. Save.</li>
<li>Deployments → latest → Retry deployment, then reload this page.</li>
</ol></main></body>`, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
