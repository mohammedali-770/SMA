import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';

/**
 * send-otp — PLACEHOLDER. SMS/OTP send is NOT implemented (no provider chosen).
 * Structure only; the SMS provider secret is read server-side and never
 * returned. verify_jwt = false (OTP is a pre-login step).
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'sms');
  if (!cfg || !cfg.enabled) {
    return json({ status: 'ignored', reason: 'sms provider not configured' }, 200);
  }

  // TODO(sms): normalize the phone number to E.164 (KSA: +9665XXXXXXXX).
  // TODO(sms): rate-limit per phone AND per IP (e.g. 1/min, max 5/hour) to stop
  //            OTP abuse; persist attempts in a dedicated table.
  // TODO(sms): generate a code, store ONLY its hash + expiry (never return the
  //            code), then send via the provider using cfg.secretConfig.api_key.
  return json({ status: 'not_implemented', message: 'send-otp not implemented yet' }, 501);
});
