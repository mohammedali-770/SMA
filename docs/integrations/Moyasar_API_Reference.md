# Moyasar API — Reference (researched, not vendor-supplied)

> **PROVENANCE.** This file was assembled on **2026-08-24** by reading Moyasar's
> **public** developer documentation at `https://docs.moyasar.com`. It is **not**
> a vendor-supplied document, has **not** been confirmed by Moyasar, and has
> **not** been validated against a live or sandbox Moyasar account. Anything
> account-specific — key values, which payment methods are enabled, settlement
> terms, whether the account is activated for live — is unknowable from here and
> is listed under "Open questions" at the end.
>
> When Moyasar supplies their own reference or an account is opened, commit that
> here and treat it as authoritative over this file.

> **THE PAYMENT FREEZE IS STILL IN FORCE.** See `docs/PAYMENT_POSTPONEMENT.md`.
> Nothing in this document authorises enabling online payment, selecting Moyasar
> as the provider, deploying a payment Edge Function, or applying a migration.
> The provider decision has **not** been made — the owner's words were "maybe we
> will go with MOYASAR". This reference and the code beside it exist so that
> decision can be made against something concrete.

Our implementation: `supabase/functions/_shared/moyasar.ts` (amounts, config
resolution, invoice payload, status mapping, webhook token, verification
binding, sanitizers), `supabase/functions/_shared/moyasarVerify.ts` (invoice and
payment retrieval, validate-and-confirm, invoice reconciliation),
`supabase/functions/_shared/moyasarRefund.ts` (refund body, response
classification, resolve-before-retry), and the `payment-*` Edge Functions.

---

## 1. Authentication

| | |
| --- | --- |
| Base URL | `https://api.moyasar.com/v1` |
| Scheme | **HTTP Basic** — API key as the **username**, password **EMPTY** |
| Secret key prefixes | `sk_test_…` / `sk_live_…` |
| Publishable key prefixes | `pk_test_…` / `pk_live_…` |
| Transport | HTTPS only |

**The empty password is load-bearing.** Moyasar's authentication page says, in a
warning box, "The password must be kept empty". Basic auth encodes
`username:password`, so the credential is `base64("sk_test_x:")` — with the
trailing colon. `base64("sk_test_x")` is a different string and does not
authenticate. `basicAuthHeader()` builds it and a unit test pins the difference.

**Keys announce their own mode, and we use that.** Because a live key is visibly
`sk_live_`, a live key pasted into the TEST slot is *detectable*. Tap's keys are
opaque, so the same mistake there is invisible until it appears on a customer's
statement. `resolveMoyasarConfig()` therefore refuses a key whose prefix does not
match the slot it is filed under (`reason: 'key_mode_mismatch'`), and the admin
panel surfaces it as its own readiness row. This is a control Tap could not have.

**Publishable vs secret.** The publishable key is restricted to exactly one
operation — Create Payment — and is documented as safe to ship in browser and
mobile code. The secret key performs everything else and is server-only. Our
integration uses **only the secret key**, from Edge Functions; the publishable
key fields exist in the admin card for a future client-side flow and are stored
in `public_config`, not `secret_config`, because they are public by design.

**Secret keys are shown once.** The dashboard now displays new secret keys a
single time; only the key ID prefix stays visible. A lost key must be
regenerated, which is a credential change and therefore an owner action under
`CLAUDE.md` §5.

### 1.1 The rule that decides the whole architecture

> "Sending cardholder data to the merchant backend is prohibited and will result
> in canceling the agreement between Moyasar and the merchant in addition to the
> immediate termination of the service."
> — https://docs.moyasar.com/api/authentication

`POST /v1/payments` with `source[type]=creditcard` carries the PAN, CVC and
expiry. **Our server may not do that**, under any framing. The server-side
equivalent of Tap's hosted checkout is therefore the **Invoice**: we create an
invoice, the customer pays on Moyasar's own hosted page, and no card data ever
reaches our infrastructure. Everything in §3 follows from this sentence.

---

## 2. Amounts are MINOR units. Tap's are not.

Moyasar: "A positive integer representing the payment amount in the smallest
currency unit." For SAR that is **halalas** — 1.00 SAR is `100`.

Tap takes **major** units — 1.00 SAR is `1`.

This is the single most dangerous difference between the two providers, because
getting it wrong is a **100× charge or a 100× refund**, and both directions are
catastrophic. The conversion lives in exactly one place (`toMinorUnits()` /
`fromMinorUnits()` in `moyasar.ts`), is never done inline at a call site, and is
pinned by unit tests that include the specific floating-point traps:

- `45.55 * 100` is `4554.999999999999` in IEEE-754. A truncating conversion sends
  4554 — one halala short. A short amount fails our own amount binding, so the
  customer is charged and the order **never confirms**. `toMinorUnits` scales
  first, clears the representation error at six decimals, then rounds.
- `amountsMatch()` compares integer minor units to integer minor units, so no
  float equality is ever relied on, and rejects a major-units value presented as
  minor (`45.5` where `4550` was expected).

`orders.total` is `numeric(10,2)`, so a third decimal cannot reach the converter
from an order in the first place.

**Minimum invoice amount: `100` minor units (1.00 SAR).** The admin test invoice
uses exactly this floor.

---

## 3. Endpoints we use

| Purpose | Call |
| --- | --- |
| Open a hosted checkout | `POST /v1/invoices` |
| Read an invoice + its payments | `GET /v1/invoices/{id}` |
| Reconcile an ambiguous create | `GET /v1/invoices?metadata[reference_transaction]=…` |
| Read a payment (authoritative confirmation) | `GET /v1/payments/{id}` |
| Refund | `POST /v1/payments/{id}/refund` |
| Credential check (creates nothing) | `GET /v1/payments/{a-nonexistent-uuid}` |

### 3.1 Create an invoice — `POST /v1/invoices`

Documented request fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `amount` | integer | **yes** | Minor units. Minimum `100`. |
| `currency` | string | **yes** | ISO-4217, e.g. `SAR`. |
| `description` | string | **yes** | "displayed on the invoice alongside the amount" |
| `success_url` | uri | no | Where the payer is redirected when the invoice is `paid`. |
| `back_url` | uri | no | Where the payer goes if they press back. |
| `expired_at` | timestamp | no | ISO-8601. Default `null` (never expires). |
| `callback_url` | uri | no | POSTs the **invoice** object to your server when paid. |
| `metadata` | object | no | Up to 30 keys; key ≤ 40 chars, value ≤ 500 chars. |

Response carries `id`, `status`, `amount`, `currency`, `url` (**the hosted
payment page**), `expired_at`, `payments: []`, `metadata`, and timestamps.

**`description` must be treated as customer-visible** — Moyasar says it is
displayed on the invoice. So it never carries the internal `SM-…` order number
(Issue #94). The verification binding lives in `invoice_id`, not in this string,
and a unit test asserts no `SM-…` value can appear anywhere in the payload.

**We deliberately do NOT send `callback_url`.** It POSTs a bare invoice object
with **no `secret_token`** — it is not the dashboard/API webhook and carries
nothing we can authenticate. Pointing it at `payment-webhook` would either fill
the log with rejected POSTs or make an unauthenticated stranger able to trigger
our outbound API calls. Confirmation already has two authenticated channels (the
registered `payment_paid` webhook, and the app's own `payment-verify` call), and
neither is trusted on its own — both re-fetch server-side.

**There is no idempotency on invoice creation.** See §4.

### 3.2 Refund — `POST /v1/payments/{id}/refund`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `amount` | int32 | no | Minor units, ≤ the payment (or captured) amount. Omitted ⇒ full refund. |

Partial refunds are supported. The response is the payment object, carrying
`status`, `refunded` (cumulative minor units refunded), `refunded_at` and
`refunded_format`.

We always send `amount` explicitly rather than relying on the full-refund
default, so a bookkeeping error surfaces as a mismatch instead of quietly
returning the whole payment.

**Note the id: it is the PAYMENT, not the invoice.** This is why
`payment_records.provider_ref` holds the payment id and the new
`provider_checkout_ref` column holds the invoice — `order_refunds.charge_ref` is
populated from `provider_ref`, so the refund stack receives a refundable id with
no change to any existing RPC.

---

## 4. Idempotency — documented for payment creation ONLY

`given_id` (a v4 UUID you generate) makes **`POST /v1/payments`** idempotent: a
retry with the same `given_id` returns the original result instead of charging
twice. https://docs.moyasar.com/api/idempotency

**No idempotency parameter is documented on `POST /v1/invoices`, and none on
`POST /v1/payments/{id}/refund`.** Both of the calls this integration actually
makes are therefore *not* idempotent at the provider.

That is worse than Tap, which offers a 24-hour `reference.idempotent` on charges
**and** refunds. Two things close the gap, and they are the parts of this
integration most worth reviewing:

**Invoice creation — reconcile, never retry.** The Tap path retries a failed
charge create once, which is safe there because of `reference.idempotent`. The
Moyasar path does **not** retry. On a timeout or transport failure it calls
`findInvoiceByReference()`, which looks the invoice up by the per-attempt
`reference_transaction` we stamped into its metadata, and adopts the existing
invoice if the create actually landed. If the lookup itself fails, we create
**nothing** and return a retryable error — the next attempt re-runs the lookup.
The reason for that strictness: if a second invoice were created and the customer
paid the first, our stored `invoice_id` would not match, verification would
refuse to confirm, and the customer would be charged for an order that never
completes.

Backing that up, the DB-level one-active-attempt partial unique indexes
(`payment_records_one_active_idx`, `payment_records_one_active_session_idx`) are
already provider-scoped, so for Moyasar they are not a belt-and-braces addition
to a provider-side protection — **they are the protection**.

**Refunds — resolve before retrying.** `docs/PAYMENT_POSTPONEMENT.md` §7 says
automated refunds may only be re-enabled if the provider gives either a true
refund idempotency key **or** a reliable refund-status lookup that can resolve an
ambiguous attempt. Moyasar has no key, but it has a good lookup: `GET
/v1/payments/{id}` returns `status`, the cumulative `refunded` amount and
`refunded_at`. `resolveRefundFromPayment()` reads exactly those three fields, and
the worker runs it before any retry rather than re-POSTing blind:

| Provider state | Verdict |
| --- | --- |
| `status = refunded` | **succeeded** — do not retry |
| cumulative `refunded` ≥ the amount we sent | **succeeded** — do not retry |
| nothing refunded, no `refunded_at` | **pending** — a retry is safe |
| `refunded_at` set but the amount does not reconcile | **pending + `refund_ambiguous_needs_review`** — parked for a human, never retried |
| `status` `failed` / `voided` | **failed** |

This answers §7 for this provider. It does **not** authorise re-enabling the
refund worker, which stays disabled.

---

## 5. Statuses

**Payment** — the eight documented values, and how we map them:

| Moyasar | Our outcome | Why |
| --- | --- | --- |
| `paid` | **paid** | The cardholder paid. |
| `captured` | **paid** | An authorized payment was charged. |
| `initiated` | pending | Created; the cardholder has not paid. |
| `authorized` | **pending, not paid** | Funds reserved — "the cardholder is not charged yet". |
| `verified` | pending | Tokenization card-check, not a sale. |
| `failed` | failed | Reason is on `source.message`. |
| `voided` | cancelled | Merchant cancelled before settlement. |
| `refunded` | refunded (never "paid") | The money has gone back. |
| anything else | **unknown — never paid** | |

Mapping `authorized` to paid would give away food for money we have not taken.
We never place a manual-capture invoice, so seeing `authorized` means something
is configured differently than we believe — a reason to hold, not to proceed.

**Invoice** — adds `canceled`, `on_hold` and `expired`. `on_hold` maps to
**pending**, because it is not terminal and closing the attempt on it would
strand a payment that may still complete.

---

## 6. Webhooks — a shared secret in the body, not a signature

Register at Dashboard → Settings → Webhooks (endpoint must be HTTPS), or via
`POST /v1/webhooks`. The event object:

| Field | Notes |
| --- | --- |
| `id` | Event id |
| `type` | e.g. `payment_paid` |
| `created_at` | |
| `secret_token` | "a password you need to validate on your server to make sure the notification is coming from moyasar" |
| `account_name` | |
| `live` | true in live mode, false in test |
| `data` | The payment (for `payment_*`) or card authentication (for `card_auth_*`) |

**This is materially weaker than Tap's hashstring, and the difference is the
reason our webhook is built the way it is.** A bearer secret in a request body
proves only that the sender knows the secret. It is not computed over the
payload, so it cannot detect a tampered body the way an HMAC over the charge
fields can — anyone who ever obtains the token (a log, a proxy, a misrouted
request) could post an arbitrary "paid" event.

The mitigation is architectural, not cryptographic. The webhook is treated as a
**nudge**: it decides whether we bother to look, never what we conclude. We
re-fetch the payment with our own secret key and confirm only on a clean `paid`
whose every bound field matches (§7). A forged webhook that guessed the token
achieves nothing except making us perform a lookup that will not confirm.

The token is still required — `resolveMoyasarConfig()` fails closed without one
(`reason: 'missing_webhook_secret'`) and `verifyWebhookSecretToken()` returns
false for an empty configured secret, so an unconfigured provider can never
degrade into accepting everything.

### 6.1 Two spellings of the failure event

The dashboard guide's event table lists **`payment_faild`** — Moyasar's own
typo. `GET /v1/webhooks/available_events` returns **`payment_failed`**. The
documentation does not say which one the sender actually emits, and guessing
wrong means silently ignoring every failed payment, so `HANDLED_WEBHOOK_TYPES`
accepts **both**, along with `payment_paid`, `payment_captured`,
`payment_voided`, `payment_refunded`, `payment_authorized`, `payment_abandoned`
and `payment_verified`. The `card_auth_*` events are excluded — standalone 3-D
Secure is "enabled only for selected merchants" and this integration does not use it.

### 6.2 Retry schedule

A non-2xx response is retried on a fixed ladder — immediate, +1m, +10m, +30m,
+1h, +2h — and then the message is **dropped**. Moyasar asks for a 2xx before any
slow work.

Our handler returns `503` when the server-to-server payment fetch fails, so a
transient Moyasar outage brings the event back rather than being acknowledged
after we changed nothing. Every settled decision returns 200. Because delivery
can be dropped entirely after six attempts, the webhook is **never** the only
confirmation path — `payment-verify` is.

---

## 7. Our verification binding

`checkPaymentBinding()` (pure, unit-tested) compares a retrieved payment against
the stored attempt:

| Check | Field |
| --- | --- |
| **`payment.invoice_id` == the invoice id we stored** | the load-bearing one |
| amount, in minor units | `payment.amount` vs `payment_records.amount` |
| currency | `payment.currency` |
| a payment id exists | `payment.id` |
| mode, when the caller has one | webhook `live` vs `payment_records.mode` |

`invoice_id` is set by Moyasar itself when a payment settles an invoice, so
nothing a customer or an attacker controls can point somebody else's payment at
our invoice. Confirmed present on the payment object (§ metadata example).

**`metadata` is deliberately NOT part of the binding.** Moyasar does not document
metadata propagating from an invoice to the payment that settles it, so requiring
it would reject legitimate payments. It is written for human reconciliation only.

**Mode is bound by construction.** Test and live key spaces are disjoint, and the
secret key is always resolved from the **attempt's stored mode**, so a live
payment cannot be fetched with the test key that opened a test attempt. The
`live` flag on a webhook envelope is compared as a second check that costs
nothing.

---

## 8. Errors

Documented shape: `{ type, message, errors }`, where `errors` is a
field → messages map on a validation failure. `extractMoyasarError()` folds it
into a bounded 200-character string; the raw payload is never persisted.

| Code | Meaning |
| --- | --- |
| 400 | Bad Request — often a missing required parameter |
| 401 | Unauthorized — no valid API key |
| 403 | Forbidden — credentials not enough for the resource |
| 404 | Not Found |
| **405** | **"Entity not activated to use live account"** — *not* a wrong HTTP verb |
| 429 | Too Many Requests |
| 500 / 503 | Moyasar-side |

**A declined card returns `201`, not an error.** Moyasar: "When a request is
valid but does not complete successfully (e.g., a credit card is declined by the
bank), we return the normal 201 success code with a response message detailing
the error." So HTTP status is never sufficient to decide an outcome — the
`status` field is. Our status mapping, not the transport code, decides.

That 405 meaning is worth remembering during activation: a live account that has
not been activated for an entity returns 405, which reads like a routing bug.
`classifyMoyasarRefundResponse` treats it as a definitive failure needing a
human, which is the right handling.

---

## 9. Pagination and metadata

Lists return **40 objects** per page plus a `meta` object
(`current_page`, `next_page`, `prev_page`, `total_pages`, `total_count`).
Metadata: up to **30 keys**, key ≤ **40** characters, value ≤ **500** characters,
and Moyasar warns against storing anything sensitive there. We store two short
opaque references (`reference_transaction`, `reference_order`) and, for the admin
test invoice only, `purpose: admin_test`.

List endpoints can filter by metadata using bracket syntax
(`metadata[order_id]=1000`), which is what `findInvoiceByReference()` uses.
**What is unverified is the failure mode:** whether an unsupported filter is
rejected or silently ignored. A silently ignored filter would return the whole
invoice list, so the function re-checks the reference locally on every candidate
rather than trusting the filter to have been applied.

---

## 10. Sandbox

Test and live are fully separate; test mode does not touch live data or the
banking networks. Test cards are published (e.g. mada `4201320111111010` →
`paid`/APPROVED/`00`; `4201320000311101` → `failed`/INSUFFICIENT FUNDS/`51`), and
**any card not on that list fails**. Name must be two words, expiry in the
future, CVC any three digits.

Those numbers are only reachable through Moyasar's hosted page, which is where
they belong: no card value is ever typed into, stored by, or transmitted through
this repository.

---

## 11. Open questions for Moyasar

None of these are answerable from public documentation, and each one should be
settled before the provider is selected.

1. **Does the invoice hosted page offer mada, Apple Pay and STC Pay for our
   account, and is that configured per-account or per-invoice?** The invoice
   create body has no payment-method field.
2. **Is `payment_faild` or `payment_failed` the event type actually sent?** §6.1.
3. **Does a metadata filter on `GET /v1/invoices` fail loudly on an unsupported
   key, or silently return everything?** §9. Our code is safe either way, but the
   answer decides whether the reconciliation path is a fast lookup or a scan.
4. **Is there any idempotency mechanism on invoice creation or refunds that the
   public documentation does not describe?** §4.
5. **What is the settlement timetable, and what does the fee schedule look like
   for mada versus international cards?** Needed for financial reconciliation,
   not for the integration.
6. **Is a refund possible after settlement, and is there a time limit?**
7. **Does the account need separate activation for live, given the 405 meaning
   in §8, and what is the process?**

---

## 12. What this document does NOT establish

- That Moyasar is the chosen provider. **It is not.** The decision is open.
- That any of this works. Nothing here has been run against a Moyasar account,
  test or live. No key exists in this repository or in `integration_settings`.
- That the code is deployed. No payment Edge Function has been deployed for this
  change, and the migration beside it has **not** been applied
  (`CLAUDE.md` §5, §6, §8).
- Anything about fees, settlement, contracts or onboarding.

---

## 13. Related documents

| Doc | Owns |
| --- | --- |
| `CLAUDE.md` §5, §6 | The standing payment freeze and approval rules |
| `docs/PAYMENT_POSTPONEMENT.md` | The authoritative postponement record and the resume checklist |
| `docs/integrations/Tap_API_Reference.md` | The other candidate, for comparison |
| `docs/MIGRATIONS.md` | The only approved Production schema workflow |
