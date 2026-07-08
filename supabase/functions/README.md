# Spicy Meal — Edge Functions (secure server-side boundary)

These Deno Edge Functions are the **only** place third-party providers and their
secrets are ever touched. The Expo app and the Admin frontend never call a
gateway/SMS/push/Lazywait API directly and never receive a secret — they hold
only the Supabase **anon** key and talk to PostgREST/RPCs under RLS.

| Function | Caller | verify_jwt | Status | Purpose |
|----------|--------|-----------|--------|---------|
| `order-intake` | app (user) | true | working wrapper | Calls `place_order` AS THE USER (RLS + totals stay authoritative); future create-order+payment orchestration point. |
| `payment-webhook` | payment gateway | false | placeholder (501) | Verify signature server-side → `confirm_order_payment` RPC. No order is paid without a verified webhook. |
| `lazywait-sync` | schedule/queue | false | placeholder (501) | Server-side Lazywait sync worker → `record_order_sync` RPC. |
| `lazywait-create-order` | server | false | placeholder (501) | **Awaiting official Lazywait API docs.** Do not implement yet. |
| `send-otp` | app (pre-login) | false | placeholder (501) | SMS/OTP send (provider TBD). Rate-limit + E.164 TODO. |
| `push-dispatch` | server | false | placeholder (501) | Push send (Expo/OneSignal TBD). |

`_shared/`
- `cors.ts` — CORS + `json()` helper.
- `supabaseClient.ts` — `adminClient()` (service role, **server-only**) and
  `userClient(authHeader)` (acts as the calling user so RLS/auth.uid() apply).
- `secrets.ts` — `getProviderConfig()` reads `integration_settings.secret_config`
  server-side (service role). Secrets never leave the function.

## Secrets / environment
The Supabase runtime injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`. Provider secrets are stored in the
`integration_settings` table (admin-managed, RLS-revoked) and read via the
service role — **not** via env vars and **never** with a `VITE_` prefix.

## Local run
```bash
supabase start
supabase functions serve --env-file supabase/.env.local   # optional local env
# invoke:
curl -i -X POST http://127.0.0.1:54321/functions/v1/payment-webhook -d '{}'
```

## Deploy
```bash
supabase functions deploy order-intake payment-webhook lazywait-sync \
  lazywait-create-order send-otp push-dispatch
# secrets that are NOT in integration_settings (rare) go via:
# supabase secrets set SOME_KEY=... 
```
