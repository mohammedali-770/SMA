# Spicy Meal — Edge Functions (secure server-side boundary)

These Deno Edge Functions are the **only** place third-party providers and their
secrets are ever touched. The Expo app and the Admin frontend never call a
gateway/SMS/push/Lazywait API directly and never receive a secret — they hold
only the Supabase **anon** key and talk to PostgREST/RPCs under RLS.

| Function | Caller | verify_jwt | Status | Purpose |
|----------|--------|-----------|--------|---------|
| `order-intake` | app (user) | true | working wrapper | Calls `place_order` AS THE USER (RLS + totals stay authoritative); future create-order+payment orchestration point. |
| `payment-initiate` | app (user) | true | **Geidea** | Reads the user's own order (RLS → trusted total), creates a **Geidea** session (server-to-server, Basic auth + HMAC signature), returns `sessionId` + hosted-checkout URL. Never returns a secret. |
| `payment-webhook` | Geidea | false | **Geidea** | Verifies the **Geidea callback HMAC signature** server-side, then on `status=Paid`+`responseCode=000` calls `confirm_order_payment` (amount must equal the server total; idempotent). A forged callback can't mark an order paid. |
| `lazywait-sync` | schedule/cron | false | **Lazywait** | POS sync worker: claims due orders (SKIP LOCKED), `POST /pos/orders/create` (pickup only), records via `record_lazywait_sync` with retry/backoff/dead-letter. See `docs/LAZYWAIT.md`. |
| `lazywait-catalog` | admin (browser) | true | **Lazywait** | Admin-only catalog pull: GETs branches/categories/items/addons/addon-groups server-side and caches them in `lazywait_catalog_items` for id-mapping review. Extra `is_admin()` check; never returns a secret. |
| `lazywait-webhook` | Lazywait | false | **Lazywait** | Verifies the `X-LazyWait-Signature` HMAC (hex), records POS status; unknown events are logged + accepted safely. |
| `lazywait-create-order` | — | false | superseded | Order creation now lives in `lazywait-sync`. Stub retained for the deploy slot. |
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
supabase functions deploy order-intake payment-initiate payment-webhook \
  lazywait-sync lazywait-catalog lazywait-create-order send-otp push-dispatch
# secrets that are NOT in integration_settings (rare) go via:
# supabase secrets set SOME_KEY=... 
```

## Geidea payment setup

The Geidea merchant credentials live in the `integration_settings` `payment`
row — **never in the app**. Set them with the admin RPC (service role / SQL
editor / admin dashboard), NOT from the client:

```sql
select public.upsert_integration_settings(
  'payment', 'geidea', true,
  -- public_config (non-secret): environment + currency + app return URL
  '{"country":"ksa","currency":"SAR","returnUrl":"spicymeal://payment-return"}'::jsonb,
  -- secret_config (server-only): Geidea merchant public key + API password
  '{"publicKey":"<MERCHANT_PUBLIC_KEY>","apiPassword":"<API_PASSWORD>"}'::jsonb
);
```

- `public_config.country` selects the host (`ksa` default); override the exact
  hosts with `apiBaseUrl` / `checkoutBaseUrl` to point at the **sandbox** during
  testing.
- The `apiPassword` is both the Basic-auth password **and** the HMAC signing key
  (see `_shared/geidea.ts`).

**Flow:** app calls `place_order` → order `payment_status='pending'` → app calls
`payment-initiate {orderId}` → opens the returned Geidea checkout URL → customer
pays → Geidea POSTs the signed callback to `payment-webhook` → verified
`Paid`+`000` → `confirm_order_payment` flips the order to `paid`. The client is
never trusted to set payment status.
