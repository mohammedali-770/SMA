# Spicy Meal — Supabase Edge Functions

> **Updated 2026-08-12.** Edge Functions are the server-side boundary for provider calls, service-role work and externally authenticated callbacks. The older Geidea-only documentation is obsolete.

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
| `push-dispatch` | false | **flag-gated (master flag OFF)** | Expo push sender; EAS credentials configured, but every action no-ops until the `push`/`expo` integration row is enabled |

The client gate was opened by owner approval on 2026-08-17 and EAS now holds real iOS APNs and Android FCM V1 credentials, so customers on a build that contains the `expo-notifications` plugin can opt in and register devices.

Sending is still off. `push-dispatch` reads the `integration_settings` row (`provider_type='push'`) on every request and returns `{status:'disabled'}` unless it is `enabled` **and** its provider resolves to exactly `expo`. Enabling that row is an owner action (`CLAUDE.md` §5). The existence of a deployed `push-dispatch` does not mean push is an active customer channel.

## Payment/refund functions — PROVISIONAL AND FROZEN

The repository still contains the existing payment implementation and historical provider scaffolding:

| Function | `verify_jwt` | Current treatment |
| --- | --- | --- |
| `payment-initiate` | true | frozen provisional payment initiation; source contains Tap path plus older Geidea scaffold |
| `payment-verify` | true | frozen Tap verification path |
| `payment-webhook` | false | frozen provider webhook path |
| `payment-return` | false | frozen public return/redirect path |
| `payment-refund` | false | frozen refund processor; automated scheduling remains disabled |
| `payment-test-config` | true | frozen admin payment diagnostics/test tooling |
| `tap-admin-test-return` | false | frozen isolated Tap test return page |

**Do not treat Tap or the old Geidea scaffold as the final payment architecture.** The owner decision is that the final payment provider has not been selected and payment/refund work is postponed.

Binding rules are in [`../../docs/PAYMENT_POSTPONEMENT.md`](../../docs/PAYMENT_POSTPONEMENT.md) and `CLAUDE.md`:

- no ordinary payment/refund code changes;
- no provider configuration changes;
- no payment/refund deployment/testing;
- no automated refund re-enablement;
- reopening requires a separate provider decision and explicit approval.

## Shared server helpers — `_shared/`

The `_shared` directory contains reusable server-only contracts, including:

- CORS/response helpers;
- Supabase service/user clients;
- integration-secret readers;
- WhatsApp send/logging helpers;
- Lazywait client/contracts;
- Tap helpers and refund classification;
- legacy Geidea helper code retained by the existing provisional payment path.

A helper being present does not imply its provider is active or approved.

## Secrets

### Injected/runtime Supabase credentials

The Edge runtime provides the Supabase runtime credentials needed by server functions. The service-role key is server-only.

### Provider configuration

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

Payment functions remain frozen even though the workflow can technically deploy them.

## Related docs

- [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) — system/trust architecture.
- [`../../docs/PAYMENT_POSTPONEMENT.md`](../../docs/PAYMENT_POSTPONEMENT.md) — binding payment/refund freeze.
- [`../../docs/ORDER_CONFIRMATION_FLOW.md`](../../docs/ORDER_CONFIRMATION_FLOW.md) — order/POS confirmation lifecycle.
- [`../../docs/OPERATIONS_ALERTS_DIGEST.md`](../../docs/OPERATIONS_ALERTS_DIGEST.md) — operations alert engine.
- [`../../docs/MIGRATIONS.md`](../../docs/MIGRATIONS.md) — database migration authority.
- [`../../docs/RELEASE_CHECKLIST.md`](../../docs/RELEASE_CHECKLIST.md) — release and verification gates.