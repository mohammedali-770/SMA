# Fact-check of the store answers draft, 2026-11-13

> **Point-in-time evidence, kept for provenance.** An independent check of an
> earlier version of the store answers draft (`docs/store/CARD_PAYMENTS_STORE_ANSWERS_DRAFT.md`), made on 2026-11-13 against the
> code, the live database (read-only) and the cited pages. Line numbers such as
> "Draft L234" refer to that earlier version, not to the file as merged. Every
> finding is answered in the draft's Fix log: what was changed, and why where a
> finding was not applied as written. Read the draft for the current text.

FACT-CHECK: the Proposed text in the store answers draft (EN and AR)

Paths: DRAFT = docs/store/CARD_PAYMENTS_STORE_ANSWERS_DRAFT.md. DB = the repository root, at the default branch `04eb351`. All SQL was read-only. I did not edit the draft and did not read or print any secret.

BLOCKING

B1. The live Terms & Conditions still say cash only, and no draft or runbook step updates them.
- Draft text: the C-CARD row (DRAFT:369): "card payment in the app: mada, Visa or Mastercard …", with "all three:" as its conditions. Also the listing card lines (DRAFT:424, :471), the release notes, and the review notes "or pay by card in the app at checkout" (DRAFT:766).
- Evidence (live `legal_documents`): `terms_conditions` v2.0, md5_en 0da66433…, says "PAYMENT — Orders are paid in cash at pickup or on delivery. See the Payment Policy." The Arabic says «تُدفع الطلبات نقداً عند الاستلام أو عند التوصيل». The listing itself points readers at the "terms" (LISTING_COPY.md:126, 165).
  - No terms draft existed yet.
  - DB/docs/OWNER_ACTIONS.md:4173-4188 (§47.15) lists privacy, payment and cancellation, but not terms.
  - The draft's own "Read with" and Versioning sections name only privacy 2.4 and payment 2.1.
  - Live `payment_policy` 2.0 and `cancellation_refund_policy` 2.0 also say "Online card payment is not … available in the app".
- Fix: add to C-CARD's "What must be true", to 1.2 and to 3.3:
  "`terms_conditions`, `payment_policy`, `cancellation_refund_policy` and `privacy_policy` each have a published version that describes card payment, and the public legal page has been rebuilt to serve them."
  Draft a terms PAYMENT clause [OWNER DECISION, native read]:
  - EN: "Orders are paid in cash at pickup or on delivery, or online in the app through Moyasar where that option is shown at checkout. See the Payment Policy."
  - AR: «تُدفع الطلبات نقداً عند الاستلام أو عند التوصيل، أو إلكترونياً داخل التطبيق عبر Moyasar حيث يظهر هذا الخيار عند إتمام الطلب. انظر سياسة الدفع.»
  Also add `terms_conditions` to §47.15.

B2. The review notes say our servers never receive the card details. The code shows they do.
- Draft text (DRAFT:776-777): "The app's code never reads the card details, and our servers never receive them."
- Evidence:
  - The server fetches Moyasar's full payment object: DB/supabase/functions/_shared/moyasarVerify.ts:297-298 and :331-333.
  - That object contains the masked number with its first six digits, the cardholder name, a token and the payer IP. See the fixture and the "drops the BIN, the token, the name and the payer IP" test at DB/supabase/functions/_shared/moyasar.test.ts:647-675.
  - The server keeps the scheme, last four and issuer: moyasar.ts:742-768.
  - The same submission's label says Payment Info = YES, Linked (DRAFT:634, :647). A reviewer would read two contradictory statements.
- Fix: "The card number, expiry date and security code are entered only on Moyasar's page. The app's code never reads them and our servers never receive them. After a payment, Moyasar tells our server the card type, the last four digits and the issuing bank, which we keep with the payment record."

B3. The review notes say one checkout can never be paid twice. The code handles exactly that case.
- Draft text (DRAFT:783-785): "…so one checkout can never be paid twice. Once it expires, cash can be chosen."
- Evidence:
  - moyasar.ts:930-934 ("a second settled payment on the same invoice, which is recorded as a duplicate") and :962-975.
  - moyasarVerify.ts:144-263 (recordDuplicatePayment).
  - DB/docs/PAYMENTS.md §10 (lines 573-592: "a payment on an older invoice that settles late, or two payments confirmed at the same moment") and §12 (lines 665-673).
  - OWNER_ACTIONS.md:4284 ("If a customer pays twice for one order or checkout session…").
  - The sibling docs/legal/PAYMENT_POLICY_CARD_PAYMENTS_DRAFT.md:149 tells customers what to do "if … you are charged twice for one order".
- Two smaller points in the same sentence:
  - The window is the configured invoice expiry, not a fixed 30 minutes. Live `invoice_expiry_minutes` is 30, bounded 5-60 (moyasar.ts:259-260). The attempt expiry is set from now() and is not capped by the session (20261003120000_moyasar_only_payments.sql:253).
  - Cash can be *selected* at any time. What is blocked is *placing* any order (CheckoutScreen.tsx:721-733).
- Fix: "If you then try another order before that payment page expires (30 minutes as configured today), the app reopens the same payment page instead of starting a second checkout, which is how it avoids a second payment for the same order. Once the page expires, any order, cash included, can be placed."

SHOULD-FIX

S1. The C-CARD conditions are incomplete.
- Draft text: "all three: …" (DRAFT:369) and "Card payment needs `online_payment_enabled` and an enabled Moyasar row in live mode" (DRAFT:377-379).
- Evidence:
  - Without a live `sk_live_` key and a webhook token, payment-initiate answers "Online payment is not available" (moyasar.ts:264-269; payment-initiate/index.ts:414-416).
  - In live mode the proxy and Allowed IPs are also required (moyasarHttp.ts:5-18).
  - The console switch does not check the keys (OWNER_ACTIONS.md:4167-4171).
- Fix: add "…and §47.13's Test connection in LIVE mode reads 'Connection OK' (live secret key and live webhook token saved, `MOYASAR_PROXY_URL` set, proxy IPs on Allowed IPs)."

S2. The card brands rest only on the owner's verbal answer.
- Draft text: "mada, Visa or Mastercard" (C-CARD, listing, notes).
- Evidence: the only source is the owner's answer (PAYMENTS.md:15). No device check in RELEASE_CHECKLIST.md:161-198 confirms which methods the live page shows. §47.19 still asks Moyasar to confirm that STC Pay and SADAD are off.
- Fix: add "the live hosted page, seen on a device, offers mada, Visa and Mastercard" to C-CARD and to the §7 device checks.

S3. The Apple form has no "optional" answer, and the draft's own 3.2 rules optional disclosure out.
- Draft text: "Payment Info | Yes, optional (online payment only)" (DRAFT:634).
- Evidence: 3.2 (DRAFT:673) says "It is not optional to disclose either." Apple's form has no optional or required question.
- Fix: "Yes (only when the customer pays online)".

S4. The privacy-policy publish rule ignores that stores read a build-time snapshot.
- Draft text: "Publish that version no later than the day these answers change." (DRAFT:702-703; decision 6).
- Evidence: what Apple and Google read is the no-JavaScript snapshot, which changes only on a rebuild. OWNER_ACTIONS.md:2647-2675 says: "A legal correction is two steps, not one".
- Fix: "Publish that version, rebuild the public legal page (merge to the default branch) and confirm https://app.spicymeal.com.sa/privacy serves it without JavaScript, no later than the day these answers change."

S5. "Optional" for Play is not true for every user.
- Draft text: "Optional while cash is offered" (DRAFT:548, :572).
- Evidence:
  - Google, answer 10787469 (fetched): optional is allowed "only if all users can either optionally provide information, opt-out, or opt-in".
  - Cash goes through `place_customer_order`, which refuses non-phone-verified profiles and customers over the open-order or hourly limits.
  - The online path does neither. 20261005120000_server_input_bounds.sql:61-68 says "the phone rule and the order limits do not cover online orders". Live check: `begin_checkout_session` has no `phone_verified` or `order_limit_open` check; `place_customer_order` has both.
  - So for those customers, card is the only way to order.
- Fix: add the same checks to the online path before go-live [OWNER DECISION], or answer Required.

S6. Card data is not kept only "with the order".
- Draft text: "linked to the order … kept with the order" (DRAFT:548, :634).
- Evidence: every verify writes the sanitized card fields to the attempt row, including declined or abandoned session attempts that never get an order (moyasarVerify.ts:306-310, :524). Those rows hang off `checkout_session_id` (live FK, ON DELETE CASCADE).
- Fix: "kept with the payment record, linked to the order, or for a payment that did not complete (for example a declined card) to the checkout session, and so to the account".

S7. The OFF variant of the review notes keeps present-tense card-payment text.
- Draft text: "Keep the 'Payment' and 'Card payment' paragraphs" (DRAFT:821-822).
- Evidence: those paragraphs say "it is paid through a payment provider" and "the customer chooses Online Payment or cash". The same notes then say "no customer can use it; customers pay cash".
- Fix: begin both paragraphs "When card payment is switched on, …", and title the second "Card payment (switched off at the time of this submission)".

S8. Ticking the payments financial feature may not "cost little".
- Draft text: "ticking Mobile payments and digital wallets as well costs little: Google asks for documents only for loan features" (DRAFT:622-624).
- Evidence: Google (answer 13634885, fetched) requires an Organization developer account for "Financial products and services, including …". This app's account is personal (PLAY_STORE_SUBMISSION.md:86).
- Fix: drop "costs little". Say that declaring it may bring the organization-account requirement, and to check that first.

S9. The data export becomes incomplete once card payment is on. This knock-on is missing.
- Draft text: the listing line "Request a copy of your data" stays unchanged (DRAFT:430, :477).
- Evidence: live `export_my_data` says "Everything Spicy Meal holds about you that is personal to you" (20260912120000_export_my_data.sql:72), but its live body mentions `payment_records` 0 times.
- Fix: add to "Knock-on edits": "export_my_data must return the customer's payment records (card type, last four, issuer, status, amount) before card payment is switched on".

S10. The cardholder name does reach our server. This is outside the Proposed text, but the Name rows rest on it.
- Draft text: "that name goes to Moyasar and never to us" (DRAFT:991).
- Evidence: moyasar.test.ts:652 (`name: 'SARA A'`) and :668-675.
- Fix: "…Moyasar returns it to our server in its payment object, and sanitizeMoyasarPayment drops it, so it is never stored."

NITS

N1. The proxy route is stated as fact.
- Draft text: "The server's calls to Moyasar go through the static-IP proxy as a CONNECT tunnel" (DRAFT:555).
- Evidence: PAYMENTS.md §8.1 and §12 call proxy support on hosted Supabase unproven until the live Test connection. The route applies only when `MOYASAR_PROXY_URL` is set. The "Yes" answer stands, because the code fails closed.
- Fix: "When `MOYASAR_PROXY_URL` is set, which live mode requires, …"

N2. TestFlight step 8 lacks a lock-out warning, and decision 5 misses it.
- Draft text: step 8 (DRAFT:746-749).
- Evidence: closing the payment page without paying blocks every order on that device, cash included, until the page expires (CheckoutScreen.tsx:721-733).
- Fix: add "…closing it without paying blocks new orders on this device for about 30 minutes." Also add step 8's Apple Pay clause to decision 5's list.

N3. The stated purpose overstates what the card fields are used for.
- Draft text: "To confirm, reconcile and refund the payment" (DRAFT:573).
- Evidence: confirmation binds on `invoice_id`, amount and currency (moyasar.ts:900-920). Refunds use `provider_ref`. The card fields are shown to staff (PaymentDetails.tsx:91).
- Fix: "to show staff which card paid, for reconciliation and customer support".

N4. The Arabic phrasing varies, and decision 12 misdescribes the footer.
- Draft text: «عبر صفحة Moyasar الآمنة» (1.4, Variant B) beside «من خلال صفحة Moyasar الآمنة» (3.6), and decision 12's "repeats the app's footer" (DRAFT:1082).
- Evidence: the footer reads «في صفحة Moyasar الآمنة» (checkout.tsx:221).
- Fix: harmonise, or correct decision 12.

N5. One TestFlight Arabic sentence is slightly narrower than the English.
- Draft text: «والدفع الإلكتروني يخصم المبلغ من البطاقة فعلياً» against "Online payments are real charges".
- Fix (optional): «والدفع الإلكتروني عملية دفع حقيقية».

N6. The guideline cited for describing a dormant feature.
- Draft text: "guideline 2.5.19 asks for the dormant feature to be described" (DRAFT:822).
- Evidence (fetched): 2.5.19 *prohibits* hidden, dormant or undocumented features. The rule that asks for features to be described in Notes for Review is 2.3.1(a).
- Fix: cite both.

N7. The three records disagree on what Moyasar receives.
- Draft text: Apple Purchase History says "the amount and an opaque order reference" (DRAFT:633).
- Evidence: the Play row lists more, including return URLs that carry the full order or session UUID (payment-initiate:265-266). The privacy draft (docs/legal/PRIVACY_POLICY_CARD_PAYMENTS_DRAFT.md:233) also lists the page language.
- Fix: align the three.

N8. Some owner choices lack markers.
- Draft text: the 2.3 table rows "shared? No", "ephemerally? No" and "Optional", and 2.1's "Yes, OPTIONAL".
- Evidence: decision 2 calls these recommendations, but the rows carry no [OWNER DECISION] marker.

N9. The TestFlight switch-off instruction has no replacement text.
- Draft text: "put the cash-only sentence back" (DRAFT:726-727).
- Evidence: the old sentence begins "Payment at launch…", which is wrong after a card launch.
- Fix: supply "Payment is cash on collection or delivery; card payment is switched off."

N10. The switch-off rule contradicts the draft's own release-notes logic.
- Draft text: "take the C-CARD line out … of the release notes" (DRAFT:385).
- Evidence: 1.5 says release notes stay attached to their release.
- Fix: "…and leave it out of the next release's notes".

N11. The TestFlight description covers older builds too.
- Draft text: "inside the app" (DRAFT:714).
- Evidence: the description applies to every build in TestFlight. Older builds open the system browser (PAYMENTS.md:313-315).

VERIFIED, NO FINDING
- Live baseline matches the draft: online payment off; cash on; default cash; outage off; pickup-only loyalty on; expiry off; payment row Moyasar, enabled, mode test, updated 2026-11-13 18:17:02, invoice expiry 30. All four `legal_documents` versions and md5s match.
- Listing, release-note, TestFlight and review-note diffs change only payment lines. All stated character counts reproduce (1432/1270/467/426/135/146/98/113; current 1349/1183).
- Every code citation checked is accurate:
  - the invoice payload and its fixed description;
  - the references;
  - the return URLs;
  - the POS receiving only the amount, the payment id and a constant Card_Type 'card';
  - the sanitizer fields;
  - the TEST-mode refusals;
  - the 1.00 SAR minimum;
  - what checkout shows.
- Every Arabic string says the same as its English (beyond N4 and N5).
- No proposed text promises refunds or timings.
- External quotes fetched and confirmed:
  - Google: the "renamed to User payment info" note, the payment-service FAQ, the webview rule, the optional rule, and the sharing exceptions.
  - Google: the financial features list and the "management or investment of money" scope.
  - Apple: the Payment Info wording, web traffic, optional disclosure, updating answers, and guidelines 2.5.19, 3.1.3(e) and 4.9.
  - Apple: the Apple Pay marketing text.

VERDICT: Not ready to publish. Fix the 3 blocking issues first: live Terms still say cash only with no update planned; the review notes say our servers never receive card details; the review notes promise a checkout can never be paid twice. Fix the should-fix items before the owner enters anything.