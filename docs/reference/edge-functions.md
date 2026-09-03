<!-- ------------------------------------------------------------------
     GENERATED FILE — DO NOT EDIT.
     Regenerate with: npm run docs:generate
     CI fails if this file drifts from its source (npm run docs:check).
     Derived from: `supabase/functions/`, `.github/workflows/deploy-functions.yml`
     Describes the REPOSITORY, not live Production.
     ------------------------------------------------------------------ -->

# Edge Functions

Every Deno Edge Function in the repository, what it does, how it reaches production, and whether it can act with the service role.

**Read the deployment column carefully.** A function marked *by hand* has no automated deploy path, so the repository cannot tell you which commit is running in production. `.github/workflows/function-drift.yml` compares the deployed *set* of function names against this list; it cannot compare content. It runs on demand only — the schedule was removed on 2026-09-02 — and needs a `SUPABASE_ACCESS_TOKEN` that `docs/OWNER_ACTIONS.md` §15 recommends against creating.

**Privilege column.** *service role* means the function can obtain the service-role key — through `adminClient()`, through `serviceTarget()` on the dependency-free PostgREST path, or by reading `SUPABASE_SERVICE_ROLE_KEY` itself — and can therefore bypass RLS. Those functions are the ones to read first in a security review: the caller’s identity is not the thing limiting what they can touch. A function may hold it for one narrow read and still use the caller’s own JWT for everything customer-facing; `order-intake` does exactly that.

| Function | Purpose | Deployment | Highest privilege |
| --- | --- | --- | --- |
| `account-delete-process` | service-role processor for the account-deletion queue (verify_jwt=false; authenticated by the service-role bearer or a Vault-backed shared secret… | by hand | service role |
| `account-delete-request` | authenticated customer requests deletion of their OWN account (verify_jwt=true). Two actions: | by hand | service role |
| `account-delete-scheduler` | Vault-authenticated scheduler gateway | by hand | service role |
| `auth-send-sms-whatsapp` | Supabase Auth **Send SMS Hook** (verify_jwt=false) | by hand | service role |
| `email-test-config` | ADMIN-only (verify_jwt=true + is_admin check) | by hand | service role |
| `lazywait-catalog` | admin-initiated, SERVER-SIDE catalog pull | by hand | service role |
| `lazywait-sync` | server-side POS sync worker (invoked by a schedule/cron, NOT by the app). Claims due orders (FOR UPDATE SKIP LOCKED), pushes each to the confirmed… | by hand | service role |
| `lazywait-webhook` | inbound receiver for Lazywait POS callbacks | by hand | service role |
| `order-intake` | authenticated "create order + sync to POS" orchestration | by hand | service role |
| `payment-initiate` | the authenticated customer starts paying for an order they already created (place_order left it payment_status='pending') | workflow | service role |
| `payment-refund` | the automatic refund worker for orders that were PAID but provably never reached the branch (Issue #94, step 7) | by hand | service role |
| `payment-return` | the HTTPS URL the payment provider redirects the customer's browser to after checkout (providers require a real https redirect target; a raw app… | workflow | caller JWT |
| `payment-test-config` | ADMIN-only (verify_jwt=true + is_admin(), role AND AAL2) | by hand | service role |
| `payment-verify` | the app calls this after returning from the provider's hosted checkout. It is the ONLY thing the app trusts: it retrieves the charge (Tap) or the… | workflow | service role |
| `payment-webhook` | called by the PAYMENT GATEWAY (not the app) after a payment event. verify_jwt = false: the caller is the gateway, authenticated by its own… | workflow | service role |
| `push-dispatch` | Expo Push sender (COMPLETE implementation; replaces the old 501 placeholder) | by hand | service role |
| `staff-accounts` | ADMIN-only provisioning for the branch-operations roles | by hand | service role |
| `tap-admin-test-return` | the HTTPS page Tap redirects the admin's browser to after the isolated admin TEST checkout (Tap requires an https redirect target for 3DS). It is… | by hand | caller JWT |
| `whatsapp-send-otp` | signed-in customer phone-ownership verification send | by hand | service role |
| `whatsapp-test-config` | ADMIN-only (verify_jwt=true + is_admin check) | by hand | service role |
| `whatsapp-verify-otp` | signed-in customer phone-ownership verification | by hand | service role |
| `whatsapp-webhook` | Meta Cloud API webhook (verify_jwt=false) | by hand | service role |

## Shared modules

Code under `supabase/functions/_shared/` is imported by the functions above and is not itself deployable.

- `_shared/accountDeletion.test.ts`
- `_shared/accountDeletion.ts`
- `_shared/adminAuth.test.ts`
- `_shared/adminAuth.ts`
- `_shared/adminAuthWiring.test.ts`
- `_shared/authHook.test.ts`
- `_shared/authHook.ts`
- `_shared/cors.ts`
- `_shared/geidea.ts`
- `_shared/lazywait.test.ts`
- `_shared/lazywait.ts`
- `_shared/lazywaitApi.test.ts`
- `_shared/lazywaitApi.ts`
- `_shared/lazywaitBaseUrlWiring.test.ts`
- `_shared/lazywaitCatalog.test.ts`
- `_shared/lazywaitCatalog.ts`
- `_shared/moyasar.test.ts`
- `_shared/moyasar.ts`
- `_shared/moyasarRefund.test.ts`
- `_shared/moyasarRefund.ts`
- `_shared/moyasarVerify.ts`
- `_shared/orderIntakeSyncWiring.test.ts`
- `_shared/paymentSync.ts`
- `_shared/pushReadyCopyWiring.test.ts`
- `_shared/rest.test.ts`
- `_shared/rest.ts`
- `_shared/restNoSupabaseJs.test.ts`
- `_shared/secrets.ts`
- `_shared/supabaseClient.ts`
- `_shared/syncLog.test.ts`
- `_shared/syncLog.ts`
- `_shared/tap.test.ts`
- `_shared/tap.ts`
- `_shared/tapRefund.test.ts`
- `_shared/tapRefund.ts`
- `_shared/tapVerify.ts`
- `_shared/webhookReliabilityWiring.test.ts`
- `_shared/whatsapp.test.ts`
- `_shared/whatsapp.ts`
- `_shared/whatsappSend.ts`
