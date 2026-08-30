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
| `sending_to_branch` | Send in flight, or an automatic retry is queued | no | no | **yes** |
| `confirmed_by_branch` | Lazywait accepted it | **yes** | no | **yes** |
| `verifying_with_branch` | Ambiguous — a ticket may exist | no | **no** | **yes** |
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

### What "Branch number?" in that column means

It is **whether the number card is shown**, not whether a number is known.

The three `yes` rows are the states on an ACTIVE POS channel: the number is
either already issued (`confirmed_by_branch`) or still expected
(`sending_to_branch`, `verifying_with_branch`), so the card's "it will appear
here as soon as the branch issues it" is a true statement.

Every other row is `no`, and the two `accepted_no_pos_channel*` rows are the
reason the flag exists. That channel has no POS step at all, so no branch will
ever issue a number for it — promising one is a claim the customer can only sit
and wait on. Delivery is exactly that case today (see §7), which is how a real
delivery customer came to be shown **"لم يصدر بعد"** above **"سيظهر هنا فور
إصداره من الفرع"** for an order no branch would ever see.

This was a live bug until it was fixed: `showBranchNumber` had **no consumer**.
`ConfirmationHero` rendered the card unconditionally and never read the flag,
while a unit test asserted the flag's values over every state — so the suite
stayed green over a field nothing used. The card is now gated on it, and the
test asserts the gate rather than the constant.

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

### When the number appears — and why it once took 45 seconds

`order-intake` kicks `lazywait-sync` **synchronously** immediately after
`place_order`, bounded by an ~11 s timeout, so the confirmation screen can show
the branch number on first paint. The once-a-minute cron is the **backstop**, not
the primary path — an order that misses the synchronous window is finished by the
worker and the screen fills in later.

**Delivery did not get that kick until 2026-08-27.** The block read
`if (order_type === 'pickup')`, which was correct only while the insert trigger
parked every delivery order at `blocked` — kicking the worker for an order it
would refuse was pointless. Once §7's prediction came true the condition was a
leftover, and delivery fell through to the cron:

| Order | Placed → branch number | Attempts |
| --- | --- | --- |
| SM-2026-000059 | 42.3 s | first try |
| SM-2026-000060 | 32.2 s | first try |
| SM-2026-000061 | 17.8 s | first try |
| SM-2026-000062 | 44.6 s | first try |

**Every one succeeded on the first attempt**, so none of that was the POS. It was
the wait for the next tick, and the 18-45 s spread is only where in the minute
each order happened to land.

### The kick is TARGETED, and it was 253 ms from failing

Closing the delivery gate fixed *which* orders got a kick. It did not fix what
the kick then did, and measuring one healthy order exposed that:

| SM-2026-000065, 8.06 s to the POS | |
| --- | --- |
| order-intake overhead + gateway | 1.04 s |
| worker boot + a duplicate `integration_settings` read | 0.24 s |
| `reap_stale_lazywait_syncs` | 0.89 s |
| claim | 0.16 s |
| three SERIAL reads (branches, order_items, profiles) | 0.69 s |
| **CRM customer search** | **3.47 s** |
| **`POST /pos/orders/create`** | **1.57 s** |

**The POS was never the problem.** The one irreducible external call is 1.6 s;
the other ~6.5 s was ours. Then `dispatchPendingPosSync` added another 3.4 s
*after* the branch number was already known — inside the invocation the
customer's checkout was still awaiting. That request took **10.747 s against an
11 s abort**: 253 ms of headroom. On SM-2026-000064 the abort appears to have
actually fired, and the order number arrived by luck.

Four changes, and the reasoning matters more than the numbers:

- **The kick names ONE order.** It used to send `{limit: 5}`, and
  `claim_lazywait_sync_batch` orders by `created_at` **ascending** while the
  worker processes serially — so the customer's brand-new order was handled
  **last** of whatever the batch claimed. Their checkout blocked while other
  people's orders were sent to the POS. `claim_lazywait_sync_one` already
  existed, unused, with a byte-identical predicate apart from the id filter.
  Draining the queue was never this function's job; the cron owns that.
- **The push drain is deferred**, not removed. It cannot change the number the
  customer is waiting on, yet it was a third of the awaited time. Delivery stays
  at-most-once because `claim_pos_sync_notification` fences the claim, and a row
  left `pending` by a teardown is taken by the next tick — delayed, never
  dropped.
- **The reaper is deferred, NOT skipped**, and that distinction is deliberate.
  Skipping saves the same 0.9 s, but `reap_stale_lazywait_syncs` has exactly one
  production caller, so the cron and this kick are also its only two reaping
  drivers — and they do not share a failure mode (the cron returns early without
  invoking anything if the vault secret `lazywait_sync_project_url` is missing;
  the kick builds its URL from `SUPABASE_URL`). Deleting the redundant driver
  would let one missing secret stop all reaping, and a **cash** order stranded in
  `syncing` with no ref is invisible to the watchdog too, since R1 and R7 both
  require `payment_status = 'paid'`.
- **The CRM lookup is capped at 1.5 s on the kick path** and keeps its 8 s on the
  cron path. It returned nothing on both measured orders, and it cannot do
  otherwise yet: `profiles.lazywait_customer_id` has never been populated for
  anybody. It also sits *before* `begin_lazywait_create_attempt`, so every
  millisecond it burns is deadline budget spent before that gate re-checks
  `pos_sync_deadline_at` — capping it is safety-positive, not merely faster.

The three per-order reads now issue concurrently. `SYNC_TIMEOUT_MS` stays at
11 s deliberately: it is a **ceiling**, not a target, and with the awaited work
now bounded at roughly 4-5 s the point is that it should never be reached.

**An unclaimed win worth stating:** an ONLINE order sits at `awaiting_payment`
and cannot be sent at all, yet its checkout previously blocked for up to the full
11 s while the worker reaped and drained up to five *other* customers' orders.
Targeting ends that too.

### The bottleneck moved to Lazywait, and the timeout moved with it

Two more orders settled it. Once the CRM lookup came off the awaited path as
well, **everything we do collapsed to about 1.2 s** — measured on
SM-2026-000068: worker boot and configuration 1.08 s, the claim and all three
catalog reads within 2 ms of each other, and **68 ms** between the reads and the
pre-send gate, where a 3.47 s CRM search used to sit.

What is left is Lazywait's own Create Order call, and it is erratic:

| Order | Create Order call | Lines |
| --- | --- | --- |
| SM-2026-000065 | 1.57 s | 1 |
| SM-2026-000066 | 1.62 s | 2 |
| SM-2026-000067 | 2.40 s | 2 |
| SM-2026-000068 | **8.02 s** | 1 |

The slowest was the **smallest** order, so it is not payload size. On -000068
that call was **82%** of the entire wait.

`SYNC_TIMEOUT_MS` was therefore cut from **11 s to 5 s** on 2026-08-27. It covers
our ~1.5 s plus a POS call of ~3.5 s — comfortably above the three normal
observations — and bails fast on the pathological one instead of holding a
customer on a spinner for eleven seconds and *still* failing to show a number.

**Timing out is not a failure.** The abort only stops `order-intake` waiting; the
worker keeps running and finishes the sync. That is observed, not assumed — on
SM-2026-000064 the abort fired and the order got its branch number anyway. The
customer sees the "number pending" state and the number arrives once the POS
confirms, from a push that only ever says "confirmed" when the POS really has the
order.

So the intended trade is: on a slow POS the number arrives shortly after first
paint instead of on it, and in exchange nobody waits 11 s for it.

### The cut was reverted on 2026-08-28, because it shipped without its client half

**This section originally called the cut safe. It was not — not as shipped.** The
server change was deployed as `order-intake` v7 while both client changes that
make it safe were still sitting in a branch, and one of them had not been written
at all. The next real order paid for it.

SM-2026-000070 was **completely healthy**: `synced`, ticket **#2**, in **7.30 s**,
`sync_attempt_count 0`, `first_pos_sync_failure_at` NULL,
`pos_confirmation_reason` NULL. The database never held `confirmation_required`
for it. Its customer was nonetheless shown **"تعذر التحقق مما إذا كان الفرع قد
استلم هذا الطلب"** — *we could not verify whether the branch received this order*
— while simultaneously receiving a `pos_confirmed` push. Two contradictory
answers about an order that worked perfectly.

The mechanism is an ordering bug in `deriveCustomerOrderState` that the 11 s
ceiling had been hiding. `pos_create_attempted_at` is written by
`begin_lazywait_create_attempt` **immediately before the POST leaves**, so an
in-flight order always carries the marker. The derivation tested that marker
*before* it tested `syncing`, so any order checkout returned on mid-send rendered
the ambiguous-failure copy. At 11 s a 7.30 s order had already reached `synced`
before checkout returned, so the screen showed `#2` and nobody ever saw the
branch. At 5 s it became the **default** for every order slower than five
seconds.

Two things follow, and both are now done:

- **`deriveCustomerOrderState` tests `syncing` before the marker** (fixed
  2026-08-28). `ref != null` deliberately stays ahead of it — a syncing row that
  already holds a ref really is ambiguous — and a marker that *outlived* its send
  (`pending`/`failed`/`dead_letter`) still reads as ambiguous. Only the actively
  in-flight case moved. `sending_to_branch` and `verifying_with_branch` are both
  `canResend: false` with `showBranchNumber: true`, so the never-resend guarantee
  is untouched; the tone changes from `warning` to `info`.
- **`SYNC_TIMEOUT_MS` is back at 11 s**, and stays there until a shipped app build
  carries both that fix and `nextReceiptPollMs` below. The revert needs no build,
  restores the behaviour SM-2026-000070 would have had, and is the only half of
  this that reaches a customer today.

The 5 s cut is still the right end state — the measurements above stand and
Lazywait's call is the real bottleneck. It should be re-applied as its own change
**after** a build ships the client half, not before. There is a tripwire on the
constant in `supabase/functions/_shared/orderIntakeSyncWiring.test.ts`.

### The SQL authority had the same bug, and nothing was comparing the two

`public.customer_order_state` is the documented server authority; the TypeScript
`deriveCustomerOrderState` is its mirror. PR #286 fixed only the mirror, which a
review bot flagged. The SQL really did carry the same marker-before-`syncing`
ordering — confirmed by reading the **deployed** function body rather than the
repository file (`marker_evaluated_first = true`).

**It reached no customer screen**, and it is worth being precise about why,
because the reason is not the one that first suggests itself. Three barriers
stand, not one: the customer read contract grants raw columns and never a state
string; `ConfirmationHero` and `OrderCard` both derive locally from those
columns; and `ReceiptScreen.tsx:180` **discards the RPC's response entirely** —
*"the RPC's own outcome is advisory, the row is the truth"*.

Producing the wrong value at all takes a race: `request_customer_pos_resend` has
to be called while the row is `syncing` with the marker set, which in the normal
flow means a Resend button rendered from a snapshot that has since gone stale.
So the exposure was narrow. What makes it worth fixing anyway is that the
outermost barrier is an accident `api.ts` documented the *opposite* of ("the UI
renders from `state` alone"), so the next person to follow that written contract
removes it. That comment is now corrected.

**Resend safety was never at risk**, and that is structural rather than lucky:
`request_customer_pos_resend` branches on `customer_manual_pos_resend_eligibility`,
a separate predicate over raw columns, and calls `customer_order_state` only
*after* the accept/refuse decision, to fill an advisory field. Reordering the
state function cannot turn a refused resend into an accepted one.
**`customer_manual_pos_resend_eligibility` must NOT receive the same reorder** —
its marker-first ordering is correct there, since an in-flight order must never
be resent when Create Order has no idempotency key.

#### The deeper finding: parity was never enforced, and had already drifted

The migration's own header claimed *"both sides are unit-tested against the same
case table so they cannot drift"*. There was no shared case table — two
hand-maintained lists in different CI jobs — and they had **already** drifted:
for `failed` with a future `sync_next_attempt_at` the SQL said
`sending_to_branch` (a leftover auto-retry arm) while the TypeScript said
`branch_failed_retry_available`. Both suites green — for **15 days**, from
`f7515e5` on 2026-08-13, which introduced the manual-resend-only migration and
the TypeScript change in the *same commit* while leaving this SQL clause behind.
The TypeScript was right: that policy removed automatic retries.

Worse, the SQL half could not have caught it. `sql-suites.yml` deliberately has
no workflow-level `paths:` filter — so the gate always reports and is safe to
require — but its `changes` job computes `relevant` from a path regex covering
`supabase/(migrations|tests)/`, `supabase/seed.sql` and `.github/sql-ci/`, and the
`suites` job is gated `if: needs.changes.outputs.relevant == 'true'`. A
**TypeScript-only diff — precisely the shape that causes this drift — therefore
runs the workflow, reports green, and executes no SQL assertions at all.** Adding
a case to the SQL suite would not have gone red on PR #286.

So parity is now enforced from the side that always runs:
`apps/mobile/src/features/orders/orderConfirmationSqlParity.test.ts` resolves the
latest migration defining the function, strips its comments, and pins the
**complete ordered clause sequence** of both `customer_order_state` and
`customer_manual_pos_resend_eligibility`, plus the readable order relations, the
absence of any `p_next_attempt_at` arm, and the matching inputs against the real
TypeScript implementation. It also ties the SQL `customer_pos_resend_limit()`
literal to `CUSTOMER_RESEND_LIMIT`, which nothing previously connected.

**Sampling was not enough, and that was proven rather than argued.** An earlier
version pinned four representative clauses; three mutations walked straight
through it — a clause inserted *above* all four preserves their relative order
(reintroducing the SM-2026-000070 screen for any resent order), flipping the
resend budget's `<` to `<=`, and swapping the eligibility predicate's
`then 'not_failed'` to `then 'eligible'`, which would make an in-flight order
resendable and duplicate a live kitchen ticket. Pinning the whole sequence closes
all three: any insertion, deletion, reorder, predicate edit or result change is
red and must be re-approved deliberately.

The mutation matrix it is held to:

| Mutation | Expected | Result |
| --- | --- | --- |
| Marker moved back ahead of in-flight | red | ✅ |
| Auto-retry arm restored | red | ✅ |
| Clause inserted above the sampled needles | red | ✅ |
| Resend budget `<` → `<=` | red | ✅ |
| Future migration reintroducing the bug, uppercase + wrapped | red | ✅ |
| Eligibility marker arm commented out | red | ✅ |
| Eligibility result swapped to `'eligible'` | red | ✅ |
| SQL resend limit changed to 5 | red | ✅ |
| Nested block comment hiding a clause | red | ✅ |
| Pure reformat / wrapped clause | **green** | ✅ |

The last row matters as much as the others: a tripwire that cries wolf on a
formatter gets disabled.

`20260828090000_customer_order_state_inflight.sql` carries both corrections and
was **applied to Production on 2026-08-28 at 18:22:28 UTC** on explicit owner
approval (live version `20260828182228`; ledger row 75 in `docs/MIGRATIONS.md`).
SQL and TypeScript now agree.

Verified behaviourally rather than by reading the body — the five cases were
executed against the live function:

| Input | Before | After | TypeScript |
| --- | --- | --- | --- |
| `syncing` + marker | `verifying_with_branch` | **`sending_to_branch`** | `sending_to_branch` |
| `failed` + future `sync_next_attempt_at` | `sending_to_branch` | **`branch_failed_retry_available`** | `branch_failed_retry_available` |
| `syncing` + ref | `verifying_with_branch` | `verifying_with_branch` | same |
| marker outlived the send | `verifying_with_branch` | `verifying_with_branch` | same |
| `synced` + usable ref | `confirmed_by_branch` | `confirmed_by_branch` | same |

**The duplicate-ticket guard was confirmed intact**, which is the property worth
checking rather than assuming: `customer_manual_pos_resend_eligibility` hashes
unchanged and still returns `may_have_sent` for an in-flight order, and
`request_customer_pos_resend` hashes unchanged. The money path
(`place_order`, `compute_order_snapshot`) hashes identically before and after,
and no order row was touched.

One measurement error worth recording, because it is the kind that produces a
false "verified": the first probe for the removed auto-retry arm searched the
whole `pg_get_functiondef` for `p_next_attempt_at` and reported it **still
present**. That string includes the parameter list, and the parameter is retained
deliberately so `CREATE OR REPLACE` replaces the function rather than adding an
overload. Scoped to the CASE body the arm is absent, and the overload count is 1.

Note what the tripwire does and does not track: it resolves the latest migration
in the *repository*, which is the definition the repository intends. That now
matches Production, but the two are separate facts and only the first is what the
test checks.

**No staleness clock was added to the in-flight case.** A worker that dies
mid-POST leaves `syncing` for up to ten minutes before the reaper routes it to
`confirmation_required`, and during that window the screen says "sending" rather
than "verifying". That is the right trade: the customer can act on neither state,
the reaper owns the transition, and under-alarming on a rare crashed worker is
far cheaper than alarming on every normal order.

**That sentence originally said "a second or two later by push", and it was
wrong** — caught in review before the cut shipped. The `pos_confirmed` push is
**data-free** and `NotificationTapBridge` only navigates when the notification is
**tapped**, so a customer sitting on the receipt was not being refreshed by it at
all. They would have waited for the next `RECEIPT_POLL_MS` tick — **25 seconds**
— to see a number the server had held for twenty of them. Cutting the timeout
without noticing that would have made the 5-11 s band *worse* than before, which
is the exact band the cut exists to serve.

So the receipt now **polls every 2 s while the branch number is still missing**
(`nextReceiptPollMs`), falling back to the 25 s interval once it arrives, and
bounded to a 90 s window so a number that is never coming is not polled for
indefinitely. It is a self-scheduling timeout rather than `setInterval`, because
an interval cannot change its delay.

Deliberately **independent of push delivery**: a poll still works when the
customer denied notifications, when Expo is slow, and when the push is simply
never displayed. Tying the number's arrival to a notification would make it
depend on a channel that is allowed to fail.

The variance itself is a question for the vendor rather than something to
engineer around indefinitely — the evidence pack is
[`Lazywait_Create_Order_Latency_20260827.md`](integrations/Lazywait_Create_Order_Latency_20260827.md).

**Do NOT also shorten the Create Order `timeoutMs` in `lazywaitFetch`** (15 s).
That one is the boundary between proven-not-sent and may-have-been-sent: a
timeout there is classified `ambiguous` and routes to `confirmation_required`
rather than a resend, because Create Order has no idempotency key. Shortening it
would turn slow-but-successful tickets into orders a human must verify by hand.

### The real bottleneck is the region gap, measured directly 2026-08-30

The checkout wait is dominated by **cross-region round trips**, not by our SQL and
not by cold start. Both of those were measured and ruled out:

- **`place_customer_order` is 1.7 ms.** Profiled on a disposable database built
  from the full migration chain — 0.39 ms pricing, 1.29 ms writes. It stays flat
  at **51,173 orders / 154,108 order items** (1.29 ms), with 98 index scans and
  **zero sequential scans**; `order_number` comes from a sequence and the
  idempotency lookup is indexed. Production's 216 ms mean for the same call is
  therefore transport, not logic.
- **Cold start is not the *whole* cause — but it was real, and this bullet used
  to overstate its own result.** After fifteen minutes idle, `order-intake`
  answered in **828 ms**, which refuted an earlier confident inference blaming
  Deno module loading for ~2.6 s. What that test could not tell anybody is
  whether the isolate it hit was actually cold: `isolate_age_ms` did not exist
  yet. Once it did, **SM-2026-000073 (2026-08-30) caught a genuinely cold
  request** — `isolate_age_ms: 3` — and its front measured **2351 ms**
  (`execution_time_ms 11024` against the handler's own `total_ms 8673`). Both
  facts stand: the 828 ms observation was real, and so is the 2351 ms; the first
  simply did not measure what it was taken to measure.

  **This bullet used to end by concluding that boot "was therefore worth
  removing".** It was not — see the `booted` table below, which measures 23 ms
  with the npm dependency and 23 ms without. The conclusion is struck rather than
  quietly deleted, because it stood in this document contradicting its own
  retraction three sections later.

What the evidence shows: the database is in **`eu-central-1`** (Frankfurt), while
a customer in Saudi Arabia has the Edge Function executed in **`ap-south-1`**
(Mumbai) or **`eu-central-2`** (Zurich).

#### The control, measured per-request on 2026-08-30

The gateway records `response.origin_time` on every REST call — how long the
database itself took, excluding the client. During SM-2026-000074 the **same
worker function on the same deployment** ran from two colos inside the same
minute, one invoked by the order kick (Mumbai, routed to the customer) and one by
the cron tick (Frankfurt, in-region). Identical queries:

| Query | from **BOM** (Mumbai) | from **FRA** (Frankfurt) | ratio |
| --- | ---: | ---: | ---: |
| `GET integration_settings` | **934 ms** | **35 ms** | 27× |
| `POST reap_stale_lazywait_syncs` | 525 ms | 30 ms | 18× |
| `GET notification_log` | 179 ms | 26 ms | 7× |

Three genuinely identical statements. A fourth near-pair — `claim_lazywait_sync_one`
165 ms from Mumbai against `claim_lazywait_sync_batch` 26 ms from Frankfurt — is
excluded from the table on purpose: they are different functions, and a table
whose point is "same statement" should not contain one that is not.

**This supersedes the p50 comparison that stood here** (556 ms across 442
in-region cron invocations against 5934 ms for a single `ap-south-1` order kick).
That compared whole invocations doing different amounts of work, with n = 1 on
one side. This compares the same statement, from the same function, in the same
minute, timed by the gateway.

#### The spread WITHIN Mumbai is unexplained — and one tempting reading of it is
#### a hypothesis, not a finding

The Mumbai calls are not uniform. From `order-intake` (all three carrying
`X-Client-Info: sma-edge-rest/1`) and from `lazywait-sync` on the same order:

| Call | origin_time |
| --- | ---: |
| `POST rpc/place_customer_order` (order-intake, concurrent with the next) | **1265 ms** |
| `GET integration_settings` (order-intake, concurrent with the above) | **919 ms** |
| `GET integration_settings` (worker, its first call) | 934 ms |
| `POST reap_stale_lazywait_syncs` | 525 ms |
| `GET branches` / `GET profiles` (issued concurrently) | 519 / 522 ms |
| `PATCH orders` | 535 ms |
| `POST claim_lazywait_sync_one` | 165 ms |
| `GET order_items` (concurrent with branches/profiles) | 168 ms |
| `POST begin_lazywait_create_attempt` | 184 ms |
| `POST record_lazywait_sync` | 196 ms |
| `GET notification_log` | 179 ms |
| `GET orders` (order-intake, its last call) | 195 ms |

**A first draft of this section read that as connection setup** — "each cold
isolate pays 0.7-1.3 s once, then ~170-200 ms per call" — and review was right to
reject it. The data does not support it:

- the calls differ in what they *do*. `place_customer_order` writes an order in a
  transaction; `notification_log` is a small select. Comparing them measures the
  queries, not the connection;
- the sequence is **not** monotonic. `claim_lazywait_sync_one` (165 ms) ran early
  and was cheap; `PATCH orders` (535 ms) ran late and was expensive. "First call
  expensive, rest cheap" is contradicted by the order's own log;
- several of the elevated calls are **concurrent** — `place`/`config` by design,
  and `branches`/`profiles`/`order_items` in one `Promise.all` — so contention or
  pool behaviour is at least as good an explanation.

**What is established** is the cross-colo difference in the table above, on
identical statements. **What is not** is how the Mumbai spread divides between
connection establishment, query cost, concurrency and pool state.

**That test has now been run.** `latency-probe`, a throwaway diagnostic
(`supabase/functions/latency-probe/`), issues one byte-identical statement eight
times **sequentially** from a fresh isolate — so query cost is a constant,
concurrency is removed, and `isolate_age_ms` distinguishes cold from warm. Eight
runs, **64 measurements of the same statement**, from `IAD` (us-east-1) against
the database in `eu-central-1`. Client-side timings tracked the gateway's
`origin_time` within ~10 ms, so essentially all of the cost is at or behind the
gateway rather than in the function's own networking.

**The result is bimodal, and sharply so:**

| Mode | n | min | median | max |
| --- | ---: | ---: | ---: | ---: |
| fast | 30 | 105 ms | **120 ms** | 143 ms |
| slow | 34 | 212 ms | **305 ms** | 509 ms |

Exactly **one** of 64 values (212 ms) falls between the two modes. This is not a
spread around a mean; it is two states, roughly 2.5× apart.

**The connection-setup reading is refuted, three ways:**

- **it is not the first call.** Per-call means across the eight runs read 299,
  213, 212, 195, 262, 236, 186, 186 — no trend, and call 5 is slower than call 4.
  Two of eight runs had a *fast* first call (137 ms, 132 ms);
- **it flips WITHIN one isolate, in both directions.** Run 4 went slow-fast-fast-fast-slow-fast-fast-fast
  (three transitions), run 6 three, run 8 two. A once-per-isolate cost cannot do
  that;
- **it is not the table.** The trailing read of a *different* table shows the same
  two modes (105-121 ms against 290-331 ms).

So the per-call cost is selected per request by something behind the gateway that
this codebase does not control. The fast mode, ~120 ms, is close to the IAD↔FRA
network round trip; the slow mode at ~2.5× is *consistent with* extra round trips
for connection establishment — but that reading is an interpretation, and the
measurement stops at "bimodal, and not explained by query, position, isolate or
table".

**What this means for optimisation work**, which is the reason to care:

- **fewer queries helps, linearly.** Every PostgREST call on the order path costs
  120-305 ms from a distant colo, whatever else is true. Removing one removes
  that;
- **fewer isolates does not.** There is no measured per-isolate cost to amortise.
  An earlier draft of this section argued the opposite and was wrong;
- **being closer to the database helps most**, because the *fast* mode is itself a
  network round trip. In-region calls in the table above are 26-35 ms.

Measured from `IAD`; a customer in Saudi Arabia is served from `BOM` or
`eu-central-2`, so the absolute numbers differ. What generalises is the
structure — bimodal, position-independent, not per-isolate — not the constants.

For scale, the customer's own phone (Riyadh colo, `supabase-js/…; runtime=react-native`)
read `branches` in 109 ms and `orders` in 108 ms in the same window — **the
handset reaches Frankfurt faster than our Edge Function in Mumbai does on most of
its calls.** Whether that is the handset's open connection or something else is
the same open question.

So every PostgREST call on the order path is intercontinental, and the path makes
roughly nine of them. That much is measured.

#### What was removed, and what deliberately was not

`order-intake` now starts the provider-config read **before** `place_customer_order`
instead of after it. The read uses the service-role identity and does not depend
on the order, so the old ordering cost a full extra cross-region round trip for
no reason. `serviceTarget()` — `adminClient()` before the dependency removal
below — stays inside a `try`: it throws when the service-role env is missing, and
hoisting it bare would turn a misconfigured environment into a failed checkout —
the opposite of the rule that a POS problem can never fail the order.

Three things on that path look redundant and are **not**:

- **the worker's own `getProviderConfig`** is its authentication gate. The
  function runs with `verify_jwt = false`, so the `x-sync-secret` comparison is
  the only thing standing in front of it, and it cannot trust a secret supplied
  by the caller. It also cannot run concurrently with the claim, because that
  would let an unauthenticated caller flip orders to `syncing` before being
  rejected;
- **the `orders.update` that persists the ref before `record_lazywait_sync`** is
  crash safety. If the isolate dies between the POST and the record, the ref is
  already stored and the reaper recovers the row to `synced` instead of
  re-POSTing. Create Order has no idempotency key, so collapsing these two writes
  would risk a duplicate kitchen ticket;
- **the reaper and the CRM lookup** are already off the awaited path in targeted
  mode (deferred, not skipped — the kick is one of only two reaping drivers).

The remaining lever inside our control is a migration that merges
`claim_lazywait_sync_one` with the three catalog reads into one round trip. That
is a schema change and a separate owner decision, not done here.

**The instrumentation is the point of this change as much as the saved hop.**
`order-intake` now logs one line of timings per request — numbers only, no order
contents and no customer data, with a test pinning that. Apportioning this
latency from outside produced a confident wrong answer once already; the next
order will give exact per-hop figures instead.

#### First measured order, and what it corrected

SM-2026-000072 (2026-08-28 20:26 UTC) was the first order through the
instrumentation: POS ticket **#4**, first attempt, `confirmed_by_branch`, push
correct, 5.69 s from order row to synced. Its timing line read

    config_ms 1016 · place_ms 1341 · sync_span_ms 5249 · reread_span_ms 539 · total_ms 7129

and immediately exposed a defect in the instrumentation itself. The platform
reported **execution_time_ms 9191** for the same invocation — **2062 ms that the
log could not see**, because `t0` was set *after* `await req.json()`. Everything
in front of it (gateway JWT verification, isolate boot, and the phone uploading
the request body) was invisible, and it was the largest unexplained block in
checkout.

`t0` is now the **first line** of the handler, with `entry_ms`, `parse_ms` and
`body_read_ms` decomposing what the handler can see. A positional test asserts
`t0` precedes both the Authorization check and `req.json()`.

**It still does not measure the whole invocation, and an earlier revision of this
section wrongly said it would.** Review raised that as a P1 and it was correct:
the module's three imports — one of them `npm:@supabase/supabase-js` — are
evaluated at isolate boot *before* `Deno.serve` registers the callback, and
gateway JWT verification happens before that again. So

> `execution_time_ms − total_ms` is positive **by construction**, and that
> residual **is** the front.

It is quantified by subtraction from the logs — a method, not a target. Expecting
the two numbers to converge would be expecting the wrong thing.

Two consequences worth stating precisely:

- **`body_read_ms` is a lower bound**, not the device's upload. The runtime may
  buffer part of the body before the callback runs, and anything buffered that
  early is invisible. It was briefly named `upload_span_ms`, which asserted more
  than it can measure.
- **`isolate_age_ms`** (`t0 − MODULE_LOADED_AT`, stamped at module scope) is the
  one piece of the front observable from inside: near zero means this request
  paid module evaluation, a large value means it landed on a warm isolate. A test
  pins that stamp outside the handler, because inside it would equal `t0` and
  report a constant zero while still looking like a measurement.

**The 2062 ms on SM-2026-000072 is no longer open. SM-2026-000073 answered it,
and the answer was not the one this section leaned towards.**

    isolate_age_ms 3 · entry_ms 0 · parse_ms 1 · config_ms 961 · place_ms 1393
    sync_span_ms 6589 · reread_span_ms 690 · body_read_ms 1 · total_ms 8673

against the platform's `execution_time_ms 11024`. Two readings settle it:

- **`body_read_ms: 1` refutes the body-upload hypothesis.** The body was already
  buffered before the callback fired, so the device's uplink is not in this
  number at all. It was recorded above as a hypothesis rather than a finding,
  which is the only reason retiring it costs nothing.
- **`isolate_age_ms: 3` confirms a cold boot.** The isolate was three
  milliseconds old, so this request paid module resolution and evaluation. The
  residual **2351 ms** is gateway JWT verification + isolate spawn + module
  evaluation, plus the short tail after the `total_ms` stamp (serialising the
  response and returning it) — everything the handler's own clock cannot reach,
  on both sides.

  **How that 2351 ms divides is not measured.** `npm:@supabase/supabase-js` sat
  inside the module-evaluation term and was the only module worth removing from
  it, which is why it was removed; its own share has never been separated, and
  n = 1. Saying it "was the bulk" would be an inference wearing a measurement's
  clothes — the error class this section has already had to retract twice.

The order itself was healthy throughout: POS ticket **#1**, first attempt, zero
failed attempts, `confirmed_by_branch`, 6.64 s from order row to synced.

#### The parallelisation is NOT yet shown to help

Recorded because the opposite was briefly claimed. Within the instrumented window
the overlap did happen — `config_ms` 1016 and `place_ms` 1341 share a `t0`, so
sequentially those two would have cost ~2357 ms. But the **totals** are

| Order | Version | execution_time_ms | Edge region |
| --- | --- | --- | --- |
| SM-2026-000066 | v5 | 9897 | — |
| SM-2026-000068 | v6 | 11401 | eu-central-2 |
| SM-2026-000069 | v7 | 10645 | ap-south-1 |
| SM-2026-000070 | v7 | 7926 | ap-south-1 |
| SM-2026-000071 | **v8** (sequential) | 9802 | ap-south-1 |
| SM-2026-000072 | **v9** (parallel) | 9191 | ap-south-1 |

611 ms apart, of which Lazywait's own call accounts for 258 ms, leaving roughly
**350 ms** attributable — well inside a spread that runs 7926-11401 ms, with
**n = 1 on each side**. Region is not the confound here (both ap-south-1), and
time-to-order-creation is unchanged (2837 ms versus 2680 ms), which is expected
since the config read previously ran *after* `place_customer_order` and never
delayed order creation. **No improvement is established.**

#### The npm dependency came off the boot path (2026-08-30)

`order-intake` no longer imports `npm:@supabase/supabase-js@2`. It talks to
PostgREST through [`_shared/rest.ts`](../supabase/functions/_shared/rest.ts) —
plain `fetch` over Web-standard APIs — for the three calls it actually made: the
provider-config read, `place_customer_order`, and the order re-read.

**The reason it was done is FALSE, and this section records that rather than
rewriting it.** The argument was: imports are evaluated at isolate boot, before
`Deno.serve` registers the callback, so no mark inside the handler can see them
— which made module evaluation the natural suspect for the 2351 ms front and
made the suspicion unfalsifiable from where anyone was looking.

The runtime emits its own `booted` event, and nobody had queried it. Measured
2026-08-30, after the deploy:

| Time (UTC) | Version | supabase-js | `booted` |
| --- | --- | --- | --- |
| 05:19:04 | v10 | yes | 26 ms |
| 05:33:48 | v10 — **SM-2026-000073 itself** | yes | **23 ms** |
| 06:52:50 | v11 — first boot of a brand-new deploy | **no** | **23 ms** |

Identical. Supabase bundles an Edge Function into an **eszip at deploy time**
(the `ezbr_sha256` on every deployment), so npm resolution happens then, not at
boot; at runtime the graph is already inside the bundle and loading it costs
~23 ms either way. **Module evaluation was never two seconds. The 2351 ms front
is unexplained again.**

Corroborating: a bare `OPTIONS` request to the fresh v11 deployment — the one
that carried its first boot — measured `execution_time_ms` **175 ms**, and 47 ms
on the next. A cold invocation of this function through the gateway costs
somewhere near a tenth of what the front on SM-2026-000073 was.

**What the change is still worth.** The hottest customer path no longer carries a
dependency it does not need, and the replacement has executable tests the old
path never had. Both are real. Neither is a latency improvement, and no claim
that this shrinks boot should be reintroduced.

**The rewrite changes the dependency and nothing else, deliberately.** Every
behaviour was read out of package source — `postgrest-js` and `supabase-js`
2.112.4, from the Deno cache — and replicated. Stated that way rather than as
"the packages the function was running", because `npm:@supabase/supabase-js@2` is
a floating specifier resolved at build time and this repository records nowhere
which 2.x the deployed bundle contained:

| Behaviour | Why it had to be replicated |
| --- | --- |
| `select` whitespace stripping | **Fidelity, not a 400** — and the first draft of this row said otherwise. PostgREST tolerates `select=id, status`: its parser has the space character inside the identifier charset and trims each identifier, confirmed read-only against this project's live PostgREST. Stripping is kept because it is what went on the wire before, and because an *internal* space is preserved as part of an identifier, so the tolerance only covers spaces adjacent to a delimiter. Recorded rather than quietly fixed, because a reviewer who checked the false claim could reasonably have deleted the stripping — which would then fail silently on a differently-shaped select rather than loudly on this one. |
| `maybeSingle()` collapse | It is a **client-side rule**, not an `Accept` header. Zero rows → `null`, one row → the object, more than one → PGRST116/406. Sending `vnd.pgrst.object+json` instead would turn "no such row" into an error. |
| transport failure → `error`, not a throw | `postgrest-js` swallows the rejection and returns `{ error, status: 0 }`. Checkout answers 400 with a message; rejecting instead would surface as an unhandled 500. |
| GET retry (3×, 1 s/2 s/4 s, on a network error or 503/520) | On by default in `postgrest-js`. Dropping it would be a second change riding along, and would turn a transient 503 on the re-read into `order: null` at HTTP 200 — which `placeAndSync` throws on (`'Order was not created.'`), telling a customer their order failed when it exists. POST is **not** retried: `place_customer_order` creates an order. |

One header differs on purpose: `X-Client-Info` now reads `sma-edge-rest/1`, which
identifies these requests in the platform logs and is how the change can be
confirmed on a live request rather than assumed.

**The identity split is the security property to protect.** `place_customer_order`
and the order re-read run as `callerTarget(auth)` — the customer's own JWT,
forwarded verbatim, so `auth.uid()` and RLS apply exactly as before.
`serviceTarget()` bypasses RLS and is constructed **once**, inside the existing
`try`, for the integration secret only. Passing it to either customer-facing call
would change no response shape and no test output, so
`orderIntakeSyncWiring.test.ts` pins the identity of each call site.

**Guards.** `rest.ts` is Web-standard-only and therefore *executable* under
Vitest, so `rest.test.ts` tests real behaviour — URLs, headers, the collapse
rule, error mapping, retry — rather than source shape, which is what every other
guard around this function is limited to. `restNoSupabaseJs.test.ts` walks the
import graph from `order-intake/index.ts` and fails if any file in it references
the package in code, type-only imports included; that graph is also the deploy
bundle, and the test pins it at three files
(`order-intake/index.ts`, `_shared/cors.ts`, `_shared/rest.ts` — down from four).

**A version caveat worth stating.** `npm:@supabase/supabase-js@2` is a *floating*
specifier resolved at build time, so which 2.x the deployed function bundled is
not something this repository records. The behaviours above were read from
2.112.4 source; 2.110.0 is what `node_modules` holds, and the two issue identical
requests apart from the version string in `X-Client-Info`. One behaviour did
change inside v2 — `maybeSingle()` moved from a server-enforced `Accept` header
to the client-side collapse at **2.100.1** — and it is the collapse that is
replicated.

**Two things this deliberately does NOT fix**, both pre-existing and both
verified against the base branch rather than assumed:

- the order re-read **discards its error**, so a failed re-read returns
  `{"order": null}` at HTTP 200 and `placeAndSync` throws *"Order was not
  created."* on an order that exists. The base branch does the same;
- `ORDER_SELECT` is **six columns behind** `apps/mobile/src/lib/orderSelect.ts`
  (`is_comped`, `comp_discount_amount`, `notes`, the item-level `note`,
  `variant_name_en`, `variant_name_ar`). Harmless today because the caller keeps
  only `.id` and the receipt re-reads with the full mobile select, and nothing
  pins the two lists together.

Folding either into a transport swap is the "second change riding along" that
§15 of `CLAUDE.md` exists to prevent.

**What this does not do, and what is still unmeasured.** It does not remove
measurable BOOT cost — see the `booted` table above, which is the third
performance claim this document has had to retract.

Be precise about the limit of that result, because the temptation is to round it
up into "the change made no difference". What was measured is the `booted` event.
The **full front** — `execution_time_ms − total_ms` — has NOT been re-measured on
version 11, because that needs a real authenticated order and none has run since
the deploy. The only post-deploy request so far was an `OPTIONS` preflight, which
returns before the auth check and performs no body read and no PostgREST call, so
it is not comparable to a checkout. Treat the effect on the front as **open**, not
as zero.

It does not touch round trips either; the region gap is untouched and remains the
larger term.

**Deployed 2026-08-30 as version 11** on explicit owner approval, after PR #291
merged as `23e911b`. Bundle: three files (`order-intake/index.ts`,
`_shared/cors.ts`, `_shared/rest.ts`), down from four, `verify_jwt` unchanged at
`true`, `ezbr_sha256` `e7b34beb…` → `c200588e…`. Zero orders were in flight.
Verified after: the three deployed files read back matching the merged branch,
`supabaseClient.ts` and `secrets.ts` absent from the bundle, an `OPTIONS`
preflight returning the handler's own CORS values (proof the graph loads), an
unauthenticated `GET` refused 401 by the gateway, and no other Edge Function's
version or `ezbr_sha256` changed — the payment functions included.

#### Confirmed on the first v11 order — SM-2026-000074, 2026-08-30 07:53 UTC

Healthy: delivery, cash, POS ticket **#2**, first attempt, zero failed attempts,
`confirmed_by_branch`, **5.84 s** from order row to synced with Lazywait's own
Create Order taking 3.38 s of it.

**The transport is doing the work.** Three gateway records carry
`X-Client-Info: sma-edge-rest/1`, and they are exactly the three calls this
function makes — `rpc/place_customer_order`, `integration_settings`, `orders` —
all 200. That was the outstanding confirmation.

    isolate_age_ms 4 · entry_ms 0 · parse_ms 0 · config_ms 947 · place_ms 1291
    sync_span_ms 6073 · reread_span_ms 210 · body_read_ms 0 · total_ms 7574

`booted` 18 ms, `execution_time_ms` 8704, so the front was **1130 ms** against
2351 ms on the v10 order, both cold (`isolate_age_ms` 4 and 3).

**That is not an improvement claim, and must not be turned into one.** It is
n = 1 on each side — the exact evidence shape behind the retracted v8→v9
parallelisation claim recorded above — against an observed whole-invocation
spread of 7926-11401 ms. Establishing an effect needs several cold v11 orders
compared on `execution_time_ms − total_ms`, reported with n and spread.

What the same order *does* settle is where the money goes, and it is not the
front: **~1.1 s front, ~2.2 s cross-region database, 3.4 s Lazywait, ~0.4 s
everything else.** The dependency removal was never positioned to touch the two
largest terms.

**None of this closes the region gap itself.** Frankfurt serving Dammam is the
root cause, and moving regions is a project-level decision rather than a code
change.

### The push must follow the send, not precede it

The "order received" push fires **after** the sync block, and that ordering is
load-bearing rather than incidental. For pickup it therefore followed a real
attempt. For delivery the block was skipped entirely, so the customer was told
*"we sent it to the kitchen"* before anything had been sent anywhere — a claim
about the branch made before the branch had heard of the order.

`orderIntakeSyncWiring.test.ts` now pins the ordering positionally in the source,
because no runtime test can: the handler itself uses `Deno.serve`, so Vitest
cannot execute it and `deno check` only typechecks. Its PostgREST transport
(`_shared/rest.ts`) *is* executable and is tested as such — the limit is the
handler, not everything it touches.

### The POS outcome owns the customer's first message

**`order-intake` no longer sends any push.** It used to fire
`order_status/received` unconditionally — *"we received your order and sent it to
the kitchen"* — which is a claim about the **branch**, made whether or not the
branch had heard of the order.

The POS outcome now owns that message, because only the POS outcome knows the
truth:

| Outcome | Event | What the customer is told |
| --- | --- | --- |
| reached the branch | `pos_confirmed` | "confirmed by the restaurant" |
| retryable failure | `pos_retrying` | "confirming it with the restaurant, no need to place it again" |
| ambiguous | `pos_confirmation_required` | "we are verifying" |
| terminal failure | `pos_failed` | "we could not send it" |

`pos_confirmed` now fires on **every** success. It used to be gated behind a
prior failure, which is why **not one `pos_sync` row had ever been written** — and
why the next problem went unnoticed for so long.

### The wording matters as much as the timing

`pos_retrying` and `pos_confirmation_required` used to end **"Please do not place
another order." / "فضلاً لا تنشئ طلبًا جديدًا."** The intent was *do not
duplicate this order while we sort it out.* What it actually reads as — and the
owner read it exactly this way, in Arabic — is **"do not order from us again"**.

Saying that at the precise moment something has gone wrong is the worst available
time to sound like a rejection. Both messages now say *"no need to place it
again"* and pair it with what is being done about it, so the same instruction
lands as reassurance rather than a ban. Keep that shape: this copy is read by
someone who is already worried.

### The gap this uncovered: nothing was sending them

`record_lazywait_sync` and `reap_stale_lazywait_syncs` enqueued deduplicated
`kind='pos_sync'` rows, and `push-dispatch` has a complete `pos_sync` action to
render and send one. **Nothing connected the two** — no cron, no trigger on
`notification_log` (only a status normaliser and an `updated_at` setter), and no
caller anywhere. Those rows would have sat `pending` for ever.

It had never shown because no sync had ever failed *and* `pos_confirmed` was
gated behind a failure, so the queue had never held a single row. The first real
POS failure would have been met with silence — precisely when a customer most
needs to hear that we are on it and they need not re-order.

`lazywait-sync` now drains that queue (`dispatchPendingPosSync`, bounded at
`POS_NOTIFY_DRAIN_LIMIT`) at the end of every run. It is the right home: it
already runs every minute, it produces most of these events, and `order-intake`
already invokes it synchronously at checkout — so on the happy path the
confirmation push rides the very invocation that created it, a second or two
after the customer pressed the button, rather than waiting for a tick.

The drain is a pure **consumer** and never invents an event. `push-dispatch`
re-validates each one against the order's current state
(`pos_sync_status_matches`, marking a stale event `superseded` rather than
sending it) and its fenced claim keeps delivery at-most-once, so a slow or
duplicated drain can neither double-send nor send something no longer true.

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

**Superseded 2026-08-27 — delivery is now a full branch channel, and this
section's own prediction is what made it painless.**

Delivery orders *used* to be held at `blocked` / `delivery_schema_unconfirmed`,
because the Lazywait delivery Create Order schema was unconfirmed and is never
invented. Under a literal "confirmed only after Lazywait accepts" rule, every
paid delivery order would have been permanently unconfirmed, exhausted zero
retries, and been auto-refunded.

`pos_confirmation_channel_active()` decides participation, and is expressed in
terms of the **sync state**, not the order type. That is what this section
predicted would matter: *"when `set_lazywait_initial_sync` starts enqueuing
delivery to `pending` like pickup, delivery becomes gate-active automatically —
no change to the state machine, the RPCs, the refund predicate, or the app."*

Migration `20260827120000` did exactly that, and the prediction held: **nothing
in the state machine, the RPCs, the refund predicate or the app was touched.**
Delivery became gate-active on its own. SM-2026-000059 was the first delivery
order the POS accepted (ticket #3, first attempt).

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
**not** derived from any POS capability — it was chosen before Lazywait had
answered Q5 (`docs/lazywait-delivery-open-questions.md`). Q5 is now answered
(the order note is `order_details`, the per-item note `order_items[].details`,
and `lazywait-sync` forwards both), but the contract states **no** maximum
length, so 280 still rests on readability rather than on a POS limit. If Lazywait
later confirms a shorter maximum this number narrows; it should never silently
widen.

Proven on a disposable PostgreSQL 16 + PostGIS 3.4 cluster on 2026-08-19: the
full 82-migration chain applied from empty, and **41/44 SQL suites passed with 0
new failures** (3 pre-existing quarantine entries). `order_note_length_test.sql`
was additionally mutation-checked — dropping the two triggers makes it fail at
CASE 2 — so a green run means the guard is present, not merely that the file
executed.

## 10c-bis. Availability is re-checked before payment, not after

`place_order` has always refused a cart containing something the branch has
closed. Until the branch-operations work the customer met that refusal as a raw
server exception at the very end of checkout, after choosing a payment method
and without being told **which** item was the problem — and a customer already
browsing never learned about a closure at all, because the mobile catalog loaded
once per mount.

Three things changed, all on the client, none of them a new rule:

1. `CatalogProvider` re-reads branch availability — products **and** options — on
   app foreground and on returning to the menu. Prices, categories and modifiers
   still need a full `reload()`.
2. `CheckoutScreen.placeOrder` re-reads availability **before anything
   expensive** and names any line that has just sold out, including a line whose
   chosen *option* was closed. A failed refresh returns null and the order
   proceeds: the server stays the authority, and a flaky network must not block
   a valid order.
3. Snoozed items stay on the menu rendered as out of stock rather than
   disappearing. A customer who cannot find yesterday's item assumes the app is
   broken; a greyed row with a reason is an answer.

**This adds no check the backend does not already make, and it deliberately does
not move any check later.** `20260810132000_order_modifier_contract.sql` records
why availability is validated at order *creation* and never re-validated at
finalize: re-checking an authorized online snapshot against mutable menu data
could leave a charged customer without an order. The pre-check above runs before
payment is initiated, which is the same side of that boundary as the guard
inside `place_order`.

Details of the availability model itself — the keystone that keeps
`is_available` authoritative, and why `begin_checkout_session` and
`compute_order_snapshot` were never touched — are in `docs/ARCHITECTURE.md` §4.

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

When the number has not been issued yet **on a channel that will issue one**,
the card says so and explains that it will appear as soon as the branch issues
it, rather than showing a blank or a placeholder that could be mistaken for a
real number.

On a channel with **no POS step** the card is not rendered at all — see
"What 'Branch number?' means" in §3. The screen-reader label follows the same
gate, so a delivery customer is no longer read "branch order number, not issued
yet" on an order that has no branch number to wait for.

### The customer's own kitchen note

The receipt renders `orders.notes` — the free-text note the customer attached at
checkout — inside the order-summary card, directly under the item lines and
above the totals. It sits with the food rather than in the metadata card
because it is an instruction about the food: someone checking "did I remember to
say no onion?" looks where the items are. It is rendered only when a note
exists, and never truncated, following the same rule as the modifier lines.

This required reclassifying one column. `notes` was swept into
`INTERNAL_ONLY_ORDER_COLUMNS` (`apps/mobile/src/lib/orderSelect.ts`) when Issue
#94 replaced `select('*')` — a blanket narrowing rather than a judgement about
this column, which sat alongside `coupon_code` and `address_snapshot`. It holds
text the customer typed themselves, on their own RLS-scoped order, bounded to
`ORDER_NOTE_MAX_LENGTH`. Showing someone their own instruction back discloses
nothing they do not already know, and withholding it meant the receipt could not
confirm what the kitchen had actually been told. **Every other column in that
list is unchanged, and the hostile-row contract test still proves it.**

### Per-item notes

A customer can now attach an instruction to a single line ("no onion") as well
as to the whole order. The two are different things and stay separate: the order
note is one instruction for the ticket, the line note is read by a cook
assembling that row. The line note is entered on the item screen, beside the
options it qualifies, rather than on Checkout — "no onion" belongs next to the
onion, not on a screen three steps later that applies it to the drink too.

**The note is part of the cart line's identity.** `makeCartItemId` folds the
trimmed note into the id, so two portions of the same dish where one is "no
onion" stay two lines. Without that they merge and whichever note was added
last silently applies to both.

**It is bounded at 140 characters, half the order note** (`ITEM_NOTE_MAX_LENGTH`,
mirrored server-side by `order_item_note_is_acceptable`). That protects the
kitchen's ability to read the ticket, not the database: ten lines each carrying
280 characters is not something anybody can work from.

**Three write paths carry it, and that is the fragile part.** A note is data the
INSERT must carry, so — unlike the order note, which a trigger can bound after
the fact — a trigger cannot supply it. `place_order` (cash), `compute_order_snapshot`
(builds the online snapshot) and `insert_order_from_snapshot` (writes it after
payment) each carry one line for the note. Those functions are copied wholesale
into a new migration whenever any of them changes, so a future redefinition
started from an older copy would silently drop notes on that path alone — cash
orders keeping theirs while online orders lose them, with nothing failing.
`supabase/tests/order_item_notes_test.sql` case C asserts all three, so that
goes loud instead of quiet.

`begin_checkout_session` is deliberately not redefined: it delegates item work
to `compute_order_snapshot` and never touches a line itself.

**A new column is not readable just because it exists.** `20260724200000`
replaced table-wide SELECT on `orders` / `order_items` with an explicit column
list per table, and PostgREST rejects the WHOLE select rather than omitting a
column the caller may not read. So shipping `notes` / `note` in the customer
selector without `grant select (…) to authenticated` does not hide the note — it
breaks the entire receipt and My Orders for every signed-in customer. The app
change and the grants must ship together; case A2 of the suite pins both, and
also asserts the grant widened nothing else.

**Staff read the item note, and since 2026-08-24 so does the POS.**
`admin_list_orders_with_items` projects it and the receipt modal renders it, in
the danger tone rather than the modifiers' grey — a modifier is what was ordered,
a note is something the kitchen has to *do*. When PR #231 shipped, the note
stopped at the staff dashboard: open question Q5 asked whether Create Order
accepted a note at all, and inventing a field name is exactly what the
`allowAssumedFields` gate exists to prevent. The owner-supplied Create Order
contract answered Q5 — the per-item note is **`order_items[].details`** and the
order-level note is **`order_details`** — so `lazywait-sync` now forwards both
and the POS ticket carries what the dashboard shows. The gap PR #231 left open
is closed.

### The chosen tier, on every line the customer sees

A Lazywait item can carry several named prices — "Chicken Wings" is one item with
Small 7.00 and Large 13.00 — and since `20260824120000_product_variants` those
are `product_variants` rows rather than separate products. That makes the bare
product name ambiguous on a ticket: two lines both reading "Coral" may be
different food at different prices.

Checkout therefore labels a line through `cartLineLabel(item, pick)` rather than
`pick(product.nameEn, product.nameAr)`. It renders `Coral — Large`, and falls
back to the bare name when the line has no tier or the tier name repeats the
product name, so an untiered product reads exactly as it did before. The same
label is used in the three places a line is named to the customer: the line row
itself, the **remove** confirmation, and the **sold-out** message — a removal
prompt naming "Coral" when the cart holds two Corals is not a confirmation.

**The tier the customer is charged is the tier the card advertised.** A one-tap
Add never asks which tier, so the cart assumes one, and it assumes the
**cheapest** — `cheapestVariant`, matching `products.price`, which is the "from"
price the menu card shows. It is deliberately not `variants[0]`: variants arrive
in Lazywait `sort_order`, so the first row is whichever the POS listed first. For
Coral that is the 29.00 tier against a card reading 20.00. `cartSchema.test.ts`
pins the cheapest-not-first rule directly.

**INCIDENT, 2026-08-26 — the server required a tier the shipped app could not
send.** `20260824130000` made `place_order` raise *"Please choose an option for a
product in your cart"* whenever a cart line named no `variant_id` for a product
carrying active tiers. Every one of the 55 active products carries at least one,
and the client code that sends `variant_id` shipped in the **same commit** as the
requirement (`b36e7d8`, PR #256) — so no build in a customer's hands could
satisfy it. From the moment the migration was applied (2026-08-25 06:15:02 UTC)
**no order could be placed from the app, for any product**. It surfaced only as a
generic error; three attempts were logged as 400s from `place_customer_order`
with no order row written.

`20260826050000_place_order_variant_fallback` replaces the refusal with a
fallback to the **cheapest active tier**, applied identically in both passes of
`place_order` — the pricing pass and the insert pass. Applying it to only the
first would charge correctly but store `variant_id` null, leaving the POS ticket
without a `price_id` and the receipt without a tier name.

**The fallback cannot mis-charge anyone.** `products.price` is maintained by the
importer as the cheapest tier and is exactly what a pre-tier client displays;
verified against Production on 2026-08-26, all **55 of 55** active products have
`cheapest active tier price == products.price`, none differing. The invariant
below is preserved rather than weakened.

**It is not a substitute for the picker, and it is not temporary.** An updated
client always names a tier and never reaches the fallback. It exists so a stale
install — of which there will be many for weeks after any release — degrades to
the old single-price behaviour instead of being unable to order at all. The
picker prevents the bad experience for updated clients; the fallback prevents
total failure for the rest.

**Settled 2026-08-25:** a multi-tier product **opens the picker** instead of
being added from the card, and a tiered card reads **"from X"** — but only where
the tiers actually span a range, since more than half of them price every tier
the same and a "from" would then advertise a cheaper option that does not exist.
Those same-price products still open the picker; choosing between flavours
matters to the kitchen even at one price.

The cheapest-tier fallback described above therefore no longer decides what a
customer is charged from the menu — it remains as the cart's defensive default
and as the figure the "from" price and the picker's preselection are both read
from. What is unchanged either way: the price charged may never exceed the price
displayed.

**A pre-tier cart is discarded, not migrated.** The persisted cart carries a
schema version *inside the payload* (`CART_SCHEMA_VERSION`; the key itself may
never change — see `storageKeys.ts`). A v1 payload was written before tiers, so
its rows hold no `variant`, `toOrderItems` would omit `variant_id`, and
`place_order` refuses any product that has active tiers with no tier chosen. The
customer would be unable to check out with nothing on screen explaining why, so
a v1 payload is dropped on hydration. `CartProvider` holds no catalog and cannot
repair those rows itself; an empty cart is recoverable, an unorderable one is not.

**The tier reaches the staff receipt and the customer receipt too.** The line
carries `variant_name_en` / `variant_name_ar` as a **snapshot**, written at
checkout — not a join. A receipt therefore keeps naming the tier the customer
actually bought even after the catalog is re-imported and that tier is renamed or
withdrawn, which a live join could not do.

Both sides render it through a label helper rather than the bare name:
`orderLineLabel(item, isRTL)` in `src/types.ts` for staff, and
`orderLineLabel(item, pick)` in `apps/mobile/src/utils/format.ts` for the
customer. Both fall back to the bare product name when the line has no tier or
the tier name merely repeats it, so an untiered product is unchanged.

**The read grant is load-bearing, not a detail.** `20260824120000` grants
`select (variant_id, variant_name_en, variant_name_ar)` on `order_items` to
`authenticated`. PostgREST rejects the WHOLE select rather than omitting a column
the caller may not read, so adding these to `CUSTOMER_ORDER_SELECT` without that
grant would not hide the tier — it would break the entire receipt for every
signed-in customer, exactly as §10c describes for the note. The grant and the
selector must ship together, and `orderLineLabel.test.ts` pins that the selector
carries the two name columns while still carrying no internal `order_number`, no
`variant_id` and no catalog embed.

`order_items.variant_id` is recorded and the POS ticket carries the ordered
tier's `price_id`.

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

## 10e. Checkout confirms the delivery location, it does not ask for it

The order-type gate (`features/order/OrderTypeSelectScreen`) is **blocking**: a
customer cannot reach Checkout for a delivery order without resolving a
location, and `confirmNewAddress` there always persists the chosen point through
`addressBook.create`. So by the time Checkout renders, a saved address always
exists behind the order context.

Checkout used to re-present the entire picker anyway — a draggable map, the
mandatory guidance field, an optional building line and the saved list — asking
the customer to redo a decision they had already made. Worse, it made Checkout a
**second place the landmark could be written**, which is the exact duplication
`features/order/locationDescription` was created to end: that module's own
header records the era when the field was labelled differently on the two
screens and Checkout dropped it entirely when creating the address, so a driver
could receive an order with no landmark at all.

Checkout now only ever SELECTS:

| View | What it shows | What it can change |
| --- | --- | --- |
| Default | A read-only map preview, the location's label and its landmark | Nothing — one action, "change location" |
| Change | The other **saved** locations as radio rows, plus a row that leaves for location settings | Which saved location the order uses |
| Location settings (`/profile/addresses`) | The full editor | Creating and editing locations — the only place that does |

Consequences worth stating:

- **Checkout never writes an address.** The create/update/reuse branch in
  `placeOrder` is gone; `place_order` receives the id of a saved address that
  already carries a validated landmark. The landmark has exactly one owner
  again.
- **The pin is seeded from the order context** (`deliveryLat` / `deliveryLng`),
  not only from a saved-address lookup. The context point is what the branch was
  resolved against, so what the customer sees is what the order uses even while
  the address book is still loading. The preselect effect fills the pin only
  when the context did not supply one, so a fallback address can never silently
  move a delivery.
- **`need-description` still guards**, but now means "the SAVED location has no
  usable landmark" — an address written before the landmark became mandatory.
  Its copy points at location settings instead of asking for a retype.

### The device-position warning is a warning

`features/checkout/deliveryLocationWarning.ts` compares the device's position
with the delivery pin and, beyond `GPS_MISMATCH_THRESHOLD_KM`, states the
distance. It **never blocks**, and that is a product rule rather than a
threshold to tune: ordering to somewhere you are not standing is the ordinary
case — home while at work, a parent's house, an office. Blocking on distance
would reject the majority of legitimate delivery orders. `checkoutGuards` is
where blocking lives; this module returns copy.

Silence is the default output. No permission, no fix, the null island, a
non-finite coordinate, or an accuracy worse than `MIN_TRUSTED_ACCURACY_M` all
mean "no opinion", never "warn". Checkout reads the position with
`getForegroundPermissionsAsync` and so **never prompts** — asking for location
for the first time on the payment screen would be both surprising and easy to
refuse, and a refusal must cost nothing when the whole feature is one advisory
line.

### An applied coupon is dropped when the basket changes

`validate_coupon` is a function of (code, subtotal) — minimum-spend rules and
percentage discounts both move with the basket — and both order-creation paths
re-run it against the **recomputed** subtotal:
`place_order` (`20260710120100_place_order_delivery_zone.sql:207-209`) and
`begin_checkout_session` (`20260712160000_checkout_sessions.sql:240-242`) each
`raise exception 'Coupon rejected: %'` when it no longer holds.

So a coupon carried past a cart change is **not** a cosmetically wrong number on
the totals card. It is an order that fails at submit, after the customer has
committed to paying.

Checkout tags the applied coupon with the subtotal it was validated against and
drops it whenever that drifts (`appliedCouponSurvives` in `checkoutGuards.ts`,
unit-tested). Watching the subtotal is the point: the cart can move from the
stepper, the remove dialog, the product editor reached by tapping a line, or the
Cart screen underneath — and Checkout stays mounted through all of it. The
previous approach cleared the coupon by hand inside two mutation handlers, so it
covered the stepper and the remove dialog and nothing else; every path nobody
had thought of shipped a discount the server would later refuse. A rejection
*message* is deliberately kept, because it describes the code the customer
typed, not the basket.

### Tapping a line on Checkout opens the item

The Cart screen has always routed a tapped line to
`/product/[id]?cartItemId=…`, and `ProductDetailScreen` has always supported
editing an existing line through `cart.updateItem`. Checkout showed the same
rows but reached none of it: a customer who had picked the wrong size could
change how many they were getting but not which one, and the only way to fix it
was to go back to the cart — losing the location, coupon and payment method
that Checkout's editable lines exist to preserve. Both screens now use the one
editor and the one `cart.updateItem`.

## 10f. A comped order is `paid` on arrival, and that is deliberate

A comped customer (`public.comp_members`) is charged nothing, and the order is
written **`payment_status = 'paid'`** with `paid_at` set at the moment
`place_order` inserts it. No money moved; the state records that nothing is
owed.

That is not tidiness — it is what decides whether the food is cooked.
`set_lazywait_initial_sync` parks a **non-paid ONLINE** order at
`lazywait_sync_state = 'awaiting_payment'`, and `begin_payment_attempt` refuses
a total of 0. `place_order` resolves the payment method **before** the total
exists, so a comped order is still assigned `'online'` whenever that is the
configured default. Left `'pending'` it would never reach the kitchen and could
never be paid — stranded permanently. `'paid'` sends it down the trigger's
`else` branch and straight to the POS queue, exactly as a cash pickup order
goes.

Consequences worth holding in mind:

- a comped order appears in any report keyed on `payment_status = 'paid'`. Its
  `total` is 0.00, so a **sum** is unaffected; a **count** or an average order
  value includes it, which is arguably correct — it is a real order;
- `paid_at` is stamped so watchdog rule **R1 `PAID_ORDER_NOT_SYNCED`** (which
  requires `paid_at is not null`) still catches a comped pickup order the
  kitchen never received. Leaving it null would have put comped orders in a
  blind spot;
- **`customer_order_state` reports `'final_failure_refund_pending'`** for a paid
  order whose POS sends exhaust the retry budget. For a comped order that is
  refund language for money nobody paid, and `order_refund_due` (which requires
  `total > 0`) will never enrol it. The defect pre-dates comps; comped orders
  make it reachable. Not fixed here — refund language is payment-adjacent and
  CLAUDE.md §6 is active. Listed again under Known gaps.

Full behaviour, administration and deploy order: `docs/DISCOUNTS_CAMPAIGNS.md`.

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
- **A comped order can be told it is awaiting a refund.** `customer_order_state`
  reaches `'final_failure_refund_pending'` on a paid order whose POS sends are
  exhausted; a comped order is `paid` with `total` 0.00, so the customer would
  be promised a refund of nothing while `order_refund_due` (requiring
  `total > 0`) never enrols it. Reachable only when a comped order's POS sync
  fails outright. Fixing it means changing refund-facing language, which is
  payment-adjacent under CLAUDE.md §6, so it is recorded rather than patched.
  See §10f.
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
- ~~**Per-item notes do not exist.**~~ **Closed.** `order_items.note` shipped in
  PR #231 (migration `20260821170000`, live `20260822123940`) with the item-screen
  UI, and the POS half followed once the vendor contract answered Q5: the field
  is `order_items[].details`, the order-level note is `order_details`, and both
  are forwarded by `lazywait-sync`. The assumed `delivery_notes` name this bullet
  worried about turned out not to exist at all.
- **Refund worker scheduling is manual.** See §8.
- **`payment-refund` has no integration test against a Tap sandbox.** The pure
  classifier is unit-tested; the transport path is not exercised.
