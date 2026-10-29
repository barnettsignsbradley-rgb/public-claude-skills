#!/usr/bin/env node
/**
 * Print the admin's Postgres tables for a site on Supabase, with the site's
 * table prefix (adminStore.prefix in functions/admin/_lib/modules.js) filled in:
 *
 *   node scripts/pg-schema.mjs > docs/migrations/<date>_admin_kit.sql
 *
 * Then apply that file (Supabase SQL editor, or the Supabase MCP's
 * apply_migration). It is safe to run again: every statement is
 * "if not exists" or "create or replace". Nothing is written by this script.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const kitDir = join(dirname(fileURLToPath(import.meta.url)), '..');
let root = kitDir;
while (!existsSync(join(root, 'functions', 'admin', '_lib', 'modules.js'))) {
  if (dirname(root) === root) { console.error('Run this from inside the site: functions/admin/_lib/modules.js not found.'); process.exit(1); }
  root = dirname(root);
}
const { adminStore } = await import(pathToFileURL(join(root, 'functions', 'admin', '_lib', 'modules.js')).href);
if (adminStore?.kind !== 'supabase') {
  console.error('This site keeps its admin in D1 (adminStore in modules.js). Its tables are migrations/*.sql.');
  process.exit(1);
}
process.stdout.write(readFileSync(join(kitDir, 'postgres', 'admin.sql'), 'utf8').replaceAll('{{p}}', adminStore.prefix || ''));
