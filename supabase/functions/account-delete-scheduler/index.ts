// account-delete-scheduler — Vault-authenticated scheduler gateway.
//
// The cron job presents a dedicated secret stored only in Supabase Vault. This
// function verifies that secret through a service-role-only RPC, then invokes the
// existing account-delete-process function with the built-in service-role bearer.
// The service-role key never leaves the Edge Function environment.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-process-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) return json({ error: 'scheduler_unavailable' }, 503);

  const candidate = req.headers.get('x-process-secret');
  if (!candidate) return json({ error: 'Forbidden' }, 403);

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authorized, error: authError } = await admin.rpc(
    'verify_account_deletion_process_secret',
    { p_secret: candidate },
  );
  if (authError || authorized !== true) return json({ error: 'Forbidden' }, 403);

  try {
    const upstream = await fetch(`${url}/functions/v1/account-delete-process`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source: 'account-delete-scheduler' }),
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
    });
  } catch {
    return json({ error: 'processor_unreachable' }, 502);
  }
});
