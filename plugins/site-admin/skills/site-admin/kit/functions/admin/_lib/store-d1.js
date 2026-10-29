/**
 * The admin store on D1 (binding ADMIN_DB, or DB when the site has one).
 * Sites on KV, Supabase or Prisma implement the same methods; see
 * references/stores.md (store-supabase.js is the Postgres one). Nothing
 * outside the two store files touches the admin's tables: the API router,
 * /api/form and /api/track all go through these methods.
 */

export function d1Store(env) {
  const db = env.ADMIN_DB || env.DB;
  if (!db) throw new Error('No D1 binding: bind ADMIN_DB (or DB) on the Pages project');
  const one = (sql, ...args) => db.prepare(sql).bind(...args).first();
  const all = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  const run = (sql, ...args) => db.prepare(sql).bind(...args).run();

  return {
    adminById: (id) => one('SELECT * FROM admin_users WHERE id = ?', Number(id)),
    adminByEmail: (email) => one('SELECT * FROM admin_users WHERE email = ?', String(email).trim()),
    listAdmins: () => all('SELECT id, email, name, role, must_change, disabled, created_at, last_login_at FROM admin_users ORDER BY role DESC, email'),
    countOwners: async () => (await one("SELECT COUNT(*) n FROM admin_users WHERE role = 'owner' AND disabled = 0")).n,
    createAdmin: ({ email, name, role, password_hash, must_change }) =>
      run('INSERT INTO admin_users (email, name, role, password_hash, must_change) VALUES (?, ?, ?, ?, ?)',
        String(email).trim(), name || '', role, password_hash, must_change ? 1 : 0),
    updateAdmin: (id, fields) => {
      const keys = Object.keys(fields).filter((k) => ['name', 'role', 'password_hash', 'must_change', 'disabled', 'last_login_at'].includes(k));
      if (!keys.length) return null;
      return run(`UPDATE admin_users SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map((k) => fields[k]), Number(id));
    },

    failedLogins: async (ip, since) => {
      const r = await one('SELECT SUM(ip = ?) mine, COUNT(*) total FROM admin_login_attempts WHERE ok = 0 AND ts > ?', ip, since);
      return { ip: r.mine || 0, all: r.total || 0 };
    },
    logLogin: async (ip, ok) => {
      await run('INSERT INTO admin_login_attempts (ip, ok, ts) VALUES (?, ?, ?)', ip, ok ? 1 : 0, Date.now());
      await run('DELETE FROM admin_login_attempts WHERE ts < ?', Date.now() - 7 * 86400000);
    },

    saveResetToken: (token_hash, admin_id, expires) =>
      run('INSERT INTO admin_reset_tokens (token_hash, admin_id, expires) VALUES (?, ?, ?)', token_hash, admin_id, expires),
    takeResetToken: async (token_hash) => {
      const row = await one('SELECT * FROM admin_reset_tokens WHERE token_hash = ? AND used = 0 AND expires > ?', token_hash, Date.now());
      if (row) await run('UPDATE admin_reset_tokens SET used = 1 WHERE token_hash = ?', token_hash);
      return row;
    },

    audit: (admin, action, target, detail) =>
      run('INSERT INTO admin_audit (admin_id, email, action, target, detail) VALUES (?, ?, ?, ?, ?)',
        admin?.id ?? null, admin?.email ?? null, action, target ?? null, detail ? JSON.stringify(detail) : null),
    listAudit: (limit = 200) => all('SELECT * FROM admin_audit ORDER BY id DESC LIMIT ?', limit),

    getSettings: async () => Object.fromEntries((await all('SELECT key, value FROM admin_settings')).map((r) => [r.key, JSON.parse(r.value)])),
    setSetting: (key, value, by) =>
      run(`INSERT INTO admin_settings (key, value, updated_by) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), updated_by = excluded.updated_by`,
        key, JSON.stringify(value), by || null),

    listSecrets: () => all('SELECT name, ciphertext, iv, hint, updated_at, updated_by FROM admin_secrets'),
    putSecret: (name, { ciphertext, iv }, hint, by) =>
      run(`INSERT INTO admin_secrets (name, ciphertext, iv, hint, updated_by) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, hint = excluded.hint,
           updated_at = datetime('now'), updated_by = excluded.updated_by`, name, ciphertext, iv, hint, by || null),
    deleteSecret: (name) => run('DELETE FROM admin_secrets WHERE name = ?', name),

    // ---------- Inbox ----------
    inboxList: (status, limit = 500) => {
      const where = status === 'open' ? "status = 'new'" : status === 'all' ? '1=1' : 'status = ?';
      return all(`SELECT * FROM form_submissions WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`, ...(status === 'open' || status === 'all' ? [] : [status]), limit);
    },
    inboxCounts: async () => Object.fromEntries((await all('SELECT status, COUNT(*) n FROM form_submissions GROUP BY status')).map((c) => [c.status, c.n])),
    inboxUpdate: async (id, { status, responded_by, responded_at, note }) => {
      if (status) await run('UPDATE form_submissions SET status = ?, responded_by = ?, responded_at = ? WHERE id = ?', status, responded_by ?? null, responded_at ?? null, Number(id));
      if (note !== undefined) await run('UPDATE form_submissions SET note = ? WHERE id = ?', note, Number(id));
    },
    // created_at is optional (previews seed older messages); it defaults to now.
    addForm: async (row) => {
      const r = await run(`INSERT INTO form_submissions (form, email, name, message, fields, page, visitor_id, ip_hash, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`, row.form, row.email ?? null, row.name ?? null, row.message ?? null,
        row.fields ?? null, row.page ?? null, row.visitor_id ?? null, row.ip_hash ?? null, row.status || 'new',
        row.created_at ? new Date(row.created_at).toISOString().slice(0, 19).replace('T', ' ') : null);
      return r.meta.last_row_id;
    },
    formsFromIp: async (ip_hash, sinceMs) => (await one("SELECT COUNT(*) n FROM form_submissions WHERE ip_hash = ? AND created_at > datetime(? / 1000, 'unixepoch')", ip_hash, sinceMs)).n,
    markEmailed: (id) => run('UPDATE form_submissions SET emailed = 1 WHERE id = ?', Number(id)),

    // ---------- Analytics ----------
    addEvent: (row, ts = Date.now()) =>
      run(`INSERT INTO site_events (visitor_id, type, path, referrer, utm_source, utm_medium, utm_campaign, country, region, city, device, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, row.visitor_id, row.type, row.path ?? null, row.referrer ?? null, row.utm_source ?? null,
        row.utm_medium ?? null, row.utm_campaign ?? null, row.country ?? null, row.region ?? null, row.city ?? null, row.device ?? null, ts),
    lastEventTs: async () => (await one('SELECT MAX(ts) ts FROM site_events'))?.ts || null,
    analytics: async (since) => {
      const q = (sql) => all(sql, since);
      const pv = "type = 'pageview' AND ts > ?";
      const [daily, pages, refs, devices, countries, totals, forms] = await Promise.all([
        q(`SELECT date(ts / 1000, 'unixepoch') day, COUNT(DISTINCT visitor_id) visitors, COUNT(*) views FROM site_events WHERE ${pv} GROUP BY day ORDER BY day`),
        q(`SELECT path label, COUNT(*) n FROM site_events WHERE ${pv} GROUP BY path ORDER BY n DESC LIMIT 10`),
        q(`SELECT COALESCE(referrer, 'Direct') label, COUNT(DISTINCT visitor_id) n FROM site_events WHERE ${pv} GROUP BY label ORDER BY n DESC LIMIT 10`),
        q(`SELECT COALESCE(device, 'unknown') label, COUNT(DISTINCT visitor_id) n FROM site_events WHERE ${pv} GROUP BY label ORDER BY n DESC`),
        q(`SELECT COALESCE(country, '?') label, COUNT(DISTINCT visitor_id) n FROM site_events WHERE ${pv} GROUP BY label ORDER BY n DESC LIMIT 10`),
        q(`SELECT COUNT(DISTINCT visitor_id) visitors, COUNT(*) views FROM site_events WHERE ${pv}`),
        q("SELECT COUNT(*) n FROM form_submissions WHERE created_at > datetime(? / 1000, 'unixepoch')"),
      ]);
      return { daily, pages, refs, devices, countries, visitors: totals[0]?.visitors || 0, views: totals[0]?.views || 0, forms: forms[0].n };
    },
    overview: async (since) => ({
      visitors7: (await one("SELECT COUNT(DISTINCT visitor_id) n FROM site_events WHERE type = 'pageview' AND ts > ?", since)).n,
      openMessages: (await one("SELECT COUNT(*) n FROM form_submissions WHERE status = 'new'")).n,
      latest: await all('SELECT id, form, name, email, created_at, status FROM form_submissions ORDER BY created_at DESC, id DESC LIMIT 5'),
    }),

    // A site's own D1 queries (modules) can use the binding directly. On
    // Supabase there is no `db`: modules call PostgREST themselves.
    db,
  };
}
