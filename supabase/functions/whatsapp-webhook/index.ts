// whatsapp-webhook — Meta Cloud API webhook (verify_jwt=false).
//   GET  : subscription verification (echo hub.challenge when the verify token matches).
//   POST : message-status callbacks → sanitized rows in whatsapp_message_logs.
// Verifies the X-Hub-Signature-256 HMAC with the app secret when configured.
// Returns 200 quickly and never crashes on unknown events.
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { hmacSha256Hex, timingSafeEqual, sanitizeProviderResponse } from '../_shared/whatsapp.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = adminClient();
  let cfg;
  try { cfg = await getProviderConfig(admin, 'whatsapp'); } catch { cfg = null; }
  const secret = cfg?.secretConfig ?? {};

  // ---- GET: subscription verification -------------------------------------
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token') ?? '';
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    const expected = String((secret as Record<string, unknown>).webhook_verify_token ?? '');
    if (mode === 'subscribe' && expected && timingSafeEqual(token, expected)) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // ---- POST: status callbacks ---------------------------------------------
  const raw = await req.text();

  // Verify signature when the app secret is configured.
  const appSecret = String((secret as Record<string, unknown>).app_secret ?? '');
  if (appSecret) {
    const sigHeader = req.headers.get('x-hub-signature-256') ?? '';
    const expectedSig = 'sha256=' + await hmacSha256Hex(raw, appSecret);
    if (!timingSafeEqual(sigHeader, expectedSig)) {
      return new Response('invalid signature', { status: 401 });
    }
  }

  // Best-effort parse + log; never throw back to Meta.
  try {
    const body = JSON.parse(raw);
    const entries = Array.isArray(body?.entry) ? body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const ch of changes) {
        const statuses = Array.isArray(ch?.value?.statuses) ? ch.value.statuses : [];
        for (const st of statuses) {
          const safe = sanitizeProviderResponse({ messages: [{ id: st?.id }], error: st?.errors?.[0] });
          await admin.rpc('record_whatsapp_message', {
            p_phone: st?.recipient_id ? `+${String(st.recipient_id).replace(/^\+/, '')}` : null,
            p_message_type: 'status',
            p_template_name: null,
            p_provider_message_id: safe.message_id,
            p_provider_status: st?.status ? String(st.status) : null,
            p_error_code: safe.error_code,
            p_error_message_safe: safe.error_message,
            p_raw: { status: st?.status ?? null, id: safe.message_id, error_code: safe.error_code },
          });
        }
      }
    }
  } catch { /* unknown/unparseable event — accept quietly */ }

  return json({ status: 'ok' }, 200);
});
