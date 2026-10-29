/**
 * This site's own admin modules. The kit's core (Overview, Analytics, Inbox,
 * Admins, Settings, Activity) is always there; add the rest from
 * references/modules.md as the site needs them.
 *
 * moduleRoutes: [method, pattern, handler, role?] — same shape as the core
 *   routes in api/[[path]].js. Handlers get { request, env, url, body,
 *   params, admin, store, ctx } and return a Response (use json/fail/csv).
 * moduleOverview(ctx): extra Overview numbers, [{ value, label }]. Keep it cheap.
 * moduleFallback(ctx): optional. Called for any /admin/api route nobody
 *   matched, so an old admin's endpoints keep working while a site moves
 *   onto the kit. Return a Response, or null for 404. Writes through it are
 *   logged in Activity like any other.
 * moduleIntegrations: extra Setup cards for services only this site uses,
 *   same shape as integrations.js. List their ids in `integrations`.
 * moduleSettings: extra admin_settings keys an owner may change (e.g.
 *   'signup_open'). Anything not listed is refused.
 * moduleNav(env): the sidebar entries for those modules, in order. Each id
 *   needs a matching view in /admin/admin.js (MODULE_VIEWS).
 *
 * Example (People):
 *   import { json } from './http.js';
 *   export const moduleRoutes = [
 *     ['GET', 'people', async ({ store }) => json({ rows: await store.people() })],
 *   ];
 *   export const moduleNav = () => [{ id: 'people', label: 'People' }];
 */
export const moduleRoutes = [];
export const moduleNav = () => [];
export const moduleSettings = [];

/* Which services this site's Setup tab shows (see integrations.js). Add
   'stripe' and 'mailerlite' when the site takes payments or uses lists. */
export const integrations = ['admin', 'email', 'tracking', 'turnstile'];

/* Where this site's Stripe webhook handler lives, and what it listens for. */
export const stripeWebhook = {
  path: '/api/stripe-webhook',
  events: ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'charge.refunded'],
};

export const moduleOverview = async () => [];
export const moduleFallback = null;
export const moduleIntegrations = {};

/* Keys this site's own functions read straight from the hosting dashboard
   (env), e.g. an older checkout or webhook. Setup won't store these, since
   the site wouldn't see them; it says to set them in the dashboard. New
   site code should read keys through withStoredSecrets() instead. */
export const dashboardKeys = [];

/* Where the admin's own tables live. D1 by default. A site on Supabase:
   { kind: 'supabase', prefix: 'site_', url: 'https://<ref>.supabase.co' },
   with the tables from postgres/admin.sql (scripts/pg-schema.mjs prints them
   with this prefix) and SUPABASE_SERVICE_ROLE_KEY in the dashboard. The
   prefix lets two sites share one Supabase project. */
export const adminStore = { kind: 'd1' };

/* Core tabs this site leaves out. Only for a site with nothing to put in
   them: no forms at all -> ['inbox'] (and 'settings' too, unless the site has
   moduleSettings). Overview then leaves out "Messages waiting". */
export const withoutCore = [];

/* The site's name on the admin, sign-in pages and admin emails (ADMIN_SITE_NAME overrides). */
export const siteLabel = 'Site';

/* The site's logo (a path on the site, e.g. '/logo.png'), shown on the sign-in pages and in the menu. */
export const siteLogo = '';
