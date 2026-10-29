#!/usr/bin/env node
/**
 * Preview the admin locally with sample data, no Cloudflare needed:
 *   node test/serve.mjs [port]      → http://localhost:8790/admin
 * Signs in as demo@example.com / demo-password-1 (an owner). Data lives in
 * memory and is gone when it stops. Static files come from the kit folder
 * (or the site root, when the kit was copied into a site).
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { store, auth, dispatch, env, root } from './harness.mjs';

if (!env.keepSiteIntegrations) env.ADMIN_INTEGRATIONS = 'admin,email,stripe,mailerlite,turnstile,tracking'; // every kit Setup card, unless a site preview wants its own list
const port = Number(process.argv[2]) || 8790;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

// ---------- sample data ----------
// Through the store's own methods, so the same sample data fills D1 or Postgres.
await store.createAdmin({ email: 'demo@example.com', name: 'Demo Owner', role: 'owner', password_hash: await auth.hashPassword('demo-password-1') });
await store.createAdmin({ email: 'helper@example.com', name: 'Hal Helper', role: 'staff', password_hash: await auth.hashPassword('demo-password-2') });
const pages = ['/', '/', '/', '/about', '/pricing', '/contact', '/blog/first-post'];
const refs = [null, null, 'google.com', 'instagram.com', 'facebook.com', null];
const devices = ['desktop', 'mobile', 'mobile', 'tablet'];
for (let d = 0; d < 60; d++) {
  const visitors = 8 + Math.round(6 * Math.sin(d / 4) + Math.random() * 6);
  for (let v = 0; v < visitors; v++) {
    const id = `v${d}-${v}`, ts = Date.now() - d * 86400000 - Math.random() * 80000000;
    for (let p = 0; p < 1 + (v % 3); p++) await store.addEvent({ visitor_id: id, type: 'pageview', path: pages[(v + p) % pages.length], referrer: refs[v % refs.length], device: devices[v % devices.length], country: v % 5 ? 'US' : 'CA' }, ts + p * 1000);
  }
}
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const msg = async (row, status, responded) => {
  const id = await store.addForm(row);
  await store.markEmailed(id);
  if (status !== 'new') await store.inboxUpdate(id, { status, responded_by: responded, responded_at: ago(24) });
};
await msg({ form: 'contact', name: 'Maria Lopez', email: 'maria@example.com', message: 'Do you offer group sessions in the spring? We have six people interested.', fields: '{"phone":"555-0142"}', created_at: ago(2) }, 'new');
await msg({ form: 'speaking', name: 'Grace Church', email: 'events@example.org', message: 'We would love to book you for our women’s retreat on April 12.', fields: '{"date":"2027-04-12","audience":"120"}', created_at: ago(24) }, 'new');
await msg({ form: 'contact', name: 'Tom Reed', email: 'tom@example.com', message: 'Is the workbook available as a PDF?', fields: '{}', created_at: ago(72) }, 'responded', 'Demo Owner');
await store.setSetting('form_recipients', { '*': ['owner@example.com'], speaking: ['events@example.com'] });

async function staticFile(pathname) {
  let p = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
  if (!extname(p)) p += '/index.html';
  const file = normalize(join(root, p));
  if (!file.startsWith(root)) return new Response('Not found', { status: 404 });
  try { return new Response(await readFile(file), { headers: { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' } }); }
  catch { return new Response('Not found', { status: 404 }); }
}

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  let pathname = req.url.split('?')[0];
  if (pathname === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
  const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: { ...req.headers, 'CF-Connecting-IP': '127.0.0.1' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  const out = await dispatch(request, env, staticFile);
  const headers = {};
  out.headers.forEach((v, k) => (headers[k] = k === 'set-cookie' ? v.replace(/; Secure/i, '') : v)); // plain http on localhost
  res.writeHead(out.status, headers);
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(port, () => console.log(`Admin preview: http://localhost:${port}/admin  (demo@example.com / demo-password-1)`));
