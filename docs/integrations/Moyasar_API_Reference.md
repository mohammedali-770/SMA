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
>
> **Updated 2026-11-11** from Moyasar's public documentation read that day
> (Allowed IPs, webhook verification, test cards, refunds), from the owner's
> answers, and from the implementation on `feat/moyasar-only-20261111`. Still
> not validated against the account: no request has been sent to Moyasar with
> this code.

> **MOYASAR IS THE PROVIDER (owner decision, 2026-11-11).** The owner said: "our
> payment is confirmed it will be through moyasar / make the required edits and
> remove unnecessary pices of code for other payment gateway and keep moyasar".
> The runbook is [`docs/PAYMENTS.md`](../PAYMENTS.md). Nothing in this document
> authorises enabling online payment, deploying a payment function, applying a
> migration, entering a key or changing the Moyasar dashboard: each is a
> separate owner approval (`CLAUDE.md` §5).
>
> *History:* until 2026-11-11 this banner said the payment freeze was in force
> and the provider undecided ("maybe we will go with MOYASAR"); see
> `docs/PAYMENT_POSTPONEMENT.md`.

Our implementation: `supabase/functions/_shared/moyasar.ts` (amounts, config
resolution, invoice payload, status mapping, webhook token, verification
binding, sanitizers), `supabase/functions/_shared/moyasarVerify.ts` (invoice and
payment retrieval, validate-and-confirm, invoice reconciliation),
`supabase/functions/_shared/moyasarRefund.ts` (refund body, response
classification, resolve-before-retry), `supabase/functions/_shared/moyasarHttp.ts`
(the only transport for Moyasar calls, with the optional static-IP proxy), and
the `payment-*` Edge Functions.

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

### 1.0 Allowed IPs — a LIVE blocker (researched 2026-11-11)

Dashboard → Settings → API Keys → **Allowed IPs** restricts which addresses may
make secret-key calls
(https://docs.moyasar.com/guides/dashboard/setting-up-your-ip-whitelist):

- in **live**, at least one address must be listed, and the live secret key is
  **hidden until one is**;
- a call from any other address gets **401** `authentication_error`, "This IP
  Address is not whitelisted to do this operation";
- a wrong or revoked key gets the same status and type, so only the message
  tells them apart. `isMoyasarIpNotAllowed()` requires the message to name the
  IP and the allow-list;
- saving the list asks for a 6-digit code.

Supabase Edge Functions have no static outbound IP (Supabase knowledge base,
read 2026-11-11), so the owner chose a static-IP proxy service. When the Edge
Function secret `MOYASAR_PROXY_URL` is set, `moyasarFetch()` sends every Moyasar
call through it with `Deno.createHttpClient({ proxy })`; the https target is
tunnelled, so the proxy never sees the secret key. `HTTPS_PROXY` as a function
secret would route nothing. A value that cannot be used refuses every call,
test included. Whether hosted Supabase supports `createHttpClient` is read from
the edge-runtime source, not from Supabase's documentation; it is unproven until
a live Test connection. Detail and owner steps: `docs/PAYMENTS.md` §8.1.

What each caller does with the refusal: it is logged as
`moyasar_request_refused` / `moyasar_ip_not_allowed` with the remedy; the admin
actions say whether the proxy or the server's own address was refused;
`payment-verify` answers `pending`; the refund worker releases the refund
(§3.2).

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

## 2. Amounts are MINOR units (the retired Tap integration's were not)

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
uses exactly this floor (`MOYASAR_MIN_INVOICE_MINOR_UNITS`). A customer total
under it can never be invoiced, so `payment-initiate` refuses it before opening
an attempt, with `{status:'disabled', reason:'amount_below_minimum'}`, and the
attempt RPCs refuse it too (`20261003120000`). A points redemption can leave
such a remainder.

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

Every one of these goes through `moyasarFetch()` (§1.0). `PUT
/v1/invoices/{id}/cancel` exists and is **not** used; whether to cancel an older
invoice when a new attempt opens is an open question (`docs/PAYMENTS.md` §11).

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

**The hosted page URL.** Moyasar's documented example is
`http://checkout.moyasar.com/invoices/<id>?lang=en`
(https://docs.moyasar.com/api/invoices/01-create-invoice). `customerCheckoutUrl()`
hands the app only `https` on `moyasar.com` or a subdomain, with no port and no
credentials; `http` on that domain is **upgraded**. Anything else answers 502;
a newly created invoice's attempt is also closed. `payment_records.checkout_url` keeps the URL exactly as
Moyasar returned it.

**`lang`.** Not a documented request field, but every invoice URL in Moyasar's
documentation carries it. The server sets `lang=ar` or `lang=en` on the URL it
hands out, from the app's language. Whether the page honours `ar` is unknown.

**`expired_at`.** We always send it: one minute before the attempt's own
`expires_at` (`invoiceExpiryForAttempt`), so no invoice outlives its attempt. An
attempt with under three minutes left (the invoice would live less than two)
gets no invoice.

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

From Moyasar's public documentation, read 2026-11-11 (not tested):

- a refund can be made only from a `paid` or `captured` payment;
- partial refunds are allowed; we assume one refund per payment, and the worker
  sends at most one per order;
- refunds carry fees; a **void** within about two hours is fee-free. Voiding is
  not implemented;
- an aggregation account needs balance to refund;
- the money reaches a mada card in about 1 to 3 days, a credit card in about 7
  to 14.

How our worker handles responses: a 429, a 5xx or a network error is
`pending` (released, retried later); a definitive 4xx is `failed`. A 401 from
Allowed IPs is `pending` with `failure_code = 'moyasar_ip_not_allowed'`, with no
attempt cap; a plain 401 is `failed` (`http_401`). Detail: `docs/PAYMENTS.md` §6.

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

**Invoice creation — reconcile, never retry.** The old Tap path (deleted
2026-11-11) retried a failed charge create once, which was safe there because of
`reference.idempotent`. The Moyasar path does **not** retry. On a timeout or transport failure it calls
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
| `refunded_at` set but the amount does not reconcile | **parked** — written `failed` with `refund_ambiguous_needs_review`, never retried |
| `status` `failed` / `voided` | **failed** |

**The ordering is what makes this safe, and it is the part worth reviewing.** The
reconciliation runs *before* the POST on every re-attempt, not only after an
ambiguous one: `claim_order_refund` increments `attempt_count` before returning
it, so anything above 1 means this refund has already been sent once, and those
runs ask before they act. A reconciliation that cannot be completed is **not**
treated as "nothing was refunded" — it releases the row untouched, because a
failed lookup is exactly the state in which re-POSTing pays a customer twice.

An unreconcilable refund is written `failed` with
`refund_ambiguous_needs_review` rather than released as `pending`. `pending`
means "release for re-claim", so parking one there would loop forever and never
reach a person; `failed` frees the one-live-refund slot and surfaces the row in
`list_failed_order_refunds()`. That is the same treatment
`expire_stale_order_refund_claims()` already gives a lease it cannot resolve,
for the same stated reason.

This answers §7 for this provider. It does **not** authorise re-enabling the
refund worker, which was still disabled on 2026-11-11. Re-enabling it is an owner
step, after `refund_trigger_secret` exists (`docs/PAYMENTS.md` §6).

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

**Closed invoices are terminal (2026-11-11).** An invoice that is `expired` or
`canceled` with no `paid` or `captured` payment can never be paid. It answers
`expired` / `payExpired` or `cancelled` / `payCancelled`, and the attempt is
closed with `failure_code` `invoice_expired` or `invoice_canceled`
(`closedInvoiceOutcome`). A settled payment always wins. Until this change such
an invoice read `pending`, which kept the app resuming a page nobody could pay
and refusing every new order on that device, cash included.

**A failed PAYMENT does not close its attempt.** An invoice can hold several
payments; a declined card can be followed by Apple Pay on the same page. Only a
closed invoice, or the attempt's own expiry, ends an attempt.

**What `payment-verify` sends for `refunded`.** `failed`, with `payUnknown`
(`verifyAnswerStatus`). Builds already in the field treat only `failed`,
`cancelled` and `expired` as terminal.

**SADAD.** A SADAD bill leaves the invoice `on_hold` for days and cannot be
refunded. It must be off for this account; whether it is, is unknown (§11).

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

### 6.0 Event names

Moyasar's dashboard guide lists: `payment_paid`, `payment_faild` (Moyasar's own
spelling), `payment_refunded`, `payment_voided`, `payment_authorized`,
`payment_captured`, `payment_verified`. Creating a webhook through the API takes
the secret as **`shared_secret`**; deliveries carry it as **`secret_token`**.

`HANDLED_WEBHOOK_TYPES` acts on those, plus `payment_failed` and
`payment_abandoned`. Anything else is acknowledged and ignored. The one
non-payment event handled is `webhook_verification` (§6.3).

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

Our handler returns `503` when the server-to-server payment fetch fails (a
network error included), and when our own stamp or read-back fails before the
outcome is known, so the event comes back rather than being acknowledged after
we changed nothing. A duplicate payment is acknowledged with 200: it is
recorded, and a retry would only record it again. Every settled decision returns 200. Because delivery
can be dropped entirely after six attempts, the webhook is **never** the only
confirmation path — `payment-verify` is.

### 6.3 Webhook verification (published by Moyasar 2026-11-11)

A new webhook may need verifying before Moyasar delivers anything
(https://docs.moyasar.com/api/other/webhooks/verify-webhook). Moyasar sends one
event:

| Field | Notes |
| --- | --- |
| `type` | `webhook_verification` |
| `data.webhook_id` | the webhook being verified |
| `data.verification_code` | 6 digits, entered in the dashboard |
| `secret_token` | the webhook's secret, as on every event |

- It is sent **once and never retried**.
- The code must be entered within **30 minutes**.
- Until it is, the webhook receives nothing, and events from before that are
  **never delivered later**.

`payment-webhook` matches the token against every configured slot (test, live,
shared) in constant time. A match writes one `integration_sync_logs` row
(`request.type = 'webhook_verification'`, the code in
`response.verification_code`) and answers 200; a mismatch answers 401 and
records nothing. It is handled even while the payment row is disabled, as long
as the provider is `moyasar`. Nothing is fetched or confirmed. The console's
Moyasar panel shows the code for 30 minutes. Register the webhook only after the
new `payment-webhook` is deployed and its token saved: `docs/PAYMENTS.md` §8.2.

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

**A test-mode attempt never confirms (2026-11-11).** Moyasar's sandbox settles a
test invoice exactly as live settles a real one, so the binding above would
match. Any attempt whose stored mode is not `live` is refused before any order
or payment state is written, and the attempt is marked failed with
`failure_code = 'test_mode_attempt'`, reason `test_mode_attempt`,
message key `payUnknown`. `payment-initiate` also refuses customer checkout in
TEST mode (`{status:'disabled', reason:'test_mode'}`). The admin sandbox invoice
has no attempt row, so it never reaches confirmation.

**One paying payment per checkout or order.** A second settled payment that
binds is recorded as a duplicate (`failure_code = 'duplicate_payment'`, status
`failed`) and never reported paid; staff refund it by hand
(`docs/PAYMENTS.md` §10).

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
banking networks. Test cards are published, and **any card not on that list
fails**. Name must be two words, expiry in the future, CVC any three digits.

| Card | Result (Moyasar's documentation, read 2026-11-11) |
| --- | --- |
| mada `4201320111111010` | `paid` / APPROVED / `00` |
| mada `4201320000311101` | `failed` / INSUFFICIENT FUNDS / `51` |
| Visa `4111111111111111` | paid, with a 3-D Secure challenge |
| Visa `4111114005765430` | paid, frictionless |
| Mastercard `5421080101000000` | paid |

**Apple Pay sandbox:** a real card in Wallet, with the test keys; only amounts
from **200.00 to 300.00 SAR** succeed, others fail. The admin test invoice is
1.00 SAR, so it cannot show an Apple Pay success.

Those numbers are only reachable through Moyasar's hosted page, which is where
they belong: no card value is ever typed into, stored by, or transmitted through
this repository.

---

## 10a. Operational consequences of having two gateways (history)

> **History, 2026-11-11.** There is one gateway now. `decideCrossProviderAttempt()`
> and the Tap code were removed. Two points still hold: everything touching
> money that already exists follows the **row**, not the settings page; and the
> credential names stay namespaced (`moyasar_*`), because Tap's July keys are
> still in `secret_config` and must never be read as Moyasar's.

These are not Moyasar facts; they are what having a *second* provider does to
this system, and they are recorded here because each one caused a defect that had
to be fixed during review.

**One live checkout per order, across providers.** The database double-charge
guard is keyed `(order_id, provider)` and `(checkout_session_id, provider)` — it
is provider-scoped, so a Tap attempt does not block a Moyasar attempt on the same
order. Switch the provider while a customer has a hosted page open, let them tap
Pay again, and they hold two payable pages for one order; both would settle,
because `confirm_order_payment` de-duplicates on `(provider, provider_ref)`, and
`open_order_refund_record` can only ever enrol **one** of the two charges for
refund. `decideCrossProviderAttempt()` closes this in `payment-initiate`, which is
the only place that knows about both gateways: an other-provider attempt with no
provider-side object yet is closed, and one that already has a payable page
refuses the second checkout outright.

**Everything follows the row, never the current configuration.** A refund is
executed with the gateway stored on `order_refunds.provider`; verification routes
by `payment_records.provider`; the webhook routes by the event's own shape; the
secret key and the *mode* both come from the attempt row, not from the settings
page. The configured provider only decides what a NEW payment uses. Any place
that reads the configuration to decide what to do with existing money is a bug —
that pattern produced four separate defects, including a refund POSTed to the
wrong gateway and an invoice created with the wrong mode's key.

**Credential names are namespaced (`moyasar_*`).** `upsert_integration_settings`
merges `secret_config`, so distinct field names let both gateways' credentials
live in the one row. Had Moyasar reused Tap's `test_secret_key` /
`live_secret_key`, saving Moyasar credentials would have destroyed Tap's by
collision and made every refund still queued for Tap impossible to execute.

**What still cannot be fixed in code:** an attempt belonging to a de-configured
gateway. `provider_name` gates `resolve*Config().ok`, so such an attempt is
reported honestly — `provider_not_configured` in the logs, `pending` to the app,
a named gateway in the admin verify action — rather than being silently mis-paid
or mis-verified. Draining in-flight attempts before switching provider is an
operational requirement, not something the code can remove.

## 11. Open questions for Moyasar

Written on 2026-08-24, before the provider was chosen. Answers are marked with
their evidence; the rest are still open. New questions are at the end.

1. **Does the invoice hosted page offer mada, Apple Pay and STC Pay for our
   account, and is that configured per-account or per-invoice?** The invoice
   create body has no payment-method field. **Answered in part, 2026-11-11, by
   the owner:** mada, Visa / Mastercard and Apple Pay are enabled; STC Pay is
   not. Still open: whether Apple Pay works on the hosted invoice inside a
   third-party app's WebView (Q8).
2. **Is `payment_faild` or `payment_failed` the event type actually sent?** §6.1.
   Still open; both are accepted.
3. **Does a metadata filter on `GET /v1/invoices` fail loudly on an unsupported
   key, or silently return everything?** §9. Our code is safe either way, but the
   answer decides whether the reconciliation path is a fast lookup or a scan.
4. **Is there any idempotency mechanism on invoice creation or refunds that the
   public documentation does not describe?** §4.
5. **What is the settlement timetable, and what does the fee schedule look like
   for mada versus international cards?** Needed for financial reconciliation,
   not for the integration.
6. **Is a refund possible after settlement, and is there a time limit?**
   Partly answered from the public documentation (§3.2): refunds are made from
   `paid` or `captured` payments, partial refunds are allowed, and refunds carry
   fees. A time limit is not documented. Still open.
7. **Does the account need separate activation for live, given the 405 meaning
   in §8, and what is the process?** **Answered 2026-11-11 by the owner:** the
   account has test and live keys. The live key is shown only once an Allowed
   IP is listed (§1.0).
8. **Does the hosted invoice offer Apple Pay inside a third-party app's
   WKWebView** (`enableApplePay`, no injected scripts)? Moyasar's documentation
   is silent. Release gate on a real device.
9. **Which hosts does the 3-D Secure chain use, and can it open a new window?**
   The app allows any `https` page and keeps `setSupportMultipleWindows={false}`.
10. **What query parameters are appended to `success_url` and `back_url`?** Not
    documented. `payment-return` keeps only a strict UUID, and tolerates a second
    `?`.
11. **Is SADAD enabled for invoices on this account?** It must be off (§5).
12. **Is `lang=ar` on the invoice URL honoured?** (§3.1)
13. **Can a 3-D Secure payment still in flight when its invoice expires complete
    afterwards?** If it can, our code still confirms it, and a payment on a newer
    invoice of the same session becomes a duplicate to refund.

---

## 12. What this document does NOT establish

- That any of this works. As of 2026-11-11 nothing here has been run against the
  Moyasar account, test or live. A test publishable key is saved in the payment
  row; no key is in this repository.
- That the code is deployed. As of 2026-11-11 every deployed payment function is
  a July Tap-era bundle, and `20260824100000`, `20261003120000` and
  `20261004120000` are **not** applied (`docs/PAYMENTS.md` §1, §7).
- Anything about fees, settlement or contracts.

*History:* until 2026-11-11 the first line here said Moyasar was not the chosen
provider.

---

## 13. Related documents

| Doc | Owns |
| --- | --- |
| `docs/PAYMENTS.md` | The payment runbook: how it works, live state, owner steps, go-live checks |
| `CLAUDE.md` §5, §6 | The approval rules and the 2026-11-11 decision |
| `docs/PAYMENT_POSTPONEMENT.md` | History: the freeze, 2026-07-29 to 2026-11-11 |
| `docs/MIGRATIONS.md` | The only approved Production schema workflow (§55, §56 for the Moyasar-only files) |

The Tap API reference that this table once listed was deleted on 2026-11-11 and
is kept in git history.
