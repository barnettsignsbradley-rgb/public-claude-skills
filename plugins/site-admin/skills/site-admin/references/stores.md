# Stores and stacks

The kit's functions only talk to the store through the methods in
`kit/functions/admin/_lib/store-d1.js`. On another store, write the same
methods and swap the import in `_middleware.js`. Everything else stays.

| Site | Lives on | Admin store |
|---|---|---|
| New sites | Cloudflare Pages | D1 (`ADMIN_DB`, or the site's `DB`) |
| Sites on KV | Pages + KV | D1 `ADMIN_DB` for the admin tables; modules read KV as today |
| Sites on Supabase | Pages + Supabase | `store-supabase.js`, prefixed tables (below) |
| Next.js sites | Next.js on Vercel + Prisma/Postgres | Prisma models (below) |

A site may use two stores: a site that keeps its data in KV puts its
admin tables go in a small D1 so sign-in, the inbox and analytics are the
same code as everywhere else. That's preferred over rewriting the kit for
KV.

## KV only (if D1 really can't be added)
Keys: `admin:user:<id>`, `admin:email:<email>` → id, `admin:try:<ip>:<min>`
with a 15-minute TTL (count failures by listing the prefix), `admin:reset:<sha>`
with a 30-minute TTL, `admin:audit:<ts>` (list newest by reverse
timestamp), `admin:setting:<key>`. `form:<ts>:<id>` for the inbox; events
are too many for KV, so Analytics needs D1 or Analytics Engine.

## Supabase / Postgres
`kit/functions/admin/_lib/store-supabase.js` has every store method; each is
one POST to `/rest/v1/rpc/<prefix>admin` with `{ op, args }`, answered by a
single plpgsql function in `kit/postgres/admin.sql` that returns the same
shapes as `store-d1.js` (timestamps come back ISO, booleans as booleans;
the page handles both).

- Turn it on in the server `modules.js`:
  `export const adminStore = { kind: 'supabase', prefix: 'site_', url: 'https://<ref>.supabase.co' };`
  `SUPABASE_URL` in the dashboard wins over `url`.
- Tables: `node scripts/pg-schema.mjs > <migrations>/<date>_admin_kit.sql`,
  then apply it. RLS on, no policies, anon/authenticated revoked, the
  function granted to `service_role` only. Probe with the publishable key:
  rpc, select and insert must all come back 401/42501.
- Why one function: the 1,000-row cap, RLS and grants are in one reviewed
  place, there is one thing to grant, and the kit's checks run the real
  SQL on PGlite (`ADMIN_TEST_STORE=supabase node kit/test/run.mjs`).
- Why a prefix: two sites can share one Supabase project (the
  free plan allows two), so each site's admin tables must not collide.
- A site's own module data stays in its own tables, read with PostgREST and
  the service role from the site's `_lib/<site>-*.js`. Page with
  `limit`/`offset` on a total order (the 1,000-row cap returns 200 and no
  warning) and count with `HEAD` + `Prefer: count=exact`; keep small `db`, `dbAll` and `count`
  helpers in the site's own `_lib` file.
- An old admin that reaches data through password-checking RPCs moves to
  the service role server-side; retire those RPCs once the new admin is live.
- Never reuse Supabase Auth or a customer profile's `role = 'admin'` for this:
  those are customers.
- One project for staging and production means one set of admin accounts
  and saved keys for both: see SKILL.md, Ship.

## Next.js
- Prisma models with the same fields as the SQL above (`AdminUser`,
  `AdminLoginAttempt`, `AdminResetToken`, `AdminAudit`, `AdminSetting`,
  `FormSubmission`, `SiteEvent`). If the site already has a contact-message model,
  migrate it into `FormSubmission` (keep the rows) rather than keeping both.
- `auth.js` works unchanged in a Route Handler (Web Crypto). Put the gate
  in the site's middleware (`src/proxy.js` on Next 16) for `/admin/:path*`, reading the
  same `site_admin` cookie. The login, forgot and reset pages are route
  handlers returning the same HTML as `pages.js`.
- Serve the admin UI as static files from `public/admin/` (the kit's
  `index.html`, `admin.css`, `admin.js` unchanged) so it is identical to
  every other site, with `/admin/api/*` as Route Handlers. Next doesn't
  serve `public/admin/index.html` at `/admin` on its own: add a rewrite
  (`/admin` and `/admin/` → `/admin/index.html`), and make sure the proxy's
  matcher covers those static files too. Retire any old
  React admin (`src/app/admin/`) once the new one is checked.
- Analytics: `@vercel/analytics` stays in the Vercel dashboard; the admin's
  Analytics tab reads the site's own `site_events` from `/api/track` like
  everywhere else.
