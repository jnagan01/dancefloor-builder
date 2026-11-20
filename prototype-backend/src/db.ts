import { createClient } from '@supabase/supabase-js';
export const PROJECT = 'nkjkhaplypqcsvvtlinz';
export const PROJECT_URL = `https://${PROJECT}.supabase.co`;
let admin: ReturnType<typeof createClient>;
export function adminClient() {
  if (process.env.SUPABASE_URL !== PROJECT_URL || process.env.APP_ENV !== 'prototype-test') throw Error('Dedicated test project required.');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw Error('Test database secret is not configured.');
  return admin ??= createClient(PROJECT_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createClient>, { get: (_target, property) => Reflect.get(adminClient(), property) });
export function userClient(token: string) {
  if (!process.env.SUPABASE_PUBLISHABLE_KEY) throw Error('Test public key missing.');
  return createClient(PROJECT_URL, process.env.SUPABASE_PUBLISHABLE_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { autoRefreshToken: false, persistSession: false } });
}
