# Fact-check of the cancellation and refund policy draft, 2026-11-13

> **Point-in-time evidence, kept for provenance.** An independent check of an
> earlier version of the cancellation and refund policy draft (`docs/legal/CANCELLATION_REFUND_POLICY_CARD_PAYMENTS_DRAFT.md`), made on 2026-11-13 against the
> code, the live database (read-only) and the cited pages. Line numbers such as
> "Draft L234" refer to that earlier version, not to the file as merged. Every
> finding is answered in the draft's Fix log: what was changed, and why where a
> finding was not applied as written. Read the draft for the current text.

## Fact-check: cancellation_refund_policy.md, the "Proposed text" section (EN and AR)

**Draft checked:** docs/legal/CANCELLATION_REFUND_POLICY_CARD_PAYMENTS_DRAFT.md (I did not edit it).

**What I checked it against:**
- the default branch at `04eb351`;
- read-only SQL on Production (2026-11-13): all 9 active `legal_documents` rows, `app_settings`, `cron.job`, `order_refunds`, and order status counts;
- Moyasar's public docs, fetched 2026-11-13.

**Byte check of kept lines:** All 18 lines the draft says it keeps (9 EN, 9 AR) match live v2.0 exactly, as whole lines. Only REFUNDS line 1 differs, which is intended. The check was a local SQL script, not kept.

---

### BLOCKING

**B1. A promise to staff action that nothing triggers.**
- **Quoted:** "If an automatic refund cannot be completed, our team completes it and contacts you." (EN 157) / «وإذا تعذّر إتمام الاسترداد التلقائي، يتولى فريقنا إتمامه ويتواصل معك.» (AR 198)
- **Evidence:**
  - The likeliest live failures never count as "cannot be completed":
    - A 401 from Moyasar's Allowed IPs is classed `pending` (moyasarRefund.ts:101-110).
    - A proxy or network refusal comes back as status 0 (payment-refund/index.ts:247-251), which is also classed `pending` (moyasarRefund.ts:119-121).
    - Either way the refund stays "Refund pending" for ever, with no attempt cap, and does not appear in `list_failed_order_refunds()` (PAYMENTS.md:377-385).
    - Proxy support on hosted Supabase is itself unproven (PAYMENTS.md:467-472).
  - When a refund does fail outright, staff have nothing that shows it:
    - nothing in the console calls `list_failed_order_refunds`;
    - in `src/`, `refund_state` appears only in the customer column list (src/lib/api.ts:798);
    - the admin receipt says "Nothing is … refunded from here" (OrderReceiptModal.tsx:11-14);
    - no health or watchdog rule reads `order_refunds`, and REFUND_STUCK is explicitly not implemented (ORDER_INTEGRITY_WATCHDOG.md:186-189).
  - Watchdog rule R7 does tell staff that the paid order never reached the kitchen (ORDER_INTEGRITY_WATCHDOG.md:76). It says nothing about how the refund went.
  - Outright failures are realistic: Moyasar's docs (payment-operations guide) say "For live accounts using aggregation, your account balance must be sufficient to cover the refund."
- **Corrected wording:**
  - EN: "If the app shows that the refund could not be completed, or still shows it as pending after [N] days, contact us and our team will complete it. [OWNER DECISION D8: N, and whether staff get an alert for failed or stuck refunds]"
  - AR: «وإذا أظهر التطبيق أن الاسترداد تعذّر إتمامه، أو ظل يُظهره قيد المعالجة بعد [N] أيام، فتواصل معنا وسيتولى فريقنا إتمامه. [OWNER DECISION D8]»
  - Keep the original sentence only once the console shows failed and stuck refunds and an alert fires on them.

**B2. Publishing this alone contradicts live documents, so "Publishing early is safe" (draft lines 20-26) is false.**
- **Quoted:** "…through our payment provider, Moyasar." (EN 156, AR 197) and "…once we have confirmed it with Moyasar" (EN 160, AR 201)
- **Evidence:**
  - Live `payment_policy` v2.0, EN: "We have not yet selected an online payment provider. If we add card payment, we will name the provider in this policy and in the Privacy Policy before the option appears". The AR says the same: «لم نختر بعد مزوّد دفع إلكتروني…».
  - Live `privacy_policy` v2.3: "Online card payment is not available. If we add it, we will name the payment provider in this policy before the option appears". Its "WHO WE SHARE IT WITH" list does not include Moyasar.
  - Live `terms_conditions` v2.0, PAYMENT: "Orders are paid in cash at pickup or on delivery." AR: «تُدفع الطلبات نقداً عند الاستلام أو عند التوصيل.»
    - `terms_conditions` is not in OWNER_ACTIONS.md §47.15 (4173-4188).
    - No sibling draft updates it; store_answers.md only lists its hash.
- **Correction:**
  - Publish in the same §5 write as `privacy_policy` and `payment_policy`, or after them.
  - Add `terms_conditions` to §47.15 with this PAYMENT line:
    - EN: "Orders are paid in cash at pickup or on delivery, or online where the app offers it. See the Payment Policy."
    - AR: «تُدفع الطلبات نقداً عند الاستلام أو عند التوصيل، أو إلكترونياً حيث يتيح التطبيق ذلك. انظر سياسة الدفع.»
  - If this policy must go first, remove the name:
    - EN: "through our payment provider." / "confirmed it with our payment provider"
    - AR: «عن طريق مزوّد الدفع لدينا» / «بعد التحقق منه لدى مزوّد الدفع»
  - Delete "Publishing early is safe" from the draft header.

---

### SHOULD-FIX

**S1. The "Received" status does not mean preparation has not started (kept line, but it now decides a card refund).**
- **Quoted:** "You can ask to cancel while your order is still Received, before the branch starts preparing it." (EN 137, AR 178)
- **Evidence:**
  - `orders.status` changes only through `admin_set_order_status`, which requires `is_admin()` (20260918120000:641-650, 794-796).
  - The POS webhook never changes it (lazywait-webhook/index.ts:15-17).
  - Live, last 90 days: 50 received/synced, 3 received/blocked, 1 delivered. So 53 of 54 orders never left "Received", which is the label the Orders tab shows (OrdersScreen.tsx:23).
- **Corrected wording:**
  - EN: "You can ask to cancel before the branch starts preparing your order. Contact us as soon as you decide, with your order number if the app shows one, and we will check with the branch whether preparation has started."
  - AR: «يمكنك طلب الإلغاء قبل أن يبدأ الفرع بتحضير طلبك. تواصل معنا فور اتخاذك القرار، مع ذكر رقم الطلب إن ظهر لك في التطبيق، وسنتحقق مع الفرع مما إذا كان التحضير قد بدأ.»

**S2. "You pay nothing" is not true of a card-paid order.**
- **Quoted:** "…we will tell you, and you pay nothing." (EN 144, AR 185)
- **Evidence:**
  - "Closed" in code means `is_active` only. It is checked when the checkout session is built, before payment (20260924120000:724-760), and never re-checked at finalize (ORDER_CONFIRMATION_FLOW.md:1664-1670).
  - Working hours are "ADVISORY ONLY. NOTHING enforces these" (20260820120000:96).
  - Live T&C: "A branch may decline an order — for example outside its working hours".
  - So a paid order can be declined after payment.
- **Corrected wording:**
  - EN: "…we will tell you. If you have not paid yet, you pay nothing."
  - AR: «…فسنخبرك، ولن تدفع شيئاً إن لم تكن قد دفعت بعد.»

**S3. The customer cannot give an order number in exactly the cases the new section covers.**
- **Quoted:** "contact us with your order number" (EN 137, 157; HOW TO REACH US "Please always include your order number")
- **Evidence:**
  - The app shows only the branch's POS number (mappers.ts:351-356). The internal SM- number "is never displayed" (ReceiptScreen.tsx:13-14).
  - An order that was not sent, or is being checked with the branch, has no number. Its card shows a generic title (OrderCard.tsx:18, 22).
- **Add to the new section:**
  - EN: "If the app shows no order number for your order, tell us the date, time and amount shown for it in your Orders tab, and the mobile number on your account."
  - AR: «وإذا لم يظهر رقم لطلبك في التطبيق، فأخبرنا بتاريخ الطلب ووقته ومبلغه كما تظهر في قسم الطلبات، وبرقم الجوال المسجّل في حسابك.»

**S4. "Only come to our attention" overstates the gap, and the Arabic says more than the English.**
- **Quoted:** "Some payments only come to our attention when you tell us" (EN 160) / «وثمة دفعات لا نعلم بها إلا إذا أخبرتنا» (AR 201, meaning "we do not know of them")
- **Evidence:** The system does record these payments:
  - a duplicate is a `failed` `payment_records` row saying "Refund this payment." (moyasar.ts:962-975);
  - the console receipt may show it (PAYMENTS.md:599-601);
  - `finalize_failed` and `verification_mismatch` each write sync-log rows (moyasarVerify.ts:378-387, 490-506).
  - What is true is that nothing alerts staff (PAYMENTS.md:594-597).
- **Corrected wording:**
  - EN: "We may not notice some payments unless you tell us: …"
  - AR: «وقد لا ننتبه إلى بعض الدفعات ما لم تخبرنا بها: …»

**S5. After staff cancel an order, the app still offers Resend, and Resend still works.**
- **Quoted:** "If you would rather not try again, contact us and our team will cancel the order and refund it." (EN 157, AR 198)
- **Evidence:**
  - The receipt hero works out its state without `orders.status` (orderConfirmation.ts:24-36, 51-109; ConfirmationHero.tsx:25, 64).
  - None of these checks the status:
    - the resend check and RPC (20260813143000:104-185);
    - the sync claims (:10-58);
    - the sync worker (no "cancelled" anywhere in lazywait-sync/index.ts);
    - `order_refund_due` (20260724120000:462-485).
  - Cancelling does not change the sync state (20260918120000:657-732).
  - Consequences:
    - a cancelled order can be resent to the kitchen;
    - after three resends, an automatic refund is queued against a payment staff already refunded by hand;
    - the customer is then told "Refund in progress" (strings.ts:385).
- **Correction:**
  - Fix the code first: make those three paths ignore `status = 'cancelled'`, and show "Cancelled" in the receipt hero.
  - Until then, add:
    - EN: "Once you have asked us to cancel it, do not resend it."
    - AR: «وبعد أن تطلب منا إلغاءه، لا تُعد إرساله.»

**S6. The "refunded automatically" sentence has never run live.**
- **Quoted:** "the full amount you paid is refunded automatically" (EN 157, AR 198)
- **Evidence:** The logic matches the code. But:
  - it has never run against live Moyasar, and the sandbox cannot test it (PAYMENTS.md:545-547);
  - the refund job runs only while the payment row is enabled and set to Moyasar (PAYMENTS.md:343-346);
  - Live 2026-11-13: refund job inactive, `order_refunds` = 0.
- **Correction:** Extend D7. Before this wording is published, require:
  - a LIVE "Test connection" through the proxy, OK;
  - the refund job active;
  - the payment row kept enabled;
  - ideally, one live automatic refund observed end to end.
  - Otherwise use:
    - EN: "…our team refunds the full amount you paid."
    - AR: «…يرد فريقنا المبلغ الذي دفعته كاملاً.»
  - Note this fallback disagrees with the shipped app text "Your payment will be refunded automatically." (strings.ts:375/719).

**S7. Missing [OWNER DECISION] markers for decisions already listed.**
- **D3 (how soon staff refund)** is attached only to line 159. Add it to:
  - EN 139, 157 (last sentence), 158 (last sentence), 160;
  - AR 180, 198, 199, 201.
- **D1 (automatic or on request)** is missing on EN 157 and 158 (last sentences) and AR 198 and 199. Both describe cancelling a paid order; the owner's stated answer is "automatic" (PAYMENTS.md:16).
- **D4 (card only, or cash at the branch)** is missing on EN 139 and 145 (AR 180, 186). Both state where the money goes.
- **A new marker** is needed at EN/AR 157 for a paid order the customer never resends. It stays "retry available" for ever with no refund (20260828090000:121-126; draft lines 296-300).

**S8. Points spent on an automatically refunded order are not given back (draft item 7 is now confirmed).**
- **Evidence:**
  - Nothing on the refund path touches loyalty or sets `status = 'cancelled'`:
    - 20260724120000:494-800;
    - 20261003120000:541-581;
    - 20260729090000;
    - payment-refund/index.ts (no "loyalty" match).
  - Only an admin cancel restores redeemed points (20260918120000:657-723).
  - Live `offers_loyalty_terms` v2.2: "IF YOUR ORDER IS CANCELLED … any points you spent on it are returned to you in full."
  - The app tells the customer "Order not placed" (strings.ts:374).
  - Online orders can redeem points (PAYMENTS.md:126-130).
- **Correction:** Add "[OWNER DECISION D9: points spent on an automatically refunded order]".
  - Either change the code so they are returned, or state the current behaviour:
    - EN: "Points you spent on an order that is refunded automatically are not returned automatically; contact us and our team will return them."
    - AR: «ولا تُعاد تلقائياً النقاط التي استخدمتها في طلب استُرد مبلغه تلقائياً؛ تواصل معنا وسيعيدها فريقنا إليك.»

**S9. A prepaid delivery the driver could not complete has no rule, though a live policy points here for it.**
- **Evidence:** Live `delivery_pickup_policy` v2.1: "If the driver cannot reach you or the address … the order may be returned to the branch. See the Cancellation and Refund Policy."
  - Neither v2.0 nor the draft says what happens to a prepaid delivery order in that case.
  - EN 145 ("cannot … complete … is refunded") could be read as promising a refund.
- **Correction:** Add "[OWNER DECISION D10]".
  - EN: "A delivery order returned to the branch because the driver could not reach you or your address [is not refundable / is refunded less the delivery fee]."
  - AR: «وطلب التوصيل الذي يُعاد إلى الفرع لتعذّر وصول السائق إليك أو إلى عنوانك [لا يكون قابلاً للاسترداد / يُسترد مبلغه بعد خصم رسوم التوصيل].»

**S10. Where the refund goes depends on dashboard settings, not on our code.**
- **Quoted:** "goes back to the card or payment method you paid with" (EN 156)
- **Evidence:**
  - Our invoice request does not restrict payment methods (moyasar.ts:336-353), so the hosted page offers whatever the Moyasar dashboard enables.
  - A SADAD payment cannot be refunded (PAYMENTS.md:635-637). Whether SADAD is off is still unanswered (§47.19).
- **Correction:** Make Moyasar's written confirmation that SADAD and STC Pay are off for invoices a precondition for publishing, not just an "unverified" note. The wording itself can stay.

---

### NITS

**N1. "While we check" suggests an automatic refund afterwards.**
- **Quoted:** "is not refunded automatically while we check" (EN 158; AR «أثناء التحقق»)
- **Evidence:** An order being checked with the branch is never refunded automatically, and staff have no "resolve" action for it (20260827120000:107-131).
- **Correction:** Delete "while we check" in EN and «أثناء التحقق» in AR.

**N2. The Arabic "refund its value" differs from "the amount you paid".**
- **Quoted:** AR «يرد قيمته» (198, 199)
- **Correction:** «يرد المبلغ الذي دفعته», to match the English.

**N3. Refund timing: "credit card" is narrower than what is enabled, and the source cannot be confirmed.**
- **Quoted:** "a credit card" / «البطاقة الائتمانية» (EN 161, AR 202)
- **Evidence:**
  - The enabled methods are mada, Visa/Mastercard and Apple Pay (PAYMENTS.md:15). Debit Visa/Mastercard cards are not covered by "credit card".
  - The 1-3 / 7-14 day figures could not be found in Moyasar's public docs on 2026-11-13: neither the refund API page nor the payment-operations guide states timing. The repo note (Moyasar_API_Reference.md:244-245, "not tested") is the only source.
- **Correction:** "a Visa or Mastercard card" / «بطاقة فيزا أو ماستركارد».

**N4. A live push message describes a different process.**
- **Evidence:** The `pos_failed` push says "Our team will follow up." / «فريقنا سيتابع الحالة.» (push-dispatch/index.ts:179-188). The policy says the customer should resend or contact us.
- **Correction:** Either add "our team may also contact you" to the policy, or align the push copy.

**N5. Two points outside the Proposed text.**
- What-changed row 11 says card data "never reaches our servers". In fact the card brand and last four digits are stored (moyasarVerify.ts:332-333, 375-376).
- "Could not verify" item 7 is now confirmed (see S8).

---

### Checked and correct

- **Automatic refund case:** paid; proven not sent; three resends used; the state is forced to `dead_letter`; a refund is queued.
  - Evidence: 20260724120000:462-513; 20260813143000:191-210; app states in 20260828090000:72-132 and strings.ts:372-377 / 716-721.
- **Amount and destination:** the refund is for the paid payment's own amount (20261003120000:557-575) and goes to that Moyasar payment (payment-refund/index.ts:111-119).
- **Admin cancel:** reverses points and coupon use only, with no refund.
- **No customer cancel function** exists.
- **Duplicates:** recorded, not refunded automatically, and nothing alerts on them.
- **Orders being checked with the branch:** never refunded automatically.
- **Refund status in the app:** shown when `refund_state` is not `none` (ConfirmationHero.tsx:65).
- **Data sent to Moyasar:** the invoice carries amount, description, URLs, expiry and opaque references; the refund carries the payment id and amount. Nothing in the Proposed text contradicts this.
- **Live baseline:** v2.0, 2026-08-18, 1533/1219 characters; online payment off; refund job inactive; `order_refunds` 0; 0 Moyasar payment rows.
- **Arabic:** says the same as the English sentence by sentence, except S4 and N2.

**Verdict:** Not publishable as drafted: 2 blocking issues (B1, an unkept promise that staff will finish failed refunds; B2, publishing it alone contradicts live payment, privacy and terms documents) and 10 should-fix items. The core automatic-refund statements are accurate to the code.