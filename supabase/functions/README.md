# Spicy Meal — Supabase Edge Functions

> **Updated 2026-11-11.** Edge Functions are the server-side boundary for provider calls, service-role work and externally authenticated callbacks.

The Expo customer app and the staff/admin web app use the Supabase anon/publishable key plus the signed-in user's JWT. They must never receive the service-role key or provider secrets.

## Security model

Functions fall into three invocation models:

1. **Signed-in user/admin (`verify_jwt = true`)** — Supabase validates the JWT first; the function then applies RLS and/or explicit admin checks.
2. **External webhook/hook (`verify_jwt = false`)** — authentication is done by the function using the provider/hook signature or another dedicated mechanism.
3. **Scheduled/service path (`verify_jwt = false`)** — protected by server/service credentials, dedicated scheduler secrets and/or service-role-only database contracts.

`verify_jwt = false` does **not** mean "public and trusted". Each such function must fail closed on its own authentication contract.

## Current function inventory

### Ordering and Lazywait

| Function | `verify_jwt` | Status | Responsibility |
| --- | --- | --- | --- |
| `order-intake` | true | active | Authenticated order-intake/orchestration wrapper around server-authoritative ordering contracts |
| `lazywait-sync` | false | active | POS synchronization worker with claim/fencing/retry/confirmation-required handling |
| `lazywait-catalog` | true | active | Admin-only Lazywait catalog pull/mapping support |
| `lazywait-webhook` | false | active | Lazywait callback receiver with signature validation and sanitized handling |

Lazywait is the active operational POS integration. Ambiguous Create Order outcomes must not be blindly re-sent; the database/worker lifecycle can route them to `confirmation_required` for human verification.

### WhatsApp and authentication

| Function | `verify_jwt` | Status | Responsibility |
| --- | --- | --- | --- |
| `auth-send-sms-whatsapp` | false | active | Supabase Auth Send-SMS hook: delivers the **Auth-generated** login OTP over WhatsApp |
| `whatsapp-send-otp` | true | active secondary path | Signed-in profile-phone verification send; not the login authority |
| `whatsapp-verify-otp` | true | active secondary path | Verifies the signed-in profile-phone challenge; never creates an Auth session |
| `whatsapp-webhook` | false | active | Meta webhook verification/status callbacks with app-secret signature checks |
| `whatsapp-test-config` | true | admin-only | Configuration/status/test tooling without returning secrets |

The login and profile-verification paths are intentionally separate. Do not merge them as cleanup: Supabase Auth owns login session issuance, while the custom verification path only verifies a signed-in user's phone.

### Account deletion

| Function | `verify_jwt` | Status | Responsibility |
| --- | --- | --- | --- |
| `account-delete-request` | true | active | Customer-owned deletion request/verification/enqueue path |
| `account-delete-process` | false | active backend path | Service-side deletion/anonymization processor |
| `account-delete-scheduler` | false | active scheduler gateway | Authenticated cron gateway into the deletion processor |

Account-deletion server logic includes phone normalization and audited manual-review resolution in the database layer; do not reduce it to a simple profile delete.

### Other integration tooling

| Function | `verify_jwt` | Status | Responsibility |
| --- | --- | --- | --- |
| `email-test-config` | true | admin-only | SMTP/configuration status and test-send tooling; secret stays server-side |
| `push-dispatch` | false | **LIVE** | Expo push sender; credentials configured, master flag enabled, delivering to real customer devices |

Push went live on 2026-08-17. `push-dispatch` still reads the `integration_settings` row (`provider_type='push'`) on every request and returns `{status:'disabled'}` unless it is `enabled` **and** its provider resolves to exactly `expo` — that gate is simply passing now. Turning the row off is the kill switch for all sending, including order updates.

Because this function now messages real customers, changes to its status copy, targeting or dispatch behaviour are customer-facing changes. Its `order_status` and `pos_sync` paths are idempotent per `(order_id, status)` under a claim/fencing lifecycle; `broadcast` is immediate, non-recallable, and restricted to devices with `promos_enabled = true`.

## Payment/refund functions — Moyasar

Moyasar's hosted invoice is the only payment provider (owner decision, 2026-11-11). The Tap and Geidea code paths were removed; their July history stays in `payment_records` as data.

| Function | `verify_jwt` | Responsibility |
| --- | --- | --- |
| `payment-initiate` | true | Opens (or reuses) a Moyasar invoice for the customer's own checkout session or order. Refuses customer checkout while the gateway is in TEST mode (`{status:'disabled', reason:'test_mode'}`), so a test card can never pay for a real order. A missing or disabled row, or one naming another provider, answers `{status:'disabled'}`; a total under 1.00 SAR answers `{status:'disabled', reason:'amount_below_minimum'}`; an unusable key or webhook token answers an error |
| `payment-verify` | true | The verification the app trusts: fetches the invoice and its payment from Moyasar and confirms only a clean `paid` |
| `payment-webhook` | false | Moyasar webhook, authenticated by its `secret_token`; the payment is re-fetched before anything is confirmed. A `webhook_verification` event's one-time code is stored in `integration_sync_logs` for the console, never logged |
| `payment-return` | false | Public HTTPS return page (`success_url` / `back_url`); marks nothing paid and bounces into the app |
| `payment-refund` | false | Refund worker, Moyasar refunds only. Fails closed without `refund_trigger_secret` in the payment row's `secret_config` (sent as `x-refund-secret`); automated scheduling (the `payment-refund-worker` cron job) is off |
| `payment-test-config` | true | Admin-only (AAL2) status, connection test, re-verify and the isolated sandbox test invoice, which is where TEST-mode testing happens |
| `payment-admin-test-return` | false | Public informational page the admin sandbox test invoice returns to (renamed from `tap-admin-test-return` on 2026-11-11) |

These functions need two migrations, applied in this order and each named by version, before any of them is deployed: `20260824100000_moyasar_payment_provider` (`begin_payment_attempt`, `begin_session_attempt`, `payment_records.provider_checkout_ref`), then `20261003120000_moyasar_only_payments` (the loyalty multi-spend guard on `begin_session_attempt`, the 1.00 SAR minimum on both attempt RPCs, the 50-per-line cap on `begin_session_attempt`, and the refund driver's Moyasar gate). `20261004120000_drop_tap_payment_rpcs` is applied only after the deploy. They then deploy as one set: an older bundle beside a new one can open an invoice that nothing confirms.

The runbook is [`../../docs/PAYMENTS.md`](../../docs/PAYMENTS.md), with the binding rules in `CLAUDE.md` §5 and §6. Each of these is a separate owner approval: applying a payment migration, deploying a payment function, entering keys or the webhook secret, setting `MOYASAR_PROXY_URL`, changing the Moyasar dashboard, enabling online payment, and re-enabling automated refunds.

## Shared server helpers — `_shared/`

The `_shared` directory contains reusable server-only contracts, including:

- CORS/response helpers;
- Supabase service/user clients;
- integration-secret readers;
- WhatsApp send/logging helpers;
- Lazywait client/contracts;
- Moyasar helpers: invoice construction, verification binding, webhook authentication and refund classification;
- `moyasarHttp.ts`, the only transport for Moyasar calls. Moyasar LIVE accepts secret-key calls only from its Allowed IPs list and Edge Functions have no static outbound IP, so when the `MOYASAR_PROXY_URL` secret is set every call goes through that proxy, and a value it cannot use refuses the call instead of sending it.

A helper being present does not imply its provider is active or approved.

## Secrets

### Injected/runtime Supabase credentials

The Edge runtime provides the Supabase runtime credentials needed by server functions. The service-role key is server-only.

### Provider configuration

`MOYASAR_PROXY_URL` is the one payment value held as an Edge Function secret rather than in the payment row. It is an `http://` or `https://` proxy URL and usually carries the proxy's credentials, so it is treated as a secret: never logged, never returned. Setting it is an owner action.

Provider secrets are read server-side from the approved integration/secret storage paths and must never be returned to a client.

Never put a server secret in:

- `VITE_*`;
- `EXPO_PUBLIC_*`;
- a committed `.env`;
- logs/errors/test snapshots;
- function JSON responses.

Admin "status" endpoints should return presence/health booleans, not secret values.

## Local validation

Function source is typechecked as part of the production gates. For local checks, use the repository's documented Deno command rather than deploying anything:

```bash
deno check --no-lock --node-modules-dir=none supabase/functions/*/index.ts
```

Some functions require a local Supabase stack or test environment to execute meaningfully. SQL regression suites live under `supabase/tests/` and must run only against disposable/local databases, never production.

## Deployment policy

Do **not** copy old README commands that directly deploy a set of functions to production.

Production Edge Function deployment is an explicit owner-approved action governed by `CLAUDE.md` and the controlled GitHub workflow. The deployment workflow is manual, production-branch constrained and requires named functions/confirmation.

Deploying a payment function needs the same explicit approval as any other deploy, plus the migration and one-set ordering described above.

## Related docs

- [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) — system/trust architecture.
- [`../../docs/PAYMENTS.md`](../../docs/PAYMENTS.md) — payment runbook (Moyasar): how it works, owner steps, go-live checks.
- [`../../docs/PAYMENT_POSTPONEMENT.md`](../../docs/PAYMENT_POSTPONEMENT.md) — history: the payment freeze, 2026-07-29 to 2026-11-11.
- [`../../docs/ORDER_CONFIRMATION_FLOW.md`](../../docs/ORDER_CONFIRMATION_FLOW.md) — order/POS confirmation lifecycle.
- [`../../docs/OPERATIONS_ALERTS_DIGEST.md`](../../docs/OPERATIONS_ALERTS_DIGEST.md) — operations alert engine.
- [`../../docs/MIGRATIONS.md`](../../docs/MIGRATIONS.md) — database migration authority.
- [`../../docs/RELEASE_CHECKLIST.md`](../../docs/RELEASE_CHECKLIST.md) — release and verification gates.