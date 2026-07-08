import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * SERVER-SIDE ONLY service-role client. Bypasses RLS — used by webhooks / sync
 * workers to call the service-role-only RPCs (confirm_order_payment,
 * record_order_sync) and to read integration secrets. The service key comes from
 * the Edge Function environment and MUST NEVER be sent to any client.
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
