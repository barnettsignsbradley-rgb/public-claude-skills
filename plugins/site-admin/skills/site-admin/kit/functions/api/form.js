/**
 * One endpoint for every form on the site: POST /api/form (JSON or form-encoded).
 *   form       which form ('contact', 'speaking' ...), required
 *   email, name, message   the usual fields; anything else is kept in `fields`
 *   website    honeypot: must stay empty
 *   cf-turnstile-response  checked when Turnstile is set up (see Setup)
 *   visitor_id from /hub-track.js, so the message links to its visits
 *
 * Stores first, then emails the recipients set in /admin → Settings
 * (falls back to CONTACT_TO). A failed email never loses a message.
 */
import { sendMail, siteName } from '../admin/_lib/mail.js';
import { sha256 } from '../admin/_lib/auth.js';
import { openStore } from '../admin/_lib/store.js';
import { withStoredSecrets } from '../admin/_lib/secrets.js';

const MAX_PER_HOUR = 5;

const reply = (ok, error, status = 200) =>
  new Response(JSON.stringify(ok ? { ok: true } : { ok: false, error }), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost({ request, env: rawEnv, waitUntil }) {
  let store;
  try { store = openStore(rawEnv); } catch { return reply(false, 'Form storage is not set up', 503); }
  const env = rawEnv.ADMIN_COOKIE_SECRET ? await withStoredSecrets(rawEnv, store) : rawEnv; // keys saved on the Setup tab

  let body;
  const type = request.headers.get('Content-Type') || '';
  try { body = type.includes('json') ? await request.json() : Object.fromEntries(await request.formData()); } catch { return reply(false, 'Bad request', 400); }

  const { form, email, name, message, website, visitor_id, 'cf-turnstile-response': turnstile, ...rest } = body;
  if (website) return reply(true);                                  // bot filled the honeypot: pretend it worked
  if (!form || !/^[a-z0-9_-]{1,40}$/i.test(form)) return reply(false, 'Unknown form', 400);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(false, 'Check the email address', 400);

  // Checked when the page shows the widget, and on every post once Setup says "require it".
  if (env.TURNSTILE_SECRET_KEY && (turnstile !== undefined || env.TURNSTILE_REQUIRED === 'yes')) {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: turnstile || '' }),
    }).then((x) => x.json()).catch(() => ({ success: false }));
    if (!r.success) return reply(false, 'Please try again', 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ip_hash = (await sha256((env.IP_HASH_SALT || 'site') + ip)).slice(0, 16);
  if ((await store.formsFromIp(ip_hash, Date.now() - 3600000)) >= MAX_PER_HOUR) return reply(false, 'Too many messages. Try again later.', 429);

  const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
  const id = await store.addForm({ form, email: clip(email, 200), name: clip(name, 200), message: clip(message, 5000),
    fields: JSON.stringify(rest).slice(0, 5000), page: clip(request.headers.get('Referer'), 300), visitor_id: clip(visitor_id, 64), ip_hash });

  waitUntil((async () => {
    const map = (await store.getSettings()).form_recipients || {};             // { contact: ['a@x'], '*': ['b@x'] }
    const to = map[form] || map['*'] || (env.CONTACT_TO ? env.CONTACT_TO.split(',') : []);
    let sent = false;
    for (const addr of to) {
      sent = (await sendMail(env, {
        to: addr.trim(),
        subject: `New ${form} message on ${siteName(env)}${name ? ' from ' + name : ''}`,
        text: [name && `Name: ${name}`, email && `Email: ${email}`, message && `\n${message}`,
          Object.keys(rest).length ? '\n' + Object.entries(rest).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
          `\nMark it responded: ${new URL('/admin/#inbox', request.url)}`].filter(Boolean).join('\n'),
      })) || sent;
    }
    if (sent) await store.markEmailed(id);
  })().catch(() => {}));

  return reply(true);
}
