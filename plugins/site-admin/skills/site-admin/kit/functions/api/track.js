/**
 * Page views from /hub-track.js, stored in
 * this site's own site_events table so /admin can chart them. When HUB_URL
 * and HUB_SITE_KEY are set it also forwards to a cross-site hub, unchanged.
 * Always answers 204 so tracking can never break or slow a page.
 */
import { openStore } from '../admin/_lib/store.js';

const BOT = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|pingdom|uptime/i;
const cut = (v, n) => (v == null ? null : String(v).slice(0, n));

export async function onRequestPost({ request, env, waitUntil }) {
  const done = new Response(null, { status: 204 });
  if (BOT.test(request.headers.get('User-Agent') || '')) return done;
  let b;
  try { b = await request.json(); } catch { return done; }
  if (!b || !b.visitor_id || !b.type) return done;
  const cf = request.cf || {};
  const row = {
    visitor_id: cut(b.visitor_id, 64), type: cut(b.type, 40), path: cut(b.path, 300), referrer: cut(b.referrer, 200),
    utm_source: cut(b.utm_source, 100), utm_medium: cut(b.utm_medium, 100), utm_campaign: cut(b.utm_campaign, 100),
    country: cf.country || null, region: cf.region || null, city: cf.city || null, device: cut(b.device, 20),
  };

  let store = null;
  try { store = openStore(env); } catch { /* no admin store on this deployment: forward only */ }
  if (store) waitUntil(store.addEvent(row).catch(() => {}));
  if (env.HUB_URL && env.HUB_SITE_KEY) {
    waitUntil(fetch(env.HUB_URL.replace(/\/$/, '') + '/api/ingest/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Site-Id': env.HUB_SITE_ID, 'X-Site-Key': env.HUB_SITE_KEY },
      body: JSON.stringify(row),
    }).catch(() => {}));
  }
  return done;
}
