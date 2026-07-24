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
```

No test sends a real payment, refund, Lazywait order, OTP, message or email. The
SQL suite is transactional (`begin; … rollback;`) and uses `session_replication_role
= replica` for fixture inserts only.

Validated 2026-07-24 on a disposable PostgreSQL 16.9 + PostGIS 3.6.2 cluster:
full 53-migration chain applied from empty (0 errors, 0 warnings) and **17/17 SQL
suites passed**, including this feature's suite. `pg_cron`/`pg_net` were inert
shims, so no scheduled job ran and no outbound HTTP was possible. See
`docs/MIGRATIONS.md` §18 for the complete result table.

## 10. Known gaps

- **`loyalty_transactions.reason` still embeds the internal order number.**
  `place_order` writes `'Earned on order ' || order_number` into a column that is
  customer-readable (`grant select … to authenticated` plus RLS
  `profile_id = auth.uid()`), so a customer can read their own `SM-…` id straight
  from PostgREST. This is **pre-existing** and outside this PR's surface — fixing
  it means either redefining `place_order` (the pricing authority) in a new
  migration, or column-scoping the grant, which would also hide `reason` from
  staff since both are the `authenticated` role. Tracked for a separate change.
- **Tap's hosted checkout page shows the order number** in the charge
  description (see §4). Server→provider by design; changing the bound
  `reference.order` would weaken payment verification.
- **No Lazywait reconciliation API.** Issue #94 asks that a timeout/unknown
  response be reconciled with Lazywait before another create request. Lazywait
  exposes no order-lookup endpoint we have confirmed, so "reconcile" currently
  means a human working the `confirmation_required` feed. When such an endpoint
  is published, an automated reconciler could convert some ambiguous orders into
  proven-not-sent ones and widen resend eligibility.
- **Refund worker scheduling is manual.** See §8.
- **`payment-refund` has no integration test against a Tap sandbox.** The pure
  classifier is unit-tested; the transport path is not exercised.
