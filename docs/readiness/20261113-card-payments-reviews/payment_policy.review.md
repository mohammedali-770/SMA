# Fact-check of the payment policy draft, 2026-11-13

> **Point-in-time evidence, kept for provenance.** An independent check of an
> earlier version of the payment policy draft (`docs/legal/PAYMENT_POLICY_CARD_PAYMENTS_DRAFT.md`), made on 2026-11-13 against the
> code, the live database (read-only) and the cited pages. Line numbers such as
> "Draft L234" refer to that earlier version, not to the file as merged. Every
> finding is answered in the draft's Fix log: what was changed, and why where a
> finding was not applied as written. Read the draft for the current text.

FACT-CHECK: docs/legal/PAYMENT_POLICY_CARD_PAYMENTS_DRAFT.md ("Proposed text", EN and AR). I did not edit the draft.
Evidence paths are relative to the default branch at `04eb351` . "Live" means read-only SQL on wxfmmnihidsdyemasstf, 2026-11-13. The draft line numbers are in [Lnnn].

BLOCKING

B1. The live Terms & Conditions still say payment is cash only, and nothing schedules a change to them.
- Quoted: the draft's publishing set is "Publish it together with the privacy_policy draft and the cancellation_refund_policy update" [L23-25]. Open decision 6 names three documents [L328-336]. The new text says "can be paid in cash … or, where the app offers it, online" [L137/L166].
- Evidence: the live terms_conditions v2.0 (md5_en 0da66433…, md5_ar bcd2dc7a…) says "PAYMENT / Orders are paid in cash at pickup or on delivery. See the Payment Policy." In Arabic: «الدفع / تُدفع الطلبات نقداً عند الاستلام أو عند التوصيل. انظر سياسة الدفع.» None of these lists the T&C: docs/OWNER_ACTIONS.md §47.15 (L4173-4189), docs/PAYMENTS.md §7 step 11 (L420-426), docs/GO_LIVE_READINESS.md:179 (G5). No draft updated it at the time; store_answers.md:50 only records its hash. Once §47.18 turns online payment on, the T&C contradict this policy.
- Correction: add terms_conditions to the same publishing window, and to item 6, the Timing note, §47.15 and G5.
  - EN PAYMENT: "Orders are paid in cash at pickup or on delivery or, where the app offers it, online when you place the order. See the Payment Policy."
  - AR: «تُدفع الطلبات نقداً عند الاستلام أو عند التوصيل، أو إلكترونياً عند تقديم الطلب حيث يتيح التطبيق ذلك. انظر سياسة الدفع.»
  - Two links in this draft are already known to depend on the same window (the drafter flagged them): "Moyasar is also named in our Privacy Policy" is false against live privacy_policy v2.3 ("Online card payment is not available"). "Our Cancellation & Refund Policy explains when refunds are made and how long they take" is false against live cancellation_refund_policy v2.0 ("settled in cash at the branch").

B2. "use fewer points" cannot be done in the app and contradicts the live Loyalty Terms. The zero case is also handled wrongly.
- Quoted: "Online payment needs a total of at least SAR 1.00. If redeeming points brings the amount to pay below that, use fewer points or pay in cash." [L146]. AR «فاستخدم نقاطاً أقل أو ادفع نقداً» [L175].
- Evidence:
  - Live offers_loyalty_terms v2.2: "When you do, your whole available balance is applied, up to the value of the order."
  - The app's points control is on/off only: apps/mobile/src/features/checkout/CheckoutScreen.tsx:415 `redeemingPoints = redeemPoints && loyaltyChannelOk ? availablePoints : 0`, and features/checkout/view/LoyaltyToggle.tsx.
  - The points discount is capped at the order value: previewTotals.ts:132-136, and live compute_order_snapshot `v_loyalty_discount := least(round(v_loyalty_redeemed * v_per_point, 2), v_pre_loyalty)`.
  - So points can bring the total to exactly 0. Live begin_checkout_session then settles it at once ("Zero-total (fully covered): nothing to charge — settle immediately", `insert_order_from_snapshot(..., 'online','paid', ...)`; also migrations/20260826110000_checkout_zero_total_idempotency.sql:123; CheckoutScreen.tsx:777-779). A zero total is not refused, which also resolves the draft's own Claim 9. Only 0.01-0.99 is refused.
- Correction:
  - EN: "Online payment needs an amount to pay of at least SAR 1.00. If redeeming your points leaves more than zero but less than that, turn off points for this order or pay in cash; the app always applies your whole points balance, not part of it. If your points cover the whole order, nothing is charged."
  - AR: «ويتطلب الدفع الإلكتروني ألا يقل المبلغ المستحق عن ١٫٠٠ ريال سعودي. فإذا ترك استبدال نقاطك مبلغاً مستحقاً أكبر من صفر وأقل من ذلك، فأوقف استخدام النقاط في هذا الطلب أو ادفع نقداً، إذ يطبّق التطبيق رصيد نقاطك كاملاً لا جزءاً منه. وإذا غطّت نقاطك قيمة الطلب كاملة، فلن يُحصَّل منك أي مبلغ.»
  - The app message has the same defect: payBelowMinimum, strings.ts:208/:569. RELEASE_CHECKLIST.md:190-192 and PAYMENTS.md:275-277 expect that message, so they need the same change.

B3. "or choose cash" is not true after the customer closes the payment page.
- Quoted: "If your payment is declined, or you close the payment page or let it expire without paying, no payment is taken and no order is placed. Your basket stays in the app, so you can try again or choose cash." [L148/L177]
- Evidence:
  - Closing the page without paying leaves the invoice payable, and payment-verify answers pending: moyasarVerify.ts:584 `reason:'no_payment'` gives pending.
  - The app then keeps the saved session: pendingSession.ts:79-85 and 164-188.
  - Before every order, cash included, the app resumes that online payment and places nothing: CheckoutScreen.tsx:727-733 `if (rec.kind === 'resume') { await runOnlinePayment(rec.sessionId); return; }`. It reruns before the cash branch at :789, and also reopens it just by entering checkout (:286-297).
  - The docs agree: PAYMENTS.md:225-229; RELEASE_CHECKLIST.md:180-183 ("Close and come back"); the app's own text is payNotCompleted, "You can continue or try again." (strings.ts:221).
  - Cash becomes possible only when the invoice expires. That is 30 minutes live, configurable from 5 to 60 (moyasar.ts:259-260).
  - Decline and expiry are terminal, so cash does work in those two cases.
- Correction:
  - EN: "If your payment is declined, or the payment page expires before you pay, no payment is taken and no order is placed; your cart stays in the app, so you can try again or, where it is offered, pay in cash. If you close the payment page without paying, nothing is taken and no order is placed, but that payment stays open: until the page expires, the app takes you back to it when you return to checkout or place an order, even if you choose cash."
  - AR: «وإذا رُفضت الدفعة، أو انتهت صلاحية صفحة الدفع قبل أن تدفع، فلن يُحصَّل منك أي مبلغ ولن يُقدَّم الطلب، وتبقى سلتك في التطبيق لتحاول مرة أخرى أو تختار الدفع نقداً حيث يتاح. وإذا أغلقت صفحة الدفع دون أن تدفع، فلن يُحصَّل منك أي مبلغ ولن يُقدَّم الطلب، لكن تلك الدفعة تبقى مفتوحة، فيعيدك التطبيق إليها عند عودتك إلى إتمام الطلب أو تقديمه، حتى لو اخترت الدفع نقداً، إلى أن تنتهي صلاحية الصفحة.»
  - The other route is a code change that lets a customer abandon a closed, unpaid session.

B4. The Apple Pay [OWNER DECISION] cannot be settled before this text has to be live.
- Quoted: "[OWNER DECISION: keep every Apple Pay mention only if the Apple Pay device check in RELEASE_CHECKLIST.md §7 passes …]" [L138/L167]. Against that, the draft says "this must be live before OWNER_ACTIONS.md §47.18" [L18-22].
- Evidence:
  - RELEASE_CHECKLIST.md:161-173: the §7 checks "need online payment switched on and Moyasar in live mode … part of the small live payment in OWNER_ACTIONS.md §47.18".
  - §47.18 step 1 is turning online payment on, and step 2 is that device check.
  - The sandbox cannot show Apple Pay at 1.00 SAR (PAYMENTS.md:548-550).
- Correction: replace the bracket with "[OWNER DECISION: either (a) publish 2.1 without the three Apple Pay mentions and add them in a later version once the §47.18 device check passes (recommended), or (b) keep all three only hedged ('where the app offers it') and accept they are unverified at publication]". If (b), hedge "or use Apple Pay" in PAYING ONLINE paragraph 1 [L145/L174] too.

SHOULD-FIX

S1. "It is offered in the app on iPhone and Android, not in the web version of the app." [L138/L167]
- This is unconditional, so it is false while online_payment_enabled is false (live) or the gateway is in TEST mode (payment-initiate refuses). That breaks the header's claim "it stays true if it is published while online payment is still off. Publishing early is safe" [L21-23].
- Correction:
  - EN: "Where it is offered, online payment is available only in the app on iPhone and Android, not in the web version of the app."
  - AR: «وحيث يُتاح الدفع الإلكتروني، فإنه يتوفر في التطبيق على iPhone وAndroid فقط، ولا يتوفر في نسخة الويب من التطبيق.»

S2. "Your card details go to Moyasar, not to us" [L145; AR «وتصل بيانات بطاقتك إلى Moyasar لا إلينا» L174] overstates it.
- Our server does receive card details from Moyasar's API: a masked number with the BIN (first six digits) and last four, the cardholder name and the payer's IP. It then discards them (moyasar.ts:726-741; fixture and test in moyasar.test.ts:647-676: "drops the BIN, the token, the name and the payer IP"). It keeps scheme, last four, issuer name and country (moyasar.ts:742-768).
- Correction, matching the privacy draft L232:
  - EN: "You enter your card details on Moyasar's page, not in our app, so your full card number and security code never reach us and we never store them."
  - AR: «وتُدخل بيانات بطاقتك في صفحة Moyasar لا في تطبيقنا، فلا يصل إلينا رقم بطاقتك كاملاً ولا رمز الأمان، ولا نخزّنهما في أي حال.»

S3. "Our record of an online payment shows the card type and the last four digits of the card" [L151] reads as a complete list, and it is not.
- The record also keeps issuer bank name and country, authorisation code, reference number, response code and decline message (moyasar.ts:756-765). The privacy draft L170 lists all of these.
- EN "shows" against AR «يتضمن» ("includes") is a mismatch between the languages.
- Correction:
  - EN: "Our record of an online payment includes the card type (for example mada or Visa) and the last four digits of the card, never your full card number. Our Privacy Policy, which also names Moyasar, lists everything we keep and what we share with it."
  - AR: «ويتضمن سجلّنا للدفعة الإلكترونية نوع البطاقة (مثل مدى أو Visa) وآخر أربعة أرقام منها، ولا يتضمن رقمها كاملاً في أي حال. وتذكر سياسة الخصوصية Moyasar أيضاً، وتبيّن كل ما نحتفظ به وما نشاركه معه.»

S4. An [OWNER DECISION] marker is missing on "Any refund of an online payment goes back to the card you paid with" [L150/L179].
- The draft's own open decision 5 [L323-327] leaves this open. The sibling draft brackets the same point as D4 (docs/legal/CANCELLATION_REFUND_POLICY_CARD_PAYMENTS_DRAFT.md:156, :289) and words it as "card or payment method you paid with, through … Moyasar".
- Today the code has only the card route (moyasarRefund.ts:260-262), so the sentence is true now. If D4 allows cash at the branch, the two documents contradict each other.
- Correction: append "[OWNER DECISION (refund policy D4): keep only if a card-paid refund is never settled in cash at the branch]", and align the wording with the refund draft.

S5. The method list has no publish precondition.
- Quoted: "Online payment accepts mada, Visa and Mastercard cards, and Apple Pay" [L138].
- This rests on the owner's statement (PAYMENTS.md:15), not on code; the invoice request has no method field. SADAD and STC Pay are unconfirmed (OWNER_ACTIONS §47.19). A SADAD bill sits `on_hold` for days and cannot be refunded (PAYMENTS.md:635-637), which would falsify "no payment is taken" and "goes back to the card" for that method.
- Correction: add "[OWNER DECISION: publish this list only after Moyasar confirms SADAD, STC Pay and any unlisted scheme (e.g. American Express) are off for invoices; otherwise say 'by card or Apple Pay' and name the extra method]".

S6. The "money taken but no order" sentence gives the customer nothing to quote, and the two drafts disagree on the refund promise.
- Quoted: "contact us using the details below. [OWNER DECISION: add 'We will refund …']" [L149].
- In this case there is no order number, but the live Contact & Support page asks for one.
- The refund draft already promises the refund, without a bracket: "we will refund it once we have confirmed it with Moyasar" (cancellation_refund_policy.md:160). It also asks for "the date, time and amount" and says "Never send us your full card number".
- Correction:
  - EN: "…contact us using the details below, with the date, time and amount of the payment (and your order number if you have one). Never send us your full card number."
  - AR: «…فتواصل معنا عبر بيانات التواصل أدناه، مع ذكر تاريخ الدفعة ووقتها ومبلغها، ورقم الطلب إن وُجد. ولا ترسل إلينا رقم بطاقتك كاملاً أبداً.»
  - Decide the refund promise once (D2 and D3) and use the same wording in both documents.

NITS

N1. Version: this draft proposes 2.1 [L113], while the refund draft proposes 3.0 for the same kind of change (cancellation_refund_policy.md:255). Mark it [OWNER DECISION] and decide it for the whole set.

N2. "basket" [L148]: the app says "cart" ("My Cart", "Add to Cart"; strings.ts:149-152). The AR «سلتك» is already right.

N3. "online when you place the order" [L137] and "When you choose it, the app opens…" [L145]: the payment comes before the order exists, and the page opens on Place order, not on choosing the method. Suggest "online, as part of placing your order" and "When you place an order with online payment, the app opens…".

N4. "you receive an order number on confirmation" [L147]: the receipt shows only the branch's number, once the POS issues it (ReceiptScreen.tsx:12-14). For online orders the POS hand-off after confirmation is best-effort (moyasarVerify.ts:478-487). Suggest "you receive the branch's order number once the branch accepts the order".

N5. EN "for the total confirmed at checkout" [L146] lacks "by our system", which the AR has («يؤكده نظامنا», L175). Use the PRICES AND VAT wording in EN.

N6. Arabic nuances:
- «فلا نتلقى … ولا نخزّنهما في أي حال» [L174]: "في أي حال" (never) attaches only to storing; the EN says "never receive".
- In AR HOW YOU PAY [L166], the comma chain makes «أو إلكترونياً» read as a third cash sub-option.
- Flag both for the native reader.

N7. "as with a cash order" [L147] can be read as also extending the cash section's printed-invoice promise, which the draft deliberately did not extend. Rephrase so it clearly covers only the number and the Orders tab.

N8. Evidence table, not text: row 13 cites moyasarVerify.ts:182-183/:197-198, which is the duplicate-payment helper. The ordinary card_scheme and card_last_four writes are at :332-333, :375-376 and :473-474.

N9. For information only: an order-first online path still exists through the API. place_customer_order is executable by authenticated users (live) and forwards p_payment_method, and place_order accepts 'online' when it is on. payment-initiate still serves the order flow. "Until then there is no order" therefore holds only because no app build uses that path. No text change; this is for the code owners.

Verified, no finding:
- PRICES AND VAT, PAYING IN CASH and CONTACT are byte-identical. Rebuilding live text from the draft's whole-document blocks gives 0f883dcd595250c2a6139d267a55008c / 44e5b1f44f5a6ae8bb72e53eb9daefe9, and the span hashes match live (5ea1459e…/635, 23beff8e…/559, dfae48ec…, d2b164ce…). Method: a local check script, not kept.
- The live baseline is v2.0, and payment row is moyasar, enabled, test, SAR, 30, no descriptor.
- Payments are in SAR, and the 1.00 minimum is enforced in code and in live begin_session_attempt and begin_payment_attempt.
- An order is confirmed only after a server fetch bound to invoice id, amount and currency.
- Nothing is sent to the branch before then; there are no notifying triggers on checkout_sessions.
- Refunds use only POST /v1/payments/{id}/refund.
- The invoice carries no name, phone or email.
- "Checked directly with Moyasar" holds: the proxy is a CONNECT tunnel (moyasarHttp.ts:26-29).
- The web build hides online payment (payment.ts:45-55).
- A decline or an expiry is terminal, and the cart is kept.

Outside this draft: live offers_loyalty_terms v2.2 says "Points are added when you place the order, and your balance updates immediately". But place_order, insert_order_from_snapshot and admin_set_order_status all write earn_pending (live), so that sentence is already wrong. It is worth adding to the card go-live set.

VERDICT: Not publishable as drafted. Four blocking issues: the T&C still say cash only and are outside the publish set; "use fewer points" is impossible and contradicts the live Loyalty Terms; "choose cash" after closing the page is not kept by the app; and the Apple Pay decision cannot be settled before the deadline. There are six should-fixes; the untouched sections are verified byte-identical to live.