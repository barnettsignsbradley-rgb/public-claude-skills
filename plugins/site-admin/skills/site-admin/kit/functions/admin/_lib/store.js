/**
 * Opens the admin store this site uses: D1 unless the server modules.js
 * says adminStore = { kind: 'supabase', prefix, url }. Everything in the kit
 * opens the store through here, never through store-d1.js directly.
 * ADMIN_STORE (env) overrides the kind, for the kit's own checks.
 */
import { d1Store } from './store-d1.js';
import { supabaseStore } from './store-supabase.js';
import { adminStore } from './modules.js';

export function openStore(env) {
  const kind = env.ADMIN_STORE || adminStore?.kind || 'd1';
  return kind === 'supabase' ? supabaseStore(env, adminStore || {}) : d1Store(env);
}
