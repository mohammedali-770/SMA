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

**Points are earned on the payable total**, which includes the delivery fee and
is VAT-inclusive. Earning on the merchandise subtotal alone is the more usual
design; it has been raised with the owner and is not implemented.

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

**What it does NOT change.** Comped customers still earn and redeem nothing on
either channel (the comp branch already refused both). Coupons are untouched —
the rule is about points, not about discounts. The redemption floor
(`min_points_to_redeem`) still applies on pickup.

---

## 3. Testing

| Suite | Covers |
| --- | --- |
| `supabase/tests/loyalty_pickup_only_test.sql` | The channel rule end to end: earn, redeem, the balance never moving on delivery, **preview vs actual on both channels**, the setting being live in both directions, and composition with the comp rule |
| `apps/mobile/src/features/checkout/previewTotals.test.ts` | The client mirror, including the fail-closed default |
| `src/lib/mappers.test.ts` | The admin mapper reads and defaults the column |
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

## 4. Regulatory shape (KSA)

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

## 5. Planned, not built

Recorded here so nobody re-derives them. Each is a separate pull request with its
own migration and its own owner approval.

| | Change | Note |
| --- | --- | --- |
| 2 | `products.earns_loyalty_points` — force an item to earn nothing | **Earn-exclusion only**: points may still be *spent* on such an item. Changes how the earning base is computed, from the payable total to an eligible base |
| 3 | Expiry — a fixed calendar reset, period set in the admin portal | Needs `loyalty_transactions_type_check` widened to admit `expire`, a `pg_cron` driver, a customer-facing expiry date, and the T&C acceptance moment in §4 |
| 4 | `loyalty_multipliers` — x2 points, or +x% for a period | Deliberately a **separate table** from `campaigns`, which is discount-shaped and blocked on eight open business questions (`docs/DISCOUNTS_CAMPAIGNS.md`) |
| 5 | Customer-facing copy, T&C mechanics, admin polish | |

Ideas raised and not adopted: tiers as *status* rather than currency, a welcome
bonus on a first pickup order, a birthday bonus, an "expiring soon" nudge, and a
per-order redemption cap.

---

## 6. Related

- [Discounts, campaigns and comped customers](DISCOUNTS_CAMPAIGNS.md) — the comp
  rule that composes with this one, and the blocked campaigns table
- [Order confirmation flow](ORDER_CONFIRMATION_FLOW.md) — where an order goes
  after it is placed
- [Migration workflow](MIGRATIONS.md) — how a migration in this area is applied
