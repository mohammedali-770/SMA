# Privacy policy: name Moyasar as the payment processor (draft)

> **Status: DRAFT, engineering-written 2026-11-13, revised the same day against
> its fact-check (`docs/readiness/20261113-card-payments-reviews/privacy_policy.review.md`), then re-checked the same
> evening by an independent checker against the code, the live rows and the
> sibling drafts as they stood between 22:42 and 22:53 UTC (the "re-check:"
> lines in the "Fix log" at the end).
> Not reviewed by counsel. Not published.** Editing a live `legal_documents` row
> is a CLAUDE.md §5 action, and so is turning online payment on. This file holds
> the exact text and the evidence behind it, so publishing can be a copy-paste
> in the admin console.
>
> **Publishing plan (decided).** `privacy_policy`, `payment_policy`,
> `cancellation_refund_policy` and `terms_conditions` are published
> **together**, in **both languages**, in **one** owner-approved session, before
> `OWNER_ACTIONS.md` §47.18 (online payment on). This text is never published on
> its own and never in one language only. Until all four change, the live
> documents contradict it:
>
> - live `payment_policy` v2.0: *"We have not yet selected an online payment
>   provider. If we add card payment, we will name the provider in this policy
>   and in the Privacy Policy before the option appears in the app…"*;
> - live `cancellation_refund_policy` v2.0: *"Where a refund is due, it is
>   settled in cash at the branch that prepared the order."* This text says
>   Moyasar returns refunds of an online payment to the card or payment method
>   used;
> - live `terms_conditions` v2.0, PAYMENT: *"Orders are paid in cash at pickup or
>   on delivery. See the Payment Policy."*;
> - live `privacy_policy` v2.3 itself, in both languages, says card payment is
>   not available and promises to name the provider before the option appears.
>
> **The Arabic needs a native read** before that session. It is
> engineering-drafted Modern Standard Arabic, written to match the register of
> the live Arabic document (same queue as `OWNER_ACTIONS.md` §35). The points
> for the reader are in "Claims the drafter could not verify", item 8.
>
> **Scope.** Only what card payment requires. Every other sentence of v2.3 stays
> byte-for-byte as it is. The pending location correction (`OWNER_ACTIONS.md`
> §43, `docs/legal/PRIVACY_POLICY_LOCATION_USES_CORRECTION.md`) is **not**
> merged in. Under the decided plan `privacy_policy` is published once, in that
> session, so §43's timing has to be settled with it. See "Overlap with §43" at
> the end of "What changed and why", and "Open owner decisions", item 1.
>
> **Timing.** v2.3 promises: *"If we add it, we will name the payment provider
> in this policy before the option appears in the app."* So the session must
> come **before** `OWNER_ACTIONS.md` §47.18. Online payment is still off between
> the session and §47.18, so the text describes online payment only "where the
> app offers" it, and stays true while it is off.
>
> **Every `[OWNER DECISION: …]` bracket must be settled and removed before the
> session.** Three of them (two for Product gap 1, one for Product gap 5) choose
> between wording that is true of the code today and wording that becomes true
> only if the product is changed first. See "Product gaps found". Two are
> pre-publish gates (the payment methods, and where Moyasar processes data), and
> one, Apple Pay, is decided once for the set with the payment_policy draft.

---

## Current (live) text

Read-only from Production (`public.legal_documents`, `document_type =
'privacy_policy'`, `is_active = true`) on **2026-11-13**, and re-read for this
revision the same day:

- **version `2.3`**, `effective_date` **2026-09-16**. It is the only
  `privacy_policy` row;
- `md5(content_en)` = `d3e760c5dc2823e6115003d23bcc0798` (4 623 characters);
- `md5(content_ar)` = `d2acff9656d3afa072feddb76947d226` (3 744 characters).

**The quotations are exact.** Re-checked for this revision on 2026-11-13: every
line inside this file's code blocks was hashed with md5 and looked up in the
live text with a read-only query. Re-checked again by the independent re-check,
after its edits, against the live text read as base64 and decoded locally (both
md5s above reproduced exactly).

- All 76 distinct lines quoted from v2.3 (38 per language) occur verbatim in
  it: 35 per language that the proposed text keeps unchanged, and 3 per
  language (line 1, the PAYMENT line and the Lazywait line) that appear only
  under "Current (live) text", because the proposed text replaces them.
- Every other line is one this draft adds or replaces on purpose: line 1, the
  `Payment:` line, the WHY line, the Lazywait and Moyasar lines, the four PAYMENT
  lines, the WHERE gate and the HOW LONG line. That is 12 distinct lines in
  English and 13 in Arabic. Three lines appear in two forms, with their brackets
  and without: the HOW LONG line in both languages, and the Arabic Moyasar
  line.
- The new Lazywait line begins with the live Lazywait line exactly, in both
  languages.
- In each of the twelve full-section blocks under "Proposed text" (six
  sections, in both languages), the unchanged lines appear in the live order.
  Each forms one contiguous block of the live document, except that WHO has
  one gap: the Lazywait line this draft replaces.
- **Rebuilt, not only looked up (re-check).** Both documents were rebuilt from
  the live text plus this draft's seven edits, brackets removed and a sample
  date in line 1. Each differs from v2.3 by exactly 3 lines removed (line 1,
  the Lazywait line, the PAYMENT line) and 10 added, and every full-section
  block, brackets removed, is a contiguous slice of its rebuilt document, so
  the full-section blocks and the single-line edits say the same thing.

So every sentence this draft does not change is byte-identical to v2.3.

Re-read both hashes before publishing. If either has moved, something else was
published since this draft (most likely §43) and the anchors below must be
re-checked against the new text.

The parts this draft changes, or inserts next to, are quoted exactly. Lines
marked *anchor* stay unchanged; the new line goes directly after them.

### English (v2.3)

**Line 1 (the date in the body. It must move with the column: `LEGAL_DOCUMENTS_AUDIT.md` §Method rule 6)**

```
Effective date: 16 September 2026
```

**WHAT WE COLLECT: anchor**

```
Orders: the items you order, amounts and VAT, the branch, whether it is pickup or delivery, order status and history, and any note you add to an order.
```

**WHY WE COLLECT IT: anchor**

```
To take your order, send it to the branch, prepare it, and hand it over or deliver it.
```

**WHO WE SHARE IT WITH: the Lazywait line. It is replaced: its sentence stays word for word and one sentence is appended. It is also the anchor for the new Moyasar line.**

```
Lazywait — the point-of-sale system in our branches, which receives your order so the kitchen can prepare it.
```

**PAYMENT: replaced in full**

```
PAYMENT
Orders in the app are paid in cash at pickup or on delivery. Online card payment is not available. If we add it, we will name the payment provider in this policy before the option appears in the app, and we will never store your full card number.
```

**WHERE YOUR DATA IS PROCESSED: unchanged, behind a pre-publish gate**

```
WHERE YOUR DATA IS PROCESSED
Some of the providers listed above process data outside the Kingdom of Saudi Arabia. Where that happens, we rely on the data protection commitments in our contract with that provider.
```

**HOW LONG WE KEEP IT: anchor**

```
Orders, invoices and financial records: for the period required by tax and accounting law, including after you delete your account. Your personal details on those records are anonymised.
```

**Read and deliberately left unchanged:** YOUR CONSENT (*"We process your data
to provide the ordering service you asked for and to meet our legal
obligations…"*). WHERE YOUR DATA IS PROCESSED keeps its wording, but adding
Moyasar to "the providers listed above" makes it a claim about the Moyasar
agreement, so it now carries a gate. The reasons are under "What changed and
why".

### Arabic (v2.3)

**السطر الأول**

```
تاريخ السريان: ١٦ سبتمبر ٢٠٢٦
```

**ما الذي نجمعه: anchor**

```
الطلبات: الأصناف التي تطلبها والمبالغ وضريبة القيمة المضافة والفرع ونوع الطلب استلاماً أو توصيلاً وحالة الطلب وسجلّه وأي ملاحظة تضيفها.
```

**لماذا نجمعها: anchor**

```
لاستلام طلبك وإرساله إلى الفرع وتحضيره وتسليمه أو توصيله.
```

**مع من نشاركها: the Lazywait line, replaced (its sentence stays, one is appended), and the anchor for the Moyasar line**

```
Lazywait — نظام نقاط البيع في فروعنا، ويستقبل طلبك ليتمكن المطبخ من تحضيره.
```

**الدفع: replaced in full**

```
الدفع
تُدفع الطلبات في التطبيق نقداً عند الاستلام أو عند التوصيل. والدفع الإلكتروني بالبطاقة غير متاح. وإذا أضفناه، فسنذكر اسم مزوّد الدفع في هذه السياسة قبل ظهور الخيار في التطبيق، ولن نخزّن رقم بطاقتك كاملاً في أي حال.
```

**أين تُعالج بياناتك: unchanged, behind a pre-publish gate**

```
أين تُعالج بياناتك
بعض المزوّدين المذكورين أعلاه يعالجون البيانات خارج المملكة العربية السعودية. وعند حدوث ذلك نعتمد على التزامات حماية البيانات المنصوص عليها في عقدنا مع ذلك المزوّد.
```

**مدة الاحتفاظ: anchor**

```
الطلبات والفواتير والسجلات المالية: للمدة التي يتطلبها النظام الضريبي والمحاسبي، بما في ذلك بعد حذف حسابك، مع إخفاء بياناتك الشخصية من تلك السجلات.
```

---

## Proposed text

**Version: `[OWNER DECISION: 2.4 (minor) or 3.0 (major); minor or major is
decided once for the four documents published together]`** (reasoning under
"What changed and why", row 13, and "Open owner decisions", item 1). The
payment_policy and terms_conditions drafts mark their version the same way. If
a `privacy_policy` version has been published after this draft was written
(re-read the hashes under "Current (live) text"), the minor number is the next
one after it, and the anchors must be re-checked. Set `effective_date` to the
publication date, the same date as the other three documents, and put that date
in line 1 of both languages.

Seven edits per language: two lines replaced (line 1 and the Lazywait line),
four lines inserted, and one section replaced. Publish them as `replace()`
operations against the stored text, not as a re-paste of the whole document
(`LEGAL_DOCUMENTS_AUDIT.md` §Method rule 4). Each block below gives the full
text of the changed section, followed by the single line that edit adds or
replaces. The WHERE YOUR DATA IS PROCESSED paragraph does not change; its block
shows the gate that must pass before the session.

Text in `[OWNER DECISION: …]` brackets must be settled and the brackets removed
before publishing. Nothing else in the proposed text is a placeholder.

### English

**Line 1**

```
Effective date: [OWNER DECISION: publication date, e.g. 20 November 2026]
```

**WHAT WE COLLECT: full section.** The Device location line below is v2.3's,
**unchanged**. If §43's line is carried in the same session, or is already
live, keep §43's line instead. Only the `Payment:` line is new.

```
WHAT WE COLLECT
Account details: your name, your mobile number, and your email address if you add one.
Verification: the one-time codes we send to your mobile number, and a record that a code was sent and used.
Orders: the items you order, amounts and VAT, the branch, whether it is pickup or delivery, order status and history, and any note you add to an order.
Payment: if you pay online, the payment method, the payment's status and amount (and the reason, if it is declined), the card network (for example mada or Visa), the last four digits of the card, the name and country of the bank that issued it, and the reference codes Moyasar and the bank give the payment. We receive these from Moyasar when you pay, or try to pay, and keep them with the payment record. What Moyasar sends us can also include other details, such as the first six digits of the card, the name on the card and your IP address; we discard those without storing them. We never collect your full card number.
Delivery address: the address you enter and the location you place on the map, only when you order delivery.
Device location: your location, only while you are choosing a delivery point on the map, and only if you allow it. We do not follow your location in the background.
Loyalty: your points balance and the points earned or redeemed on each order.
Notifications: a notification token for each device you turn notifications on for, with the device type and app language.
Technical data: app version, device model and operating system, language, and diagnostic data if the app crashes.
```

Line to insert after the Orders line:

```
Payment: if you pay online, the payment method, the payment's status and amount (and the reason, if it is declined), the card network (for example mada or Visa), the last four digits of the card, the name and country of the bank that issued it, and the reference codes Moyasar and the bank give the payment. We receive these from Moyasar when you pay, or try to pay, and keep them with the payment record. What Moyasar sends us can also include other details, such as the first six digits of the card, the name on the card and your IP address; we discard those without storing them. We never collect your full card number.
```

**WHY WE COLLECT IT: full section**

```
WHY WE COLLECT IT
To create your account and sign you in.
To take your order, send it to the branch, prepare it, and hand it over or deliver it.
To take online payment for your order if you choose to pay that way, to confirm the payment, and to make any refund.
To keep you informed about the status of your order, and to send you offers if you have turned notifications on.
To run the loyalty programme.
To answer your support requests.
To keep the invoice, tax and accounting records required of us.
To keep the app secure and to find and fix faults.
```

Line to insert after "To take your order…":

```
To take online payment for your order if you choose to pay that way, to confirm the payment, and to make any refund.
```

**WHO WE SHARE IT WITH: full section**

```
WHO WE SHARE IT WITH
We share only what each provider needs in order to do its part.
Supabase — the database, sign-in and hosting behind the app.
Vercel — hosting for the web version of the app and for our public policy pages.
Lazywait — the point-of-sale system in our branches, which receives your order so the kitchen can prepare it. If you pay online, it can also receive the amount paid and Moyasar's reference for the payment.
Moyasar — our provider for online payment, which takes the payment, confirms it to us and returns refunds to the card or payment method you paid with. See Payment below.
Meta, through the WhatsApp Business Platform — delivery of your verification code and order-related messages.
Expo, with Apple (APNs) and Google (FCM) — delivery of push notifications to your device.
Sentry — crash and error reports from the app.
Google, with Apple on iPhone — the map you use to choose a delivery location. Google draws the map and receives the coordinates of the point you pick. Turning that point into a street address is done by Google on the web and on Android, and by Apple on iPhone.
Our email provider — account and administrative email.
We do not sell your personal data, and we do not share it for third-party advertising.
```

The Lazywait line becomes (its first sentence is v2.3's, unchanged):

```
Lazywait — the point-of-sale system in our branches, which receives your order so the kitchen can prepare it. If you pay online, it can also receive the amount paid and Moyasar's reference for the payment.
```

Line to insert after the Lazywait line:

```
Moyasar — our provider for online payment, which takes the payment, confirms it to us and returns refunds to the card or payment method you paid with. See Payment below.
```

**PAYMENT: replaces the whole v2.3 section**

```
PAYMENT
Where the app offers it, you can pay in cash at pickup or on delivery. Where the app offers online payment, you can also pay through Moyasar, our payment provider, with a mada, Visa or Mastercard card. [OWNER DECISION (methods), as in the payment_policy draft: publish this list only once Moyasar has confirmed in writing that SADAD, STC Pay and any card scheme not named here (for example American Express) are switched off for invoices on this account (OWNER_ACTIONS.md §47.19). If one is on, have it switched off first, or name it here and re-check this section against it: with STC Pay, for example, you would not enter card details at all.] [OWNER DECISION (Apple Pay), decided once with the payment_policy draft (its Open owner decisions, item 2) and the store answers: this text does not name Apple Pay, because the only proof that it works inside the app is the device check in RELEASE_CHECKLIST.md §7, which needs online payment switched on (OWNER_ACTIONS.md §47.18 step 2), after this text must already be live. (a) Recommended, as in the payment_policy draft: publish as it is, and name Apple Pay in a later version once that check has passed. (b) Name it now, accepting that it is unverified at publication: end the sentence before these brackets with "…with a mada, Visa or Mastercard card, or with Apple Pay on iPhone where the app shows it.", and add at the end of the next paragraph: "If you use Apple Pay, your card details reach Moyasar through Apple Pay, under Apple's own terms."]
When you pay online, you enter your card details on Moyasar's own payment page, which the app opens for you. They go to Moyasar directly, not through us: your full card number and security code never reach us, and we never store them. Like any web page, Moyasar's page also receives the technical details your device sends, such as its IP address. Your bank may ask you to confirm the payment on its own page (3-D Secure).
We send Moyasar only what it needs to take the payment: the amount and currency, a fixed description ("Spicy Meal order"), the time the payment page expires, the language you use the app in, and reference numbers that link the payment to your order. We do not send Moyasar your name, mobile number, email address or delivery address.
We use online payment to complete the order you asked for, and we keep a record of the payment to confirm it, to make any refund and to answer your questions about it. [OWNER DECISION: Product gap 1. If account deletion is changed before publishing so that payment records are kept as financial records, use instead: "We use online payment to complete the order you asked for, and we keep a record of the payment to confirm it, to make any refund, to answer your questions about it and to meet our legal obligation to keep financial records."]
```

**WHERE YOUR DATA IS PROCESSED: unchanged, with its pre-publish gate**

```
WHERE YOUR DATA IS PROCESSED
Some of the providers listed above process data outside the Kingdom of Saudi Arabia. Where that happens, we rely on the data protection commitments in our contract with that provider.
[OWNER DECISION: pre-publish gate; the paragraph above stays word for word if it passes. Confirm from the Moyasar agreement either that Moyasar processes this data inside the Kingdom, or that the agreement carries data protection commitments. If neither, counsel rewords this paragraph before it is published.]
```

**HOW LONG WE KEEP IT: full section**

```
HOW LONG WE KEEP IT
Account data: for as long as your account is open.
Orders, invoices and financial records: for the period required by tax and accounting law, including after you delete your account. Your personal details on those records are anonymised.
Payment records: for payments made in the app, while your account is open, and never longer than the order they belong to; they are deleted when you delete your account. Any other payment record is kept no longer than the order it belongs to. Payment records never contain your full card number. [OWNER DECISION: Product gap 1. If account deletion is changed before publishing so that payment records are kept, replace the three sentences before these brackets with: "Payment records: kept with the order they belong to, for as long as the order is kept. A payment record that belongs to no order, such as one for a declined card, is kept while your account is open. Payment records never contain your full card number." Re-check that wording against the change that actually lands, in particular for a captured payment that has no order.] [OWNER DECISION: Product gap 5. If, instead, the order-first payment path is closed to customers before publishing and account deletion is unchanged, the first two sentences may be shortened to: "Payment records: while your account is open, and never longer than the order they belong to. They are deleted when you delete your account."] [OWNER DECISION: Moyasar's own record. If the Moyasar agreement confirms it, add at the end of this line: "Moyasar keeps its own record of your payment for the period required of it as a payment provider." If it does not, add at least: "Deleting your account does not delete Moyasar's own record of your payment." That sentence is true of our code today: nothing in it asks Moyasar to delete a payment.]
Verification codes: a short period, then deleted.
Support messages: while we need them to resolve your request, and for a reasonable period afterwards.
```

Line to insert after the "Orders, invoices and financial records" line (without
the brackets, once decided):

```
Payment records: for payments made in the app, while your account is open, and never longer than the order they belong to; they are deleted when you delete your account. Any other payment record is kept no longer than the order it belongs to. Payment records never contain your full card number.
```

### Arabic (needs a native read)

**السطر الأول** (Arabic-Indic digits, as in v2.3)

```
تاريخ السريان: [OWNER DECISION: تاريخ النشر، مثل ٢٠ نوفمبر ٢٠٢٦]
```

**ما الذي نجمعه: full section.** The الموقع line is v2.3's, unchanged (see the
English note about §43). Only the `الدفع:` line is new.

```
ما الذي نجمعه
بيانات الحساب: اسمك ورقم جوالك وبريدك الإلكتروني إن أضفته.
التحقق: رموز التحقق لمرة واحدة التي نرسلها إلى رقم جوالك، وسجل بأن الرمز أُرسل واستُخدم.
الطلبات: الأصناف التي تطلبها والمبالغ وضريبة القيمة المضافة والفرع ونوع الطلب استلاماً أو توصيلاً وحالة الطلب وسجلّه وأي ملاحظة تضيفها.
الدفع: عند الدفع الإلكتروني، طريقة الدفع، وحالة الدفعة ومبلغها وسبب رفضها إن رُفضت، وشبكة البطاقة (مثل مدى أو Visa) وآخر أربعة أرقام منها، واسم البنك المُصدر لها وبلده، والأرقام المرجعية التي تمنحها Moyasar والبنك للدفعة. ونتلقى هذه البيانات من Moyasar عند الدفع أو محاولة الدفع، ونحتفظ بها في سجل الدفع. وقد يتضمن ما ترسله إلينا Moyasar بيانات أخرى أيضاً، مثل أول ستة أرقام من البطاقة والاسم المدوّن عليها وعنوان IP الخاص بك، فنتخلّص منها دون تخزينها. ولا نجمع رقم بطاقتك كاملاً أبداً.
عنوان التوصيل: العنوان الذي تدخله والموقع الذي تحدده على الخريطة، وذلك فقط عند طلب التوصيل.
موقع الجهاز: موقعك، فقط أثناء تحديدك لنقطة التوصيل على الخريطة، وفقط إذا سمحت بذلك. ولا نتتبع موقعك في الخلفية.
الولاء: رصيد نقاطك والنقاط المكتسبة أو المستبدلة في كل طلب.
الإشعارات: رمز إشعارات لكل جهاز تُفعّل عليه الإشعارات، مع نوع الجهاز ولغة التطبيق.
البيانات التقنية: إصدار التطبيق وطراز الجهاز ونظام التشغيل واللغة وبيانات تشخيصية عند تعطّل التطبيق.
```

Line to insert after the الطلبات line:

```
الدفع: عند الدفع الإلكتروني، طريقة الدفع، وحالة الدفعة ومبلغها وسبب رفضها إن رُفضت، وشبكة البطاقة (مثل مدى أو Visa) وآخر أربعة أرقام منها، واسم البنك المُصدر لها وبلده، والأرقام المرجعية التي تمنحها Moyasar والبنك للدفعة. ونتلقى هذه البيانات من Moyasar عند الدفع أو محاولة الدفع، ونحتفظ بها في سجل الدفع. وقد يتضمن ما ترسله إلينا Moyasar بيانات أخرى أيضاً، مثل أول ستة أرقام من البطاقة والاسم المدوّن عليها وعنوان IP الخاص بك، فنتخلّص منها دون تخزينها. ولا نجمع رقم بطاقتك كاملاً أبداً.
```

**لماذا نجمعها: full section**

```
لماذا نجمعها
لإنشاء حسابك وتسجيل دخولك.
لاستلام طلبك وإرساله إلى الفرع وتحضيره وتسليمه أو توصيله.
لتحصيل قيمة طلبك إلكترونياً إذا اخترت الدفع بهذه الطريقة، وتأكيد الدفعة، وإجراء أي استرداد.
لإبقائك على اطلاع بحالة طلبك، ولإرسال العروض إذا فعّلت الإشعارات.
لتشغيل برنامج الولاء.
للرد على طلبات الدعم الخاصة بك.
للاحتفاظ بسجلات الفواتير والضريبة والمحاسبة المطلوبة منّا نظاماً.
للحفاظ على أمان التطبيق واكتشاف الأعطال وإصلاحها.
```

Line to insert after "لاستلام طلبك…":

```
لتحصيل قيمة طلبك إلكترونياً إذا اخترت الدفع بهذه الطريقة، وتأكيد الدفعة، وإجراء أي استرداد.
```

**مع من نشاركها: full section**

```
مع من نشاركها
نشارك فقط ما يحتاجه كل مزوّد لأداء دوره.
Supabase — قاعدة البيانات وتسجيل الدخول والاستضافة خلف التطبيق.
Vercel — استضافة نسخة الويب من التطبيق وصفحات السياسات العامة.
Lazywait — نظام نقاط البيع في فروعنا، ويستقبل طلبك ليتمكن المطبخ من تحضيره. وعند الدفع الإلكتروني، قد يستقبل أيضاً المبلغ المدفوع والرقم المرجعي للدفعة لدى Moyasar.
Moyasar — مزوّد الدفع الإلكتروني لدينا، ويتولى تحصيل الدفعة وتأكيدها لنا وإعادة المبالغ المستردة إلى البطاقة أو وسيلة الدفع التي دفعت بها. انظر قسم الدفع أدناه. [OWNER DECISION: الاسم العربي لـ Moyasar. يكتب النص الحالي أسماء المزوّدين كلها بالحروف اللاتينية، ولذلك كُتب "Moyasar" في كل المواضع. إن رأى المراجع العربي إضافة اسم العلامة بالعربية (ميسر)، فيُضاف في هذا السطر: "Moyasar (ميسر)"، وإلا فاحذف هذا القوس]
Meta عبر منصة واتساب للأعمال — إيصال رمز التحقق والرسائل المتعلقة بالطلب.
Expo مع Apple عبر APNs وGoogle عبر FCM — إيصال الإشعارات الفورية إلى جهازك.
Sentry — تقارير الأعطال والأخطاء من التطبيق.
Google ومعها Apple على iPhone — الخريطة التي تستخدمها لاختيار موقع التوصيل. تعرض Google الخريطة وتتلقى إحداثيات النقطة التي تحددها، ويتم تحويل تلك النقطة إلى عنوان عبر Google على الويب وعلى Android، وعبر Apple على iPhone.
مزوّد البريد الإلكتروني لدينا — رسائل الحساب والرسائل الإدارية.
نحن لا نبيع بياناتك الشخصية ولا نشاركها لأغراض إعلانات طرف ثالث.
```

The Lazywait line becomes (its first sentence is v2.3's, unchanged):

```
Lazywait — نظام نقاط البيع في فروعنا، ويستقبل طلبك ليتمكن المطبخ من تحضيره. وعند الدفع الإلكتروني، قد يستقبل أيضاً المبلغ المدفوع والرقم المرجعي للدفعة لدى Moyasar.
```

Line to insert after the Lazywait line (without the bracket, once decided):

```
Moyasar — مزوّد الدفع الإلكتروني لدينا، ويتولى تحصيل الدفعة وتأكيدها لنا وإعادة المبالغ المستردة إلى البطاقة أو وسيلة الدفع التي دفعت بها. انظر قسم الدفع أدناه.
```

**الدفع: replaces the whole v2.3 section**

```
الدفع
يمكنك الدفع نقداً عند الاستلام أو عند التوصيل حيث يتيح التطبيق ذلك. وحيث يتيح التطبيق الدفع الإلكتروني، يمكنك أيضاً الدفع من خلال Moyasar، مزوّد الدفع لدينا، ببطاقة مدى أو Visa أو Mastercard. [OWNER DECISION (وسائل الدفع)، كما في مسودة سياسة الدفع: لا تُنشر هذه القائمة إلا بعد أن تؤكد Moyasar كتابياً أن SADAD وSTC Pay وأي شبكة بطاقات غير مذكورة هنا (مثل American Express) معطّلة للفواتير في هذا الحساب (OWNER_ACTIONS.md §47.19). وإن كان أيٌّ منها مفعّلاً، فيُعطَّل أولاً، أو يُذكر هنا وتُراجَع هذه الفقرة في ضوئه، فمع STC Pay مثلاً لا تُدخل بيانات بطاقة أصلاً.] [OWNER DECISION (Apple Pay)، يُتخذ مرة واحدة مع مسودة سياسة الدفع (البند ٢ من قراراتها المفتوحة) وإجابات المتاجر: لا يذكر هذا النص Apple Pay، لأن الدليل الوحيد على عمله داخل التطبيق هو فحص الجهاز في RELEASE_CHECKLIST.md §7، وهو يتطلب تشغيل الدفع الإلكتروني (الخطوة ٢ من OWNER_ACTIONS.md §47.18)، أي بعد أن يكون هذا النص قد نُشر. (أ) المقترح، كما في مسودة سياسة الدفع: يُنشر النص كما هو، ويُذكر Apple Pay في نسخة لاحقة بعد نجاح الفحص. (ب) ذكره الآن مع قبول أنه غير مُتحقَّق منه عند النشر: تنتهي الجملة السابقة لهذين القوسين بـ «…ببطاقة مدى أو Visa أو Mastercard، أو عبر Apple Pay على iPhone حيث يظهر خياره.»، وتُضاف في آخر الفقرة التالية الجملة «وإذا استخدمت Apple Pay، فتصل بيانات بطاقتك إلى Moyasar عبر Apple Pay وفق شروط Apple.»]
وعند الدفع الإلكتروني تُدخل بيانات بطاقتك في صفحة الدفع التابعة لـ Moyasar، التي يفتحها لك التطبيق، فتصل إلى Moyasar مباشرة دون أن تمر بنا: فلا يصل إلينا رقم بطاقتك كاملاً ولا رمز الأمان أبداً، ولا نخزّنهما في أي حال. وكأي صفحة ويب، تتلقى صفحة Moyasar أيضاً البيانات التقنية التي يرسلها جهازك، مثل عنوان IP. وقد يطلب منك البنك المُصدر لبطاقتك تأكيد الدفع في صفحته الخاصة (3-D Secure).
ولا نرسل إلى Moyasar إلا ما يلزم لإتمام الدفع: المبلغ والعملة، ووصفاً ثابتاً ("Spicy Meal order")، ووقت انتهاء صلاحية صفحة الدفع، ولغة استخدامك للتطبيق، وأرقاماً مرجعية تربط الدفعة بطلبك. ولا نرسل إلى Moyasar اسمك ولا رقم جوالك ولا بريدك الإلكتروني ولا عنوان التوصيل.
ونستخدم الدفع الإلكتروني لإتمام الطلب الذي طلبته، ونحتفظ بسجل للدفعة لتأكيدها ولإجراء أي استرداد وللرد على استفساراتك بشأنها. [OWNER DECISION: (Product gap 1) إذا عُدّل حذف الحساب قبل النشر بحيث تُحفظ سجلات الدفع ضمن السجلات المالية، فاستخدم بدلاً من هذه الجملة: «ونستخدم الدفع الإلكتروني لإتمام الطلب الذي طلبته، ونحتفظ بسجل للدفعة لتأكيدها ولإجراء أي استرداد وللرد على استفساراتك بشأنها وللوفاء بالتزامنا النظامي بحفظ السجلات المالية.»]
```

**أين تُعالج بياناتك: unchanged, with its pre-publish gate**

```
أين تُعالج بياناتك
بعض المزوّدين المذكورين أعلاه يعالجون البيانات خارج المملكة العربية السعودية. وعند حدوث ذلك نعتمد على التزامات حماية البيانات المنصوص عليها في عقدنا مع ذلك المزوّد.
[OWNER DECISION: شرط قبل النشر، وتبقى الفقرة أعلاه كما هي حرفياً إن تحقق. تأكّد من اتفاقية Moyasar إما أن Moyasar تعالج هذه البيانات داخل المملكة، وإما أن الاتفاقية تتضمن التزامات لحماية البيانات. وإن لم يتحقق أيٌّ منهما، فيعيد المستشار القانوني صياغة هذه الفقرة قبل نشرها.]
```

**مدة الاحتفاظ: full section**

```
مدة الاحتفاظ
بيانات الحساب: طوال بقاء حسابك مفتوحاً.
الطلبات والفواتير والسجلات المالية: للمدة التي يتطلبها النظام الضريبي والمحاسبي، بما في ذلك بعد حذف حسابك، مع إخفاء بياناتك الشخصية من تلك السجلات.
سجلات الدفع: للدفعات التي تتم في التطبيق، طوال بقاء حسابك مفتوحاً، ولا نحتفظ بها مدةً أطول من الطلب الذي تخصّه، وتُحذف عند حذف حسابك. وأي سجل دفع آخر لا نحتفظ به مدةً أطول من الطلب الذي يخصّه. ولا تتضمن سجلات الدفع رقم بطاقتك كاملاً في أي حال. [OWNER DECISION: (Product gap 1) إذا عُدّل حذف الحساب قبل النشر بحيث تُحفظ سجلات الدفع، فاستبدل الجمل الثلاث السابقة لهذه الأقواس بما يلي: «سجلات الدفع: نحتفظ بها مع الطلب الذي تخصّه طوال مدة الاحتفاظ به. أما سجل الدفع الذي لا يخصّ أي طلب، مثل سجل بطاقة مرفوضة، فنحتفظ به طوال بقاء حسابك مفتوحاً. ولا تتضمن سجلات الدفع رقم بطاقتك كاملاً في أي حال.» وتُراجَع هذه الصيغة على التغيير الذي يُعتمد فعلاً، ولا سيما الدفعة المحصّلة التي لا يخصّها طلب.] [OWNER DECISION: (Product gap 5) وإذا أُغلق بدلاً من ذلك مسار الدفع عن طلب قائم أمام العملاء قبل النشر وبقي حذف الحساب دون تغيير، فيمكن اختصار الجملتين الأوليين إلى: «سجلات الدفع: طوال بقاء حسابك مفتوحاً، ولا نحتفظ بها مدةً أطول من الطلب الذي تخصّه. وتُحذف عند حذف حسابك.»] [OWNER DECISION: سجل Moyasar الخاص. إذا أكدته اتفاقية Moyasar، فأضف في آخر هذا السطر: «وتحتفظ Moyasar بسجلها الخاص لدفعتك للمدة المطلوبة منها بوصفها مزوّد دفع.» وإن لم تؤكده، فأضف على الأقل: «ولا يؤدي حذف حسابك إلى حذف سجل Moyasar الخاص بدفعتك.» وهذه الجملة صحيحة في الكود اليوم، إذ لا شيء فيه يطلب من Moyasar حذف أي دفعة.]
رموز التحقق: مدة قصيرة ثم تُحذف.
رسائل الدعم: طوال حاجتنا إليها لمعالجة طلبك ولمدة معقولة بعد ذلك.
```

Line to insert after the الطلبات والفواتير line (without the brackets, once
decided):

```
سجلات الدفع: للدفعات التي تتم في التطبيق، طوال بقاء حسابك مفتوحاً، ولا نحتفظ بها مدةً أطول من الطلب الذي تخصّه، وتُحذف عند حذف حسابك. وأي سجل دفع آخر لا نحتفظ به مدةً أطول من الطلب الذي يخصّه. ولا تتضمن سجلات الدفع رقم بطاقتك كاملاً في أي حال.
```

---

## What changed and why

Paths are relative to the repository root. They were read from the default-branch
export, and live facts were read from Production with read-only SQL on 2026-11-13.

| # | Change | Code fact it rests on |
| --- | --- | --- |
| 1 | **PAYMENT section rewritten.** Cash "where the app offers it"; online payment through Moyasar "where the app offers online payment", with mada, Visa or Mastercard behind the same methods gate as the payment_policy draft; Apple Pay **not named by default**, with the wording to name it in a bracket (re-check R1, R4). | Moyasar is the only provider: `supabase/functions/payment-initiate/index.ts:19-23` (owner decision 2026-11-11; any other provider answers `disabled`). Online payment is a server switch, still **off**: live `app_settings.online_payment_enabled = false` (read 2026-11-13). The payment row is enabled in TEST mode, and `payment-initiate` refuses customer checkout in TEST mode (`docs/PAYMENTS.md` §3). `/app` never offers it (`apps/mobile/src/lib/payment.ts:45-55`; `docs/GO_LIVE_READINESS.md` G1). **Cash is a switch too:** `cash_payment_enabled` (live true) is an admin setting that `place_order` enforces (`20260709140000_payment_methods.sql:26,167,186`), and the app treats cash as "NEVER assumed" (`payment.ts:6`). **Apple Pay:** `enableApplePay` is iOS only (`apps/mobile/src/app/payment/checkout.tsx:179-187`) and ships only in the next EAS build; builds already in the field open the system browser in LIVE mode, without Apple Pay (`PAYMENTS.md` §5; `OWNER_ACTIONS.md` §47.17); and Apple Pay inside the WebView is **unconfirmed** by Moyasar (`PAYMENTS.md` §11 Q1). "Where the app offers online payment" did not cover any of that. **Re-check R1:** the earlier bracket kept Apple Pay "only if the Apple Pay device check in RELEASE_CHECKLIST.md §7 passes", but that check "need[s] online payment switched on and Moyasar in live mode" (`RELEASE_CHECKLIST.md:164-166`), so it cannot pass before this text must be live, and the payment_policy draft (22:42 UTC) now defaults to not naming Apple Pay, option (a) of its Open owner decisions, item 2, and asks for "the same choice in the privacy_policy draft". The default now matches; option (b) is in the bracket. **Re-check R4:** the method list carries the payment_policy draft's methods gate (`OWNER_ACTIONS.md` §47.19): the invoice request sends no method field (`moyasar.ts:336-354`), so the hosted page offers whatever Moyasar's dashboard enables. |
| 2 | **"You enter your card details on Moyasar's own payment page … your full card number and security code never reach us."** The Apple Pay sentence, corrected earlier, now sits in the Apple Pay bracket (option (b)). | `supabase/functions/_shared/moyasar.ts:6-17`: server-side card payment is prohibited by Moyasar, so the integration is the hosted **invoice**, and "the card never touches our infrastructure". The app loads that page and nothing else: `checkout.tsx:156` (`source={{ uri: checkoutUrl }}`), and `moyasar.ts:373-386` refuses any URL that is not https on `moyasar.com`. "Which the app opens for you" is true of both builds: new builds use an in-app WebView, builds already in the field open the system browser in LIVE mode (`PAYMENTS.md` §5). The old Apple Pay sentence said "Apple handles the payment on your device", which contradicted the WHO line: Moyasar takes the payment, and Apple Pay only passes the card details to it. |
| 3 | **"We send Moyasar only … amount and currency, a fixed description ("Spicy Meal order"), the time the page expires, the language you use the app in, reference numbers. Not your name, mobile number, email or delivery address."** | The whole invoice body is `buildInvoicePayload`, `moyasar.ts:336-354`: `amount` (minor units), `currency`, `description`, `success_url`, `back_url`, `expired_at`, `metadata` = `{reference_transaction, reference_order}`. There is no customer field. The only caller passes `description: 'Spicy Meal order'` (`payment-initiate/index.ts:456` order path, `:529` session path), `referenceOrder` from the attempt (`:263`), and return URLs `…/functions/v1/payment-return?order=<order uuid>` or `?session=<session uuid>` (`:265-266`, `:457`, `:530`). `reference_transaction` is `'sm_' ‖ random uuid`; `reference_order` is `'CS-'`/`'ORD-'` plus the first 12 hex digits of the session/order id (`supabase/migrations/20261003120000_moyasar_only_payments.sql:306,313` and `:405-406`). **The invoice request carries no language field** (`payment-initiate/index.ts:34-35`). The app sends its own language (`:49`), which reaches Moyasar only as `?lang=ar`/`en` on the page URL the app loads (`moyasar.ts:384`). Whether Moyasar honours it is unknown (`PAYMENTS.md` §11 Q5), so the text says "the language you use the app in", not "the language the page is shown in". Every other server call to Moyasar sends **ids only**: GET by id or by metadata reference (`supabase/functions/_shared/moyasarVerify.ts:65-70`), and a refund whose body is `{ amount }` alone (`supabase/functions/_shared/moyasarRefund.ts:261`, sent at `supabase/functions/payment-refund/index.ts:235-241`). "Reference numbers that link the payment to your order" covers both metadata values and the ids in the return URLs. |
| 4 | **"Like any web page, Moyasar's page also receives … your IP address."** | `moyasar.ts:740`: the sanitizer "Drops the BIN, tokens, the payer IP". So Moyasar's payment object records the payer's IP, which it gets because the customer's device loads Moyasar's page directly. This is disclosed so that "we send only…" does not imply Moyasar gets nothing else. |
| 5 | **3-D Secure sentence** | `docs/PAYMENTS.md` §2 step 4 and §5: the bank's challenge page is on "the bank's own domain". `docs/RECORD_OF_PROCESSING.md` activity 15 names the card issuer and Apple as receiving data "from the customer directly". |
| 6 | **WHAT WE COLLECT gains a `Payment:` line** listing what our server receives from Moyasar and keeps, what it receives and discards, and that it never collects the full card number. | Kept fields: `sanitizeMoyasarPayment`, `moyasar.ts:742-769`: id, status, amount, currency, fee, refunded, captured, invoice_id, created_at, and from `source` the type (the payment method), company (the card network), **last four** (`lastFourOf`, `:732-736`, which deliberately drops the first six), message (the decline reason), reference number, authorisation code, response code, issuer name and issuer country. Card network and last four also go into columns (`moyasarVerify.ts:332-333`, `:196-198`; `finalize_checkout_session`). Every check writes the sanitized payment into `raw`, a declined one included (`moyasarVerify.ts:306-310`, `:524`). **Received and discarded:** the sanitizer "Drops the BIN, tokens, the payer IP, and everything unlisted" (`moyasar.ts:740`); `source.number` arrives "masked as first-six + last-four" (`:728-730`); its test fixture also carries the cardholder name, and the test asserts it is dropped (`moyasar.test.ts:647-657`, `:668-676`). **Re-check R8:** "Moyasar's reply" became "What Moyasar sends us", because the full payment object also arrives unasked, in the webhook (`payment-webhook/index.ts:131-133`, `evt.data`), and nothing of it but its ids is stored. No Moyasar payment body is logged (every `console.*` call in `_shared/moyasar*.ts` and `payment-*/index.ts` was read), and the webhook stores ids only (`payment-webhook/index.ts:116-118`, `:148-150`, `:176-178`). Live `payment_records` columns, read 2026-11-13, include `card_scheme`, `card_last_four`, `raw`, `failure_message_safe`; there is no name, phone, IP or customer column. "Card type" became "card network", because Moyasar's `issuer_card_type` (debit or credit) is one of the fields we discard. Moyasar's `fee` is stored but not listed: it is Moyasar's charge to us, not data about the customer. |
| 7 | **WHY WE COLLECT IT gains one purpose:** take, confirm and refund an online payment. | Purpose of activity 15 in `docs/RECORD_OF_PROCESSING.md`: "Take payment for an order, confirm it, and refund it". The refund clause says "make **any** refund" and promises no trigger or timing (see below). |
| 8 | **WHO WE SHARE IT WITH gains Moyasar**, placed after Lazywait because both are order-path providers. Its role: "takes the payment, confirms it to us and returns refunds to the card or payment method you paid with". | Moyasar is the only recipient of the invoice body (row 3). The v2.3 promise *"we will name the payment provider in this policy before the option appears"* requires it. **Re-check R3:** the earlier "and makes any refund" was true of the code (every refund path is Moyasar's: `payment-refund/index.ts:235-241`, or by hand in its dashboard, `OWNER_ACTIONS.md` §47.20), but it would turn false if the cancellation_refund_policy draft's open D4 allows a card-paid refund to be settled in cash at the branch, a choice the payment_policy draft brackets too. The new clause is the siblings' own phrase ("the card or payment method you paid with") and stays true either way, because it does not say every refund goes that way. |
| 9 | **The Lazywait line gains a sentence:** "If you pay online, it can also receive the amount paid and Moyasar's reference for the payment." Its v2.3 sentence is unchanged. | After a confirmed payment, `moyasarVerify.ts:481-487` calls `pushLazywaitOnlinePayment`, which POSTs `/pos/orders/update-online-payment` with `Trans_Amount` (the order total), `Approval_No` (the Moyasar payment id) and `Card_Type: 'card'` (`supabase/functions/_shared/paymentSync.ts:41-84`). It is sent only if the POS already holds the order (`:46`). Despite that line's comment, no later step sends it: the only caller is `moyasarVerify.ts:485`, and the API client's own `updateOnlinePayment` (`lazywaitApi.ts:926`) has no caller. Hence "can also receive". The Lazywait order payload itself carries no payment detail (`lazywait-sync` does not pass `is_paid`). `RECORD_OF_PROCESSING.md` activities 3 and 15 do not list this transfer. |
| 10 | **HOW LONG WE KEEP IT gains "Payment records: for payments made in the app, while your account is open, and never longer than the order they belong to; they are deleted when you delete your account. Any other payment record is kept no longer than the order it belongs to…"**, with two alternative wordings in brackets. | **Re-check R2:** the earlier line promised deletion for every payment record ("They are deleted when you delete your account"). That is not true of a payment made through the order-first path, which keeps its record on the anonymised order (Finding, the two order-first bullets), and that path is open to any signed-in caller of the API once online payment is on, not only to old builds (Product gap 5). The deletion promise now covers payments made in the app, which all go through a checkout session; the order bound covers the rest; the bracket gives the shorter wording if the path is closed first. What the code does today: see "Finding" below. `payment_records.order_id` is `ON DELETE CASCADE` to `orders`, so a record never outlives its order. Apart from that cascade (no function in `public` deletes an order), records are removed only by account deletion: none of the 12 live cron jobs touches `checkout_sessions` or `payment_records`, and the only functions that delete from either are `anonymize_account_data` and a race branch of `begin_checkout_session` that drops a session it inserted moments earlier, before any payment row can reference it (`20260826110000_checkout_zero_total_idempotency.sql:144-176`). That also covers a payment that never completed an order, such as a declined card (fact-check finding 5): its record has a session and no order, and lasts until the account is deleted. The old "we will never store your full card number" is kept in substance, in both WHAT WE COLLECT and this line. |
| 11 | **The PAYMENT section's last sentence no longer claims a legal obligation.** It now says the record is kept "to confirm it, to make any refund and to answer your questions about it"; the old sentence waits in a bracket. | A record deleted on the customer's request is not kept "to meet our legal obligation to keep financial records" (Finding below). What the record is used for: confirmation reads the attempt row (`moyasarVerify.ts:289-310`), a refund takes its id from the row (`order_refunds.charge_ref` is filled from `provider_ref`, `PAYMENTS.md` §2), and a duplicate payment is refunded by hand from its row (`PAYMENTS.md` §10). **Re-check R9:** the card fields themselves (network, last four) serve neither confirmation nor refund; staff see them on the order in the console (`src/components/admin/view/orders/PaymentDetails.tsx:91`), for support and reconciliation, which is the purpose the store answers draft declares for them. So "to answer your questions about it" was added, here and in the bracket's alternative. |
| 12 | **WHERE YOUR DATA IS PROCESSED: wording unchanged, behind a pre-publish gate.** | Moyasar's processing location is "Unknown from here" (`RECORD_OF_PROCESSING.md`, "Where the data goes outside the Kingdom"), and nobody has read the Moyasar agreement ("Claims the drafter could not verify", item 1). Adding Moyasar to "the providers listed above" makes the paragraph's second sentence a claim about that agreement, so it must be checked before the session. An earlier version of this draft called the paragraph "true either way"; that was not established. |
| 13 | **Version: 2.4 (minor) or 3.0 (major), an [OWNER DECISION] decided once for the set** (re-check R5). | The payment_policy and terms_conditions drafts mark their version as one decision for the four documents, and the cancellation_refund_policy draft proposes 3.0, so a fixed 2.4 here pre-empted that decision. The case for minor, unchanged: this document's convention: every content correction since the v2.0 rewrite (2026-08-18) has been a minor bump. v2.1 on 2026-09-08; v2.2 and v2.3 on 2026-09-16, and v2.3 itself *added* a processor (Apple for the iPhone reverse-geocode, `GO_LIVE_READINESS.md` A9). §43 also plans a minor bump. This change adds a processor, a data category and a purpose, but keeps the structure and every existing commitment. That is the same kind of change as v2.3's. A 3.0 would also be defensible to mark online payment; that is the owner's call. |

### Left unchanged on purpose

- **YOUR CONSENT.** Card payment is not a consent-based use. The paragraph
  already says *"We process your data to provide the ordering service you asked
  for and to meet our legal obligations"*. The PAYMENT section now rests card
  payment on the first of those grounds only, because the code deletes payment
  records with the account (Product gap 1). The second ground still covers the
  order and invoice records, which are kept. Activity 15's lawful basis in
  `RECORD_OF_PROCESSING.md`, "Contract; legal obligation (financial records)",
  overstates the second for the payment record as the code stands. This is
  engineering's reading, not counsel's.
- **The static-IP proxy is not listed as a recipient.** It sits only on the
  server's calls to `api.moyasar.com` (`supabase/functions/_shared/moyasarHttp.ts:165-180`).
  For an https target it tunnels with CONNECT, so it "relays TLS it cannot
  read" (`moyasarHttp.ts:26-29`; `OWNER_ACTIONS.md` §47.10). The proxy client is
  built with no custom certificate authority (`moyasarHttp.ts:133`), so a proxy
  that tried to decrypt the traffic would fail the certificate check, and the
  request would fail rather than be read. The proxy sees that our server talks
  to Moyasar, but no amount, reference or card field. The customer's own traffic
  to Moyasar's page never passes through it.
- **Refund triggers and timings** (automatic only for a paid order that never
  reached the POS after the customer's resends; cancellation and duplicate
  payments refunded by hand; mada about 1-3 days, credit cards about 7-14) are
  **not** in the privacy policy. They belong in `cancellation_refund_policy`
  and `payment_policy` (`OWNER_ACTIONS.md` §47.15, §47.20;
  `docs/integrations/Moyasar_API_Reference.md` §3.2). The privacy text says only
  "make any refund", which promises nothing the code does not do.
- **The 1.00 SAR minimum** is a payment term, not a privacy matter
  (`moyasar.ts:124`), so it is left to `payment_policy`.

### Finding: account deletion deletes the payment record of an app checkout

Verified in code and live, read-only, on 2026-11-13, and re-verified for this
revision. It is why the HOW LONG line and the PAYMENT section's last sentence
say what they say (Product gap 1).

- The app pays through a **checkout session** (`docs/PAYMENTS.md` §2). In the
  app, online payment opens a session and cash goes to `order-intake`
  (`apps/mobile/src/features/checkout/CheckoutScreen.tsx:770-789`), and the only
  payment call is `initiateSession` (`apps/mobile/src/services/api.ts:474`). The
  payment row is created with `checkout_session_id` set and no order
  (`20261003120000_moyasar_only_payments.sql:306-313`). On payment,
  `finalize_checkout_session` sets `order_id` and **keeps** `checkout_session_id`
  (`supabase/migrations/20260712170000_checkout_sessions_hardening.sql:362-372`).
  The live body agrees: md5 `870de938…`, it sets `order_id`, and nothing in it
  sets `checkout_session_id` to null.
- `payment_records.checkout_session_id` references `checkout_sessions`
  **`ON DELETE CASCADE`** (`supabase/migrations/20260712160000_checkout_sessions.sql:84-85`;
  live FK `payment_records_checkout_session_id_fkey`). So do
  `checkout_sessions.customer_id` → `profiles` and `profiles.id` → `auth.users`
  (live), so deleting the sign-in identity would remove them even without the
  explicit delete below.
- Account deletion's `anonymize_account_data` runs
  `delete from public.checkout_sessions where customer_id = p_user_id`, with no
  status filter (`supabase/migrations/20260919120000_security_audit_db_hardening.sql:88`;
  the live body, md5 `c44b5c79…`, has the same line). It deletes **all** of the
  customer's sessions, consumed ones included, once no session is still
  `pending_payment` (`supabase/functions/account-delete-process/index.ts:109-135`).
- So deleting an account deletes the `payment_records` row of every card payment
  made through the app: Moyasar's ids, card network, last four, authorisation
  codes, and any `duplicate_payment` row staff would need for a hand refund
  (`PAYMENTS.md` §10). The **order** survives, anonymised, with
  `payment_status = 'paid'` (`orders.customer_id` is `SET NULL`).
  `order_refunds.payment_record_id` is `SET NULL`, so a refund row keeps its own
  `charge_ref`.
- **The order-first path is the exception.** `payment-initiate` still accepts an
  order id (`index.ts:73-91`, `:395-458`). A payment made that way has an order
  and no session, so account deletion does not reach its record, which stays
  with the anonymised order (live `anonymize_account_data` neither deletes nor
  updates `payment_records`; re-read 2026-11-13). The current app never takes
  that path, and neither does an older copy of the default branch read for this
  revision (2026-09-14; at `0abfcdd` the app's `payments.initiate(orderId, …)`
  helper existed but nothing called it). Live holds 3 such rows: Tap attempts
  from 2026-07-12 that never took a payment, with no card fields and no `raw`,
  on cancelled orders. Whether any build still in customers' hands uses that
  path is not known from here ("Claims the drafter could not verify", item 9).
- **Re-check: the path is open without any old build.** Live
  `place_customer_order` is executable by `authenticated` (not `anon`), takes
  `p_payment_method` and passes it to `place_order`, which accepts `online`
  whenever `online_payment_enabled` is on (live body: `if v_pay_method =
  'online' and not v_online_on then raise`). `order-intake` calls it with the
  method the client sends (`order-intake/index.ts:307-320`). So from §47.18 on,
  any signed-in customer who calls the API directly can create an unpaid online
  order and pay it through `payment-initiate` with its order id. The record of
  that payment, card network, last four, issuer and codes included, outlives the
  account. This is `docs/readiness/20261113-card-payments-gaps.md` PG-27, and it is why the HOW LONG
  line now limits its deletion promise to payments made in the app (Product
  gap 5).
- **No live Moyasar row is affected yet.** On 2026-11-13 `payment_records` held
  9 rows, all `tap`: 6 failed with a session and no order, 3 initiated with an
  order and no session, 0 with both, and 0 from Moyasar.
- This is not a privacy breach, since it deletes more and not less. It may be a
  financial-records problem. It contradicts `docs/RECORD_OF_PROCESSING.md`
  activity 15 ("Account deletion does not clear it"), and it is wider than live
  `account_data_deletion` v2.0 says ("Your open checkout sessions"). An earlier
  version of this draft said the record is kept "to meet our legal obligation to
  keep financial records", which this finding refutes. The text now says what
  the code does, and the old wording waits in a bracket for a code change.

### Overlap with §43 (the pending location correction)

- **They do not touch the same sentences.** §43 replaces the single
  `Device location:` / `موقع الجهاز:` line in WHAT WE COLLECT. This draft
  **inserts** a new `Payment:` / `الدفع:` line in the same section, after the
  Orders line, two lines above the location line. It does not alter the
  location line, and it changes no other line §43 touches.
- **They share three things, and those are the collision points:**
  1. the **WHAT WE COLLECT block.** Pasting this draft's *full-section* text
     once §43's line is in place would undo §43. Use the single-line insert, or
     swap in §43's location line first;
  2. the **body's line 1** (effective date);
  3. the **`version` / `effective_date` columns.** Carried in the same session,
     as the plan requires, the two edits share one version and one date.
- **Timing (re-check R6).** Under the decided plan, `privacy_policy` is
  published once, in the four-document session, in both languages. The way to
  keep to that is to carry §43's line in the same session, as a separate
  `replace()` edit under the same version. `OWNER_ACTIONS.md` §43 still says
  *"The English can go first"*; that was written on 2026-11-10, before the plan
  was decided, and the two cannot both hold, so §43's timing needs the owner's
  explicit decision (Open owner decisions, item 1). This draft's edits go out
  only inside that session, and neither draft depends on the other's wording.

---

## Product gaps found

Places where the product does not do what a reasonable customer promise would
need. The text above is written to be true of the code today; where a product
change would allow different wording, the alternative is in an
`[OWNER DECISION: …]` bracket.

1. **Account deletion deletes every app card payment's record** (fact-check
   finding 1; detail in "Finding" above). The order survives, anonymised and
   marked paid; the payment record does not. Consequences:
   - the HOW LONG line and the PAYMENT section's last sentence now say so, and
     each carries the alternative wording to use if the code is changed first;
   - a duplicate payment not yet refunded loses its record: nothing refunds it
     automatically (`PAYMENTS.md` §10), and account deletion does not wait for
     it, since it waits only for active orders, unpaid online orders and
     `pending_payment` sessions (`account-delete-process/index.ts:109-116`).
     Live `account_data_deletion` v2.0 says a request "may wait if your account
     still has an active order or an unfinished financial matter";
   - live `account_data_deletion` v2.0 says only "Your open checkout sessions"
     are deleted, and "We keep completed order and financial records". That
     document is outside the decided publishing set; see "Open owner
     decisions", item 9;
   - `RECORD_OF_PROCESSING.md` activity 15 says "Account deletion does not clear
     it", which is wrong.

   Keeping payment records after deletion needs a code and migration change,
   with its own §5 approval, landed before the session. Then the bracketed
   wording replaces today's, and the deletion page and the record of processing
   are corrected.
2. **A payment that never became an order has no time limit except account
   deletion** (fact-check finding 5). A declined or abandoned attempt keeps the
   sanitized payment in `raw` (card network, last four, issuer, decline
   message), and nothing purges attempts or expired sessions. Live: 6 such
   payment records (2026-07-13 to 07-19) and 5 expired sessions with no order
   (2026-07-13 to 07-15) are still present (re-read 2026-11-13: the same 6 and
   5, plus the 1 stuck session of gap 4). The text ("while your account is
   open") is true. A purge job would allow a shorter stated period; the text
   stays true either way, because it is a maximum.
3. **The in-app copy of your data leaves out payment records** (fact-check
   finding 14). Live `export_my_data` (md5 `0edc9f73…`) reads no
   `payment_records`, `checkout_sessions` or `order_refunds`. YOUR RIGHTS says
   you can "ask us to … give you a copy", which stays true, because a request to
   support can include them. No wording change either way; the in-app copy
   should include payment records.
4. **A session stuck in `pending_payment` blocks self-service deletion**
   (fact-check aside). One live session has been in that state since
   2026-07-19, past its expiry, and nothing moves it out. A deletion request by
   that customer would wait and then go to manual review
   (`account-delete-process/index.ts:109-135`). The live sentence pointing to
   the Account and Data Deletion page stays true, because that page says a
   request needing manual review takes longer. Wider than card payment, and not
   introduced by it: an order blocks deletion until it is delivered or
   cancelled (`account-delete-process/index.ts:28`), and orders do not move past
   Received unless an administrator moves them (`docs/readiness/20261113-card-payments-gaps.md` PG-21,
   PG-23). Live on 2026-11-13, all 7 accounts that have ordered hold an order
   that is neither delivered nor cancelled (75 of 82 orders are Received), so a
   deletion request from any of them would wait 30 days and then go to manual
   review. "They are deleted when you delete your account" in HOW LONG stays
   true, because it speaks of when deletion happens, not how soon after the
   request.
5. **The order-first payment path is still open to direct API calls**
   (re-check R2; `docs/readiness/20261113-card-payments-gaps.md` PG-27). Live `place_customer_order`
   is granted to `authenticated` (live `place_order` is not) and accepts
   `online` once online payment is on; `order-intake`, the app's cash path,
   calls it with whatever method the client sends
   (`supabase/functions/order-intake/index.ts:307-320`); and `payment-initiate`
   still serves an order id (`index.ts:73-91`, `:395-458`). A payment made that
   way has an order and no checkout session, so account deletion leaves its
   record on the anonymised order (Finding, the two order-first bullets). The
   app never takes this path. The text is written to be true today: the
   deletion promise covers payments made in the app, and any other record is
   bounded by its order. Closing the path for customers (refuse
   `online` in `place_customer_order`; a small migration with its own §5
   approval, before the session) lets the bracket's shorter wording be used.
   The 3 July Tap rows on cancelled test orders are of this kind; they carry no
   card fields.

---

## Open owner decisions

1. **Version, date and §43, once for the set.** Minor (2.4, this document's
   convention) or major (3.0), decided once for the four documents published
   together, as the payment_policy and terms_conditions drafts mark it (the
   cancellation_refund_policy draft proposes 3.0). Set the publication date, the
   same for all four, in the `effective_date` column **and** in line 1 of both
   languages (`LEGAL_DOCUMENTS_AUDIT.md` §Method rule 6). Marked in the text.
   **§43:** the decided plan publishes `privacy_policy` once, in that session,
   in both languages, so §43's line belongs in the same session as a separate
   `replace()` under the same version. `OWNER_ACTIONS.md` §43 still says its
   English "can go first"; that conflicts with the plan and needs your explicit
   decision. If a `privacy_policy` version is nevertheless published before the
   session, the minor number moves on and every anchor and hash in this file
   must be re-checked.
2. **Moyasar's own record.** The repository states no retention for Moyasar.
   The bracket in HOW LONG WE KEEP IT offers the confirmed sentence if the
   Moyasar agreement supports it, and otherwise a minimum sentence that is true
   of our code today: deleting an account never asks Moyasar to delete anything
   (every Moyasar call is an invoice create, a read or a refund). Leaving
   Moyasar unstated is no longer offered. The line says payment records made in
   the app "are deleted when you delete your account", and without the
   bracket's sentence that could be read as covering Moyasar's copy too.
3. **Where Moyasar processes data.** Now a pre-publish gate in the text
   (WHERE YOUR DATA IS PROCESSED). The repository records it as unknown. If the
   agreement places processing inside the Kingdom, nothing needs adding, though
   the owner may add a sentence. If it places any of it outside, the paragraph
   holds only if the agreement carries data protection commitments, and the
   Transfer Regulation duties in `RECORD_OF_PROCESSING.md` (a safeguard plus a
   prior risk assessment) apply to Moyasar. That is counsel's item
   (`OWNER_ACTIONS.md` §44 item 5).
4. **Naming the methods, and Apple Pay (both decided once with the
   payment_policy draft, its items 2 and 7, and the store answers).** The draft
   names mada, Visa and Mastercard, per the owner's 2026-11-11 answer
   (`PAYMENTS.md` line 15). These are Moyasar dashboard settings and can drift
   from the policy, so the list carries the payment_policy draft's gate: publish
   it only once Moyasar has confirmed in writing that SADAD, STC Pay and any
   unnamed scheme are off for invoices (`OWNER_ACTIONS.md` §47.19). **Apple
   Pay is not named by default** (re-check R1): its only proof is the device
   check in `RELEASE_CHECKLIST.md` §7, which needs online payment on, so it
   cannot pass before the session. The bracket gives option (b), naming it now
   with "where the app shows it", in both languages. Leaving it out says
   nothing false if Moyasar's page shows Apple Pay before a later version names
   it: Apple Pay only passes card details to Moyasar, from the customer's own
   device, and the card number still never reaches us.
5. **Payment-record deletion on account deletion** (Product gap 1), **and the
   order-first path** (Product gap 5). Decide whether a card payment's record
   must survive account deletion as a financial record, and whether to close
   the order-first path to customers. The text states today's behaviour, and
   three brackets carry the wording for the other answers. Any code and
   migration change, with its own approval, must land **before** the session;
   otherwise publish today's wording. Either way, correct
   `RECORD_OF_PROCESSING.md` activity 15 ("Account deletion does not clear
   it").
6. **Refund behaviour** (`OWNER_ACTIONS.md` §47.20) stays open. The privacy text
   is written not to depend on it ("make any refund"). It also does not depend
   on the cancellation_refund_policy draft's D4 (whether a card-paid refund may
   be settled in cash at the branch; the payment_policy draft's item 5): the WHO
   line says Moyasar "returns refunds to the card or payment method you paid
   with", which stays true either way (re-check R3).
7. **Moyasar's Arabic name, and its gender across the set.** The live Arabic
   writes every provider in Latin script, so the draft writes "Moyasar".
   Whether to add the brand's Arabic form (ميسر) is for the native reader. It is
   marked by a bracket in the Arabic Moyasar line. **Re-check R11:** this draft
   makes Moyasar feminine where it is the subject (تمنحها، ترسله، تعالج،
   وتحتفظ), as the live text treats Google; the payment_policy draft makes it
   masculine («يقدّم خدمة الدفع الإلكتروني Moyasar»، «بعد أن يؤكد Moyasar»).
   One choice for the four documents.
8. **Publishing: one session, four documents, both languages.**
   `privacy_policy`, `payment_policy`, `cancellation_refund_policy` and
   `terms_conditions` are written in one owner-approved session, in both
   languages, and then the production rebuild runs, so that the no-JavaScript
   `legal.html` and `/privacy` carry them (`LEGAL_DOCUMENTS_AUDIT.md` §Method
   rule 7). Both steps come **before** §47.18. `OWNER_ACTIONS.md` §47.15 lists
   only the first three documents and must add `terms_conditions`: its PAYMENT
   line, *"Orders are paid in cash at pickup or on delivery. See the Payment
   Policy."*, contradicts this text from §47.18 on. Its new wording belongs in
   its own draft, not here. Closing `RECORD_OF_PROCESSING.md` finding 6 follows.
9. **`account_data_deletion` is outside the publishing set, and its wording is
   narrower than the code.** It says "Your open checkout sessions" are deleted,
   while the code deletes all of them and, with them, their payment records. It
   also says "We keep completed order and financial records", which a reader may
   take to include payment records. YOUR RIGHTS in this policy points to that
   page unchanged. Decide whether to correct it in the same session, or to
   change the code (item 5).
10. **Cash with or without a condition, once for the set** (the terms_conditions
    draft's item 2). This draft hedges cash ("Where the app offers it, you can
    pay in cash …"), which stays true if `cash_payment_enabled` is switched
    off; the payment_policy and terms_conditions drafts state cash without a
    condition, which is true today and false once cash is off. No change is
    needed here either way: the hedged wording is true in both states. If the
    set is aligned, align the other two to this one, as the terms draft offers.

---

## Claims the drafter could not verify

1. **Where Moyasar stores and processes data, and for how long.** Neither is in
   the repository. `RECORD_OF_PROCESSING.md` says "Unknown from here". Both are
   now gated by brackets.
2. **The exact fields on Moyasar's hosted page** (for example, whether it asks
   for the name on the card or an email address). They are not in the
   repository. The draft says "card details" and does not list them. The
   `Payment:` line says what Moyasar sends us "can also include … the name on
   the card", because the repository's model of a Moyasar payment carries it
   and the sanitizer drops it (`moyasar.test.ts:647-657`, `:668-676`); whether
   the page collects it is not known.
3. **That Moyasar's reply carries the payer's IP address and the first six
   digits** is taken from the sanitizer's comments (`moyasar.ts:728-730`,
   `:740`) and its test, not from a real Moyasar response.
   `Moyasar_API_Reference.md` §12 records that no request had been sent to
   Moyasar with this code. Since then, sandbox traffic has reached our server.
   `integration_sync_logs` holds one webhook verification event at 18:21 UTC on
   2026-11-13 and 8 "unknown payment" webhook events between 18:24 and 18:58 UTC,
   which fits the console's sandbox test (§47.9). Only ids are stored from them,
   so the fields of a real Moyasar payment still cannot be read from here. The
   wording ("can also include") holds whatever Moyasar sends. "Like any web
   page…" holds because a browser always sends its IP to the server it loads
   from.
4. **That the hosted runtime honours the proxy at all.** This rests on the
   edge-runtime source (CONNECT tunnelling, `moyasarHttp.ts:20-37`), not on
   Supabase documentation. If the runtime cannot honour it, the code refuses to
   send, so nothing goes out unproxied. Whether the proxy could read the traffic
   is narrower than an earlier version of this item said. The client is built
   with no custom certificate authority (`moyasarHttp.ts:133`), so a proxy that
   decrypted TLS would fail the certificate check and the request would fail
   rather than be read. The recommended service, QuotaGuard Shield
   (`docs/integrations/Moyasar_Static_IP_Proxy.md` §2), states that it does not decrypt the tunnel
   (§6). No service has been chosen yet (§47.10).
5. **That mada, Visa, Mastercard and Apple Pay are enabled** is the owner's
   statement (`PAYMENTS.md` line 15), not something the repository can read from
   the Moyasar account. That SADAD and STC Pay are off is unconfirmed (§47.19).
6. **Apple Pay on Moyasar's hosted invoice inside the app's WebView** is
   unconfirmed by Moyasar (`PAYMENTS.md` §5, §11 Q1). It is a device release
   gate that can only be run once online payment is on (`RELEASE_CHECKLIST.md`
   §7, "They need online payment switched on and Moyasar in live mode"), which
   is why the default text does not name Apple Pay (re-check R1).
7. **The lawful bases** ("complete the order you asked for") are engineering's
   reading, consistent with v2.3's framing. The PAYMENT section no longer claims
   the legal-obligation ground for payment records (Product gap 1). Counsel has
   not reviewed this (`OWNER_ACTIONS.md` §44).
8. **The Arabic** is engineering-drafted. It reuses the live document's own
   phrasing where it can (مزوّد، نظاماً، في أي حال، Latin provider names), but
   it has had **no native read**. Points for the reader:
   - **Gender of "Moyasar".** Where Moyasar itself is the subject, the verb is
     feminine (تمنحها Moyasar، ما ترسله إلينا Moyasar، تعالج، وتحتفظ Moyasar،
     تؤكد Moyasar), as the live text treats Google (تعرض Google الخريطة
     وتتلقى). Where the verb follows «مزوّد», it is masculine (Moyasar — مزوّد
     الدفع الإلكتروني لدينا، ويتولى), as the live Lazywait line follows «نظام»
     (ويستقبل). The first version mixed the two with Moyasar as the subject
     (يمنحها Moyasar beside وتحتفظ Moyasar). The payment_policy draft makes
     Moyasar masculine; one choice for the set (open owner decision 7).
   - «شبكة البطاقة» for "card network", «ولا نجمع» to match "collect", «قد
     يستقبل» for "can also receive", «فنتخلّص منها دون تخزينها» for "we discard
     those without storing them".
   - Added by the re-check: «أبداً» in «فلا يصل إلينا رقم بطاقتك كاملاً ولا رمز
     الأمان أبداً» for "never reach us", byte-for-byte the payment_policy
     draft's clause; «ما ترسله إلينا Moyasar» for "What Moyasar sends us";
     «وإعادة المبالغ المستردة إلى البطاقة أو وسيلة الدفع التي دفعت بها», after
     the cancellation_refund_policy draft's «إلى البطاقة أو وسيلة الدفع التي
     دفعت بها»; «وللرد على استفساراتك بشأنها»; and in HOW LONG «للدفعات التي
     تتم في التطبيق» and «وأي سجل دفع آخر», where «يخصّه» is masculine to agree
     with «سجل».
   - The cash sentence puts «حيث يتيح التطبيق ذلك» at the end, so that the
     section does not open with «و».
   - The Arabic name of Moyasar (open owner decision 7).
9. **Whether any app build in customers' hands still pays through the
   order-first path.** The current app does not, and neither does an older copy
   of the default branch (2026-09-14). `order-intake` existed by 2026-07-10
   (`20260710180000_lazywait_sync_one.sql:3`), two days before checkout sessions,
   and the 3 order-first rows date from 2026-07-12. If such a build is still in
   use, a payment made from it keeps its record with the order after account
   deletion. Since the re-check, HOW LONG promises deletion only for "payments
   made in the app", and bounds any other record by its order, because the path
   is also open to any signed-in caller of the API (Product gap 5). A build that
   still paid order-first would count as "in the app", so the promise holds only
   if no such build is in use: if one is found, apply Product gap 5's fix before
   the session (closing the path on the server covers old builds too).

---

## Fix log

One line per finding in `docs/readiness/20261113-card-payments-reviews/privacy_policy.review.md`. Each was re-checked
in the repository export or with read-only SQL on 2026-11-13 before it was
applied.

- **1 (blocking) → fixed, with an owner decision.** Re-verified live: both FKs `ON DELETE CASCADE`; `anonymize_account_data` (md5 `c44b5c79…`) deletes every session; `finalize_checkout_session` (md5 `870de938…`) keeps `checkout_session_id`. HOW LONG and the PAYMENT section's last sentence now say what the code does, and brackets carry the "keep" wording (Product gap 1). Because the line now says records "are deleted", the Moyasar-retention bracket no longer offers leaving Moyasar unstated (Open owner decisions, item 2). Exception recorded: order-first records (3 live Tap rows, no card data) are not reached by account deletion. *Amended by re-check R2: that path is open to the API, so the HOW LONG line now limits its deletion promise to payments made in the app.*
- **2 (blocking, publishing plan) → fixed.** The header states the decided plan: four documents, both languages, one owner-approved session, before §47.18. The old header's two sentences allowing this text to go out ahead of the others, or in English first, are removed. Live `payment_policy` (md5_en `0f883dcd…`) and `cancellation_refund_policy` (md5_en `5a67d9d5…`) re-read and quoted. *Amended by re-check R6: the §43 text that still let this document be published before the session is removed too.*
- **3 (should-fix) → fixed, with an owner decision.** "Apple Pay on iPhone where the app shows it", plus a bracket tied to the `RELEASE_CHECKLIST.md` §7 device check, matching the `payment_policy` draft. Re-verified: `enableApplePay` at `checkout.tsx:187` (iOS only); builds in the field use the system browser (`PAYMENTS.md` §5). *Superseded by re-check R1: Apple Pay is no longer named by default, and the hedged wording is option (b) of the bracket.*
- **4 (should-fix) → fixed.** Lazywait line keeps its v2.3 sentence and gains "If you pay online, it can also receive the amount paid and Moyasar's reference for the payment." The review's "receives" became "can also receive", because the push is sent only when the POS already holds the order (`paymentSync.ts:46`), and nothing sends it later.
- **5 (should-fix) → fixed.** Covered by finding 1's line ("while your account is open"), and the bracket's alternative wording names declined payments. Re-verified live: 6 session-only payment records and 5 expired order-less sessions from July; no purge job among the 12 cron jobs. Listed as Product gap 2.
- **6 (should-fix) → fixed in the publishing plan.** `terms_conditions` is in the four-document session; live line 17 ("Orders are paid in cash at pickup or on delivery. See the Payment Policy.") re-read. Its new wording belongs to its own draft, so none is written here. `OWNER_ACTIONS.md` §47.15 must add it (Open owner decisions, item 8).
- **7 (should-fix) → owner decision.** WHERE YOUR DATA IS PROCESSED keeps its wording and now carries a pre-publish gate in both languages. "Moyasar | Unknown from here" re-read in `RECORD_OF_PROCESSING.md`.
- **8 (nit) → fixed.** Cash is now "where the app offers it". Re-verified: `cash_payment_enabled` is an admin switch (live true), enforced in `place_order`; `payment.ts:6` says cash is "NEVER assumed".
- **9 (nit) → fixed.** «ولا نجمع رقم بطاقتك كاملاً أبداً», matching the English, now a full sentence: "We never collect your full card number."
- **10 (nit) → fixed.** "the language you use the app in" / «ولغة استخدامك للتطبيق». Re-verified: no language field in the invoice body (`moyasar.ts:336-354`); `lang` only on the page URL (`:384`).
- **11 (nit) → fixed.** "If you use Apple Pay, your card details reach Moyasar through Apple Pay, under Apple's own terms." The review's "your card" became "your card details", to match the sentence before it. The sentence is inside the Apple Pay bracket.
- **12 (nit) → fixed, partly.** Added: the payment method; the received-and-discarded sentence (first six digits, name on the card, IP address; `moyasar.ts:740`, `moyasar.test.ts:668-676`); "card type" became "card network". Not added, by decision: Moyasar's fee, which is Moyasar's charge to us, not data about the customer.
- **13 (nit) → fixed; the review's example rejected.** The review's example (WHO «ويتولى» against HOW LONG «وتحتفظ») is not an inconsistency: «ويتولى» agrees with «مزوّد», as the live Lazywait line does with «نظام». The real one was «يمنحها Moyasar» (masculine, Moyasar as subject) against «وتحتفظ Moyasar». It is now «تمنحها», feminine as the live text treats Google. The ميسر decision is now a bracket in the Arabic Moyasar line.
- **14 (nit, code follow-up) → no wording change, product gap.** Re-verified: live `export_my_data` (md5 `0edc9f73…`) reads no payment table. "Ask us" stays true. Listed as Product gap 3.
- **15 (nit) → fixed.** The proxy claim is narrowed in "Left unchanged on purpose" and "Claims the drafter could not verify", item 4. Re-verified: `moyasarHttp.ts:133` passes no custom certificate authority; `proxy_comparison.md` §2 recommends QuotaGuard Shield, and §6 quotes "neither Static nor Shield decrypts your payload".
- **Aside (stuck `pending_payment` session) → listed as Product gap 4**, no wording change. Re-verified live: 1 session in `pending_payment` since 2026-07-19.

### Re-check (independent checker, 2026-11-13, evening)

Every line of the previous revision's "Proposed text" was re-verified against
the default branch at `04eb351`, against Production with read-only SQL (live
`legal_documents` rows read as base64 and decoded locally, so both privacy md5s
were reproduced exactly; `integration_settings` payment row `moyasar`, enabled,
mode `test`; `online_payment_enabled` false, `cash_payment_enabled` true), and
against the sibling drafts as last saved (`payment_policy.md` 22:42,
`terms_conditions.md` 22:41, `store_answers.md` 22:32,
`cancellation_refund_policy.md` 22:53, whose D4 and version lines were re-read
after it changed, `product_gaps.md` 22:04). Nothing was written anywhere except
this file.

- **re-check: original findings 1-15 and the aside → confirmed fixed as logged**,
  with three amendments. Every cited line and live fact was re-read: both FKs
  `ON DELETE CASCADE`; `anonymize_account_data` md5(prosrc) `c44b5c79…` deletes
  every session and neither deletes nor updates `payment_records`;
  `finalize_checkout_session` `870de938…` never nulls `checkout_session_id`;
  only `anonymize_account_data` and `begin_checkout_session` delete from
  `checkout_sessions`, and no function or Edge Function deletes from
  `payment_records`; 12 cron jobs, none on either table; `payment_records` 9 `tap` rows (6 failed with a
  session, 3 initiated with an order); `export_my_data` `0edc9f73…` reads no
  payment table; `paymentSync.ts:41-84` sends `Trans_Amount`, `Approval_No`,
  `Card_Type`, only when `lazywait_ref` is set; the invoice body, the refund
  body and the GET calls are as row 3 says. Amendments: finding 1's line was
  still too wide (R2); finding 2's plan still let §43 publish this document
  early (R6); finding 3's bracket was overtaken by the sibling draft (R1).
- **re-check: R1 (should-fix) Apple Pay named by default, behind a condition
  that cannot be met → fixed.** The bracket kept Apple Pay "only if the Apple
  Pay device check in RELEASE_CHECKLIST.md §7 passes", and that check needs
  online payment on (`RELEASE_CHECKLIST.md:164-166`; `OWNER_ACTIONS.md` §47.18
  step 2), so it cannot pass before the session. The payment_policy draft now
  defaults to not naming Apple Pay (its item 2, option (a)) and asks for "the
  same choice in the privacy_policy draft", while this draft named it in both
  languages: the four documents would have disagreed. PAYMENT no longer names
  Apple Pay; the bracket gives option (b) in both languages, and "What changed
  and why" row 1, Open owner decisions item 4 and Claims item 6 say so.
- **re-check: R2 (should-fix) "They are deleted when you delete your account"
  was not true of every payment record → fixed, with an owner decision.** The
  order-first path keeps its record on the anonymised order, and it is not only
  an old-build question: live `place_customer_order` (granted to
  `authenticated`) accepts `online` once online payment is on, `order-intake`
  forwards whatever method the client sends (`order-intake/index.ts:307-320`),
  and `payment-initiate` serves an order id (`index.ts:395-458`). HOW LONG now
  promises deletion for payments made in the app and bounds any other record
  by its order; Product gap 5 is new, with a bracket for the shorter wording if
  the path is closed first. The Product gap 1 bracket's alternative was
  reworded ("belongs to no order") so it stays true with the path open.
- **re-check: R3 (should-fix) "Moyasar … makes any refund" hung on an open
  decision in another document → fixed.** The cancellation_refund_policy
  draft's D4 (and the payment_policy draft's item 5) may let a card-paid refund
  be settled in cash at the branch; then "any refund" is false. Now "returns
  refunds to the card or payment method you paid with" / «وإعادة المبالغ
  المستردة إلى البطاقة أو وسيلة الدفع التي دفعت بها», the siblings' own phrase,
  true either way.
- **re-check: R4 (should-fix) the method list had no gate while the
  payment_policy draft's identical list has one → fixed.** The invoice request
  sends no method field (`moyasar.ts:336-354`), so Moyasar's dashboard decides
  what the page offers, and that SADAD, STC Pay and other schemes are off is
  unconfirmed (§47.19). The payment_policy draft's methods bracket is now in
  PAYMENT, in both languages.
- **re-check: R5 (nit) version fixed at 2.4 while the set decides it once →
  fixed.** Now "[OWNER DECISION: 2.4 (minor) or 3.0 (major) …]", the
  terms_conditions draft's form.
- **re-check: R6 (should-fix) text allowing this document out early →
  fixed.** "§43 can be published before the four-document session" and "v2.4
  if this goes first; v2.5 if §43 goes first" let `privacy_policy` be published
  outside the decided session, and `OWNER_ACTIONS.md` §43 still says its
  "English can go first". Both are gone from this file; §43's line is to be
  carried in the session, and the conflict with §43 is an owner decision (Open
  owner decisions, item 1; "Overlap with §43").
- **re-check: R7 (nit) the Arabic dropped "never" → fixed.** «فلا يصل إلينا
  رقم بطاقتك كاملاً ولا رمز الأمان» became «… ولا رمز الأمان أبداً», for "never
  reach us", byte-for-byte the payment_policy draft's clause.
- **re-check: R8 (nit) "Moyasar's reply" missed the webhook → fixed.** The
  payment object also arrives unasked (`payment-webhook/index.ts:131-133`) and
  only its ids are kept. Now "What Moyasar sends us" / «ما ترسله إلينا Moyasar».
- **re-check: R9 (nit) a purpose of the payment record was missing → fixed.**
  Staff see the card network and last four on the order
  (`PaymentDetails.tsx:91`), for support and reconciliation, the purpose the
  store answers declare; confirmation and refund do not use those fields. Added
  "and to answer your questions about it" / «وللرد على استفساراتك بشأنها», also
  in the bracket's alternative.
- **re-check: R10 (nit) cash hedged here, unhedged in two siblings → owner
  decision, no text change.** Open owner decisions, item 10, with the
  terms_conditions draft's item 2. This draft's hedged sentence is true whether
  cash is on or off.
- **re-check: R11 (nit) Moyasar is feminine here and masculine in the
  payment_policy draft → owner decision (native read), no text change.** Open
  owner decisions, item 7; Claims, item 8. (The payment_policy draft's note that
  this draft "mixes genders" predates the earlier fix: within this draft the
  choice is now consistent.)
- **re-check: R12 (nit) the evidence paragraph miscounted → fixed.** Its "76
  distinct unchanged lines" included the 3 per language that are replaced, and
  "Two lines appear twice" was three. Corrected, and the rebuild check added
  ("Current (live) text").
- **re-check: R13 (nit) Product gap 4 understated → context added, no text
  change.** Live: all 7 accounts that have ordered hold an order neither
  delivered nor cancelled (75 of 82 Received), so every deletion request from
  them waits 30 days for manual review (`docs/readiness/20261113-card-payments-gaps.md` PG-21, PG-23).
- **re-check: checked and kept, with evidence.** "Like any web page … IP
  address" (the WebView loads Moyasar directly, `checkout.tsx:156`, no injected
  JavaScript); "the language you use the app in" (`payment-initiate/index.ts:49`,
  `moyasar.ts:384`; the old builds send it too); the Lazywait sentence; "We do
  not send Moyasar your name, mobile number, email address or delivery address"
  (no customer field in `buildInvoicePayload`, metadata has no extra keys at
  either call site); "WHERE YOUR DATA IS PROCESSED" gate; the Moyasar-record
  bracket's minimum sentence (no code path asks Moyasar to delete).
- **re-check: notes for the sibling drafts (not edited here).** The store
  answers call this "privacy policy 2.4" (lines 32, 730, 744, 758); the number
  is now the set's decision. Their Play Data safety rows still describe the
  same fields this draft lists, and their "card or Apple Pay payment attempt"
  stays a true statement of data even with Apple Pay unnamed here.
