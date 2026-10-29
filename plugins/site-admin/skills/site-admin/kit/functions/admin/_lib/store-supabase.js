/**
 * The admin store on Supabase / Postgres, for sites whose data already
 * lives there. Same methods and
 * the same return shapes as store-d1.js.
 *
 * Every method is one call to a single SQL function, <prefix>admin(op, args),
 * from postgres/admin.sql (print it with scripts/pg-schema.mjs). One function
 * keeps the 1,000-row cap, RLS and grants in one reviewed place, and lets the
 * kit's checks run the real SQL on PGlite.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY in the hosting dashboard, and the project
 * URL (SUPABASE_URL, or adminStore.url in modules.js). The service role
 * bypasses RLS, so this file runs only inside Pages Functions; the browser
 * never sees the key or the tables.
 */

export function supabaseStore(env, cfg = {}) {
  const url = String(env.SUPABASE_URL || cfg.url || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('The Supabase admin store needs SUPABASE_URL (or adminStore.url) and SUPABASE_SERVICE_ROLE_KEY');
  const fn = (cfg.prefix || '') + 'admin';

  async function call(op, args = {}) {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, args }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${fn}(${op}): HTTP ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  const num = async (op, args) => Number((await call(op, args)) || 0);

  return {
    adminById: (id) => call('adminById', { id: Number(id) }),
    adminByEmail: (email) => call('adminByEmail', { email: String(email) }),
    listAdmins: () => call('listAdmins'),
    countOwners: () => num('countOwners'),
    createAdmin: (row) => call('createAdmin', row),
    updateAdmin: (id, fields) => call('updateAdmin', { ...fields, id: Number(id) }),

    failedLogins: (ip, since) => call('failedLogins', { ip, since }),
    logLogin: (ip, ok) => call('logLogin', { ip, ok: !!ok }),
    saveResetToken: (token_hash, admin_id, expires) => call('saveResetToken', { token_hash, admin_id, expires }),
    takeResetToken: (token_hash) => call('takeResetToken', { token_hash }),

    audit: (admin, action, target, detail) =>
      call('audit', { admin_id: admin?.id ?? null, email: admin?.email ?? null, action, target: target ?? null, detail: detail ?? null }),
    listAudit: (limit = 200) => call('listAudit', { limit }),

    getSettings: () => call('getSettings'),
    setSetting: (key, value, by) => call('setSetting', { key, value, by: by || null }),

    listSecrets: () => call('listSecrets'),
    putSecret: (name, { ciphertext, iv }, hint, by) => call('putSecret', { name, ciphertext, iv, hint, by: by || null }),
    deleteSecret: (name) => call('deleteSecret', { name }),

    inboxList: (status, limit = 500) => call('inboxList', { status, limit }),
    inboxCounts: () => call('inboxCounts'),
    inboxUpdate: (id, fields) => call('inboxUpdate', { ...fields, id: Number(id) }),
    addForm: async (row) => Number(await call('addForm', row)),
    formsFromIp: (ip_hash, since) => num('formsFromIp', { ip_hash, since }),
    markEmailed: (id) => call('markEmailed', { id: Number(id) }),

    addEvent: (row, ts = Date.now()) => call('addEvent', { ...row, ts: Math.round(ts) }),
    lastEventTs: async () => Number(await call('lastEventTs')) || null,
    analytics: (since) => call('analytics', { since }),
    overview: (since) => call('overview', { since }),
  };
}
