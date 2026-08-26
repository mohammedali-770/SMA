# Discounts, Campaigns & Comped Customers

This document owns two separate mechanisms, at very different stages:

| Mechanism | Status |
| --- | --- |
| **Campaigns** (#100) | Schema applied to Production, **inert** — no discount can affect a total. |
| **Comped customers** (2026-08-26) | **APPLIED to Production 2026-08-26.** Live and automatic the moment an administrator adds a member; `comp_members` is currently empty. |

Coupons (`public.coupons` + `validate_coupon`) are the third and oldest
mechanism; they are live and are described where they are used rather than here.

## Part 1 — Campaigns (#100)

Status: **schema APPLIED to Production; NOT yet wired into pricing.**

The migration was applied on **2026-07-29** as live version
**`20260729073932`** (class B — see `docs/MIGRATIONS.md` §5 row 50 and §20).
The tables, RLS policies and `compute_campaign_discount()` all exist in
Production.

**No discount can currently affect an order total.** `place_order` does not
call the RPC and writes no `campaign_redemptions` row, so the feature is inert
until the integration described in Assumption 1 is built — and that work is
gated on the eight open questions below, which are business decisions, not
engineering ones. Nothing else is deployed, and no campaign row exists.

## What this slice adds

- **`supabase/migrations/20260728120000_discounts_campaigns.sql`**
  (live `20260729073932`)
  - `public.campaigns` — bilingual name/description; `type` in
    `('percentage','fixed','free_delivery')`; `value`; optional uppercase `code`
    (unique when present); `starts_at`/`ends_at`; `min_order_amount`;
    `max_discount_amount` (percentage cap); `per_user_limit`/`global_limit`;
    optional `branch_id` scoping; `is_active`; timestamps + `updated_at` trigger.
  - `public.campaign_redemptions` — append-only ledger `(campaign_id, user_id,
    order_id, discount_amount, redeemed_at)`; the source of truth for usage
    limits; a partial unique index on `(campaign_id, order_id)` makes a retried
    checkout idempotent.
  - RLS — deny-all by default; admins manage; staff read all; anon + customers
    read only **active, in-window, codeless** campaigns; redemptions are
    read-your-own (no client write grant at all).
  - `public.compute_campaign_discount(...)` — SECURITY DEFINER, STABLE,
    `search_path=public`, revoked from public/anon, granted to authenticated.
    Validates auth/active/window/branch/min-order/per-user/global and returns a
    **server-computed, cap-clamped** discount. Mirrors the existing
    `validate_coupon` pattern.
- **`supabase/tests/discounts_campaigns_test.sql`** — object + grant/RLS
  contract, real SET ROLE RLS enforcement, discount math + cap clamping, and the
  full rejection matrix. Requires a live Postgres (not part of the Vitest suite).
- **`src/lib/campaigns.ts` + `src/lib/campaigns.test.ts`** — typed `DbCampaign`
  /`CampaignType`, a thin `campaignsApi` wrapper (validate via RPC + admin CRUD),
  and DISPLAY-ONLY pure helpers (`selectLiveCampaigns`, `formatCampaignSummary`).
  No client-side discount math. `tsc --noEmit` clean; 12 unit tests pass.

## Open questions — BLOCKING the `place_order` integration (please confirm)

These are business decisions. The `place_order` migration cannot be written
correctly until they are answered, and writing it on guessed semantics would
bake wrong pricing into a server-authoritative RPC. Items **1**, **3**, **4**,
**7** and **8** are the ones that change the code.

1. **Server authority / `place_order` integration is out of scope here.** Like
   `validate_coupon`, `compute_campaign_discount` returns a discount for a
   *server-known* subtotal; a direct client call is only a PREVIEW. The binding
   guarantee (client can't underprice an order) is delivered when `place_order`
   is later changed to (a) recompute the subtotal server-side, (b) call this RPC
   with its own numbers, and (c) insert a `campaign_redemptions` row. That
   `place_order` change is intentionally **not** included, because `place_order`
   has several existing versions (loyalty, idempotency, delivery-zone, the coupon
   TOCTOU fix) and rewriting it is a separate, reviewed change.
2. **Redemption-write race-safety is the writer's job.** Usage limits are read
   from `campaign_redemptions` in the RPC. When `place_order` writes redemptions,
   it must enforce `global_limit`/`per_user_limit` race-safely (e.g. a
   conditional insert guarded by a `count(*) < limit` check under row locks, the
   same pattern as the coupon `usage_count` fix). The current RPC's count-based
   check is correct for validation/preview but is TOCTOU under concurrency, so
   the writer must re-check atomically.
3. **`free_delivery` interacts with `delivery_fee`, not the merchandise
   subtotal.** The RPC returns `discount_amount = delivery_fee` and
   `free_delivery = true`; the intended effect at order time is to waive the
   delivery fee (so `total = subtotal + delivery_fee - delivery_fee`). It is 0
   for pickup orders. **Confirm** whether the order path should model this as a
   discount line or by zeroing `delivery_fee`.
4. **Stacking rules are NOT defined.** Coupons (`validate_coupon`) and campaigns
   are independent today. Whether a campaign may stack with a coupon and/or
   loyalty, and in what order they apply, is a business decision left to the
   `place_order` integration. Default suggestion: apply campaign to the
   merchandise subtotal, then coupon, then loyalty, then VAT — but **confirm**.
5. **VAT interaction.** KSA VAT is inclusive and extracted from the payable total
   in `place_order`. A campaign discount reduces the payable total before VAT is
   extracted (same as coupons today). No VAT logic is added here.
6. **Codeless campaigns are publicly readable; coded campaigns are secret.** The
   public RLS policy requires `code IS NULL`, so advertised auto-apply promos are
   visible while promo codes are only ever validated through the RPC (never
   listed). Confirm this matches the intended "campaign vs. code" UX.
7. **Percentage vs. fixed caps.** `max_discount_amount` caps `percentage` and
   `fixed` discounts and both are additionally clamped to the subtotal;
   `free_delivery` is clamped only to the delivery fee. **Confirm** the cap should
   also apply to `fixed`.
8. **Branch scoping** uses `on delete cascade` (deleting a branch removes its
   scoped campaigns). **Confirm** that is the desired lifecycle vs. `set null`
   (campaign becomes all-branches) or `restrict`.

## What a reviewer must check

- The RPC is the single server-authoritative validation point; no client path
  computes or sends a discount amount.
- RLS: confirm anon/customers cannot see inactive/future/coded campaigns or other
  users' redemptions, and cannot write either table (the SQL test asserts this,
  but it has not been executed against Production — the suite runs only in a
  local Postgres harness).
- No applied migration is ever edited. Any change to this schema is a **new**
  migration applied through the owner-approved `apply_migration` workflow in
  `docs/MIGRATIONS.md`.

---

# Part 2 — Comped customers (100% off, automatic)

Status: **APPLIED to Production on 2026-08-26** (live versions `20260826114717`,
`20260826115025`, `20260826115122` — ledger rows 65-67, `docs/MIGRATIONS.md`
§35). Every function body was verified byte-identical to the merged repository
file afterwards.

**Applied is not the same as in use.** `comp_members` is empty, so no customer
is comped and every order still prices exactly as it did before. The feature
becomes live for a given person the moment an administrator adds them in
**Finance → Comped Customers**. All 44 orders that existed at the time of the
application were verified unchanged.

Two owner actions remain before it is fully visible:

1. **the app build** — the checkout and receipt lines ship with it. The two new
   `orders` columns exist as of the application, so the build is safe to ship
   now;
2. **the `lazywait-sync` redeploy** — until it happens a comped ticket reaches
   the branch **unlabelled**, indistinguishable from a paid one.

## What the owner asked for

A named group — staff, family, investors — who order without paying. Confirmed
on 2026-08-26:

- **automatic on every order** (no code to type and none to leak);
- **everything goes to 0.00**, including the delivery fee;
- **no limit** — no per-order, daily or monthly cap.

Nothing in the project could express this before. `coupons` has no per-customer
targeting of any kind; `campaigns` (Part 1) has none either — `per_user_limit`
counts redemptions by *any* user and there is no eligibility column — and
`profiles` carries no group, segment or tier (`profiles.role` is staff-console
routing and is read by **zero** pricing code).

## The risk, stated plainly

**Uncapped automatic free ordering is the highest-abuse surface in the app.**
One wrongly-added member is unlimited free food, and nothing downstream stops
it. Everything below makes a comp **traceable** — a mandatory reason, a
permanent audit row, an AAL2-gated writer, `is_comped` stamped on every order —
but nothing makes it **bounded**. That is the owner's decision, recorded rather
than smoothed over.

A per-period cap would live on `comp_members` and needs no reshaping of any of
this to add later.

## What a comp does to a total

Applied identically in **both** pricing functions, because a rule applied to one
and not its twin is a bug:

1. the **coupon block is skipped** — otherwise a limited code's `usage_count` is
   burned on an order that was free anyway, and a mistyped code raises at a
   customer who owes nothing;
2. **loyalty redemption is skipped** — no burning points against free food.
   `loyalty_points_earned` needs no special case: `floor(0 × rate)` is 0;
3. the total is **zeroed before VAT is derived from it**, so VAT falls out at
   0.00 with no second rule to keep in step;
4. `orders.is_comped` and `orders.comp_discount_amount` are stamped, and
   `payment_status` is written **`paid`** with `paid_at` set.

**What does NOT change:** the branch delivery minimum still applies (it protects
the kitchen from an uneconomic run and is judged on `subtotal`, which a comp
does not touch); `subtotal` still records the real value of the goods; and
`discount_amount` still means *coupon*, so the admin coupon-usage report is not
silently corrupted.

## Why `payment_status = 'paid'` is load-bearing, not tidiness

This is the part that decides whether the food gets cooked.

`set_lazywait_initial_sync` parks a **non-paid ONLINE** order at
`lazywait_sync_state = 'awaiting_payment'`, and `begin_payment_attempt` refuses
a total of 0 with *"Order total must be greater than zero"*. `place_order`
resolves the payment method **before** the total exists, so a comped order is
still assigned `'online'` whenever that is the configured default. Left
`'pending'`, such an order would therefore **never reach the kitchen and could
never be paid** — stranded permanently.

Writing `'paid'` sends it down the trigger's `else` branch and straight to the
POS queue. The precedent is already in the repository: `begin_checkout_session`
has always written `'paid'` for a zero total.

`paid_at` is stamped for the same reason it matters elsewhere: watchdog rule
**R1 `PAID_ORDER_NOT_SYNCED`** requires `paid_at is not null`, so a comped
pickup order left with a null timestamp would be invisible to the alert that
exists to catch a paid order the kitchen never received.

## A pre-existing defect this work also fixes

`begin_checkout_session` settles a zero-total cart inside a **single** call: it
inserts the session, creates the order and flips the session to `'consumed'`.
Its retry-safety lookup required `status = 'pending_payment'`, and it passed
`p_idempotency_key = null` to `insert_order_from_snapshot` — so a retried call
with the same cart key matched nothing at either level and produced **a second
session and a second free order**.

It has not bitten because online payment is disabled and the availability check
sits above the snapshot, so every call raises before reaching that branch. A
zero total is also currently only reachable by fully covering a cart with
loyalty points and a coupon. Comped customers make that branch ordinary rather
than exotic, so it is closed here, before it is stood on.

The fix has two independent layers: the reuse lookup now also matches a session
that already produced an order (the sequential retry), and the idempotency key
is carried onto the order so `orders_idempotency_idx` refuses a duplicate (the
concurrent retry). On that second path the loser also hands back the *winner's*
session and drops the one it just inserted — the session-level index is partial
on `status = 'pending_payment'`, so it stops guarding the moment the winner
consumes itself, and without the delete one key would end up with two settled
sessions.

**Two residual limits, stated rather than hidden.** A client that sends no
idempotency key at all still has no protection; the mobile cart always sends one
(`CartProvider` generates a uuid per cart), so this is a contract note rather
than a live gap. And the concurrent branch is **not covered by the SQL suite**:
reaching it needs the loser's first lookup to run before the winner commits and
its recovery lookup after, an ordering a single psql connection cannot produce —
any state that hides the winner from one lookup hides it from the other. The
suite covers the sequential retry and stops there rather than pretending.

## What the branch sees

`buildCreateOrderPayload` sends **no order-level money at all** (see Q9 in
`docs/integrations/Lazywait_API_Reference.md`) and each line carries its
undiscounted menu price. A comped ticket would therefore be
**indistinguishable** from a full-price one — the cashier would have no way to
know why nobody is paying.

So the order-level free-text note carries a label:

```
*** COMPLIMENTARY / ضيافة *** — <the customer's own kitchen note>
```

It is prefixed, so it survives a POS display that truncates a long note.

It is deliberately **not** the contract's `is_paid` flag. That distinction is
the point: `is_paid` changes the POS's own payment state, which is the financial
signal CLAUDE.md §6 reserves for a separate owner decision; the label only
annotates the field that already carries the customer's instructions. For the
same reason the text states what the order **is** rather than instructing the
cashier what to collect.

**The label only reaches the branch after `lazywait-sync` is redeployed**, which
is its own §5 action. Until then a comped order syncs correctly but arrives
unlabelled.

## Administration

**Finance → Comped Customers** in the console (`CompMembersPanel`).

- Search any customer by name, email or phone (reuses
  `admin_search_role_candidates`, already admin-gated).
- Adding or removing requires a **reason of 3–500 characters**. It is enforced
  in the RPC, not only in the form.
- The confirmation names the person and spells out the consequence — *"Every
  order they place will be free in full — delivery fee included — with no cap"*
  — rather than asking "Are you sure?".
- Membership is **deactivated, never deleted**, so an order stamped `is_comped`
  months ago stays explicable.
- `comp_member_audit` is permanent. It deliberately does **not** use
  `ops_change_events`, which self-prunes after one day: fine for operational
  noise, useless as a money trail.

Every write goes through `admin_set_comp_member`, which is SECURITY DEFINER and
gated on `public.is_admin()` — role **and** AAL2. There is **no client write
grant** on either table, so the console cannot bypass that path even by
accident.

## What the customer sees

The checkout screen reads its own `comp_members` row (RLS permits exactly one
row: your own) and shows a **Complimentary** line plus *"This order is on us —
nothing to pay."* Without it the customer would see full price and then be
charged nothing, which is a confusing way to give someone a gift.

This is display only. `computePreviewTotals` is a preview; the server reads the
table itself and never trusts a client flag, so a forged one changes nothing
about what is charged. The preview **skips the coupon and loyalty rows entirely
for a comped customer**, because the server skips both — showing them would
display two reductions that never happen and report a comp smaller than the
`comp_discount_amount` the order actually records.

**The membership is re-read immediately before the order is submitted.** An
administrator can revoke a comp while checkout sits open; the mount-time read
never re-runs, so the screen would keep showing 0.00 while `place_order`
re-reads the now-inactive membership and charges in full — the customer charged
**more** than they were shown. `decideCompChange` (`checkoutGuards.ts`) makes
that decision, and it is deliberately asymmetric: losing the comp corrects the
screen and refuses the submission; gaining one only corrects the screen, since
charging less than displayed breaks nothing; and an answer that could not be
read blocks nothing at all, because a flaky network must not refuse a valid
order and the server remains the authority.

**A customer can read only two columns of their own row** — `profile_id` and
`is_active` — through a column-level grant. RLS filters rows, not columns, so
the own-row policy alone would have handed over `note`, which holds the
*administrator's* private reason, written about the customer rather than for
them, and `added_by`, which is an admin's user id.

The receipt carries the same line — without it a comped receipt reads
*"Subtotal 64.00, Delivery 15.00, Total 0.00"* and does not add up on the page.

## Files

| File | What it does |
| --- | --- |
| `supabase/migrations/20260826090000_comp_members.sql` | `comp_members`, `comp_member_audit`, three admin RPCs, `orders.is_comped` / `orders.comp_discount_amount` |
| `supabase/migrations/20260826100000_comp_order_totals.sql` | `place_order`, `compute_order_snapshot`, `insert_order_from_snapshot` |
| `supabase/migrations/20260826110000_checkout_zero_total_idempotency.sql` | `begin_checkout_session` retry fix |
| `supabase/tests/comp_members_test.sql` | 17 cases — the first suite anywhere that places a zero-total order |
| `src/lib/compMembersApi.ts`, `src/components/admin/CompMembersPanel.tsx` | the console panel |
| `apps/mobile/src/features/checkout/previewTotals.ts` | the preview line |
| `supabase/functions/_shared/lazywait.ts` | the POS label |

## Deploy order — this one matters

1. ~~**Apply the three migrations, in filename order.**~~ **DONE 2026-08-26.**
   Nothing existing was touched: `comp_members` started empty and all 44 live
   orders were verified unchanged. Each target was named explicitly, one call
   per file — the frozen Moyasar migration sorts ahead of all three and a bulk
   apply would have swept it in.
2. **Then** ship the app build. `CUSTOMER_ORDER_SELECT` now names `is_comped`
   and `comp_discount_amount`, and PostgREST rejects the **whole** select when
   one column is missing — so a build that reaches customers first would make
   order history fail to load entirely rather than degrade. Same trap as
   `ORDER_ITEM_SELECT` and `lazywait-sync` (CLAUDE.md §8).
3. **Then, separately,** redeploy `lazywait-sync` for the POS label. This one is
   order-independent: the worker reads orders through
   `claim_lazywait_sync_batch`, which returns `setof public.orders`, so a
   missing column yields `undefined` rather than a failed select.

Each of the three is its own owner action under CLAUDE.md §5.

## Known follow-up, not fixed here

`customer_order_state` reports `'final_failure_refund_pending'` for a paid order
whose POS sends exhaust the retry budget. For a comped order that is refund
language for money nobody paid, and `order_refund_due` (which requires
`total > 0`) will never enrol it. The defect pre-dates this work; comped orders
make it reachable. Flagged rather than fixed, because changing refund language
is payment-adjacent and §6 is active.
