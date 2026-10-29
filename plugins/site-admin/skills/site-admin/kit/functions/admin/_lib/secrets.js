/**
 * Keys an owner pastes into Setup (Stripe, Resend, MailerLite ...), stored
 * encrypted in the admin store so a site can be set up without the hosting
 * dashboard. AES-GCM, key derived from ADMIN_SECRETS_KEY, or from
 * ADMIN_COOKIE_SECRET when that isn't set: rotating that secret means
 * pasting the keys again (Setup says so).
 *
 * A value set in the hosting dashboard always wins over a stored one, and
 * Setup shows it as "set in the dashboard". The browser never gets a stored
 * value back, only a hint (sk_live_…4f2a).
 */
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(env) {
  const material = env.ADMIN_SECRETS_KEY || env.ADMIN_COOKIE_SECRET;
  if (!material) throw new Error('ADMIN_COOKIE_SECRET is not set');
  const hash = await crypto.subtle.digest('SHA-256', enc.encode('site-admin-secrets:' + material));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), enc.encode(plain));
  return { ciphertext: b64(ct), iv: b64(iv) };
}

export async function decrypt(env, { ciphertext, iv }) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(env), unb64(ciphertext));
  return dec.decode(pt);
}

/* What the browser may see of a value. Secrets show their start and last 4. */
export function hint(value, secret) {
  const v = String(value);
  if (!secret) return v;
  if (v.length <= 10) return '•'.repeat(v.length);
  const prefix = (v.match(/^[a-z]+_(live|test)_|^[a-z]+_/i) || [''])[0];
  return `${prefix}…${v.slice(-4)}`;
}

/**
 * env with stored values filled in where the dashboard has none. Values that
 * no longer decrypt (the key changed) are skipped and reported in `broken`.
 */
export async function withStoredSecrets(env, store) {
  const rows = await store.listSecrets();
  const merged = { ...env };
  const stored = {};
  const broken = [];
  for (const row of rows) {
    if (env[row.name]) continue;
    try { merged[row.name] = await decrypt(env, row); stored[row.name] = true; } catch { broken.push(row.name); }
  }
  merged.__stored = stored;
  merged.__broken = broken;
  return merged;
}
