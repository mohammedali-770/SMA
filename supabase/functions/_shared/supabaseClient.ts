import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * SERVER-SIDE ONLY service-role client. Bypasses RLS — used by webhooks / sync
 * workers to call the service-role-only RPCs (confirm_order_payment,
 * record_lazywait_sync) and to read integration secrets. The service key comes
 * from the Edge Function environment and MUST NEVER be sent to any client.
 *
 * This named `record_order_sync` until 2026-09-02. That RPC still exists in
 * Production but has ZERO call sites anywhere — it was superseded by
 * `record_lazywait_sync` in migration 20260721130000, and `lazywait-sync` has
 * used the replacement on every logging path ever since. Dropping it would need
 * a new migration; correcting the signpost costs nothing.
 *
 * NOTE ON ERROR HANDLING, because it has bitten this codebase twice. This client
 * RESOLVES with `{ error }`; it does not throw. `await`ing a query without
 * destructuring `error` therefore makes a failed write indistinguishable from a
 * successful one — see the two webhook defects recorded in `syncLog.ts`.
 */
export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * A client that acts AS THE CALLING USER by forwarding their Authorization
 * header, so RLS + auth.uid() apply exactly as they do from the app. Use this
 * for user-initiated flows (e.g. order-intake -> place_order).
 */
export function userClient(authHeader: string | null): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY');
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  });
}
