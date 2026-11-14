# Payment policy: card payment through Moyasar (draft)

> **Status: DRAFT, engineering-written 2026-11-13, revised the same day against
> the fact-check in `docs/readiness/20261113-card-payments-reviews/payment_policy.review.md` (see "Fix log" at
> the end), then re-checked independently against the code, the live rows and
> the sibling drafts and revised again (the "re-check:" lines at the end of the
> Fix log; findings R1 to R13). Not reviewed by counsel. Not published.**
> Editing a live `legal_documents` row is a CLAUDE.md §5 action, and so is
> turning online payment on. This file holds the exact text and the evidence
> behind it, so publishing can be a copy-paste in the admin console.
>
> **The Arabic needs a native read** before it is published. It is
> engineering-drafted Modern Standard Arabic, written to match the register of
> the live Arabic document. Points for the reader are listed under "Open owner
> decisions", item 9.
>
> **Scope.** Only what card payment requires. Three blocks change in each
> language: line 1 (the date), HOW YOU PAY, and the section IF ONLINE PAYMENT IS
> ADDED, which is replaced by PAYING ONLINE in the same position. PRICES AND VAT,
> PAYING IN CASH and CONTACT stay byte-for-byte as they are.
>
> **Publishing plan (proposed; the owner decides).** `privacy_policy`, `payment_policy`,
> `cancellation_refund_policy` and `terms_conditions` are published
> **together, in both languages, in one owner-approved session**, before
> `OWNER_ACTIONS.md` §47.18 (online payment on). This document is never
> published alone, and never in English first. The store answers and the
> listing copy change in the same window. Why it cannot go alone: v2.0 promises
> *"If we add card payment, we will name the provider in this policy and in the
> Privacy Policy before the option appears in the app."*; the new text points at
> the Privacy Policy and the Cancellation & Refund Policy, whose live versions
> say card payment is not available; and the live Terms & Conditions say
> *"PAYMENT / Orders are paid in cash at pickup or on delivery. See the Payment
> Policy."*, which `docs/legal/TERMS_CONDITIONS_CARD_PAYMENTS_DRAFT.md` changes (its PAYMENT line reuses
> this draft's HOW YOU PAY wording, so the two change together). Where online
> payment is offered is always stated conditionally ("where the app offers it",
> "Where it is offered"), so the text stays true between that session and
> §47.18, while online payment is still off.

---

## Current (live) text

Read-only from Production (`public.legal_documents`, `document_type =
'payment_policy'`, `is_active = true`) on **2026-11-13**:

- **version `2.0`**, `effective_date` **2026-08-18**, title "Payment Policy" /
  «سياسة الدفع». It is the only `payment_policy` row;
- `md5(content_en)` = `0f883dcd595250c2a6139d267a55008c` (1 267 characters);
- `md5(content_ar)` = `44e5b1f44f5a6ae8bb72e53eb9daefe9` (1 091 characters).

The text below was rebuilt locally and hashed: both hashes match the live row
exactly, so the quotes are byte-exact. Re-read both hashes before publishing. If
either has moved, something was published since this draft and the anchors must
be re-checked.

Live context, read the same day: `app_settings.online_payment_enabled` is
**false**, `cash_payment_enabled` is **true**; the payment row is provider
`moyasar`, enabled, mode `test`, currency `SAR`, `invoice_expiry_minutes` 30, no
`statement_descriptor` (row last written 2026-11-13 18:17 UTC).

### English (v2.0): the three blocks that change

**Line 1**

```
Effective date: 18 August 2026
```

**HOW YOU PAY: replaced in full**

```
HOW YOU PAY
Orders placed in the Spicy Meal app are paid in cash — at the counter when you collect a pickup order, or to the driver when a delivery order arrives.
Online card payment is not currently available in the app. The payment option shown at checkout is the one that applies to your order.
```

**IF ONLINE PAYMENT IS ADDED: replaced in full by PAYING ONLINE**

```
IF ONLINE PAYMENT IS ADDED
We have not yet selected an online payment provider. If we add card payment, we will name the provider in this policy and in the Privacy Policy before the option appears in the app, and we will never store your full card number.
```

### Arabic (v2.0): the three blocks that change

**السطر الأول**

```
تاريخ السريان: ١٨ أغسطس ٢٠٢٦
```

**كيف تدفع: replaced in full**

```
كيف تدفع
تُدفع الطلبات المقدَّمة عبر تطبيق سبايسي ميل نقداً، عند الكاشير حين تستلم طلب الاستلام، أو للسائق عند وصول طلب التوصيل.
والدفع الإلكتروني بالبطاقة غير متاح حالياً في التطبيق. وخيار الدفع الظاهر عند إتمام الطلب هو الخيار المطبّق على طلبك.
```

**في حال إضافة الدفع الإلكتروني: replaced in full by الدفع الإلكتروني**

```
في حال إضافة الدفع الإلكتروني
لم نختر بعد مزوّد دفع إلكتروني. وإذا أضفنا الدفع بالبطاقة، فسنذكر اسم المزوّد في هذه السياسة وفي سياسة الخصوصية قبل ظهور الخيار في التطبيق، ولن نخزّن رقم بطاقتك كاملاً في أي حال.
```

### Unchanged, for the "nothing else moved" check

PRICES AND VAT plus PAYING IN CASH, as one span (the two sections joined by the
blank line between them):

| Language | md5 | Characters |
| --- | --- | --- |
| English | `5ea1459e18282190d00a0acec79f4b76` | 635 |
| Arabic | `23beff8ef6513c2c01288900eb2b20ef` | 559 |

CONTACT: English `dfae48ec7766c9bc9b37eb3887140888`, Arabic
`d2b164ce48320136585565e3ade3c9c9`. Take these hashes around line 1, not over
it (`LEGAL_DOCUMENTS_AUDIT.md` §Method rule 6).

---

## Proposed text

**Version: `[OWNER DECISION: 2.1 or 3.0, decided once for all four documents
published together]`** (reasoning under "What changed and why", row 15, and
Open owner decisions, item 1). Set `effective_date` to the publication date,
and put the **same** date in line 1 of both languages.

Three edits per language, each a `replace()` of one whole block above with the
block below (`LEGAL_DOCUMENTS_AUDIT.md` §Method rule 4). Each old block occurs
exactly once in the live text (checked). Sections stay in the same order:
line 1, HOW YOU PAY, PRICES AND VAT, PAYING IN CASH, PAYING ONLINE, CONTACT.

Text in `[OWNER DECISION: …]` brackets must be settled and the brackets removed
before publishing. Each bracket sits after the sentence it governs, and the text
around it is already true of the code today; a bracket shows where the wording
changes if the owner decides differently. Nothing else in the proposed text is a
placeholder.

### English

**Line 1**

```
Effective date: [OWNER DECISION: publication date, e.g. 20 November 2026]
```

**HOW YOU PAY**

```
HOW YOU PAY
Orders placed in the Spicy Meal app can be paid in cash — at the counter when you collect a pickup order, or to the driver when a delivery order arrives — or, where the app offers it, online, as part of placing your order.
Online payment accepts mada, Visa and Mastercard cards. [OWNER DECISION (methods): publish this list only once Moyasar has confirmed in writing that SADAD, STC Pay and any card scheme not named here (for example American Express) are switched off for invoices on this account (OWNER_ACTIONS.md §47.19). If one is on, have it switched off first, or name it here and re-check every sentence of PAYING ONLINE against it: a SADAD payment stays on hold for days and cannot be refunded.] [OWNER DECISION (Apple Pay): this text does not name Apple Pay, because the only proof that it works inside the app is the device check in OWNER_ACTIONS.md §47.18 step 2, which needs online payment switched on, after this text must already be live. (a) Recommended: publish as it is, and name Apple Pay in a later version once that check has passed. (b) Name it now, accepting that it is unverified at publication: change this sentence to "Online payment accepts mada, Visa and Mastercard cards, and Apple Pay on iPhone where the app shows it.", and in PAYING ONLINE add "On iPhone, where the app shows it, you can use Apple Pay on that page instead." after the sentence beginning "You enter your card details". The refund sentence needs no change either way. Make the same choice in the privacy_policy draft and the store answers.] Where it is offered, online payment is available only in the app on iPhone and Android, not in the web version of the app. The payment options shown at checkout are the ones available for your order.
```

**PAYING ONLINE** (replaces IF ONLINE PAYMENT IS ADDED, in the same position)

```
PAYING ONLINE
Online payment is provided by Moyasar, our payment provider. When you place an order with online payment, the app opens Moyasar's secure payment page. You enter your card details on that page, and they go to Moyasar directly, not through us: your full card number and security code never reach us, and we never store them. Your bank may ask you to confirm the payment on its own page.
Online payments are charged in Saudi Riyals, for the total confirmed by our system at checkout. Online payment needs an amount to pay of at least SAR 1.00. If redeeming your points leaves an amount to pay above zero but below SAR 1.00, switch off points redemption for this order or pay in cash. You cannot choose to use only some of your points. [OWNER DECISION (points used): this sentence no longer says how many points are used. The live Offers & Loyalty Terms say "your whole available balance is applied, up to the value of the order", but today no points are used at all when fewer whole points than the redemption minimum (100 live, worth SAR 10.00) fit the order (Product gaps, PAY-3; gap PG-31). If the server is changed first so that the minimum applies only to the balance held, this sentence may become: "You cannot use only some of your points: when you use them, your whole available balance is applied, up to the value of the order."] If your points cover the whole order, nothing is charged and no payment page opens.
An order you pay for online is placed only after we have checked directly with Moyasar that your payment went through for the right amount. Until then there is no order, and nothing is sent to the branch. Once your payment is confirmed, you have a record of the order in your Orders tab, and the branch's order number appears in the app as soon as the branch issues it.
If your payment is declined, or the payment page expires before you pay, no payment is taken and no order is placed; your cart stays in the app, so you can try again or, where it is offered, pay in cash. If you close the payment page without paying, no payment is taken and no order is placed, but that payment stays open: until the payment page expires, the app takes you back to it when you return to checkout or place an order, even if you choose cash. If we cannot reach Moyasar to check a payment, the app keeps it open in the same way until we can, even after a decline or after the payment page expires. [OWNER DECISION (closing the payment page): this is what the app does today; it keeps a closed, unpaid payment open so that it cannot be paid alongside a second order, and it treats a payment that cannot be checked as still open. If the app is changed first so that a customer can end such a payment and pay in cash straight away, replace the sentence beginning "If you close the payment page" with: "If you close the payment page without paying, no payment is taken and no order is placed; your cart stays in the app, so you can try again or, where it is offered, pay in cash.", and delete the sentence beginning "If we cannot reach Moyasar" if the same change lets a customer end a payment that cannot be checked.]
If money is taken from your card but the app could not confirm your payment, or you are charged twice for one order, contact us using the details below, with the date, time and amount of the payment, and your order number if you have one. Never send us your full card number. [OWNER DECISION (refund promise; decide once, with cancellation_refund_policy D2 and D3): no refund is promised here, because nothing alerts staff to these payments and each is refunded by hand in the Moyasar dashboard. The Cancellation & Refund Policy draft currently promises one ("we will refund it once we have confirmed it with Moyasar"). Settle that sentence once; if a promise is also wanted here, add the same words, with a time limit only if staff can keep it.]
Any refund of an online payment goes back to the card or payment method you paid with, through Moyasar. [OWNER DECISION (cancellation_refund_policy D4): keep this sentence only if a card-paid refund is never settled in cash at the branch; if it may be, use the wording chosen for D4 in both documents.] Our Cancellation & Refund Policy explains when refunds are made and how long they take.
Our record of an online payment includes the card network (for example mada or Visa) and the last four digits of the card, never your full card number. Our Privacy Policy, which also names Moyasar, explains what we keep about an online payment and what we share with Moyasar.
```

### Arabic (needs a native read)

**السطر الأول** (Arabic-Indic digits, as in v2.0)

```
تاريخ السريان: [OWNER DECISION: تاريخ النشر، مثل ٢٠ نوفمبر ٢٠٢٦]
```

**كيف تدفع**

```
كيف تدفع
يمكن دفع قيمة الطلبات المقدَّمة عبر تطبيق سبايسي ميل نقداً، عند الكاشير حين تستلم طلب الاستلام، أو للسائق عند وصول طلب التوصيل. ويمكن أيضاً، حيث يتيح التطبيق ذلك، دفعها إلكترونياً أثناء تقديم الطلب.
ويقبل الدفع الإلكتروني بطاقات مدى وVisa وMastercard. [OWNER DECISION (وسائل الدفع): لا تُنشر هذه القائمة إلا بعد أن تؤكد Moyasar كتابياً أن SADAD وSTC Pay وأي شبكة بطاقات غير مذكورة هنا (مثل American Express) معطّلة للفواتير في هذا الحساب (OWNER_ACTIONS.md §47.19). وإن كان أيٌّ منها مفعّلاً، فيُعطَّل أولاً، أو يُذكر هنا وتُراجَع كل جملة في قسم الدفع الإلكتروني في ضوئه، فدفعة SADAD تبقى معلّقة أياماً ولا يمكن استردادها.] [OWNER DECISION (Apple Pay): لا يذكر هذا النص Apple Pay، لأن الدليل الوحيد على عمله داخل التطبيق هو فحص الجهاز في الخطوة ٢ من OWNER_ACTIONS.md §47.18، وهو يتطلب تشغيل الدفع الإلكتروني، أي بعد أن يكون هذا النص قد نُشر. (أ) المقترح: يُنشر النص كما هو، ويُذكر Apple Pay في نسخة لاحقة بعد نجاح الفحص. (ب) ذكره الآن مع قبول أنه غير مُتحقَّق منه عند النشر: تصبح هذه الجملة «ويقبل الدفع الإلكتروني بطاقات مدى وVisa وMastercard، وكذلك Apple Pay على iPhone حيث يعرضه التطبيق.»، وتُضاف في قسم الدفع الإلكتروني الجملة «ويمكنك على iPhone، حيث يعرضه التطبيق، استخدام Apple Pay في تلك الصفحة بدلاً من ذلك.» بعد الجملة التي تبدأ بـ «وتُدخل بيانات بطاقتك». ولا تحتاج جملة الاسترداد إلى تغيير في الحالتين. ويُتخذ الخيار نفسه في مسودة سياسة الخصوصية وفي إجابات المتاجر.] وحيث يُتاح الدفع الإلكتروني، فإنه يتوفر في التطبيق على iPhone وAndroid فقط، ولا يتوفر في نسخة الويب من التطبيق. وخيارات الدفع الظاهرة عند إتمام الطلب هي الخيارات المتاحة لطلبك.
```

**الدفع الإلكتروني** (replaces في حال إضافة الدفع الإلكتروني, in the same position)

```
الدفع الإلكتروني
تقدّم خدمة الدفع الإلكتروني Moyasar، مزوّد الدفع لدينا. وعند تقديمك طلباً بالدفع الإلكتروني، يفتح التطبيق صفحة الدفع الآمنة التابعة لـ Moyasar. وتُدخل بيانات بطاقتك في تلك الصفحة، فتصل إلى Moyasar مباشرةً دون أن تمر بنا: فلا يصل إلينا رقم بطاقتك كاملاً ولا رمز الأمان أبداً، ولا نخزّنهما في أي حال. وقد يطلب منك البنك المُصدر لبطاقتك تأكيد الدفع في صفحته الخاصة.
وتُحصَّل المدفوعات الإلكترونية بالريال السعودي، بقيمة الإجمالي الذي يؤكده نظامنا عند إتمام الطلب. ويتطلب الدفع الإلكتروني ألا يقل المبلغ المستحق عن ١٫٠٠ ريال سعودي. فإذا ترك استبدال نقاطك مبلغاً مستحقاً أكبر من صفر وأقل من ١٫٠٠ ريال سعودي، فأوقف استبدال النقاط في هذا الطلب أو ادفع نقداً. ولا يمكنك أن تختار استخدام جزء من نقاطك فقط. [OWNER DECISION (النقاط المستخدمة): لم تعد هذه الجملة تذكر عدد النقاط التي تُستخدم. فشروط العروض والولاء الحالية تنص على أنه «يُستخدم رصيدك المتاح بالكامل بما لا يتجاوز قيمة الطلب»، لكن النظام اليوم لا يستخدم أي نقاط إذا كان عدد النقاط الكاملة التي تتسع لها قيمة الطلب أقل من الحد الأدنى للاستبدال (١٠٠ نقطة حالياً، بقيمة ١٠٫٠٠ ريال) (Product gaps, PAY-3; gap PG-31). وإذا عُدِّل النظام أولاً بحيث يسري الحد الأدنى على الرصيد وحده، فيمكن أن تصبح هذه الجملة: «ولا يمكنك استخدام جزء من نقاطك فقط، فعند استخدامها يُستخدم رصيدك المتاح بالكامل بما لا يتجاوز قيمة الطلب.»] وإذا غطّت نقاطك قيمة الطلب كاملة، فلن يُحصَّل منك أي مبلغ ولن تُفتح صفحة الدفع.
ولا يُقدَّم الطلب الذي تدفع قيمته إلكترونياً إلا بعد أن نتأكد مباشرةً لدى Moyasar أن دفعتك تمّت بالمبلغ الصحيح. وحتى ذلك الحين لا يوجد طلب، ولا يُرسَل شيء إلى الفرع. وبعد تأكيد دفعتك تجد سجلاً للطلب في قسم الطلبات، ويظهر رقم الطلب لدى الفرع في التطبيق فور إصداره من الفرع.
وإذا رُفضت الدفعة، أو انتهت صلاحية صفحة الدفع قبل أن تدفع، فلن يُحصَّل منك أي مبلغ ولن يُقدَّم الطلب، وتبقى سلتك في التطبيق لتحاول مرة أخرى أو تختار الدفع نقداً حيث يتاح. وإذا أغلقت صفحة الدفع دون أن تدفع، فلن يُحصَّل منك أي مبلغ ولن يُقدَّم الطلب، لكن تلك الدفعة تبقى مفتوحة، فيعيدك التطبيق إليها عند عودتك إلى صفحة إتمام الطلب أو عند تقديمك طلباً، حتى لو اخترت الدفع نقداً، إلى أن تنتهي صلاحية صفحة الدفع. وإذا تعذّر علينا التحقق من الدفعة لدى Moyasar، فيُبقيها التطبيق مفتوحة على النحو نفسه إلى أن نتمكن من ذلك، حتى بعد رفض الدفعة أو انتهاء صلاحية صفحة الدفع. [OWNER DECISION (إغلاق صفحة الدفع): هذا ما يفعله التطبيق اليوم، إذ يُبقي الدفعة المغلقة غير المدفوعة مفتوحة كي لا تُدفع إلى جانب طلب ثانٍ، ويعامل الدفعة التي يتعذّر التحقق منها على أنها ما زالت مفتوحة. وإذا عُدِّل التطبيق أولاً بحيث يستطيع العميل إنهاء تلك الدفعة والدفع نقداً فوراً، فتُستبدل الجملة التي تبدأ بـ «وإذا أغلقت صفحة الدفع» بالجملة: «وإذا أغلقت صفحة الدفع دون أن تدفع، فلن يُحصَّل منك أي مبلغ ولن يُقدَّم الطلب، وتبقى سلتك في التطبيق لتحاول مرة أخرى أو تختار الدفع نقداً حيث يتاح.»، وتُحذف الجملة التي تبدأ بـ «وإذا تعذّر علينا التحقق» إذا كان التعديل نفسه يتيح للعميل إنهاء دفعة يتعذّر التحقق منها.]
وإذا خُصم مبلغ من بطاقتك ولم يتمكن التطبيق من تأكيد دفعتك، أو خُصمت قيمة طلب واحد مرتين، فتواصل معنا عبر بيانات التواصل أدناه، مع ذكر تاريخ الدفعة ووقتها ومبلغها، ورقم الطلب إن وُجد. ولا ترسل إلينا رقم بطاقتك كاملاً أبداً. [OWNER DECISION (وعد الاسترداد، يُحسم مرة واحدة مع D2 وD3 في سياسة الإلغاء والاسترجاع): لا يَعِد هذا النص بالاسترداد، لأنه لا شيء ينبّه الفريق إلى هذه الدفعات، وكلٌّ منها يُردّ يدوياً من لوحة تحكم Moyasar. ومسودة سياسة الإلغاء والاسترجاع تَعِد به حالياً («وسنرد المبلغ بعد التحقق منه لدى Moyasar»). تُحسم تلك الجملة مرة واحدة، وإن أُريد الوعد هنا أيضاً فتُضاف الصيغة نفسها، مع مدة زمنية فقط إذا كان الفريق قادراً على الالتزام بها.]
ويُعاد أي مبلغ مسترد من دفعة إلكترونية إلى البطاقة أو وسيلة الدفع التي دفعت بها، عن طريق Moyasar. [OWNER DECISION (D4 في سياسة الإلغاء والاسترجاع): تبقى هذه الجملة فقط إذا لم يُسوَّ استرداد دفعة بالبطاقة نقداً في الفرع في أي حال؛ وإن كان ذلك ممكناً، فتُستخدم في الوثيقتين الصيغة المعتمدة لـ D4.] وتوضح سياسة الإلغاء والاسترجاع متى يتم الاسترداد والمدة التي يستغرقها.
ويتضمن سجلّنا للدفعة الإلكترونية شبكة البطاقة (مثل مدى أو Visa) وآخر أربعة أرقام من البطاقة، ولا يتضمن رقمها كاملاً في أي حال. وتذكر سياسة الخصوصية Moyasar أيضاً، وتوضح ما نحتفظ به عن الدفعة الإلكترونية وما نشاركه مع Moyasar.
```

### The whole document after the edit (for reading, not for pasting)

English, 7 052 characters with the brackets in place:

```
Effective date: [OWNER DECISION: publication date, e.g. 20 November 2026]

HOW YOU PAY
Orders placed in the Spicy Meal app can be paid in cash — at the counter when you collect a pickup order, or to the driver when a delivery order arrives — or, where the app offers it, online, as part of placing your order.
Online payment accepts mada, Visa and Mastercard cards. [OWNER DECISION (methods): publish this list only once Moyasar has confirmed in writing that SADAD, STC Pay and any card scheme not named here (for example American Express) are switched off for invoices on this account (OWNER_ACTIONS.md §47.19). If one is on, have it switched off first, or name it here and re-check every sentence of PAYING ONLINE against it: a SADAD payment stays on hold for days and cannot be refunded.] [OWNER DECISION (Apple Pay): this text does not name Apple Pay, because the only proof that it works inside the app is the device check in OWNER_ACTIONS.md §47.18 step 2, which needs online payment switched on, after this text must already be live. (a) Recommended: publish as it is, and name Apple Pay in a later version once that check has passed. (b) Name it now, accepting that it is unverified at publication: change this sentence to "Online payment accepts mada, Visa and Mastercard cards, and Apple Pay on iPhone where the app shows it.", and in PAYING ONLINE add "On iPhone, where the app shows it, you can use Apple Pay on that page instead." after the sentence beginning "You enter your card details". The refund sentence needs no change either way. Make the same choice in the privacy_policy draft and the store answers.] Where it is offered, online payment is available only in the app on iPhone and Android, not in the web version of the app. The payment options shown at checkout are the ones available for your order.

PRICES AND VAT
All prices are in Saudi Riyals.
Prices shown include 15% VAT unless stated otherwise. The order summary at checkout shows the item total, any delivery fee, any loyalty discount, the VAT, and the amount due.
The total confirmed by our system at checkout is the amount payable. If a price in the app is wrong, we will tell you before preparing the order and you may cancel it.

PAYING IN CASH
Please have the amount ready. Our drivers may not carry large amounts of change.
You receive an order number on confirmation and a record of the order in your Orders tab. A printed invoice is available from the branch on request.

PAYING ONLINE
Online payment is provided by Moyasar, our payment provider. When you place an order with online payment, the app opens Moyasar's secure payment page. You enter your card details on that page, and they go to Moyasar directly, not through us: your full card number and security code never reach us, and we never store them. Your bank may ask you to confirm the payment on its own page.
Online payments are charged in Saudi Riyals, for the total confirmed by our system at checkout. Online payment needs an amount to pay of at least SAR 1.00. If redeeming your points leaves an amount to pay above zero but below SAR 1.00, switch off points redemption for this order or pay in cash. You cannot choose to use only some of your points. [OWNER DECISION (points used): this sentence no longer says how many points are used. The live Offers & Loyalty Terms say "your whole available balance is applied, up to the value of the order", but today no points are used at all when fewer whole points than the redemption minimum (100 live, worth SAR 10.00) fit the order (Product gaps, PAY-3; gap PG-31). If the server is changed first so that the minimum applies only to the balance held, this sentence may become: "You cannot use only some of your points: when you use them, your whole available balance is applied, up to the value of the order."] If your points cover the whole order, nothing is charged and no payment page opens.
An order you pay for online is placed only after we have checked directly with Moyasar that your payment went through for the right amount. Until then there is no order, and nothing is sent to the branch. Once your payment is confirmed, you have a record of the order in your Orders tab, and the branch's order number appears in the app as soon as the branch issues it.
If your payment is declined, or the payment page expires before you pay, no payment is taken and no order is placed; your cart stays in the app, so you can try again or, where it is offered, pay in cash. If you close the payment page without paying, no payment is taken and no order is placed, but that payment stays open: until the payment page expires, the app takes you back to it when you return to checkout or place an order, even if you choose cash. If we cannot reach Moyasar to check a payment, the app keeps it open in the same way until we can, even after a decline or after the payment page expires. [OWNER DECISION (closing the payment page): this is what the app does today; it keeps a closed, unpaid payment open so that it cannot be paid alongside a second order, and it treats a payment that cannot be checked as still open. If the app is changed first so that a customer can end such a payment and pay in cash straight away, replace the sentence beginning "If you close the payment page" with: "If you close the payment page without paying, no payment is taken and no order is placed; your cart stays in the app, so you can try again or, where it is offered, pay in cash.", and delete the sentence beginning "If we cannot reach Moyasar" if the same change lets a customer end a payment that cannot be checked.]
If money is taken from your card but the app could not confirm your payment, or you are charged twice for one order, contact us using the details below, with the date, time and amount of the payment, and your order number if you have one. Never send us your full card number. [OWNER DECISION (refund promise; decide once, with cancellation_refund_policy D2 and D3): no refund is promised here, because nothing alerts staff to these payments and each is refunded by hand in the Moyasar dashboard. The Cancellation & Refund Policy draft currently promises one ("we will refund it once we have confirmed it with Moyasar"). Settle that sentence once; if a promise is also wanted here, add the same words, with a time limit only if staff can keep it.]
Any refund of an online payment goes back to the card or payment method you paid with, through Moyasar. [OWNER DECISION (cancellation_refund_policy D4): keep this sentence only if a card-paid refund is never settled in cash at the branch; if it may be, use the wording chosen for D4 in both documents.] Our Cancellation & Refund Policy explains when refunds are made and how long they take.
Our record of an online payment includes the card network (for example mada or Visa) and the last four digits of the card, never your full card number. Our Privacy Policy, which also names Moyasar, explains what we keep about an online payment and what we share with Moyasar.

CONTACT
info@spicymeal.com.sa — 9200 31495
```

Arabic, 6 292 characters with the brackets in place:

```
تاريخ السريان: [OWNER DECISION: تاريخ النشر، مثل ٢٠ نوفمبر ٢٠٢٦]

كيف تدفع
يمكن دفع قيمة الطلبات المقدَّمة عبر تطبيق سبايسي ميل نقداً، عند الكاشير حين تستلم طلب الاستلام، أو للسائق عند وصول طلب التوصيل. ويمكن أيضاً، حيث يتيح التطبيق ذلك، دفعها إلكترونياً أثناء تقديم الطلب.
ويقبل الدفع الإلكتروني بطاقات مدى وVisa وMastercard. [OWNER DECISION (وسائل الدفع): لا تُنشر هذه القائمة إلا بعد أن تؤكد Moyasar كتابياً أن SADAD وSTC Pay وأي شبكة بطاقات غير مذكورة هنا (مثل American Express) معطّلة للفواتير في هذا الحساب (OWNER_ACTIONS.md §47.19). وإن كان أيٌّ منها مفعّلاً، فيُعطَّل أولاً، أو يُذكر هنا وتُراجَع كل جملة في قسم الدفع الإلكتروني في ضوئه، فدفعة SADAD تبقى معلّقة أياماً ولا يمكن استردادها.] [OWNER DECISION (Apple Pay): لا يذكر هذا النص Apple Pay، لأن الدليل الوحيد على عمله داخل التطبيق هو فحص الجهاز في الخطوة ٢ من OWNER_ACTIONS.md §47.18، وهو يتطلب تشغيل الدفع الإلكتروني، أي بعد أن يكون هذا النص قد نُشر. (أ) المقترح: يُنشر النص كما هو، ويُذكر Apple Pay في نسخة لاحقة بعد نجاح الفحص. (ب) ذكره الآن مع قبول أنه غير مُتحقَّق منه عند النشر: تصبح هذه الجملة «ويقبل الدفع الإلكتروني بطاقات مدى وVisa وMastercard، وكذلك Apple Pay على iPhone حيث يعرضه التطبيق.»، وتُضاف في قسم الدفع الإلكتروني الجملة «ويمكنك على iPhone، حيث يعرضه التطبيق، استخدام Apple Pay في تلك الصفحة بدلاً من ذلك.» بعد الجملة التي تبدأ بـ «وتُدخل بيانات بطاقتك». ولا تحتاج جملة الاسترداد إلى تغيير في الحالتين. ويُتخذ الخيار نفسه في مسودة سياسة الخصوصية وفي إجابات المتاجر.] وحيث يُتاح الدفع الإلكتروني، فإنه يتوفر في التطبيق على iPhone وAndroid فقط، ولا يتوفر في نسخة الويب من التطبيق. وخيارات الدفع الظاهرة عند إتمام الطلب هي الخيارات المتاحة لطلبك.

الأسعار وضريبة القيمة المضافة
جميع الأسعار بالريال السعودي.
والأسعار المعروضة شاملة ضريبة القيمة المضافة ١٥٪ ما لم يُذكر خلاف ذلك. ويعرض ملخص الطلب عند الدفع إجمالي الأصناف ورسوم التوصيل إن وجدت وخصم الولاء إن وجد وقيمة الضريبة والمبلغ المستحق.
والإجمالي الذي يؤكده نظامنا عند إتمام الطلب هو المبلغ الواجب دفعه. وإذا كان سعر في التطبيق غير صحيح، فسنخبرك قبل تحضير الطلب ويمكنك إلغاؤه.

الدفع نقداً
نرجو تجهيز المبلغ، فقد لا يحمل سائقونا مبالغ كبيرة للصرافة.
وتحصل على رقم طلب عند التأكيد وعلى سجل للطلب في قسم الطلبات. وتتوفر فاتورة مطبوعة من الفرع عند الطلب.

الدفع الإلكتروني
تقدّم خدمة الدفع الإلكتروني Moyasar، مزوّد الدفع لدينا. وعند تقديمك طلباً بالدفع الإلكتروني، يفتح التطبيق صفحة الدفع الآمنة التابعة لـ Moyasar. وتُدخل بيانات بطاقتك في تلك الصفحة، فتصل إلى Moyasar مباشرةً دون أن تمر بنا: فلا يصل إلينا رقم بطاقتك كاملاً ولا رمز الأمان أبداً، ولا نخزّنهما في أي حال. وقد يطلب منك البنك المُصدر لبطاقتك تأكيد الدفع في صفحته الخاصة.
وتُحصَّل المدفوعات الإلكترونية بالريال السعودي، بقيمة الإجمالي الذي يؤكده نظامنا عند إتمام الطلب. ويتطلب الدفع الإلكتروني ألا يقل المبلغ المستحق عن ١٫٠٠ ريال سعودي. فإذا ترك استبدال نقاطك مبلغاً مستحقاً أكبر من صفر وأقل من ١٫٠٠ ريال سعودي، فأوقف استبدال النقاط في هذا الطلب أو ادفع نقداً. ولا يمكنك أن تختار استخدام جزء من نقاطك فقط. [OWNER DECISION (النقاط المستخدمة): لم تعد هذه الجملة تذكر عدد النقاط التي تُستخدم. فشروط العروض والولاء الحالية تنص على أنه «يُستخدم رصيدك المتاح بالكامل بما لا يتجاوز قيمة الطلب»، لكن النظام اليوم لا يستخدم أي نقاط إذا كان عدد النقاط الكاملة التي تتسع لها قيمة الطلب أقل من الحد الأدنى للاستبدال (١٠٠ نقطة حالياً، بقيمة ١٠٫٠٠ ريال) (Product gaps, PAY-3; gap PG-31). وإذا عُدِّل النظام أولاً بحيث يسري الحد الأدنى على الرصيد وحده، فيمكن أن تصبح هذه الجملة: «ولا يمكنك استخدام جزء من نقاطك فقط، فعند استخدامها يُستخدم رصيدك المتاح بالكامل بما لا يتجاوز قيمة الطلب.»] وإذا غطّت نقاطك قيمة الطلب كاملة، فلن يُحصَّل منك أي مبلغ ولن تُفتح صفحة الدفع.
ولا يُقدَّم الطلب الذي تدفع قيمته إلكترونياً إلا بعد أن نتأكد مباشرةً لدى Moyasar أن دفعتك تمّت بالمبلغ الصحيح. وحتى ذلك الحين لا يوجد طلب، ولا يُرسَل شيء إلى الفرع. وبعد تأكيد دفعتك تجد سجلاً للطلب في قسم الطلبات، ويظهر رقم الطلب لدى الفرع في التطبيق فور إصداره من الفرع.
وإذا رُفضت الدفعة، أو انتهت صلاحية صفحة الدفع قبل أن تدفع، فلن يُحصَّل منك أي مبلغ ولن يُقدَّم الطلب، وتبقى سلتك في التطبيق لتحاول مرة أخرى أو تختار الدفع نقداً حيث يتاح. وإذا أغلقت صفحة الدفع دون أن تدفع، فلن يُحصَّل منك أي مبلغ ولن يُقدَّم الطلب، لكن تلك الدفعة تبقى مفتوحة، فيعيدك التطبيق إليها عند عودتك إلى صفحة إتمام الطلب أو عند تقديمك طلباً، حتى لو اخترت الدفع نقداً، إلى أن تنتهي صلاحية صفحة الدفع. وإذا تعذّر علينا التحقق من الدفعة لدى Moyasar، فيُبقيها التطبيق مفتوحة على النحو نفسه إلى أن نتمكن من ذلك، حتى بعد رفض الدفعة أو انتهاء صلاحية صفحة الدفع. [OWNER DECISION (إغلاق صفحة الدفع): هذا ما يفعله التطبيق اليوم، إذ يُبقي الدفعة المغلقة غير المدفوعة مفتوحة كي لا تُدفع إلى جانب طلب ثانٍ، ويعامل الدفعة التي يتعذّر التحقق منها على أنها ما زالت مفتوحة. وإذا عُدِّل التطبيق أولاً بحيث يستطيع العميل إنهاء تلك الدفعة والدفع نقداً فوراً، فتُستبدل الجملة التي تبدأ بـ «وإذا أغلقت صفحة الدفع» بالجملة: «وإذا أغلقت صفحة الدفع دون أن تدفع، فلن يُحصَّل منك أي مبلغ ولن يُقدَّم الطلب، وتبقى سلتك في التطبيق لتحاول مرة أخرى أو تختار الدفع نقداً حيث يتاح.»، وتُحذف الجملة التي تبدأ بـ «وإذا تعذّر علينا التحقق» إذا كان التعديل نفسه يتيح للعميل إنهاء دفعة يتعذّر التحقق منها.]
وإذا خُصم مبلغ من بطاقتك ولم يتمكن التطبيق من تأكيد دفعتك، أو خُصمت قيمة طلب واحد مرتين، فتواصل معنا عبر بيانات التواصل أدناه، مع ذكر تاريخ الدفعة ووقتها ومبلغها، ورقم الطلب إن وُجد. ولا ترسل إلينا رقم بطاقتك كاملاً أبداً. [OWNER DECISION (وعد الاسترداد، يُحسم مرة واحدة مع D2 وD3 في سياسة الإلغاء والاسترجاع): لا يَعِد هذا النص بالاسترداد، لأنه لا شيء ينبّه الفريق إلى هذه الدفعات، وكلٌّ منها يُردّ يدوياً من لوحة تحكم Moyasar. ومسودة سياسة الإلغاء والاسترجاع تَعِد به حالياً («وسنرد المبلغ بعد التحقق منه لدى Moyasar»). تُحسم تلك الجملة مرة واحدة، وإن أُريد الوعد هنا أيضاً فتُضاف الصيغة نفسها، مع مدة زمنية فقط إذا كان الفريق قادراً على الالتزام بها.]
ويُعاد أي مبلغ مسترد من دفعة إلكترونية إلى البطاقة أو وسيلة الدفع التي دفعت بها، عن طريق Moyasar. [OWNER DECISION (D4 في سياسة الإلغاء والاسترجاع): تبقى هذه الجملة فقط إذا لم يُسوَّ استرداد دفعة بالبطاقة نقداً في الفرع في أي حال؛ وإن كان ذلك ممكناً، فتُستخدم في الوثيقتين الصيغة المعتمدة لـ D4.] وتوضح سياسة الإلغاء والاسترجاع متى يتم الاسترداد والمدة التي يستغرقها.
ويتضمن سجلّنا للدفعة الإلكترونية شبكة البطاقة (مثل مدى أو Visa) وآخر أربعة أرقام من البطاقة، ولا يتضمن رقمها كاملاً في أي حال. وتذكر سياسة الخصوصية Moyasar أيضاً، وتوضح ما نحتفظ به عن الدفعة الإلكترونية وما نشاركه مع Moyasar.

التواصل
info@spicymeal.com.sa — 9200 31495
```

---

## What changed and why

Paths are relative to the repository root, read from the default branch at `04eb351`.
Live facts were read from Production with read-only SQL on 2026-11-13. "Fact-check
B2", "S1" and so on are the findings in `docs/readiness/20261113-card-payments-reviews/payment_policy.review.md`;
each was re-checked against the code or the live database before it was applied
(see the Fix log). "R1" to "R13" are the findings of the independent re-check
(the "re-check:" lines of the Fix log).

| # | Change | Code fact it rests on |
| --- | --- | --- |
| 1 | **HOW YOU PAY: cash is no longer the only method; online is added, "where the app offers it", "as part of placing your order".** "Are paid in cash" becomes "can be paid in cash … or … online". The Arabic says the same in two sentences, so «إلكترونياً» cannot be read as a third way of paying cash (fact-check N3, N6). | Online payment is one global switch, `app_settings.online_payment_enabled`, live **false**; cash is a switch too (`cash_payment_enabled`, live true). The app offers exactly the switched-on methods: `apps/mobile/src/lib/payment.ts:50-55` (`availableMethods`). Moyasar is the only provider: `supabase/functions/payment-initiate/index.ts:19-23`; anything else answers `disabled`. The payment page opens when the customer presses Place order, not when the method is chosen: `apps/mobile/src/features/checkout/CheckoutScreen.tsx:770-786`. |
| 2 | **"Where it is offered, online payment is available only in the app on iPhone and Android, not in the web version of the app."** The first draft said this unconditionally, which is false while online payment is off (fact-check S1). | `payment.ts:38-47`: `onlineSupportedOn` returns false for `web`, because the hosted page needs the in-app payment screen. `docs/PAYMENTS.md` §3 (lines 216-219): "The web build (`/app`) never offers online payment." While `online_payment_enabled` is false no surface offers it (`payment.ts:52`), and in TEST mode `payment-initiate` refuses every customer checkout (`payment-initiate/index.ts:354`, `:495`, `:509`). Live today: switch off, row in TEST mode. "Web version of the app" is the term the Privacy Policy already uses for `/app`. |
| 3 | **"The payment options shown at checkout are the ones available for your order"** replaces "The payment option shown … is the one that applies". | Same `availableMethods` (`payment.ts:50-55`): with either switch off, or on the web, fewer options appear. The customer chooses; nothing preselects (`payment.ts:12-17`). |
| 4 | **Methods named: mada, Visa and Mastercard, with a publish precondition (fact-check S5). Apple Pay is no longer named in the text; it is an [OWNER DECISION] (fact-check B4).** | The methods are the owner's answer of 2026-11-11 (`docs/PAYMENTS.md:15`: mada, Visa / Mastercard and Apple Pay enabled, STC Pay not). The invoice request has no payment-method field (`supabase/functions/_shared/moyasar.ts:336-354`), so the hosted page offers whatever the account has switched on. SADAD and STC Pay being off is unconfirmed by Moyasar (`OWNER_ACTIONS.md` §47.19), and a SADAD bill stays `on_hold` for days and cannot be refunded (`PAYMENTS.md:635-637`), which would make "no payment is taken" and the refund sentence untrue for it. Apple Pay: the payment screen sets `enableApplePay` (`apps/mobile/src/app/payment/checkout.tsx:187`), iOS only, and only in the new EAS build; builds already in the field open the system browser, without Apple Pay (`PAYMENTS.md` §5, lines 313-315; `OWNER_ACTIONS.md` §47.17); Moyasar has not confirmed it inside a WebView (`PAYMENTS.md` §11 Q1, line 628); the sandbox cannot show it at the 1.00 SAR admin test amount (`PAYMENTS.md:545-550`); and the only device check needs online payment on and live mode (`RELEASE_CHECKLIST.md:161-173`), which is `OWNER_ACTIONS.md` §47.18 step 2, after this text must be live (§47.15). So "keep it only if the check passes" could not be settled in time. |
| 5 | **"You enter your card details on that page, and they go to Moyasar directly, not through us: your full card number and security code never reach us, and we never store them."** Replaces "Your card details go to Moyasar, not to us", which overstated it (fact-check S2), and the previous revision's "not in our app", which the new build contradicts (R2). It keeps v2.0's promise ("we will never store your full card number") and makes it stronger. | `moyasar.ts:6-17`: Moyasar prohibits card data on the merchant backend, so the integration is the hosted **invoice**. The invoice request carries no card field (`moyasar.ts:336-354`). The app loads only Moyasar's page and injects no script of its own (`checkout.tsx:153-190`), and `payment-initiate` hands out only https URLs on `moyasar.com` (`moyasar.ts:373-386`). What does reach our server, in Moyasar's API replies, is a masked number (first six and last four digits), the cardholder name and the payer's IP address; `sanitizeMoyasarPayment` drops all three and keeps only the last four (`moyasar.ts:732-768`; test `moyasar.test.ts:669`, "drops the BIN, the token, the name and the payer IP"). The full number and the security code never reach us. "Secure" is the word the app's own payment footer uses: "Your card details are entered on Moyasar's secure page." (`checkout.tsx:221`). **Re-check (R2):** the new build shows Moyasar's page inside the app's own payment screen ("the customer stays in Spicy Meal the whole time", `checkout.tsx:2-5`), so "not in our app" was untrue there; builds already in the field open the system browser (`PAYMENTS.md` §5, lines 313-315). "They go to Moyasar directly, not through us" is true of both, and is the privacy draft's wording (its PAYMENT section); the store answers also describe the page as shown inside the app. |
| 6 | **"Your bank may ask you to confirm the payment on its own page."** | 3-D Secure: `PAYMENTS.md` §2 step 4 and §5 (the issuer's challenge page is "on the bank's own domain"). |
| 7 | **"Charged in Saudi Riyals, for the total confirmed by our system at checkout."** "By our system" added, as in PRICES AND VAT and the Arabic «يؤكده نظامنا» (fact-check N5). | The invoice is built in the **attempt's** currency, not a configurable one (`payment-initiate/index.ts:140-158`); the attempt's currency is the order's, and `orders.total` is SAR. The amount is the server-computed session total read through the customer's own client (`payment-initiate/index.ts:470-482`), never a client value. A payment confirms only if amount and currency match the attempt (`checkPaymentBinding`, `moyasar.ts:900-920`). Live: payment row `currency` = `SAR`. |
| 8 | **Minimum and points: "Online payment needs an amount to pay of at least SAR 1.00. If redeeming your points leaves an amount to pay above zero but below SAR 1.00, switch off points redemption for this order or pay in cash. You cannot choose to use only some of your points. If your points cover the whole order, nothing is charged and no payment page opens."** The first draft said "use fewer points", which the app cannot do, and did not cover a zero total (fact-check B2). The previous revision's "when you use them, your whole available balance is applied, up to the value of the order" (the live Loyalty Terms' words) is now only in a bracket, because it is untrue for a small order (R1). | Minimum: `MOYASAR_MIN_INVOICE_MINOR_UNITS = 100` (`moyasar.ts:124`, `isBelowMoyasarMinimum` `:131-133`); `payment-initiate` refuses a smaller total before any attempt (`index.ts:406`, `:484-487`); the database refuses it too, and that check is **live** in `begin_session_attempt` and `begin_payment_attempt` (read 2026-11-13). All or nothing: the app redeems the whole available balance or none (`CheckoutScreen.tsx:415`, through the on/off control in `features/checkout/view/LoyaltyToggle.tsx`), which is what live `offers_loyalty_terms` v2.2 says: "When you do, your whole available balance is applied, up to the value of the order."; the sentence uses that wording. Zero: the points discount is capped at the order value (`previewTotals.ts:132-136`; live `compute_order_snapshot` and `place_order`: `least(v_loyalty_req, v_bal_start, floor(v_pre_loyalty / v_per_point)::int)`, then `least(round(v_loyalty_redeemed * v_per_point, 2), v_pre_loyalty)`), so a pickup order can reach exactly 0.00. Live `begin_checkout_session` then settles it at once without Moyasar ("Zero-total (fully covered): nothing to charge — settle immediately"; `supabase/migrations/20260826110000_checkout_zero_total_idempotency.sql:123`), and the app goes straight to the receipt (`CheckoutScreen.tsx:778-781`). Only 0.01 to 0.99 is refused. The app's own message still says "Use fewer points" (Product gaps, PAY-2; gap PG-05), and the checkout summary does not apply two of the server's points rules (PAY-3; gap PG-31). **Re-check (R1):** the same live functions then set the points used to 0 when they are fewer than `min_points_to_redeem` (live 100; `discount_per_point` 0.10), so an order worth less than SAR 10.00 after any coupon uses no points at all, whatever the balance; 24 of the 55 active products are priced under SAR 10.00 (read 2026-11-13). "Your whole available balance is applied, up to the value of the order" is untrue there. "You cannot choose to use only some of your points" is true in every case, because the app's switch sends the whole balance or nothing (`CheckoutScreen.tsx:415`). |
| 9 | **"An order you pay for online is placed only after we have checked directly with Moyasar that your payment went through for the right amount. Until then there is no order, and nothing is sent to the branch. Once your payment is confirmed, you have a record of the order in your Orders tab, and the branch's order number appears in the app as soon as the branch issues it."** The first draft said "you receive an order number on confirmation … as with a cash order" (fact-check N4, N7). The previous revision's "Once it is placed" became "Once your payment is confirmed" (R3). | The app opens a checkout **session**, not an order (`CheckoutScreen.tsx:770-786`; the app calls `payment-initiate` only with a session id, `apps/mobile/src/services/api.ts:474-475`). A payment is confirmed **only** in `validateAndConfirmMoyasarPayment`, and only when Moyasar's own fetch says `paid`/`captured` and every bound field matches (`supabase/functions/_shared/moyasarVerify.ts:1-5`, `:312`). Only then does `finalize_checkout_session` create the order, already paid (`moyasarVerify.ts:343-346`, `:368`). Redirects and webhooks are never trusted on their own (`moyasarVerify.ts:13-20`). The receipt never shows the internal SM-… number, only the branch's own number once the branch has issued one (`apps/mobile/src/features/orders/ReceiptScreen.tsx:12-14`); the app's own copy is "It will appear here as soon as the branch issues it." / «سيظهر هنا فور إصداره من الفرع.» (`apps/mobile/src/i18n/strings.ts:388`, `:732`). The POS hand-off after a confirmed payment is best-effort (`moyasarVerify.ts:478-487`), so the number can come later than the confirmation. "As with a cash order" was dropped so that the sentence cannot be read as extending PAYING IN CASH's printed-invoice promise (Claims, item 10). "An order you pay for online" excludes the zero-total path, which is settled without Moyasar (row 8). **Re-check (R3, raised by the terms_conditions draft):** the live Terms & Conditions (ORDERING: "An order is placed when the app confirms it and gives you an order number") and the app use "placed" for a later moment: the app confirms an order only once the branch's POS has returned its reference (`apps/mobile/src/features/orders/orderConfirmation.ts:66`, `:148`), and titles a paid order that never reaches the branch "Order not placed" (`strings.ts:374`). "Once it is placed" used the word for the moment the paid order is created, before the POS has it. The first sentence ("placed only after …") is a condition, and stays true under either meaning. |
| 10 | **Declined or expired: "no payment is taken and no order is placed; your cart stays in the app, so you can try again or, where it is offered, pay in cash." Closed without paying: "that payment stays open: until the payment page expires, the app takes you back to it when you return to checkout or place an order, even if you choose cash." Moyasar out of reach (R4): "the app keeps it open in the same way until we can, even after a decline or after the payment page expires."** The first draft promised cash after closing the page, which the app does not allow (fact-check B3). "Basket" became "cart", the app's word (fact-check N2). | Decline: with no settled payment on the invoice, the most recent one is taken (`selectInvoicePayment`, `moyasar.ts:936`); Moyasar `failed` maps to failed (`moyasar.ts:474-496`) and `payment-verify` answers `failed` (`verifyAnswerStatus`, `moyasar.ts:1096`), which the app treats as terminal and clears (`features/checkout/pendingSession.ts:70`, `:83`). Expiry: an `expired` invoice is terminal (`closedInvoiceOutcome`, `moyasar.ts:565`, used at `moyasarVerify.ts:563`). After either, "Try again" opens a fresh session (`CheckoutScreen.tsx:927`) and a cash order goes through. Closed without paying: the invoice stays payable and `payment-verify` answers pending (`moyasarVerify.ts:584`, `reason: 'no_payment'`); the app keeps the saved session (`pendingSession.ts:79-85`) and resumes it (`:164-188`) on entering checkout (`CheckoutScreen.tsx:286-297`) and before every order, cash included (`:727-733`, ahead of the cash branch at `:789`); the dialog for that state offers "Continue payment" and "Check again" (`features/checkout/view/PaymentStatusDialog.tsx:112-116`), and Close, which keeps the saved session (`:125`); the app's own text is "Payment was not completed. You can continue or try again." (`strings.ts:221`). The docs agree: `PAYMENTS.md:225-229`; `RELEASE_CHECKLIST.md:180-183` ("Close and come back"). The page lasts the configured invoice expiry, 30 minutes live, bounded 5 to 60 (`moyasar.ts:259-260`), hence "until the payment page expires" rather than a number. No order is created in any of these cases, because only a confirmed payment creates one (row 9), and the cart is cleared only once an order exists (`CheckoutScreen.tsx:780`, `:790`, `:895`). Product gaps, PAY-1 (gap PG-04). **Re-check (R4):** a check that cannot reach Moyasar answers "pending", never a terminal status (`moyasarVerify.ts:550-556`; `payment-verify/index.ts:99`, `:253`), and the app keeps a pending session (`pendingSession.ts:84`), so while Moyasar or the proxy cannot be reached the hold outlasts the page, after a decline or an expiry too (`docs/readiness/20261113-card-payments-gaps.md` PG-04, which asks for this to be stated plainly). |
| 11 | **"If money is taken from your card but the app could not confirm your payment, or you are charged twice for one order, contact us … with the date, time and amount of the payment, and your order number if you have one. Never send us your full card number."** No refund is promised here; the promise is decided once with the refund policy (bracket; fact-check S6). The previous revision's "does not confirm your order" became "could not confirm your payment" (R6). | In the first case there is no order number to quote, while the live Contact & Support page asks for one ("Please include your order number."); the refund draft asks for the same details and gives the same warning (`docs/legal/CANCELLATION_REFUND_POLICY_CARD_PAYMENTS_DRAFT.md`, ONLINE PAYMENT REFUNDS line 10, in both languages; earlier revisions cited file lines, which move). The app tells the customer to contact support in exactly that case: `payUnknown`, "We could not confirm the payment. Please contact support if an amount was deducted." (`strings.ts:204`), used for a payment Moyasar reports paid that we did not confirm, and a payment refunded before confirmation (`PAYMENTS.md` §4, lines 240-245). A duplicate payment is recorded, never refunded automatically, and nothing alerts staff (`PAYMENTS.md` §10, lines 571-597; `OWNER_ACTIONS.md` §47.20). The automatic refund ledger refunds only an order's own paid payment (`supabase/migrations/20261003120000_moyasar_only_payments.sql:557-575`), so no code path refunds a payment that has no order, or a duplicate. Product gaps, PAY-4 (gap PG-02). **Re-check (R6):** "could not confirm your payment" is the app's own phrase for these cases (`payUnknown`) and the refund draft's (its ONLINE PAYMENT REFUNDS line 10). In the app, "Order confirmed" means the branch has confirmed the order (`orderConfirmation.ts:66`, `:148`), so "does not confirm your order" also took in a paid order that the POS has not yet received, which the app lets the customer resend and the refund policy covers. |
| 12 | **"Any refund of an online payment goes back to the card or payment method you paid with, through Moyasar … Our Cancellation & Refund Policy explains when refunds are made and how long they take."** Destination only; no trigger, no timing. Worded as in the refund draft, with its D4 marker (fact-check S4); "including a card used through Apple Pay" went with Apple Pay (row 4), and "payment method" covers it if it is named later. | Every refund the code makes is `POST /v1/payments/{payment id}/refund` against the original payment, body `{ amount }` alone (`supabase/functions/_shared/moyasarRefund.ts:260-262`, sent at `supabase/functions/payment-refund/index.ts:235-241`). The hand refund in Moyasar's dashboard is also against the payment (`PAYMENTS.md` §10, lines 616-620). No code path refunds a card payment in cash. **When** a refund happens is deliberately not here: the code refunds automatically only a paid order that never reached the POS after the customer's resends (`order_refund_due`, reason `pos_delivery_failed_after_customer_retries`, `20261003120000_moyasar_only_payments.sql:573`); a cancelled paid order and a duplicate are refunded by hand (`PAYMENTS.md` §6, lines 323-337; `OWNER_ACTIONS.md` §47.20). That belongs to `cancellation_refund_policy`. |
| 13 | **"Our record of an online payment includes the card network (for example mada or Visa) and the last four digits of the card, never your full card number."** "Shows" became "includes", matching the Arabic «يتضمن», because the list is not complete (fact-check S3). "Card type" became "card network", the privacy draft's term (R7). | What is kept is `sanitizeMoyasarPayment` (`moyasar.ts:742-768`): the card scheme (`company`), the last four via `lastFourOf` (`:732-736`), and also the issuer's name and country, the authorisation code, reference number, response code and decline message. The scheme and the last four also go into columns: derived at `moyasarVerify.ts:332-333`, passed to `finalize_checkout_session` at `:375-376` (session path) and written at `:473-474` (order path). (The first draft cited `:182-183` and `:197-198`, which are the duplicate-payment helper; fact-check N8.) "mada" is a value Moyasar returns for `company` (fixture, `moyasar.test.ts:652`). The full list belongs in the Privacy Policy, to which the next sentence points. **Re-check (R7):** the sanitizer keeps the scheme (`company`) and nothing that says whether the card is debit or credit (`moyasar.ts:756-766`), and "card type" can be read as that. |
| 14 | **"Our Privacy Policy, which also names Moyasar, explains what we keep about an online payment and what we share with Moyasar."** | v2.0 promised to name the provider "in this policy and in the Privacy Policy". The privacy draft does that, lists the stored payment fields (`docs/legal/PRIVACY_POLICY_CARD_PAYMENTS_DRAFT.md`, WHAT WE COLLECT, "Payment:") and says what is sent to Moyasar (its PAYMENT section). "Explains", not the fact-check's "lists everything we keep": the privacy fact-check found two stored fields that draft did not list, the payment method type and Moyasar's fee (`docs/readiness/20261113-card-payments-reviews/privacy_policy.review.md`, item 12). Re-check: the privacy draft now lists the payment method and leaves the fee out on purpose, as Moyasar's charge to us rather than data about the customer (its row 6), so "explains" stays. `RECORD_OF_PROCESSING.md` activity 15 records what is sent: amount, currency, "Spicy Meal order", expiry, two opaque references, return addresses; "No name, phone number or email is sent" (`moyasar.ts:336-354`; `payment-initiate/index.ts:258-268`, `:456`, `:529`). |
| 15 | **Version: an [OWNER DECISION], decided once for the whole set (fact-check N1).** | This repository has bumped minor for every content change since the 2026-08-18 v2.0 rewrite, including changes that added features (`offers_loyalty_terms` v2.2 added four loyalty features, one of which reduced what a delivery customer gets) and a processor (`privacy_policy` v2.3, and the 2.4 the privacy draft proposes). The refund draft proposes **3.0** for the same kind of change (`docs/legal/CANCELLATION_REFUND_POLICY_CARD_PAYMENTS_DRAFT.md`, its header's version line, reasoned in its section "Version: 2.0 → 3.0 (major)"; earlier revisions cited file lines, which move). The terms_conditions draft leaves it open, as this one does. A 3.0 is defensible here too, because the document's central statement ("paid in cash") is reversed. No code ties customer acceptance to a version number: the app and the legal page read the active row (`apps/mobile/src/services/api.ts`, `src/legal/main.ts`), and no migration stores an accepted version. Note that `LEGAL_DOCUMENTS_AUDIT.md` lines 16-17 say the other rows are "unchanged at 2.1"; the live `payment_policy` row reads **2.0**, and this draft goes by the live row. |

### Left unchanged on purpose

- **PRICES AND VAT.** "All prices are in Saudi Riyals" and "the total confirmed
  by our system at checkout is the amount payable" are already true for card
  payment (row 7), so the SAR statement for online payment went into PAYING
  ONLINE rather than editing this section. **One sentence here interacts with
  card payment:** "If a price in the app is wrong, we will tell you before
  preparing the order and you may cancel it." For a card-paid order that
  cancellation is, today, refunded by hand (row 12). The sentence promises no
  refund, so it is true as it stands; see Open owner decisions, item 4. The
  sentence "The order summary at checkout shows … the amount due" is also kept;
  the summary can differ from the confirmed total when points are used (Product
  gaps, PAY-3; gap PG-31), and the next sentence already makes the confirmed total the one
  that counts.
- **PAYING IN CASH**, including "A printed invoice is available from the branch
  on request". Whether that also holds for an online order is not in the code
  (Claims, item 10), so it was not extended to PAYING ONLINE, and "as with a
  cash order" was removed so that nothing reads as extending it. Its sentence
  "You receive an order number on confirmation" is kept byte-identical, and it is
  accurate: the app says "Order confirmed" only once the branch's POS has
  returned its reference, and the branch's order number is written at the same
  moment (Product gaps, PAY-8, withdrawn on re-check, R5).
- **CONTACT.** The new "contact us using the details below" points at it.
- **Refund timing** (mada 24 hours to 3 business days, credit cards 7 to 14
  business days, weekends not included: Moyasar's FAQ,
  `moyasar.com/en/resources/faqs`, read 2026-11-13) is not in this document. It
  belongs in `cancellation_refund_policy`, which v2.0 of that document promises
  to update "to explain how a card refund is returned and how long it takes".
  The repository's records said "about 1 to 3 days" and "about 7 to 14" until
  they were corrected to the FAQ's wording on 2026-11-13
  (`docs/integrations/Moyasar_API_Reference.md` §3.2, `OWNER_ACTIONS.md`
  §47.18). So the refund draft's "working days" / «أيام عمل» (the last line of
  its ONLINE PAYMENT REFUNDS section) renders Moyasar's "business days" and is
  supported.
- **What Moyasar receives** (amount, currency, a fixed description, references;
  no name, phone, email or address). That is privacy content and is in the
  privacy draft; this document points there.
- **The static-IP proxy** (`MOYASAR_PROXY_URL`) is a server-side transport detail
  and is not named. It has one customer-facing effect, found on re-check (R4):
  while the proxy or Moyasar cannot be reached, a payment cannot be checked and
  stays open. PAYING ONLINE, paragraph 4, states that without naming the proxy.

---

## Open owner decisions

1. **Version and date, once for the whole set.** 2.1 (the house convention for
   content changes since 2026-08-18) or 3.0 (the central statement, "paid in
   cash", is reversed; the refund draft proposes 3.0). Decide it once for the
   four documents published together (fact-check N1). Set the publication date
   in the `effective_date` column **and** in line 1 of both languages
   (`LEGAL_DOCUMENTS_AUDIT.md` §Method rule 6). Marked in the text.
2. **Apple Pay (fact-check B4).** The only proof that Apple Pay works inside the
   app is the device check in `RELEASE_CHECKLIST.md` §7 "Online payment
   (Moyasar)", which is `OWNER_ACTIONS.md` §47.18 step 2 and needs online
   payment on, so it cannot be run before this text must be live. (a)
   Recommended, and what the text says now: publish without Apple Pay and name
   it in a later version once the check passes. (b) Name it now, hedged ("where
   the app shows it"), accepting that it is unverified at publication; the exact
   EN and AR sentences are in the bracket. Either way the refund sentence
   ("card or payment method") needs no change. Make the same choice for the
   privacy draft's Apple Pay clause and for the store answers. As read on
   re-check (R10): the store answers keep Apple Pay out of the listing copy
   until the check has passed (their App Review notes for card payment on carry
   it behind a bracket on the same check, which can be run before those notes
   are sent); the privacy draft then named it twice (its PAYMENT section),
   behind a bracket keyed to the same device check. Its own re-check (R1) has
   since dropped Apple Pay by default, so all three now follow option (a), with
   option (b) in a bracket.
3. **Money taken without an order, and duplicates (fact-check S6).** The text
   says only "contact us", with the details to give. Whether to promise a refund
   here, and in what time, is decided **once**, together with the refund draft's
   D2 and D3: that draft currently promises "we will refund it once we have
   confirmed it with Moyasar". Today each such refund is made by hand in the
   Moyasar dashboard, and nothing alerts staff to a duplicate (`PAYMENTS.md`
   §10; `OWNER_ACTIONS.md` §47.20). Marked in the text.
4. **Cancelling a card-paid order.** The owner's 2026-11-11 answer was "automatic
   via Moyasar"; the code refunds automatically only a paid order that never
   reached the POS (`OWNER_ACTIONS.md` §47.20). This draft says nothing about
   when a refund happens, so it is true either way. The decision lands in
   `cancellation_refund_policy` (its D1), whose live text says refunds are
   "settled in cash at the branch".
5. **Card refunds only to the card (fact-check S4).** The text says any refund of
   an online payment "goes back to the card or payment method you paid with".
   That is the only route the code has. If staff may ever settle a card-paid
   refund in cash at the branch, use the wording chosen for the refund draft's
   D4 in both documents. Marked in the text.
6. **Publishing (proposed after fact-check B1; the owner decides, gap PG-08).** `privacy_policy`, `payment_policy`,
   `cancellation_refund_policy` and `terms_conditions` are published together,
   in both languages, in one owner-approved session, before §47.18; the store
   answers and the listing copy change in the same window. This text points at
   the Privacy Policy ("which also names Moyasar") and at the Cancellation &
   Refund Policy ("explains when refunds are made and how long they take"),
   whose live versions say card payment is not available; and the live Terms &
   Conditions (v2.0; whole-document md5 EN `0da664333b24808294b771f436272c02`,
   AR `bcd2dc7af623a2b28b031e1a861d04c9`) say *"Orders are paid in cash at
   pickup or on delivery. See the Payment Policy."* / «تُدفع الطلبات نقداً عند
   الاستلام أو عند التوصيل. انظر سياسة الدفع.», which would contradict this
   policy the moment online payment is on. Their update is `docs/legal/TERMS_CONDITIONS_CARD_PAYMENTS_DRAFT.md`,
   now drafted (R9). Its PAYMENT line reuses this draft's HOW YOU PAY wording,
   the English after "at pickup or on delivery" and the second Arabic sentence
   byte for byte, so any change to HOW YOU PAY is made in both. When read at
   `04eb351`, `OWNER_ACTIONS.md` §47.15, `PAYMENTS.md` §7 step 11 and
   `GO_LIVE_READINESS.md` G5 named only the other documents; `terms_conditions`
   was added to all three on 2026-11-13. Publishing is two steps: the row write,
   then a production rebuild so the no-JavaScript `legal.html` carries it
   (`LEGAL_DOCUMENTS_AUDIT.md` §Method rule 7).
7. **Naming the methods (fact-check S5).** mada, Visa and Mastercard are Moyasar
   dashboard settings, not code, and can drift from the policy. Publish the list
   only once Moyasar has confirmed in writing that SADAD, STC Pay and any
   unnamed scheme (for example American Express) are off for invoices
   (`OWNER_ACTIONS.md` §47.19); if one is on, switch it off first or name it and
   re-check PAYING ONLINE against it. Marked in the text.
8. **Optional additions, not drafted.** (a) A sentence that a card issued in
   another currency may be converted by the customer's bank, with its own fees.
   (b) What appears on the customer's card statement. Neither is in the code
   (Claims, items 7 and 8).
9. **For the native reader.**
   - Brand names stay in Latin script (Moyasar, Visa, Mastercard, iPhone,
     Android, and Apple Pay in the bracket), as in the live Arabic documents
     and the privacy draft. Whether to add Moyasar's Arabic brand form (ميسر) is
     the reader's call. Where Moyasar is the subject of a verb, the verb is now
     feminine (تقدّم، and تؤكد in a bracket), the rule the privacy draft follows
     and the way the live Privacy Policy treats Google («تعرض Google»); after
     «مزوّد» the agreement stays masculine. The previous revision used يقدّم and
     يؤكد (re-check, R8).
   - «بطاقات مدى وVisa وMastercard»: the conjunction before a Latin word.
   - «١٫٠٠ ريال سعودي» uses the Arabic decimal separator (U+066B) with
     Arabic-Indic digits, matching «١٥٪» in v2.0. The app's own message writes
     «1.00 ريال» (`strings.ts:569`); pick one.
   - «تقدّم خدمة الدفع الإلكتروني Moyasar» puts the subject after the object to
     keep the brand at the end of the clause; check it reads naturally.
   - «تُحصَّل» for "charged", and «لن يُحصَّل منك أي مبلغ» for "no payment is
     taken".
   - «البنك المُصدر لبطاقتك» for "your bank", as in the privacy draft.
   - HOW YOU PAY is two sentences in Arabic (one in English), so that
     «إلكترونياً» cannot be read as a third way of paying cash (fact-check N6).
   - «فلا يصل إلينا رقم بطاقتك كاملاً ولا رمز الأمان أبداً، ولا نخزّنهما في أي
     حال»: both clauses carry "never", as the English does (fact-check N6).
   - «فتصل إلى Moyasar مباشرةً دون أن تمر بنا» is the privacy draft's phrase for
     "they go to Moyasar directly, not through us" (R2).
   - «فأوقف استبدال النقاط في هذا الطلب» follows the app's switch label
     «استبدال نقاط الولاء» (`strings.ts:540`). «ولا يمكنك أن تختار استخدام جزء
     من نقاطك فقط» is new (R1); the live Loyalty Terms' «يُستخدم رصيدك المتاح
     بالكامل بما لا يتجاوز قيمة الطلب» is now only in the bracket.
   - «وبعد تأكيد دفعتك» for "Once your payment is confirmed" (R3).
   - «فيُبقيها التطبيق مفتوحة على النحو نفسه» for "keeps it open in the same
     way" (R4).
   - «ولم يتمكن التطبيق من تأكيد دفعتك» follows the refund draft's «ولم يتمكن
     التطبيق من تأكيد الدفع» (R6).
   - «شبكة البطاقة» follows the privacy draft (R7). «وآخر أربعة أرقام من
     البطاقة» says «من البطاقة» where the privacy draft says «منها», so that the
     digits cannot be read as the network's.
   - «رقم الطلب لدى الفرع … فور إصداره من الفرع» is the app's own wording
     (`strings.ts:730-732`).
   - The brackets in the Arabic are for the owner and are removed before
     publishing; only the sentences they offer need the native read.
10. **Closing the payment page (fact-check B3).** The text says what the app does
    today: a closed, unpaid payment stays open, and until it expires every new
    order, cash included, takes the customer back to it. If the app is changed
    first so that a customer can end such a payment and pay in cash at once,
    the bracket gives the replacement sentence (Product gaps, PAY-1; gap PG-04). Since the
    re-check (R4) the text also says that a payment we cannot check with
    Moyasar stays open in the same way, after a decline or an expiry too; the
    bracket says when that sentence goes.
11. **Cash without a condition (decide once for the set; re-check, R11).** HOW
    YOU PAY says "can be paid in cash" without a condition, as the
    terms_conditions draft's PAYMENT line does; the privacy draft says "Where the
    app offers it, you can pay in cash". Cash is an admin switch
    (`cash_payment_enabled`, live true; live `place_order` refuses cash when it
    is off), so the text is true today and becomes untrue only if cash is
    switched off. If the set is to stay true through that switch (the
    terms_conditions draft's Open owner decisions, item 2), replace the first
    English sentence of HOW YOU PAY, and the two Arabic sentences that render
    it, in step with that draft:
    - EN: "Orders placed in the Spicy Meal app can be paid in whichever of these ways the app offers at checkout: in cash — at the counter when you collect a pickup order, or to the driver when a delivery order arrives — or online, as part of placing your order."
    - AR (needs the same native read): «يمكن دفع قيمة الطلبات المقدَّمة عبر تطبيق سبايسي ميل نقداً، عند الكاشير حين تستلم طلب الاستلام، أو للسائق عند وصول طلب التوصيل، حيث يتيح التطبيق ذلك عند إتمام الطلب. ويمكن أيضاً، حيث يتيح التطبيق ذلك، دفعها إلكترونياً أثناء تقديم الطلب.»

    The Arabic stays two sentences, as the terms_conditions draft's alternative
    does, so that «إلكترونياً» is not read as a third way of paying cash
    (fact-check N6); its second sentence is the current one, unchanged, so the
    two documents still share it byte for byte. Then also make "or pay in cash"
    in PAYING ONLINE, paragraph 2, "or, where it is offered, pay in cash" /
    «أو ادفع نقداً حيث يتاح». Not marked in the text, because the text is true
    today.
12. **Points used (re-check, R1; Product gaps, PAY-3; gap PG-31).** The text now says only
    that a customer cannot choose to use some of their points. It no longer
    repeats the live Loyalty Terms' "your whole available balance is applied, up
    to the value of the order", which is untrue for an order worth less than
    SAR 10.00 after any coupon: the redemption minimum (100 points) is applied to
    the points used on the order, not to the balance held. Either change the
    server so the minimum applies to the balance, and the bracket's sentence can
    then be used here; or keep this text, and correct the Loyalty Terms' sentence
    in their own next version. Marked in the text.

---

## Product gaps found

Where the product does not do what a reasonable promise needs, the text says
what the product does today, and an `[OWNER DECISION]` gives the wording to use
if the product changes first. None of these is fixed by this document.

- **PAY-1 (gap PG-04). Closing the payment page holds every new order, cash included, until
  the page expires, and for as long as Moyasar cannot be reached** (fact-check
  B3; re-check R4; `docs/readiness/20261113-card-payments-gaps.md` PG-04). A customer who closes
  Moyasar's page meaning to pay cash is returned to it on entering checkout and
  on every Place order, for as long as the invoice is open: 30 minutes live,
  configurable from 5 to 60 (`moyasar.ts:259-260`). **Found on re-check:** a
  check that cannot reach Moyasar answers "pending" with no time limit
  (`moyasarVerify.ts:550-556`), so while Moyasar or the proxy is out of reach
  the hold outlasts the page, after a decline or an expiry too; PG-04 puts that
  at hours in an outage. And the invoice can outlive its checkout session: the
  session lasts 30 minutes from Place order (live `checkout_sessions.expires_at`
  default `now() + 30 min`), while the invoice ends a minute before its payment
  attempt, which runs for the configured expiry from the moment it opens (live
  `begin_session_attempt`, not capped at the session's end; `PAYMENTS.md` §2,
  "No invoice outlives its attempt"). With the expiry above 30 minutes, or an
  attempt opened more than about a minute after the session, live
  `begin_session_attempt` then refuses the expired session ("Checkout session
  expired"), so for the rest of the page's life the app cannot reopen it and
  still holds every new order. Keep the expiry at 30 minutes or less. Evidence:
  row 10. Text: says so, outage included. Product fix: let a customer end an
  open, unpaid payment; the app keeps it today so that it
  cannot be paid alongside a second order (`CheckoutScreen.tsx:722-726`), so the
  fix must keep that guarantee; PG-04 proposes cancelling the unpaid invoice at
  Moyasar first. Bracket in PAYING ONLINE, paragraph 4.
- **PAY-2 (gap PG-05). The app's below-minimum message tells the customer to "Use fewer
  points"**, which the app cannot do (fact-check B2): `payBelowMinimum`,
  "Online payment needs a total of at least 1.00 SAR. Use fewer points, or pay
  in cash." (`strings.ts:208`; AR «استخدم نقاطاً أقل» at `:569`).
  `RELEASE_CHECKLIST.md:190-192` and `PAYMENTS.md:275-277` expect that message,
  so they change with it. A copy fix ships only with an EAS build. This policy
  no longer repeats the old advice (`docs/readiness/20261113-card-payments-gaps.md` PG-05).
- **PAY-3 (gap PG-31). The checkout summary does not apply two of the server's points rules**
  (found while re-checking B2; not in the fact-check; the gaps list carries it
  as PG-31 since the final review, 2026-11-14, among the gaps to fix before card
  payments go live, in the `OWNER_ACTIONS.md` §47.17 build). The summary's points
  discount is the balance times the point value, capped at the goods value
  after any coupon (`previewTotals.ts:132-136`). The server redeems whole points only, and redeems
  **none** when the whole points that fit the order are fewer than the minimum
  (live `place_order` and `compute_order_snapshot`:
  `floor(v_pre_loyalty / v_per_point)`, then
  `if v_loyalty_redeemed < min_points_to_redeem then v_loyalty_redeemed := 0`;
  live `min_points_to_redeem` 100, `discount_per_point` 0.10). So:
  - a pickup order whose goods come to less than SAR 10.00, with points
    switched on by a customer holding 100 points or more, shows a total of 0.00
    while the system redeems nothing and charges the full amount (24 of the 55
    active products are priced under SAR 10.00): with card payment, Moyasar's
    page then asks for that amount, and closing it runs into PAY-1;
  - with a percentage coupon (one, 15%, is active live) the value after the
    coupon can fall between tenths (for example SAR 21.25 from a SAR 25.00
    order), so the summary shows 0.00 while the system leaves SAR 0.01 to 0.09,
    which online payment refuses as below the minimum.
  The text stays true: PRICES AND VAT already makes "the total confirmed by our
  system" the amount payable, and "If your points cover the whole order" is
  judged on that total. Product fix: mirror both rules in `computePreviewTotals`.
  Related, in the live Loyalty Terms: "you need at least 100 points before you
  can redeem" does not say that an order must also be worth at least 100 points
  (SAR 10.00) for any to be redeemed. **Re-check (R1):** for the same reason the
  Loyalty Terms' "When you do, your whole available balance is applied, up to
  the value of the order" is untrue for such an order, and the previous revision
  of this policy repeated it. PAYING ONLINE, paragraph 2, now says only that a
  customer cannot choose to use some of their points; its bracket gives the
  fuller sentence to use if the server is changed so that the minimum applies to
  the balance held (Open owner decisions, item 12).
- **PAY-4 (gap PG-02). Payments that only a person can put right: money taken without a
  confirmed order, and duplicates** (fact-check S6). Nothing alerts staff, each
  is refunded by hand in the Moyasar dashboard, and the automatic refund ledger
  refunds only an order's own paid payment, so it can reach neither (row 11).
  Text: "contact us", with the details to give; no promise. Bracket in PAYING
  ONLINE, paragraph 5, tied to the refund draft's D2 and D3
  (`docs/readiness/20261113-card-payments-gaps.md` PG-02).
- **PAY-5 (gap PG-12). Apple Pay cannot be verified before this text must be live**
  (fact-check B4). Not a code defect: the only check needs online payment on.
  Text: Apple Pay not named. Bracket in HOW YOU PAY.
- **PAY-6 (gap PG-27). An order-first online path is still reachable through the API**
  (fact-check N9, informational; checked live). `place_customer_order` is
  executable by `authenticated` and forwards `p_payment_method`; live
  `place_order` accepts `'online'` whenever online payment is on (it raises only
  when it is off); `payment-initiate` still serves the order flow
  (`initiateMoyasar`, `payment-initiate/index.ts:395-407`). "Until then there is
  no order" holds because no app build uses that path. No text change; for the
  code owners (`docs/readiness/20261113-card-payments-gaps.md` PG-27).

**Outside this document** (for the owners of those texts):

- **PAY-7 (gap PG-22). Live `offers_loyalty_terms` v2.2 says "Points are added when you place
  the order, and your balance updates immediately."** Live `place_order` and
  `insert_order_from_snapshot` write `earn_pending`, and `admin_set_order_status`
  promotes it later (read 2026-11-13), so that sentence is already wrong. Worth
  adding to the card go-live set (fact-check, "Outside this draft").
  `docs/readiness/20261113-card-payments-gaps.md` PG-22 adds that the promotion happens only on
  Delivered, which nobody sets, so no order has been credited since 2026-09-14.
- **PAY-8. Withdrawn on re-check (R5); no global ID.** It said that "You receive an order
  number on confirmation" (live PAYING IN CASH, kept here byte-identical) and
  "An order is placed when the app confirms it and gives you an order number"
  (live Terms & Conditions, ORDERING) had the imprecision fact-check N4 found.
  They do not. The app confirms an order only once the branch's POS has returned
  its reference (`apps/mobile/src/features/orders/orderConfirmation.ts:66`,
  `:148`); the sync worker writes that reference and the branch's order number
  together (`supabase/functions/lazywait-sync/index.ts:528-545`); and live, all
  71 orders that reached the POS carry both (read 2026-11-13). The
  terms_conditions draft rejected PAY-8 on this evidence. N4 was right about the
  first draft's online sentence, where "confirmation" could be read as the
  payment's; the real inconsistency left was this draft's own "Once it is
  placed" (row 9, R3). One theoretical case remains, the same for cash and
  card: a POS reply with a reference and no number would show "Order
  confirmed" beside "Not issued yet".

---

## Claims the drafter could not verify

1. **That mada, Visa and Mastercard are enabled (and Apple Pay)** is the owner's
   statement (`PAYMENTS.md:15`). The invoice request has no payment-method field
   (`Moyasar_API_Reference.md` §11 Q1), so the hosted page shows whatever the
   account has switched on. SADAD and STC Pay being off is unconfirmed by
   Moyasar (§47.19); the text now carries that as a publish precondition.
2. **Apple Pay inside the app's payment screen.** Unconfirmed by Moyasar, and the
   sandbox cannot show an Apple Pay success at the 1.00 SAR admin test amount
   (`PAYMENTS.md` §9 A). It is a release gate on a real iPhone, which is why the
   text no longer names it (Open owner decisions, item 2).
3. **"No payment is taken" on a decline, an expiry or a closed page** follows
   from the status mapping and the code path (rows 9-10). A temporary
   authorisation hold by the card issuer is outside what the code can see.
   Whether a 3-D Secure payment still in flight can complete after its invoice
   expires is open (`PAYMENTS.md` §11 Q6); if it can, the customer did pay, the
   payment is confirmed late, and it either places the order or becomes a
   duplicate.
4. **"Secure".** Moyasar's certifications are not in the repository. The word
   follows the app's own footer (`checkout.tsx:221`).
5. **Refunds return to the original card or payment method.** The code refunds
   only against the original payment (row 12), but no refund has been sent with
   this code yet: the sandbox and the live test are still ahead
   (`OWNER_ACTIONS.md` §47.9, §47.18). That the money then lands on the card,
   including a card behind Apple Pay, is card-network behaviour, not something
   in the repository.
6. **Old builds.** The repository holds only the current app. That builds already
   in customers' hands also pay through a checkout session (row 9) is taken from
   `PAYMENTS.md` §4-§5 and §12, not from their source.
7. **What appears on the customer's statement.** No `statement_descriptor` is
   configured (live read) and the invoice body does not send one
   (`moyasar.ts:344-352`). What Moyasar prints is unknown.
8. **Foreign-currency cards.** Whether Moyasar or the issuer converts, and at
   what cost, is not in the repository.
9. **A points redemption reaching exactly zero.** Resolved by the fact-check
   (B2) and re-checked: points can bring a pickup order to exactly 0.00, and
   live `begin_checkout_session` then settles it without a charge (row 8). The
   text now says so.
10. **A printed invoice for an online order.** Whether the branch can print one
    on request, as PAYING IN CASH says for cash orders, is not in the code.
11. **The order number for an online order.** Resolved: the text now says the
    branch's number appears as soon as the branch issues it, which is what the
    receipt does (row 9). Not exercised with a live online order.
12. **Moyasar being a Saudi company, where it processes data, and how long it
    keeps it.** `RECORD_OF_PROCESSING.md` ("Where the data goes outside the
    Kingdom") records Moyasar as inside the Kingdom by its own public statement,
    not yet confirmed by contract. Moyasar's public privacy policy (last revised 8
    December 2025) says it does not transfer personal data outside the Kingdom,
    and states no retention period beyond "as long as necessary". The Moyasar
    agreement has not been read. This document makes no claim on any of it.
13. **The hold while Moyasar cannot be reached** (re-check, R4) follows from the
    code: a check that cannot reach Moyasar answers "pending", and the app keeps
    a pending payment open. It has not been exercised against a real outage.

---

## Fix log

One line per finding in `docs/readiness/20261113-card-payments-reviews/payment_policy.review.md`. Each was
re-checked in the default branch at `04eb351` or the live database (read-only,
2026-11-13) before it was applied.

- **B1 → fixed.** `terms_conditions` added to the publishing plan (header, Open
  owner decisions item 6) and `docs/legal/TERMS_CONDITIONS_CARD_PAYMENTS_DRAFT.md` referenced, not
  written; "Publishing early is safe" removed. Live T&C PAYMENT text and hashes
  confirmed; `OWNER_ACTIONS.md` §47.15 and `GO_LIVE_READINESS.md` G5 confirmed
  not to list it (they needed the addition outside this file; both list it
  since 2026-11-13).
- **B2 → fixed.** "Use fewer points" removed; all-or-nothing stated; zero total
  added ("nothing is charged and no payment page opens"). Confirmed in
  `CheckoutScreen.tsx:415`, `:778-781`, the on/off `LoyaltyToggle`, live Loyalty
  Terms v2.2, live `compute_order_snapshot` and `place_order`, and live
  `begin_checkout_session`. One change to the suggested wording: "the
  app always applies your whole points balance, not part of it" is untrue when
  the balance exceeds the order (only up to the order value is applied, live
  `least(…, floor(v_pre_loyalty / v_per_point))`), so the Loyalty Terms' own
  words are used. The app message → PAY-2; a related summary gap → PAY-3.
- **B3 → fixed + owner decision.** Text now says a closed payment stays open
  until it expires; bracket gives the wording for a changed app. Confirmed in
  `moyasarVerify.ts:584`, `pendingSession.ts:79-85`, `:164-188`,
  `CheckoutScreen.tsx:286-297`, `:727-733`, `PaymentStatusDialog.tsx:112-116`.
  → PAY-1.
- **B4 → owner decision.** Apple Pay removed from the text (option a,
  recommended); option b's exact EN and AR sentences are in the bracket.
  Confirmed in `RELEASE_CHECKLIST.md:161-173` and `OWNER_ACTIONS.md` §47.15,
  §47.18. → PAY-5.
- **S1 → fixed.** "Where it is offered, online payment is available only in the
  app …". Confirmed: switch off live, TEST-mode refusal at
  `payment-initiate/index.ts:495`, `:509`.
- **S2 → fixed.** Confirmed: masked number, name and payer IP reach the server
  and are dropped (`moyasar.ts:732-768`, `moyasar.test.ts:669`).
- **S3 → fixed, one change.** "Includes", with an example; the pointer says the
  Privacy Policy "explains" rather than "lists everything we keep", because the
  privacy fact-check (item 12) found two stored fields that draft does not list.
- **S4 → owner decision.** D4 marker added and wording aligned with the refund
  draft ("card or payment method …, through Moyasar"). Confirmed: only route is
  `moyasarRefund.ts:260-262`.
- **S5 → owner decision.** Publish precondition added to the method list.
  Confirmed: `PAYMENTS.md:15`, `:635-637`; §47.19 still open.
- **S6 → fixed + owner decision.** Date, time, amount, order number if any, and
  "Never send us your full card number" added; the refund promise is tied to the
  refund draft's D2 and D3 so that it is decided once. Confirmed: live Contact &
  Support asks for an order number; refund draft line 160. → PAY-4.
- **N1 → owner decision.** Version decided once for the set (Proposed text
  heading, item 1, row 15).
- **N2 → fixed.** "Basket" → "cart" (`strings.ts:149-152`).
- **N3 → fixed.** "Online, as part of placing your order"; "When you place an
  order with online payment, the app opens …" (`CheckoutScreen.tsx:770-786`).
- **N4 → fixed, wording changed.** "The branch's order number appears in the app
  as soon as the branch issues it", the app's own copy (`strings.ts:388`,
  `:732`), instead of the suggested "once the branch accepts the order": the live
  T&C define "accepted" as "when the branch begins preparing it", a different
  moment from the one the number appears. → PAY-8 for the cash and T&C sentences
  (PAY-8 withdrawn on re-check, R5).
- **N5 → fixed.** "Confirmed by our system".
- **N6 → fixed.** Both clauses of the card sentence say "never" in Arabic; HOW
  YOU PAY split into two Arabic sentences. Flagged for the native read (item 9).
- **N7 → fixed.** "As with a cash order" removed.
- **N8 → fixed.** Row 13 now cites `moyasarVerify.ts:332-333`, `:375-376`,
  `:473-474` (confirmed); `:182-183` / `:197-198` are the duplicate helper.
- **N9 → no text change (informational).** Confirmed live: `place_customer_order`
  executable by `authenticated`, forwards `p_payment_method`; `place_order`
  accepts `'online'` when on. → PAY-6.
- **"Outside this draft" (Loyalty Terms, earn timing) → recorded.** Confirmed
  live (`earn_pending` in `place_order` and `insert_order_from_snapshot`). → PAY-7.
- **Rejected: none.** Three suggested wordings were adjusted (B2, S3, N4), each
  for the reason given on its line.

**Independent re-check, 2026-11-13 (findings R1 to R13).** Every factual claim
in the proposed text was traced again to the default branch at `04eb351` and to
read-only SQL on Production; the four sibling drafts and the store answers were
read for consistency. Each line below was re-checked before it was applied.

- **re-check: byte-identity → verified, no change.** The live rows still hash
  `0f883dcd…` (EN, 1 267) and `44e5b1f4…` (AR, 1 091). Rebuilding v2.0 from the
  whole-document blocks above, with the three old blocks put back, reproduces
  both hashes, before and after this revision; each old block occurs once in the
  live text; PRICES AND VAT plus PAYING IN CASH and CONTACT still hash as listed
  under "Current (live) text".
- **re-check: earlier findings → all fixed or justified above.** B1 to B4, S1 to
  S6, N1 to N9 and "Outside this draft" each have a line. Four of those fixes
  were themselves revised by this re-check: B2's wording (R1), S2's "not in our
  app" (R2), S3's "card type" (R7) and N4's pointer to PAY-8 (R5).
- **re-check R1 (blocking) → fixed + owner decision.** "You cannot use only some
  of your points: when you use them, your whole available balance is applied, up
  to the value of the order" (the live Loyalty Terms' words, adopted for B2) is
  untrue for an order worth less than SAR 10.00 after any coupon: live
  `place_order` and `compute_order_snapshot` use 0 points when fewer than
  `min_points_to_redeem` (100) would be used, whatever the balance; 24 of 55
  active products cost under SAR 10.00. Now "You cannot choose to use only some
  of your points.", true in every case (`CheckoutScreen.tsx:415`), with the old
  sentence in a bracket for a changed server. → PAY-3, Open owner decisions item 12.
- **re-check R2 (should-fix) → fixed.** "You enter your card details on that
  page, not in our app": the new build shows the page inside the app's payment
  screen (`checkout.tsx:2-5`), and the store answers say "shown inside the app".
  Now "and they go to Moyasar directly, not through us:", the privacy draft's
  wording, true of new and old builds.
- **re-check R3 (should-fix) → fixed.** "Once it is placed" used "placed" for
  the moment the paid order is created; the live T&C and the app use it for the
  branch's confirmation, and a paid order that never reaches the branch is "Order
  not placed" (`strings.ts:374`). Now "Once your payment is confirmed"
  (suggested by the terms_conditions draft).
- **re-check R4 (should-fix) → fixed + owner decision.** The hold was said to end
  when the payment page expires; a check that cannot reach Moyasar is "pending"
  with no limit (`moyasarVerify.ts:550-556`), so it lasts as long as Moyasar or
  the proxy is out of reach, after a decline or an expiry too. Sentence added;
  the closing bracket now says when it goes; PAY-1 extended (with the
  session-expiry gap); the proxy bullet under "Left unchanged" corrected.
- **re-check R5 (should-fix, notes) → fixed.** PAY-8 withdrawn: confirmation and
  the branch's number arrive together (`orderConfirmation.ts:66`,
  `lazywait-sync/index.ts:528-545`; 71 of 71 synced orders live). The PAYING IN
  CASH bullet under "Left unchanged" corrected.
- **re-check R6 (nit) → fixed.** "the app does not confirm your order" → "the
  app could not confirm your payment", the app's `payUnknown` copy and the refund
  draft's words; "Order confirmed" in the app is the branch's confirmation.
- **re-check R7 (nit) → fixed.** "card type" → "card network" / «شبكة البطاقة»,
  the privacy draft's term; the Arabic now says «من البطاقة».
- **re-check R8 (nit) → fixed.** Moyasar as the subject of a verb is feminine
  (تقدّم; تؤكد in a bracket), as in the privacy draft and the live «تعرض Google».
- **re-check R9 (nit, notes) → fixed.** Stale references: the refund draft's
  `:160` and `:255` (then `:202` / `:248` and `:57` / `:309`; section references
  since the final review, 2026-11-14); the terms draft
  "being written in parallel" (now drafted, and byte-dependent on HOW YOU PAY);
  the privacy fact-check rationale in row 14; the pending-payment dialog also has
  Close (`PaymentStatusDialog.tsx:125`).
- **re-check R10 (nit, notes) → recorded.** The privacy draft still names Apple
  Pay behind the device-check bracket B4 showed cannot be settled in time; the
  store answers keep it out of the listing copy until the check has passed.
  Open owner decisions, item 2.
- **re-check R11 (nit, notes) → owner decision.** The set-level choice to hedge
  cash (terms_conditions draft, its item 2; the privacy draft already hedges)
  needs matching HOW YOU PAY wording here; given in item 11, not in the text.
- **re-check R12 (nit, notes) → resolved 2026-11-13.** The refund draft's
  "working days" / «أيام عمل» matches Moyasar's FAQ ("business days"). The
  repository's records said "about 1 to 3 days" until they were corrected on
  2026-11-13.
- **re-check R13 (nit, notes) → fixed.** Product gaps cross-referenced to
  `docs/readiness/20261113-card-payments-gaps.md` (PG-02, PG-04, PG-05, PG-22, PG-27).
- **re-check: considered, not changed.** (a) A customer whose card was declined
  and who then closes the page is described by both paragraph 4 sentences; the
  code follows the decline sentence (`payment-verify` answers "failed"), and the
  close sentence errs toward describing the hold, so neither misleads against
  the customer. (b) "Only in the app on iPhone and Android": the iOS build is an
  iPhone app (`apps/mobile/app.json`, `supportsTablet: false`), which Apple can
  still let a customer install on an iPad; online payment would then be offered
  there too, which is more than the sentence says, not less. (c) HOW YOU PAY's
  first paragraph is untouched, because the terms_conditions draft reuses it
  byte for byte.

### Final review, 2026-11-14

One line per review finding on this file. Each was checked against the
repository at `ebdec3a`, Moyasar's own pages and read-only SQL before it was
applied.

- **K6 → applied.** No owner decision on the publishing plan is recorded
  anywhere, so the header now reads "Publishing plan (proposed; the owner
  decides)", and Open owner decisions, item 6, "proposed after fact-check B1;
  the owner decides, gap PG-08".
- **C2, K12 → applied.** Item 6 said §47.15 and G5 still needed
  `terms_conditions`. It now says that §47.15, `PAYMENTS.md` §7 step 11 and G5
  named only the other documents at `04eb351`, and that all three list it since
  2026-11-13. The B1 line of the Fix log says the same.
- **X2, K11 → applied, with the verifiers' corrected wording, by section rather
  than by line.** "Left unchanged on purpose", refund timing, said the
  repository gave "days", not "business days", and that the refund draft's
  "working days" had no support. Moyasar's FAQ says "Mada cards: 24 hours to 3
  business days. Credit cards: 7 to 14 business days. Weekends not included.",
  and both records were corrected to that on 2026-11-13
  (`Moyasar_API_Reference.md` §3.2, `OWNER_ACTIONS.md` §47.18). The note now
  says so, and re-check R12 is marked resolved.
- **C8, C9 → applied.** The local gap IDs PG1 to PG8 read like the global PG-01
  to PG-08 and meant different gaps. They are now PAY-1 to PAY-8, each with its
  global ID from `docs/readiness/20261113-card-payments-gaps.md`: PAY-1 (gap
  PG-04), PAY-2 (gap PG-05), PAY-3 (gap PG-31, added to the gaps list in this
  review), PAY-4 (gap PG-02), PAY-5 (gap PG-12), PAY-6 (gap PG-27), PAY-7 (gap
  PG-22), PAY-8 (withdrawn, no global ID). The four "(Product gaps, PG3)"
  citations inside the owner bracket of PAYING ONLINE paragraph 2 (English and
  Arabic, in the edit blocks and the whole-document blocks) now read "(Product
  gaps, PAY-3; gap PG-31)". Only bracket text changed, so no customer sentence
  and nothing for the native read. The whole-document counts were re-measured
  (English 7 052, Arabic 6 292). Putting the three old blocks back into the
  whole-document blocks still gives both live v2.0 hashes, `0f883dcd…` and
  `44e5b1f4…`.
- **Consistency fixes made in this review (no finding ID).** Open owner
  decisions, item 2, said the privacy draft names Apple Pay twice. That was
  true when read, but that draft's own re-check (R1) has since dropped Apple Pay
  by default, so the item now says all three drafts follow option (a). Claims,
  item 12, now quotes Moyasar's public privacy policy on where it processes data
  (the fact behind X3 in the privacy draft). Rows 11 and 15 now cite the refund
  draft by section, because its file lines move.
