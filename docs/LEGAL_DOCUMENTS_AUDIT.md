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

> **Read this file as dated, not current (2026-11-26).** Every verdict below is
> as of the date beside it, 2026-09-08 unless stated. Three of them have since
> been overtaken, and each is flagged where it stands: card payment is on, so
> the cash-only verdicts in "Verified accurate" no longer hold; points are
> recorded as pending and credited on delivery, so the "added when the order is
> placed" correction no longer holds; and the "unchanged at 2.1" claim below was
> already imprecise. The live text of every row is **not known from the
> repository** — the owner-side list is `OWNER_ACTIONS.md` §47.15 and gaps PG-08,
> PG-15 and PG-22 in `readiness/20261113-card-payments-gaps.md`.
>
> **Updated 2026-09-09 — `offers_loyalty_terms` is now version 2.2.** On
> 2026-09-09 the other eight rows were recorded as unchanged at 2.1 (a version
> label that was not re-checked per row: `OWNER_ACTIONS.md` reads live
> `terms_conditions` as v2.0, and `privacy_policy` has since moved to v2.2 and
> v2.3, see Method 6). v2.2 was not a further correction of a false
> statement: it brought the document level with four loyalty features that
> shipped on 2026-09-09, of which **pickup-only was live and had made the
> redemption clause misleading**. Detail, the wording decisions and the
> verification: [`LOYALTY.md`](LOYALTY.md) §7.
>
> **The method differed from the sweep below, on purpose.** The 2026-09-08
> corrections used SQL `replace()` on individual clauses, so untouched text was
> byte-identical by construction. v2.2 restructures the document — a new section,
> a reordered earning section — so `replace()` could not express it and the
> content was written wholesale. The equivalent guarantee was obtained a
> different way: the v2.1 text was captured locally and hashed against live
> first, giving a byte-exact revert; the new text was hashed before and after the
> write; and 21 predicates were then asserted against the live row.

## Corrected, live, 2026-09-08 (all now version 2.1)

*(Dated 2026-09-08; the loyalty row is superseded on one point, 2026-09-14, in
the note after this table. "All now version 2.1" describes these four rows on
that date; it is not a statement about the other documents.)*

| Document | What it said | What is true |
| --- | --- | --- |
| `offers_loyalty_terms` | points added "when the order is completed"; "cancelled **or refunded** are reversed"; "you choose **how many** points to use" | added when the order is **placed**; cancellation only, clamped to the surviving balance; the toggle is **all-or-nothing**. Detail in [`LOYALTY.md`](LOYALTY.md) §7 |
| `privacy_policy` | sub-processor list omitted **Vercel** | `vercel.json` serves `/app` (the Expo customer web export) and `/legal`, so customer traffic is processed by Vercel. Now named |
| `delivery_pickup_policy` | "tells you when your order is **received**, being prepared, ready…" | the `received` push was **deliberately removed** from `order-intake` on 2026-08-27 — its copy claimed the kitchen had the order, untrue for delivery. The first message is now the POS outcome, so the text says "confirmed with the branch" |
| `allergen_food_notice` | "SPICE LEVEL … the level shown is a guide" | **there is no heat rating in either product model.** It caveated a UI element that does not exist; it now tells the customer to ask |

**Superseded 2026-09-14 for the first row's "added when the order is placed".**
Since `20260918120000_loyalty_earn_on_settlement` (applied 2026-09-14) `place_order`
records an `earn_pending` ledger row and the balance moves only when an
administrator marks the order delivered, and, for an online order, only when it
is paid (`docs/LOYALTY.md` "Points are earned at DELIVERY, not at order
creation"). The repository's own draft of the published v2.2 text still says
points are added when the order is placed and the balance updates immediately
(`docs/legal/OFFERS_LOYALTY_TERMS_DRAFT.md`), so the sentence this table calls
the truth is no longer the behaviour. Whether the live row has been changed is
not known from the repository; the gap is tracked as PG-22, and rewriting a live
row is an owner decision and a §5 write.

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

**The sentence is now true, and it was made true by running the sweep rather
than by asserting the schedule.** Applying the migration deleted nothing — it
schedules the job — so on the owner's approval `purge_expired_otp_records()` was
executed once, immediately:

```
{"ran": true, "challenges_deleted": 3, "reservations_deleted": 0}
```

All three rows were from July, ~2 months past their own five-minute expiry: two
abandoned, one consumed. **`otp_challenges` now holds 0 rows and 0 outside the
retention window**, which is §30's completion criterion answered directly. All
six OTP functions are intact, and `profiles` (9), `orders` (71) and
`loyalty_transactions` (111) were untouched.

**Retention scope, noted 2026-11-26.** The sweep covers `otp_challenges` and
`otp_send_reservations` only. `whatsapp_message_logs`, which stores the number
each sign-in code was sent to, has no time limit (kept until the account is
deleted): `RECORD_OF_PROCESSING.md` "Findings made while building this record",
item 1. The policy sentence about verification codes is still honoured; this
section simply did not look at the neighbouring table, so it is not a complete
retention check.

**What is proven, and what is not.** The function is proven to execute and delete
correctly against real data; the job is registered, `active`, and pg_cron is
demonstrably working (470 successful runs across seven other jobs in the two
hours around the apply). **The sweep's own first scheduled tick has still not
been observed** — that is 2026-09-09 00:40 UTC. The distinction is kept because
this item was already closed once on weaker evidence. *(2026-11-26: no later
document in the repository records the first tick being watched, and
`OWNER_ACTIONS.md` still says it has not been observed; reading
`cron.job_run_details` for `otp-retention-sweep` would settle it, and has not
been done.)*

Review caught that on #342: §30's criteria had been written two commits before
and then not met — the same declare-done-on-partial-evidence error this whole
audit exists to correct, committed inside the pull request that records the
audit.

A second, quieter gap in the same area: `otp_send_reservations` already deletes
rows older than two days inside `otp_reserve_send` — but only **for the phone
currently asking**, so a number that requested a code once and never came back
kept its row forever. The sweep applies the identical two-day rule to every
phone, which is why it cannot change the rate limiter's behaviour.

## Verified accurate — no change needed

Recorded because "we checked and it was fine" is worth as much as a finding.

> **As of 2026-09-08, and no longer current for three of these (2026-11-26).**
> The verdicts for `payment_policy`, `cancellation_refund_policy` and
> `terms_conditions` rest on `online_payment_enabled` being false and on there
> being no provider. Moyasar was chosen on 2026-11-11, and
> `app_settings.online_payment_enabled` was read live as `true` on 2026-11-24
> (`docs/PAYMENTS.md`). The owner-side record says all three documents must change
> before customers can pay by card (`OWNER_ACTIONS.md` §47.15; gap PG-08 in
> `readiness/20261113-card-payments-gaps.md`: live `terms_conditions` v2.0 still
> said "Orders are paid in cash"). The live text now is not known from the
> repository. The other bullets (VAT, account deletion, support contact) are
> unaffected by this.

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

**And it ages badly again on 2026-11-18.** Marketing is opt-in from the next
build (CLAUDE.md §7): turning notifications on no longer turns offers on, so
*"offers if you have turned notifications on"* overstates what a new customer
receives. It errs toward disclosing more marketing than is sent, which is the
safer direction, but it is no longer accurate. The same sentence is in
`docs/legal/PRIVACY_POLICY_CARD_PAYMENTS_DRAFT.md`. Correcting the live policy is
a §5 write for the owner (`OWNER_ACTIONS.md` §10, 2026-11-18 subsection).

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
6. **If the version or effective date moves, move it in BOTH places.** The date
   lives in the `effective_date` column *and* in the document's own first line,
   and only one of them is a column. Take the "nothing else changed" hash
   *around* that line, not over it — otherwise the check that proves the edit was
   surgical is the same check that protects the stale copy. This is not
   hypothetical: `privacy_policy` went to v2.2 and then v2.3 on 2026-09-16 with
   its body still dated 8 September, and the invariant is why
   (`OWNER_ACTIONS.md` §39).
7. **Publishing is two steps: the write, then a rebuild.** A `legal_documents`
   edit reaches the app and any browser running JavaScript immediately. It does
   **not** reach a no-JavaScript client until the site is rebuilt, because
   `vite.config.ts`'s `prerenderLegal` plugin is `apply: 'build'` and bakes the
   documents into `legal.html`. **A store's policy checker is exactly a
   no-JavaScript reader**, so until the rebuild it still sees the old text. Here
   a merge to the default branch is the production rebuild; verify on
   `https://app.spicymeal.com.sa/privacy` with `<script>` stripped, not on the
   row you just wrote.
