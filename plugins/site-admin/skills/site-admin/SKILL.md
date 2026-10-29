---
name: site-admin
description: Build or upgrade the /admin page of one of your websites so every site's admin works and looks the same - same sign-in and security, same layout, same tabs - with only the modules that site needs. Core on every site - analytics with graphs, an inbox for every form with editable recipients and a Responded checkbox, a Setup tab where Stripe, email, MailerLite and spam protection are connected from inside the admin with live checks, an (i) with how-to instructions on every tab and setup card, admins with owner/staff roles, password reset, settings and an activity log. Modules as needed - people (subscribers, customers, users, affiliates), a tab per product, course progress, calendar and events, Stripe promo codes and payment links, sending contracts and links, MailerLite groups. Ships a tested kit (Cloudflare Pages Functions + D1) and adapters for KV, Supabase and Next.js. Use when the user says add an admin, fix or upgrade the admin, "run site-admin on <site>", or asks for any of those features on a site's backend.
argument-hint: "<site or repo> [what to add]"
---

# Site Admin

Every site you run gets the same `/admin`: the same sign-in, the same
security, the same sidebar, the same names for the same things. A site only
shows the tabs it has a use for, but a tab that exists works the same way on
every site. Someone who knows one site's admin can use another's without
being shown.

The kit in `kit/` is the reference build. It runs, and `node kit/test/run.mjs`
proves it (66 checks: sign-in, roles, throttling, resets, forms, inbox,
analytics, Setup, the Stripe webhook button), on D1 and, with
`ADMIN_TEST_STORE=supabase`, on Postgres too. Copy it; don't re-invent it.

## The standard (every site, no exceptions)

1. **Address.** The page is `/admin`, its data is `/admin/api/*`, and its
   sign-in pages are `/admin/login`, `/admin/forgot`, `/admin/reset`.
   Nothing admin lives anywhere else. (An old `/api/admin` or Basic Auth
   gate moves here when the site is upgraded.)
2. **Sign-in** (`kit/functions/admin/_lib/auth.js`, rules in
   `references/security.md`):
   - Each admin is a person with their own email and password. No shared
     passwords, no password in an env var, no password in the source.
   - Passwords are PBKDF2-SHA256, 100,000 iterations (the Workers ceiling),
     stored as `pbkdf2$100000$salt$hash`. At least 10 characters.
   - One cookie, `site_admin`, HMAC-signed with `ADMIN_COOKIE_SECRET`, 7 days,
     `HttpOnly; Secure; SameSite=Strict; Path=/admin`. It carries a
     fingerprint of the password hash, so changing or resetting a password
     signs that person out everywhere. No secret set: the admin answers 503.
   - 5 wrong tries per IP or 20 overall in 15 minutes locks sign-in.
   - Roles: **owner** (everything) and **staff** (everything except Admins,
     Settings and Activity, and except money actions a module marks owner-only).
     There is always at least one active owner.
   - Forgot password emails a one-time link (30 minutes). An owner can reset
     anyone; the person must choose their own password at next sign-in.
   - Every write needs the `X-Admin: 1` header and lands in the activity log.
   - Every admin response is `no-store`, `noindex`, `X-Frame-Options: DENY`.
3. **Layout** (`kit/admin/`): sidebar on desktop, a Menu button on phones,
   hash routes (`#inbox?status=open`). Order: Overview, Analytics, Inbox,
   then the site's modules, then a "Settings" group (Setup, Admins,
   Settings, Activity). Vanilla JS, no build step, no chart library.
   **It looks like the website.** Every admin uses the same layout, but in
   its own site's colours, fonts, buttons and logo: `admin/theme.css` sets
   the tokens from `admin.css` (accent, page and card colours, heading and
   label fonts, button shape and case, sidebar colours, logo rounding),
   taken from the site's own stylesheet, and `siteLogo` in the server
   `modules.js` puts the logo on the sign-in pages and in the menu. Check
   it side by side with the live site before handing over. It should
   read as part of the site, not a generic tool. Still no hero, no
   marketing copy and no motion beyond the toast.
4. **Data stays on the site.** Each site stores its own admin tables
   (D1 by default; Supabase where the site already lives there, through
   `store-supabase.js` and the same methods; KV or Prisma per
   `references/stores.md`). Nothing outside the two store files touches
   the admin's tables: the router, `/api/form` and `/api/track` call store
   methods, and everything opens the store through `openStore(env)`. Page views go to the site's own
   `site_events`, so its Analytics tab works on its own; forwarding to a
   cross-site hub is optional (`HUB_URL`), never required.
5. **Every form lands in the Inbox first, then gets emailed.** One endpoint,
   `POST /api/form` with a `form` name, stores the message, then emails the
   recipients set in Settings → "Who gets form messages" (per form, with an
   "every form" fallback, then `CONTACT_TO`). A failed email never loses a
   message, and the Inbox flags it "not emailed".
6. **Money and email to customers need a confirm.** Any button that creates
   a Stripe object, charges, refunds, or emails a customer goes through
   `confirmAction()` and names who and how much. Stripe objects are tagged
   `metadata.site = <site>` so several sites can share one Stripe account.
7. **Set up from inside the admin.** The only thing set in the hosting
   dashboard is `ADMIN_COOKIE_SECRET` (and the database binding). Every
   other key (Stripe, Resend, MailerLite, Turnstile) is pasted on the
   **Setup** tab, stored AES-GCM encrypted, never shown again in full, and
   checked live against the service ("Working", "Not set up", "Needs
   attention", with the reason). Where the service allows it, the admin
   does the setup itself: "Create the webhook" registers the Stripe webhook
   and saves its signing secret; "Send me a test email" proves Resend. A
   value in the dashboard always wins and shows as such. Overview names
   anything required that isn't set up. Services and their checks live in
   `kit/functions/admin/_lib/integrations.js`; a module that needs a new
   service adds a card there.
8. **An (i) on everything that needs explaining.** Every tab heading, every
   Setup card and every module's main actions get the (i): what it does,
   how to do it step by step (exact menu paths in the outside service),
   and what it needs. Write them for the site owner, not a developer:
   a non-technical owner should be able to connect Stripe from the (i) alone.
   Core text is in `HELP` in `admin.js`; a module adds `HELP.<id>`, and its
   view calls `heading(title, id)`. A module isn't done until its (i) is.
9. **Same words everywhere.** Use the names in `references/modules.md`
   (Inbox, not Messages or Support; People, not Subscribers; Responded, not
   Handled). Plain, short labels; run them past no-ai-slop's Web pages rules
   if website-build or website-redesign is installed.

## Workflow

### 0. Intake
- Find the repo, how it deploys and where its data lives (project memory,
  README, wrangler config or dashboard bindings, `.env.example`). Read the
  repo's own working rules first (`CLAUDE.md` and the like) and follow them.
- List what the site actually does that an owner needs to see: every form,
  every way someone signs up or pays, every product, accounts, courses,
  events, mailing lists, affiliates. Read the old `<script>` blocks and
  functions, not just the markup.
- If the site belongs to someone else (a client), work on a
  branch with a PR, and write any dashboard steps as numbered clicks in a
  markdown file in the repo.

### 1. Plan (one short message, then keep going)
Show the user a table: module → in or out → why → what it reads from. Mark
what moves (an old admin feature that changes address or shape) and
anything the site must start storing first (e.g. a form that only emails
today). Decide and keep moving unless a choice changes money or who can
sign in.

### 2. Install the core
- Copy `kit/functions/admin/`, `kit/functions/api/form.js` (unless the site
  already has a form endpoint you'll route to the Inbox instead, e.g. an existing
  `/api/contact`), `kit/functions/api/track.js` and
  `kit/admin/` into the site. Keep the file names.
- Copy `kit/migrations/` (D1) or `kit/postgres/` (Supabase), `kit/scripts/`
  and `kit/test/harness.mjs` + `serve.mjs` too. If the site serves its repo root (plain static sites), put them under a path the site already refuses to
  serve, e.g. `tools/admin/`; the scripts find the site root themselves.
  Don't copy `kit/test/run.mjs`: it checks the kit, not the site.
- Files that are the kit's (everything except the two `modules.js`,
  `admin/theme.css` and migrations numbered after the kit's) are never edited
  in a site. Change the kit here, then copy it across.
- Store: D1 → bind `ADMIN_DB` (or reuse the site's `DB`) and run the
  migrations. Supabase → in the server `modules.js` set
  `adminStore = { kind: 'supabase', prefix: '<site>_', url }` (the prefix
  lets two sites share one project), print the
  tables with `node scripts/pg-schema.mjs > <the site's migrations folder>`,
  apply them (Supabase MCP `apply_migration`), and the dashboard needs only
  `SUPABASE_SERVICE_ROLE_KEY`. Probe them with the publishable key afterwards
  (curl): the rpc, a read and an insert must all be refused. KV or Prisma →
  write the adapter from `references/stores.md` with `store-d1.js`'s method
  names.
- Write `admin/theme.css` from the site's stylesheet (colours, Google Fonts, buttons, a sidebar in the site's dark band if it has one), and set `siteLabel` and `siteLogo` in `functions/admin/_lib/modules.js`.
- Point every form at `/api/form` with a `form` name (keep the site's own
  success messages). Add a page-view script that posts to `/api/track` (the kit's `track.js`
  documents the payload) to every page if the site doesn't have one.
- Set `integrations` in `modules.js` to the services this site uses
  (add `'stripe'`, `'mailerlite'`), and `stripeWebhook.path` to where the
  site's webhook handler lives.
- In the hosting dashboard the user sets one secret, `ADMIN_COOKIE_SECRET`
  (32+ random characters; the admin shows those steps itself until it's
  there). Everything else is pasted on the Setup tab by an owner. If a site
  already has keys in the dashboard, leave them:
  Setup shows them as "Set in the Cloudflare dashboard" and checks them.
  Optional dashboard values: `CONTACT_TO`, `IP_HASH_SALT`, `HUB_URL` /
  `HUB_SITE_ID` / `HUB_SITE_KEY`.
- First owner: `node scripts/admin-user.mjs <email> "<Name>" owner`, run the
  SQL it prints against the site's database (it prints Postgres SQL for a
  Supabase site), hand the user the temporary password. Never invent
  passwords for other people or put them in git.
- A site with no public forms (e.g. its one field is a waitlist, which
  is People) leaves the Inbox out: `withoutCore = ['inbox', 'settings']` in
  the server `modules.js` (keep 'settings' if it has `moduleSettings`), and
  don't copy `functions/api/form.js`. Name that in the plan.

### 3. Add the modules
A site has two files of its own (plus, when its module code is long, a
`functions/admin/_lib/<site>-*.js` that `modules.js` imports, e.g.
`<site>-data.js`):
- `functions/admin/_lib/modules.js` (server): `moduleNav`, `moduleRoutes`,
  `moduleOverview` (extra Overview numbers), `moduleFallback`,
  `moduleSettings`, `integrations`, `moduleIntegrations` (extra Setup
  cards), `stripeWebhook`, `dashboardKeys`, `siteLabel`.
- `admin/modules.js` (page): `MODULE_VIEWS`, one per nav id, built with the
  helpers in `admin/kit.js`, each with its `HELP.<id>` for the (i).

For each module the plan includes, follow its entry in
`references/modules.md`: the tables or sources it reads, its routes, its
view and its checks. Reuse what the site already has (its Stripe helper,
its MailerLite helper, its email templates) instead of adding a second copy.

What the kit gives a module, so it doesn't build its own:
- `moduleOverview` items take `href` (the stat links to its tab) and
  `badge: '<key>'` with a numeric `count`: any view declaring
  `badge: '<key>'` gets it in the menu (e.g. open reports, new
  feedback).
- Owner-only routes are the fourth element, `'owner'`; in the page,
  `document.body.dataset.role === 'owner'` hides those buttons from staff.
- A route that throws an error with a `status` should answer that status:
  wrap module handlers (a small `route()` wrapper in `modules.js`), or the
  router turns a 404 into a 500.
- ``toHtml(html`...`)`` for `insertAdjacentHTML` (a new table row).
- Writes a module makes go in Activity: call `store.audit(admin, ...)`.

**Replacing an old admin:**
- Move the old endpoint file into `functions/admin/_lib/`, drop its own
  login, export its router, and return it from `moduleFallback`. Every old
  route keeps working behind the kit's sign-in, unchanged, and its writes
  land in Activity. Rebuild the old tabs as kit views over those same
  routes; don't rewrite the server side in the same change. Exception: an
  old API small enough to port whole (say, one GET and five ops)
  becomes module routes straight away, with checks for each; delete the
  old endpoint, its gate and its test in the same commit.
- Keys the site's own functions read straight from the dashboard go in
  `dashboardKeys`, so Setup checks them but won't store a copy the site
  would never read. The kit sends email from `ADMIN_FROM`, else the site's
  existing `CONTACT_FROM`.
- Carry every feature across or name the one you drop. Production keeps the
  old admin until the new one ships, so do the production database and
  secret first (the site's ADMIN.md), then merge, then sign in and check
  every tab against live data straight away, with the previous commit ready
  to revert.

### 4. Verify
- The site's own checks pass: `<site>.mjs` next to `harness.mjs` (e.g.
  `tools/admin/test/<site>.mjs`).
  Register the site's endpoints with `siteRoutes['/api/contact'] = await
  import(...)`, fake KV or outside services in the file, and check sign-in,
  every old route through the fallback, the Inbox copy, Setup cards and
  Analytics. On a Supabase site the harness runs the admin's real SQL on
  PGlite (`npm i -g @electric-sql/pglite`); the site's own tables go in the
  same PGlite with a small PostgREST stand-in set through
  `setSupabaseRest()`, so its
  module queries run for real too. Check the 1,000-row cap on any list.
- A `<site>-preview.mjs` that fills every tab with made-up data and then
  imports `serve.mjs`, so the admin can be looked at with no Cloudflare.
- Setup shows every service the site uses, each with the right status.
  Read each (i) as the site owner would: could they follow it alone?
- Run the preview and look at every tab with playwright-cli at
  1440x900 and 390x844: no horizontal scroll, every tab loads, empty states
  read well, console clean.
- Signed out: `/admin`, `/admin/`, `/admin/api/me` and every module route
  redirect or 401. Staff can't reach owner tabs or routes.
- Submit each real form on staging and see it in the Inbox and in the
  recipient's email.
- Nothing that charges money or emails customers runs against live data
  during the build. Use Stripe test mode or stop at the confirm dialog.

### 5. Ship
- Read `references/rollout-traps.md` before writing dashboard steps or
  debugging "it's set but it doesn't work". In short: find the Pages
  project by repo or domain (its name can differ from its address); Preview
  and Production are separate lists; a key only reaches deployments started
  after it was saved; only hand out the branch or production address,
  never a deployment's own `<hash>.pages.dev` link; check Activity in the
  store to see what a button press answered.
- Staging or a preview branch first; production on the user's word. Follow
  the site's own way of getting there (some repos cherry-pick onto a
  `staging` branch whose history differs from `main`).
- Write the site's `ADMIN.md` (in the same hidden folder): where things
  are, and the numbered dashboard steps to switch it on per environment
  (create the D1 database, run the migrations, bind `ADMIN_DB`, set
  `ADMIN_COOKIE_SECRET`, redeploy, make the owners). Previews get their own
  database and secret, never the live ones, except where the site itself has
  one database for both (e.g. a single Supabase project): then preview
  and production share the admin's accounts and saved keys, so give both the
  same `ADMIN_COOKIE_SECRET` (a different one makes saved keys unreadable on
  one side) and say so in ADMIN.md.
- Handover: the link, who the first owner is and how they get their
  password, the secrets still to set, what moved from the old admin, and
  any module left for later.
- Update the site's project memory.

## Files

| Path | What |
|---|---|
| `kit/functions/admin/_lib/auth.js` | Hashing, cookie, session check, throttle, temp passwords |
| `kit/functions/admin/_lib/store.js` | `openStore(env)`: D1, or Supabase when `adminStore` in modules.js says so |
| `kit/functions/admin/_lib/store-d1.js` | Every admin query, on D1. Other stores copy its method names |
| `kit/functions/admin/_lib/store-supabase.js` | The same methods on Supabase: one call each to `<prefix>admin(op, args)` |
| `kit/postgres/admin.sql` | The Postgres tables and that function, with a `{{p}}` prefix; `scripts/pg-schema.mjs` prints a site's copy |
| `kit/functions/admin/_lib/http.js` / `mail.js` / `pages.js` | JSON, CSV, headers; Resend; the three sign-in pages |
| `kit/functions/admin/_lib/modules.js` | The site's server half: nav, routes, Overview numbers, fallback for an old admin, settings keys, Setup services, Stripe webhook path, dashboard-only keys, store, core tabs left out, site name and logo |
| `kit/functions/admin/_lib/integrations.js` | Setup: each service's what/needs/steps, live check and actions (Create the webhook, Send a test) |
| `kit/functions/admin/_lib/secrets.js` | Encrypting keys saved on Setup; dashboard values win |
| `kit/functions/admin/_middleware.js` | The gate in front of everything under /admin |
| `kit/functions/admin/login.js`, `forgot.js`, `reset.js` | Sign-in, forgot password, reset link |
| `kit/functions/admin/api/[[path]].js` | The API router and the core routes |
| `kit/functions/api/form.js`, `track.js` | The site's one form endpoint and its page-view counter |
| `kit/admin/index.html`, `admin.css`, `admin.js` | The page shell and core views (the same on every site) |
| `kit/admin/kit.js` | Helpers for views: `html`, `raw`, `esc`, `api`, `heading`, `info`, `HELP`, `table`, `stats`, `seg`, `barChart`, `hbars`, `monthGrid`, `statusPill`, `confirmAction`, `copyText`, `downloadCsv` |
| `kit/admin/modules.js` | The site's page half: its tabs (`MODULE_VIEWS`) and their (i) text |
| `kit/admin/theme.css` | The site's look: tokens only, from its own stylesheet |
| `kit/migrations/*.sql` | Admin, inbox, analytics and saved-key tables (D1) |
| `kit/scripts/admin-user.mjs` | First owner, or recovering a locked-out one (D1 or Postgres SQL) |
| `kit/scripts/pg-schema.mjs` | Prints `postgres/admin.sql` with the site's prefix, for a Supabase site |
| `kit/test/run.mjs` | The kit's own 66 checks (outside services faked), on D1, or Postgres with `ADMIN_TEST_STORE=supabase`. Stays in the kit |
| `kit/test/harness.mjs`, `serve.mjs` | Pages on plain Node (D1 on node:sqlite or Supabase on PGlite, `siteRoutes` for a site's endpoints, `setSupabaseRest` for its PostgREST reads, `q` for SQL on either) and a local preview; copied into each site for its own checks |
| `references/security.md` | The sign-in rules and why, plus traps |
| `references/modules.md` | Every module: when to include it, data, routes, view, checks |
| `references/stores.md` | KV, Supabase/Postgres and Next.js adapters |
| `references/rollout-traps.md` | Switching an admin on in the hosting dashboard: what went wrong before, and how to debug without signing in |
