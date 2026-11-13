# Fact-check of the privacy policy draft, 2026-11-13

> **Point-in-time evidence, kept for provenance.** An independent check of an
> earlier version of the privacy policy draft (`docs/legal/PRIVACY_POLICY_CARD_PAYMENTS_DRAFT.md`), made on 2026-11-13 against the
> code, the live database (read-only) and the cited pages. Line numbers such as
> "Draft L234" refer to that earlier version, not to the file as merged. Every
> finding is answered in the draft's Fix log: what was changed, and why where a
> finding was not applied as written. Read the draft for the current text.

FACT-CHECK: docs/legal/PRIVACY_POLICY_CARD_PAYMENTS_DRAFT.md ("Proposed text", EN and AR)

All code paths below are relative to the repository root, at the default branch `04eb351`. "Draft L###" means a line number in the draft. All Production reads were read-only SQL on 2026-11-13. I wrote nothing to Production and did not edit the draft. The only file I created was a local line-hash script, not kept.

BLOCKING

1. [blocking] A payment-record retention promise the code does not keep
- Quoted: Draft L234 "…and we keep the payment record to meet our legal obligation to keep financial records." AR L335 "ونحتفظ بسجل الدفع للوفاء بالتزامنا النظامي بحفظ السجلات المالية." Read together with the unchanged HOW LONG line "Orders, invoices and financial records: … including after you delete your account."
- Evidence:
  - Live FK `payment_records_checkout_session_id_fkey` is ON DELETE CASCADE. Live `checkout_sessions_customer_id_fkey` is also ON DELETE CASCADE.
  - Live `anonymize_account_data` (md5(prosrc) c44b5c79…) runs `delete from public.checkout_sessions where customer_id = p_user_id` with no status filter (supabase/migrations/20260919120000_security_audit_db_hardening.sql:88).
  - Live `finalize_checkout_session` (md5 870de938…) keeps `checkout_session_id` (20260712170000_checkout_sessions_hardening.sql:362-372).
  - The app pays only through checkout sessions (apps/mobile/src/services/api.ts:475).
  - So every app card payment's record is deleted when the account is deleted. The order survives, anonymised.
  - The live `account_data_deletion` v2.0 is also contradicted. It says only "Your open checkout sessions" are deleted, and "We keep completed order and financial records".
  - docs/RECORD_OF_PROCESSING.md:63 ("Account deletion does not clear it") is wrong.
  - The draft's decision #5 says "The privacy wording does not need to wait for this". This sentence refutes that. The draft's HOW LONG line survives only because it is worded as a maximum.
- Corrected wording, if the code stays as it is:
  - EN: "We use online payment to complete the order you asked for, and we keep a record of each payment with your order."
  - AR: "ونستخدم الدفع الإلكتروني لإتمام الطلب الذي طلبته، ونحتفظ بسجل كل دفعة مع طلبك."
  - HOW LONG, EN: "Payment records: while your account is open, and never longer than the order they belong to. They are deleted when you delete your account, and they never contain your full card number."
  - HOW LONG, AR: "سجلات الدفع: طوال بقاء حسابك مفتوحاً، ولا نحتفظ بها مدةً أطول من الطلب الذي تخصّه. وتُحذف عند حذف حسابك، ولا تتضمن رقم بطاقتك كاملاً في أي حال."
- If the owner decides records must survive deletion (decision #5): fix the cascade before §47.18, keep the draft's sentence, and correct `account_data_deletion` and the record of processing. Either way, put an [OWNER DECISION] marker on both sentences.

2. [blocking, publishing plan] Publishing this alone contradicts a live document
- Quoted: Draft L231 / AR L332 "through Moyasar, our payment provider". Draft L212 / AR L313 "Moyasar — our provider for online payment…". Header L22 "Publishing early is safe". Header L11 "The English can go first".
- Evidence:
  - Live `payment_policy` v2.0 (md5_en 0f883dcd…) says: "We have not yet selected an online payment provider. If we add card payment, we will name the provider in this policy and in the Privacy Policy before the option appears in the app."
  - Live `cancellation_refund_policy` v2.0 says: "Where a refund is due, it is settled in cash at the branch". The draft says "Moyasar … makes any refund".
  - The live Arabic v2.3 says card payment is unavailable («والدفع الإلكتروني بالبطاقة غير متاح») and promises to name the provider before the option appears. An English-only publish followed by §47.18 would break that promise for Arabic readers. The §43 precedent covered a gap that already applied, not a promise with a deadline.
- Correction: publish `privacy_policy`, `payment_policy` and `cancellation_refund_policy` together, in both languages, in one session, all before §47.18. Never publish this text alone, or in English only.

SHOULD-FIX

3. [should-fix] Apple Pay is promised outside its condition, and it has no [OWNER DECISION] marker
- Quoted: Draft L231 / AR L332 "Where the app offers online payment, you can also pay with a mada, Visa or Mastercard card, or with Apple Pay…".
- Evidence:
  - Builds already in customers' hands open the system browser in LIVE mode, without Apple Pay (docs/PAYMENTS.md:313-315; OWNER_ACTIONS.md §47.17).
  - `enableApplePay` is iOS only (apps/mobile/src/app/payment/checkout.tsx:179,187).
  - Apple Pay inside the WebView is unconfirmed by Moyasar (PAYMENTS.md:308-311, §11 Q1).
  - The draft's own decision #4 says "where the app offers it" keeps the text true. The actual condition is "offers online payment", which does not cover Apple Pay.
  - The sibling draft (docs/legal/PAYMENT_POLICY_CARD_PAYMENTS_DRAFT.md:138) already says "Apple Pay on iPhone where it is shown" behind an [OWNER DECISION] bracket.
  - The list of methods is the owner's statement only (PAYMENTS.md:15). That SADAD and STC Pay are off is unconfirmed (§47.19).
- Corrected wording:
  - EN: "Where the app offers online payment, you can also pay through Moyasar, our payment provider, with a mada, Visa or Mastercard card, or with Apple Pay on iPhone where the app shows it. [OWNER DECISION: keep the Apple Pay clause and the Apple Pay sentence below only if the Apple Pay device check in RELEASE_CHECKLIST.md §7 passes; otherwise delete both, as in payment_policy]"
  - AR: "وحيث يتيح التطبيق الدفع الإلكتروني، يمكنك أيضاً الدفع من خلال Moyasar، مزوّد الدفع لدينا، ببطاقة مدى أو Visa أو Mastercard، أو عبر Apple Pay على iPhone حيث يظهر خياره. [OWNER DECISION: …]"

4. [should-fix] Lazywait receives payment data, and the draft does not say so
- Quoted: Draft L211 / AR L312, unchanged: "Lazywait — … which receives your order so the kitchen can prepare it". This sits beside "We share only what each provider needs".
- Evidence:
  - After every confirmed payment, supabase/functions/_shared/moyasarVerify.ts:479-487 calls `pushLazywaitOnlinePayment`.
  - That function (supabase/functions/_shared/paymentSync.ts:62-73) POSTs `/pos/orders/update-online-payment` with `Trans_Amount`, `Approval_No` (the Moyasar payment id) and `Card_Type: 'card'`.
  - Neither the record-of-processing entry for ordering (RECORD_OF_PROCESSING.md:51) nor the one for card payment (:63) lists this.
- Corrected wording (a seventh replace() per language):
  - EN: "Lazywait — the point-of-sale system in our branches, which receives your order so the kitchen can prepare it and, if you pay online, the amount paid and Moyasar's reference for the payment."
  - AR: "Lazywait — نظام نقاط البيع في فروعنا، ويستقبل طلبك ليتمكن المطبخ من تحضيره، وعند الدفع الإلكتروني يستقبل أيضاً المبلغ المدفوع والرقم المرجعي للدفعة لدى Moyasar."

5. [should-fix] No retention is stated for payment attempts that never became an order
- Quoted: Draft L243/L252 "Payment records: no longer than the order they belong to." AR L344/L353.
- Evidence:
  - Attempts are created with a checkout session and no order (20261003120000_moyasar_only_payments.sql:306-313).
  - A declined card leaves the attempt open and writes the sanitized payment into `raw`: card company, last four, issuer, decline message (moyasarVerify.ts:306-310, 524, 565-571).
  - Nothing purges sessions or payment records except account deletion (and one zero-total path, 20260826110000:172). Live `cron.job` has no such job.
  - Live: 6 payment records with only a session link, and 5 expired sessions with no order from 2026-07-13 to 07-15, are still present.
  - WHAT WE COLLECT explicitly includes "the reason, if it is declined", so these rows are in the disclosed category but outside the stated retention.
- Correction: Finding 1's line covers it. If the owner keeps records instead:
  - EN: "Payment records: kept with the order they belong to, for as long as the order is kept. A payment that did not complete an order, such as a declined card, is kept while your account is open. They never contain your full card number."
  - AR: "سجلات الدفع: نحتفظ بها مع الطلب الذي تخصّه طوال مدة الاحتفاظ به. أما الدفعة التي لم يكتمل بها طلب، مثل بطاقة مرفوضة، فنحتفظ بسجلها طوال بقاء حسابك مفتوحاً. ولا تتضمن رقم بطاقتك كاملاً في أي حال."

6. [should-fix] The Terms and Conditions are missing from the publish set
- Evidence:
  - Live `terms_conditions` v2.0 says "PAYMENT / Orders are paid in cash at pickup or on delivery. See the Payment Policy." (AR line 17: «تُدفع الطلبات نقداً عند الاستلام أو عند التوصيل. انظر سياسة الدفع.»)
  - OWNER_ACTIONS.md §47.15 and the draft's decision #8 omit this document. It contradicts the new PAYMENT text as soon as §47.18 runs.
- Corrected wording, and add the document to §47.15:
  - EN: "You can pay in cash at pickup or on delivery, or, where the app offers it, online through Moyasar. See the Payment Policy."
  - AR: "يمكنك الدفع نقداً عند الاستلام أو عند التوصيل، أو إلكترونياً من خلال Moyasar حيث يتيح التطبيق ذلك. انظر سياسة الدفع."

7. [should-fix] "WHERE YOUR DATA IS PROCESSED … is true either way" is not established
- Quoted: the unchanged paragraph "…we rely on the data protection commitments in our contract with that provider", and draft L385-386.
- Evidence:
  - Where Moyasar processes data is "Unknown from here" (RECORD_OF_PROCESSING.md:81).
  - Nobody has read the Moyasar agreement (the draft's own "could not verify" list, item 1).
  - Adding Moyasar to "the providers listed above" turns this sentence into a claim about that agreement.
- Correction: no wording change if confirmed. Add a pre-publish gate: "[OWNER DECISION: confirm from the Moyasar agreement that processing stays in the Kingdom, or that the agreement carries data-protection commitments; if neither, counsel rewords this paragraph]".

NITS

8. [nit] Cash is stated as always available
- Quoted: Draft L231 "You can pay in cash at pickup or on delivery."
- Evidence: `cash_payment_enabled` is an admin switch. It is live true, and `place_order` enforces it (20260709140000_payment_methods.sql:26,167). The app treats cash as "NEVER assumed" (apps/mobile/src/lib/payment.ts:6). If cash is off, this sentence and "if you choose to pay that way" become false.
- Suggested: "Where the app offers it, you can pay in cash at pickup or on delivery." AR: «وحيث يتيح التطبيق ذلك، يمكنك الدفع نقداً عند الاستلام أو عند التوصيل.»

9. [nit] The Arabic says "keep" where the English says "collect"
- EN L170 "Never your full card number." sits under WHAT WE COLLECT. AR L271 «ولا نحتفظ أبداً برقم بطاقتك كاملاً» means "we never keep".
- Fix: «ولا نجمع رقم بطاقتك كاملاً أبداً.»

10. [nit] "The language the page is shown in"
- The language is not in the invoice request (payment-initiate/index.ts:34-35). It is only a `lang` parameter on the page URL (moyasar.ts:384), and whether Moyasar honours it is unknown (PAYMENTS.md:161-162, §11 Q5).
- Suggested: "the language you use the app in" / «ولغة استخدامك للتطبيق».

11. [nit] "Apple handles the payment on your device"
- The draft's own WHO line says Moyasar takes the payment. Apple Pay only supplies the card.
- Suggested: "If you use Apple Pay, your card reaches Moyasar through Apple Pay, under Apple's own terms." AR: «وإذا استخدمت Apple Pay، فتصل بطاقتك إلى Moyasar عبر Apple Pay وفق شروط Apple.»

12. [nit] Data the Payment line does not list
- Moyasar's replies to our server carry the first six card digits and the payer's IP address. The sanitizer discards them (moyasar.ts:740, 742-769).
- Stored but not listed: the payment method type (card or Apple Pay) and Moyasar's fee.
- "Never your full card number" still holds. Optional sentence: "Moyasar's reply to us also carries the first six digits of the card and your IP address; we discard them."

13. [nit] Arabic for the native read
- Moyasar is masculine in the WHO line («ويتولى») and feminine in the HOW LONG bracket («وتحتفظ Moyasar بسجلها … منها بوصفها»).
- Decision #7 (whether to write ميسر) has no [OWNER DECISION] marker in the Arabic text.

14. [nit, code follow-up] The in-app data copy leaves out the new category
- The unchanged YOUR RIGHTS section promises "give you a copy". The live `export_my_data` reads no `payment_records`, `checkout_sessions` or `order_refunds` (checked against the live function body).
- The text stays true, because it says "ask us". The in-app copy should include payment records.

15. [nit, outside the proposed text] The draft's unverified proxy claim (#4) can be narrowed
- moyasarHttp.ts:133 builds the proxy client with no custom certificate authority. A proxy that tried to decrypt the traffic would fail the certificate check, so the request would fail rather than be read.
- The recommended QuotaGuard Shield is a pass-through tunnel that cannot read the traffic (proxy_comparison.md:315-320).

VERIFIED TRUE (survived refutation)
- Live baseline: `privacy_policy` v2.3, effective 2026-09-16, the only row. md5_en d3e760c5… (4623 chars), md5_ar d2acff96… (3744 chars).
- All 88 distinct lines of the Proposed text were hashed with md5 and matched against the live lines. Every line not marked new matches live, in order and contiguous (EN and AR lines 9-17, 19-26, 31-41, 43, 49-53). The only new lines are the intended ones. No unrelated sentence changed.
- The invoice body is exactly: amount, currency, "Spicy Meal order", return URLs carrying the order or session UUID, expiry time, and metadata `sm_<uuid>` and `CS-`/`ORD-` plus 12 hex digits. No customer field, and no extra metadata at either call site (moyasar.ts:336-354; payment-initiate/index.ts:258-268, 456, 529; 20261003120000:306-313).
- The refund body is `{amount}` (moyasarRefund.ts:261). Every other Moyasar call sends ids only.
- Card number and security code never reach the server. The WebView injects no JavaScript (checkout.tsx:153-190). Only https URLs on moyasar.com are handed to the app (moyasar.ts:373-386).
- The stored fields match the Payment line, with last four digits only (moyasar.ts:732, 742-769). Live `payment_records` has no name, phone, IP or customer column.
- The web build never offers online payment (payment.ts:45-55).
- No refund timing or automatic-refund promise appears in the text.
- [OWNER DECISION] markers are present for both line-1 dates and the Moyasar-retention sentence.
- Apart from items 9 and 13, the Arabic says the same as the English, sentence for sentence.

ASIDE (outside the draft)
- Live has one checkout session stuck in `pending_payment` since 2026-07-19, past its expiry. Nothing ever moves it out of that state.
- Account deletion treats a `pending_payment` session as a blocker (account-delete-process/index.ts:109-116). That customer's self-service deletion would wait, then go to manual review.

VERDICT: Not publishable as drafted: 2 blocking (payment-record retention claim contradicted by the account-deletion cascade; publishing alone or English-first contradicts the live payment policy), 5 should-fix, 8 nits. Every unchanged sentence is byte-identical to live v2.3, and the claims about what goes to Moyasar otherwise hold.