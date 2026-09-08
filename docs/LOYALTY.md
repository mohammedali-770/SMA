# Loyalty programme

**Status: LIVE.** Points are being earned and spent by real customers today.
This is not a dormant feature waiting to be switched on, and a change here
changes what somebody is charged.

**Owning document.** `docs/ownership.json` routes changes to loyalty earning,
redemption and configuration to this file, so behaviour and prose move together
(CLAUDE.md §14).

---

## 1. How it works today

| Setting (`app_settings`) | Live value | Meaning |
| --- | --- | --- |
| `loyalty_enabled` | `true` | The programme is on |
| `points_per_riyal` | `1.00` | 1 point per riyal payable |
| `discount_per_point` | `0.10` | Each point is worth 0.10 SAR at redemption |
| `min_points_to_redeem` | `100` | Nothing below 100 points can be spent |
| `loyalty_pickup_only` | `true` (default) | **Pickup only** — see §2 |

Earning and redemption both live in **two** SQL functions that must agree line
for line:

- **`place_order`** — authoritative. What actually happens.
- **`compute_order_snapshot`** — the preview. What the checkout screen shows
  before the customer commits.

If a rule lands in only one of them, the app shows a price it does not charge.
That is the single most important hazard in this area, and every migration here
carries a test for it.

**Where the balance lives.** `profiles.loyalty_points` is the balance;
`loyalty_transactions` is the append-only ledger behind it (`earn`, `redeem`,
`adjustment`), each row carrying `balance_after`. The order keeps its own record
in `orders.loyalty_points_earned` / `_redeemed` / `loyalty_discount_amount` /
`loyalty_awarded_at`.

**Effective rate.** Earning 1 point per riyal and redeeming each at 0.10 SAR is a
**10% rebate**. The QSR norm is 1–5%. That is a pricing decision, not an
engineering one, and it is one settings change whenever the owner wants it.

**Points are earned on an ELIGIBLE BASE, not on the payable total** — changed by
`20260908120000`, see §3. The base is the sum of order lines whose product still
earns, reduced by the pro-rata share of any coupon and redemption, clamped to
what is payable. It is VAT-inclusive, because prices here are; it excludes the
**delivery fee**, which is not merchandise.

---

## 2. Pickup only (`loyalty_pickup_only`, default TRUE)

**The rule.** While this setting is on, a **delivery** order neither earns points
nor may redeem them. A **pickup** order does both, exactly as before.

The order still succeeds. The rule withholds points; it does not refuse the
customer's dinner.

**Why.** Loyalty is being used as a pickup incentive — pickup costs the business
nothing to fulfil, and it is the channel the owner wants to grow. The closest
Saudi analogue, KUDU, runs the softer version of the same idea (double points on
pickup and dine-in rather than none on delivery); the owner chose the stricter
form deliberately.

**What it costs, measured rather than guessed.** At the time the rule was
written, delivery accounted for **1,364 of 8,654 points ever earned (16%)** and
had been redeemed against **zero times**. The change removes a sixth of earning
and none of the observed redemption behaviour.

**Where it is enforced.**

| Layer | File | What it does |
| --- | --- | --- |
| Database (authoritative) | `supabase/migrations/20260907120000_loyalty_pickup_only.sql` | Derives `v_loyalty_channel_ok` once per call in **both** functions, and gates the redeem branch and the earn branch on it |
| Checkout preview | `apps/mobile/src/features/checkout/previewTotals.ts` | Mirrors the rule so the screen cannot show a discount the server will refuse |
| Checkout screen | `CheckoutScreen.tsx` · `view/LoyaltyChannelNote.tsx` | Replaces the redeem toggle with an explanation on a delivery order |
| Admin | `src/components/admin/SettingsPanel.tsx` → Settings → Loyalty Program | Turns the rule off and on |

**Failing closed is deliberate.** Every reader defaults the setting to `true`
when it is absent — the column default, `mapLoyaltySettings` in both apps, and
`computePreviewTotals`. A project that has not run the migration, or a settings
row that failed to load, therefore **under-promises**: it withholds an offer
rather than making one the server will not honour.

**The customer is told, not shown a silent zero.** A delivery customer holding a
redeemable balance sees *"Points are earned and redeemed on pickup orders only"*
together with their balance and *"Your points are safe — switch to pickup to
spend them."* Hiding the row was the alternative, and a customer who sees nothing
where their points used to be reads it as the app having lost them.

> **The Arabic copy is engineering-drafted and has not had a native read.** Same
> caveat as the delivery `ready` push copy (`docs/OWNER_ACTIONS.md` §26).

**Turning it off.** Admin console → Settings → Loyalty Program → *Restrict Points
to Pickup Orders* → **No**. It takes effect on the next order; both functions
read the setting per call, which the SQL suite pins by flipping it mid-test.

**Changing it while a customer is mid-checkout is safe, and that took a fix.**
`CatalogProvider` maps the settings row once, at launch; its foreground refresh
reloads availability, modifier availability and branches, and **not** settings.
So a customer whose app loaded while the rule was OFF would keep seeing a
delivery redemption after it was turned ON, submit the points, and be charged
more than the screen showed — the one direction this codebase treats as never
acceptable (see the comp equivalent in
[`DISCOUNTS_CAMPAIGNS.md`](DISCOUNTS_CAMPAIGNS.md)).

Checkout therefore re-reads the single column immediately before submitting
(`catalog.readLoyaltyPickupOnly`) and hands the answer to
`decideLoyaltyChannelChange` (`checkoutGuards.ts`), which mirrors
`decideCompChange`'s asymmetry:

| Situation | Outcome |
| --- | --- |
| The rule closed **and** points were being spent | Correct the screen and **refuse this submission** — the customer sees the real total before committing |
| The rule closed while nothing was being spent | Correct the screen only; nothing was promised |
| The rule **opened** | Correct the screen only; charging less than displayed breaks nothing |
| Unchanged, or the read failed (`null`) | Do nothing — the server is the authority, and a flaky network must not refuse a valid order |

The last row is the weaker side of the trade: a stale `true` that could not be
re-read is the overcharge case. It is accepted for the same reason
`decideCompChange` accepts it — the window is an administrator toggling a setting
mid-checkout, and refusing orders on every failed read costs more than it saves.
Found in review on PR #334.

**What it does NOT change.** Comped customers still earn and redeem nothing on
either channel (the comp branch already refused both). Coupons are untouched —
the rule is about points, not about discounts. The redemption floor
(`min_points_to_redeem`) still applies on pickup.

---

## 3. Per-item exclusion (`products.earns_loyalty_points`, default TRUE)

**The rule.** With the flag off, **ordering that item earns nothing**. Points may
still be **spent** on an order containing it — the owner's wording, and what
makes this earn-side only.

**Where an administrator sets it.** Admin console → Menu → the star control on
each product row. It writes **one column** through `setProductEarnsPoints` and is
deliberately **not** part of the product edit modal: `productToDbUpdate` omits the
flag, exactly as it omits `is_active`, so that correcting a price cannot silently
restore earning on an item somebody zeroed. `productEditMapper.test.ts` pins the
omission with a fixture that carries `earnsLoyaltyPoints: false`.

**A Lazywait re-import cannot undo it.** `import_lazywait_catalog` updates and
inserts products with explicit column lists that do not name this column. That is
true by construction rather than by intent, so
`loyalty_item_exclusion_test.sql` §8 asserts it.

### The formula, because a future reader will get it wrong

```
eligible   = Σ line_total  where products.earns_loyalty_points
earn_base  = eligible − round((coupon + loyalty_discount) × eligible / subtotal, 2)
earn_base  = greatest(0, least(earn_base, total))
points     = floor(earn_base × points_per_riyal)
```

The **pro-rata** term is the part worth understanding: coupons and redemptions
are order-level, so the eligible lines carry their share. Without it, an excluded
item would absorb the whole discount and shield the eligible ones.

### Two consequences, stated rather than discovered later

**The comp no longer protects itself.** A comped order used to earn nothing *for
free*: points were `floor(v_total × rate)` and `v_total` is zeroed for a comp. An
eligible base is built from line prices, which a comp does not touch — so without
a guard a free order would start earning. Both a `not v_is_comp` condition **and**
the `least(…, v_total)` clamp are present, and the suite pins each separately.

**The delivery fee stops earning**, accepted by the owner on 2026-09-07. The fee
is not a line, so it is never in `eligible`; it stays in `total` and can only
lower the clamp. While §2's pickup-only rule is on this is a **no-op** — an
earning order is a pickup order, whose fee is 0 — so it is observable only if
that setting is turned off.

## 3a. Telling the customer what they will earn

Checkout shows one line, **"You'll earn N points with this order"**, below the
total. No per-item breakdown, per the owner's instruction.

**The figure is fetched, not computed.** `preview_loyalty_points` is a narrow
`SECURITY DEFINER` RPC that takes the customer from `auth.uid()` — never a
caller-supplied id — and returns only `loyalty_points_earned`,
`loyalty_points_redeemed`, `loyalty_discount_amount` and `total`.

Why an RPC rather than client arithmetic: the earning rule already lives in two
SQL functions that must agree, and a third copy in the client would be a number
that drifts from the points actually granted — while also having to absorb §4's
expiry and §5's multipliers. And why a wrapper rather than exposing the snapshot:
`compute_order_snapshot` is `service_role`-only because it trusts a
caller-supplied `p_customer` with no check, so opening it would let anyone read
another customer's name, phone and address snapshot. That boundary is asserted by
both the migration and the suite.

It **never blocks an order**: any failure renders nothing, the same rule
`refreshAvailability` follows. The line is hidden at 0 points, because an item may
legitimately earn nothing.

## 4. Expiry — a fixed calendar reset (`loyalty_expiry_enabled`, default OFF)

**The rule.** Everybody's points expire together, on a date the administrator
sets, rather than each batch ageing out on its own anniversary. That is the
owner's choice: *"let me decide the validity period from portal, but fixed
calendar reset"*.

**This is the only part of the loyalty system that destroys customer value**, so
read the guarantees before changing anything in
`20260909120000_loyalty_expiry.sql`.

| Guarantee | How it is enforced |
| --- | --- |
| **Off by default** | `loyalty_expiry_enabled` is FALSE, and the driver returns before reading a single profile row |
| **Never retroactive** | The driver acts only on `loyalty_expiry_next_run_on`, which is always computed **strictly in the future**. The column is **system-owned**: a trigger recomputes it whenever expiry is enabled, the schedule changes, or a caller supplies a value of its own — see below |
| **Idempotent** | The settings singleton is locked `FOR UPDATE` and the date advances in the same transaction, so a second tick sees nothing due |
| **Auditable** | One ledger row per customer — type `expire`, negative `points`, `balance_after` 0 — readable by that customer under the existing RLS policy |
| **Survives a missed day** | The test is `current_date >= next_run_on`, so a job that fails on the day catches up the next day instead of skipping a cycle |

### Settings

| Column | Meaning |
| --- | --- |
| `loyalty_expiry_enabled` | Off by default |
| `loyalty_expiry_anchor_month` / `_day` | The reset date. Day is capped at **28** — there is no 31st of February, and a reset that slides or throws once a year is worse than a range that cannot express the problem |
| `loyalty_expiry_period_months` | **1, 2, 3, 4, 6 or 12 only.** Anything else makes the reset depend on an arbitrary epoch year: "every 24 months from 1 January" is a fixed date in *alternating* years, and which years depends on when somebody first enabled it. A divisor of 12 repeats identically every year |
| `loyalty_expiry_next_run_on` | **System-owned, read-only to the admin form.** `loyaltyPatchToDb` deliberately omits it, so a stale form value cannot schedule a wipe |

Set from **Admin → Settings → Loyalty Program → Points Expiry**.

### The customer is told before it happens

The Profile screen shows *"Your points expire on 1 January 2027"* — but only when
expiry is on, a reset is scheduled, **and** the customer has points to lose.
`loyaltyExpiry.ts` holds that decision as a pure function with its own tests,
because each of the three silences exists for a different reason and "0 points
expire on…" would make the warning worthless for the customers it is for.

### What this step deliberately does NOT do

- **No push reminder.** An "expiring soon" notification is a change to live
  customer messaging and is its own owner approval (CLAUDE.md §7 and §5). The
  Profile date is the notice this step ships.
- **No expiry of the existing balances.** The current points ride to the first
  configured reset. Dropping them would be a live data write needing approval and
  buys nothing.
- **It does not make expiry lawful to enable.** See §7 — expiry needs updated
  T&Cs and an acceptance moment first. The mechanism existing is not permission
  to switch it on.


### The reset date is system-owned, and that took two goes to get right

`loyalty_expiry_next_run_on` is the date the nightly job acts on. It is an
ordinary column on a table administrators may update, so **nothing at the grant
level stops one writing to it** — by hand, by SQL, or by a request that names
the column. If a past date can be stored, the next tick zeroes every balance in
the system.

The first version guarded the obvious path: the trigger recomputed on the
`false -> true` enable transition and whenever an anchor field changed. That was
found by mutation testing, and case 3c pins it.

**Review found the steady state still open.** With expiry *already* enabled,
`update app_settings set loyalty_expiry_next_run_on = <a past date>` made every
one of those conditions false — no transition, no anchor change, and the value
supplied was not null — so it simply stuck. It was reproduced against a chain
database before being fixed, not argued about.

The rule now is that the trigger recomputes whenever the caller's value differs
from the stored one: whatever was supplied is discarded and the date is
re-derived from the anchor settings, which are the administrator's actual knobs.
Case 3d pins it, and removing the guard kills that case and no other.

Two details worth keeping:

- **The recompute is conditional on the value having changed, not
  unconditional.** `loyalty_next_expiry_on` always returns a date strictly after
  the one it is given, so recomputing on every update would push the reset a
  whole cycle into the future if an administrator happened to save an unrelated
  setting on the due date itself — silently skipping a reset rather than running
  it.
- **The trigger does not fight the driver.** `run_loyalty_expiry()` advances the
  same column, using the identical `loyalty_next_expiry_on(current_date, ...)`
  expression the trigger recomputes with, so the two land on the same value.
  Case 3e asserts that rather than assuming it.

The generalisable lesson, which is the same one case 3c taught one level down:
**fixing the transition path does not protect the steady state.** A column the
system owns has to be owned on every write, not on the interesting ones.

### Two staleness bugs in the same review, both about a date nobody re-read

Both were the same shape — a value generated by the server, displayed from a
snapshot taken before it existed.

- **The customer's warning.** `CatalogProvider` loads settings once at mount and
  its foreground refresh covers availability and branches only, so a session
  left open across an administrator enabling expiry would keep reporting
  `expiryEnabled: false` forever — and the customer would lose points having
  been shown no notice, which is the one thing this screen exists to prevent.
  Profile now re-reads the two expiry columns on focus (`readLoyaltyExpiry`),
  the same narrow shape as the pickup-only re-read checkout uses. A failed read
  keeps whatever is on screen: never invent a date, never erase one because the
  network blinked.
- **The administrator's confirmation.** `loyaltyPatchToDb` deliberately omits
  the reset date, so the local copy is wrong the moment the schedule changes —
  after a first enable the panel showed `—`, and after a period change it showed
  the previous date. `flushSettings` now re-reads the row when a patch touched
  any of the four schedule keys, so the date shown is the one the server
  computed. That date is when every balance goes to zero; showing a stale one is
  worse than showing none.

## 5. Campaign multipliers (`loyalty_multipliers`)

**The rule.** A campaign multiplies what an order **earns**. It never changes
what an order **costs**, and it can never reduce earning — the CHECK is
`between 1 and 10`.

Set from **Admin → Settings → Loyalty Program → Points Campaigns**.

### Why a separate table from `campaigns`

`campaigns` is discount-shaped: its `type` CHECK admits only
`percentage`/`fixed`/`free_delivery`, `campaigns_percentage_range` caps a value
at 100, and `max_discount_amount` describes money off. A points multiplier is
none of those — and that feature is blocked on eight unanswered business
questions with no UI at all. Borrowing its *shape* is free; inheriting its
blockage would have meant this step could not ship either.

### The bounds are the safety feature

- **Below 1 is refused.** It would be a second, silent way to reduce earning, and
  §3 already owns that question. Two mechanisms for one outcome is how an item
  ends up mysteriously earning nothing.
- **Above 10 is refused.** 2 and 1.5 are the real cases. The ceiling turns a
  slipped decimal point into a rejected insert rather than a very expensive
  weekend.

### How it composes — the ordering is the whole risk

Earning already survived three rules: the channel gate, the per-item exclusion,
and the clamp to the payable total. **A 2x campaign legitimately exceeds the
order total**, so multiplying *before* `least(v_earn_base, v_total)` would let
the clamp silently cancel the campaign. The multiplier is therefore applied
**after** the clamp, as a ratio:

```
eligible  = Σ line_total                       over earning lines
weighted  = Σ line_total × multiplier_for_line over the same lines
earn_base = clamp(0, min(eligible − pro-rata discounts, total))     [§3]
points    = floor(earn_base × (weighted / eligible) × points_per_riyal)
```

Every §3 guarantee survives: a comped order still has `earn_base` 0 and earns 0
whatever is live; the delivery fee is still absent from `eligible`; and **a cart
with no campaign has `weighted = eligible`, a ratio of exactly 1, and therefore
points arithmetically identical to §3.** That last property is the most important
thing in the feature and the suite asserts it against §3's own figures.

### Which campaign wins

Overlap is **allowed** — a house-wide 1.5x plus a 2x on one product is a
reasonable thing to run — so instead of forbidding it, resolution is
deterministic: most specific scope first (product → category → branch →
house-wide), then the larger multiplier, then the older row. Exactly one applies
to any line.

### Checkout needed no change, and that is §3a paying off

The "You'll earn N points" line comes from `preview_loyalty_points`, which calls
`compute_order_snapshot` — so it shows the campaign figure automatically. Had the
client been given its own copy of the earning rule, this step would have needed a
fourth mirror of it.

Customers never read `loyalty_multipliers`: the select policy requires
`is_staff()`. They see the result, not the campaign list.

**And they cannot reach the same information through the resolver either**,
which is where the first version leaked it. `loyalty_multiplier_for` was granted
to `authenticated`, and it takes `p_at` — so a customer could ask what the
multiplier on a given product will be *next month* and enumerate targeted,
not-yet-started campaigns a probe at a time, recovering exactly what the select
policy withholds. It is now granted to `service_role` only. Nothing legitimate
lost access: `place_order`, `compute_order_snapshot` and `preview_loyalty_points`
are all `security definer` owned by the same role that owns the resolver, so
they call it as the owner rather than through the caller's grants. Case 11b
asserts a customer session is refused. Review caught it on #338, and the
generalisable form is worth keeping: **a protection one object provides and a
helper undoes is not a protection** — check the grants on every function that
reads a policy-protected table, not just the table.

### Scope is set from the panel, not only from the resolver

The resolver has always supported branch, category and product narrowing, and
the headline use case for this feature — *"double points on burgers this week"*
— depends on it. The first version of the admin form omitted the controls, so
every campaign it could create was house-wide and the per-line behaviour was
unreachable without direct database calls. The form now carries three optional
selects, and the list carries a **Scope** column: a table showing two rows both
called "Double points" with no way to tell which is the burgers-only one is
worse than no table. `scopeLabel` renders names rather than ids, and a narrowing
whose target has been deleted shows `(deleted)` rather than an empty cell —
because an empty cell reads as *everything*, which is the opposite of what a
narrowed campaign does.

## 6. Testing

| Suite | Covers |
| --- | --- |
| `supabase/tests/loyalty_pickup_only_test.sql` | The channel rule end to end: earn, redeem, the balance never moving on delivery, **preview vs actual on both channels**, the setting being live in both directions, and composition with the comp rule |
| `apps/mobile/src/features/checkout/previewTotals.test.ts` | The client mirror, including the fail-closed default |
| `apps/mobile/src/features/checkout/checkoutGuards.test.ts` | `decideLoyaltyChannelChange` — all four outcomes of the rule changing mid-checkout |
| `src/lib/loyaltyRulesSummary.test.ts` | The admin "rules in force" summary: silent when the programme is off, flags only the rules that REMOVE value, never prints a bare `null` |
| `supabase/tests/loyalty_multipliers_test.sql` · `loyaltyCampaignState.test.ts` | Campaigns: neutral when empty, **identical to §3 with none live**, clamp-safe (points may exceed the total), specificity, windows, branch scope, composition with the channel gate and the comp, preview parity, and the bounds |
| `supabase/tests/loyalty_expiry_test.sql` · `loyaltyExpiry.test.ts` | Expiry: off by default, never retroactive (a hand-written past due date on enable, **and** a direct write while already enabled), the trigger and driver converging on one date, once per reset, a missed day caught up, one auditable row each, and when the customer is told nothing |
| `supabase/tests/loyalty_item_exclusion_test.sql` | The eligible base end to end: mixed carts, earn-side-only redemption, pro-rata sharing, the comp trap, preview/actual parity, the PII boundary, the delivery fee, and the importer |
| `src/lib/mappers.test.ts` · `productEditMapper.test.ts` | The admin mappers read and default both columns, and the generic edit contract carries neither |
| `supabase/tests/loyalty_reason_history_safe_test.sql` · `loyalty_reason_no_order_number_test.sql` | Ledger-reason semantics (pre-existing) |

Two guards are worth knowing about because they caught real mistakes while this
was being written:

1. **The migration verifies itself.** Its closing `DO` block counts
   `v_loyalty_channel_ok` in each function's `prosrc` and **raises** unless both
   carry four references. A gate applied to one function refuses to apply at all.
2. **Section 4 of the SQL suite compares preview against actual** for the same
   cart on both channels. Deliberately mutating `compute_order_snapshot` to
   ignore the setting — while leaving the reference count at four, so guard 1
   still passes — fails there with *"delivery preview/order earned 69/0"*.

Run the whole chain locally before pushing:

```
PGHOST=/tmp PGPORT=55432 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres \
  bash .github/sql-ci/run.sh
```

---

## 7. The customer-facing terms — corrected 2026-09-08

The binding document is `public.legal_documents`, row `offers_loyalty_terms` —
now **version 2.1, effective 8 September 2026, active**. The engineering draft
that should eventually replace it wholesale, with the reasoning behind every
clause, is [`legal/OFFERS_LOYALTY_TERMS_DRAFT.md`](legal/OFFERS_LOYALTY_TERMS_DRAFT.md).

**Version 2.0 stated three things the system does not do**, all found by reading
the live text against the code rather than assuming it was fine. They were
corrected in place on the owner's approval — a live write, recorded here because
the previous version of this section told a reader they were still wrong:

1. **"Points are added when the order is completed."** They are added when the
   order is **placed** — `place_order` writes the ledger row in the same
   transaction as the order. The whole cancellation-reversal mechanism
   (`20260810100000`) exists *because* points are granted early; a reader of the
   old terms would not expect a reversal to be needed at all.
2. **"points … cancelled or refunded are reversed."** Approximately true for
   cancellation, **entirely false for refunds**. Cancellation reverses earning
   bounded by the balance that still exists — `least(greatest(v_balance, 0),
   v_earn_requested)` in `admin_set_order_status`, with the shortfall written
   into the ledger reason rather than the balance going negative — and restores
   redemption **in full**. All nine live `%refund%` functions were checked and
   **none touches loyalty**, so the clause promised behaviour that has never run.
3. **"You choose how many points to use on an order."** Found only while making
   the other two corrections, and live since 2.0. Redemption is all-or-nothing:
   `LoyaltyToggle` is a boolean, `CheckoutScreen` submits the entire available
   balance, and the server clamps it to the order value. There is no control for
   choosing an amount.

The third is the one worth remembering. It had been sitting in a customer-facing
document through every previous review of this feature, and it surfaced only
because the *whole* live text was finally read against the code — not because
anybody suspected it. The corrections were applied with SQL `replace()` on the
stored content so every untouched clause is byte-identical by construction, then
verified by predicate: each false string absent, each replacement present, the
other sections and the quoted figures intact, in both languages.

**The Arabic replacements are engineering-drafted and have not had a native
read.** They were published rather than held so that neither language was left
stating something false, but the wording is a follow-up
(`docs/OWNER_ACTIONS.md` shape: a native review of loyalty terms v2.1).

Correcting these needed no feature switch, and did not wait for one.

**The same treatment was then given to the other eight legal documents**, because
the third error above was found only by reading a whole document rather than the
passages this work had touched. That sweep corrected three more and confirmed
five were already accurate: [`LEGAL_DOCUMENTS_AUDIT.md`](LEGAL_DOCUMENTS_AUDIT.md).

### Before flipping each switch

Terms first, switch second. Publishing after the fact means a period where the
app does something the customer was never told.

| Switch | Terms work needed first |
| --- | --- |
| `loyalty_pickup_only` (defaults ON) | Publish the pickup-only lines — due when `20260907120000` is applied, since the rule is on by default |
| `products.earns_loyalty_points` → false | Publish the "some items earn no points" line before excluding the first item |
| A campaign multiplier | Publish the promotion line. Least urgent: multipliers only ever *increase* earning |
| `loyalty_expiry_enabled` | **Publish the expiry section AND resolve the acceptance question below.** Do not enable before both |

### The acceptance moment is not built

`legal_documents` already carries `version`, `effective_date` and a
`requires_acceptance` flag, so the *shape* exists — but **nothing records that a
given customer accepted a given version**, and nothing gates ordering on it.
Building that is a schema change plus a checkout-flow change, and it is
deliberately absent from the loyalty series, which added no such migration.

Practically: publishing updated terms is plausibly enough for the changes that
only *narrow* future earning. It is probably **not** enough for expiry, which
forfeits value a customer already holds. That is counsel's call, and it is why
expiry ships switched off.

### What the summary block does and does not claim

Three corrections came out of review on #339, and each is about the block being
read as authoritative:

- **It shows four decimals, not two.** `app_settings.discount_per_point` is
  `numeric(10,4)`, so rounding to two turned a saved 0.0051 into "0.01" — nearly
  double what a point is worth, printed under a heading stating the rule in
  force. Trailing zeros are still dropped, so an ordinary rate does not read as
  "0.1000".
- **It names live campaigns.** Without them the block was least accurate exactly
  when it mattered most: during a campaign, the rate line alone understates what
  a qualifying order earns. `undefined` and `[]` are deliberately different — an
  unloaded list stays silent rather than asserting "no campaigns are running",
  because the one thing an authoritative block must not do is claim an absence
  it has not checked.
- **It stops calling itself "in force" after a failed write.**
  `updateLoyaltySettings` sets local state immediately and `flushSettings` only
  raises `writeError` on failure — it does not revert or re-read — so the block
  could describe rules the server never saved. When a write has failed the
  heading reads *"UNSAVED DRAFT — the last save failed"* and says the list
  describes the screen rather than the server.

## 8. Regulatory shape (KSA)

Not legal advice; it is why the design looks the way it does.

- **Points are a discount mechanism, not stored value.** Non-transferable,
  non-refundable, no cash-out, redeemable only at Spicy Meal. If points read as
  having monetary value, the operator can fall into Electronic Money Institution
  licensing territory. Keep it that way.
- **Terms must be accepted, not merely published.** Earning, redemption, expiry,
  forfeiture and programme modification need to be clearly communicated and
  accepted through a click-wrap mechanism. **Expiry cannot ship without updated
  T&Cs and an acceptance moment** — the binding wording is counsel's
  (`docs/RELEASE_CHECKLIST.md`).
- **PDPL.** Loyalty is its own processing purpose and needs its own lawful basis
  in the privacy notice.

---

## 9. Planned, not built

Recorded here so nobody re-derives them. Each is a separate pull request with its
own migration and its own owner approval.

| | Change | Note |
| --- | --- | --- |
| ~~2~~ | ~~`products.earns_loyalty_points`~~ | **DONE — see §3.** Kept in this table so the sequence still reads in order |
| ~~3~~ | ~~Expiry~~ | **BUILT — see §4.** Still needs the T&C acceptance moment in §7 before it can be ENABLED, and the "expiring soon" push is a separate owner decision |
| ~~4~~ | ~~`loyalty_multipliers`~~ | **BUILT — see §5.** |
| ~~5~~ | ~~Copy, T&C mechanics, admin polish~~ | **DONE — see §7.** What remains is not engineering: counsel's wording, and the acceptance-moment decision |

Ideas raised and not adopted: tiers as *status* rather than currency, a welcome
bonus on a first pickup order, a birthday bonus, an "expiring soon" nudge, and a
per-order redemption cap.

---

## 10. Related

- [Discounts, campaigns and comped customers](DISCOUNTS_CAMPAIGNS.md) — the comp
  rule that composes with this one, and the blocked campaigns table
- [Order confirmation flow](ORDER_CONFIRMATION_FLOW.md) — where an order goes
  after it is placed
- [Migration workflow](MIGRATIONS.md) — how a migration in this area is applied
