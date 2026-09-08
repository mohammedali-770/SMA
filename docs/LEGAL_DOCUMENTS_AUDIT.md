# Legal documents — read against the code, 2026-09-08

All nine rows of `public.legal_documents` were read end to end and every
checkable claim traced to the code or to live settings. This file records what
was found, what was corrected, and — the part worth keeping — **what was
verified accurate**, so the next person does not have to redo the work to learn
that five of the nine were already right.

**Why the sweep happened at all.** Correcting three false statements in
`offers_loyalty_terms` (see [`LOYALTY.md`](LOYALTY.md) §7) turned up a third
error nobody had suspected, purely because the *whole* document was read rather
than the passages the loyalty work had touched. That generalised immediately:
the errors you find are bounded by the passages you actually check. So every
other document got the same treatment.

## Corrected, live, 2026-09-08 (all now version 2.1)

| Document | What it said | What is true |
| --- | --- | --- |
| `offers_loyalty_terms` | points added "when the order is completed"; "cancelled **or refunded** are reversed"; "you choose **how many** points to use" | added when the order is **placed**; cancellation only, clamped to the surviving balance; the toggle is **all-or-nothing**. Detail in [`LOYALTY.md`](LOYALTY.md) §7 |
| `privacy_policy` | sub-processor list omitted **Vercel** | `vercel.json` serves `/app` (the Expo customer web export) and `/legal`, so customer traffic is processed by Vercel. Now named |
| `delivery_pickup_policy` | "tells you when your order is **received**, being prepared, ready…" | the `received` push was **deliberately removed** from `order-intake` on 2026-08-27 — its copy claimed the kitchen had the order, untrue for delivery. The first message is now the POS outcome, so the text says "confirmed with the branch" |
| `allergen_food_notice` | "SPICE LEVEL … the level shown is a guide" | **there is no heat rating in either product model.** It caveated a UI element that does not exist; it now tells the customer to ask |

Applied with SQL `replace()` on the stored content rather than re-pasting, so
every untouched clause is byte-identical by construction. Each anchor was
confirmed present before the write and verified absent after it, with the
untouched sections asserted intact, in both languages.

## Found, and NOT fixed by wording — it needed code

`privacy_policy`, under HOW LONG WE KEEP IT: **"Verification codes: a short
period, then deleted."**

Nothing performed that. `otp_challenges` retained every row it had ever
written — the oldest in Production dated **10 July** — and the only thing that
deleted from it was `anonymize_account_data`, which runs on account deletion.
No scheduled job touched it. The retained columns are `phone_e164` and
`ip_hash`; the code itself is hashed, so this was never a credential exposure,
but it is a personal-data retention statement the system did not honour, in the
document describing the operator's PDPL obligations.

**The wording was left alone on purpose.** The policy states the correct
intention; the code was what disagreed with it. Rewording to match the behaviour
would have made the document honest by lowering the promise, which is the wrong
direction for a retention commitment.
`supabase/migrations/20260911120000_otp_retention_sweep.sql` is the fix.

**APPLIED 2026-09-08 12:31:16 UTC** (live version `20260908123116`, ledger row
81). The mechanism is installed and the schedule is live.

**The sentence is not true yet, and that distinction is the point.** Applying the
migration deleted nothing — it schedules the job — so the July rows are still
there, and the function has never actually executed. Installing a cron job is
not evidence that it runs; this repository has a worked example of exactly that
gap (`OWNER_ACTIONS.md` §28, where a dispatcher shipped with no caller). The
promise becomes true at the first tick, 00:40 UTC.

**This item therefore stays open until the first run is recorded**, per §30's own
completion criteria. Review caught it being closed early on #342 — the criteria
had been written two commits before and then not met, which is the same
declare-done-on-partial-evidence error this whole audit exists to correct.

Everything else in the set is accurate. **This is the one open item.**

A second, quieter gap in the same area: `otp_send_reservations` already deletes
rows older than two days inside `otp_reserve_send` — but only **for the phone
currently asking**, so a number that requested a code once and never came back
kept its row forever. The sweep applies the identical two-day rule to every
phone, which is why it cannot change the rate limiter's behaviour.

## Verified accurate — no change needed

Recorded because "we checked and it was fine" is worth as much as a finding.

- **`payment_policy`** — VAT 15% matches `app_settings.vat_percentage` (15.00);
  `online_payment_enabled` is false; the provider row is `tap`, disabled, and
  the document correctly says none has been selected.
- **`cancellation_refund_policy`** — cash-only wording matches the settings, and
  "ask us to cancel" is right for a reason worth stating: **there is no
  customer-callable cancel function at all.** `admin_set_order_status` is gated
  on `is_admin()`, and a search for `%cancel%` functions returns nothing a
  customer could reach. The refund section is honest about the freeze.
- **`account_data_deletion`** — every claim traced through
  `anonymize_account_data`: name, phone, notes and `address_snapshot` nulled on
  retained orders; addresses, push devices, checkout sessions, loyalty ledger
  and OTP challenges deleted. The points **balance** is not zeroed by that
  function and does not need to be — `profiles.id` references `auth.users(id)`
  **ON DELETE CASCADE**, so the row goes with the account.
- **`terms_conditions`** — WhatsApp OTP sign-in matches the enabled
  `meta_cloud` provider (the SMS provider is a disabled sandbox), VAT and
  cash-payment statements match settings, and every cross-referenced policy
  exists.
- **`contact_support`** — email and phone match `app_settings.support_email` /
  `support_phone` (`+966920031495`, printed as `9200 31495`), and all five
  referenced pages exist.

One thing aged **well**: the privacy policy's *"offers if you have turned
notifications on"* became **more** accurate when marketing moved to opt-out on
2026-08-20, because granting the OS permission now enables both channels. Under
the old opt-in model that sentence was wrong. It was not corrected then, and it
did not need to be — but nobody had checked either way.

## The Arabic

Every correction above was made in **both** languages. The Arabic is
engineering-drafted and has not had a native read, which matters more here than
for UI copy because these documents bind customers. It was published rather than
held so that no document was left with the English true and the Arabic false.
Tracked in [`OWNER_ACTIONS.md`](OWNER_ACTIONS.md).

## Method, for whoever repeats this

1. Read the **whole** document, not the sections the current change touches.
2. Trace every checkable claim to code or live settings, and write down which.
3. Where a document and the code disagree, ask which one is wrong before
   assuming it is the document. Once here it was the code.
4. Correct with `replace()` against stored content, never a re-paste.
5. Verify by predicate afterwards: old string absent, new string present,
   untouched sections intact — in every language.
