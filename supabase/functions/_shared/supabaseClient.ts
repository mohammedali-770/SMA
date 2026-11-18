import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

import {
  MISSING_PUBLISHABLE_KEY,
  MISSING_SECRET_KEY,
  publishableKey,
  secretKey,
  withoutOpaqueBearer,
} from './apiKeys.ts';

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
  // The `default` secret key from SUPABASE_SECRET_KEYS. There is no legacy
  // fallback: without one this throws, and the function refuses to run. See
  // apiKeys.ts for why an opaque key must not ride on `Authorization`.
  const key = secretKey();
  if (!url || !key) throw new Error(MISSING_SECRET_KEY);
  return createClient(url, key.value, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: withoutOpaqueBearer() },
  });
}

/**
 * A client that acts AS THE CALLING USER by forwarding their Authorization
 * header, so RLS + auth.uid() apply exactly as they do from the app. Use this
 * for user-initiated flows (e.g. order-intake -> place_order).
 */
export function userClient(authHeader: string | null): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = publishableKey();
  if (!url || !key) throw new Error(MISSING_PUBLISHABLE_KEY);
  return createClient(url, key.value, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
      // Strips only a `Bearer sb_…` that supabase-js adds when there is no user
      // header; a forwarded user JWT is untouched.
      fetch: withoutOpaqueBearer(),
    },
  });
}
