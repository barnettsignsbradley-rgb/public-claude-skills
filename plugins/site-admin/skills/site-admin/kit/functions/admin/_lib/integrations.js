/**
 * Setup: every outside service a site can use, what it's for, what it
 * needs, how to get it, and a live check. The Setup tab renders this list;
 * the (i) next to each card shows `what`, `steps` and `needs`.
 *
 * Fields:
 *   name      env name the code reads (STRIPE_SECRET_KEY ...)
 *   secret    true: shown only as a hint after saving
 *   dashboardOnly  true: can't be stored from the admin (it protects the admin itself)
 *   auto      true: filled in by an action, not typed
 * check(env, ctx) → { status: 'ok' | 'missing' | 'problem', detail, facts? }
 * actions: { name: { label, confirm, owner, run(env, ctx) → { ok, message, save?: { NAME: value } } } }
 *
 * Which of these a site shows is `integrations` in modules.js.
 */
import { siteName } from './mail.js';
import { stripeWebhook, moduleIntegrations, dashboardKeys } from './modules.js';

const has = (env, ...names) => names.every((n) => env[n]);
const stripe = (env, path, { method = 'GET', form } = {}) =>
  fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
  }).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }));

export const INTEGRATIONS = {
  admin: {
    label: 'Admin sign-in',
    what: 'Signs the admin cookie and locks the keys saved on this page. Without it the admin page stays closed.',
    needs: ['A long random value called ADMIN_COOKIE_SECRET, set in the hosting dashboard.'],
    steps: [
      'Make a random value: 32 or more letters and numbers (a password manager’s generator works).',
      'Cloudflare dashboard → Workers & Pages → this project → Settings → Variables and Secrets → Add → Type “Secret”, name ADMIN_COOKIE_SECRET, paste the value. Do it for Production and, with a different value, for Preview.',
      'Redeploy (Deployments → … → Retry deployment) so the new secret is picked up.',
      'Changing it later signs everyone out and the keys saved on this Setup page have to be pasted again.',
    ],
    fields: [{ name: 'ADMIN_COOKIE_SECRET', label: 'Cookie secret', secret: true, dashboardOnly: true }],
    check: async (env) => (env.ADMIN_COOKIE_SECRET ? { status: 'ok', detail: 'Set in the hosting dashboard.' } : { status: 'missing', detail: 'Not set.' }),
  },

  email: {
    label: 'Email (Resend)',
    what: 'Sends form notifications, password resets and new-admin invites. Without it, messages still land in the Inbox but nobody is emailed.',
    needs: ['A Resend account (free up to 100 emails a day).', 'This site’s domain verified in Resend.', 'An API key with “Sending access”.', 'A from address on that domain.'],
    steps: [
      'Sign in at resend.com (or create an account with the site owner’s email).',
      'Domains → Add domain → the site’s domain. Resend shows 3 or 4 DNS records.',
      'Add those records where the domain’s DNS lives (Cloudflare: the domain → DNS → Records → Add record, copy each one exactly, proxy off). Verification usually takes a few minutes.',
      'API Keys → Create API key → Permission “Sending access”, domain = this domain → copy the key (starts with re_). It is shown once.',
      'Paste it below with a from address such as “Your Site <hello@yoursite.com>”, then Save. The check below confirms the domain is verified.',
    ],
    fields: [
      { name: 'RESEND_API_KEY', label: 'API key', secret: true, placeholder: 're_…' },
      { name: 'ADMIN_FROM', label: 'From address', placeholder: 'Site Name <hello@domain.com>' },
    ],
    check: async (env) => {
      if (!env.RESEND_API_KEY) return { status: 'missing', detail: 'No API key yet.' };
      const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
      const body = await r.json().catch(() => ({}));
      const sendingOnly = body.name === 'restricted_api_key';
      if (!r.ok && !sendingOnly) return { status: 'problem', detail: 'Resend refused the key. Make a new one under API Keys.' };
      const domains = body.data || [];
      const from = (String(env.ADMIN_FROM || env.CONTACT_FROM || '').match(/@([^>\s]+)/) || [])[1];
      if (!from) return { status: 'problem', detail: 'Key works. Add a from address on your domain.' };
      const d = domains.find((x) => from.toLowerCase().endsWith(x.name.toLowerCase()));
      if (sendingOnly) return { status: 'ok', detail: `Key works (sending-only keys can’t list domains, so ${from} isn’t confirmed: send a test).` };
      if (!d) return { status: 'problem', detail: `${from} isn’t a domain in this Resend account. Add it under Domains.` };
      if (d.status !== 'verified') return { status: 'problem', detail: `${d.name} is “${d.status}” in Resend. Add its DNS records, then press Check again.` };
      return { status: 'ok', detail: `Sending from ${env.ADMIN_FROM || env.CONTACT_FROM}; ${d.name} is verified.` };
    },
    actions: {
      test: {
        label: 'Send me a test email',
        run: async (env, { admin }) => {
          const { trySend } = await import('./mail.js');
          const r = await trySend(env, { to: admin.email, subject: `Test email from the ${siteName(env)} admin`, text: 'If you can read this, email from the admin works.' });
          return r.ok ? { ok: true, message: `Sent to ${admin.email}. Check the inbox (and spam).` } : { ok: false, message: 'Not sent. ' + r.error };
        },
      },
    },
  },

  stripe: {
    label: 'Payments (Stripe)',
    what: 'Takes payments, makes discount codes and payment links, and tells the site when someone pays so they get access.',
    needs: ['The Stripe account’s secret key (or a restricted key with the permissions listed below).', 'A webhook so Stripe tells the site about payments. The button below makes it for you.'],
    steps: [
      'Sign in at dashboard.stripe.com. If several sites share one account, use that one: every code or link this admin makes is tagged with this site’s name.',
      'Test first: switch on “Test mode” (top right) and use the test key (sk_test_…). Switch to the live key when the test purchase works.',
      'Developers → API keys → Secret key → Reveal → copy. Or Create restricted key with write access to Products, Prices, Coupons, Promotion codes, Payment links, Checkout Sessions and Webhook endpoints, and read access to Customers, Charges and Subscriptions.',
      'Paste it below and Save. The check shows the account name and whether it’s test or live.',
      'Press “Create the webhook”. It registers this site’s payment listener with Stripe and saves its signing secret here, so you don’t copy it by hand.',
    ],
    fields: [
      { name: 'STRIPE_SECRET_KEY', label: 'Secret key', secret: true, placeholder: 'sk_live_… or rk_live_…' },
      { name: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook signing secret', secret: true, auto: true },
    ],
    check: async (env, { origin }) => {
      if (!env.STRIPE_SECRET_KEY) return { status: 'missing', detail: 'No key yet.' };
      const acct = await stripe(env, 'account');
      if (!acct.ok) return { status: 'problem', detail: acct.data.error?.message || 'Stripe refused the key.' };
      const mode = /_test_/.test(env.STRIPE_SECRET_KEY) ? 'TEST mode' : 'LIVE';
      const name = acct.data.settings?.dashboard?.display_name || acct.data.business_profile?.name || acct.data.id;
      const url = origin + stripeWebhook.path;
      const hooks = await stripe(env, 'webhook_endpoints?limit=100');
      const hook = hooks.ok && hooks.data.data.find((h) => h.url === url);
      const facts = [`Account: ${name}`, `Mode: ${mode}`, `Webhook: ${hook ? hook.status : 'not created'} (${url})`];
      if (!hook) return { status: 'problem', detail: 'Key works. Create the webhook so payments reach the site.', facts };
      if (!env.STRIPE_WEBHOOK_SECRET) return { status: 'problem', detail: 'The webhook exists but its signing secret isn’t saved here. Press “Replace the webhook”.', facts };
      return { status: 'ok', detail: `${name}, ${mode}.`, facts };
    },
    actions: {
      webhook: {
        label: 'Create the webhook',
        owner: true,
        confirm: 'Create a Stripe webhook for this site? If one already exists for the same address it is replaced, and its old signing secret stops working.',
        run: async (env, { origin, admin }) => {
          if (!env.STRIPE_SECRET_KEY) return { ok: false, message: 'Save the secret key first.' };
          // A signing secret in the dashboard wins over one saved here, so replacing the
          // webhook would leave the site checking payments against the old secret.
          if (env.STRIPE_WEBHOOK_SECRET && !env.__stored?.STRIPE_WEBHOOK_SECRET) {
            return { ok: false, message: 'This site’s webhook signing secret is set in the Cloudflare dashboard, so the webhook is already set up there. Replacing it here would break payments. Leave it, or delete that dashboard secret first.' };
          }
          const url = origin + stripeWebhook.path;
          const hooks = await stripe(env, 'webhook_endpoints?limit=100');
          for (const h of (hooks.data.data || []).filter((x) => x.url === url)) await stripe(env, 'webhook_endpoints/' + h.id, { method: 'DELETE' });
          const form = { url, description: `${siteName(env)} site (made in /admin by ${admin.email})`, 'metadata[site]': siteName(env) };
          stripeWebhook.events.forEach((e, i) => (form[`enabled_events[${i}]`] = e));
          const made = await stripe(env, 'webhook_endpoints', { method: 'POST', form });
          if (!made.ok) return { ok: false, message: made.data.error?.message || 'Stripe refused.' };
          return { ok: true, message: `Webhook created for ${url}. Its signing secret is saved.`, save: { STRIPE_WEBHOOK_SECRET: made.data.secret } };
        },
      },
    },
  },

  mailerlite: {
    label: 'Email lists (MailerLite)',
    what: 'Adds people who sign up, buy or register to MailerLite groups, which start your automations.',
    needs: ['A MailerLite API token from the account this site’s lists live in.'],
    steps: [
      'Sign in at dashboard.mailerlite.com with this site’s account.',
      'Integrations → MailerLite API → Use → Generate new token → name it after this site → copy (shown once).',
      'Paste it below and Save. The check counts your groups. Connect forms, products and events to groups on the Email lists tab.',
    ],
    fields: [{ name: 'MAILERLITE_API_KEY', label: 'API token', secret: true }],
    check: async (env) => {
      if (!env.MAILERLITE_API_KEY) return { status: 'missing', detail: 'No token yet.' };
      const r = await fetch('https://connect.mailerlite.com/api/groups?limit=1', { headers: { Authorization: `Bearer ${env.MAILERLITE_API_KEY}`, Accept: 'application/json' } });
      if (!r.ok) return { status: 'problem', detail: 'MailerLite refused the token. Make a new one.' };
      const total = (await r.json()).meta?.total ?? '?';
      return { status: 'ok', detail: `Connected: ${total} group${total === 1 ? '' : 's'}.` };
    },
  },

  turnstile: {
    label: 'Spam protection (Turnstile)',
    optional: true,
    what: 'Stops bots sending forms, without puzzles for real people. Optional: forms also have a hidden honeypot and a 5-an-hour limit.',
    needs: ['A Turnstile widget for this domain in Cloudflare (free): a site key for the page and a secret key for the check.'],
    steps: [
      'Cloudflare dashboard → Turnstile → Add widget → name it after the site, add the domain (and the pages.dev address for previews), mode “Managed”.',
      'Copy the Site key and the Secret key.',
      'Paste both below and Save.',
      'Put the widget on the forms: ask Claude to “add Turnstile to the forms” (the site key goes in the page; it isn’t secret). From then on, any form that shows the widget is checked.',
      'Once every form shows it, tick “Require it on every form” and Save, so bots that post straight to the site without the page are refused too.',
    ],
    fields: [
      { name: 'TURNSTILE_SITE_KEY', label: 'Site key', placeholder: '0x4AAA…' },
      { name: 'TURNSTILE_SECRET_KEY', label: 'Secret key', secret: true },
      { name: 'TURNSTILE_REQUIRED', label: 'Require it on every form', toggle: true },
    ],
    check: async (env) => {
      if (!env.TURNSTILE_SECRET_KEY) return { status: 'missing', detail: 'Off. Forms rely on the honeypot and rate limit.' };
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: 'setup-check' }) }).then((x) => x.json()).catch(() => ({}));
      const codes = r['error-codes'] || [];
      if (codes.includes('invalid-input-secret')) return { status: 'problem', detail: 'Cloudflare says the secret key is wrong.' };
      return { status: 'ok', detail: env.TURNSTILE_REQUIRED === 'yes' ? 'Checked on every form.' : 'Checked on forms that show the widget.' };
    },
  },

  tracking: {
    label: 'Visitor tracking',
    what: 'Counts visits for the Analytics tab. No cookies; nothing leaves the site.',
    needs: ['The tracker script on every page: <script src="/hub-track.js" defer data-consent="off"></script>', 'The file /hub-track.js (a small page-view script that posts to /api/track) and /api/track (in the kit).'],
    steps: [
      'Ask Claude to “add the site-admin tracker to every page”. It copies hub-track.js and adds the script tag.',
      'Open the site in a normal browser window, then press Check here: the last visit should be seconds ago.',
      'Ad blockers and “Do not track” browsers aren’t counted, so numbers run a little low.',
    ],
    fields: [],
    check: async (env, { store }) => {
      const last = await store.lastEventTs();
      if (!last) return { status: 'missing', detail: 'No visits recorded yet.' };
      const ago = Math.round((Date.now() - last) / 3600000);
      return ago > 72 ? { status: 'problem', detail: `Last visit was ${Math.round(ago / 24)} days ago. Is the script still on the pages?` }
        : { status: 'ok', detail: `Last visit ${ago < 1 ? 'within the hour' : ago === 1 ? 'an hour ago' : ago + ' hours ago'}.` };
    },
  },
};

Object.assign(INTEGRATIONS, moduleIntegrations);

/* Every env name the Setup page may store. Anything else is refused. */
export const storableNames = (ids) =>
  ids.flatMap((id) => (INTEGRATIONS[id]?.fields || []).filter((f) => !f.dashboardOnly && !dashboardKeys.includes(f.name)).map((f) => f.name));
