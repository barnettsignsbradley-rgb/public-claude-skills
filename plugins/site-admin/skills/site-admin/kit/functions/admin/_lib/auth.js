/**
 * Admin sign-in for every site, the same way everywhere (site-admin kit).
 *
 * - Each admin is a row: email, role (owner | staff), PBKDF2-SHA256 hash.
 * - A sign-in sets one cookie, HMAC-signed with ADMIN_COOKIE_SECRET. It
 *   carries the admin's id, role, expiry and a fingerprint of their hash, so
 *   a password change signs that admin out everywhere.
 * - No ADMIN_COOKIE_SECRET, no entry: the gate fails closed.
 * - Wrong guesses are counted per IP and overall (see throttled()).
 *
 * Runs on Cloudflare Workers / Pages Functions and on Node 20+ (Web Crypto).
 * Workers refuses PBKDF2 above 100,000 iterations, so that is the count.
 */

export const COOKIE = 'site_admin';
export const SESSION_DAYS = 7;
export const ITERATIONS = 100000;
export const MIN_PASSWORD = 10;

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

export async function sha256(s) {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

/* Compare in time that does not depend on where the strings differ. */
export function same(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/* "pbkdf2$100000$<salt>$<hash>", the format every site stores. */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iter, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2' || !hash || !password) return false;
  return same(b64(await pbkdf2(String(password), unb64(salt), Number(iter))), hash);
}

export function passwordProblem(password) {
  if (String(password || '').length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  return '';
}

/* Readable one-off password for resets: 4 groups of 4, no look-alikes. */
export function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const s = [...bytes].map((b) => chars[b % chars.length]).join('');
  return s.match(/.{4}/g).join('-');
}

/* Random url-safe token, for reset links. Store only its sha256. */
export function randomToken() {
  return b64(crypto.getRandomValues(new Uint8Array(24)));
}

function secret(env) {
  return (env && env.ADMIN_COOKIE_SECRET) || '';
}

const fingerprint = async (hash) => (await sha256('admin-pw:' + hash)).slice(0, 12);

export async function makeCookie(env, admin, now = Date.now()) {
  const key = secret(env);
  if (!key) throw new Error('ADMIN_COOKIE_SECRET is not set');
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  const body = [admin.id, admin.role, exp, await fingerprint(admin.password_hash)].join('.');
  return `${COOKIE}=${body}.${await hmac(key, body)}; Path=/admin; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function readCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

/**
 * The signed-in admin, or null. Re-reads the row so a disabled admin or a
 * changed password ends the session at once. `store.adminById(id)`.
 */
export async function currentAdmin(request, env, store, now = Date.now()) {
  const key = secret(env);
  if (!key) return null;
  const parts = readCookie(request, COOKIE).split('.');
  if (parts.length !== 5) return null;
  const [id, role, exp, fp, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < now) return null;
  if (!same(sig, await hmac(key, [id, role, exp, fp].join('.')))) return null;
  const admin = await store.adminById(id);
  if (!admin || admin.disabled) return null;
  if (!same(fp, await fingerprint(admin.password_hash))) return null;
  return { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
}

export const LIMITS = { perIp: 5, overall: 20, windowMin: 15 };

/* True when this IP, or everyone together, has guessed wrong too often. */
export async function throttled(store, ip, now = Date.now()) {
  const since = now - LIMITS.windowMin * 60000;
  const { ip: mine, all } = await store.failedLogins(ip, since);
  return mine >= LIMITS.perIp || all >= LIMITS.overall;
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0].trim() || 'unknown';
}
