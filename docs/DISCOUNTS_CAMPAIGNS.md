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

### There is also no way to reach it from either app (recorded 2026-09-02)

The 2026-09-02 dead-code audit established a fact this document did not state:
**the campaigns feature has no user interface at all.**

- `src/lib/campaigns.ts` — 148 lines: `campaignsApi` (list/create/update/delete
  plus a `compute_campaign_discount` preview), `selectLiveCampaigns`,
  `formatCampaignSummary`. Its **only importer in the whole repository is its own
  test file.**
- There is **no Campaigns tab**. `ADMIN_NAV` has 13 entries and all 13 are routed;
  none of them is campaigns. The two `campaign` matches in `SettingsPanel.tsx` are
  the *loyalty* toggle ("Active Rewards Campaign"), a different feature.
- `grep -il campaign apps/mobile/src` returns **nothing** — the customer app has
  no campaign surface either, so no customer can enter a code.
- `campaign_redemptions` is therefore written **only by `discounts_campaigns_test.sql`**,
  which is why `global_limit` and `per_user_limit` are unenforced in practice.

**The module was deliberately kept rather than deleted.** It is finished,
server-authoritative work whose schema is already applied; deleting it would
discard a design that has to be rewritten the day the eight questions below get
answered, and would save nothing operationally, because the tables and the RPC
would still be live. What it needed was this paragraph, so nobody mistakes it for
a working feature and nobody deletes it as rot.

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

**Verified end to end on 2026-08-27.** One member was added and two real pickup
orders were placed on that account: `SM-2026-000055` (subtotal 15.00) and
`SM-2026-000056` (subtotal 9.00). Both came out `total` 0.00, `vat_amount` 0.00,
`is_comped` true, `comp_discount_amount` equal to the real goods value,
`payment_status` `paid` with `paid_at` set, and `lazywait_sync_state` `synced`
rather than `awaiting_payment` — the landmine-1 regression, confirmed fixed in
Production. The loyalty balance did not move and no coupon was consumed. The
test membership was deactivated afterwards.

**Extended 2026-08-27 — membership is now keyed on a PHONE NUMBER too, and it
is APPLIED.** `20260827090000_admin_search_phone_normalization`,
`20260827100000_comp_members_by_phone` and `20260827110000_comp_erasure` are
live (versions `20260827063613` / `063746` / `064044`; history 112 → 115). See
*Comping a number before they sign up*, below. The money path is **unchanged**
by all three, verified by hashing `place_order` and `compute_order_snapshot`
identically before and after the apply.

**One owner action remains** before it is fully visible: **the app build**. The
checkout and receipt lines ship with it, and the two new `orders` columns exist
as of the application, so it is safe to ship now.

The `lazywait-sync` redeploy is **done** — v5, 2026-08-26 12:46 UTC — so a
comped ticket already reaches the branch labelled.

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

**The label is LIVE.** `lazywait-sync` was redeployed to **v5** on 2026-08-26 at
12:46 UTC on explicit owner approval, with `verify_jwt` unchanged at `false`.
All five bundle files were read back and hashed byte-identical to the merged
repository, an unsigned POST returned `401 unauthorized` proving the module
boots and its gate holds, and the cron ran the new version at 12:47:00 and
succeeded. Record: `docs/OWNER_ACTIONS.md` §20.

## Comping a number before they sign up

*Added 2026-08-27, on the owner's requirement: "when the number of someone in
comped customers enters the app, they should see the prices as 0."*

The original design keyed membership on `profile_id`, so a person had to already
have an account before they could be comped. That is backwards for how the
decision is made — the owner knows the **number** of the person they want to
host, usually before that person has opened the app. The panel proved it on its
first live use: a search for a number nobody had registered returned *"No
matching customers"*, correctly, and there was no way to say *comp them anyway,
from the moment they join*.

**How it works now.** `comp_members` carries `phone_e164` (canonical
`+9665XXXXXXXX`, enforced by check constraint) and `profile_id` became nullable.
A row with no `profile_id` is **pending**: comped, but nobody holds the number
yet. When Auth confirms that number — the OTP moment — the row binds itself to
the new account, and from then on it is an ordinary membership.

**The money path is untouched.** `place_order` and `compute_order_snapshot`
still resolve the comp exactly as they did on 2026-08-26:

```sql
select cm.is_active into v_is_comp
  from public.comp_members cm where cm.profile_id = v_customer;
```

That is the design, not an omission. Those functions were verified against two
live orders; re-deriving the comp from a phone number inside them would put a
proven path back under review to buy nothing, because a pending row has no
account and an account with no orders cannot be charged wrongly. All 18
pre-existing cases in `supabase/tests/comp_members_test.sql` pass unchanged,
which is the evidence.

**Why the OTP moment, and not `profiles.phone_number` generally.** Comping by
phone is only safe if the phone cannot be self-asserted. Verified against live
Production before the design was fixed: `authenticated` holds column `UPDATE` on
`profiles` for `email` and `full_name` **only**. `phone_number` is written
solely by SECURITY DEFINER functions fed from a proven number. A customer cannot
type a comped number into their profile and eat free.

**There are THREE paths that prove phone ownership, not two** — raised in review
on PR #272 and fixed there:

| Path | Fires | Claims |
| --- | --- | --- |
| `handle_new_user()` | signup, when the phone arrives already confirmed | yes |
| `handle_auth_user_phone_confirmed()` | `auth.users.phone_confirmed_at` transitions | yes |
| `mark_phone_verified()` | `whatsapp-verify-otp`, which never touches Supabase Auth | yes |

The third one is the one that is easy to miss: `whatsapp-verify-otp` verifies
the code itself and records the result by writing `profiles` only, so
`on_auth_user_phone_confirmed` never fires. Without a claim there, a customer
who verified that way would sit unclaimed and be **charged in full forever**.
Claiming there is safe because ownership is already proven when it runs — the
function is EXECUTE-able by `service_role` alone, and its only caller checks the
requested number against `auth.users.phone` before consuming a matching OTP.

**An unconfirmed number binds nothing.** `auth.users.phone` is populated when an
OTP is *requested* and confirmed only when it is *answered*, so a row can hold an
unproven number. `admin_set_comp_member` therefore resolves an account only from
a **confirmed** Auth phone or a **verified** profile phone; anything else stays
pending and binds later, at the proven moment. Late, not wrong.

**A withdrawn invitation stays withdrawn.** Deactivating a pending number and
then having it sign up binds the row but leaves it inactive. The claim
deliberately does not filter on `is_active`, because a row that refused to bind
could be re-added as a fresh pending row and the deactivation would be quietly
undone.

**Deletion reaches it.** A pending row has no FK to cascade from, and
`comp_member_audit` deliberately outlives the account — so `target_phone` is the
one field that could re-identify a customer who asked to be forgotten.
`anonymize_account_data` now deletes the membership (claimed or pending) and
nulls the number out of the audit, keeping the row itself.

### The search bug that surfaced it

`profiles.phone_number` is stored raw from `auth.users.phone`, so live data held
**four `9665…` and one `+9665…`**. The admin search matched a raw substring, so:

| typed | matched |
| --- | --- |
| `+966555…` | 1 of 5 customers |
| `0555…` | 0 of 5 |
| `555…` | 5 of 5 |

A customer who existed and one who did not both rendered as *"No matching
customers"*, and the admin could not tell them apart.
`admin_search_role_candidates` now normalizes **both sides** through
`normalize_ksa_e164`: a complete number matches exactly, a partial matches
forgivingly. The same function backs the staff-role candidate picker, so that
trap is closed too.

## Administration

**Finance → Comped Customers** in the console (`CompMembersPanel`).

- **Comp a phone number directly**, in any format (`05…`, `+9665…`, `9665…`,
  `00966…`). If nobody holds it, the row shows **NOT SIGNED UP YET** and the
  save message says the comp goes live when they sign up — it is never reported
  as a live discount for a person who does not exist.
- Or search an existing customer by name, email or phone (reuses
  `admin_search_role_candidates`, already admin-gated). A fruitless search now
  points at the phone form rather than dead-ending.
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
| `supabase/migrations/20260827090000_admin_search_phone_normalization.sql` | applied 2026-08-27 — `admin_search_role_candidates` normalizes phone on both sides |
| `supabase/migrations/20260827100000_comp_members_by_phone.sql` | applied 2026-08-27 — `phone_e164`, the claim, three ownership hooks, four admin RPCs |
| `supabase/migrations/20260827110000_comp_erasure.sql` | applied 2026-08-27 — `anonymize_account_data` reaches the comp tables |
| `supabase/tests/comp_members_test.sql` | 27 cases — the first suite anywhere that places a zero-total order |
| `supabase/tests/admin_search_phone_normalization_test.sql` | 6 cases — every typed shape of a number finds its customer |
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
3. ~~**Then, separately,** redeploy `lazywait-sync` for the POS label.~~
   **DONE 2026-08-26 (v5).** It was order-independent: the worker reads orders
   through `claim_lazywait_sync_batch`, which returns `setof public.orders`, so
   a missing column would have yielded `undefined` rather than a failed select.

Each of the three is its own owner action under CLAUDE.md §5; two are done and
only the app build is outstanding.

## Known follow-up, not fixed here

`customer_order_state` reports `'final_failure_refund_pending'` for a paid order
whose POS sends exhaust the retry budget. For a comped order that is refund
language for money nobody paid, and `order_refund_due` (which requires
`total > 0`) will never enrol it. The defect pre-dates this work; comped orders
make it reachable. Flagged rather than fixed, because changing refund language
is payment-adjacent and §6 is active.
