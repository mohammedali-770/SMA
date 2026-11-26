# Legal and store drafts: customer-facing sentences that no longer match the code or the live state (review of 2026-11-26)

> **For the owner and counsel; nothing here has been published.** This file lists, per draft and per section, the customer-facing sentence (quoted from the draft as it stands at `7b101e0`), what is now different, and the audit finding id. **No customer-facing sentence in any draft or store text was edited** to produce it: wording belongs to the owner and counsel (`CLAUDE.md` §5). The drafting notes around the sentences were corrected separately, in each draft's own "State note, 2026-11-26" block.
>
> **Whether the published policy rows already cover these points is not known from the repository.** The live privacy, payment, cancellation and refund, and terms rows in `legal_documents` may already have been edited; no repository document records it, and `docs/RECORD_OF_PROCESSING.md` item 6 still records that the privacy policy did not name Moyasar. The first thing to do with this file is a read-only comparison of the live rows with the drafts, which is an owner action.
>
> **Facts relied on.** Read live 2026-11-24 (`CLAUDE.md` §6): `app_settings.online_payment_enabled` is TRUE, the `payment-refund-worker` cron job is ACTIVE (since 2026-11-19), 19 online orders have `payment_status` paid. In the repository: the POS ticket for a paid card order carries a payment line with the card scheme, a masked card number and the approval reference (since 2026-11-19, `supabase/functions/_shared/posPaidFlag.ts`); a payment record that belongs to an order is kept with it through account deletion (`20261023120000`, applied 2026-11-22); a cancelled paid card order is refunded automatically (`20261018120000`, applied; owner decision of 2026-11-19); the order-first online path is closed (`20261012120000`, applied 2026-11-14); and the TEST-mode refusal has an exception, the secret `PAYMENT_ALLOW_TEST_CHECKOUT` (2026-11-18), since 2026-11-22 limited to customers on `PAYMENT_TEST_CHECKOUT_CUSTOMER_IDS`. Whether either secret is set is not known from the repository.
>
> **Arabic.** Where a sentence below has an Arabic counterpart, the Arabic half of the same section of the draft makes the same claim and needs the same decision. No Arabic was written or changed.

## 1. Cancellation and refund policy (`CANCELLATION_REFUND_POLICY_CARD_PAYMENTS_DRAFT.md`)

### CANCELLING AN ORDER, line 3 (finding F-DLG-04-001, medium)

> "If you paid online, our team refunds the amount you paid to the card or payment method you used once the order is cancelled, as described under ONLINE PAYMENT REFUNDS below."

A cancelled paid card order is now refunded automatically, in full, and the app already tells the customer so ("Your payment is being refunded to your card automatically", `oc_cancelled_refund_pending_body`). The draft's own D1 row gives the replacement ("is refunded automatically") and says to use it once the change is deployed; the change is applied. Staff are told by the text to expect manual work the code now does, and a hand refund on top of the automatic one raises a critical R14 incident.

### ONLINE PAYMENT REFUNDS, lines 5, 6 and 8 (F-DLG-04-001, F-DLG-04-006)

> "If you would rather not try again, contact us and our team will cancel the order and refund the amount you paid."
>
> "If the app shows that we are checking with the branch whether your order went through, the order is not refunded automatically, because the branch may already have it. If the branch did not receive it, our team refunds the amount you paid."
>
> "Our team also refunds an online payment when a refund is due because something was wrong with the order, and when the order is cancelled after payment, whether at your request, because the branch could not accept or complete it for a reason on its side, or because we cancel it under our Terms and Conditions."

The third sentence describes a cancellation refund as something "our team" does; it is automatic for any cancelled paid card order. Separately, line 2:

> "If it still cannot be sent and the app no longer offers to send it again, the full amount you paid is refunded automatically, and you can follow the refund on your order in the app."

is not unconditional since `20261022120000_pos_resend_refund_guards` (applied 2026-11-22): an order that staff have moved past `received` (the branch took it by hand) no longer gets the automatic POS-failure refund, and its refund is left pending for a person. No customer wording covers that case. Whether to state the condition or add a "contact us if you were told it would be refunded and it was not" fallback is a product decision.

### ONLINE PAYMENT REFUNDS, line 5 and its last sentence (F-DLG-04-002, medium)

> "Once you have asked us to cancel it, do not resend it."

A cancelled order can no longer be resent: the resend check, both sync claims and the refund enrolment skip it (`20261012120000`, `20261015120000`, applied), and the app has an `order_cancelled` receipt state. The sentence tells customers to avoid something the system prevents, and the draft's own D12 says to delete it once those conditions are met.

### ONLINE PAYMENT REFUNDS, lines 3 and 10 (F-DLG-04-003, medium; F-DLG-04-004, low)

> "If the refund status on your order has not changed to Refunded [N] days after it first appears, contact us and our team will complete the refund."
>
> "We may not notice some payments unless you tell us: a second payment taken for an order that was already paid, or an amount deducted from your card when the app could not confirm your payment."

Refund retries now back off and stop after 10 tries, and a stuck refund raises an alert (R18, applied 2026-11-18); duplicate and unconfirmed payments raise R15 to R17 and appear on an admin card (applied 2026-11-17), and the owner decided on 2026-11-17 that a duplicate is refunded by hand. So "we may not notice some payments" and the customer duty to report a stale refund rest on a premise the platform now covers with an alert; D8's alternative sentence was conditioned on exactly these things. Staff still have to act, and an alert reaches nobody outside the console until external alert email is on (gap PG-10).

## 2. Payment policy (`PAYMENT_POLICY_CARD_PAYMENTS_DRAFT.md`)

### PAYING ONLINE, paragraph 5: refund-promise bracket (F-DLG-06-002)

The bracket tells the owner that "no refund is promised here, because nothing alerts staff to these payments and each is refunded by hand in the Moyasar dashboard", and settles the promise "with cancellation_refund_policy D2 and D3". "Nothing alerts staff" is out of date (R15 to R17 and the admin card), D2 is decided, and the refund draft's sentence the bracket quotes ("we will refund it once we have confirmed it with Moyasar") is its first wording; its current one is "Once we have confirmed with Moyasar that the payment was taken and was not used for any order, we will refund it." The customer text before the bracket promises no refund and is not wrong; the owner's reasoning for leaving it out should be re-read.

### PAYING ONLINE, paragraph 2: points (F-DRF-03-001, medium; read with F-DLG-06-005)

> "If your points cover the whole order, nothing is charged and no payment page opens."

True only when the total is a multiple of SAR 0.10. The server redeems whole points only, so a discount that covers the order leaves `total mod 0.10`, between 0.00 and 0.09. A leftover above zero is not settled at once and is below the SAR 1.00 minimum, so the card step refuses it (the customer's way out is the existing "Turn off points for this order, or pay in cash" message). Whether live totals ever end in a halala digit other than 0 is not known from the repository.

### PAYING ONLINE, paragraph 4: closing the payment page (F-DLG-06-004)

> "If you close the payment page without paying, no payment is taken and no order is placed, but that payment stays open: until the payment page expires, the app takes you back to it when you return to checkout or place an order, even if you choose cash."

Since #494 (2026-11-18) a saved checkout begun for a different cart, on which nobody has started paying, is dropped and its invoice cancelled; since 2026-11-19 a failed, cancelled or expired dialog offers "Pay in cash instead". The sentence is still true for an unchanged cart and understates what the customer can do for a changed one. The draft's bracket and Open decision 10 frame the app change as not yet made.

### PAYING ONLINE, paragraph 3 (F-DLG-06-006)

> "An order you pay for online is placed only after we have checked directly with Moyasar that your payment went through for the right amount. Until then there is no order, and nothing is sent to the branch."

Still true, and now true on the server as well as in the app: the order-first path was closed on 2026-11-14. The draft's PAY-6 and the caveat on this sentence are history.

### HOW YOU PAY: the methods bracket and the order of publication (F-DLG-06-001, high; F-DLG-06-007)

> "Online payment accepts mada, Visa and Mastercard cards."

`CLAUDE.md` §6 lists Apple Pay among the enabled methods; the draft records Apple Pay as an owner decision and does not name it. The bracket's reason for the SADAD precondition ("a SADAD payment stays on hold for days") is wrong: on an invoice a SADAD bill stays payable as long as the invoice does, and cannot be refunded. The more important point is the plan itself: the draft assumes the policy goes live before online payment is switched on. Online payment is on (read live 2026-11-24), and whether this policy, the privacy policy and the others were edited first is not known. If they were not, the live payment policy still says "We have not yet selected an online payment provider" while customers pay by card, and v2.0's promise to name the provider "before the option appears in the app" has been passed.

## 3. Privacy policy (`PRIVACY_POLICY_CARD_PAYMENTS_DRAFT.md`)

### HOW LONG: payment records (F-DLG-07-002, medium)

> "Payment records: for payments made in the app, while your account is open, and never longer than the order they belong to; they are deleted when you delete your account. Any other payment record is kept no longer than the order it belongs to. Payment records never contain your full card number."

Since `20261023120000` (applied 2026-11-22) a payment record that belongs to an order is kept with that order, unchanged, through account deletion (only an order-less record is deleted with its session). The default text, which is what is pasted if no bracket is chosen, promises deletion; the bracketed PRIV-1 alternative ("kept with the order they belong to, for as long as the order is kept") is the one that is true. The same sentence appears in the YOUR CONSENT reasoning, rows 10 and 11, and Open decision 5. Whether a kept payment record needs a longer stated period, and what happens to an order-less captured payment, are legal questions (gap PG-06's second question is still open).

### WHAT WE COLLECT: device location (F-DLG-07-004)

> "Device location: your location, only while you are choosing a delivery point on the map, and only if you allow it. We do not follow your location in the background."

`docs/OWNER_ACTIONS.md` §43 records this as inaccurate: the app also uses the device location on the pickup tab (nearest branches) and at checkout (a far-pin warning), and "Use my location" sends the rounded position to the platform's reverse geocoder before a pin is confirmed. The line has no `[OWNER DECISION]` bracket, so the draft's "settle every bracket" gate would not catch it.

### Lazywait recipient line (F-DLG-07-006)

> "If you pay online, it can also receive the amount paid, your card's type (such as mada or Visa) and its last four digits, and Moyasar's reference for the payment."

Still accurate: since 2026-11-19 the POS receives these on the ticket as a payment line (card scheme, masked number, Moyasar's payment id as the approval reference). One nuance the sentence does not carry: for an Apple Pay payment the POS label is "APPLE PAY - MADA", so the POS learns the wallet and not only the card type. The draft's audit trail still describes a separate call that was removed on 2026-11-19; the sentence itself is unaffected.

### Refund behaviour, and the sequencing premise (F-DLG-07-005, F-DLG-07-001, high)

The paragraph that says a cancelled paid order is "refunded by hand" is a drafting note, not customer text (the policy's own text, "make any refund", does not depend on it). The premise that online payment is off between publication and switch-on is false (read live 2026-11-24), which has the same consequence as for the payment policy above: the live privacy policy may still say card payment is not available and name no card processor.

## 4. Terms and conditions (`TERMS_CONDITIONS_CARD_PAYMENTS_DRAFT.md`) (F-DLG-08-003, F-DLG-08-004)

No customer-facing sentence in the proposed text is contradicted. The proposed PAYMENT line is conditional:

> "Orders can be paid in cash at pickup or on delivery or, where the app offers it, online, as part of placing your order. See the Payment Policy."

What changed is the drafting notes: TC-1 (a cancelled paid order is "refunded only by hand") and TC-4 (the receipt ignores `orders.status`) are superseded, and "TEST mode refuses every customer checkout" is conditional. The premise (online payment still off) is false. If the live terms still say "Orders are paid in cash at pickup or on delivery", they contradict the payment policy and the app.

## 5. Offers and loyalty terms (`OFFERS_LOYALTY_TERMS_DRAFT.md`) (F-DLG-05-001, medium; F-DLG-05-002; F-DLG-05-004)

These two sentences are inside the file's byte-accurate copy of the published v2.2 text, and are repeated in the file's draft sections 3 and 4:

> "Points are added when you place the order, and your balance updates immediately."

Untrue since `20260918120000` and `20260921120000` (applied 2026-09-14): a created order records an `earn_pending` ledger row and the balance does not move; it moves when the order is delivered (cash always; online only when `payment_status` is `paid`). Correcting the live row is a published version 2.3 and an owner action; the settlement rule the sentence should state is the owner's. The file's section 1 repeats the old model as the explanation of an earlier correction.

> "Points are redeemed as a discount at checkout. At the time of writing each point is worth 0.10 SAR, and you need at least 100 points before you can redeem."

True as a necessary condition, incomplete: the minimum is applied to the points actually applied, after the cap at the order's value, so a customer holding 500 points on an order worth less than SAR 10.00 redeems nothing, with the switch on and no explanation. Whether the app says so at checkout is not checked here.

## 6. Privacy policy correction drafts (F-DLG-08-001, medium; F-DLG-08-002)

- **Map processor correction (`PRIVACY_POLICY_MAP_PROCESSOR_CORRECTION.md`).** Both options propose "Google — the map and address search you use to choose a delivery location." That is the v2.2 wording `OWNER_ACTIONS.md` §34 records as wrong ("there is no address search in either customer channel") and replaced with v2.3, live since 2026-09-16, which names Google and Apple. The draft is closed and must not be published; it neither names Apple nor lists a version above the live one.
- **Location uses correction (`PRIVACY_POLICY_LOCATION_USES_CORRECTION.md`).** The table is evidence, not customer text. Its first row says only the point the customer picks leaves the phone; on "Use my location" the device position goes to the platform's reverse geocoder first. The proposed customer text ("only the delivery point you choose is saved") is unaffected.

## 7. Store answers draft (`docs/store/CARD_PAYMENTS_STORE_ANSWERS_DRAFT.md`, not edited here) (F-DLG-09-001, high; F-DLG-09-002; F-DLG-09-003; F-DLG-09-004; F-DLG-09-005; F-DLG-09-006)

This file was outside this review's editing scope, so none of the following has been corrected in it. Each is an answer or note the owner would enter in Play Console or App Store Connect.

- **What the POS receives (F-DLG-09-001, high).** Play "Purchase history" row: "the **POS** also receives the paid amount and Moyasar's payment id (…), never card details"; "User payment info" shared answer: "No payment details leave our systems. Moyasar is their source, and the POS receives only the amount and Moyasar's payment id". Since 2026-11-19 the POS also receives the card scheme, a masked card number and the approval reference, so "never card details" and "receives only the amount and Moyasar's payment id" under-declare a recipient and contradict the privacy draft, which says the opposite. The same claim is in `docs/RECORD_OF_PROCESSING.md` (the activity 3 row's older sentence), which a later row corrects.
- **Premise and TEST mode (F-DLG-09-002, F-DLG-09-003).** "Customer checkout is still refused in TEST mode … so every 'current' text below is still true today" is false: online payment is on (read live 2026-11-24) and the TEST refusal has the secret exception. "Online payments are real charges" (TestFlight) and "so a tester's payment is a real charge" hold only for live mode.
- **Refunds and alerts (F-DLG-09-004).** "An admin cancelling a paid online order refunds nothing automatically" and "refunded only by hand, and nothing alerts on it": a cancellation is now refunded automatically; duplicates are still by hand and raise R15.
- **Account deletion (F-DLG-09-005).** "today deleting the account deletes them (product gap PG-06)" and "both `ON DELETE CASCADE`": since 2026-11-22 a payment record of a retained order survives deletion, and the purpose answer's condition ("once payment records survive account deletion") has been met. Which Play purposes to declare is the owner's and counsel's decision.
- **Export (F-DLG-09-006, low).** The PG-26 row says the export "returns no payment records" and also that the fix was applied on 2026-11-17; it was applied, so the first half is out of date.

## 8. Play listing copy (`docs/store/LISTING_COPY.md`, text blocks unchanged) (F-DLG-10-001, medium; F-DLG-10-003; F-DLG-10-004; F-DLG-10-009)

> English "Payment" lines: "Cash on pickup at the branch, or cash on delivery" (with the Arabic Payment line and the release-notes payment line).

False while online payment is on (read live 2026-11-24). The file's own banner and C-CASH row now say so, and nothing is published from it. The following are lower: "My Orders keeps every past order with its itemised invoice" (the list loads the 20 most recent orders and does not page, so it is untrue above 20 orders); the same sentence's "invoice" (the app says its receipt is not the tax invoice, which the branch hands over); and the English short description's "points on every pickup" against the Arabic «على الاستلام» (some items may not earn points, and points are credited on delivery or settlement, see section 5).

## 9. Findings in this package that did not hold, or are for someone else

- **F-DLG-10-007** (the listing cites `CLAUDE.md` §6 for "the owner chose Moyasar" while §6 says no provider is selected) did not hold: `CLAUDE.md` §6 is now headed "Moyasar is the provider (owner decision, 2026-11-11)".
- **F-DLG-10-008** (`OWNER_ACTIONS.md` §47.15 refers to a "C-CARD" claim row the listing does not have) is in `OWNER_ACTIONS.md`, not in a file of this review; left for that document's owner.
- **F-DLG-07-007, F-DLG-07-009, F-DLG-07-010 and the citation findings** (F-DLG-04-005, F-DLG-06-008, F-DLG-07-008, F-DLG-08-005, F-DLG-09-007): drafting-note and reference corrections, handled by each draft's state note (cite symbols, not line numbers).
- **F-DLG-04-007 and F-DLG-06-011**: statements about live rows (the stored `v2.0` texts and their hashes, the payment row, active coupons, product counts). Not known from the repository.
