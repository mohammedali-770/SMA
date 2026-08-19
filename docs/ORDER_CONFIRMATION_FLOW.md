# Order Confirmation Flow — payment, branch acceptance, retries, refunds

> Implements Issue **#94**. Owner-approved scoped unfreeze of the payment /
> checkout-session / Lazywait-submission / retry / refund areas (CLAUDE.md §6),
> granted 2026-07-24 for repository work only. **No Production apply, no function
> deployment, and no live payment operation is authorized by that approval.**

## 1. The defect this replaces

`ReceiptScreen.tsx` rendered an unconditional success hero — a green check plus
**"Order placed!"** — and then rendered the POS lifecycle banner directly beneath
it. When `lazywait_sync_state` was `dead_letter` or `blocked`, that banner read
**"Not confirmed"**. Both appeared on screen simultaneously.

The screen also displayed the internal `SM-2026-…` number: as the primary value
before the branch responded, and as a labelled `Ref:` line afterwards. That is a
database identifier for a row the restaurant may never have accepted.

## 2. Two sources of truth, never merged

| Fact | Authority |
|---|---|
| The customer paid | The payment provider's own Retrieve-Charge response (`CAPTURED`, every bound field matching the stored attempt) |
| The order was placed | Lazywait returned a **usable** order reference |

The customer is never told their order was placed on the strength of the first
fact alone. `public.customer_order_state()` is the single function that maps
authoritative columns to one customer-visible state, and
`apps/mobile/src/features/orders/orderConfirmation.ts` mirrors it exactly.

**Parity is a hard requirement.** The case tables in
`supabase/tests/order_confirmation_state_machine_test.sql` and
`apps/mobile/src/features/orders/orderConfirmation.test.ts` are the shared
contract. Change one, change the other in the same commit.

## 3. The states

| State | Meaning | Success hero? | Resend? | Branch number? |
|---|---|---|---|---|
| `payment_pending` | Online payment not verified | no | no | no |
| `accepted_no_pos_channel` | PAID; this channel has no branch step | **no** | no | no |
| `accepted_no_pos_channel_unpaid` | Unpaid (cash); no branch step | **no** | no | no |
| `sending_to_branch` | Send in flight, or an automatic retry is queued | no | no | no |
| `confirmed_by_branch` | Lazywait accepted it | **yes** | no | **yes** |
| `verifying_with_branch` | Ambiguous — a ticket may exist | no | **no** | no |
| `branch_failed_retry_available` | PAID, proven not sent | no | **yes** | no |
| `unpaid_branch_failed_retry_available` | CASH, proven not sent | no | **yes** | no |
| `final_failure_refund_pending` | PAID, budget spent, refund in progress | no | no | no |
| `final_failure_refunded` | Refund provider-CONFIRMED | no | no | no |
| `final_failure_refund_failed` | Refund could not complete; manual review | no | no | no |
| `unpaid_final_failure` | CASH, budget spent; no refund language | no | no | no |

`confirmed_by_branch` requires `lazywait_sync_state = 'synced'` **and**
`lazywait_pos_ref_is_usable(lazywait_ref)`. A `'synced'` row without a usable
reference is an inconsistent DB state and is presented as `verifying_with_branch`
— never as confirmed.

**`confirmed_by_branch` is the ONLY state that renders the green success check.**
The two no-POS-channel states are deliberately neutral (informational tone, clock
icon): they acknowledge that we have the order and, when true, that payment
settled — but they never imply the branch accepted or is preparing it, because no
branch has seen it. A unit test asserts this over every state.

Customer copy for the no-POS-channel states:

| | English | Arabic |
|---|---|---|
| `accepted_no_pos_channel` (paid) | **Payment received** / Your order is being processed through the delivery channel. | **تم استلام الدفع** / طلبك قيد المعالجة عبر قناة التوصيل. |
| `accepted_no_pos_channel_unpaid` (cash) | **Order received** / Your order is being processed through the delivery channel. | **تم استلام الطلب** / طلبك قيد المعالجة عبر قناة التوصيل. |

The split exists because cash-on-delivery orders also land here; telling an unpaid
customer "Payment received" would be false.

## 4. Order numbers

Only the branch's own order number is ever customer-visible.
`orderDisplayNumber()` returns `null` until Lazywait issues one, and the UI then
shows the confirmation state instead of a number. The internal `SM-…` number
remains the canonical id for support and the admin dashboard.

It is removed from the customer surface at **three** layers, so a UI change alone
cannot resurface it:

1. **Not fetched.** `apps/mobile/src/lib/orderSelect.ts` defines an explicit
   customer column list; `select('*')` is gone. That also stops shipping
   operational columns — notably `pos_create_attempt_token`, the Create-Order
   fencing token, which the wildcard select had been sending to every device.
2. **Not representable.** `DbCustomerOrder` and the `Order` model no longer
   declare `order_number` (or the customer-identity copies, coupon, notes,
   address snapshot), so reading one fails to compile.
3. **Not returned by any customer endpoint.** `payment-verify`, `payment-initiate`
   and `order-intake` return `orderId` and a customer-safe projection only.

`orderSelect.test.ts` asserts the select contains no internal column and that a
deliberately hostile full row still maps to an object carrying none of them.

**Knowingly retained:** `payment-initiate` still uses `order_number` as the Tap
charge *description* and as the `reference.order` merchant reference
(`supabase/functions/payment-initiate/index.ts`). Those go server→provider for
reconciliation, and `reference.order` is a bound field that `payment-verify`
validates, so changing it would weaken payment verification. The description is
visible on Tap's hosted page; see §10.

## 5. Customer resend — proven-not-sent only

**Lazywait's Create Order endpoint has no idempotency key.** The existing
confirmation lifecycle (`20260721120000`) is built entirely around that fact: any
ambiguous outcome (timeout, 2xx-without-ref, 5xx) may already have produced a
restaurant ticket, so it is routed to `confirmation_required` and never resent.

The customer resend therefore fires **only** from proven-not-sent state:

- no stored `lazywait_ref` (any non-null marker, even blank, blocks it), and
- no `pos_create_attempted_at` phase marker, and
- a terminal `failed`/`dead_letter`/`blocked` state with no queued auto-retry.

Ambiguous orders show *"We are checking with the branch whether your order went
through"* with **no** retry button, and remain in the admin
`list_pos_confirmation_required` feed for human verification. This is the only
reading under which "retries never create duplicate Lazywait orders" is true
without a provider idempotency key.

Three manual attempts are allowed. The count lives in
`orders.pos_customer_retry_count` and is incremented only by the server. The RPC
returns `{ outcome, state }` and nothing else — **no reason code, no counter, no
limit** — so the budget is not disclosed in any client-visible payload.

Each accepted resend extends `pos_sync_deadline_at`. Without that the row would
be re-queued but then refused by the deadline-bounded claim RPCs, reporting a
success the worker never acts on — the exact false-success bug that
`20260721120000` was written to eliminate.

## 6. Refunds

Enrollment is automatic, path-independent and decided in Postgres by
`order_refund_due()`, which requires **all** of:

- `payment_status = 'paid'` and `total > 0`
- the order participates in the POS confirmation gate
- `lazywait_ref IS NULL` — no stored reference of any kind
- `pos_create_attempted_at IS NULL` — proven never sent
- `lazywait_sync_state IN ('dead_letter','blocked')`
- `pos_customer_retry_count >= 3`

Ambiguous orders fail the third and fourth clauses, so **an order Lazywait may
have accepted is never auto-refunded**. Cash orders fail the first, so a
non-prepaid final failure shows the same apology with no refund language.

A BEFORE trigger stamps `refund_state = 'pending'` atomically with whatever drove
the order terminal; an AFTER trigger opens one `order_refunds` ledger row with a
deterministic per-order idempotency key. A partial unique index permits at most
one `pending|processing|succeeded` refund per order, so a customer can never be
refunded twice.

`supabase/functions/payment-refund` drains the queue:

1. `claim_order_refund()` leases one refund (`FOR UPDATE SKIP LOCKED`) and moves
   the order to `refund_state = 'processing'` in the same transaction.
2. The Tap refund request is sent, carrying our idempotency key as the merchant
   reference.
3. `classifyRefundResponse()` returns **three** outcomes, never two:
   - `succeeded` — the provider confirmed a terminal `REFUNDED`
   - `failed` — a definitive terminal rejection or a non-429 4xx
   - `pending` — anything else: in-flight, undocumented status, 429, 5xx,
     timeout, network error
4. `finalize_order_refund()` is token-fenced. A `pending` outcome **releases** the
   lease for a later attempt rather than resolving it.

`Refunded` is shown only on a provider-confirmed `succeeded`. `Refund pending`
covers `pending`/`processing`. A `failed` refund surfaces in
`list_failed_order_refunds()` for manual review, with the charge reference
reduced to an md5 fingerprint and no provider payload stored anywhere.

## 7. Channels without a branch step

Delivery orders are held at `blocked` / `delivery_schema_unconfirmed` because the
Lazywait delivery Create Order schema is unconfirmed and is never invented. Under
a literal "confirmed only after Lazywait accepts" rule, every paid delivery order
would be permanently unconfirmed, exhaust zero retries, and be auto-refunded.

`pos_confirmation_channel_active()` decides participation, and is expressed in
terms of the **sync state**, not the order type. Delivery is excluded today only
because it is blocked with that specific reason. When Lazywait publishes the
delivery API and `set_lazywait_initial_sync` starts enqueuing delivery to
`pending` like pickup, delivery becomes gate-active automatically — no change to
the state machine, the RPCs, the refund predicate, or the app.

A `blocked` order whose reason is a *real* POS rejection (bad licence, bad
mapping) stays inside the gate and is treated as a genuine branch failure.

## 8. Operational configuration

`payment-refund` is `verify_jwt = false` (server/scheduled caller) and fails
**closed** behind a required constant-time shared secret:

- store `refund_trigger_secret` in the `payment` integration's `secret_config`
- send it as the `x-refund-secret` header

Without a configured secret the function returns `503` and processes nothing.
**No cron job is scheduled by this change** — scheduling the refund worker is a
separate owner-approved step, deliberately left out so that merging this work
cannot start moving money on its own.

## 9. Testing

```bash
npm run lint                      # tsc --noEmit (root)
npm test                          # vitest: derivation + refund classifier
npm --prefix apps/mobile run typecheck

# Requires a throwaway PG16 with the full migration chain applied:
psql -h 127.0.0.1 -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f supabase/tests/order_confirmation_state_machine_test.sql
psql -h 127.0.0.1 -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f supabase/tests/order_note_length_test.sql

# Or replay the chain and run every suite exactly as CI does:
bash .github/sql-ci/run.sh
```

No test sends a real payment, refund, Lazywait order, OTP, message or email. The
SQL suite is transactional (`begin; … rollback;`) and uses `session_replication_role
= replica` for fixture inserts only.

Validated 2026-07-24 on a disposable PostgreSQL 16.9 + PostGIS 3.6.2 cluster:
full 53-migration chain applied from empty (0 errors, 0 warnings) and **17/17 SQL
suites passed**, including this feature's suite. `pg_cron`/`pg_net` were inert
shims, so no scheduled job ran and no outbound HTTP was possible. See
`docs/MIGRATIONS.md` §18 for the complete result table.

## 10a. Loyalty reasons (closed)

`place_order` and `insert_order_from_snapshot` wrote `'Earned on order ' ||
order_number` into `loyalty_transactions.reason`. That table is customer-readable
(`grant select … to authenticated` + RLS `profile_id = auth.uid()`), so a customer
could read their own `SM-…` id straight from PostgREST — the mobile app never
queries the table, so this was pure auto-exposure that a code-path search missed.

Migration `20260724130000` closes it **at the destination column**, not in the
pricing functions:

- `text_has_internal_order_number(text)` matches the generated VALUE SHAPE
  (`SM-<4 digits>-<6+ digits>`), so it catches any writer that concatenates the
  number into free text.
- `loyalty_safe_reason()` returns neutral wording for order-linked rows
  (**"Points earned from an order"** / **"Points redeemed on an order"**) and
  *redacts* the identifier from any other free text, preserving the rest of an
  operator's note.
- A BEFORE INSERT OR UPDATE trigger applies it, so the fix is writer-independent.
- A `NOT VALID` CHECK constraint is the backstop for future writes.

**Why not redefine `place_order`:** it is a ~200-line pricing authority that owns
subtotal, modifiers, delivery fee, coupon, VAT, loyalty, award timing and
idempotency. Re-emitting it verbatim to change two string literals is a large,
transcription-error-prone diff across pricing-sensitive code for a text-only fix.
The trigger touches none of that logic. `loyalty_reason_no_order_number_test.sql`
runs a real `place_order` and asserts the award happens **exactly once**, amounts
and balances are unchanged, and nothing leaks.

Staff keep full traceability through `loyalty_transactions.order_id` (a UUID FK).
No grant or RLS policy was revoked.

### Historical rows — NOT rewritten

This migration deliberately does **not** touch existing rows, and the constraint
is `NOT VALID` so history is neither validated nor rejected. Rewriting them is a
Production **data** change requiring separate, explicit owner approval. The
proposed statement, to be run only under that approval:

```sql
-- Preview first:
select count(*) from public.loyalty_transactions
 where public.text_has_internal_order_number(reason);

-- Remediation (owner-approved only):
update public.loyalty_transactions
   set reason = public.loyalty_safe_reason(type::text, order_id, reason)
 where public.text_has_internal_order_number(reason);

-- Verify, then optionally promote the guarantee to cover all rows:
alter table public.loyalty_transactions
  validate constraint loyalty_transactions_reason_no_order_number;
```

## 10b. Tap `description` (closed)

Tap documents `description` only as *"an arbitrary string which you can attach to
a Charge request with more details, if needed"* and **never states that it stays
internal**, so it cannot be shown to be non-customer-visible and must be assumed
to appear on the hosted page or a receipt.

It is now the constant `'Spicy Meal order'`. This is safe because `description`
is **not** one of the bound fields `validateAndConfirmTapCharge` compares (id,
amount, currency, `reference.order`, `reference.transaction`, `live_mode`,
merchant) and **not** part of the webhook hashstring (`chargeHashFields`). The
verification binding stays on `reference.order`, unchanged. `tap.test.ts` pins
both halves: the description carries no `SM-…`, and `reference.order` still
carries the exact attempt reference.

## 10c. The order note — bounded at 280 characters (closed)

The free-text note a customer attaches at Checkout reaches a cashier and is
printed on the ticket. It was unbounded from the day the column was created
(`20260707120500`:32) until `20260819120000_order_note_length_limit.sql`: no
`maxLength` on the input, no check in `place_order`, no constraint on the column.

**Why the UI was never the control.** `place_customer_order` is granted to
`authenticated` (`20260724200000`:336), so any signed-in customer can call it
directly with the publishable key and their own JWT. A limit that lives only in
`CheckoutScreen.tsx` is a suggestion. The bound is therefore enforced in the
database, and the client mirrors it so the customer is stopped before they are
refused.

| Half | Where | What it does |
|---|---|---|
| Client | `apps/mobile/src/features/order/orderNote.ts` | `ORDER_NOTE_MAX_LENGTH = 280`, validator, remaining-characters copy in both languages |
| Client | `apps/mobile/src/features/checkout/CheckoutScreen.tsx` | `maxLength`, a counter that appears in the last 40 characters, and `normalizeOrderNote` on submit |
| Server | `public.order_note_normalized(text)` | the one definition of "trimmed": whitespace-stripped, NULL rather than empty |
| Server | `public.order_note_is_acceptable(text)` | the predicate — NULL or ≤ 280 characters after trimming |
| Server | `trg_orders_note_length`, `trg_checkout_sessions_note_length` | reject an over-long note and store the trimmed value |

**Why a trigger and not a CHECK constraint.** The same reason `20260724170000`
gave for `addresses.description`: a CHECK is re-evaluated on *every* subsequent
UPDATE of a row, not only when the guarded column changes. `public.orders` is
updated constantly on unrelated columns — POS sync state, confirmation
lifecycle, cancellation integrity, manual resend — so one historical row with an
over-long note would start failing status transitions that never touched
`notes`. The trigger fires on INSERT, and on an UPDATE that actually changes
`notes`.

**Why `checkout_sessions` is guarded too.** Two independent writers reach
`orders.notes`: `place_order` (cash/direct) and `insert_order_from_snapshot`,
which `finalize_checkout_session` calls with the note it reads back from
`checkout_sessions.notes`. Guarding only `orders` would move the failure past
the point of no return — finalize runs *after* the provider has captured, and a
failure there is caught by `_shared/tapVerify.ts`, logged, and retried forever
against a session that can never succeed. Rejecting the note when the session is
created means it is refused before any money moves. This is a uniform input rule
applied to a column: no provider logic, no pricing and no session lifecycle is
touched by it.

**A trap worth knowing about.** The trim set is built with `chr()`, not with an
`E''` escape string, because PostgreSQL's C-style escape table has **no `\v`** —
an unrecognised escape yields the character literally, so `E'\v'` is the letter
`v` (ascii 118), not the vertical tab. Written the obvious way,
`btrim(notes, E' \t\r\n\f\v')` stores `"eg only"` for `"veg only"`, turns a bare
`"v"` into no note at all, and — because trimming happens before the length is
measured — lets a 281-character note beginning with `v` through the limit
entirely. This is the same class of bug as `20260802120000`, where
single-argument `btrim()` turned out to strip spaces only. Caught in review
before merge; `order_note_length_test.sql` CASE 1 and CASE 3 now assert both
halves, and re-introducing the escape string makes CASE 1 fail.

**NULL stays legal.** The note is optional, and account deletion
(`20260715120000`:250) and the erasure job (`20260806120000`:143) both
`set notes = null`. The predicate accepts NULL so both keep working; a
whitespace-only note is stored as NULL rather than as a blank instruction line.

**Where 280 came from.** A kitchen note is an instruction, not a message. It is
**not** derived from any POS capability — whether Lazywait accepts an order note
at all is still open question Q5 (`docs/lazywait-delivery-open-questions.md`),
and `lazywait-sync` does not forward notes today. If Lazywait confirms a shorter
maximum this number narrows; it should never silently widen.

Proven on a disposable PostgreSQL 16 + PostGIS 3.4 cluster on 2026-08-19: the
full 82-migration chain applied from empty, and **41/44 SQL suites passed with 0
new failures** (3 pre-existing quarantine entries). `order_note_length_test.sql`
was additionally mutation-checked — dropping the two triggers makes it fail at
CASE 2 — so a green run means the guard is present, not merely that the file
executed.

## 10d. The confirmation screen — what the cashier is shown

This screen exists to be **held up across a counter**. Its layout follows from
that, and the reasoning is recorded here because a well-meaning tidy-up could
undo it.

| Element | Why |
| --- | --- |
| Brand lockup at the top | The cashier is handed a stranger's phone; they need to see whose order this is before reading anything else. |
| Branch order number, very large, in its own card | The one thing the screen is for. Forced **LTR** so a two-digit number can never render reversed in an Arabic layout. |
| Order state as a compact pill | Reassurance, not the headline. Once the number is visible the customer already has what they came for. |

### The number is shown VERBATIM

`orderDisplayNumber(order)` returns what Lazywait issued, unaltered — **no `#`
added, none stripped, no reformatting.**

This was got wrong once and corrected within the same branch. An earlier
revision stripped the leading `#`, on the assumption the app was adding it.
Verified read-only against Production: **the POS itself issues the number
already prefixed** — `#1`, `#2`, `#10` — and that exact string is what the
branch's own screens display. Stripping it printed something the cashier could
not match against their system, which defeats the purpose of the screen.

When the number has not been issued yet, the card says so and explains that it
will appear as soon as the branch issues it, rather than showing a blank or a
placeholder that could be mistaken for a real number.

### Directions, for pickup only

A **Directions to branch** control appears only when the order is `pickup`, the
branch is in the catalog, and its coordinates are usable. A delivery order never
shows it — the food travels to the customer. If the catalog has not loaded or
the branch was deactivated since the order was placed, the control simply does
not render rather than opening a broken map. Platform behaviour and the iOS
`LSApplicationQueriesSchemes` requirement are in [`MAPS.md`](MAPS.md).

### The store-review prompt

Leaving the confirmation screen may raise the OS review dialog. Every guard is
deliberate:

- **never while the screen is open** — a system dialog must not sit on top of
  the number the customer is showing a cashier;
- **only after a completed order** — `syncState === 'synced'` and a status of
  `delivered | ready | out_for_delivery | preparing | received`. Asking after a
  failed or unconfirmed order invites a one-star rating for something the
  customer is still upset about;
- **once, ever**, from our side. The flag is written **before** asking, because
  neither platform reports whether its dialog actually appeared.

Both platforms treat this as a *request*: iOS caps its own dialog at three per
365 days and may show nothing at all. It can never be relied on to have been
seen.

Two limits worth knowing: the prompt can fire on a `preparing` or `received`
order — before the customer has eaten — and `/receipt/{id}` is reachable from
the Orders tab and from a notification tap, so "first completed order" is more
precisely "the first time the customer leaves any qualifying confirmation
screen".

### Provider error text — classified on the order path, still raw on the payment path

Coupon-validation and order-placement failures are classified through
`failureMessage(...)` rather than surfaced raw. A provider's message is written
for developers, may name internal systems, and is not translated. The customer
sees classified, translated copy; the detail goes to the failure report.

**The two payment catches are deliberately NOT converted.** `open_checkout` and
`verify_payment` still show `e.message` directly. Improving them is payment work
under CLAUDE.md §6, and the branch that changed them asserted a "scoped
exception" to the freeze that was never granted — the owner confirmed on
2026-08-19 that no such instruction existed, so the change was reverted.

**This is a known, accepted-for-now leak:** a customer who hits a payment
failure can still be shown raw provider text. Converting these two sites is a
worthwhile change; it needs explicit owner approval under §5 first, and should
be its own change rather than a passenger in an unrelated commit.

**One caveat this does not fix:** on the **cash** path a server-raised error is
not readable at all. Cash orders go through
`supabase.functions.invoke('order-intake')`, which returns HTTP 400 with the
message in the body — but a non-2xx `invoke` yields `FunctionsHttpError`, whose
`.message` is the generic *"Edge Function returned a non-2xx status code"*.
`invokePaymentFn` already recovers the body via `error.context.json()`;
`placeAndSync` has never had the same treatment.

## 11. Known gaps

- **The raw `public.orders` table surface still carries `order_number` (and
  `pos_create_attempt_token`) to the owning customer.** One root cause —
  `grant select on public.orders to authenticated` is TABLE-WIDE (`20260707120500`
  :107) and RLS filters ROWS, not columns — with three reachable expressions:

  | Surface | Reachable how |
  |---|---|
  | PostgREST table read | `GET /rest/v1/orders?select=order_number` returns the customer's own `SM-…` |
  | `place_order` RPC | `returns public.orders`, granted to `authenticated`, so a direct call returns the whole row (the app no longer calls it — it uses `order-intake` — but the grant stands) |
  | Realtime | `supabase_realtime` includes `public.orders` (`20260707121100`), so a subscriber receives full row payloads. Added for the STAFF console; **the customer app does not subscribe**, so this is latent, not active |

  Verified empirically on the disposable cluster: as role `authenticated` with
  `auth.uid()` set to the owner, `select order_number from orders` returns
  `SM-2026-000999` and `pos_create_attempt_token` returns its value.

  This PR closes the app, the models and every endpoint response, but **cannot**
  close the raw table without column-level grants — and **staff share the
  `authenticated` role** and read orders with `select('*')` (`src/lib/api.ts:553,
  567`), so column grants would break the dashboard. Closing it properly means
  moving staff order reads behind a `SECURITY DEFINER` admin RPC (or giving staff
  a distinct Postgres role), then column-scoping the customer grant and dropping
  `orders` from the realtime publication in favour of a staff-only channel. That
  is an architectural change and needs its own reviewed PR.
- **No Lazywait reconciliation API.** Issue #94 asks that a timeout/unknown
  response be reconciled with Lazywait before another create request. Lazywait
  exposes no order-lookup endpoint we have confirmed, so "reconcile" currently
  means a human working the `confirmation_required` feed. When such an endpoint
  is published, an automated reconciler could convert some ambiguous orders into
  proven-not-sent ones and widen resend eligibility.
- **A server-raised order error is not readable on the cash path.** Cash orders
  go through `supabase.functions.invoke('order-intake')`, which returns HTTP 400
  with the Postgres message in the body — but a non-2xx `invoke` yields
  `FunctionsHttpError`, whose `.message` is the generic *"Edge Function returned
  a non-2xx status code"*. `placeAndSync` (`apps/mobile/src/services/api.ts`
  :219) rethrows that, so the customer sees the generic text. The online path is
  unaffected. `invokePaymentFn` (:314) already recovers the body via
  `error.context.json()`; `placeAndSync` has never had the same treatment. This
  is latent rather than active for the note limit specifically — the client
  `maxLength` stops a customer reaching the server bound at all — but any future
  server-side order rule will hit it.
- **Per-item notes do not exist.** There is no `order_items.notes` column, no UI
  and no field for one in `serializeOrderItem`
  (`supabase/functions/_shared/lazywaitApi.ts`). Adding them is blocked on the
  same Lazywait question as §10c: the confirmed Create Order body has no note
  field of any kind, `delivery_notes` is `[ASSUMPTION]`-tagged and gated behind
  `allowAssumedFields` (default off), and per-item notes are not even on the
  question list.
- **Refund worker scheduling is manual.** See §8.
- **`payment-refund` has no integration test against a Tap sandbox.** The pure
  classifier is unit-tested; the transport path is not exercised.
