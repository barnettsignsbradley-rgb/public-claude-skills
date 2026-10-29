#!/usr/bin/env node
/**
 * Make the first owner (or recover a locked-out one) without the admin page.
 *
 *   node scripts/admin-user.mjs owner@example.com "Owner Name" [owner|staff]
 *
 * Prints a temporary password once and the SQL that stores its hash. Run the
 * SQL against the site's database, e.g.
 *   npx wrangler d1 execute <db-name> --remote --command "<the SQL>"
 * The person signs in with the temporary password and is made to choose
 * their own. Nothing is written anywhere by this script.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, 'functions', 'admin', '_lib', 'auth.js'))) {
  if (dirname(root) === root) { console.error('Run this from inside the site: functions/admin/_lib/auth.js not found.'); process.exit(1); }
  root = dirname(root);
}
const { hashPassword, tempPassword } = await import(pathToFileURL(join(root, 'functions', 'admin', '_lib', 'auth.js')).href);

const [email, name = '', role = 'owner'] = process.argv.slice(2);
if (!email || !email.includes('@') || !['owner', 'staff'].includes(role)) {
  console.error('Usage: node scripts/admin-user.mjs <email> ["Name"] [owner|staff]');
  process.exit(1);
}
const temp = tempPassword();
const hash = await hashPassword(temp);
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const { adminStore } = await import(pathToFileURL(join(root, 'functions', 'admin', '_lib', 'modules.js')).href);

console.log(`Temporary password for ${email}: ${temp}\n`);
if (adminStore?.kind === 'supabase') {
  // Supabase: run it in the SQL editor (or the Supabase MCP's execute_sql).
  const t = (adminStore.prefix || '') + 'admin_users';
  console.log(`insert into ${t} (email, name, role, password_hash, must_change) values (${q(email.toLowerCase())}, ${q(name)}, ${q(role)}, ${q(hash)}, true)
  on conflict ((lower(email))) do update set password_hash = excluded.password_hash, must_change = true, disabled = false;`);
  process.exit(0);
}
console.log(`INSERT INTO admin_users (email, name, role, password_hash, must_change) VALUES (${q(email.toLowerCase())}, ${q(name)}, ${q(role)}, ${q(hash)}, 1)
  ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, must_change = 1, disabled = 0;`);
