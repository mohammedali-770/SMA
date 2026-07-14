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
| `push-dispatch` | server + admin (browser) | false | **active (flag-gated)** | Expo Push sender. Actions: `order_status` (service-role/internal or admin; idempotent per (order,status) via `notification_log`; anti-spoof re-reads the order's real status), `test` (admin → own devices), `broadcast` (admin → opted-in devices only, returns counts). Batches of 100; ticket-level `DeviceNotRegistered` deactivates the device row. **No-ops until the `push` integration row (provider `expo`) is ENABLED** — seeded disabled. Payloads carry only `{type, orderId}` — never customer/order/payment data. |
| `auth-send-sms-whatsapp` | Supabase Auth (Send SMS Hook) | false | active | **Real customer login delivery leg.** Supabase Phone Auth generates the login OTP and calls this hook (Standard Webhooks signed) to deliver it via WhatsApp. Supabase Auth stays the sole login authority — this issues no session, generates no code, stores no challenge. Fails closed until `whatsapp_login_enabled` + Meta creds + template. |
| `whatsapp-send-otp` | app (pre-login) | false | active (secondary) | **Phone _verification_ only, NOT login.** Send WhatsApp OTP (Meta Cloud API) for a signed-in user to verify their profile phone. Rate-limited, hashed, generic responses. Returns `disabled` until configured. |
| `whatsapp-verify-otp` | app | false | active (secondary) | Verify the *verification* OTP (timing-safe); marks the signed-in user's `phone_verified`. Never issues a session; not part of login. |
| `whatsapp-webhook` | Meta | false | active | GET verify-token challenge + POST status callbacks (app-secret HMAC), logged sanitized. |
| `whatsapp-test-config` | admin browser | true | active | Admin `is_admin()`-gated status booleans + test send. No secret values returned. |

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

## Push notification credentials (required BEFORE enabling the push integration)

The `push-dispatch` function itself needs no provider secret for Expo's public
push API, but **device tokens only work when the app's native push credentials
are configured in EAS**:

- **Android — FCM V1:** create a Firebase project for the app's Android
  package (`app.json → android.package`), download the FCM service-account
  JSON, and upload it with `eas credentials` (Android → Google Service
  Account Key → FCM V1). Without it, Android tokens are issued but Expo cannot
  deliver.
- **iOS — APNs:** upload an APNs key (`eas credentials` → iOS → Push
  Notifications) under the Apple Developer team that owns the bundle id.
- Optional hardening: an Expo Access Token can be added later as an
  `Authorization` header on the Expo Push API call — not required for launch.

Rollout order: (1) configure EAS credentials, (2) build + install the app so
devices register, (3) enable the `push` integration row (provider `expo`) in
Admin → Integrations, (4) use "Send test notification" in the admin Push tools.
