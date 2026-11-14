# Cancellation & Refund Policy: refunds of online card payments (draft)

> **Status: DRAFT, engineering-written 2026-11-13, revised the same day after
> the fact-check in `docs/readiness/20261113-card-payments-reviews/cancellation_refund_policy.review.md`, then
> re-checked and corrected again the same day by an independent pass against
> the code, the live rows and the sibling drafts (the "re-check:" lines in the
> Fix log). Every finding is answered in the "Fix log" at the end. Not reviewed
> by counsel. Not published.** Editing a live `legal_documents` row is a CLAUDE.md §5 action,
> and so is turning online payment on. This file holds the exact text and the
> evidence behind it, so publishing can be a copy-paste.
>
> **The Arabic needs a native read** before it is published. It is
> engineering-drafted Modern Standard Arabic, written to match the register of
> the live Arabic document (same queue as `OWNER_ACTIONS.md` §35).
>
> **Scope.** What card payment requires, plus two v2.0 sentences the fact-check
> found untrue of the code today: the first line of `CANCELLING AN ORDER`
> (finding S1: the app's "Received" status does not mean the branch has not
> started preparing) and the first line of `IF WE CANNOT FULFIL YOUR ORDER`
> (finding S2: "you pay nothing" is not true of an order already paid by card).
> Every other v2.0 sentence stays byte-for-byte as it is.
>
> **Remove every `[OWNER DECISION …]` marker, and fill every placeholder
> (`[DAY MONTH YEAR]`, `[N]`), before publishing.** Each marker names a decision
> in "Open owner decisions" below. The text around each marker is true to the
> code today; a marker shows where the wording must change if the owner decides
> differently or the product changes first. The product gaps behind the markers
> are listed under "Product gaps found".
>
> **Publishing plan (proposed; the owner decides).** `privacy_policy`, `payment_policy`, this policy
> and `terms_conditions` are published **together, in both languages, in one
> owner-approved session, before online payment is switched on**
> (`OWNER_ACTIONS.md` §47.18). None of them goes live on its own, and neither
> language goes first. The store answers and the listing copy change in the
> same window (§47.15). Published alone, this policy would contradict three live
> documents (fact-check B2): `payment_policy` v2.0 says *"We have not yet
> selected an online payment provider"*; `privacy_policy` v2.3 says *"Online
> card payment is not available"* and does not list Moyasar among the providers
> it shares data with; and `terms_conditions` v2.0 says *"Orders are paid in
> cash at pickup or on delivery."* `terms_conditions` was added to §47.15's
> list on 2026-11-13; its new PAYMENT line is drafted in `docs/legal/TERMS_CONDITIONS_CARD_PAYMENTS_DRAFT.md` (see
> "Also for the owner").
>
> v2.0 promises: *"If we add it, this policy will be updated to explain how a
> card refund is returned and how long it takes, before the option appears."*
> Publishing in that session, before §47.18, keeps the promise. Every new
> sentence is conditional ("If you paid online …"), so the text stays true in
> the interval between publishing and switch-on.
>
> **Preconditions.** Before the publishing session: Moyasar's written
> confirmation that SADAD and STC Pay are off for invoices (§47.19; fact-check
> S10). Our invoice request does not restrict payment methods
> (`supabase/functions/_shared/moyasar.ts:336-353`), so the hosted page offers
> whatever Moyasar's dashboard enables, and a SADAD payment cannot be refunded
> (`PAYMENTS.md:635-637`); the destination sentence would be false for it.
> Before online payment is switched on: D7's conditions (1) to (3) (LIVE
> "Connection OK" through the proxy, the refund job active, the payment row
> enabled). Switching online payment on without them makes the automatic-refund
> sentence false. Right after switch-on, D7's condition (4): one automatic refund
> seen end to end at `OWNER_ACTIONS.md` §47.18 step 4, or Online Payment off and
> D7's fallback wording published.
>
> **Version: 2.0 → 3.0 proposed**, to be decided once for all four documents
> published together (D6; reasoning under "What changed and why").
>
> Live state read for this draft (read-only SQL, re-read 2026-11-13 for this
> revision, and again, unchanged, by the re-check): `legal_documents` holds exactly **one**
> `cancellation_refund_policy` row, version `2.0`, effective `2026-08-18`,
> active, 1 533 EN / 1 219 AR characters (md5 `5a67d9d5…` / `91607002…`).
> `app_settings.online_payment_enabled = false`; the payment row is provider
> `moyasar`, enabled, mode `test`; cron job `payment-refund-worker`
> `active = false`; `order_refunds` holds 0 rows.

---

## Current (live) text

Only the parts this draft changes are quoted, exactly as stored. Every other
line of v2.0 is unchanged and is listed under "Left unchanged on purpose".

### English (v2.0, effective 2026-08-18)

First line:

```
Effective date: 18 August 2026
```

`CANCELLING AN ORDER` (line 1 changed, fact-check S1; line 2 kept; one line
added after them):

```
CANCELLING AN ORDER
You can ask to cancel while your order is still Received, before the branch starts preparing it. Contact us with your order number as soon as you decide.
Once preparation has started the food is already being made, and cancellation is normally not possible.
```

`IF WE CANNOT FULFIL YOUR ORDER` (the line changed, fact-check S2; one line
added after it):

```
IF WE CANNOT FULFIL YOUR ORDER
If a branch cannot accept or complete your order — it is closed, an item is unavailable, or your address is outside the delivery area — we will tell you, and you pay nothing.
```

`REFUNDS` (line 1 changed, line 2 kept, line 3 removed):

```
REFUNDS
Orders are paid in cash at pickup or on delivery, so there is nothing to refund on an order you never received and never paid for.
If you have already paid in cash and something is wrong with the order, contact us with your order number. Where a refund is due, it is settled in cash at the branch that prepared the order.
Online card payment is not available in the app. If we add it, this policy will be updated to explain how a card refund is returned and how long it takes, before the option appears.
```

`UNCOLLECTED PICKUP ORDERS` (the line kept; one optional line added, decision D5):

```
UNCOLLECTED PICKUP ORDERS
A pickup order that is not collected by the end of the branch's working day may be discarded for food safety reasons, and is not refundable.
```

### Arabic (v2.0, effective 2026-08-18)

```
تاريخ السريان: ١٨ أغسطس ٢٠٢٦
```

```
إلغاء الطلب
يمكنك طلب الإلغاء ما دام طلبك في حالة "تم الاستلام" وقبل أن يبدأ الفرع بتحضيره. تواصل معنا مع ذكر رقم الطلب فور اتخاذك القرار.
وبعد بدء التحضير يكون الطعام قيد الإعداد فعلياً، ولا يكون الإلغاء ممكناً في العادة.
```

```
إذا لم نتمكن من تنفيذ طلبك
إذا لم يستطع الفرع قبول طلبك أو إتمامه، لكونه مغلقاً أو لعدم توفر صنف أو لوقوع عنوانك خارج نطاق التوصيل، فسنخبرك، ولن تدفع شيئاً.
```

```
الاسترجاع
تُدفع الطلبات نقداً عند الاستلام أو عند التوصيل، وبالتالي لا يوجد مبلغ يُسترد عن طلب لم تستلمه ولم تدفع قيمته.
وإذا كنت قد دفعت نقداً وكان في الطلب خلل، تواصل معنا مع ذكر رقم الطلب. وعند استحقاق الاسترداد تتم التسوية نقداً في الفرع الذي حضّر الطلب.
والدفع الإلكتروني بالبطاقة غير متاح في التطبيق. وإذا أضفناه، فستُحدَّث هذه السياسة لتوضيح كيفية إعادة المبلغ إلى البطاقة والمدة اللازمة لذلك، قبل ظهور الخيار.
```

```
طلبات الاستلام غير المستلمة
قد يُتلَف طلب الاستلام الذي لم تستلمه حتى نهاية يوم عمل الفرع لأسباب تتعلق بسلامة الغذاء، ولا يكون قابلاً للاسترداد.
```

### Left unchanged on purpose

- `IF SOMETHING IS WRONG WITH YOUR ORDER` / «إذا كان في طلبك خلل»: its promise
  ("replace the item, correct the order, or refund it") holds for any payment
  method. How a card refund is returned is now said once, in the new section.
- `HOW TO REACH US` / «للتواصل معنا»: unchanged. Its *"Please always include
  your order number."* stays; the new section tells a customer whose order shows
  no number what to give instead (fact-check S3).
- The two cash sentences of `REFUNDS` (*"If you have already paid in cash … at
  the branch that prepared the order."*) and the second cancellation-window
  sentence (*"Once preparation has started …"*).

---

## Proposed text

Changed sections only, in document order, ready to paste. A section not listed
here is not touched. The new section `ONLINE PAYMENT REFUNDS` goes directly
after `REFUNDS` and before `IF SOMETHING IS WRONG WITH YOUR ORDER`. Lines are
separated by a single newline and sections by a blank line, as in v2.0. Below,
"line n" of a section means its n-th line after the heading.

### English

```
Effective date: [DAY MONTH YEAR] [OWNER DECISION D6: the publication date, also written to effective_date]
```

```
CANCELLING AN ORDER
You can ask to cancel before the branch starts preparing your order. Contact us as soon as you decide, with your order number if the app shows one, and we will check with the branch whether preparation has started. [OWNER DECISION D13: keep this wording; restore the Received wording only once the app's status shows when preparation starts]
Once preparation has started the food is already being made, and cancellation is normally not possible.
If you paid online, our team refunds the amount you paid to the card or payment method you used once the order is cancelled, as described under ONLINE PAYMENT REFUNDS below. [OWNER DECISION D1: automatic or on request] [OWNER DECISION D3: how soon our team issues a refund] [OWNER DECISION D4: card only, or cash at the branch]
```

```
IF WE CANNOT FULFIL YOUR ORDER
If a branch cannot accept or complete your order — it is closed, an item is unavailable, or your address is outside the delivery area — we will tell you. If you have not paid yet, you pay nothing.
If you had already paid online and the branch cannot accept or complete your order for a reason on its side, the amount you paid is refunded to the card or payment method you used, as described under ONLINE PAYMENT REFUNDS below. [OWNER DECISION D4: card only, or cash at the branch]
```

```
REFUNDS
If you pay in cash at pickup or on delivery, there is nothing to refund on an order you never received and never paid for.
If you have already paid in cash and something is wrong with the order, contact us with your order number. Where a refund is due, it is settled in cash at the branch that prepared the order.
```

```
ONLINE PAYMENT REFUNDS
A refund of an online payment goes back to the card or payment method you paid with, through our payment provider, Moyasar. [OWNER DECISION D4: card only, or may a refund also be settled in cash at the branch]
If your order could not be sent to the branch, the app lets you try sending it again, and our team may also contact you. If it still cannot be sent and the app no longer offers to send it again, the full amount you paid is refunded automatically, and you can follow the refund on your order in the app. [OWNER DECISION D7: switch online payment on only once the refund job runs; fallback wording in D7]
If the refund status on your order has not changed to Refunded [N] days after it first appears, contact us and our team will complete the refund. [OWNER DECISION D8: N, and whether staff are shown and alerted to failed or stuck refunds]
Points you spent on an order that the app shows as "Order not placed" are not returned automatically, even if the amount you paid is refunded automatically. Contact us and our team will return them. [OWNER DECISION D9: return the points automatically]
If you would rather not try again, contact us and our team will cancel the order and refund the amount you paid. [OWNER DECISION D1: automatic or on request] [OWNER DECISION D3: how soon our team issues a refund] [OWNER DECISION D11: refund automatically when the customer never resends] Once you have asked us to cancel it, do not resend it. [OWNER DECISION D12: drop this sentence once a cancelled order can no longer be resent]
If the app shows that we are checking with the branch whether your order went through, the order is not refunded automatically, because the branch may already have it. If the branch did not receive it, our team refunds the amount you paid. [OWNER DECISION D1: automatic or on request] [OWNER DECISION D3: how soon our team issues a refund]
If the app shows no order number for your order, tell us the date, time and amount shown for it in your Orders tab, and the mobile number on your account.
Our team also refunds an online payment when a refund is due because something was wrong with the order, and when the order is cancelled after payment, whether at your request, because the branch could not accept or complete it for a reason on its side, or because we cancel it under our Terms and Conditions. [OWNER DECISION D1: automatic or on request] [OWNER DECISION D3: how soon our team issues a refund] [OWNER DECISION D14: refund an order we cancel under the Terms and Conditions]
If a delivery order you paid for online is returned to the branch because the driver could not reach you or your address, contact us and we will tell you whether any of the amount you paid can be refunded. [OWNER DECISION D10: the rule for a prepaid delivery order returned to the branch]
We may not notice some payments unless you tell us: a second payment taken for an order that was already paid, or an amount deducted from your card when the app could not confirm your payment. Contact us with your order number or, if you have none, the date, time and amount of the payment. Once we have confirmed with Moyasar that the payment was taken and was not used for any order, we will refund it. Never send us your full card number. [OWNER DECISION D2: automatic refund of a duplicate payment] [OWNER DECISION D3: how soon our team issues a refund]
Once a refund has been issued, it usually takes about 1 to 3 working days to reach a mada card and about 7 to 14 working days to reach a credit card. The exact time depends on your bank.
```

```
UNCOLLECTED PICKUP ORDERS
A pickup order that is not collected by the end of the branch's working day may be discarded for food safety reasons, and is not refundable.
This applies to orders paid online too. [OWNER DECISION D5: keep this sentence, or refund uncollected prepaid orders]
```

### Arabic (needs a native read)

```
تاريخ السريان: [اليوم الشهر السنة، بالأرقام العربية كما في النسخة الحالية] [OWNER DECISION D6]
```

```
إلغاء الطلب
يمكنك طلب الإلغاء قبل أن يبدأ الفرع بتحضير طلبك. تواصل معنا فور اتخاذك القرار، مع ذكر رقم الطلب إن ظهر لك في التطبيق، وسنتحقق مع الفرع مما إذا كان التحضير قد بدأ. [OWNER DECISION D13]
وبعد بدء التحضير يكون الطعام قيد الإعداد فعلياً، ولا يكون الإلغاء ممكناً في العادة.
وإذا كنت قد دفعت إلكترونياً، يرد فريقنا المبلغ الذي دفعته إلى البطاقة أو وسيلة الدفع التي استخدمتها بعد إلغاء الطلب، كما هو موضح أدناه في قسم استرداد المدفوعات الإلكترونية. [OWNER DECISION D1] [OWNER DECISION D3] [OWNER DECISION D4]
```

```
إذا لم نتمكن من تنفيذ طلبك
إذا لم يستطع الفرع قبول طلبك أو إتمامه، لكونه مغلقاً أو لعدم توفر صنف أو لوقوع عنوانك خارج نطاق التوصيل، فسنخبرك، ولن تدفع شيئاً إن لم تكن قد دفعت بعد.
وإذا كنت قد دفعت إلكترونياً ولم يستطع الفرع قبول طلبك أو إتمامه لسبب يعود إليه، فسيُعاد المبلغ الذي دفعته إلى البطاقة أو وسيلة الدفع التي استخدمتها، كما هو موضح أدناه في قسم استرداد المدفوعات الإلكترونية. [OWNER DECISION D4]
```

```
الاسترجاع
إذا كنت تدفع نقداً عند الاستلام أو عند التوصيل، فلا يوجد مبلغ يُسترد عن طلب لم تستلمه ولم تدفع قيمته.
وإذا كنت قد دفعت نقداً وكان في الطلب خلل، تواصل معنا مع ذكر رقم الطلب. وعند استحقاق الاسترداد تتم التسوية نقداً في الفرع الذي حضّر الطلب.
```

```
استرداد المدفوعات الإلكترونية
يُعاد المبلغ المسترد من الدفعة الإلكترونية إلى البطاقة أو وسيلة الدفع التي دفعت بها، عن طريق Moyasar، مزوّد الدفع لدينا. [OWNER DECISION D4]
وإذا تعذّر إرسال طلبك إلى الفرع، يتيح لك التطبيق إعادة إرساله، وقد يتواصل معك فريقنا أيضاً. فإن ظل إرساله متعذراً ولم يعد التطبيق يعرض عليك إعادة الإرسال، يُسترد المبلغ الذي دفعته كاملاً تلقائياً، ويمكنك متابعة حالة الاسترداد في صفحة الطلب في التطبيق. [OWNER DECISION D7]
وإذا لم تتحول حالة الاسترداد في طلبك إلى "تم الاسترداد" بعد [N] أيام من ظهورها، فتواصل معنا وسيتولى فريقنا إتمام الاسترداد. [OWNER DECISION D8]
ولا تُعاد تلقائياً النقاط التي استخدمتها في طلب يظهر في التطبيق بعبارة "لم يتم إنشاء الطلب"، حتى لو استُرد المبلغ الذي دفعته تلقائياً. تواصل معنا وسيعيدها فريقنا إليك. [OWNER DECISION D9]
وإن لم ترغب في إعادة المحاولة، تواصل معنا وسيلغي فريقنا الطلب ويرد المبلغ الذي دفعته. [OWNER DECISION D1] [OWNER DECISION D3] [OWNER DECISION D11] وبعد أن تطلب منا إلغاءه، لا تُعد إرساله. [OWNER DECISION D12]
وإذا أظهر التطبيق أننا نتحقق مع الفرع مما إذا كان طلبك قد وصل، فلا يُسترد المبلغ تلقائياً، لأن الطلب قد يكون وصل إلى الفرع. فإن تبيّن أنه لم يصل، يرد فريقنا المبلغ الذي دفعته. [OWNER DECISION D1] [OWNER DECISION D3]
وإذا لم يظهر رقم لطلبك في التطبيق، فأخبرنا بتاريخ الطلب ووقته ومبلغه كما تظهر في قسم الطلبات، وبرقم الجوال المسجّل في حسابك.
ويرد فريقنا أيضاً قيمة الدفعة الإلكترونية إذا استحق الاسترداد بسبب خلل في الطلب، وكذلك إذا أُلغي الطلب بعد الدفع، سواء بناءً على طلبك أو لتعذّر قبوله أو إتمامه في الفرع لسبب يعود إليه أو لإلغائنا إياه بموجب الشروط والأحكام. [OWNER DECISION D1] [OWNER DECISION D3] [OWNER DECISION D14]
وإذا أُعيد إلى الفرع طلب توصيل دفعت قيمته إلكترونياً لتعذّر وصول السائق إليك أو إلى عنوانك، فتواصل معنا وسنخبرك بما إذا كان يمكن استرداد أي جزء من المبلغ الذي دفعته. [OWNER DECISION D10]
وقد لا ننتبه إلى بعض الدفعات ما لم تخبرنا بها: دفعة ثانية خُصمت عن طلب سبق دفع قيمته، أو مبلغ خُصم من بطاقتك ولم يتمكن التطبيق من تأكيد الدفع. تواصل معنا مع ذكر رقم الطلب، أو تاريخ الدفعة ووقتها ومبلغها إن لم يكن لديك رقم طلب. وبعد أن نتحقق لدى Moyasar من أن الدفعة خُصمت ولم تُستخدم في أي طلب، نرد إليك المبلغ. ولا ترسل إلينا رقم بطاقتك كاملاً أبداً. [OWNER DECISION D2] [OWNER DECISION D3]
وبعد إصدار الاسترداد، يستغرق وصول المبلغ عادةً نحو ١ إلى ٣ أيام عمل إلى بطاقة مدى، ونحو ٧ إلى ١٤ يوم عمل إلى البطاقة الائتمانية، وتختلف المدة الفعلية بحسب البنك.
```

```
طلبات الاستلام غير المستلمة
قد يُتلَف طلب الاستلام الذي لم تستلمه حتى نهاية يوم عمل الفرع لأسباب تتعلق بسلامة الغذاء، ولا يكون قابلاً للاسترداد.
ويسري ذلك أيضاً على الطلبات المدفوعة إلكترونياً. [OWNER DECISION D5]
```

Arabic notes for the native reader: "Moyasar" is kept in Latin script, as in the
app's payment-screen footer (`PAYMENTS.md` §13) and the privacy-policy draft;
"مدى" for mada; durations in Arabic-Indic digits, as the live date line uses;
the phone number stays in Latin digits, as in v2.0. The in-app status
«"تم الاسترداد"» is in ASCII double quotes, as v2.0 quotes «"تم الاستلام"», and
is the app's own label (`strings.ts:728`); so is «"لم يتم إنشاء الطلب"»
(`strings.ts:718`; English "Order not placed", `:374`), which is quoted in both
languages because it is a phrase; the section reference
«قسم استرداد المدفوعات الإلكترونية» is unquoted on purpose. «أيام عمل» renders
Moyasar's "business days". When `[N]` is filled in, make the counted noun agree
(١ ← «بعد يوم واحد»، ٢ ← «بعد يومين»، ٣ إلى ١٠ ← «أيام»، ١١ فما فوق ← «يوماً»).
«بموجب الشروط والأحكام» uses the live Arabic title of the Terms and Conditions;
the list «سواء بناءً على طلبك أو … أو …», «لسبب يعود إليه» (for "for a reason
on its side", the branch's) and «يظهر في التطبيق بعبارة» were added by the
re-check and need the same read.

---

## What changed and why

Each change is tied to the code on the default branch export
(the default branch at `04eb351`) or to a live read-only query, not to working notes.

| # | Change | Code fact it rests on |
| --- | --- | --- |
| 1 | **Removed** *"Online card payment is not available in the app. If we add it …"* (EN and AR). | Moyasar is now the only provider in the code: `supabase/functions/payment-initiate/index.ts:19-23`. The removed sentence promised to explain *how a card refund is returned and how long it takes*; the new section does both (destination and timing, rows 5 and 10). |
| 2 | **REFUNDS line 1** changed from *"Orders are paid in cash …"* to *"If you pay in cash …"*. The rest of the sentence and the next sentence (the cash-at-branch rule) are unchanged. | A card order is created already paid, after the payment: `docs/ORDER_CONFIRMATION_FLOW.md:1277-1282`; `finalize_checkout_session`. So "orders are paid in cash" stops being true of every order; the cash rule itself is unchanged. |
| 3 | **IF WE CANNOT FULFIL**: v2.0's *"we will tell you, and you pay nothing"* becomes *"we will tell you. If you have not paid yet, you pay nothing."* (fact-check S2); one sentence added for an order already paid online. | The branch-closed, item-unavailable and outside-the-area refusals happen **before** payment, inside `compute_order_snapshot` (`supabase/migrations/20260924120000_place_order_variant_availability.sql:725-760`, items `:771-851`). But "closed" means `branches.is_active` only, working hours are *"ADVISORY ONLY. NOTHING enforces these"* (`20260820120000_branch_delivery_control.sql:96`), availability is **not** re-checked after payment (`ORDER_CONFIRMATION_FLOW.md:1665-1671`), and live `terms_conditions` v2.0 says *"A branch may decline an order — for example outside its working hours"*. So a paid order can be declined after payment, and "you pay nothing" is true only of an order not yet paid. The added sentence covers the paid one. |
| 4 | **CANCELLING**: line 1 no longer ties the cancellation window to the "Received" status (fact-check S1); one sentence added, saying **our team** refunds a cancelled paid order. No automation promised. | **Line 1:** `orders.status` changes only through `admin_set_order_status`, which requires `is_admin()` (`supabase/migrations/20260918120000_loyalty_earn_on_settlement.sql:641-650`; live: no other function sets it); the POS webhook writes only `lazywait_status` (`supabase/functions/lazywait-webhook/index.ts:15-17`). Live, orders created in the last 90 days (read 2026-11-13): 50 `received`/`synced`, 3 `received`/`blocked`, 1 `delivered`. So 53 of 54 never left "Received", which is the label the Orders tab shows (`apps/mobile/src/features/orders/OrdersScreen.tsx:23`; `strings.ts:346`, AR `:693`). **Line 3:** customers cannot cancel in the app: no customer-callable cancel exists (`docs/LEGAL_DOCUMENTS_AUDIT.md:108-112`). Only `admin_set_order_status` cancels, and its cancel branch (`:657-732`) reverses loyalty points and the coupon slot only. It writes no refund and no `order_refunds` row, and the enrolment predicate cannot match a cancelled order (row 6). `OWNER_ACTIONS.md` §47.20 and `PAYMENTS.md:330-337` say the same: refund it by hand in the Moyasar dashboard. |
| 5 | **New section: destination.** A refund of an online payment goes back to the card or payment method, through Moyasar. | The worker refunds the Moyasar **payment** id, which is the payment the customer made: `supabase/functions/payment-refund/index.ts:111-119`, `supabase/functions/_shared/moyasarRefund.ts:68-69` (`POST /v1/payments/{id}/refund`). Moyasar's FAQ calls it refunding "the customer's card" (see "Claims the drafter could not verify", item 2). |
| 6 | **New section: the one automatic case, with its precondition.** Refunded automatically only once the app no longer offers to resend. Added: *"and our team may also contact you"* (fact-check N4). | `order_refund_due()` (`supabase/migrations/20260724120000_order_confirmation_state_machine.sql:462-485`) needs paid, total above 0, no POS reference, no send marker, state `dead_letter`/`blocked`, **and** the customer resend budget spent (`customer_pos_resend_limit()` = 3, `:93-94`). Enrolment triggers `:494-513`; the ledger row refunds the paid payment's own amount (`supabase/migrations/20261003120000_moyasar_only_payments.sql:559-572`; the live `open_order_refund_record` takes the same amount), hence "the full amount you paid". The app offers resend while the budget lasts and then shows the refund state (`supabase/migrations/20260828090000_customer_order_state_inflight.sql:121-135`; `apps/mobile/src/features/orders/orderConfirmation.ts:150-154`). The policy does **not** say "three": the budget is deliberately not disclosed to clients (`ORDER_CONFIRMATION_FLOW.md:1203-1206`). **N4:** the live `pos_failed` push tells the customer *"Our team will follow up."* / «فريقنا سيتابع الحالة.» (`supabase/functions/push-dispatch/index.ts:179-188`); "may" keeps the policy consistent with it without promising a contact. |
| 7 | **New section: "follow the refund on your order"**, and, in place of the first draft's *"If an automatic refund cannot be completed, our team completes it and contacts you"*, a step the customer triggers: contact us if the refund status has not changed to Refunded `[N]` days after it appears (fact-check B1). | The order screen shows a refund status whenever `refund_state` is not `none` (`apps/mobile/src/features/orders/view/ConfirmationHero.tsx:65`), labelled "Refund pending", "Refunded" or, for a failed refund, "Refund in progress" (`strings.ts:383-385`, AR `:727-729`); "Refunded" only on a Moyasar-confirmed success (`ORDER_CONFIRMATION_FLOW.md:1257-1260`). **Nothing makes staff finish a refund that sticks or fails:** a 401 from Allowed IPs and a network or proxy failure (status 0) are both classed `pending` (`moyasarRefund.ts:101-110`, `:119-121`; `payment-refund/index.ts:247-251`), with no attempt cap, and never reach `list_failed_order_refunds()` (`PAYMENTS.md:377-385`); nothing in the console calls `list_failed_order_refunds()` or renders `refund_state` (in `src/`, `refund_state` appears only in the customer column list, `src/lib/api.ts:798`); no watchdog or health rule reads `order_refunds`, and `REFUND_STUCK` is not implemented (`ORDER_INTEGRITY_WATCHDOG.md:186-189`). So the policy promises only what the customer can set off. A healthy automatic refund reads Refunded within minutes (the job runs every 5 minutes, `PAYMENTS.md:341`), so a short `[N]` costs little. |
| 8 | **New section: the "checking with the branch" case** is not refunded automatically. *"while we check"* removed (fact-check N1). | An ambiguous POS outcome never matches `order_refund_due` (`ORDER_CONFIRMATION_FLOW.md:1225-1227`; state `verifying_with_branch`, `20260828090000_customer_order_state_inflight.sql:101-115`). Nothing later changes that: the verification feed offers *"NO resend, resolve, refund or cancel"* (`src/components/admin/view/orders/OrdersRequiringVerificationCard.tsx:6`), so "while we check" implied an automatic refund afterwards that never comes. The app already says *"We are checking with the branch whether your order went through. Our team is on it"* (`strings.ts:370`, AR `:714`). |
| 9 | **New section: cases refunded by our team**, and payments we may not notice unless the customer tells us. Wording changed from *"only come to our attention"* (fact-check S4). | Cancellation and complaint refunds: row 4, no automation. Duplicate payment: recorded as a `failed` row, *"Refund this payment."*, never refunded automatically (`supabase/functions/_shared/moyasar.ts:962-975`, `supabase/functions/_shared/moyasarVerify.ts:248-262`). `finalize_failed` and `verification_mismatch` also write sync-log rows (`moyasarVerify.ts:378-387`, `:490-506`). So the system **records** these payments, but **nothing alerts on them** and the console has no list (`PAYMENTS.md:594-601`): "we may not notice" is true, "only come to our attention" was not. An amount deducted without a confirmed order: the app says *"Please contact support if an amount was deducted."* (`strings.ts:204`, AR `:567`; `moyasar.ts:504-509`), and no refund path exists for a payment with no order (the ledger needs an order row: `20261003120000…:559-575`). |
| 10 | **New section: timing.** About 1 to 3 **working** days for mada, about 7 to 14 **working** days for a credit card, "depends on your bank". | Moyasar's FAQ (`moyasar.com/en/resources/faqs`, read 2026-11-13): *"Mada cards: 24 hours to 3 business days. Credit cards: 7 to 14 business days. Weekends not included."* The repository's "days" (`Moyasar_API_Reference.md` §3.2; `OWNER_ACTIONS.md` §47.18) understated it until both were corrected on 2026-11-13. "Credit card" is kept because it is Moyasar's own category (fact-check N3, partly rejected: see the Fix log). |
| 11 | **New section: "Never send us your full card number."** | The full card number is entered only on Moyasar's hosted page (`PAYMENTS.md:73-75`). Our servers receive and store only the card brand and the last four digits (`moyasarVerify.ts:332-333`, `:375-376`). The first draft said card data "never reaches our servers"; that was wrong (fact-check N5). The new section asks customers to contact us about payments, which invites them to quote card details; this keeps the full number out of email. |
| 12 | **UNCOLLECTED PICKUP**: one optional sentence (D5). | Under v2.0 every pickup order was paid in cash at pickup, so "not refundable" never cost an uncollected customer money. With prepaid card orders it does. The text already covers card orders; the sentence makes that visible, and the decision is the owner's. |
| 13 | **Effective date** in the first line, both languages, and in the `effective_date` column. | `LEGAL_DOCUMENTS_AUDIT.md:150-157`: the date lives in two places and must move in both. |
| 14 | **New: points spent on an order the app shows as "Order not placed"** (fact-check S8; widened by the re-check from "an order that is refunded automatically"). | **Re-check:** the first wording missed a paid order with a total of 0.00. A checkout fully covered by points, or by the comped-customer discount, is settled at once as method `online`, status `paid` (live `begin_checkout_session`: *"Zero-total (fully covered): nothing to charge — settle immediately"*, then `insert_order_from_snapshot(…, 'online', 'paid', …)`; the app goes straight to the receipt, `CheckoutScreen.tsx:776-781`). If such an order cannot be sent, the app still shows "Order not placed" with *"Your payment will be refunded automatically."* (live `customer_order_state` step 10 and `orderConfirmation.ts:104-108` test only `paid` and the resend count; `strings.ts:374-375`), but live `order_refund_due` requires `coalesce(p_total, 0) > 0`, so no refund opens, no refund status appears (`ConfirmationHero.tsx:65`) and the points stay spent. Live, one such order exists (2026-11-11, 0.00, a comped customer; it reached the POS). "Order not placed" (`strings.ts:374`, AR `:718`) is the title of every final-failure state, paid or not (`orderConfirmation.ts:152-155`), so the sentence now covers card, 0.00 and cash orders alike, and it stays true while the refund job is off (D7). Product gap REF-10. **First revision's evidence, still true:** nothing on the refund path touches loyalty or sets `status = 'cancelled'`: live `open_order_refund_record`, `set_order_refund_enrollment` and `finalize_order_refund` (read 2026-11-13; the only functions that mention both refunds and loyalty are `admin_set_order_status`, the order-creation wrapper `place_customer_order` and the two admin order lists), and `payment-refund/index.ts`. Only an admin cancellation restores redeemed points (`20260918120000…:657-723`). Live `offers_loyalty_terms` v2.2 says *"IF YOUR ORDER IS CANCELLED … any points you spent on it are returned to you in full"*, and the app calls an automatically refunded order *"Order not placed"* (`strings.ts:374`). Points can be spent on an online pickup order (`PAYMENTS.md:126-130`). Staff can return them: such an order is still `received`, and `received → cancelled` is allowed. |
| 15 | **New: "Once you have asked us to cancel it, do not resend it."** (fact-check S5). | The receipt hero works out its state without `orders.status` (`orderConfirmation.ts:51-109`; `ConfirmationHero.tsx:25`, `:64`). Live `request_customer_pos_resend`, `customer_manual_pos_resend_eligibility`, `claim_lazywait_sync_batch`/`_one` and `order_refund_due` never mention `cancelled` (read 2026-11-13), and `lazywait-sync/index.ts` has no "cancel" anywhere. Cancelling changes no sync state (`20260918120000…:657-732`). So a cancelled order can still be resent to the kitchen, and after three resends an automatic refund is queued against a payment staff already refunded by hand; Moyasar then refuses it and the app shows "Refund in progress". |
| 16 | **New: what to tell us when the app shows no order number** (fact-check S3). | The app shows only the branch's POS number (`apps/mobile/src/lib/mappers.ts:340-356`); the internal SM- number "is never displayed" (`ReceiptScreen.tsx:13-14`). An order not sent, or being checked with the branch, has none: its card shows "My Orders" as its title, with its date, time and total (`OrderCard.tsx:18`, `:22`). |
| 17 | **New: a prepaid delivery order returned to the branch** (fact-check S9). | Live `delivery_pickup_policy` v2.1: *"If the driver cannot reach you or the address after reasonable attempts, the order may be returned to the branch. See the Cancellation and Refund Policy."* Neither v2.0 nor the first draft had a rule for it, and online payment is offered for delivery as well as pickup (`apps/mobile/src/lib/payment.ts:50-55`). No code decides it, so the sentence only says what happens today (we answer) and D10 asks for the rule. |
| 18 | **ONLINE PAYMENT REFUNDS line 8: a paid order we cancel under the Terms and Conditions, and "accept or complete"** (re-check; raised by `docs/legal/TERMS_CONDITIONS_CARD_PAYMENTS_DRAFT.md`, TC-1). Clauses reordered so the list of reasons ends the sentence. | Live `terms_conditions` v2.0, YOUR ACCOUNT: *"We may refuse or cancel an order if the details are clearly false."* The first wording listed only a cancellation at the customer's request or because the branch could not complete it, so a paid order we cancel under the Terms had no rule here. Live `admin_set_order_status` cancels from every open status and refunds no money (row 4), so the refund is by hand in every case and only the promise differs. Including it follows the owner's stated answer for cancelled paid orders, *"a refund is automatic, through Moyasar"* (`PAYMENTS.md:16`). The terms draft offered "for any reason"; not used, because it would contradict UNCOLLECTED PICKUP ORDERS ("not refundable") and D10's returned delivery order whenever staff record one of those as cancelled. "Accept or complete" matches IF WE CANNOT FULFIL and the Terms' *"A branch may decline an order"*. D14. |
| 19 | **ONLINE PAYMENT REFUNDS line 10: "Once we have confirmed with Moyasar that the payment was taken and was not used for any order, we will refund it."** (re-check). | The app's *"We could not confirm the payment. Please contact support if an amount was deducted."* (`payUnknown`, `strings.ts:204`, AR `:567`) is shown for a payment Moyasar reports paid that we did not confirm, for a payment already refunded, and for any status Moyasar returns that we do not recognise (`supabase/functions/_shared/moyasar.ts:474-509`). For the last, the app keeps the checkout session because *"the backend may still settle it"* (`apps/mobile/src/features/checkout/pendingSession.ts:62-84`; test `pendingSession.test.ts:52`), and a settled session becomes a paid order. The first wording ("we will refund it once we have confirmed it with Moyasar") therefore also promised a refund of a payment that later bought the order. A duplicate is never applied to an order (`moyasar.ts:962-975`), so the qualifier does not narrow that case. |
| 20 | **IF WE CANNOT FULFIL line 2 and ONLINE PAYMENT REFUNDS line 8: "for a reason on its side"** (re-check; completes fact-check S9). | S9 warned that *"cannot … complete … is refunded"* could be read as promising a refund of a delivery order returned because the driver could not reach the customer. The first revision added line 9 (D10) but left IF WE CANNOT FULFIL line 2 unconditional, so a reader could set that general sentence against line 9's *"we will tell you whether any of the amount you paid can be refunded"*, and line 8's *"because the branch could not … complete it"* had the same reach. Both now cover only a reason on the branch's side, which every example in IF WE CANNOT FULFIL line 1 is (closed, an item unavailable, an address outside the branch's delivery area). A delivery returned for the customer's reasons stays with line 9 and D10, and an uncollected pickup order with UNCOLLECTED PICKUP ORDERS and D5. No code decides any of these (row 17). |

**Not added, on purpose:**

- **The 1.00 SAR minimum** and **the list of card methods** (mada, Visa,
  Mastercard, Apple Pay). They describe how to pay, not refunds, so they belong
  in `payment_policy` (`OWNER_ACTIONS.md` §47.15). Apple Pay is not named here
  for a second reason: it is unconfirmed in the in-app WebView (`PAYMENTS.md`
  §11 Q1) and absent from builds in the field (`PAYMENTS.md:313-315`).
  "Card or payment method you paid with" covers it if it ships.
- **"The web build cannot pay by card"** (`PAYMENTS.md:216-219`). True, but it
  is a payment-policy point, and the conditional wording already makes the
  refund text true on every surface.
- **Loyalty points in general.** Only the gap on the automatic-refund path is
  stated (row 14); everything else about points stays in `offers_loyalty_terms`.

### Version: 2.0 → 3.0 (major)

- v2.0's refund section rests on one premise, *"Orders are paid in cash"*. This
  draft removes that premise, adds a new way money is returned (to the card,
  through Moyasar) and adds a new section. It also corrects two v2.0 sentences
  that were untrue of the code (S1, S2). A customer who read v2.0 should read
  this again, and a major number says so.
- The house precedent leans the other way: `offers_loyalty_terms` added
  pickup-only, multipliers and expiry as a **minor** bump (2.1 → 2.2,
  `OWNER_ACTIONS.md` §33). If the owner prefers that convention, **2.1** is
  equally correct. Nothing in the code depends on the number: no table records
  which version a customer accepted (searched for `accepted_version`,
  `policy_version`, `consent_version`, `legal_acceptance`; none exist), and
  checkout only links the document (`apps/mobile/src/features/checkout/CheckoutScreen.tsx:73-77`).

### Publishing mechanics (for whoever does the §5 write)

- In the same owner-approved session as `privacy_policy`, `payment_policy` and
  `terms_conditions`, both languages, before §47.18 (see the header). Not alone,
  and not one language first.
- One row exists. Update `content_en`, `content_ar`, `version` and
  `effective_date` on it, with `replace()` against the stored text, never a
  re-paste. Besides the REFUNDS changes, two v2.0 sentences change (CANCELLING
  line 1, IF WE CANNOT FULFIL line 1), so the `replace()` list must include
  them. Verify afterwards: each old string absent, each new string present,
  untouched sections byte-identical, in both languages
  (`LEGAL_DOCUMENTS_AUDIT.md:141-157`).
- Then rebuild the site: no-JavaScript readers, store policy checkers included,
  see `legal.html` only after a rebuild (`LEGAL_DOCUMENTS_AUDIT.md:158-166`).
- **All `[OWNER DECISION …]` markers out, and `[N]` and `[DAY MONTH YEAR]`
  filled in, first.**

---

## Open owner decisions

| Id | Decision | What the draft says now | If decided differently, or once the product changes |
| --- | --- | --- | --- |
| **D1** | **A cancelled paid order: automatic or on request?** (`OWNER_ACTIONS.md` §47.20, `PAYMENTS.md` §11.) The owner's 2026-11-11 answer was "automatic via Moyasar"; the code refunds a cancelled paid order only by hand (product gap REF-5). Marked on CANCELLING line 3 and ONLINE PAYMENT REFUNDS lines 5, 6 and 8. | "our team refunds", and no word "automatically". True to the code, provided staff refund by hand every time. | If cancellation is made to enrol an automatic refund (a code and migration change), say "is refunded automatically" on those lines, for example CANCELLING line 3: EN *"If you paid online, the amount you paid is refunded automatically to the card or payment method you used once the order is cancelled, as described under ONLINE PAYMENT REFUNDS below."* AR «وإذا كنت قد دفعت إلكترونياً، يُسترد المبلغ الذي دفعته تلقائياً إلى البطاقة أو وسيلة الدفع التي استخدمتها بعد إلغاء الطلب، كما هو موضح أدناه في قسم استرداد المدفوعات الإلكترونية.» Publish that wording only after the change is deployed. |
| **D2** | **Duplicate payments: refund automatically?** (`PAYMENTS.md` §10-§11; product gap REF-6.) Decide it, with D3, together with the payment_policy draft's PAYING ONLINE bracket *"(refund promise; decide once, with cancellation_refund_policy D2 and D3)"*: that draft names the same two cases, promises no refund for them, points here for when refunds are made, and quotes this line's first wording (re-check). | Listed under "We may not notice some payments unless you tell us", because nothing alerts staff today. | If automated, move duplicates to the automatic paragraph. If the owner instead adds an alert but keeps refunds manual, move them to "Our team also refunds". |
| **D3** | **How soon does the team issue a refund it owes?** No SLA exists in the code or the runbook. Marked on CANCELLING line 3 and ONLINE PAYMENT REFUNDS lines 5, 6, 8 and 10. | No period promised. The 1-3 / 7-14 working-day timing starts "once a refund has been issued". | Add e.g. "within N working days of cancelling the order or confirming the payment". Only promise a number the team can keep. Manual refunds are a live money action in the Moyasar dashboard (`PAYMENTS.md:616-620`). |
| **D4** | **Card only, or may a card-paid refund be settled in cash at the branch?** Partial refunds are possible in Moyasar (`Moyasar_API_Reference.md:228`), so a complaint refund can go to the card. Marked on CANCELLING line 3, IF WE CANNOT FULFIL line 2 and ONLINE PAYMENT REFUNDS line 1. | "goes back to the card or payment method you paid with". | If cash at the branch is allowed as an alternative (for example a small complaint refund), say so on those lines, and say who chooses. |
| **D5** | **Uncollected prepaid pickup orders: still not refundable?** | Keeps v2.0's rule and adds "This applies to orders paid online too." | Drop the added sentence, or replace it with the refund rule chosen. Worth a consumer-law read: the customer has now paid in advance. |
| **D6** | **Effective date** and the version number (3.0 proposed; 2.1 is the house-convention alternative). **Decide the number once for all four documents** published together: the payment_policy and terms_conditions drafts leave theirs to that one decision ("2.1 or 3.0"), and the privacy draft proposes its next minor, 2.4 (re-check). | Placeholder. | Must be the date of the joint publishing session, the same date in all four documents, on or before the day online payment is turned on (§47.18), written in the first line and the column. |
| **D7** | **When may customers rely on the automatic-refund sentence?** (Extended after fact-check S6.) It is true to the code, but it has never run against live Moyasar and the sandbox cannot exercise it (`PAYMENTS.md:545-547`). The worker runs only while the payment row is enabled and names Moyasar (`payment-refund/index.ts:47-53`) and the `payment-refund-worker` job is active (`PAYMENTS.md:341-346`); a LIVE refund reaches Moyasar only through `MOYASAR_PROXY_URL` and the Allowed IPs list (§47.10-§47.12), and proxy support on hosted Supabase is unproven (`PAYMENTS.md:467-472`). Read 2026-11-13: job inactive, `order_refunds` empty, row in TEST. | The sentence stands on four conditions, three of them met **before online payment is switched on** (§47.18): (1) LIVE Test connection through the proxy reads "Connection OK" (§47.13); (2) the refund job is active and one run succeeded (§47.16); (3) the payment row is enabled (§47.14) and stays enabled: stop card payments with the Online Payment switch, not the row, because disabling the row stops refunds too. (4) comes **right after switch-on**: §47.18 step 4 produces one automatic refund, agreed with the owner beforehand (`PAYMENTS.md` §9 B), and watches it reach Refunded. If none can be produced, or it does not complete, switch Online Payment off and publish the fallback wording (next column) before switching on again. That fallback is the off-ramp, not the default. | If (1) to (3) cannot be met, do not switch online payment on. The fallback wording, for condition (4)'s off-ramp or if online payment must go on without (1) to (3): replace ONLINE PAYMENT REFUNDS line 2's second sentence with EN *"If it still cannot be sent and the app no longer offers to send it again, our team refunds the full amount you paid."* AR «فإن ظل إرساله متعذراً ولم يعد التطبيق يعرض عليك إعادة الإرسال، يرد فريقنا المبلغ الذي دفعته كاملاً.»; and delete line 3 (a refund made by hand never changes the app's refund status: `OWNER_ACTIONS.md` §47.18; gap PG-14). Line 4 needs no change: since the re-check it is keyed to "Order not placed", and "even if the amount you paid is refunded automatically" stays true when nothing is. This fallback contradicts the app, which tells the customer *"Your payment will be refunded automatically."* (`strings.ts:375`, AR `:719`) in every build. |
| **D8** | **`[N]`, and whether staff are shown and alerted to failed or stuck refunds** (fact-check B1; product gap REF-1). | Customer-triggered: if the refund status has not changed to Refunded `[N]` days after it appears, contact us and our team completes the refund. Suggested `[N]`: a small number such as 2, since a healthy refund reads Refunded within minutes and `contact_support` already aims to acknowledge a message within one working day. In Arabic, make the noun agree (see the Arabic notes). | Once the console lists failed **and** stuck refunds (it calls `list_failed_order_refunds()` and shows `pending` refunds past an age, `moyasar_ip_not_allowed` included), an alert fires on them, and a pending refund stops retrying silently for ever (an attempt cap or an age escalation), use the first draft's sentence instead: EN *"If an automatic refund cannot be completed, our team completes it and contacts you."* AR «وإذا تعذّر إتمام الاسترداد التلقائي، يتولى فريقنا إتمامه ويتواصل معك.» |
| **D9** | **Points spent on an order the app shows as "Order not placed"** (fact-check S8; product gaps REF-3 and REF-10; widened by the re-check to the 0.00 and cash orders that also reach that state). | They are not returned automatically, even when the payment is refunded; the customer contacts us and staff return them by cancelling the order, which restores redeemed points (live `admin_set_order_status`, any order, any payment method). | A code and migration change, in one of two shapes. (a) Points returned for **every** order that reaches "Order not placed": replace line 4 with EN *"Points you spent on an order that the app shows as "Order not placed" are returned to you automatically."* AR «وتُعاد إليك تلقائياً النقاط التي استخدمتها في طلب يظهر في التطبيق بعبارة "لم يتم إنشاء الطلب".» (b) Points returned only when a refund is enrolled, which reaches neither a 0.00 order nor a cash order (REF-10): replace line 4 with EN *"Points you spent on an order that is refunded automatically are returned to you automatically. Points you spent on any other order that the app shows as "Order not placed" are not; contact us and our team will return them."* AR «وتُعاد إليك تلقائياً النقاط التي استخدمتها في طلب استُرد مبلغه تلقائياً. أما النقاط التي استخدمتها في أي طلب آخر يظهر في التطبيق بعبارة "لم يتم إنشاء الطلب"، فلا تُعاد تلقائياً؛ تواصل معنا وسيعيدها فريقنا إليك.» Publish either only after the change is deployed. |
| **D10** | **A prepaid delivery order returned to the branch because the driver could not reach the customer or the address** (fact-check S9). Live `delivery_pickup_policy` v2.1 sends the reader here for it. No code or policy decides it. | "contact us and we will tell you whether any of the amount you paid can be refunded": true today, and not a rule. | Choose a rule and replace the line. (a) Not refundable: EN *"If a delivery order you paid for online is returned to the branch because the driver could not reach you or your address, it is not refundable."* AR «وإذا أُعيد إلى الفرع طلب توصيل دفعت قيمته إلكترونياً لتعذّر وصول السائق إليك أو إلى عنوانك، فلا يكون قابلاً للاسترداد.» (b) Refunded less the delivery fee: EN *"… the amount you paid is refunded less the delivery fee."* AR «… يُسترد المبلغ الذي دفعته بعد خصم رسوم التوصيل.» (c) Refunded in full: EN *"… the full amount you paid is refunded."* AR «… يُسترد المبلغ الذي دفعته كاملاً.» Worth the same consumer-law read as D5. IF WE CANNOT FULFIL line 2 and ONLINE PAYMENT REFUNDS line 8 are limited to reasons on the branch's side (re-check, row 20), so none of these rules conflicts with them. |
| **D11** | **A paid order the customer never resends** (fact-check S7; product gap REF-4). It stays "branch failed, retry available" for good and is never refunded automatically (`20260828090000_customer_order_state_inflight.sql:121-126`). | "If you would rather not try again, contact us": only the customer can start it. | If a deadline is added that enrols such orders for the automatic refund (a code and migration change), add after line 2's first sentence: EN *"If you do not resend it within [time], the full amount you paid is refunded automatically."* AR «وإذا لم تُعد إرساله خلال [المدة]، يُسترد المبلغ الذي دفعته كاملاً تلقائياً.» |
| **D12** | **A cancelled order can still be resent** (fact-check S5; product gap REF-2). | Line 5 tells the customer not to resend after asking us to cancel. | Once the resend check, the sync claims, the sync worker and `order_refund_due` ignore `status = 'cancelled'`, and the receipt hero shows "Cancelled", delete EN *"Once you have asked us to cancel it, do not resend it."* and AR «وبعد أن تطلب منا إلغاءه، لا تُعد إرساله.» |
| **D13** | **The "Received" status and the cancellation window** (fact-check S1; product gap REF-7). | The window is "before the branch starts preparing your order", checked with the branch. | Only if the app's status reliably moves to Preparing when the branch starts (for example from the POS), the first sentence of v2.0 may come back: EN *"You can ask to cancel while your order is still Received, before the branch starts preparing it."* AR «يمكنك طلب الإلغاء ما دام طلبك في حالة "تم الاستلام" وقبل أن يبدأ الفرع بتحضيره.» Keep the new second sentence either way: it works for an order with no number. |
| **D14** | **A paid order we cancel under the Terms and Conditions** (re-check; `docs/legal/TERMS_CONDITIONS_CARD_PAYMENTS_DRAFT.md`, TC-1). Live `terms_conditions` v2.0, YOUR ACCOUNT: *"We may refuse or cancel an order if the details are clearly false."* No code decides what happens to the money; any refund is by hand (row 4). Marked on ONLINE PAYMENT REFUNDS line 8. | Our team refunds it, like the other cancellations of a paid order on that line. That follows the owner's stated answer for cancelled paid orders (*"a refund is automatic, through Moyasar"*, `PAYMENTS.md:16`) and leaves no paid cancellation without a rule. | If some such orders are not to be refunded (for example an order placed to misuse the app, Terms USING THE APP PROPERLY), that is counsel's question and must be stated: replace EN *"or because we cancel it under our Terms and Conditions"* / AR «أو لإلغائنا إياه بموجب الشروط والأحكام» with the rule chosen, in both languages. Do not use "for any reason", which the terms draft offered: it would contradict UNCOLLECTED PICKUP ORDERS and D10 whenever staff record such an order as cancelled. |

---

## Also for the owner, outside this document

- **`terms_conditions` must change in the same session** (fact-check B2). Its
  `PAYMENT` line reads *"Orders are paid in cash at pickup or on delivery. See
  the Payment Policy."* / «تُدفع الطلبات نقداً عند الاستلام أو عند التوصيل. انظر
  سياسة الدفع.» The change is drafted in `docs/legal/TERMS_CONDITIONS_CARD_PAYMENTS_DRAFT.md`, not here
  (corrected by the re-check: this bullet used to say no draft existed and
  quoted the fact-check's wording). That draft's line is EN *"Orders can be
  paid in cash at pickup or on delivery or, where the app offers it, online, as
  part of placing your order. See the Payment Policy."*, its Arabic splitting
  the payment statement into two sentences before the pointer; its Fix log says
  why it differs from the fact-check's wording. Nothing
  in it conflicts with this policy, and its CANCELLING clause stays a pointer
  here. Its TC-1 note about this policy is answered by D14. §47.15 of
  `OWNER_ACTIONS.md` has listed `terms_conditions` since 2026-11-13.
- **The payment_policy draft quotes this policy's old line 10.** Its PAYING
  ONLINE bracket (refund promise, tied to D2 and D3) quotes *"we will refund it
  once we have confirmed it with Moyasar"*. Since the re-check the sentence reads
  *"Once we have confirmed with Moyasar that the payment was taken and was not
  used for any order, we will refund it."* (row 19). Update that quote when the
  two are settled together.
- **The store answers' optional App Review sentence about a second payment**
  says *"…it is not applied to any order, and we refund it by hand."*, with no
  customer contact, while line 10 here says we may not notice one unless the
  customer tells us. If both are used, align them, for example *"…and we refund
  it by hand once we find it or the customer tells us."* No store text promises
  refunds to customers.
- **Refund timing: the records now say "business days".** The re-check
  re-read Moyasar's FAQ on 2026-11-13: *"Mada cards: 24 hours to 3 business
  days. Credit cards: 7 to 14 business days. Weekends not included."*
  `docs/integrations/Moyasar_API_Reference.md` §3.2 and `OWNER_ACTIONS.md`
  §47.18 were corrected to say so on 2026-11-13, and the payment_policy draft's
  note and the store answers' claim 13 now agree. Neither draft states a timing
  to customers.
- **A 0.00 paid order that cannot be sent is told its payment will be refunded**
  (product gap REF-10). Changing that copy (`strings.ts:375`, AR `:719`) or the
  state the app derives needs an EAS build. `docs/readiness/20261113-card-payments-gaps.md` lists it
  as PG-30 (decision needed); its PG-15 covers only the automatically refunded
  order.
- **`contact_support` v2.0 says the order number "is shown on the confirmation
  screen and in your Orders tab".** That is not true of an order that was not
  sent or is being checked with the branch (row 16). This policy now says what to
  give instead; `contact_support` still does not.
- **Two live push messages promise a follow-up.** `pos_failed`: *"Our team will
  follow up."* `pos_confirmation_required`: *"our team is on it and will update
  you"* (`push-dispatch/index.ts:169-188`). For a paid order the watchdog does
  raise `PAID_ORDER_NOT_SYNCED` or `PAID_ORDER_DEAD_LETTER`
  (`ORDER_INTEGRITY_WATCHDOG.md` §3), but nothing makes anyone contact the
  customer. This policy says only that our team *may* contact them (row 6).
- **The app's own failed-refund text promises a contact** that nothing triggers
  (product gap REF-1). Changing it needs an EAS build.

---

## Product gaps found

Each gap is a place where the product does not do what a reasonable promise
would need. The policy says what is true today; the marker gives the wording to
use once the product changes. IDs are REF-n, with the matching gap in
`docs/readiness/20261113-card-payments-gaps.md` beside each.

| Id | Gap | Evidence | Policy wording today | Decision |
| --- | --- | --- | --- | --- |
| **REF-1** (gap PG-01) | **No one is told when an automatic refund fails or sticks.** | Allowed IPs refusals and network or proxy failures stay `pending` for ever, with no attempt cap, outside `list_failed_order_refunds()` (`moyasarRefund.ts:101-110`, `:119-121`; `payment-refund/index.ts:247-251`; `PAYMENTS.md:377-385`). A definitive failure lands in `list_failed_order_refunds()`, an admin RPC nothing in the console calls. The console never shows `refund_state`; no watchdog or health rule reads `order_refunds`; `REFUND_STUCK` is not implemented (`ORDER_INTEGRITY_WATCHDOG.md:186-189`). Outright failures are realistic: an aggregation account needs enough balance to refund (`Moyasar_API_Reference.md:236-245`). Meanwhile the app tells the customer *"We are arranging your refund and will contact you."* / «نعمل على استرداد مبلغك وسنتواصل معك.» under the label "Refund in progress" (`strings.ts:377`, `:385`; AR `:721`, `:729`). | The customer contacts us if the status has not changed to Refunded after `[N]` days. | D8 |
| **REF-2** (gap PG-03) | **Cancelling an order does not stop it.** The receipt still offers Resend, and a resend still reaches the kitchen. | Row 15. | "Once you have asked us to cancel it, do not resend it." | D12 |
| **REF-3** (gap PG-15) | **Points spent on an automatically refunded order are not returned**, although the app calls it "Order not placed" and live `offers_loyalty_terms` v2.2 returns points spent on a cancelled order in full. | Row 14. | Not returned automatically; contact us and staff return them. | D9 |
| **REF-4** (gap PG-16) | **A paid order the customer never resends is never refunded automatically.** | `20260828090000_customer_order_state_inflight.sql:121-126`: it stays "retry available" with no deadline. | "If you would rather not try again, contact us …" | D11 |
| **REF-5** (gaps PG-13, PG-14) | **A cancelled paid order is not refunded automatically, nothing prompts staff to refund it by hand, and a refund made by hand is not written back to the order.** | `OWNER_ACTIONS.md` §47.20, `PAYMENTS.md:330-337`; a search of `src/` finds no refund prompt on cancel; `OWNER_ACTIONS.md` §47.18 ("still reads paid"; gap PG-14). The owner's stated answer was "automatic" (`PAYMENTS.md:16`). | "our team refunds", no "automatically". | D1, D3 |
| **REF-6** (gap PG-02) | **Duplicate payments and unconfirmed deductions are recorded but never refunded automatically, never alerted on, and not listed in the console.** | `PAYMENTS.md:594-601`; `moyasar.ts:962-975`. | "We may not notice some payments unless you tell us …" | D2 |
| **REF-7** (gap PG-21) | **The order status does not move when the branch starts preparing**, so the app's "Received" cannot tell a customer whether cancellation is still possible. | Row 4: only `admin_set_order_status` moves `status`; 53 of 54 orders in 90 days never left `received`. | "before the branch starts preparing your order … we will check with the branch". | D13 |
| **REF-8** (gap PG-11) | **Our invoice request does not restrict payment methods**, so the methods on the hosted page are whatever Moyasar's dashboard enables, and a SADAD payment cannot be refunded. | `moyasar.ts:336-353`; `PAYMENTS.md:635-637`; §47.19 still open. | Unchanged ("the card or payment method you paid with"), on the precondition that Moyasar confirms in writing that SADAD and STC Pay are off for invoices. | Header precondition |
| **REF-9** (none: the gaps list leaves it out on purpose, its §4) | **No rule, in code or policy, for a prepaid delivery order returned to the branch.** | Row 17. | "contact us and we will tell you whether any of the amount you paid can be refunded". | D10 |
| **REF-10** (gap PG-30) | **A paid order with a total of 0.00 that cannot be sent is told "Your payment will be refunded automatically.", no refund opens, and the points it used stay spent** (found by the re-check). | Live `begin_checkout_session` settles a 0.00 checkout (points, or the comped-customer discount) as `'online', 'paid'`; live `order_refund_due` requires `total > 0`; live `customer_order_state` (step 10) and `orderConfirmation.ts:104-108` still give such an order `final_failure_refund_pending`, whose copy is *"Your payment will be refunded automatically."* (`strings.ts:375`, AR `:719`); no refund status appears (`ConfirmationHero.tsx:65`). Live: one 0.00 paid online order exists (2026-11-11, comped; it reached the POS). Row 14. | Line 4 is keyed to "Order not placed", so it tells this customer to contact us for the points. Lines 2 and 3 promise nothing for a 0.00 order that the code fails to do. | D9; the app copy is outside this document |

---

## Claims the drafter could not verify

1. **Refund timing.** Now sourced: Moyasar's FAQ (`moyasar.com/en/resources/faqs`,
   read 2026-11-13) says *"Mada cards: 24 hours to 3 business days. Credit
   cards: 7 to 14 business days. Weekends not included."*, so the text says
   "working days". The fact-check could not find these figures because it looked
   at the refund API page and the payment-operations guide only. The re-check
   re-read the FAQ the same day and found the same three sentences. Still not
   sourced: the time for a debit (non-mada) Visa or Mastercard card and for
   Apple Pay. A search result summarised Moyasar's help-centre article on
   dashboard refunds as "up to 14 days" for mada and credit cards;
   `help.moyasar.com` could not be reached from this session (the session's
   network allow-list), so that figure is unread and not used.
2. **That a Moyasar refund lands on the original card.** Our code refunds the
   payment id. Moyasar's FAQ calls it refunding "the customer's card"; it does
   not say so for Apple Pay.
3. **Apple Pay refunds**: that they return to the card behind Apple Pay, and how
   long that takes. Not in the repository. The draft does not name Apple Pay.
4. **SADAD and STC Pay are off for invoices.** Now a publishing precondition
   (header; fact-check S10; product gap REF-8). The owner said STC Pay is not
   enabled (`PAYMENTS.md:15`); SADAD is unanswered (`OWNER_ACTIONS.md` §47.19).
5. **That staff will actually issue the manual refunds** the draft attributes to
   "our team" (cancellations, the "checking with the branch" case, complaints,
   duplicates). The code has no queue, alert or status for them (product gaps REF-5
   and REF-6). They remain operational promises (D1, D3). The failed or stuck
   automatic refund is no longer one of them: the customer sets it off (D8).
6. **That the automatic path works in Production.** Read 2026-11-13: refund job
   inactive, row in TEST, `order_refunds` empty. The path has never run against
   live Moyasar (`ORDER_CONFIRMATION_FLOW.md` §11: no sandbox integration test
   for `payment-refund`), and the small live refund of §47.18 has not been
   done. D7 now lists the conditions.
7. **Loyalty points on an automatically refunded order.** No longer unverified:
   the fact-check confirmed it (S8), and the live function bodies were re-read
   for this revision. Now stated in the policy (row 14, product gap REF-3, D9). The
   re-check widened it to every order the app shows as "Order not placed",
   because a 0.00 paid order reaches that state with no refund (REF-10).
8. **Whether every installed app build shows the refund status** on the order
   screen. The code is in the repository (`ConfirmationHero.tsx:65`); which
   builds in customers' hands carry it was not checked. The draft says "you can
   follow the refund on your order in the app" only for the automatic case.
9. **Consumer-law fit**: Saudi e-commerce and consumer-protection requirements on
   refund periods, cancellation rights and prepaid forfeiture (D5, D10) were not
   reviewed. That is counsel's.
10. **The Arabic.** Engineering-drafted; needs a native read, especially
    «وقد لا ننتبه إلى بعض الدفعات ما لم تخبرنا بها», «وقد يتواصل معك فريقنا
    أيضاً», «إذا لم تتحول حالة الاسترداد في طلبك إلى "تم الاسترداد" بعد [N] أيام
    من ظهورها», «طلب يظهر في التطبيق بعبارة "لم يتم إنشاء الطلب"، حتى لو استُرد
    المبلغ الذي دفعته تلقائياً», «سواء بناءً على طلبك أو لتعذّر قبوله أو إتمامه
    في الفرع لسبب يعود إليه أو لإلغائنا إياه بموجب الشروط والأحكام», «ولم يستطع
    الفرع قبول طلبك أو إتمامه لسبب يعود إليه», «وبعد أن نتحقق لدى Moyasar
    من أن الدفعة خُصمت ولم تُستخدم في أي طلب», «لا تُعد إرساله», the D10 sentence,
    «ولن تدفع شيئاً إن لم تكن قد دفعت بعد» and the duration phrasing
    «نحو ١ إلى ٣ أيام عمل» / «نحو ٧ إلى ١٤ يوم عمل».

---

## Fix log

Fact-check: `docs/readiness/20261113-card-payments-reviews/cancellation_refund_policy.review.md`. Every finding's
evidence was re-checked in the default branch at `04eb351` and, where it concerns
Production, by read-only SQL on 2026-11-13, before it was applied. The
"re-check:" lines at the end record a second, independent pass made the same
day after that revision: what it found (R1 to R7) before fixing anything, what
it changed, and what it verified and left alone (R8, R9).

- **B1** → fixed, and owner decision D8 (product gap REF-1). The promise *"If an automatic refund cannot be completed, our team completes it and contacts you."* / «وإذا تعذّر إتمام الاسترداد التلقائي، يتولى فريقنا إتمامه ويتواصل معك.» is gone; in its place the customer contacts us if the refund status has not changed to Refunded `[N]` days after it appears. Evidence confirmed: `moyasarRefund.ts:101-110`, `:119-121`; `payment-refund/index.ts:247-251`; `PAYMENTS.md:377-385`; live `list_failed_order_refunds` is an `is_admin()` RPC that nothing in `src/` calls; the console never renders `refund_state`; `ORDER_INTEGRITY_WATCHDOG.md:186-189`. The review's wording was adjusted: the app never says a refund "could not be completed" (a failed refund is labelled "Refund in progress", `strings.ts:385`, AR `:729`), so the trigger is "has not changed to Refunded".
- **B2** → fixed. The first draft's claim that this policy could safely go live ahead of the others is deleted, and the header states the proposed plan: four documents together, both languages, one owner-approved session, before §47.18, with store answers and listing copy in the same window. Moyasar stays named, because `privacy_policy` and `payment_policy` name it in the same session; the review's "remove the name if this goes first" alternative is moot under that plan and was not applied. The `terms_conditions` line and its absence from §47.15 are recorded under "Also for the owner": that document is not in this file. (§47.15 lists it since 2026-11-13.) Live quotes re-read (`payment_policy` v2.0, `privacy_policy` v2.3, `terms_conditions` v2.0).
- **S1** → fixed, and owner decision D13 (product gap REF-7). CANCELLING line 1 uses the review's wording in both languages. Re-checked live: no function other than `admin_set_order_status` sets `orders.status`; last 90 days 50 `received`/`synced`, 3 `received`/`blocked`, 1 `delivered`.
- **S2** → fixed. "…we will tell you. If you have not paid yet, you pay nothing." / «…فسنخبرك، ولن تدفع شيئاً إن لم تكن قد دفعت بعد.» Re-checked: `20260820120000…:96`, `ORDER_CONFIRMATION_FLOW.md:1665-1671`, live `terms_conditions` v2.0.
- **S3** → fixed. The review's sentence is ONLINE PAYMENT REFUNDS line 7, both languages; CANCELLING line 1 says "with your order number if the app shows one". Re-checked: `mappers.ts:340-356`, `ReceiptScreen.tsx:13-14`, `OrderCard.tsx:18`, `:22`. `HOW TO REACH US` left byte-identical, as the review asked only for the addition.
- **S4** → fixed. "We may not notice some payments unless you tell us: …" / «وقد لا ننتبه إلى بعض الدفعات ما لم تخبرنا بها: …». The Arabic no longer says more than the English. Re-checked: `moyasar.ts:962-975`, `moyasarVerify.ts:378-387`, `:490-506`, `PAYMENTS.md:594-601`.
- **S5** → fixed with the review's interim sentence, and owner decision D12 (product gap REF-2). Re-checked live: `request_customer_pos_resend`, both resend-eligibility functions, both sync claims and `order_refund_due` never mention `cancelled`; no "cancel" in `lazywait-sync/index.ts`; `orderConfirmation.ts:51-109` ignores status.
- **S6** → owner decision: D7 extended with the four conditions, the instruction to stop card payments with the Online Payment switch rather than the row, and fallback wording for lines 2 to 4, with the app-text conflict noted (`strings.ts:375`, AR `:719`). The sentence itself is unchanged because it is true to the code. Re-checked: `payment-refund/index.ts:47-53`; live job inactive, `order_refunds` 0, row TEST.
- **S7** → fixed. D3 added to CANCELLING line 3 and ONLINE PAYMENT REFUNDS lines 5, 6 and 10 (with line 8, where it already was); D1 to lines 5 and 6; D4 to CANCELLING line 3 and IF WE CANNOT FULFIL line 2; new D11 on line 5 (product gap REF-4). Both languages. Re-checked `20260828090000…:121-126`.
- **S8** → fixed, and owner decision D9 (product gap REF-3). The review's sentence is line 4, split into two sentences in both languages. Re-checked live: no refund-path function or `orders` trigger touches loyalty or sets `cancelled`; `admin_set_order_status` restores redeemed points on cancel; `offers_loyalty_terms` v2.2 quote confirmed.
- **S9** → fixed, and owner decision D10. Line 9 states what is true today (we answer, case by case); the review's two rules, plus a full refund, are D10's alternatives in both languages. Re-checked: live `delivery_pickup_policy` v2.1 quote; online payment is offered for delivery (`apps/mobile/src/lib/payment.ts:50-55`).
- **S10** → fixed: Moyasar's written confirmation that SADAD and STC Pay are off for invoices is a precondition for the publishing session (header; product gap REF-8; claim 4). Wording unchanged, as the review said. Re-checked `moyasar.ts:336-353`.
- **N1** → fixed. "while we check" / «أثناء التحقق» deleted. Re-checked: `order_refund_due` cannot match a marker or reference; `OrdersRequiringVerificationCard.tsx:6`. The review's citation `20260827120000:107-131` is the requeue predicate, not a resolve action; the conclusion holds on the evidence above.
- **N2** → fixed. «يرد قيمته» → «يرد المبلغ الذي دفعته» on lines 5 and 6. The English said "refund it", not "the amount you paid", so it was changed to "refund the amount you paid" on both lines and both languages now say the same thing.
- **N3** → partly rejected. The review could not find the timing figures; Moyasar's FAQ (`moyasar.com/en/resources/faqs`, read 2026-11-13) states them: *"Mada cards: 24 hours to 3 business days. Credit cards: 7 to 14 business days. Weekends not included."* "Credit card" is kept because it is Moyasar's category; "a Visa or Mastercard card" would attach its credit-card figure to debit cards with no source. Fixed differently: "days" → "working days" / «أيام» → «أيام عمل», which the source shows the first draft understated.
- **N4** → fixed on the policy side: line 2 now says "and our team may also contact you" / «وقد يتواصل معك فريقنا أيضاً». It promises nothing. The push copy itself is outside this file and is noted under "Also for the owner". Re-checked `push-dispatch/index.ts:179-188`.
- **N5** → fixed. Row 11 says card brand and last four digits are stored (`moyasarVerify.ts:332-333`, `:375-376`); claim 7 is marked confirmed.
- **re-check: R1 (should-fix) → fixed, and owner decision D9 (new product gap REF-10).** ONLINE PAYMENT REFUNDS line 4 was keyed to "an order that is refunded automatically" and so said nothing to the customer of a 0.00 paid order. Found: live `begin_checkout_session` settles a fully covered checkout as `'online', 'paid'`; live `order_refund_due` needs `total > 0`; live `customer_order_state` and `orderConfirmation.ts:104-108` still show such an order "Order not placed" with *"Your payment will be refunded automatically."*; no refund opens and the points stay spent; one 0.00 paid online order exists live (2026-11-11, comped). Line 4 is now keyed to "Order not placed" in both languages (EN *"Points you spent on an order that the app shows as "Order not placed" are not returned automatically, even if the amount you paid is refunded automatically."*), which also covers cash orders and stays true with the refund job off, so D7's fallback no longer touches line 4. D9 gives two code-change alternatives. Live `admin_set_order_status` restores redeemed points on cancel for any order, so "our team will return them" is keepable for all of them.
- **re-check: R2 (should-fix) → fixed.** Line 10's *"we will refund it once we have confirmed it with Moyasar"* also covered a payment the app first could not confirm but that later settled into a paid order: for an unrecognised Moyasar status the app shows `payUnknown` yet keeps the session because *"the backend may still settle it"* (`moyasar.ts:474-509`; `pendingSession.ts:62-84`). Now *"Once we have confirmed with Moyasar that the payment was taken and was not used for any order, we will refund it."* / «وبعد أن نتحقق لدى Moyasar من أن الدفعة خُصمت ولم تُستخدم في أي طلب، نرد إليك المبلغ.» Row 19. The payment_policy draft quotes the old wording; noted under "Also for the owner".
- **re-check: R3 (should-fix, cross-document) → fixed, and new owner decision D14.** Raised by `docs/legal/TERMS_CONDITIONS_CARD_PAYMENTS_DRAFT.md` TC-1 and confirmed: line 8 did not cover a paid order we cancel under live `terms_conditions` (*"We may refuse or cancel an order if the details are clearly false."*), and said "could not complete" where IF WE CANNOT FULFIL says "accept or complete". Line 8 now lists that case and "accept or complete", in both languages. The terms draft's "for any reason" was rejected, with evidence in this file: it would contradict UNCOLLECTED PICKUP ORDERS and D10 whenever staff record either as cancelled (live `admin_set_order_status` allows cancel from every open status). Row 18.
- **re-check: R4 (should-fix, cross-document) → fixed.** The header said no sibling draft changes `terms_conditions`, and "Also for the owner" quoted the fact-check's PAYMENT wording as if undrafted. `docs/legal/TERMS_CONDITIONS_CARD_PAYMENTS_DRAFT.md` (written after this draft's previous revision) drafts a different line. Both places now point to that draft and quote its line; nothing in it conflicts with this policy.
- **re-check: R5 (nit, cross-document) → fixed.** The payment_policy and terms_conditions drafts leave the version to one decision for the set; D6 and the header's version line now say the number is decided once for all four documents, with the same date in all four.
- **re-check: R6 (nit, cross-document) → recorded under "Also for the owner", outside this file.** The payment_policy draft's bracket quotes line 10's old wording; the store answers' optional App Review sentence says a second payment is refunded by hand with no customer contact; `Moyasar_API_Reference.md:244-245` and `OWNER_ACTIONS.md:4255-4256` say "days" where Moyasar says "business days" (both corrected on 2026-11-13). No customer text conflicts. D2 now says to settle the refund promise together with the payment_policy bracket.
- **re-check: R7 (should-fix; fact-check S9 only partly fixed) → fixed.** S9 said IF WE CANNOT FULFIL's *"cannot … complete … is refunded"* could be read as promising a refund of a delivery order returned because the driver could not reach the customer; the first revision added line 9 (D10) but left that sentence unconditional, and line 8 repeated the reach. Both now cover only "a reason on its side" / «لسبب يعود إليه», which every example in IF WE CANNOT FULFIL line 1 is. D10 notes that none of its rules conflicts any more. Row 20.
- **re-check: R8 → no change (verified).** Kept text is byte-identical: every line in both "Current (live) text" and "Proposed text" was hashed and matched against per-line md5s of the live v2.0 row (both languages, 1 533 / 1 219 characters, md5 `5a67d9d5…` / `91607002…`); every kept line matches and every other line is one this draft changes. Live state unchanged: `online_payment_enabled` false; payment row `moyasar`, enabled, mode `test`; `payment-refund-worker` inactive, every 5 minutes; `order_refunds` 0 rows. Moyasar's FAQ re-read: the 1-3 / 7-14 business-day figures stand, so N3's partial rejection stands. EN and AR were compared sentence by sentence after the fixes, and every marker appears in both.
- **re-check: R9 → earlier fixes re-verified, no change.** B1: live functions reading `order_refunds` are only the refund pipeline and `list_failed_order_refunds`; in `src/`, `refund_state` appears only at `api.ts:798`. S1: live, only `admin_set_order_status` updates `orders.status`; the 90-day mix is 50 `received`/`synced`, 3 `received`/`blocked`, 1 `delivered`. S5: live `request_customer_pos_resend` and both eligibility functions never read `status`. S6: live `order_refund_due` and the BEFORE-trigger order (`enforce_customer_manual_resend_limit` before `set_orders_refund_enrollment`) make the automatic case work as line 2 says; the 5-minute `customer_pos_resend_window` only extends the sync deadline and never withdraws the Resend offer. S8: no refund-path function mentions loyalty or sets `cancelled`. S9 and B2: live `delivery_pickup_policy` and `contact_support` quotes confirmed. Refund amounts: stored in major units and converted to minor units for Moyasar (`moyasarRefund.ts:260-262`), so "the full amount you paid" holds.

### Final review, 2026-11-14

One line per review finding on this file. Each was checked against the
repository at `ebdec3a`, Moyasar's FAQ and read-only SQL before it was applied.
The proposed text did not change: every line inside this file's code blocks is
byte-identical to the previous revision, so R8's per-line check still holds.

- **K6 → applied.** No owner decision on the publishing plan is recorded
  anywhere. The header now reads "Publishing plan (proposed; the owner
  decides)", and the B2 line above says "the proposed plan".
- **R14, K12, C2 → applied.** The header said `terms_conditions` is missing
  from §47.15's list, and "Also for the owner" said §47.15 still does not list
  it. It was added on 2026-11-13, and both places now say so. The B2 line above
  notes it too.
- **X2, K11 → applied, with the verifiers' corrected wording.** Row 10 now says
  the records understated the timing "until both were corrected on
  2026-11-13", and cites them by section (`Moyasar_API_Reference.md` §3.2,
  `OWNER_ACTIONS.md` §47.18). The "Also for the owner" bullet that asked for
  that correction now records it as made, and says the payment_policy draft and
  the store answers agree. The R6 line above is marked as since corrected. The
  customer sentence ("about 1 to 3 working days … about 7 to 14 working days")
  is unchanged; it already rendered Moyasar's "business days".
- **C9 → applied.** "Also for the owner" said the gaps list does not list
  REF-10 yet. The gaps list now carries it as PG-30 (decision needed), and the
  bullet says so.
- **C10 → applied, option (b).** D7's condition (4) is now required, not
  hoped for: §47.18 step 4 produces one automatic refund, agreed with the owner
  beforehand (`PAYMENTS.md` §9 B), and watches it reach Refunded. If none can be
  produced, or it does not complete, Online Payment goes off and D7's fallback
  wording is published before switching on again. The fallback is that
  off-ramp, not the default. D7 no longer says all four conditions are met
  before switch-on; the header's preconditions name (1) to (3) before it and
  (4) right after it. The fallback's reason for deleting line 3 no longer says
  "while the job is off": a refund made by hand never changes the app's refund
  status (gap PG-14), whether the job runs or not.
- **C8 → applied.** The local gap IDs P1 to P10 became REF-1 to REF-10, with
  the global ID beside each in the "Product gaps found" table: REF-1 (PG-01),
  REF-2 (PG-03), REF-3 (PG-15), REF-4 (PG-16), REF-5 (PG-13, PG-14), REF-6
  (PG-02), REF-7 (PG-21), REF-8 (PG-11), REF-9 (none: the gaps list leaves the
  returned prepaid delivery out on purpose, its §4) and REF-10 (PG-30). The
  terms draft's PG-T1 is now TC-1 there, so the references here follow it.
- **K13 → applied.** "Not to the notes in the brief" under "What changed and
  why" referred to an internal working note the owner never saw; it now reads
  "not to working notes".
- **Stale line citations (no finding ID).** Four citations of
  `OWNER_ACTIONS.md` by line number (row 4, the REF-5 row twice, and D7's
  fallback) pointed at lines that have moved; they now cite §47.18 and §47.20.
