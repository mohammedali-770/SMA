// The account-delete-scheduler request handler, exported so a test can call it
// without a server. index.ts passes it to Deno.serve and does nothing else.
//
// Moved here from index.ts on 2026-11-12: the body below is the former
// `Deno.serve(async (req: Request) => { ... })` callback, token for token. The
// only difference is whitespace, where Prettier re-wrapped the `admin.rpc(...)`
// arguments.
// handler_test.ts covers every branch with fetch stubbed, so no network is used.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { secretKey, serviceCallHeaders, withoutOpaqueBearer } from '../_shared/apiKeys.ts';

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

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = secretKey();
  if (!url || !serviceKey) return json({ error: 'scheduler_unavailable' }, 503);

  const candidate = req.headers.get('x-process-secret');
  if (!candidate) return json({ error: 'Forbidden' }, 403);

  const admin = createClient(url, serviceKey.value, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(serviceKey.kind === 'opaque' ? { global: { fetch: withoutOpaqueBearer() } } : {}),
  });

  const { data: authorized, error: authError } = await admin.rpc('verify_account_deletion_process_secret', {
    p_secret: candidate,
  });
  if (authError || authorized !== true) return json({ error: 'Forbidden' }, 403);

  try {
    const upstream = await fetch(`${url}/functions/v1/account-delete-process`, {
      method: 'POST',
      headers: {
        // Legacy: Authorization + apikey, as before. Opaque: apikey only.
        ...serviceCallHeaders(serviceKey),
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
}
