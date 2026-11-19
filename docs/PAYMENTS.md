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
> mode. What remains is the card-payment gap fixes and decisions
> ([the card-payment gaps](readiness/20261113-card-payments-gaps.md): 31 verified
> gaps, 12 to fix before card payments go live and 9 to decide; the app-side
> fixes before §47.17) and `OWNER_ACTIONS.md` §47.10 onwards: the two emails and
> the proxy, live mode, the customer documents, the refund job, the EAS build,
> then online payment on.
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

### The older order-first path, and why it can no longer pay a cancelled order

`payment-initiate` also accepts an `orderId`: pay for an order that already
exists, unpaid, with `payment_method = 'online'`. The app has not used it since
the checkout-session flow (above); it remains for the orders it was built for.
Live on 2026-11-14 (read-only), the only unpaid online orders are three
cancelled ones from 2026-07-12, on one account.

`20261012120000_cancelled_orders_guard` (written 2026-11-14, **applied 2026-11-14
17:27:37 UTC**, `MIGRATIONS.md` ledger row 117) closes it from both ends, with no
deploy:

- **No new order-first orders.** `place_customer_order`, the RPC every signed-in
  customer may call, refuses an online order (gap PG-27). The app sends `cash`
  there.
- **No invoice for a cancelled order.** `begin_payment_attempt` refuses one
  (P0001 `Order is cancelled`) before it reuses or opens an attempt.
  `payment-initiate` answers that with a 400, *Could not start the payment.
  Please try again.*, and never reaches the invoice create
  (`paymentWiring.test.ts` pins it). This is what makes the
  `OWNER_ACTIONS.md` §47.13 warning about the three July orders go away, once
  the file is applied. Applying it before §47.13 step 1 is recommended, not
  required: §47.13 also lists a live write to the three orders, or accepting the
  risk, and which to take is the owner's. Until one of them is done, the
  TEST-mode refusal is what keeps them unpayable.

`place_order` and `compute_order_snapshot` are unchanged
(`12b6816d…` / `22e2d429…`), and the file asserts it.

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
| Post-payment POS handoff (kick + online-payment attach) | `supabase/functions/_shared/paymentSync.ts` |

**How a card payment reaches the POS (2026-11-19).** Two things tell
Lazywait about it:

- **`is_paid` on Create Order (#503, `lazywait-sync`).** The ticket is created
  already marked paid, and only for a certain payment: an online order the row
  says is paid **and** a `payment_records` row with status `paid`. This makes
  the receipt print "Paid".
- **`POST /pos/orders/update-online-payment` (`pushLazywaitOnlinePayment`).**
  This records the payment itself: the amount, Moyasar's payment id and the
  payment type. Without it, the POS list shows paid 0.00 and no payment type.
  - It was refused with HTTP 400 on every card order from 2026-11-18 13:23 UTC.
  - On 2026-11-19 the payment type changed from the bare `card` to **"Online
    Credit Card"**, the owner's choice.
  - A refusal now logs Lazywait's own code and message (`paymentPushError`), so
    the next one says why. The first test after that (06:33 UTC) still read only
    `payment_push_400 HTTP 400`: Lazywait's 400 reply has no `message` field,
    so the client's generic fallback hid it. Since the next change the raw reply
    body is logged in that case, whitespace collapsed, long digit runs masked,
    bounded to 240 characters.

**The post-payment kick uses the publishable key (2026-11-18, #487).**
`triggerLazywaitSyncOnce` used to send `SUPABASE_ANON_KEY` as `apikey` on its
kick of `lazywait-sync`. After the legacy keys are deactivated, the gateway
refuses that. It now sends `publishableKey()`, as `order-intake` does, and skips
the kick when there is no publishable key. `paymentSyncKick.test.ts` executes
it. The fix reaches Production only when the four payment functions that bundle
the file (`payment-initiate`, `-verify`, `-webhook`, `-test-config`) are
redeployed, which is a separate live owner action
(`SUPABASE_API_KEYS.md` §5). Until then the live bundles keep the old kick. With
online payment on, the cron picks the paid order up within about a minute.

**The POS handoff runs after the answer (2026-11-18).** Once a payment is
confirmed, the POS kick and the online-payment attach used to run **before**
`payment-verify` (and the webhook) answered. Measured on SM-2026-000099:

- the order existed at 13:23:20.5 UTC;
- the app got its answer at 13:23:35.6.

So the customer watched a spinner for 15 s, waiting on the POS, although the
receipt does not depend on it: it shows "sending to the branch" until the POS
answers.

`runAfterResponse` (`_shared/paymentSync.ts`) now hands that work to
`EdgeRuntime.waitUntil`, the shape `lazywait-sync` and `account-delete-request`
already use. The work still runs, in the same order and with the same
best-effort handling. Where the platform has no `waitUntil`, it is awaited as
before, never skipped. If it dies, the once-a-minute sync and the reaper pick
the order up, exactly as they do for a POS hiccup today.

`paymentPosTiming.test.ts` drives the real webhook with the POS held open and
asserts that `paid` comes back first. It then asserts that the kick and the
attach follow.

This reaches Production only when `payment-verify` and `payment-webhook` are
redeployed (a separate owner action).

**Function calls run next to the database (2026-11-18).** The project's
database is in Frankfurt (`eu-central-1`). Supabase runs an Edge Function in the
region nearest its **caller** unless told otherwise. For customers in Saudi
Arabia, and for Moyasar's webhook, that was Mumbai (`ap-south-1`), so every
database round trip inside a function crossed Mumbai-Frankfurt.

Average execution, measured over the 24 h to 2026-11-18 14:40 UTC:

| Function | Frankfurt | Mumbai |
| --- | --- | --- |
| `lazywait-sync` | 0.65 s (1 439 runs, pg_cron) | 5.7 s (6 runs) |
| `push-dispatch` | 1.1 s | 3.2 s |
| `order-intake` | none | 7.9 s |
| `payment-verify` | none | 3.4 s |
| `payment-initiate` | none | 2.3 s |

Every app call landed in Mumbai.

Calls are now pinned to Frankfurt with Supabase's `forceFunctionRegion` query
parameter (https://supabase.com/docs/guides/functions/regional-invocation):

- **The app** (`apps/mobile/src/lib/functionRegion.ts`): every
  `supabase.functions.invoke` name goes through `regionalFunction()`, and a
  test fails on any call that does not. Only the query parameter is used.
  supabase-js's own `region` option also sends an `x-region` header, which our
  CORS allow-list does not include, so the web build's preflight would refuse
  it. This ships with the next app build, and with the next web deploy for
  `/app`.
- **Function-to-function calls** (`_shared/functionRegion.ts`): the POS kick
  from `order-intake` and from a confirmed payment, and the `push-dispatch`
  drain from `lazywait-sync`. This takes effect when those functions are
  redeployed.
- **Moyasar's webhook** arrives from Moyasar and cannot carry the parameter
  unless its URL does. Adding `?forceFunctionRegion=eu-central-1` to the webhook
  URL in the Moyasar dashboard pins it too. This is an owner action. Since
  2026-11-18 the customer no longer waits on the webhook (`payment-verify`
  answers first), so it is optional.

A pinned region is not re-routed during a regional outage. That costs nothing
here: the database is in that region, so an outage there stops the functions
wherever they run.

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
Enabling the row in TEST mode lets no customer pay unless the testing-phase
switch below is on: without it, `payment-initiate` refuses customer checkout in
TEST mode. The sandbox itself never touches an order,
`payment_records`, the POS or the app.

**The console's Online Payment switch opens for an enabled Moyasar row in live
or TEST mode** (Settings → Payment Methods). TEST mode was added 2026-11-18 for
the testing phase; before that it opened only for a live row. Switching it off
is always allowed. This
guards the console control, not the setting: `set_payment_settings` checks
`is_admin()` alone, so a direct RPC call can still turn it on. What keeps a
customer from paying in TEST mode is `payment-initiate`'s refusal, which only
the testing-phase switch below lifts.

**The web build (`/app`) never offers online payment.** The app hides the online
option on `web`, because the hosted page needs the in-app WebView. This takes
effect when the branch is merged, because the web build deploys with every
merge ([CLAUDE.md §13](../CLAUDE.md)).

### The testing-phase switch: `PAYMENT_ALLOW_TEST_CHECKOUT`

**For the testing phase only. It MUST be unset (or deleted) before card
payments go live.** Added 2026-11-18 at the owner's request, so test orders can
be paid in the mobile app with Moyasar's test cards (`OWNER_ACTIONS.md` §60).

It is an Edge Function secret. **Only the exact string `true` turns it on.**
`TRUE`, `1`, an empty value or no secret at all leave both refusals above
exactly as they are, which is the production default. It is read on every
request by `allowTestModeCheckout()` in `_shared/paymentTestCheckout.ts`.

With it on:

- `payment-initiate` lets a customer pay an order or a checkout session while
  the gateway is in TEST mode. The invoice is opened with the TEST key, so only
  Moyasar's test cards pay it;
- the confirmation (`validateAndConfirmMoyasarPayment`, reached by
  `payment-webhook`, `payment-verify` and the console's re-verify) confirms a
  TEST attempt exactly as it confirms a live one;
- each one writes a log line, `{"event":"payment_test_mode_allowed", …}`.

What it does **not** change: live mode, the 1.00 SAR minimum, the checkout-URL
check, refunds, the console's sandbox (its invoices have no attempt row, so they
never reach confirmation). The console's Online Payment switch, which the app
needs on before it offers card payment, can be turned on in TEST mode since the
same change (`OWNER_ACTIONS.md` §60, step 4).

**One check stays on even with the switch on.** A TEST attempt is handed out
only while the gateway is still configured in TEST. An attempt opened in TEST
and reused after the gateway is switched to live is refused, so a test card
cannot pay a real order on a live gateway. A TEST attempt that already has an
invoice can still be confirmed until the switch is unset, which is why the
secret is unset **before** the switch to live (§9 B).

**A test order is a real order.** It is created paid, goes to the branch POS
like any card order (a real kitchen ticket), earns loyalty points on delivery,
and appears in reports and `payment_records` with `mode = 'test'` (the console
labels such a record "Test payment"). Cancelling a paid one refunds it through
Moyasar with the TEST key, which moves no real money.

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

### After a failed payment, and choosing the method (2026-11-19)

The dialog's actions depend on the state:

- **`failed`, `cancelled` or `expired`:** Try again, **Pay in cash instead**
  (only while cash is offered), Contact support and Close.
- **Pending, or an error that may still settle:** no cash button. A cash order
  placed beside a card charge that could still go through could be paid twice.
- **Pay in cash instead:** it selects cash and closes the dialog, and the
  customer still taps Place order. It never places an order by itself.
- **Contact support:** it opens Legal & support, which lists the support
  channels the console turns on. Closing the dialog keeps any saved session.

`paymentStatusDialog.test.tsx` pins this by rendering.

**No raw server text.** An error from `payment-initiate` or `payment-verify`
used to be shown word for word. The functions write their errors in English
only, so an Arabic-speaking customer read English. Now the customer sees
localized copy (offline, timeout, or the fallback) and the detail goes to Sentry.

- After a failed initiate, the fallback is `payFailed`.
- After a failed verify, the fallback is `payUnknown`, because whether money
  moved is not known.

**A returning customer's last method.**

- The app remembers each account's own last choice on the phone
  (`lastPaymentMethodStore.ts`).
- It preselects that choice only when it was **online** and online is offered
  (`rememberedPreselection`, `lib/payment.ts`).
- **Cash is never preselected**, even when it was used last. This keeps the
  2026-09-14 reason for "nothing preselected": cash is a promise to have money
  ready, while a preselected card commits the customer to nothing, because
  Moyasar's page still needs them.
- An admin default is still never a preselection.
- The memory is applied once, and never over a choice made on the screen.

**Step timings.**

- **What is sent:** one info-level Sentry message per card checkout, titled
  "card checkout timeline" (`checkoutTimeline.ts`). It carries the milliseconds
  from the Place order tap to each step: `session_begun`, `page_requested`,
  `page_ready` (the payment page's first paint), `page_left` and `verified`.
- **Its tag:** `outcome`, one of `paid`, `pending`, `failed`, `cancelled`,
  `expired`, `error` or `refused`.
- **What it never carries:** no id, amount, card detail or name.
- **When it is sent:** once, at the first outcome. A customer who leaves at the
  page is counted as `pending`.
- **Why:** until 2026-11-19 every timing in this document was measured by hand.

### A checkout the customer replaced by changing the cart

Added 2026-11-18. Until then, a customer who gave up on a card payment and then
changed their cart was shown the **old** amount for the **old** items until that
checkout expired, because an open checkout is always resumed first. Measured
that day in TEST mode: a 17.00 SAR meal checkout reopened for a 1.00 SAR cart.

The app now saves, with the session id, the cart's idempotency key: which order
the checkout is for. On entering checkout, and before every order, a session
that `payment-verify` still answers `pending` **and** that was begun for a
different cart is offered to `payment-verify` with `action: 'abandon'`. The
server drops it only when nobody has started paying it:

1. The ordinary verify answer comes first. `paid` opens the receipt; a terminal
   answer is cleared as before. Only `pending` goes on.
2. Every open Moyasar attempt on the session is judged before anything changes
   (`abandonInvoiceVerdict`). An attempt still creating its invoice, an invoice
   that cannot be read, or any payment on it that is not `failed` (a 3-D Secure
   challenge under way, or money held) **refuses** the abandon. A declined card
   leaves a `failed` payment and does not block.
3. Each open invoice is cancelled at Moyasar (`PUT /v1/invoices/{id}/cancel`),
   and the cancel's own answer must show it `canceled` with nothing in flight
   (`invoiceCancelConfirmed`). Only then is its attempt closed, with
   `failure_code` `invoice_canceled`.
4. The answer is the ordinary verify again: `cancelled`, or `paid` if a webhook
   finished a payment meanwhile. The session row itself is not written.

Every refusal answers `pending`, and the app then resumes the old checkout,
which is the behaviour before this existed. A payment in flight is still never
paid twice. A record without a cart key (saved by an older build, or by the
payment return link, which never knows the cart) is never offered for abandon.
A server without the action answers a plain verify, so an app with this change
works against an older `payment-verify` exactly as before.

Refusals log `checkout_abandon_refused` with a reason; an abandon logs
`checkout_abandoned` with the number of invoices cancelled.

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
"Online payment needs a total of at least 1.00 SAR. Turn off points for this
order, or pay in cash." Older builds show "Online payment is unavailable right
now."; the server retires the session, so `payment-verify` then answers it
terminal. Until 2026-11-14 the new build's message said "Use fewer points",
which the app cannot do: points are all or nothing, because the switch sends
the whole balance (gap PG-05). The change is on branch
`fix/checkout-points-preview-20261114` and reaches customers with the
`OWNER_ACTIONS.md` §47.17 build. Points that cover the whole order are fine:
it is settled at once, with nothing to charge. Points are the usual cause of a
total under 1.00 SAR, but not the only possible one: a fixed-amount coupon, or
an order of a single item priced near 1.00 SAR, could leave one with points
off, and then the first half of the message does not apply. Whether any live
coupon or item can do that was not measured for this change.

**The summary shows what the card page will ask for.** With points on, the
checkout summary now uses the server's own points rule: only whole points that
fit the order, and none when fewer than `min_points_to_redeem` fit (100 points
at 0.10 on 2026-11-14, so an order under SAR 10.00 before points uses none).
Until 2026-11-14 it took the balance times the point value, so a SAR 8.00
pickup order read 0.00 and Moyasar's page then asked for 8.00 (gap PG-31). The
switch now also says "Points can be used when the total before points is
10.00 SAR or more." when that is why no points are used, and a screen reader
reads it as part of the switch. `previewParity.test.ts` checks the summary
against the real `compute_order_snapshot` for 23 carts; detail in
[`LOYALTY.md`](LOYALTY.md) §1. Same branch. App customers get it with the same
build; the web checkout at `/app` gets it as soon as the branch is merged,
because a merge deploys the web build (CLAUDE.md §13).

**It uses fresh settings, and stops rather than charge what it did not show.**
Until 2026-11-17 the summary matched the server's rule only for the settings
and balance the app last loaded: `min_points_to_redeem` and
`discount_per_point` came from the settings row the app reads once at launch,
and only `loyalty_pickup_only` was re-read, at submission. Now checkout re-reads
all four redemption settings (`loyalty_enabled` too) when it opens, when the
points switch is turned on, and just before an order is placed or a card
payment is begun (`catalog.readLoyaltyRedemption`). Opening checkout and turning
the switch on also refresh the balance through the existing profile refresh.
At submission the summary is recomputed with the fresh settings, and if the
points discount, the points used or the total would differ, the screen shows
the new figures with "The points rules changed while you were checking out, so
your points discount has changed. Your points are safe — check the new total and
confirm again." and nothing is placed or paid. A failed read changes nothing and
blocks nothing: the app keeps the values it had, which is what it did before.
Detail in [`LOYALTY.md`](LOYALTY.md) §1.

**What is still not fresh:** the balance is not re-read at submission, only when
checkout opens and when the switch is turned on. Points spent on another device
in that window would make the server use fewer points than the summary shows.
On branch `fix/checkout-loyalty-settings-reread-20261117`: the web checkout at `/app` gets it when the branch is merged
(CLAUDE.md §13), app customers with the `OWNER_ACTIONS.md` §47.17 EAS build.

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
JavaScript, and keeps `setSupportMultipleWindows={false}`.

**Never an endless spinner (2026-11-19).** If Moyasar's page has not painted
20 s after the screen opens (`PAYMENT_PAGE_LOAD_TIMEOUT_MS`, `webviewPolicy.ts`),
the screen shows the load-error message with Try again and Close. Measured first
paints take about 1–2 s. A page that paints after the timeout replaces the
message. Try again restarts the wait.

**The amount is not repeated in our header.** `payment-initiate` does not
return it, and the checkout screen's figure is a preview. Moyasar's page shows
the amount it will charge, which is the authoritative one. Apple Pay inside a
third-party app's WebView on Moyasar's hosted invoice is **not confirmed by
Moyasar** (§11), so it is a device release gate.

These changes reach customers only in the next EAS build. Builds already in the
field open the hosted page in the system browser in LIVE mode, which works with
Moyasar but without Apple Pay.

---

## 6. Refunds

### What is automatic, and what is not

The refund worker (`payment-refund`) refunds two kinds of order. Postgres
decides which, not the worker:

- **paid but provably never reached the branch** (`order_refund_due()`,
  [Order confirmation flow §6](ORDER_CONFIRMATION_FLOW.md)), reason
  `pos_delivery_failed_after_customer_retries`;
- **a paid card order that is cancelled**, reason `order_cancelled`, once
  `20261018120000_refund_cancelled_paid_orders` is applied (`MIGRATIONS.md`
  §70). **Written 2026-11-19, NOT applied.** The owner's decision of
  2026-11-19: "do the auto refund". The write that makes an online order
  cancelled and paid enrols one refund for the full captured amount when a
  `paid` `payment_records` row exists, the total is above zero and the order
  has no refund yet. That covers an administrator cancelling a paid order and
  a captured payment confirmed onto an order already cancelled. A cash order, an
  unpaid order, a comped order (total 0) and an order with no paid payment row
  are never sent to Moyasar. An order cancelled before the apply is **not**
  enrolled: there is no backfill.

**The refund job was switched on 2026-11-19 at 04:47 UTC** on the owner's
approval ("do the auto refund"): cron job 6, `payment-refund-worker`, active,
with 0 refunds queued at that moment (`OWNER_ACTIONS.md` §47.16). So, once
`20261018120000` is applied, a cancelled paid card order is refunded on the
next run, within about five minutes.

**The hand procedure for cancelled orders is retired from the apply.** Until
`20261018120000` is applied, a cancelled paid order still gets no automatic
refund (the trigger has skipped cancelled orders since `20261012120000`, gap
PG-03) and is refunded by hand in Moyasar's dashboard, as before. **After the
apply, staff must not also refund a cancelled order by hand.** It would not pay
the customer twice: Moyasar's documentation says a refund is made only from a
`paid` or `captured` payment and for at most its amount (Moyasar API reference
§3.2, read from Moyasar's public documentation, not tested), so the worker's
attempt after a full hand refund is expected to be refused with a 4xx. The
worker writes that refund `failed`, and R14 `REFUND_FAILED` raises a critical
incident for a refund that was in fact made, which then stays open until
dashboard refunds are recorded (gap PG-14). A refund enrolled *before* the
order was cancelled (the POS-failure path) keeps running, and cancelling it
adds no second refund.

**What the customer reads, stated rather than buried.** An order with a refund
in progress shows the refund state, as it always has: "Sorry — we could not
send your order because the ordering service is unavailable. Your payment will
be refunded automatically." For a cancelled order that the branch did receive,
the first half is not true. Changing that copy is an app change, not part of
`20261018120000`.

**Still not automatic:**

- **A duplicate payment** (§10). Nothing refunds it automatically. **Decided
  2026-11-17 (refund draft D2): duplicates are refunded by hand** from Moyasar's
  dashboard, from the R15 listing on the "Refunds and payments needing
  attention" card. That is the design, not a gap.
- **A cancelled paid order before `20261018120000` is applied**, as above.

Either one is refunded by hand in Moyasar's dashboard. That is a live money
action and an owner approval (§5 of CLAUDE.md). **A refund made in the
dashboard is not recorded on the order yet.** The owner decided on 2026-11-17
that it should be, automatically, from Moyasar's `refunded` notification (gap
PG-14). That is its own later change; until it lands, keep the written refund
log.

### Where staff see a refund problem

**Written 2026-11-14, live since 2026-11-17**, when `20261013120000` was
applied (`MIGRATIONS.md` §65, ledger row 119). Until then, no screen and no
alert read `order_refunds`.

Since then:

- a refund that gave up (`failed`) raises the critical watchdog incident R14
  `REFUND_FAILED`, unless another refund for the same order is pending,
  processing or succeeded (only one such refund can exist per order, by the
  index `order_refunds_one_active_uq`), or the order reads refunded. The incident reaches the alert
  inbox through the Order Integrity card, and turns the payment card in
  Operations Health to failing while the payment row is enabled and
  configured;
- Live Orders shows the card "Refunds and payments needing attention" to an
  admin at AAL2. It lists those refunds under "Automatic refunds that stopped",
  and every refund tried at least once and still pending under "Refunds still
  being retried", with its attempts and the reason for its last release. It has
  no refund button: the instruction on each section is to check the payment in
  Moyasar's dashboard and refund it there by hand (§10). It is rendered only
  for the admin role, re-reads every 60 seconds, and stops re-reading after a
  refusal (an admin not at AAL2) or before the migration is applied, so a
  refused request is not sent every minute.

**Written 2026-11-17, live since `20261016120000` was applied on 2026-11-18**
(`MIGRATIONS.md` §68): a refund tried at least once and still pending raises
R18 `REFUND_STUCK`, a **warning** once it has been open more than 1 hour and a
**critical** once more than 24 hours (age from when the refund was opened). The
same incident turns critical in place. A refund stopped by the attempt cap
(below) is `failed` and raises R14 like any other.

Nothing records a refund made by hand yet (gap PG-14, decided automatic on
2026-11-17 and not built), so after one the incident and the card row stay until
that change lands.

### How the worker runs

1. The `payment-refund-worker` cron job (every 5 minutes; disabled from
   2026-07-29, **switched on 2026-11-19 at 04:47 UTC** on the owner's approval)
   calls `invoke_payment_refund_processor()`.
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

**The queue order, written 2026-11-14 (gap PG-01), live since 2026-11-17.**
Until then a claim took the OLDEST pending refund by `created_at`. A refund
released as `pending` stayed the oldest, so the next claim of the same run took
it straight back: one stuck refund used all 5 claims of every run, up to 1,440 a
day, and every newer refund waited. Since `20261013120000` was applied and
`payment-refund` deployed as version 5 (2026-11-17):

- `claim_order_refund` takes the least recently touched pending refund first
  (`updated_at`, then `created_at`), so a refund just released goes to the back
  of the queue. This needs only `20261013120000` applied;
- `payment-refund` passes the ids it has already claimed in the run, and the
  claim skips them, so a refund is tried at most once per run: one stuck refund
  then costs one claim a run, up to 288 a day. This needs the apply AND then the
  deploy, in that order: the new worker deployed first claims nothing;
- a refund released as `pending` now records why: `provider_no_answer` (a
  network, proxy or timeout failure), `http_429`, a server error such as
  `http_503`, `refund_not_final`, `key_unavailable` or `reconcile_unavailable`.
  The last two say nothing was sent.

### Back-off, attempt cap and the stuck alert

**The owner's numbers, decided 2026-11-17 (gap PG-01). Written on the branch
`fix/refund-retry-backoff-20261117` as `20261016120000_refund_retry_backoff`
(`MIGRATIONS.md` §68); live since that file was applied on 2026-11-18
(05:55:54 UTC, ledger row 121).** Before it, a refund that could not finish was
tried on every run, every 5 minutes, for ever, and raised nothing until it was
`failed`. The refund job's cron was inactive when this was written; it was
switched on 2026-11-19 at 04:47 UTC (`OWNER_ACTIONS.md` §47.16).

- **Back-off.** Each release as `pending` sets `order_refunds.next_attempt_at`,
  and `claim_order_refund` takes only refunds that are due. The wait after the
  n-th unsuccessful attempt is 5 minutes × 2^(n−1), capped at 6 hours:

  | After attempt | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | Next try waits | 5 min | 10 min | 20 min | 40 min | 80 min | 160 min | 320 min | 6 h | 6 h |

  The seventh wait is 5 h 20 min, because 160 minutes doubled is still below
  the 6-hour cap; the cap first binds at the eighth. In all, about 22 h 35 min
  of waiting, about 23 h 20 min on the 5-minute schedule.
- **Attempt cap.** The tenth unsuccessful attempt writes the refund `failed`,
  keeping the release's own failure code (for example `provider_no_answer`,
  `http_503`, `moyasar_ip_not_allowed`; `retry_limit_reached` if it gave none)
  and the safe error "Automatic refund stopped after 10 attempts. Last reason:
  …". The order reads `refund_state = 'failed'`, R14 `REFUND_FAILED` opens, and
  the card moves it to "Automatic refunds that stopped". The customer's app
  shows "Refund in progress" and "we will contact you", as for any failed
  refund.
- **Stuck alert.** R18 `REFUND_STUCK` (above, and
  `ORDER_INTEGRITY_WATCHDOG.md` §3).
- **Cost.** One stuck refund now makes 10 claims over about a day, each one or
  two Moyasar requests through the metered proxy, instead of up to 288 a day.

It is decided entirely in Postgres: `payment-refund` already calls
`finalize_order_refund` for every release, and that is where the wait and the
cap are written. **No `payment-refund` redeploy is needed for it.** The worker's
own log line for the tenth release still says `pending`; the row says `failed`.

**Runbook: a refund stopped by the cap.**

1. Open "Refunds and payments needing attention" (Live Orders, admin at AAL2)
   and read the refund's last reason under "Automatic refunds that stopped".
2. **Look the payment up in Moyasar's dashboard before doing anything.** The
   reasons that stop a refund by the cap (`provider_no_answer`, an `http_5xx`,
   `refund_not_final`, `reconcile_unavailable`) are all answers that do not rule
   out that Moyasar refunded it. If the dashboard shows it refunded, send
   nothing.
3. If it shows nothing refunded, refund it there by hand (§10), and record it
   in the written refund log.
4. If the reason is `moyasar_ip_not_allowed`, `key_unavailable` or
   `http_429`, fix that first (§8.1, the payment row's keys, or Moyasar's rate
   limit), because every other refund will be stopped the same way.
5. The R14 incident stays open after a hand refund until PG-14 records it
   (above).

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
appear in `list_failed_order_refunds()`. **Since `20261016120000` was applied
(2026-11-18)** it backs off and, at the tenth attempt, is written `failed` with
`moyasar_ip_not_allowed` and raises R14 (above). Before that apply there was no
attempt cap: until the proxy and Allowed IPs were fixed, every cron run would
have claimed and released it again, once a run since `20261013120000` and the
`payment-refund` deploy of 2026-11-17 (five times a run before). While it is retried it is listed under "Refunds
still being retried" with the reason "Moyasar refused our address (Allowed
IPs)". Each line logs `moyasar_request_refused` with the remedy. A plain 401 (a
bad key) is a definitive failure.

---

## 7. Going live: the order of steps

Each numbered step is a **separate owner approval**, named when it is due.
Approval for one is not approval for the next. Steps 1 to 6 are done
(2026-11-13, `OWNER_ACTIONS.md` §47.2-47.9); steps 7 to 16 are not.

1. **Apply `20260824100000_moyasar_payment_provider`**, named by version. Done
   2026-11-13 (live `20261113171942`).
2. **Apply `20261003120000_moyasar_only_payments`**, named by version. It refuses
   to apply before step 1. It adds the loyalty multi-spend guard and the
   1.00 SAR minimum to the attempt RPCs, switches the refund driver's gate to
   Moyasar, refuses a second paying payment for an order under the order lock,
   and relabels the health card and alerts. Detail: [Migrations §55](MIGRATIONS.md).
   Done 2026-11-13 (live `20261113172609`).
3. **Deploy the seven payment functions as one set**: `payment-initiate`,
   `payment-verify`, `payment-webhook`, `payment-return`, `payment-refund`,
   `payment-test-config`, `payment-admin-test-return`. An old bundle beside a new
   one can open an invoice that nothing confirms. The deploy workflow's `all`
   preset is this set ([Deploy](DEPLOY.md), [Owner actions §15](OWNER_ACTIONS.md)).
   Until this step, the console's Moyasar panel says "Deploy the Moyasar payment
   functions first." Done 2026-11-13, all seven from `b17ee00`.
4. **Apply `20261004120000_drop_tap_payment_rpcs`**, named by version, **only
   after** step 3. It refuses to apply before step 2. Detail: [Migrations §56](MIGRATIONS.md).
   Done 2026-11-13 (live `20261113174500`).
5. **Delete the retired `tap-admin-test-return` function.** Done 2026-11-13.
6. **Sandbox test** (§9, part A), with test keys and the test webhook. Done
   2026-11-13 (`OWNER_ACTIONS.md` §47.7-47.9).
7. **Choose the proxy service and set `MOYASAR_PROXY_URL`** (§8.1), after the
   sandbox test, so a bad value cannot be mistaken for a sandbox failure. An
   **invalid** value refuses every Moyasar call, TEST included. Send the two
   emails in the [proxy comparison](integrations/Moyasar_Static_IP_Proxy.md) §7
   first, then prove the proxy in TEST while Moyasar's TEST list still accepts
   any address: Test connection, then the wrong-password check (§8.1, steps 1
   to 3).
8. **List the proxy's IPs in Moyasar's LIVE Allowed IPs** (§8.1, step 5), only
   after Moyasar's written answers to questions 1 and 3 of that email. The live
   list can never be set back to any address.
9. **Switch the payment row to live, then enter the live keys and the live
   webhook token** in the console, register the live webhook, enter its
   verification code (§8.2), and run Test connection in LIVE mode. The card asks
   for confirmation before switching.
10. **Keep the payment row enabled.**
11. **Update the customer documents, before customers can pay by card**
    ([Owner actions §47.15](OWNER_ACTIONS.md); its publishing plan is proposed,
    and the owner decides it). First settle every `[OWNER DECISION …]` marker
    and placeholder in the drafts, and get the native Arabic read. Then, in one
    owner-approved session and in both languages, write all four: name Moyasar
    in `privacy_policy`; update `payment_policy` and
    `cancellation_refund_policy`, which both still say payment is cash only and
    promise to change before an online option appears; and correct
    `terms_conditions`, whose payment clause also says cash only. Then rebuild
    the site (today a merge to the default branch, [Deploy §9](DEPLOY.md)) and
    check that the no-JavaScript copy of `https://app.spicymeal.com.sa/privacy`,
    which store checkers read and which changes only on a rebuild, shows the new
    versions. After that check, re-decide the App Store "Financial Info" and
    Play "Payment info" answers.
12. **Make sure `refund_trigger_secret` exists (generate it if not) and
    re-enable the `payment-refund-worker` cron job** (§6).
13. **Ship the EAS build** that carries the app half (§5), with the app-side
    gap fixes in it: PG-03, PG-04, PG-05, PG-20 if the owner chooses the code
    fix, and PG-31 ([the card-payment gaps](readiness/20261113-card-payments-gaps.md)).
    A fix that misses this build needs another build and another store review.
14. **Turn on Online Payment** (Settings → Payment Methods). Not before
    Moyasar's written answer on which payment methods and card schemes its
    hosted page offers on our account (`OWNER_ACTIONS.md` §47.19; gap PG-11, a
    gate); each of the 12 gaps that must be fixed before card payments go live
    (PG-01 to PG-11 and PG-31 in
    [the card-payment gaps](readiness/20261113-card-payments-gaps.md)) closed as
    its row says (PG-04 may be disclosed instead of fixed; PG-07 may be closed
    by the ticket check on step 15's first payment, with Online Payment switched
    off again if the ticket does not show it paid); and the 9 that need the
    owner's decision (PG-12 to PG-17, PG-19, PG-20, PG-30) decided.
15. **The small live payment and its automatic refund** (§9, part B). That is a
    real payment and a real refund. One automatic refund, produced in a way
    agreed with the owner beforehand, is watched until it reads refunded. If none
    can be produced, or it does not complete, switch Online Payment off and
    publish the [refund draft](legal/CANCELLATION_REFUND_POLICY_CARD_PAYMENTS_DRAFT.md)'s
    D7 fallback wording before switching on again.
16. **Once step 15 has ended with card payment still on**, and its device checks
    have passed (a check of which methods Moyasar's live page offers, gap PG-11,
    belongs among them, but must first be added to `OWNER_ACTIONS.md` §47.18 step
    2 and `RELEASE_CHECKLIST.md` §7): change the cash-only listing claim C-CASH and add C-CARD, and
    send the release notes, the TestFlight description and any App Store text
    that says card payment is available
    ([store answers draft](store/CARD_PAYMENTS_STORE_ANSWERS_DRAFT.md), Open
    owner decisions, item 6). The App Review notes use the ON or OFF variant
    that matches the switch when a build is submitted.

This is the order of [Owner actions §47](OWNER_ACTIONS.md), which has the detail
of each step. Step 15 needs step 12, or the refund will not run, and every step
before 14 must be done before customers can pay. Step 16 comes only after step
15.

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

**Owner steps** (each an approval, in this order; the
[proxy comparison](integrations/Moyasar_Static_IP_Proxy.md) §3 has the detail):

1. Send the two emails in the proxy comparison's §7, to QuotaGuard and to
   Moyasar. Moyasar's answers to its questions 1 (shared addresses) and 3 (can
   the TEST list go back to "any address") must be in writing before any
   Allowed IPs list is changed. Wait for the replies before step 2: QuotaGuard's
   answer to its question 1 decides the plan, and Moyasar's answer to its
   question 1 decides whether shared addresses are acceptable at all.
2. Choose the proxy service (`OWNER_ACTIONS.md` §47.10; the comparison
   recommends QuotaGuard Shield in Frankfurt) and start its trial. Get its URL
   and every outbound IP.
3. Set `MOYASAR_PROXY_URL` (Supabase dashboard → Edge Functions → Secrets;
   never in chat), leaving Moyasar's TEST Allowed IPs as they are. Run Test
   connection in TEST: "Connection OK". Change one character of the proxy
   password and run it again: it must say "Could not reach Moyasar". Put the
   right value back and run it once more: "Connection OK" again. If the wrong
   password still gives "Connection OK", the calls are not going through the
   proxy: put the right value back and tell engineering.
4. Optional, the last TEST step, and possibly irreversible: restrict the TEST
   list, only once you have decided to keep the service and Moyasar has
   answered question 3 (comparison §3, step 3).
5. Only after the written answers to questions 1 and 3: in Moyasar's
   dashboard, switch to LIVE first, open Settings → API Keys, and add every
   outbound IP to the Allowed IPs list under the live keys only. Saving it asks
   for a 6-digit code; the test list saves at once, with no code, so check the
   heading above the list before you press Save. The live list can never be set
   back to any address.
6. After the live keys are saved (`OWNER_ACTIONS.md` §47.13), run Test
   connection in LIVE mode.

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

- [ ] **`PAYMENT_ALLOW_TEST_CHECKOUT` is unset** in the Edge Function secrets
      (§3), before the switch to live and before Online Payment goes on.
- [ ] Before step 14 of §7: Moyasar's written answer on which payment methods
      and card schemes its hosted page offers on our account
      (`OWNER_ACTIONS.md` §47.19; gap PG-11, a gate); each of the 12 gaps that
      must be fixed before card payments go live (PG-01 to PG-11 and PG-31 in
      [the card-payment gaps](readiness/20261113-card-payments-gaps.md)) closed
      as its row says (PG-04 may be disclosed instead of fixed; PG-07 may be
      closed by the ticket check on the first live payment below); and the 9
      that need the owner's decision (PG-12 to PG-17, PG-19, PG-20, PG-30)
      decided.
- [ ] Steps 7 to 13 of §7 are done.
- [ ] Test connection in LIVE mode: "Connection OK".
- [ ] On a real iPhone, with a Wallet card: the Apple Pay sheet appears inside
      the payment WebView.
- [ ] On iOS and Android: a card with a 3-D Secure challenge completes inside
      the WebView.
- [ ] The Arabic hosted page appears when the app language is Arabic (whether
      `lang=ar` is honoured is unknown).
- [ ] A small live pickup order: paid, receipt shown, order reaches the POS,
      and the branch's ticket shows it as paid (gap PG-07).
- [ ] One automatic refund, seen end to end. Only an order that was paid and
      provably never reached the branch is enrolled (§6), so agree with the
      owner how to produce one before trying, then watch it reach refunded. If
      none can be produced, or it does not complete, switch Online Payment off
      and publish the
      [refund draft](legal/CANCELLATION_REFUND_POLICY_CARD_PAYMENTS_DRAFT.md)'s
      D7 fallback wording before switching on again.
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

**Nothing refunds a duplicate automatically, by decision.** The owner decided on
2026-11-17 (refund draft D2) that duplicates are refunded by hand from Moyasar's
dashboard, from the R15 listing below. **Live today, nothing alerts on it either:** no
watchdog rule or alert reads `duplicate_payment` (the watchdog's double-capture
rule counts `paid` rows, and a duplicate is `failed`).

**Written 2026-11-14, live since 2026-11-17**, when `20261013120000` was
applied (gap PG-02, `MIGRATIONS.md` §65). Each duplicate raises the critical watchdog incident R15
`DUPLICATE_PAYMENT_RECORDED`, which reaches the alert inbox and, while the
payment row is enabled and configured, turns the payment card to failing. The
Live Orders card "Refunds and payments needing
attention" lists it under "Payments to refund", with the Moyasar payment id to
search for.

**Two neighbours are handled the same way, and are money taken for nothing:**

- **a payment that settled but matched nothing** (wrong invoice, amount,
  currency or mode). Its attempt is `failed` with
  `failure_code = 'verification_mismatch'` and confirms nothing. The payment id
  is in the sanitized `raw`, not in `provider_ref`. After the apply: R16
  `PAYMENT_VERIFICATION_MISMATCH`, and the same "Payments to refund" list.
  Check it in Moyasar's dashboard, then refund it;
- **a payment whose order was not created or not marked paid.** Only an
  `integration_sync_logs` row records it: `error = 'finalize_failed'` (session
  flow, no order exists) or `'confirm_failed'` (order flow, the order is not
  marked paid), with the payment id in `request`. After the apply: R17
  `PAYMENT_CONFIRMATION_FAILED`, one incident per payment, and the list "Paid,
  but no confirmed order". If an order is named, open it and use "Re-verify via
  Moyasar" on the receipt first. If there is no order, or it stays unpaid,
  refund the payment by hand. The incident ends when a later verify confirms the
  payment.

**Finding them.** Until the apply, the console has no list of them. The order
receipt shows only the **newest** payment row for an order, so it may show the
duplicate or hide it, and a duplicate with no order id appears on no receipt.
Use a read-only query:

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

**After a hand refund the incident and the card row stay** (gap PG-14): nothing
records the refund, and acknowledging an incident marks it seen without
removing it from the counts. The owner decided on 2026-11-17 that Moyasar's
`refunded` notification should record it automatically; that is its own later
change, not built. Until it lands, the written record is the only proof the
money went back.

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
4. Is **SADAD** enabled for invoices on this account? It must be off: on an
   invoice a SADAD bill stays payable, read as pending, for as long as the
   invoice does (Moyasar's SADAD guide: "On an invoice, matches the invoice";
   ours last 30 minutes), and it cannot be refunded.
5. Is **`lang=ar`** on the invoice URL honoured?
6. Can a 3-D Secure payment still in flight when an invoice **expires** complete
   afterwards?
7. Which failure event name is actually sent, `payment_faild` or
   `payment_failed`? Both are accepted.

For Supabase: which edge-runtime version hosted functions run, and whether
`Deno.createHttpClient` with a proxy is supported there (§8.1).

For the owner:

- automatic refund of a cancelled paid order the branch accepted (§6).
  (Decided 2026-11-17: a duplicate payment is refunded by hand, D2, §10;
  how many times a refund is tried, the wait and the stuck age, PG-01, §6;
  a hand refund is to be recorded automatically from Moyasar's `refunded`
  notification, PG-14, not yet built);
- who receives payment alerts outside the console (PG-10);
- whether `set_payment_settings` should also refuse Online Payment unless the
  row is live (a migration);
- whether the webhook verification code may stay readable by accountants;
- whether to cancel the previous invoice at Moyasar when a new attempt opens
  on the SAME checkout (`PUT /v1/invoices/{id}/cancel`). It is used since
  2026-11-18 only to drop a checkout the customer replaced with a different
  cart (§4).

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
- **Duplicates are manual, by decision** (D2, 2026-11-17). See §10.
- **Refunds back off and stop after 10 attempts** since `20261016120000` was
  applied on 2026-11-18 (§6, PG-01): from 5 minutes to 6 hours, then `failed`
  at the tenth attempt with its last reason. Before that apply, one stuck
  refund took one claim a run, for ever (since `20261013120000` and the
  `payment-refund` redeploy of 2026-11-17). The refund job's cron is still
  inactive, so no refund runs until it is turned on.
- **A refund stopped by the cap may still have landed.** Its last reason is
  what the worker last saw, and several reasons do not rule out a refund at
  Moyasar. Check the dashboard before refunding by hand (§6 runbook).
- **A refund never tried raises nothing.** R18 needs at least one attempt, so a
  refund waiting while the refund job is off is seen only by a database query.
- **Refund and payment problems reach the console's alert inbox** since
  `20261013120000` was applied on 2026-11-17 (PG-01, PG-02); outside the console they reach nobody until external alert email is on
  (PG-10).
- **A hand refund is recorded nowhere** (PG-14), so its incident and card row
  stay listed after the money has gone back.
- **An abandoned card checkout no longer makes the payment card read
  "degraded"** since `20261013120000` was applied on 2026-11-17 (PG-25). Only a
  payment that settled without a confirmed order does, **provided a verify
  ran on it**: the webhook, or the customer's return to the app.
- **A payment nobody verified is not detected.** If a customer pays and closes
  the tab, and the webhook also never arrives, the attempt stays `initiated`
  with no payment id, exactly like an abandoned checkout. No watchdog rule and,
  since `20261013120000`, no health state reads it; the payment card shows it
  only inside the figure "Open unverified 24h", which counts abandoned
  checkouts too and does not move the state. **Open, not built:** a sweep that
  asks Moyasar about each attempt still open after its invoice expired, and
  confirms or flags the ones that were paid. That is a new scheduled job and a
  deploy, so it is its own change.
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

Added 2026-11-14 with `20261012120000_cancelled_orders_guard` (gap PG-03;
applied 2026-11-14):

- **A refund enrolled before an order is cancelled still runs.** Refunding that
  order by hand as well would refund it twice. Check the order's refund status
  first (§6).
- **A payment that is captured for a cancelled order is still recorded.** Money
  taken is never refused (`confirm_order_payment`), the order is not sent to the
  kitchen, and nothing refunds it automatically, so it is a hand refund. After
  the apply no attempt can be opened for a cancelled order, and on 2026-11-14
  there were 0 Moyasar attempts live, so this needs an attempt opened before
  the apply.
- **Builds already installed still show Resend on a cancelled order.** After the
  apply the server refuses it and nothing happens. The new state ships in the
  next EAS build (`OWNER_ACTIONS.md` §47.17).
- **A cancelled order left in the POS queue gets a "could not send" push** when
  its deadline passes, and an admin Retry can put one back in the queue
  (`ORDER_CONFIRMATION_FLOW.md` §11). Neither sends anything to the kitchen.
  **Fixed in #478 and LIVE since 2026-11-18: `push-dispatch` deployed as
  version 10 (the push) and `20261015120000` applied (the Retry; ledger row
  120)** (`MIGRATIONS.md` §67, `OWNER_ACTIONS.md` §57).
- **An order cancelled in the few seconds after the worker claims it is still
  sent to the kitchen.** The worker's last check before it sends reads the sync
  state, not the order's status (`LAZYWAIT.md`, *Retry / backoff /
  dead-letter*). Measured on a local chain on 2026-11-14; not fixed here. A
  paid order sent this way is still refunded by hand if the customer is owed
  one. **Fixed in #478 and LIVE since `20261015120000` was
  applied on 2026-11-18** (ledger row 120). The check then parks the order instead
  of sending it. It touches no payment or refund: a paid order parked this way
  is still a hand refund, as for any cancelled paid order (above).

---

## 13. Arabic that needs a native read

All engineering-drafted.

Customer-facing:

- `payBelowMinimum`: «يتطلب الدفع الإلكتروني ألا يقل الإجمالي عن 1.00 ريال. أوقف استبدال النقاط في هذا الطلب، أو ادفع نقداً.» Rewritten 2026-11-14 (gap PG-05); it said «استخدم نقاطاً أقل» before. «استبدال» is the points switch's own word (`useLoyalty`).
- `loyaltyOrderTooSmall` (new 2026-11-14, gap PG-31; shown next to the points switch, not a payment message, listed here because it ships with the same change): «يمكن استخدام النقاط عندما يبلغ الإجمالي قبل خصم النقاط {amount} ريال أو أكثر.» The app fills in `{amount}`, for example 10.00. It names the total before points, not the order, because the minimum is judged after any coupon.
- payment screen footer: «تُدخل بيانات بطاقتك في صفحة Moyasar الآمنة.»
- web stand-in: «يمكنك إكمال طلبك عبر الموقع والدفع نقدًا.»

Staff-facing: the Moyasar panel, payment card, receipt and Settings strings
added on 2026-11-11 (in `MoyasarPaymentPanel.tsx`, `PaymentDetails.tsx`,
`SettingsPanel.tsx` and the alert and health labels).

Staff-facing, added 2026-11-14: the Live Orders card "Refunds and payments
needing attention" (37 `payattn_*` strings in
`src/components/admin/adminLocales.ts`) and the Operations Health line for a
stale payment. Each is listed in `OWNER_ACTIONS.md` §35.
