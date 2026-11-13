# Payments — Moyasar

This is where to start for anything about online payment: how it works, what
the customer sees, how staff handle a problem, and the order in which it goes
live.

**Decision (owner, 2026-11-11, in conversation):** "our payment is confirmed it
will be through moyasar / make the required edits and remove unnecessary pices
of code for other payment gateway and keep moyasar / if you miss any
integration information form moyasar ask me I can provide".

The owner's answers the same day:

- the Moyasar account has test and live keys;
- the methods enabled are mada, Visa / Mastercard and Apple Pay. STC Pay is not;
- a refund is automatic, through Moyasar;
- the order is sandbox test first, then live;
- Moyasar's live Allowed IPs list is met with a static-IP outbound proxy
  service.

**Card payments are not switched on.** The decision covers repository code,
tests and documents. Every step that reaches Production is a separate owner
approval under [CLAUDE.md §5](../CLAUDE.md), named when it is due (§7 below).
The steps up to and including the sandbox test are done (§1); the rest are not.

Other documents:

- [Moyasar API reference](integrations/Moyasar_API_Reference.md): the provider's
  contract as researched, and the open questions;
- [Order confirmation flow](ORDER_CONFIRMATION_FLOW.md): the order lifecycle,
  POS confirmation and refund enrolment;
- [Migrations](MIGRATIONS.md) §55 and §56: the two Moyasar-only migrations;
- [Payment postponement](PAYMENT_POSTPONEMENT.md): history. It recorded the
  freeze that the decision above ended.

---

## 1. Live state, read-only, 2026-11-11

> **Updated 2026-11-13, evening: the sandbox test is DONE** (§7 step 6,
> `OWNER_ACTIONS.md` §47.7-47.9). The payment row is now **enabled, in TEST
> mode**, since 18:17:02 UTC, because the sandbox refuses a disabled row; this
> supersedes the row state in the note below. **Card payments are still off:**
> `online_payment_enabled` is false, and customer checkout is refused in TEST
> mode. What remains is `OWNER_ACTIONS.md` §47.10 onwards: the proxy, live mode,
> the customer documents, the refund job, the EAS build, then online payment on.
>
> **Updated 2026-11-13: the database and function half is DONE.** The three
> payment migrations are applied (ledger rows 114-116) and the seven payment
> functions are deployed and verified byte-identical (`OWNER_ACTIONS.md` §47.4).
> So the rows below about July bundles and unapplied migrations are history.
> **Card payments are still off:** the payment row is **disabled**. Its last write
> is 2026-11-11 10:55:54 UTC, before the read below, so that read's "enabled" was
> wrong. `online_payment_enabled` is false. `refund_trigger_secret` is present on the row (length 64). What remains
> is `OWNER_ACTIONS.md` §47.7 onwards (`tap-admin-test-return` was deleted the same
> evening, §47.6): keys and webhook, sandbox, proxy, live mode, the customer documents, the refund job,
> the EAS build, then online payment on.

Read-only reads of Production on 2026-11-11, also recorded in
[CLAUDE.md §6](../CLAUDE.md). Re-read before acting on any of it.

| What | State |
| --- | --- |
| `app_settings.online_payment_enabled` | **false** since 10:56 UTC. An admin had switched it on that morning with Moyasar in TEST mode; the owner switched it off. Cash is on. |
| Payment integration row | provider `moyasar`, enabled (**wrong when written**: disabled at 10:55:54 UTC, before this read), mode `test`, a test publishable key saved. Tap leftovers (`merchant_id`, `source_id`, `transaction_expiry_minutes`) are still in `public_config`. |
| Deployed payment functions | every one is a July Tap-era bundle |
| `20260824100000_moyasar_payment_provider` | **not applied**, so `begin_payment_attempt`, `begin_session_attempt` and `payment_records.provider_checkout_ref` do not exist in Production |
| `20261003120000`, `20261004120000` | not applied (new on this branch) |
| `payment_records` | only `tap` rows: 6 failed, 3 initiated and expired, 0 paid |
| `order_refunds` | empty |
| `payment-refund-worker` cron job | disabled since 2026-07-29 (`PAYMENT_POSTPONEMENT.md` §3) |
| `refund_trigger_secret` | **not in Vault** (no Vault secret named like it). A names-only read on 2026-11-11 listed the key on the payment row (`BACKUP_RECOVERY.md` §4.3); its value was not read, so whether it is non-blank is unknown. Check it by length (`OWNER_ACTIONS.md` §47.16). No console field sets it. |

Because the functions are July bundles and the migration is missing, online
payment cannot work in Production today, whatever the settings say.

---

## 2. How an online payment works

The customer pays on **Moyasar's hosted invoice page**. No card data reaches our
servers: Moyasar's terms forbid it
([API reference §1.1](integrations/Moyasar_API_Reference.md)).

1. The app opens a **checkout session**. No order exists yet.
2. The app calls **`payment-initiate`** with the session id and the customer's
   language. The function reads the session through the customer's own client,
   so RLS proves ownership and the total comes from the server.
3. `payment-initiate` opens a payment **attempt** (`begin_session_attempt`) and
   creates a Moyasar **invoice** (`POST /v1/invoices`) for that total, in
   halalas. It stores the invoice id, then hands the app the invoice's hosted
   URL.
4. The app shows that page in its **in-app payment WebView**. The customer pays
   there: card, mada or Apple Pay, with any 3-D Secure step.
5. Moyasar sends the browser to our **`payment-return`** page (the invoice's
   `success_url` and `back_url`). The WebView stops at that URL and hands control
   back to the app. Nothing in the URL is trusted.
6. The app calls **`payment-verify`**. The server fetches the invoice and its
   payment from Moyasar with its own secret key, checks that the payment belongs
   to this attempt, and only then creates the order, already paid
   (`finalize_checkout_session`). The order then goes to the POS.
7. In parallel, Moyasar may call **`payment-webhook`**. The webhook is only a
   nudge: it carries a `secret_token`, which decides whether we look. The server
   then re-fetches the payment itself and runs the same confirmation. A webhook
   body is never evidence of payment.

### Two ids

| Id | Where it is stored | When it exists |
| --- | --- | --- |
| Moyasar **invoice** id | `payment_records.provider_checkout_ref` | when the attempt opens |
| Moyasar **payment** id | `payment_records.provider_ref` | once the customer pays |

A refund goes to the payment id. `order_refunds.charge_ref` is filled from
`provider_ref`, so the refund stack receives the right id.

### What confirms a payment

A payment confirms only when Moyasar reports it `paid` or `captured`, and every
bound field matches the stored attempt: the payment's `invoice_id` equals the
stored invoice id, the amount matches in halalas, the currency matches, and the
webhook's `live` flag (when present) matches the attempt's mode. The secret key
is chosen by the **attempt's** stored mode. Detail: API reference §7.

### Amounts

- Moyasar takes **minor units**: 1.00 SAR is `100`. The conversion lives in one
  place, `toMinorUnits()` in `supabase/functions/_shared/moyasar.ts`. Moyasar
  also REPORTS amounts in minor units, so anything that shows one of its amounts
  must convert it back. The console's sandbox result does, with
  `formatMoyasarMinorAmount()` (`src/lib/moyasarAdminTest.ts`), whose currency
  table a test holds to the server's. Until 2026-11-13 it printed Moyasar's raw
  `100` as "100 SAR" for the 1.00 SAR test invoice.
- The smallest invoice Moyasar accepts is **1.00 SAR**. A total from 0.01 to
  0.99 SAR (points can leave one) is refused **before** any attempt opens:
  `payment-initiate` answers `{status:'disabled', reason:'amount_below_minimum'}`
  and retires the session. The database refuses it too
  (`20261003120000`, `begin_*_attempt`).
- **At most 50 of one item per line.** `begin_session_attempt` refuses a
  session whose snapshot has a bigger line, with 23514, before an attempt is
  opened or reused. `insert_order_from_snapshot` writes those lines only after
  the charge is captured, so this is the one place the cap can stop a payment.
  It matches the cash cap in `place_customer_order` (`20261005120000`).
  `payment-initiate` answers its generic "Could not start the payment". The
  app's stepper stops at 50 once the cash-cap change (PR #445) ships, so an
  honest customer will not reach it.

### No invoice outlives its attempt

An invoice ends one minute before its attempt does (`invoiceExpiryForAttempt`).
An attempt with under three minutes left (the invoice would live less than
two) is closed without an invoice, and the next start opens a fresh one. The invoice lifetime is the console's "invoice
expiry" field: 30 minutes by default, held between 5 and 60.

### An attempt stays open after a declined card

A declined, voided or failed **payment** does not close its attempt. The
invoice is still payable, so the customer can try another card, or Apple Pay, on
the same page, and a resumed session reuses the same invoice. Only an
**invoice** that Moyasar has closed (`expired` or `canceled`) ends an attempt,
or the attempt's own expiry.

So after a decline the invoice still reads `initiated`; only the payment inside
it reads `failed`. The sandbox showed exactly this on 2026-11-13: the decline
card left its invoice `initiated` (`OWNER_ACTIONS.md` §47.9).

### The checkout URL handed to the app

Only `https` on `moyasar.com` or a subdomain of it. Moyasar's documented example
uses `http://`, which is upgraded. Anything else (another host, a port,
credentials, another scheme) answers 502; a newly created invoice's attempt is
also closed.
`payment-initiate` sets `lang=ar` or `lang=en` on the URL. That parameter is not
documented by Moyasar; a page that ignores it is unharmed.

### Where the code is

| Piece | File |
| --- | --- |
| Start a payment | `supabase/functions/payment-initiate/` |
| Verify (what the app trusts) | `supabase/functions/payment-verify/` |
| Webhook | `supabase/functions/payment-webhook/` |
| Return page | `supabase/functions/payment-return/` |
| Refund worker | `supabase/functions/payment-refund/` |
| Admin status and sandbox test | `supabase/functions/payment-test-config/`, `payment-admin-test-return/` |
| Amounts, config, binding, statuses, duplicates | `supabase/functions/_shared/moyasar.ts` |
| Fetch and confirm | `supabase/functions/_shared/moyasarVerify.ts` |
| Refund classification | `supabase/functions/_shared/moyasarRefund.ts` |
| Every request to Moyasar (proxy) | `supabase/functions/_shared/moyasarHttp.ts` |
| App: payment WebView screen | `apps/mobile/src/app/payment/checkout.tsx` |
| App: WebView navigation policy | `apps/mobile/src/features/checkout/webviewPolicy.ts` |
| App: interrupted-payment recovery | `apps/mobile/src/features/checkout/pendingSession.ts` |
| Console: payment card, panel, receipt | `src/components/admin/IntegrationCard.tsx`, `MoyasarPaymentPanel.tsx`, `view/orders/PaymentDetails.tsx` |
| Console: Online Payment switch guard | `src/lib/onlinePaymentGate.ts` |

---

## 3. TEST mode and LIVE mode

**Customer checkout is refused in TEST mode.** `payment-initiate` answers
`{status:'disabled', reason:'test_mode'}`. It checks the configured mode before
opening anything, and the attempt's stored mode after, because a reused attempt
keeps the mode it was opened in. The app shows "Online payment is unavailable
right now."

**A TEST-mode attempt never confirms an order.** If one reaches confirmation
anyway, it is marked `failed` with `failure_code = 'test_mode_attempt'` and the
customer is told `payUnknown` ("We could not confirm the payment…"). This is the
second line. It exists because Moyasar's sandbox settles a test invoice exactly
as live settles a real one, so a published test card could otherwise mark a
real order paid.

**The sandbox is the console's admin test.** Integrations → Payments → Moyasar
panel → **Run** creates a 1.00 SAR test invoice that is linked to no order and
opens it in a new browser tab. **Check** reads the result back and shows the
amount in riyals (`1.00 SAR`). It needs the row **enabled**, provider `moyasar`
and mode `test`; with the row disabled, Run answers "Enable Moyasar first."
Enabling the row in TEST mode lets no customer pay: the Online Payment switch
stays off, and `payment-initiate` refuses customer checkout in TEST mode. It never touches an order,
`payment_records`, the POS or the app.

**The console's Online Payment switch opens only for a live, enabled Moyasar
row** (Settings → Payment Methods). Switching it off is always allowed. This
guards the console control, not the setting: `set_payment_settings` checks
`is_admin()` alone, so a direct RPC call can still turn it on. What keeps a
customer from paying in TEST mode is `payment-initiate`'s refusal.

**The web build (`/app`) never offers online payment.** The app hides the online
option on `web`, because the hosted page needs the in-app WebView. This takes
effect when the branch is merged, because the web build deploys with every
merge ([CLAUDE.md §13](../CLAUDE.md)).

---

## 4. What the customer sees

The app keeps the checkout session id on the phone before it opens the payment
page. Before **every** order, cash included, it asks `payment-verify` about a
saved session. Only `paid` or a terminal answer lets it go. Anything else
resumes that session and places nothing, so a payment in flight is never paid
twice.

| `payment-verify` answers | App shows | Session |
| --- | --- | --- |
| `paid` (with order id) | the receipt | cleared |
| `pending` | "Payment is still pending." (or "Payment was not completed. You can continue or try again." after the customer closed the page) | kept |
| `failed` | the server's message, for example "Your payment was declined…" | cleared |
| `cancelled` | "Payment was not completed." | cleared |
| `expired` | "The payment session expired. Please try again." | cleared |
| `failed` with `payUnknown` | "We could not confirm the payment. Please contact support if an amount was deducted." | cleared |

When `payUnknown` is used:

- a payment Moyasar reports paid that we did **not** confirm (a binding
  mismatch, or a TEST-mode attempt). It used to carry `paySuccess`, so the app
  showed "Payment successful" on a failed dialog;
- a payment that was refunded before it was confirmed.

**`refunded` is never sent to the app.** `payment-verify` maps it to `failed`
(`verifyAnswerStatus`). Builds already in customers' hands treat only `failed`,
`cancelled` and `expired` as terminal, so `refunded` kept them resuming a dead
session and refusing every order. The new build also treats `refunded` as
terminal, in case it ever arrives.

**A session that never got a usable invoice is answered terminal.** No Moyasar
attempt, a closed attempt with no invoice, or an open attempt with no invoice on
a session that is over: `expired` once the session is over, else `cancelled`.
A failed database read answers `pending`. This decision is made before the
payment configuration is read, so a disabled gateway cannot keep a dead session
alive.

**Older invoices are asked before a terminal answer.** A session can hold
several attempts. Before any answer that lets the app drop the session, and
while the newest attempt has no invoice, `payment-verify` asks up to **five**
older invoice-carrying attempts, newest first:

- `paid` always confirms;
- a payment in flight, or Moyasar unreachable, keeps the session only while it
  is still payable;
- a captured payment where only **our** read failed stays `pending`, live or
  not;
- an invoice nobody paid, a decline, a closed invoice, a refund or a mismatch
  is ignored.

It then reads the session once more, and answers `paid` if an order now exists.

**A total under 1.00 SAR.** The new build clears the saved session and says
"Online payment needs a total of at least 1.00 SAR. Use fewer points, or pay in
cash." Older builds show "Online payment is unavailable right now."; the server
retires the session, so `payment-verify` then answers it terminal.

**Place order waits for a payment run.** In the new build, Place order does
nothing while an online payment run (for example "Try again" from the status
dialog) is in flight. Older builds keep a short window here; see §12.

---

## 5. The app's payment WebView

One transport. The hosted page always opens in the in-app WebView
(`/payment/checkout`), whatever mode the server reports. The system auth browser
path and `expo-web-browser` are gone.

The navigation policy (`webviewPolicy.ts`), for every navigation in any frame:

- **complete**: our `payment-return` URL (the exact Supabase host plus
  `/functions/v1/payment-return`), or `spicymeal://payment/return` followed by
  nothing, `?` or `#`. The WebView stops and the app runs the server verify;
- **allow**: any other `https` page. That covers Moyasar's page, its 3-D Secure
  step and the card issuer's challenge page, which is on the bank's own domain;
- **block**: everything else (`http:`, `javascript:`, `data:`, other app
  schemes, any other `spicymeal://` path). Inert `about:blank` and `about:srcdoc`
  frames are allowed.

There is **no host allow-list**, on purpose: an issuer's challenge page cannot be
named in advance, and Moyasar's own SDK WebViews make the same choice. The
trade-off: a misbehaving page could send the customer to any `https` page inside
the WebView.

The screen sets `enableApplePay` (iOS), drops `sharedCookiesEnabled`, injects no
JavaScript, and keeps `setSupportMultipleWindows={false}`. Apple Pay inside a
third-party app's WebView on Moyasar's hosted invoice is **not confirmed by
Moyasar** (§11), so it is a device release gate.

These changes reach customers only in the next EAS build. Builds already in the
field open the hosted page in the system browser in LIVE mode, which works with
Moyasar but without Apple Pay.

---

## 6. Refunds

### What is automatic, and what is not

The refund worker (`payment-refund`) refunds orders that were **paid but
provably never reached the branch**. Postgres decides that
(`order_refund_due()`, [Order confirmation flow §6](ORDER_CONFIRMATION_FLOW.md)),
not the worker.

**Not covered today:**

- **A cancelled paid order that the branch accepted.** It gets no refund row.
  The 2026-11-12 review reproduced this on a local chain. It predates this
  change. The owner's answer "Automatic via Moyasar" therefore is not yet fully
  implemented; covering it needs an owner decision and its own change.
- **A duplicate payment** (§10). Nothing refunds it automatically.

Either one is refunded by hand in Moyasar's dashboard today. That is a live
money action and an owner approval (§5 of CLAUDE.md).

### How the worker runs

1. The `payment-refund-worker` cron job (every 5 minutes, **disabled since
   2026-07-29**) calls `invoke_payment_refund_processor()`.
2. The driver returns without sending unless: exactly one payment row, enabled,
   provider `moyasar` (after `20261003120000`; before it, the gate is `tap`),
   a non-blank `secret_config.refund_trigger_secret` on that row, and the
   `lazywait_sync_project_url` Vault secret.
3. It POSTs to `payment-refund` with the secret in the `x-refund-secret` header.
   `payment-refund` reads the same `refund_trigger_secret` from the payment
   row's `secret_config` and compares it in constant time. Without it the
   function answers 503 and does nothing.
4. The worker claims up to 5 refunds, one at a time, and sends
   `POST /v1/payments/{payment id}/refund` with the amount in halalas.

**Settled 2026-11-13: `refund_trigger_secret` is present on the payment row**
(read by length only: 64). The paragraph below is the 2026-11-11 position.

**`refund_trigger_secret` may not exist.** It is not in Vault (read-only,
2026-11-11). Whether the payment row's `secret_config` still holds one from July
was not read. No migration creates it and no console field sets it. Checking for
it (by presence, never by printing the value) and generating it if it is missing
are owner steps. Generate it inside Postgres so it never crosses a terminal, the
method `docs/OWNER_ACTIONS.md` §28 records for the alert-dispatch secret.

### Ambiguous outcomes

Moyasar documents no idempotency key for refunds. So the worker asks before it
acts: any re-attempt reads the payment first (`status`, cumulative `refunded`,
`refunded_at`) and only POSTs if nothing was refunded. A lookup that fails
releases the row untouched. A refund timestamp whose amount does not reconcile
is parked as `failed` with `refund_ambiguous_needs_review`. Detail: API
reference §4.

A row naming any provider other than `moyasar` is finalized `failed` with
`unsupported_provider`, never sent. `order_refunds` held no rows when Tap was
removed.

### Allowed IPs refusal

A 401 whose message names the IP allow-list is classified `pending` with
`failure_code = 'moyasar_ip_not_allowed'`, and the claim is released, the same
path as a 429 or a 5xx. The order stays `refund_state = 'pending'` and does not
appear in `list_failed_order_refunds()`. **There is no attempt cap**: until the
proxy and Allowed IPs are fixed, every cron run claims and releases it again.
Each line logs `moyasar_request_refused` with the remedy. A plain 401 (a bad
key) is a definitive failure.

---

## 7. Going live: the order of steps

Each numbered step is a **separate owner approval**, named when it is due.
Approval for one is not approval for the next. Nothing here has been done.

1. **Apply `20260824100000_moyasar_payment_provider`**, named by version.
2. **Apply `20261003120000_moyasar_only_payments`**, named by version. It refuses
   to apply before step 1. It adds the loyalty multi-spend guard and the
   1.00 SAR minimum to the attempt RPCs, switches the refund driver's gate to
   Moyasar, refuses a second paying payment for an order under the order lock,
   and relabels the health card and alerts. Detail: [Migrations §55](MIGRATIONS.md).
3. **Deploy the seven payment functions as one set**: `payment-initiate`,
   `payment-verify`, `payment-webhook`, `payment-return`, `payment-refund`,
   `payment-test-config`, `payment-admin-test-return`. An old bundle beside a new
   one can open an invoice that nothing confirms. The deploy workflow's `all`
   preset is this set ([Deploy](DEPLOY.md), [Owner actions §15](OWNER_ACTIONS.md)).
   Until this step, the console's Moyasar panel says "Deploy the Moyasar payment
   functions first."
4. **Apply `20261004120000_drop_tap_payment_rpcs`**, named by version, **only
   after** step 3. It refuses to apply before step 2. Detail: [Migrations §56](MIGRATIONS.md).
5. **Delete the retired `tap-admin-test-return` function.** Done 2026-11-13.
6. **Sandbox test** (§9, part A), with test keys and the test webhook. Done
   2026-11-13 (`OWNER_ACTIONS.md` §47.7-47.9).
7. **Choose the proxy service and set `MOYASAR_PROXY_URL`** (§8.1), after the
   sandbox test, so a bad value cannot be mistaken for a sandbox failure. An
   **invalid** value refuses every Moyasar call, TEST included.
8. **List the proxy's IPs in Moyasar's Allowed IPs** (§8.1).
9. **Switch the payment row to live, then enter the live keys and the live
   webhook token** in the console, register the live webhook, enter its
   verification code (§8.2), and run Test connection in LIVE mode. The card asks
   for confirmation before switching.
10. **Keep the payment row enabled.**
11. **Update the customer documents, before customers can pay by card:** name
    Moyasar in `privacy_policy`; update `payment_policy` and
    `cancellation_refund_policy`, which both still say payment is cash only and
    promise to change before an online option appears; correct
    `terms_conditions`, whose payment clause also says cash only; re-decide the App Store
    "Financial Info" and Play "Payment info" answers; change the cash-only
    listing claim C-CASH; and stop the App Review notes saying card payment is
    off ([Owner actions §47.15](OWNER_ACTIONS.md)).
12. **Make sure `refund_trigger_secret` exists (generate it if not) and
    re-enable the `payment-refund-worker` cron job** (§6).
13. **Ship the EAS build** that carries the app half (§5).
14. **Turn on Online Payment** (Settings → Payment Methods).
15. **The small live payment and its automatic refund** (§9, part B). That is a
    real payment and a real refund.

This is the order of [Owner actions §47](OWNER_ACTIONS.md), which has the detail
of each step. Step 15 needs step 12, or the refund will not run, and every step
before 14 must be done before customers can pay.

---

## 8. Live prerequisites

### 8.1 Allowed IPs and the proxy

**Why.** In LIVE, Moyasar accepts secret-key calls only from addresses on
Dashboard → Settings → API Keys → **Allowed IPs**. At least one address must be
listed, and the live key stays hidden until one is. Any other address gets 401
"This IP Address is not whitelisted to do this operation". Supabase Edge
Functions have no static outbound IP (Supabase knowledge base). TEST keys are
not restricted unless the merchant restricts them.

**How the code meets it.** Every Moyasar request goes through
`moyasarFetch()` (`_shared/moyasarHttp.ts`). When the Edge Function secret
**`MOYASAR_PROXY_URL`** is set (an `http://` or `https://` URL, optionally with
`user:pass@`), every call goes through that proxy with
`Deno.createHttpClient({ proxy })`. The target is `https`, so the proxy only
tunnels and never sees the secret key. Unset, calls are direct.

- **`HTTPS_PROXY` does not work as a function secret.** The runtime reads it
  from the process environment, while function secrets live in a per-worker map.
- A value that cannot be used (another scheme, unparseable, or a runtime without
  `createHttpClient`) **refuses every Moyasar call, TEST included**, before
  anything is sent. Log line: `moyasar_request_refused` with
  `moyasar_proxy_invalid` or `moyasar_proxy_unsupported`.
- The proxy URL is never logged or returned. Prefer an `https://` proxy URL:
  the proxy's own credentials travel as `Proxy-Authorization`, in clear to an
  `http://` proxy.
- **Not yet proven:** Supabase does not document `createHttpClient` on hosted
  functions. The edge-runtime source has it from 1.69.0 (the comment in
  `moyasarHttp.ts` says 1.68.0, one release early). On 2026-11-13 every Edge
  Function log line of the previous 24 hours, across five regions, came from
  runtime 1.77.9. The proof is **Test connection** with the proxy set, first in
  TEST while Moyasar's TEST list still accepts any address, with a
  wrong-password check that shows the proxy carried the call
  ([Moyasar static-IP proxy](integrations/Moyasar_Static_IP_Proxy.md) §3-§4).
  An Allowed-IPs message says which route our code took (proxy, or direct
  because no proxy is set), not which address Moyasar saw.

**Owner steps** (each an approval):

1. Choose the proxy service. Get its URL and the full list of its outbound IPs.
2. Set `MOYASAR_PROXY_URL` (Supabase dashboard → Edge Functions → Secrets).
   Never paste it in chat.
3. List every outbound IP of the proxy under Moyasar Allowed IPs. Saving asks
   for a 6-digit code.
4. After the deploy and the live keys, run Test connection in LIVE mode.

### 8.2 Webhook registration and the one-time verification code

Moyasar may ask for a new webhook to be verified (published by Moyasar on
2026-11-11). It sends **one** `webhook_verification` event with
`data.webhook_id`, a 6-digit `data.verification_code` and the `secret_token`.

- It is sent **once and never retried**.
- The code must be entered in Moyasar's dashboard within **30 minutes**.
- Until it is entered, the webhook receives nothing, and events from before
  that are **never delivered later**.

What our code does: `payment-webhook` checks the event's token against every
configured token slot (test, live and shared), in constant time. A match writes
one `integration_sync_logs` row and answers 200. A mismatch answers 401 and
records nothing. It is recorded even while the payment row is **disabled**, as
long as the provider is `moyasar`. The code is never logged or returned.

The console's Moyasar panel shows the newest code for 30 minutes after it
arrived, with the deadline. The code is readable by `is_staff()`, which is admin
or accountant at AAL2 (`20260810142000`).

**Order, and why it matters.** If the token is not saved first, or the old July
webhook function is still deployed, the code is refused or dropped, and a new one
must be requested:

1. Deploy the new `payment-webhook` (§7 step 3).
2. Save the webhook secret token in the console payment card (test or live
   slot).
3. Register the webhook in Moyasar (Settings → Webhooks) with the URL
   `https://<project-ref>.supabase.co/functions/v1/payment-webhook` and the same
   token. Moyasar keeps test and live separate in its dashboard, so each
   needs its own webhook and its own token slot.
4. Read the code off the Moyasar panel and enter it in Moyasar within 30
   minutes. If it is lost, request a new one in Moyasar. Moyasar's guide says a
   resend is allowed at most once a minute and five wrong entries lock the code.

The event names our code acts on are listed in the API reference §6.0 and §6.1,
including Moyasar's own spelling `payment_faild`.

---

## 9. Go-live checklist

### A. Sandbox (test keys)

Done in the console, with the payment row enabled, provider `moyasar`, mode
`test`, Online Payment **off**.

**Run 2026-11-13, 18:17-18:58 UTC** (`OWNER_ACTIONS.md` §47.9). Every box is
ticked except the 3-D Secure one: Moyasar's challenge page was completed with
the decline card, not with an approving challenge card. That path is exercised
again on real phones at go-live (part B).

- [x] Steps 1 to 4 of §7 are done.
- [x] Moyasar panel: "Key for mode (test)", "Key prefix (sk_test_)" and "Webhook
      secret (test)" all read Yes.
- [x] Test connection: "Moyasar accepted the test key. Connection OK."
- [x] Test webhook registered and its verification code entered (§8.2).
- [x] Run a sandbox invoice and pay it with the success card; Check reads it
      paid.
- [x] Run another and pay it with the decline card; Check still reads
      `initiated`, because a decline leaves the invoice payable (§2). The failed
      payment shows in Moyasar's dashboard. (Until 2026-11-13 this line said
      "Check reads it failed", which was wrong.)
- [ ] Run one with the 3-D Secure challenge card and complete the challenge.
- [x] The test webhook events arrive. A sandbox invoice has no attempt row, so
      each is acknowledged and logged in `integration_sync_logs` as
      `unknown payment` (or `admin_test payment ignored`). The console does not
      show these rows; read them with a read-only query.

What the sandbox **cannot** prove: the in-app WebView, Apple Pay, the order
being created, the POS hand-off and the refund. The admin test runs in a browser
tab and is linked to no order, and customer checkout is refused in TEST mode.
**Apple Pay cannot succeed in the admin test**: Moyasar's Apple Pay sandbox
succeeds only for 200.00 to 300.00 SAR, and the admin test invoice is fixed at
1.00 SAR.

### B. Live (a small real payment and its automatic refund)

- [ ] Steps 7 to 13 of §7 are done.
- [ ] Test connection in LIVE mode: "Connection OK".
- [ ] On a real iPhone, with a Wallet card: the Apple Pay sheet appears inside
      the payment WebView.
- [ ] On iOS and Android: a card with a 3-D Secure challenge completes inside
      the WebView.
- [ ] The Arabic hosted page appears when the app language is Arabic (whether
      `lang=ar` is honoured is unknown).
- [ ] A small live pickup order: paid, receipt shown, order reaches the POS.
- [ ] A small live order that is refunded automatically. Only an order that was
      paid and provably never reached the branch is enrolled (§6). Agree with
      the owner how to produce one before trying.
- [ ] `payment_records` holds exactly one `paid` row for each test order, and no
      `duplicate_payment` row.

---

## 10. Duplicate payments — finding and refunding them

**What it is.** A second settled payment for a checkout or an order that another
payment already paid. Examples: a payment on an older invoice that settles late,
or two payments confirmed at the same moment. It is never reported paid and
never confirms anything. It is recorded so it can be refunded:

- a `payment_records` row with `status = 'failed'`,
  `failure_code = 'duplicate_payment'` and the note "Duplicate payment: the
  order was already paid. Refund this payment." Its `provider_ref` is the
  Moyasar payment id to refund. It carries the order id when one is known, and
  on the session flow the checkout session id (on the order flow
  `checkout_session_id` is null);
- one `integration_sync_logs` row: provider `moyasar`, direction `webhook`,
  status `failed`, `error = 'duplicate_payment'`, with the payment id and the
  session or order in `request`. If the payment row could not be written, this
  row is the only record.

The order-first race is decided under the order's row lock
(`confirm_order_payment`, `20261003120000`): a second paying payment raises
`order_already_paid_by_another_payment`, and the losing payment becomes the
record.

**Nothing refunds a duplicate automatically.** Making it automatic needs an owner
decision. Nothing alerts on it either: no watchdog rule or alert reads
`duplicate_payment` (the watchdog's double-capture rule counts `paid` rows, and a
duplicate is `failed`).

**Finding them.** The console has no list of them. The order receipt shows only
the **newest** payment row for an order, so it may show the duplicate or hide it,
and a duplicate with no order id appears on no receipt. Use a read-only query:

```sql
select id, order_id, checkout_session_id, provider_ref as moyasar_payment_id,
       amount, currency, mode, created_at, last_verified_at
from public.payment_records
where provider = 'moyasar' and failure_code = 'duplicate_payment'
order by created_at desc;

select created_at, order_id, request, error
from public.integration_sync_logs
where provider = 'moyasar' and error = 'duplicate_payment'
order by created_at desc;
```

**Refunding one.** In Moyasar's dashboard, find the payment by its id and refund
the amount shown. That is a live money action and needs owner approval each
time. Afterwards there is no column to mark the row refunded; record what was
done (date, payment id, who) in the incident notes. Never refund the payment on
the `paid` row.

---

## 11. Open questions

For Moyasar support:

1. Does the hosted invoice offer **Apple Pay inside a third-party app's
   WKWebView** (`enableApplePay`, no injected scripts)? A native Apple Pay sheet
   would be a second integration (the Payments API).
2. Which hosts does the **3-D Secure chain** use, and can it open a new window?
   The app allows any `https` page and keeps `setSupportMultipleWindows={false}`.
3. What query parameters are appended to **`success_url` and `back_url`**? They
   are not documented. `payment-return` tolerates a second `?`.
4. Is **SADAD** enabled for invoices on this account? It must be off: a SADAD
   bill leaves the invoice `on_hold` for days (read as pending) and cannot be
   refunded.
5. Is **`lang=ar`** on the invoice URL honoured?
6. Can a 3-D Secure payment still in flight when an invoice **expires** complete
   afterwards?
7. Which failure event name is actually sent, `payment_faild` or
   `payment_failed`? Both are accepted.

For Supabase: which edge-runtime version hosted functions run, and whether
`Deno.createHttpClient` with a proxy is supported there (§8.1).

For the owner:

- automatic refund of a duplicate payment (§10), and of a cancelled paid order
  the branch accepted (§6);
- whether a refund refused by Allowed IPs should stop after some number of
  attempts;
- whether `set_payment_settings` should also refuse Online Payment unless the
  row is live (a migration);
- whether the webhook verification code may stay readable by accountants;
- whether to cancel the previous invoice at Moyasar when a new attempt opens
  (`PUT /v1/invoices/{id}/cancel`).

---

## 12. Residual risks

Recorded by the changes on `feat/moyasar-only-20261111` and their review.

- **Old app builds, Place order during "Try again".** Builds already in the field
  leave Place order enabled while a payment run started from the status dialog
  is in flight. A cash order placed in that window can sit beside a payable
  invoice: two orders, one paid. Fixed in the new build only.
- **Late payment on an older invoice.** If Moyasar lets a 3-D Secure payment
  complete after its invoice expired (unknown, §11 Q6), the webhook and verify
  still confirm it. If the customer has meanwhile paid a newer invoice on the
  same session, the second is recorded as a duplicate and must be refunded by
  hand.
- **Duplicates are manual.** See §10.
- **Allowed IPs refusal has no attempt cap** (§6).
- **The Online Payment guard is console-only** (§3).
- **The webhook verification code is accepted while the row is disabled**, by
  design, because it is sent once. Anyone holding a configured token can make the
  console show a fake code.
- **Proxy support is unproven on hosted Supabase** until Test connection runs
  with the proxy set (§8.1), although the runtime measured on 2026-11-13 (1.77.9)
  has it in its source. If it is missing, every Moyasar call fails closed with
  `moyasar_proxy_unsupported`.
- **Apple Pay in the WebView is unconfirmed** (§11 Q1).
- **The WebView allows any `https` page** (§5).
- **The console's "configured" badge on Moyasar secret fields is row-level.**
  Tap's July keys still in `secret_config` make every secret field read
  configured even when it is empty. Read the Moyasar panel's rows instead.
- **Payment errors can reach the customer in English.** `payment-initiate`'s
  error text is shown as it is, and it is written in English only
  (`docs/OWNER_ACTIONS.md`).
- **Only five older invoices are asked** per verify. A session rarely holds
  more than two.
- **If Moyasar serves the hosted page from another domain**, online payment
  fails closed until the URL rule is updated (§2).

---

## 13. Arabic that needs a native read

All engineering-drafted.

Customer-facing:

- `payBelowMinimum`: «يتطلب الدفع الإلكتروني ألا يقل الإجمالي عن 1.00 ريال. استخدم نقاطاً أقل، أو ادفع نقداً.»
- payment screen footer: «تُدخل بيانات بطاقتك في صفحة Moyasar الآمنة.»
- web stand-in: «يمكنك إكمال طلبك عبر الموقع والدفع نقدًا.»

Staff-facing: the Moyasar panel, payment card, receipt and Settings strings
added on 2026-11-11 (in `MoyasarPaymentPanel.tsx`, `PaymentDetails.tsx`,
`SettingsPanel.tsx` and the alert and health labels).
