# Terms & Conditions: online card payment (draft)

> **Status: DRAFT, engineering-written 2026-11-13, against the live row and the
> four fact-checks in `docs/readiness/20261113-card-payments-reviews/` that propose wording for this document
> (see "Fix log" at the end). Not reviewed by counsel. Not published.** Editing a
> live `legal_documents` row is a CLAUDE.md §5 action, and so is turning online
> payment on. This file holds the exact text and the evidence behind it, so
> publishing can be a copy-paste.
>
> **The Arabic needs a native read** before it is published. It is
> engineering-drafted Modern Standard Arabic in the register of the live Arabic
> document. Its second sentence is the payment_policy draft's own sentence, byte
> for byte, so one read covers both (same pass as `OWNER_ACTIONS.md` §35).
> Points for the reader are under "Open owner decisions", item 5.
>
> **Scope.** Only what card payment requires. Two lines change in each language:
> line 1 (the date) and the single line of PAYMENT. The other 43 lines of each
> language, blank lines included, stay byte-for-byte as they are in v2.0. No
> other clause says or assumes cash only: CANCELLING is a pointer to the
> Cancellation and Refund Policy, and every clause that touches payment was read
> against the code and kept (see "Left unchanged on purpose").
>
> **Publishing plan (decided).** `privacy_policy`, `payment_policy`,
> `cancellation_refund_policy` and `terms_conditions` are published **together,
> in both languages, in one owner-approved session**, before `OWNER_ACTIONS.md`
> §47.18 (online payment on). This document is never published alone, and never
> in English first. The store answers and the listing copy change in the same
> window. It cannot go alone in either direction: the new PAYMENT line sends the
> reader to the Payment Policy, whose live v2.0 says *"Online card payment is not
> currently available in the app."*; and the live line it replaces, *"Orders are
> paid in cash at pickup or on delivery."*, contradicts the other three drafts
> from §47.18 on. Online payment is stated conditionally ("where the app offers
> it"), so the text is true between that session and §47.18, while online
> payment is still off.
>
> Text in `[OWNER DECISION: …]` brackets must be settled and the brackets removed
> before publishing. Nothing else in the proposed text is a placeholder.

---

## Current (live) text

Read-only from Production (`public.legal_documents`, `document_type =
'terms_conditions'`, `is_active = true`) on **2026-11-13**:

- **version `2.0`**, `effective_date` **2026-08-18**, title "Terms & Conditions"
  / «الشروط والأحكام», last written 2026-08-18 11:37:16 UTC. It is the only
  `terms_conditions` row;
- `md5(content_en)` = `0da664333b24808294b771f436272c02` (2 584 characters, 45
  lines);
- `md5(content_ar)` = `bcd2dc7af623a2b28b031e1a861d04c9` (2 147 characters, 45
  lines).

Both texts were read as base64, decoded locally and hashed; both hashes match
the live row, so every quotation below is byte-exact. Re-read both hashes before
publishing. If either has moved, something was published since this draft and
the anchors must be re-checked.

Live context, read the same day: `app_settings.online_payment_enabled` is
**false**, `cash_payment_enabled` **true**, `default_payment_method` `cash`; the
payment row is provider `moyasar`, enabled, mode `test`, currency `SAR`, last
written 2026-11-13 18:17 UTC. No card has paid for an order yet: the one order
ever recorded as paid online (2026-11-11, while online payment was briefly on in
TEST mode) has a total of 0.00 and no payment record.

### English (v2.0): the two lines that change

**Line 1**

```
Effective date: 18 August 2026
```

**PAYMENT** (line 17; the heading on line 16 stays)

```
PAYMENT
Orders are paid in cash at pickup or on delivery. See the Payment Policy.
```

### Arabic (v2.0): the two lines that change

**السطر الأول**

```
تاريخ السريان: ١٨ أغسطس ٢٠٢٦
```

**الدفع** (line 17; the heading on line 16 stays)

```
الدفع
تُدفع الطلبات نقداً عند الاستلام أو عند التوصيل. انظر سياسة الدفع.
```

Each of the four old lines occurs exactly once in its text (checked), so each
`replace()` below has exactly one target.

### Unchanged, for the "nothing else moved" check

Hashed around line 1 and around the PAYMENT line, never over them
(`LEGAL_DOCUMENTS_AUDIT.md` §Method rule 6). Span A runs from the start of line
2 to the start of the PAYMENT line; span B runs from the end of the PAYMENT line
to the end of the text.

| Language | Span A md5 | Characters | Span B md5 | Characters |
| --- | --- | --- | --- | --- |
| English | `3c7989179153084405d213cf829691da` | 1 155 | `432bff4c20b65e764567fcd6528700ff` | 1 325 |
| Arabic | `0e2ad4ad5bac875901afb28c0d65dd4e` | 934 | `9123ca26bb527b6de6a513f6aaa4b44a` | 1 118 |

This read-only query returned exactly these four values against the live row on
2026-11-13, with the two v2.0 PAYMENT lines in it (and `version` 2.0,
`effective_date` 2026-08-18, `line_1` "Effective date: 18 August 2026" /
«تاريخ السريان: ١٨ أغسطس ٢٠٢٦»). After publishing, run it with the two new
PAYMENT lines (under "Proposed text") in their place: the four hashes must be
unchanged, each new line must occur exactly once, `version` must be the decided
number, and `line_1` must carry, in both languages, the same date as
`effective_date` (`LEGAL_DOCUMENTS_AUDIT.md` §Method rule 6). The `lang` column
says which row is which.

```sql
with d as (
  select 'en' as lang, version, effective_date, content_en as t,
         '<new English PAYMENT line>'::text as pay
    from public.legal_documents
   where document_type = 'terms_conditions' and is_active
  union all
  select 'ar', version, effective_date, content_ar,
         '<new Arabic PAYMENT line>'::text
    from public.legal_documents
   where document_type = 'terms_conditions' and is_active
), s as (
  select lang, version, effective_date, t, pay,
         length(split_part(t, E'\n', 1)) + 2 as a_start,
         strpos(t, pay) as p
    from d
)
select lang, version, effective_date,
       split_part(t, E'\n', 1)              as line_1,
       md5(substr(t, a_start, p - a_start)) as span_a_md5,
       md5(substr(t, p + length(pay)))      as span_b_md5,
       (length(t) - length(replace(t, pay, ''))) / length(pay) as occurrences
  from s
 order by lang;
```

---

## Proposed text

**Version: `[OWNER DECISION: 2.1 (minor) or 3.0 (major); minor or major is
decided once for the four documents published together]`** (Open owner
decisions, item 1). Set `effective_date` to
the publication date, the same date as the other three documents, and put that
date in line 1 of both languages.

Two edits per language, each a `replace()` of one whole old line above with the
new line below (`LEGAL_DOCUMENTS_AUDIT.md` §Method rule 4), plus the `version`
and `effective_date` columns. No section is added, removed or reordered.

### English

**Line 1**

```
Effective date: [OWNER DECISION: publication date, e.g. 20 November 2026]
```

**PAYMENT**

```
PAYMENT
Orders can be paid in cash at pickup or on delivery or, where the app offers it, online, as part of placing your order. See the Payment Policy.
```

The new line is 143 characters, md5 `170c08ae3d22ab7725b03660db1c2cec`.

### Arabic (needs a native read)

**السطر الأول** (Arabic-Indic digits, as in v2.0)

```
تاريخ السريان: [OWNER DECISION: تاريخ النشر، مثل ٢٠ نوفمبر ٢٠٢٦]
```

**الدفع**

```
الدفع
يمكن دفع قيمة الطلبات نقداً عند الاستلام أو عند التوصيل. ويمكن أيضاً، حيث يتيح التطبيق ذلك، دفعها إلكترونياً أثناء تقديم الطلب. انظر سياسة الدفع.
```

The new line is 145 characters, md5 `2ca8ae45437d95aca526cefcc8025eb4`.

### The whole document after the edit (for reading, not for pasting)

English, 2 697 characters with the bracket in place:

```
Effective date: [OWNER DECISION: publication date, e.g. 20 November 2026]

These terms govern your use of the Spicy Meal app, operated by First Taste Trading Company. By placing an order you accept them.

YOUR ACCOUNT
You sign in with your mobile number and a one-time code sent to you on WhatsApp. Keep your number and your device secure — an order placed from your verified session is treated as yours.
Give us accurate contact details. We may refuse or cancel an order if the details are clearly false.
You must be 18 or older to hold an account.

ORDERING
The menu, prices and availability shown in the app can change, and an item can sell out between the moment you add it and the moment you pay. The amounts confirmed by our system at checkout are the ones that apply.
All prices are in Saudi Riyals and include 15% VAT unless stated otherwise.
An order is placed when the app confirms it and gives you an order number. It is accepted when the branch begins preparing it. A branch may decline an order — for example outside its working hours, outside its delivery area, or when an item is unavailable — and we will tell you if it does.
Photographs of items are for illustration and may differ from what is served.

PAYMENT
Orders can be paid in cash at pickup or on delivery or, where the app offers it, online, as part of placing your order. See the Payment Policy.

PICKUP AND DELIVERY
See the Delivery and Pickup Policy for coverage, fees, minimum order values and timing.

CANCELLING
See the Cancellation and Refund Policy.

LOYALTY AND OFFERS
See the Offers and Loyalty Terms.

USING THE APP PROPERLY
Use the app only to order food and related services lawfully. Do not attempt to break into it, disrupt it, extract its data automatically, or place orders you do not intend to receive. We may suspend or close an account that does.

OUR RESPONSIBILITY
We are responsible for serving your order as described and for the quality and safety of the food we prepare. We are not responsible for a delay or a failure caused by something outside our reasonable control, or by contact or address details you gave us incorrectly.
Nothing in these terms removes a right you have under Saudi consumer protection law.

FOOD ALLERGIES
If you have an allergy or a dietary requirement, read the Food Allergy Notice before ordering.

CHANGES
We may update these terms. The current version is always the one in the app, with its effective date. Continuing to use the app after a change means you accept the updated version.

GOVERNING LAW
These terms are governed by the laws of the Kingdom of Saudi Arabia, and any dispute falls to the competent Saudi courts.

CONTACT
info@spicymeal.com.sa — 9200 31495
```

Arabic, 2 262 characters with the bracket in place:

```
تاريخ السريان: [OWNER DECISION: تاريخ النشر، مثل ٢٠ نوفمبر ٢٠٢٦]

تحكم هذه الشروط استخدامك لتطبيق سبايسي ميل الذي تُشغّله شركة الطعم الأول للتجارة. وبتقديمك أي طلب فإنك توافق عليها.

حسابك
تسجّل الدخول برقم جوالك وبرمز تحقق لمرة واحدة يصلك عبر واتساب. حافظ على أمان رقمك وجهازك، فأي طلب يُقدَّم من جلستك الموثّقة يُعد صادراً عنك.
زوّدنا ببيانات تواصل صحيحة. ويجوز لنا رفض الطلب أو إلغاؤه إذا كانت البيانات غير صحيحة بشكل واضح.
يجب أن يكون عمرك ١٨ عاماً فأكثر لفتح حساب.

الطلب
قد تتغيّر قائمة الأصناف والأسعار والتوفر المعروضة في التطبيق، وقد ينفد صنف بين لحظة إضافته ولحظة الدفع. والمبالغ التي يؤكدها نظامنا عند إتمام الطلب هي المبالغ المعتمدة.
جميع الأسعار بالريال السعودي وشاملة ضريبة القيمة المضافة ١٥٪ ما لم يُذكر خلاف ذلك.
يُعد الطلب مقدَّماً عندما يؤكده التطبيق ويمنحك رقم طلب، ويُعد مقبولاً عندما يبدأ الفرع بتحضيره. ويجوز للفرع رفض الطلب، مثلاً خارج ساعات العمل أو خارج نطاق التوصيل أو عند عدم توفر صنف، وسنخبرك إذا حدث ذلك.
صور الأصناف لأغراض التوضيح وقد تختلف عمّا يُقدَّم فعلياً.

الدفع
يمكن دفع قيمة الطلبات نقداً عند الاستلام أو عند التوصيل. ويمكن أيضاً، حيث يتيح التطبيق ذلك، دفعها إلكترونياً أثناء تقديم الطلب. انظر سياسة الدفع.

الاستلام والتوصيل
انظر سياسة التوصيل والاستلام للاطلاع على نطاق التغطية والرسوم والحد الأدنى للطلب والأوقات.

الإلغاء
انظر سياسة الإلغاء والاسترجاع.

الولاء والعروض
انظر شروط العروض والولاء.

الاستخدام السليم للتطبيق
استخدم التطبيق فقط لطلب الطعام والخدمات المرتبطة به بشكل نظامي. ولا تحاول اختراقه أو تعطيله أو استخراج بياناته آلياً أو تقديم طلبات لا تنوي استلامها. ويجوز لنا إيقاف أو إغلاق أي حساب يخالف ذلك.

مسؤوليتنا
نحن مسؤولون عن تقديم طلبك كما هو موصوف وعن جودة وسلامة الطعام الذي نُعدّه. ولسنا مسؤولين عن تأخير أو إخفاق سببه أمر خارج عن سيطرتنا المعقولة، أو بيانات تواصل أو عنوان زوّدتنا بها بشكل غير صحيح.
ولا يسقط أي مما ورد في هذه الشروط أي حق يكفله لك نظام حماية المستهلك في المملكة.

الحساسية الغذائية
إذا كانت لديك حساسية أو متطلب غذائي، اقرأ تنبيه الحساسية الغذائية قبل الطلب.

التعديلات
قد نحدّث هذه الشروط. والنسخة السارية هي دائماً الموجودة في التطبيق بتاريخ سريانها. واستمرارك في استخدام التطبيق بعد التعديل يعني قبولك النسخة المحدّثة.

النظام الواجب التطبيق
تخضع هذه الشروط لأنظمة المملكة العربية السعودية، وتختص المحاكم السعودية المختصة بنظر أي نزاع.

التواصل
info@spicymeal.com.sa — 9200 31495
```

---

## What changed and why

Paths are relative to the repository root, read from the default branch at `04eb351`.
Live facts were read from Production with read-only SQL on 2026-11-13.

| # | Change | Code fact it rests on |
| --- | --- | --- |
| 1 | **Line 1, both languages: the publication date.** | The date lives in the `effective_date` column and in the document's first line, and must move in both (`LEGAL_DOCUMENTS_AUDIT.md` §Method rule 6). v2.0 carries 18 August 2026 in both. |
| 2 | **PAYMENT: "Orders are paid in cash at pickup or on delivery." becomes "Orders can be paid in cash at pickup or on delivery or, where the app offers it, online, as part of placing your order."** Cash is kept as it was; online is added under the condition the code applies. | **Cash** is an admin switch, `cash_payment_enabled`, live **true**: live `place_order` raises "Cash payment is not available" when it is off, and the app offers cash only while it is on (`apps/mobile/src/lib/payment.ts:53`). **Online** is one global switch, `online_payment_enabled`, live **false**: live `begin_checkout_session` raises "Online payment is not available" while it is off, and the app offers online only while it is on and never in the web version of the app (`payment.ts:45-55`). Moyasar is the only provider (`supabase/functions/payment-initiate/index.ts:19-23`), and while the payment row is in TEST mode, as it is today, every customer checkout is refused (`refuseTestModeCheckout`, `payment-initiate/index.ts:354-356`, called at `:418`, `:432`, `:495`, `:509`). Neither method depends on pickup or delivery: the payment checks in live `place_order` and live `begin_checkout_session` read the switches, never the order type. So "where the app offers it" is the condition the code applies, and the sentence is true today, when no surface offers online payment, and after §47.18. |
| 3 | **"As part of placing your order."** | Place order opens a checkout session and then Moyasar's payment page, before any order exists (`apps/mobile/src/features/checkout/CheckoutScreen.tsx:770-786`); the order is created only once the payment has been verified with Moyasar (`supabase/functions/_shared/moyasarVerify.ts:1-5`, `:312`, `:342-346`, `:368`). ORDERING defines an order as placed "when the app confirms it", which is after the payment, so the payment is part of placing it. "When you place the order", the wording one fact-check proposed, would tie the payment to the moment of placement, which under ORDERING comes after it. A total fully covered by points opens no payment page at all (`CheckoutScreen.tsx:778-781`; live `begin_checkout_session`), which "can be paid" leaves room for. |
| 4 | **The same words as the Payment Policy.** The English after "at pickup or on delivery" is the payment_policy draft's HOW YOU PAY wording; the Arabic second sentence is that draft's sentence byte for byte, and «يمكن دفع قيمة الطلبات» is its opening. | Extracted from `docs/legal/PAYMENT_POLICY_CARD_PAYMENTS_DRAFT.md` (HOW YOU PAY, proposed English and Arabic) by script, not retyped, so these terms and the document they point to say the same thing in the same words. |
| 5 | **Two sentences in Arabic, one in English.** | As in the payment_policy draft (its fact-check N6): after the cash list, «أو إلكترونياً» could be read as a third way of paying cash. |
| 6 | **"See the Payment Policy." / «انظر سياسة الدفع.» kept; no method list and no provider name added.** | The detail lives in the Payment Policy draft (HOW YOU PAY: the card types; PAYING ONLINE: Moyasar, the SAR 1.00 minimum, declines, refunds). Because these terms name no payment method, that draft's method-list and Apple Pay decisions (its items 2 and 7) do not reach this document. Why Moyasar is not named here: Fix log, privacy_policy.review 6. |
| 7 | **Version: an [OWNER DECISION], decided once for the set.** | No code ties a customer's acceptance to a version number: the app and the public legal page read the active row (`apps/mobile/src/services/api.ts:285-289`, `src/legal/main.ts:126`), and no table stores an accepted version. The live row reads **2.0**; `LEGAL_DOCUMENTS_AUDIT.md` lines 16-17 say the other rows are "unchanged at 2.1", which is not true of this row. |

### Left unchanged on purpose

Every clause that card payment touches was read against the code.

- **The opening, "By placing an order you accept them."** An online payment is
  taken before the order is placed in the sense ORDERING gives that word, so for
  a card payment the money moves before this sentence's moment. The customer has
  already accepted these terms at sign-in: "By continuing, you agree to the
  Terms & Conditions and Privacy Policy." (`apps/mobile/src/features/auth/LoginScreen.tsx:83-93`),
  and Place order sits under "By placing this order, you agree to the …" with
  links to the Cancellation & Refund, Delivery & Pickup and Payment policies
  (`CheckoutScreen.tsx:73-77`, `:1128`). Kept; whether prepayment calls for
  different acceptance wording is counsel's question (Claims, item 1).
- **ORDERING, "an item can sell out between the moment you add it and the
  moment you pay".** True of both ways of paying. For an online order "the
  moment you pay" is at checkout; availability is checked when the checkout
  session is built, before payment, and deliberately not again afterwards
  (`docs/ORDER_CONFIRMATION_FLOW.md:1665-1671`).
- **ORDERING, "The amounts confirmed by our system at checkout are the ones that
  apply." and "All prices are in Saudi Riyals …".** A card is charged the
  server-computed session total in the attempt's currency, SAR live, and a
  payment confirms only if amount and currency match (payment_policy draft,
  row 7).
- **ORDERING, "An order is placed when the app confirms it and gives you an
  order number."** Matches the app for card and cash alike. "Order confirmed"
  appears only once the order has reached the branch's POS and the POS has
  returned its reference (`apps/mobile/src/features/orders/orderConfirmation.ts:66`,
  `:148`); the branch's number is written together with that reference
  (`supabase/functions/lazywait-sync/index.ts:528-545`) and shown as the POS
  issued it (`apps/mobile/src/features/orders/view/ConfirmationHero.tsx:25-30`);
  and a paid order that never reaches the branch is titled "Order not placed"
  (`apps/mobile/src/i18n/strings.ts:374`; «لم يتم إنشاء الطلب», `:718`). Live,
  all 71 orders that reached the POS carry both the reference and the number,
  and every order since 2026-08-28 has reached it (read 2026-11-13). This is why
  payment_policy PG8 is rejected for this document (Fix log).
- **ORDERING, "A branch may decline an order … and we will tell you if it
  does", and YOUR ACCOUNT, "We may refuse or cancel an order if the details are
  clearly false."** Neither promises anything about payment, so both stay true
  for an order paid in advance. What happens to the money is the Cancellation
  and Refund Policy's to say, and today it is a refund by hand (Product gaps,
  PG-T1). "We will tell you" is kept, and was checked rather than assumed: a
  decline is a staff cancellation in the console, which sends the "Order
  cancelled" push to the customer's devices that have order updates on
  (`src/lib/api.ts:911-923`; `supabase/functions/push-dispatch/index.ts:107-110`,
  `:431-435`), and the Orders tab shows the order as "Cancelled" / «ملغي»
  (`apps/mobile/src/features/orders/OrdersScreen.tsx:23`,
  `apps/mobile/src/features/orders/view/OrderCard.tsx:22`; `strings.ts:351`,
  `:698`). The order's own receipt does not show it (Product gaps, PG-T4).
- **CANCELLING, "See the Cancellation and Refund Policy."** Already the pointer a
  card customer needs; that policy's draft adds a section on refunds of online
  payments. The heading is not renamed.
- **OUR RESPONSIBILITY.** It limits liability for delays and failures; it does
  not say that money paid for an order we did not serve is kept, and its last
  sentence preserves consumer-law rights. With prepayment it can be read more
  widely than before, so an optional clarifying sentence is offered (Open owner
  decisions, item 4(d)).
- **PICKUP AND DELIVERY, LOYALTY AND OFFERS, USING THE APP PROPERLY, FOOD
  ALLERGIES, CHANGES, GOVERNING LAW, CONTACT.** No payment content. USING THE
  APP PROPERLY already requires lawful use, which covers paying with a card one
  may not use (an explicit sentence is optional, item 4(c)).

---

## Open owner decisions

1. **Version and date, once for the whole set.** 2.1 (the house convention for
   content changes since the 2026-08-18 rewrite; this document's change is one
   sentence) or 3.0, if the four documents published together are to move as
   one major version (the refund draft proposes 3.0, the payment_policy draft
   leaves it open, the privacy draft proposes its next minor, 2.4). Set the
   publication date in the `effective_date` column **and** in line 1 of both
   languages, the same date as the other three documents
   (`LEGAL_DOCUMENTS_AUDIT.md` §Method rule 6). Marked in the text.
2. **Cash stated without a condition (decide once for the set).** The new line
   says "can be paid in cash …", as the payment_policy draft's HOW YOU PAY does.
   The revised privacy draft instead says "Where the app offers it, you can pay
   in cash …" (its fact-check, item 8). Cash is an admin switch:
   `cash_payment_enabled`, live true; live `place_order` refuses cash when it is
   off; the app offers cash only while it is on (`payment.ts:53`). So the line is
   true today and becomes false only if cash is switched off. If the set is to
   stay true through that switch, use this line here, with the matching change
   in the payment_policy draft's HOW YOU PAY:
   - EN: "Orders can be paid in whichever of these ways the app offers at
     checkout: in cash at pickup or on delivery, or online, as part of placing
     your order. See the Payment Policy."
   - AR: «يمكن دفع قيمة الطلبات نقداً عند الاستلام أو عند التوصيل حيث يتيح التطبيق ذلك عند إتمام الطلب. ويمكن أيضاً، حيث يتيح التطبيق ذلك، دفعها إلكترونياً أثناء تقديم الطلب. انظر سياسة الدفع.»

   The Arabic is two sentences, as the proposed line is (row 5): one sentence
   ending «…، أو إلكترونياً» would bring back the reading payment_policy.review
   N6 found, «إلكترونياً» as a third way of paying cash. Its second sentence is
   the proposed line's own, and its first hedges cash as the privacy draft's
   Arabic does («…حيث يتيح التطبيق ذلك»).

   Not marked in the text, because the text is true today and matches the
   document it points to. If chosen, the post-publish check uses these lines.
3. **Publishing (decided).** As in the header. Outside this file, and not
   changed here (read 2026-11-13): `OWNER_ACTIONS.md` §47.15 (lines 4173-4188),
   `PAYMENTS.md` §7 step 11 (lines 420-426) and `GO_LIVE_READINESS.md` G5
   (line 179) name only the other documents and need `terms_conditions` added;
   `LEGAL_DOCUMENTS_AUDIT.md`'s "Verified accurate" entry for
   `terms_conditions` (lines 119-122, "VAT and cash-payment statements match
   settings") describes v2.0. The write: one row; the two `replace()` edits per
   language and the two columns; then the read-only check under "Current (live)
   text". Then the production rebuild, because no-JavaScript readers, store
   policy checkers included, see `legal.html` only after it
   (`LEGAL_DOCUMENTS_AUDIT.md` §Method rule 7). This document's public address is
   `https://app.spicymeal.com.sa/terms` (`vercel.json` sends `/terms` to
   `legal.html`; `src/legal/legalPage.ts:73`): check it there with scripts
   stripped. The store listing mentions the terms
   (`docs/store/LISTING_COPY.md:124`, `:166`).
4. **Optional additions, not in the proposed text.** None is needed for the text
   to be true; each is given with its wording so it can join the same session.
   - (a) **Name Moyasar here** (privacy_policy.review 6, store_answers.review
     B1). EN: "Orders can be paid in cash at pickup or on delivery or, where the
     app offers it, online through our payment provider, Moyasar, as part of
     placing your order. See the Payment Policy." AR: «يمكن دفع قيمة الطلبات نقداً عند الاستلام أو عند التوصيل. ويمكن أيضاً، حيث يتيح التطبيق ذلك، دفعها إلكترونياً من خلال Moyasar، مزوّد الدفع لدينا، أثناء تقديم الطلب. انظر سياسة الدفع.»
     Not recommended (Fix log, privacy_policy.review 6).
   - (b) **A refund pointer in PAYMENT**, after the new sentence. EN: "The
     Cancellation and Refund Policy explains the rules for refunds of online
     payments." AR: «وتوضح سياسة الإلغاء والاسترجاع أحكام استرداد المدفوعات الإلكترونية.»
     CANCELLING already points there.
   - (c) **A card sentence in USING THE APP PROPERLY**, after its first
     sentence. EN: "Pay only with a card you are entitled to use." AR: «ولا تدفع إلا ببطاقة يحق لك استخدامها.»
   - (d) **A sentence after OUR RESPONSIBILITY's limit.** EN: "This does not
     affect a refund due to you under the Cancellation and Refund Policy." AR: «ولا يؤثر ذلك في أي مبلغ يحق لك استرداده وفق سياسة الإلغاء والاسترجاع.»
     With prepayment, a reader can take the limit to cover money paid for an
     order we did not serve; this says it does not. It promises no refund of its
     own. Worth counsel's view.
5. **For the native reader.**
   - «يمكن دفع قيمة الطلبات» for "Orders can be paid", replacing the passive
     «تُدفع الطلبات», as the payment_policy draft does.
   - The second sentence, «ويمكن أيضاً، حيث يتيح التطبيق ذلك، دفعها إلكترونياً أثناء تقديم الطلب.»,
     is the payment_policy draft's sentence byte for byte; read the two
     documents together.
   - «أثناء تقديم الطلب» for "as part of placing your order": these terms
     already use «تقديم» for placing an order («وبتقديمك أي طلب»،
     «يُعد الطلب مقدَّماً»).
   - Two Arabic sentences against one English sentence, on purpose (row 5).
   - Line 1 keeps Arabic-Indic digits and the Gregorian month name, as v2.0
     does.
   - The alternatives in items 2 and 4 need the same read if any is chosen.
   - The brackets are for the owner and are removed before publishing.

---

## Product gaps found

None of the wording this draft adds depends on something the product does not
do: the new line says which ways of paying exist and that online payment is
conditional, and both are true of the code today and after §47.18. Four gaps
touch the new line or sentences kept beside it. None makes a sentence of this
document untrue, so none needs a bracket here; each is owned elsewhere.

- **PG-T1. A paid order that we cancel, or that a branch declines after
  payment, is not refunded automatically** (`docs/readiness/20261113-card-payments-gaps.md` PG-13; the
  refund draft's P5). Live `admin_set_order_status` lets
  staff cancel from every open status; on cancel it restores redeemed points and
  the coupon slot, and it does not touch `order_refunds` (its "refund" lines are
  about points; read 2026-11-13). The automatic refund enrols only a paid order
  that never reached the POS after the customer's resends (`OWNER_ACTIONS.md`
  §47.20). So a card-paid order cancelled at the customer's request, declined by
  a branch, or cancelled by us under these terms (clearly false details, YOUR
  ACCOUNT) is refunded only by hand in the Moyasar dashboard. USING THE APP
  PROPERLY lets us suspend or close an account, not cancel an order; what
  happens to a paid open order on such an account is said nowhere, in these
  terms or in the refund and payment drafts.
  These terms promise nothing about money in those sentences, so they stay true
  and unchanged; the promise belongs to the Cancellation and Refund Policy (its
  D1). **For that draft (re-read 2026-11-13):** two of its sentences disagree
  on which cancellations are refunded. CANCELLING AN ORDER says *"If you paid
  online, our team refunds the amount you paid … once the order is cancelled,
  as described under ONLINE PAYMENT REFUNDS below"*, which in its own words
  covers any cancellation but sits in the section about a cancellation you ask
  for; the ONLINE PAYMENT REFUNDS sentence it points to, *"Our team also
  refunds an online payment when the order is cancelled after payment, at your
  request or because the branch could not complete it, and when a refund is
  due because something was wrong with the order"*, lists reasons that do not
  include a cancellation by us under these terms. If every cancelled paid order
  is to be refunded, say "for any reason" in the second sentence; if some are
  not, that is counsel's question and both sentences would have to say so.
- **PG-T2. Online payment can be offered while it cannot complete**
  (`docs/readiness/20261113-card-payments-gaps.md` PG-18). The app offers online payment on the switch
  and the platform alone
  (`payment.ts:50-55`). The console allows the switch on only for an enabled,
  live Moyasar row, but *"THIS GATES THE CONSOLE CONTROL, NOT THE SETTING. The
  settings RPC does not consult it, so a direct call can still turn online
  payment on"* (`src/lib/onlinePaymentGate.ts:13-15`); whether the database
  should refuse is open (`OWNER_ACTIONS.md` §47.20). Nothing ties the payment
  row to the switch either: live `set_payment_settings` does not read the row,
  and neither the console's Moyasar panel nor any trigger on
  `integration_settings` or `app_settings` turns online payment off when the row
  is switched to TEST or disabled (read 2026-11-13). In that state
  `payment-initiate` refuses every checkout (`index.ts:418`, `:432`, `:495`,
  `:509` in TEST mode; `:19-23` for a missing, disabled or non-Moyasar row) and
  the app shows online payment as unavailable. It has happened: on
  the morning of 2026-11-11 online payment was on with Moyasar in TEST mode
  (`OWNER_ACTIONS.md` §47, live-state note). "Where the app offers it" stays
  literally true, but an offered option then fails at the payment step. For the
  code owners; no text change.
- **PG-T3 (the payment_policy draft's PG1; `docs/readiness/20261113-card-payments-gaps.md` PG-04).**
  After a customer closes Moyasar's page without paying, every new order, cash
  included, takes them back to that payment until the page expires (30 minutes
  live, configurable 5 to 60), and for longer while Moyasar or the proxy cannot
  be reached, because an unanswered check reads as still pending
  (`supabase/functions/_shared/moyasarVerify.ts:550-556`). The new line's "can
  be paid in cash" stays true as a description of the ways to pay; the Payment
  Policy states the hold (its PAYING ONLINE, paragraph 4). No text change here.
- **PG-T4. A cancelled order's receipt still says "Order confirmed"**
  (`docs/readiness/20261113-card-payments-reviews/cancellation_refund_policy.review.md` S5, re-checked
  2026-11-13). The receipt works out its state from the payment, POS and refund
  fields and never reads `orders.status`
  (`apps/mobile/src/features/orders/orderConfirmation.ts:51-66`, `:158`;
  `ConfirmationHero.tsx:25`), so an order that reached the branch and was then
  cancelled or declined keeps the "Order confirmed" title (`strings.ts:367`).
  The customer is still told, which keeps ORDERING's "we will tell you if it
  does" true: the "Order cancelled" push reaches devices with order updates on,
  and the Orders tab shows "Cancelled" (Left unchanged on purpose). In the app,
  a customer without notifications sees it only in the Orders tab. For a
  card-paid order the receipt shows no refund either, because a refund made by
  hand in the Moyasar dashboard is not written back to the order
  (`docs/readiness/20261113-card-payments-gaps.md` PG-14; `OWNER_ACTIONS.md` §47.18 step 4). For the
  code owners: show the cancellation on the receipt, as that review asks. No
  text change here.

**Outside this document** (for the owners of those drafts):

- **payment_policy draft, PAYING ONLINE, paragraph 3:** *"Once it is placed, you
  have a record of the order in your Orders tab, and the branch's order number
  appears in the app as soon as the branch issues it."* In these terms (ORDERING)
  and in the app's own titles, an order is placed when the app confirms it with
  the branch's number, and a paid order that never reaches the branch is "Order
  not placed" (`strings.ts:374`). That sentence uses "placed" for the earlier
  moment, when the paid order is created, so a customer whose order then fails
  would read "placed" in the policy and "Order not placed" in the app. Suggested
  for that draft, without "placed": "Once your payment is confirmed, the order
  appears in your Orders tab, and the branch's order number appears in the app
  as soon as the branch issues it." / «وبعد تأكيد دفعتك يظهر الطلب في قسم الطلبات، ويظهر رقم الطلب لدى الفرع في التطبيق فور إصداره من الفرع.»
  Its other uses ("placed only after we have checked directly with Moyasar",
  "no order is placed") agree with these terms.
- **Cancellation & Refund Policy draft:** the cancellation note under PG-T1.

---

## Claims the drafter could not verify

1. **Acceptance under prepayment.** "By placing an order you accept them", with
   an order placed only when the app confirms it, means an online payment is
   taken before that moment. Customers accept these terms earlier, at sign-in
   (`LoginScreen.tsx:83-93`). Whether that, and the checkout line, are enough for
   terms that now sit beside a payment is counsel's question, as is whether Saudi
   e-commerce or consumer-protection rules require these terms themselves to say
   more about payment or refunds.
2. **Builds in customers' hands.** The sign-in consent line was read in the
   current source only; that every installed build shows it was not checked.
3. **The merchant name on a card payment.** These terms name First Taste Trading
   Company as the operator. Which legal entity holds the Moyasar account, and
   what a customer's statement shows, are not in the repository. No
   `statement_descriptor` is configured (live read), and the setting would not
   be sent anyway: it is read (`supabase/functions/_shared/moyasar.ts:261`) but
   not put in the invoice request (`:336-354`), so the statement shows Moyasar's
   account default (`docs/readiness/20261113-card-payments-gaps.md` PG-29; payment_policy draft, Claims
   item 7).
4. **The new line has not been exercised.** No card has paid for an order yet
   (live read); the first live payment is `OWNER_ACTIONS.md` §47.18 step 3.
5. **That cash stays switched on.** The line is true while
   `cash_payment_enabled` is true (Open owner decisions, item 2). Nothing in the
   code ties that switch to this document.
6. **The Arabic.** Engineering-drafted; no native read yet.

---

## Fix log

One line per finding that bears on this document. Each was re-checked in the
default branch at `04eb351` or the live database (read-only, 2026-11-13) before it
was applied.

- **payment_policy.review B1 → fixed.** Re-checked: the live row and its PAYMENT
  line (re-read, decoded and hashed); `OWNER_ACTIONS.md` §47.15 (4173-4188),
  `PAYMENTS.md` §7 step 11 (420-426) and `GO_LIVE_READINESS.md` G5 (179) do not
  list this document; no other draft changed it before this one. Its
  suggested wording was adjusted in three places: "are paid" → "can be paid",
  the payment_policy draft's own words, so the two documents read alike (the
  suggested "are paid … or … online" is not false, only different); "online
  when you place the order" → "online, as part of placing
  your order", because under ORDERING an order is placed only after the payment
  (row 3; the payment_policy draft made the same change for its N3); and the
  Arabic is two sentences, not one with «، أو إلكترونياً» (its N6).
- **cancellation_refund_policy.review B2 → fixed (its part about this
  document).** Same re-checks, and "as part of placing your order" plus the
  two Arabic sentences added to its suggested "…or online where the app offers
  it". Its other points concern the refund draft alone (whether that draft
  names Moyasar, and a timing claim in its first header, since deleted there).
  Under the decided plan the four documents are published together, and no
  line of this draft says any document may go before the others or in one
  language first.
- **privacy_policy.review 2 (never alone, never in English first) → fixed, by
  applying its rule here.** The header states the decided plan, and nothing in
  this draft says it can be published early, alone or in English first.
- **privacy_policy.review 6 → fixed, without naming Moyasar.** Re-checked: line
  17 in both languages and §47.15's omission. Moyasar is not named because these
  terms leave payment detail to the Payment Policy, whose draft names it in
  PAYING ONLINE; v2.0's promise to name the provider is made by the Payment and
  Privacy policies, not by these terms; the payment_policy draft's HOW YOU PAY
  sentence, which this line mirrors, does not name it; and naming it here adds a
  fourth document to change if the provider changes. Not a factual
  disagreement: the wording that names it is in Open owner decisions, item 4(a).
- **store_answers.review B1 → fixed for this document.** Re-checked: no terms
  draft existed before this one; §47.15 omits the document; the listing
  mentions the terms (`docs/store/LISTING_COPY.md:124`, `:166`; the review cites
  `:126` and `:165`, a line or two off). Its wording "online in the app through
  Moyasar where that option is shown at checkout" is adjusted as on the lines
  above: Moyasar not named (privacy_policy.review 6), and "where the app offers
  it" says what "where that option is shown at checkout" says, in the Payment
  Policy's words. Its additions to C-CARD and §47.15 are outside this file (Open
  owner decisions, item 3).
- **privacy_policy.review 8, applied by analogy → owner decision.** Raised
  against the privacy draft's cash sentence; the same reasoning reaches this
  line. Re-checked: `cash_payment_enabled` live true; live `place_order`
  refuses cash when it is off; `payment.ts:53`. "Can be paid in cash" is true
  today and is kept as the payment_policy draft words it; whether the set hedges
  cash is decided once (Open owner decisions, item 2, with the wording).
- **payment_policy draft PG8, as it applies to this document → rejected;
  ORDERING kept byte-identical.** PG8 calls "An order is placed when the app
  confirms it and gives you an order number" imprecise because the app shows
  only the branch's number, once issued (`ReceiptScreen.tsx:12-14`). The
  evidence is right; the conclusion is not. The app confirms an order only once
  the branch's POS has returned its reference (`orderConfirmation.ts:66`,
  `:148`), the worker writes the reference and the branch's number together
  (`lazywait-sync/index.ts:528-545`), and an order that never reaches the
  branch is "Order not placed" (`strings.ts:374`). Live, all 71 orders that
  reached the POS carry both. One theoretical gap remains, the same for cash and
  card and so not a card-payment change: a POS reply with a reference but no
  number would show "Order confirmed" beside "Not issued yet". The inconsistency
  PG8 sensed is in the payment_policy draft's own "Once it is placed" sentence
  (Product gaps, "Outside this document").
- **cancellation_refund_policy.review S2 (cites this document's decline
  sentence) → no change needed here; the finding is about the refund draft.**
  "A branch may decline an order … and we will
  tell you if it does" promises nothing about payment, so it stays true of a
  prepaid order; the correction S2 asks for belongs to the refund draft's "you
  pay nothing". The underlying gap is PG-T1.
- **payment_policy.review N1, for the set → owner decision.** Open owner
  decisions, item 1.
- **payment_policy.review N3 and N6, applied by alignment → fixed.** Rows 3
  and 5.

Independent re-check, 2026-11-13 (read-only: the default branch at `04eb351`, the
live database and the other drafts as they stood that evening). No
`docs/readiness/20261113-card-payments-reviews/terms_conditions.review.md` exists, so the earlier findings
are the ones above, and each was re-opened against its evidence. The customer
text did not need to change; the lines below are what the re-check found
around it.

- **re-check: R1 (should-fix) → fixed in the analysis; customer text
  unchanged.** "Left unchanged on purpose" declared ORDERING's "we will tell you
  if it does" true for a prepaid order without checking how the customer is
  told. Checked: a decline is a staff cancellation in the console, which sends
  the "Order cancelled" push to devices with order updates on
  (`src/lib/api.ts:911-923`; `push-dispatch/index.ts:107-110`, `:431-435`), and
  the Orders tab shows "Cancelled" (`OrdersScreen.tsx:23`, `OrderCard.tsx:22`).
  The sentence holds. The receipt never reads `orders.status`
  (`orderConfirmation.ts:51-66`, `:158`) and keeps "Order confirmed": added as
  PG-T4, and the bullet now says how the customer is told.
- **re-check: R2 (should-fix) → fixed.** PG-T1's note to the refund draft
  quoted one of the two refund-draft sentences that decide which cancellations
  are refunded. Re-read that draft (written 22:17): CANCELLING AN ORDER says
  "our team refunds … once the order is cancelled", in the section about a
  cancellation the customer asks for, while ONLINE PAYMENT REFUNDS lists
  reasons that leave out a cancellation by us. The note now names both. It also
  listed USING THE APP PROPERLY as a ground for cancelling an order; that
  section (live line 29) lets us suspend or close an account, not cancel an
  order, and the note now says so.
- **re-check: R3 (should-fix) → fixed.** Open owner decisions, item 2's Arabic
  alternative was one sentence ending «…، أو إلكترونياً», the reading row 5 and
  payment_policy.review N6 rule out. It is now two sentences: the second is the
  proposed line's own, the first hedges cash as the privacy draft's Arabic does
  («…حيث يتيح التطبيق ذلك», `docs/legal/PRIVACY_POLICY_CARD_PAYMENTS_DRAFT.md`, its Arabic PAYMENT
  paragraph). It needs the native read with the rest (item 5).
- **re-check: R4 (nit) → fixed.** Row 6 placed "the card types" in the
  payment_policy draft's PAYING ONLINE; they are in its HOW YOU PAY ("Online
  payment accepts mada, Visa and Mastercard cards.").
- **re-check: R5 (nit) → fixed.** The post-publish query returned two
  unlabelled rows and showed neither line 1 nor the two columns, so it did not
  run rule 6's "both places" check. It now returns `lang`, `version`,
  `effective_date` and `line_1`. Run read-only against the live row with the
  v2.0 lines: the same four hashes, `occurrences` 1 in both languages,
  `version` 2.0, `effective_date` 2026-08-18, and line 1 as quoted above.
- **re-check: R6 (nit) → fixed.** The version bracket read "2.1 or 3.0, decided
  once for all four documents", which cannot hold for `privacy_policy` (live
  2.3; its draft proposes 2.4). It now says minor or major is decided once, as
  item 1 already did.
- **re-check: R7 (nit) → fixed.** The B2 line above quoted, word for word, the
  refund draft's old header line about publishing early. Reworded, so no line
  of this file says a document may be published early, alone or in English
  first. The refund draft has deleted that line (its Fix log, B2).
- **re-check: "where the app offers it" after "on delivery" (considered) → no
  change.** In the English line, "it" follows "on delivery", so a reader could
  try "delivery" as its antecedent. Only "paying online" makes the sentence
  read, and the payment_policy draft's HOW YOU PAY uses the same construction,
  so rewording it here alone would break the "same words" alignment (row 4).
  The Arabic has no such reading: the online clause is its own sentence.
- **re-check: cancellation_refund_policy.review S1 → no change here.** The app
  rarely shows when preparation starts, because only `admin_set_order_status`
  moves `orders.status` (live; `is_admin()`). ORDERING's "It is accepted when
  the branch begins preparing it" defines acceptance by an event, not by the
  app's label, and nothing in these terms turns on that label. The window it
  affects is the refund draft's (its D13).
- **re-check: store_answers.review S5 → no change here.** Re-checked live:
  `place_customer_order` checks `phone_verified`, `order_limit_open` (live 5)
  and `order_limit_per_hour` (live 10); `begin_checkout_session`,
  `finalize_checkout_session` and `insert_order_from_snapshot` check none of
  them. A customer at a limit is refused the order, and these terms say nothing
  about limits, so "can be paid in cash" stays true as a description of the
  ways to pay. For the code owners, with that review.
- **re-check: the whole proposed text, both languages → verified, no
  change.** The live row was re-read: version 2.0, effective 2026-08-18, the
  only `terms_conditions` row, md5 EN `0da664333b24808294b771f436272c02` (2 584
  characters) and AR `bcd2dc7af623a2b28b031e1a861d04c9` (2 147), 45 lines
  each. Applying the four `replace()` edits to it gives the two whole-document
  blocks exactly, with only lines 1 and 17 different. The span hashes, the new
  lines' lengths (143, 145) and md5s reproduce. The Arabic second sentence and
  «يمكن دفع قيمة الطلبات» occur in the payment_policy draft. Neither new line
  carries an unexpected character, and «نقداً» keeps v2.0's code points. Every
  path cited in rows 1-7, "Left unchanged on purpose", PG-T1 to PG-T3 and
  Claims was re-opened and is accurate. So is the live context: both switches,
  the payment row, the one 0.00 online order with no payment record, 71 of 71
  POS orders with reference and number, and 23 of 23 since 2026-08-28. The
  unchanged sentences were read against the code too: sign-in is WhatsApp OTP
  only (live: WhatsApp login on, SMS fallback off, SMS provider a disabled
  sandbox), VAT is 15 and the currency SAR, and the contact email and phone
  match `app_settings`.
