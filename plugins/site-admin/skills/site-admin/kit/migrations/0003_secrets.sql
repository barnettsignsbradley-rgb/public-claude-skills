-- site-admin kit: keys pasted on the Setup tab, AES-GCM encrypted (functions/admin/_lib/secrets.js).
CREATE TABLE IF NOT EXISTS admin_secrets (
  name       TEXT PRIMARY KEY,                -- the env name, e.g. STRIPE_SECRET_KEY
  ciphertext TEXT NOT NULL,
  iv         TEXT NOT NULL,
  hint       TEXT NOT NULL,                   -- what the page may show: sk_live_…4f2a
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);
