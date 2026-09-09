# Offers & Loyalty Terms — engineering draft

> # ⚠️ SUPERSEDED IN PART — v2.2 IS PUBLISHED AND LIVE
>
> **`offers_loyalty_terms` v2.2 went live 2026-09-09 07:56:15 UTC**, effective
> 9 September 2026, on explicit owner approval. The sections below are the draft
> that fed it and are kept for their reasoning — but **§3 and §4 are no longer
> the current text.** The published text is reproduced verbatim immediately
> below, so this repository holds a byte-accurate copy of what a customer sees.
>
> **Three open brackets in §3 were resolved, and how matters more than what:**
>
> - **`[DATE]` → 9 September 2026.** The bracketed figures were re-read from live
>   `app_settings` at publication rather than copied from this file, as §3
>   instructs: 1 point per 1 SAR, 0.10 SAR per point, 100 minimum. All three
>   matched what was already published, so no figure changed.
> - **The per-item bracket** — *"[The app does not currently mark these items
>   individually … wording that does not promise a per-item label until one
>   exists.]"* — was honoured. Published wording is *"Some items **may** not earn
>   points; where an item does not earn, you can still spend points on it."*
>   **"May"** because 0 of 61 products are excluded today, and **no statement
>   about where it shows**, because there is no per-item marker. Note the
>   checkout "You'll earn N points" line is *also* not a valid answer yet — it is
>   merged but ships with the X2 build.
> - **`[Include this section only if points expiry is switched on.]`** was **not**
>   followed, deliberately, and this is the one real departure from the draft.
>   Expiry is switched **off**, so the draft's *"All points expire on [DATE]"*
>   would have been false; but omitting the section entirely would leave the
>   terms silent on the only mechanism that destroys customer value. The
>   published section instead states the truth — *"Your points do not currently
>   expire"* — and pre-announces the mechanism and the advance-notice promise.
>   That starts the notice clock without asserting a rule that is not in force.
>   **It does not make enabling expiry lawful** (`OWNER_ACTIONS.md` §33b).
>
> §5's acceptance analysis is **unchanged and still correct**: nothing records
> that a customer accepted a version, and `requires_acceptance` is still `false`.

## 0. The PUBLISHED text — version 2.2, effective 9 September 2026

Reproduced byte-for-byte from `public.legal_documents`. English md5
`b6a3048b2166b47dd943a5ed300fdb5b` (3 050 bytes); Arabic md5
`ccc19e250110863e15a560fd37998b0a` (4 541 bytes). **The Arabic has not had a
native read** — `OWNER_ACTIONS.md` §33a lists the three passages to check first.

### English

```
Effective date: 9 September 2026

WHO CAN JOIN
The loyalty programme is open to every Spicy Meal account. There is nothing to sign up for — points are added automatically on eligible orders.

EARNING POINTS
Points are earned on PICKUP orders only. A delivery order does not earn points.
You earn points on the value of the eligible items in a pickup order placed through the app. At the time of writing you earn 1 point for each 1 SAR of that value. The current rate always applies, and the app shows your live balance in your profile.
The delivery fee never earns points. Some items may not earn points; where an item does not earn, you can still spend points on it.
If you use a coupon or spend points on an order, the points you earn are calculated on what you actually pay for the eligible items.
Points are added when you place the order, and your balance updates immediately.
During a promotion we may multiply the points an order earns. Where a promotion applies, the multiplied amount is the amount added.

REDEEMING POINTS
Points can be spent on PICKUP orders only. They cannot be used on a delivery order.
Points are redeemed as a discount at checkout. At the time of writing each point is worth 0.10 SAR, and you need at least 100 points before you can redeem.
You choose whether to use your points on an order. When you do, your whole available balance is applied, up to the value of the order. The discount is applied to the order total by our system, and the amounts confirmed at checkout are final.
Points cannot be exchanged for cash, transferred to another account, or combined across accounts. They have no cash value.

IF YOUR ORDER IS CANCELLED
A cancelled order earns no points: the points it earned are taken back, up to the balance you hold at that moment, and any points you spent on it are returned to you in full.

WHEN POINTS EXPIRE
Your points do not currently expire.
If we introduce an expiry date, all points will expire together on that date, whatever date they were earned on, the balance will return to zero, and the expiry will be recorded in your points history. We will announce any such date in the app in advance and give you a reasonable period to use your points, and your profile will show the next expiry date while you hold a balance.

OFFERS AND COUPONS
An offer or a coupon may have its own conditions — a minimum order, selected branches, selected items, a limited period, or one use per customer. The conditions shown with the offer are the ones that apply.
Unless an offer says otherwise, offers cannot be combined with each other.

CHANGES TO THE PROGRAMME
Earning rates, point values, minimums and eligibility can change, and we may pause or end the programme. Where a change reduces the value of points you already hold, we will announce it in the app in advance and give you a reasonable period to use them.

MISUSE
We may cancel points, withdraw an offer, or close an account where points or offers were obtained by error, duplication, or misuse.

CONTACT
info@spicymeal.com.sa — 9200 31495
```

### Arabic

```
تاريخ السريان: ٩ سبتمبر ٢٠٢٦

من يستفيد
برنامج الولاء متاح لكل حساب في سبايسي ميل. ولا يتطلب تسجيلاً، إذ تُضاف النقاط تلقائياً على الطلبات المؤهلة.

اكتساب النقاط
تُكتسب النقاط على طلبات الاستلام فقط، ولا تمنح طلبات التوصيل أي نقاط.
تكتسب نقاطاً على قيمة الأصناف المؤهلة في طلب الاستلام المقدَّم عبر التطبيق. وفي تاريخ كتابة هذه الشروط تكتسب نقطة واحدة عن كل ١ ريال من تلك القيمة. والمعدّل الساري هو المعتمد دائماً، ويعرض التطبيق رصيدك الحالي في ملفك الشخصي.
ولا تمنح رسوم التوصيل أي نقاط. وقد لا تمنح بعض الأصناف نقاطاً، ويظل بإمكانك استخدام نقاطك عليها.
وإذا استخدمت كوبوناً أو استبدلت نقاطاً في الطلب، تُحتسب النقاط المكتسبة على ما تدفعه فعلياً مقابل الأصناف المؤهلة.
وتُضاف النقاط عند تقديم الطلب، ويُحدَّث رصيدك فوراً.
وخلال العروض قد نضاعف النقاط الممنوحة على الطلب، وتُضاف القيمة بعد المضاعفة.

استبدال النقاط
يمكن استخدام النقاط في طلبات الاستلام فقط، ولا يمكن استخدامها في طلبات التوصيل.
تُستبدل النقاط كخصم عند إتمام الطلب. وفي تاريخ كتابة هذه الشروط تساوي كل نقطة ٠٫١٠ ريال، ويلزم امتلاك ١٠٠ نقطة على الأقل قبل الاستبدال.
وأنت تختار ما إذا كنت ستستخدم نقاطك في الطلب. وعند اختيار ذلك يُستخدم رصيدك المتاح بالكامل بما لا يتجاوز قيمة الطلب. ويطبّق نظامنا الخصم على إجمالي الطلب، والمبالغ المؤكدة عند إتمام الطلب نهائية.
ولا يمكن استبدال النقاط بمبالغ نقدية ولا تحويلها إلى حساب آخر ولا جمعها بين حسابات متعددة، وليست لها قيمة نقدية.

عند إلغاء الطلب
لا يكتسب الطلب الملغى أي نقاط: فإذا أُلغي الطلب استُرجعت النقاط التي اكتسبها في حدود رصيدك وقت الإلغاء، وأُعيدت إليك بالكامل أي نقاط استخدمتها فيه.

انتهاء صلاحية النقاط
لا تنتهي صلاحية نقاطك حالياً.
وإذا اعتمدنا تاريخاً لانتهاء الصلاحية، فستنتهي صلاحية جميع النقاط معاً في ذلك التاريخ بغض النظر عن تاريخ اكتسابها، ويعود الرصيد إلى الصفر، ويُسجَّل ذلك في سجل نقاطك. وسنعلن عن أي تاريخ من هذا القبيل في التطبيق مسبقاً ونمنحك مدة معقولة لاستخدام نقاطك، وسيعرض ملفك الشخصي تاريخ الانتهاء القادم ما دام لديك رصيد.

العروض والكوبونات
قد يكون للعرض أو الكوبون شروطه الخاصة، مثل حد أدنى للطلب أو فروع محددة أو أصناف محددة أو مدة محدودة أو استخدام واحد لكل عميل. والشروط المعروضة مع العرض هي الشروط المطبّقة.
وما لم ينص العرض على خلاف ذلك، لا يمكن الجمع بين العروض.

تعديل البرنامج
قد تتغيّر معدلات الاكتساب وقيمة النقطة والحدود الدنيا وشروط الأهلية، وقد نوقف البرنامج أو ننهيه. وإذا كان التعديل يقلّل قيمة نقاط تملكها بالفعل، فسنعلن عنه في التطبيق مسبقاً ونمنحك مدة معقولة لاستخدامها.

سوء الاستخدام
يجوز لنا إلغاء النقاط أو سحب العرض أو إغلاق الحساب إذا تم الحصول على النقاط أو العروض نتيجة خطأ أو تكرار أو سوء استخدام.

التواصل
info@spicymeal.com.sa — 9200 31495
```


**This is not legal advice and it is not binding wording.** It is a factual
description of what the code actually does, written so counsel can turn it into
terms and so the owner can see exactly which promises the current live text makes
that the system does not keep.

**Where the real document lives.** `public.legal_documents`, row
`offers_loyalty_terms`, edited in the admin console (Legal Documents). It is now
**version 2.1, effective 8 September 2026, active**.

**Version 2.1 is a targeted correction, not this draft.** On 2026-09-08 the three
false statements described in §1 were corrected in place, in both languages, on
the owner's approval. Everything else in the live text is unchanged. This file is
still the fuller rewrite, and nothing in it is live until somebody puts it
there.

---

## 1. Three things version 2.0 said that the system does not do — CORRECTED 2026-09-08

Found by reading the live text against the code, and fixed without waiting for
any loyalty change to ship, because none of them depended on one. **Live version
2.1 no longer contains any of them.** They are kept here in full because the
reasoning is the useful part, and because a document that quietly drops the
errors it once recorded teaches nobody anything.

The third was found only while making the other two — it had survived every
earlier review of this feature, in a customer-facing document, because nobody had
read the *whole* live text against the code. That is the lesson worth carrying:
the errors you find are bounded by the passages you actually check.

### "Points are added when the order is completed." — CORRECTED

**They are not.** Points are granted when the order is **created** —
`place_order` writes the ledger row and updates the balance in the same
transaction that inserts the order, and the online path does the same inside
`insert_order_from_snapshot` immediately after payment. A customer sees the
points before the kitchen has started cooking.

This is not a quibble: the whole cancellation-reversal mechanism
(`20260810100000`) exists *because* points are granted early. A reader of the
current terms would not expect a reversal to be necessary at all.

### "points added to an order that is later cancelled or refunded are reversed" — CORRECTED

**Approximately true for cancellation, and the approximation matters.**
`admin_set_order_status` on `cancelled`:

- reverses earned points **bounded by the balance that still exists**. If the
  customer has already spent them, the shortfall is *recorded* in the ledger and
  the balance is never taken negative — so the reversal can be partial;
- restores redeemed points **in full**, and deliberately after the clamp above,
  so points spent on a cancelled order can never be consumed to cover an
  earn-reversal shortfall.

**"refunded" is false, and that was measured rather than inferred.** All nine
live functions matching `%refund%` were checked against their source: not one
mentions loyalty. Refund processing is disabled under the payment freeze, so the
clause promised behaviour that has never run.

### "You choose how many points to use on an order." — CORRECTED

**You do not.** `LoyaltyToggle` is a boolean. When it is on, `CheckoutScreen`
submits the entire available balance and the server clamps it to the value of the
order; there is no control anywhere in the flow for choosing an amount.

This one is the reason §1 is worth re-reading rather than skimming. It was live
in a binding customer document from version 2.0, through the whole five-part
loyalty series, and it surfaced only when the live text was read end to end — the
same sentence had already been caught and corrected in *this draft* on #339
without anybody thinking to check whether the live document said it too.

**How the correction was applied**, since the method matters more than the edit:
SQL `replace()` against the stored content rather than a re-paste of the whole
document, so every untouched clause is byte-identical by construction. Each
anchor was confirmed present before the write and verified absent after it, with
the other sections and the quoted figures (1 point per SAR, 0.10 SAR per point,
100 minimum — all matching live `app_settings`) asserted intact in both
languages.

**The Arabic replacements are engineering-drafted and have not had a native
read.** They were published rather than held so neither language was left stating
something false; the wording is a follow-up.

---

## 2. What each shipped change adds, if and when it is switched on

None of this is live yet: four migrations are written and unapplied. **The terms
must be updated before the corresponding switch is flipped, not after.**

**Three of the four default to today's behaviour on apply. Pickup-only does
NOT** — and review caught this paragraph glossing over it on #339, which is
exactly the kind of error that gets terms published too late.
`20260907120000_loyalty_pickup_only.sql` defaults `loyalty_pickup_only` to
**true**, so the moment it is applied every delivery order stops earning *and*
stops being able to redeem, with no later switch to flip. For that one, applying
the migration IS the change: the terms have to be published before the apply, not
before some subsequent toggle. (Per-item exclusion excludes nothing until an item
is turned off; multipliers start with an empty table; expiry starts switched off.)

| Change | What a customer needs told |
| --- | --- |
| Pickup only | Points are earned and redeemed **on pickup orders only**; a delivery order neither earns nor may spend them |
| Per-item exclusion | **Some items earn no points**, and the item's page/receipt is where that shows; points may still be *spent* on such an item |
| Merchandise-only base | Points are earned on the **food**, not on the delivery fee |
| Campaign multipliers | Points may be **multiplied during a promotion**; the multiplied amount is what is granted |
| Expiry | **All points expire on a fixed date**, everybody's together, and the balance goes to zero |

**Expiry is the one that cannot ship on the current terms.** The live text says
only that we may change the programme and will give notice where a change reduces
the value of points already held. A scheduled forfeiture of the entire balance is
a term in its own right and needs to be stated as one, with an acceptance moment
— see §4.

---

## 3. Draft — English

> Everything below describes implemented behaviour. Square brackets mark values
> an administrator sets, which must be filled in from the live settings at the
> moment the document is published rather than copied from here.

```
Effective date: [DATE]

WHO CAN JOIN
The loyalty programme is open to every Spicy Meal account. There is nothing to
sign up for — points are added automatically on eligible orders.

EARNING POINTS
You earn points on eligible orders placed through the app. At the time of writing
you earn [1] point for each 1 SAR of the eligible value of your order.

Points are added when your order is placed, and your balance in the app updates
straight away.

What counts towards points:
- The price of the food, including VAT.
- The delivery fee does not earn points.
- Some items do not earn points. **[The app does not currently mark these items
  individually — see the note below. Counsel should choose wording that does not
  promise a per-item label until one exists.]**
- Points are earned on pickup orders only. A delivery order does not earn points.
- If you use a discount or spend points on an order, the points you earn are
  calculated on what you actually pay for the eligible items.

During a promotion we may multiply the points an order earns. Where a promotion
applies, the multiplied amount is the amount added.

REDEEMING POINTS
Points are redeemed as a discount at checkout. At the time of writing each point
is worth [0.10] SAR, and you need at least [100] points before you can redeem.

Points can be spent on pickup orders only.

You choose **whether** to use your points on an order. When you do, your whole
available balance is applied, up to the value of the order — the app has a single
on/off control, not a field for choosing an amount. The discount is applied to
the order total by our system, and the amounts confirmed at checkout are final.

Points cannot be exchanged for cash, transferred to another account, or combined
across accounts. They have no cash value.

IF YOUR ORDER IS CANCELLED
If an order is cancelled, any points you spent on it are returned to you in full.
Points that order earned are taken back. If you have already spent some of those
points, we take back what remains rather than putting your balance below zero.

WHEN POINTS EXPIRE
[Include this section only if points expiry is switched on.]
All points expire on [DATE] each [PERIOD], whatever date they were earned on. On
that date every balance returns to zero and the expiry is recorded in your points
history. Your profile shows the next expiry date while you hold points.

OFFERS AND COUPONS
An offer or a coupon may have its own conditions — a minimum order, selected
branches, selected items, a limited period, or one use per customer. The
conditions shown with the offer are the ones that apply. Unless an offer says
otherwise, offers cannot be combined with each other.

CHANGES TO THE PROGRAMME
Earning rates, point values, minimums and eligibility can change, and we may
pause or end the programme. Where a change reduces the value of points you
already hold, we will announce it in the app in advance and give you a reasonable
period to use them.

MISUSE
We may cancel points, withdraw an offer, or close an account where points or
offers were obtained by error, duplication, or misuse.

CONTACT
info@spicymeal.com.sa — 9200 31495
```

---

## 4. Arabic — a working translation, not a publishable one

> **Do not publish this without a native review and counsel's approval.** It is
> engineering-drafted, like the rest of the Arabic in this series
> (`OWNER_ACTIONS.md` §26). For ordinary UI copy that caveat is a nuisance; for a
> document a customer is bound by, it is a real risk. It is included because a
> draft is better raw material for a translator than a blank page.

```
تاريخ السريان: [التاريخ]

من يمكنه الانضمام
برنامج الولاء متاح لكل حساب في سبايسي ميل. لا يوجد تسجيل — تُضاف النقاط تلقائياً
على الطلبات المؤهلة.

اكتساب النقاط
تكتسب نقاطاً على الطلبات المؤهلة عبر التطبيق. حالياً تحصل على [١] نقطة لكل ١ ريال
من قيمة الطلب المؤهلة.

تُضاف النقاط عند تقديم الطلب، ويُحدَّث رصيدك في التطبيق فوراً.

ما الذي يُحتسب:
- قيمة الطعام شاملة ضريبة القيمة المضافة.
- رسوم التوصيل لا تمنح نقاطاً.
- بعض الأصناف لا تمنح نقاطاً. **[لا يميّز التطبيق هذه الأصناف حالياً — راجع الملاحظة في القسم ٥.]**
- تُكتسب النقاط على طلبات الاستلام فقط، ولا تمنح طلبات التوصيل نقاطاً.
- عند استخدام خصم أو استبدال نقاط، تُحتسب النقاط على ما تدفعه فعلياً مقابل
  الأصناف المؤهلة.

خلال العروض قد نضاعف النقاط الممنوحة على الطلب، وتُضاف القيمة بعد المضاعفة.

استبدال النقاط
تُستبدل النقاط كخصم عند الدفع. حالياً قيمة كل نقطة [٠٫١٠] ريال، ويلزم [١٠٠] نقطة
على الأقل للاستبدال.

يمكن استخدام النقاط في طلبات الاستلام فقط.

أنت تختار **ما إذا كنت** ستستخدم نقاطك في الطلب. وعند اختيار ذلك يُستخدم رصيدك
المتاح بالكامل بما لا يتجاوز قيمة الطلب — إذ يوفّر التطبيق زر تشغيل/إيقاف واحداً
لا حقلاً لتحديد عدد النقاط. ويطبّق النظام الخصم على إجمالي الطلب، والمبالغ
المؤكدة عند الدفع نهائية.

لا يمكن استبدال النقاط نقداً ولا نقلها إلى حساب آخر ولا دمجها بين الحسابات، وليست
لها قيمة نقدية.

عند إلغاء الطلب
عند إلغاء الطلب تُعاد إليك النقاط التي استخدمتها فيه كاملة، وتُسحب النقاط التي
منحها الطلب. وإذا كنت قد استخدمت جزءاً منها، نسحب المتبقي فقط دون أن يصبح رصيدك
بالسالب.

انتهاء صلاحية النقاط
[تُدرج هذه الفقرة فقط عند تفعيل انتهاء الصلاحية.]
تنتهي صلاحية جميع النقاط في [التاريخ] من كل [المدة] بغض النظر عن تاريخ اكتسابها.
في ذلك التاريخ يعود كل رصيد إلى الصفر ويُسجَّل ذلك في سجل نقاطك. ويعرض ملفك
الشخصي تاريخ الانتهاء القادم ما دام لديك رصيد.

العروض والكوبونات
قد يكون للعرض أو الكوبون شروطه الخاصة — حد أدنى للطلب، أو فروع محددة، أو أصناف
محددة، أو مدة محدودة، أو استخدام واحد لكل عميل. الشروط المعروضة مع العرض هي
المطبَّقة. وما لم يُذكر خلاف ذلك، لا يمكن الجمع بين العروض.

التغييرات على البرنامج
قد تتغير معدلات الاكتساب وقيمة النقطة والحدود الدنيا وشروط الأهلية، وقد نوقف
البرنامج أو ننهيه. وإذا أدى التغيير إلى تقليل قيمة النقاط التي تملكها، سنعلن عن
ذلك في التطبيق مسبقاً ونمنحك مدة معقولة لاستخدامها.

سوء الاستخدام
يجوز لنا إلغاء النقاط أو سحب العرض أو إغلاق الحساب إذا حُصل على النقاط أو العروض
بالخطأ أو بالتكرار أو بسوء الاستخدام.

للتواصل
info@spicymeal.com.sa — 9200 31495
```

---

## 5. The acceptance moment is NOT built

KSA guidance expects loyalty terms — earning, redemption, **expiry, forfeiture**
and programme modification — to be clearly communicated and accepted through a
click-wrap mechanism.

`legal_documents` already carries `version`, `effective_date` and a
`requires_acceptance` flag, so the *shape* exists. **Nothing records that a given
customer accepted a given version**, and nothing gates ordering on it. Building
that is a schema change and a checkout-flow change; it is deliberately not in
this pull request, which adds no migration.

### Two things this draft must NOT promise, because the app does not do them

Review found both on #339, by checking the draft against the code rather than
against the feature descriptions. A legal document is the one place where a
plausible-sounding sentence is most expensive, so they are marked in the draft
itself rather than only noted here.

**1. There is no per-item "earns no points" label.** `products.earns_loyalty_points`
exists, and `place_order` honours it, but the flag reaches the admin console
only: the mobile product model and the catalog it is built from do not carry it,
so nothing marks an excluded item in the menu or the basket. Checkout shows one
aggregate figure — deliberately, since you asked for the total with no
breakdown. So the customer's actual disclosure today is "you will earn N
points", and a term promising a per-item label would be untrue. Either counsel
words it around the aggregate, or the flag has to reach the customer app first.

**2. Redemption is all-or-nothing, not an amount the customer picks.**
`LoyaltyToggle` is a boolean; when it is on, `CheckoutScreen` submits the entire
available balance and the server clamps it to the order value. There is no field
for choosing a point count. The draft now says "whether", not "how many".

What this means practically: publishing updated terms is enough for the changes
in §2 that only *narrow* how points are earned going forward. **It is probably
not enough for expiry**, which forfeits value a customer already holds. That is
counsel's call, not mine, and it is the reason expiry ships switched off.

---

## 6. Before flipping each switch

| Switch | Terms work needed first |
| --- | --- |
| `loyalty_pickup_only` (already default ON) | Publish §3 with the pickup-only lines. It is on by default, so this is due when the migration is applied |
| `products.earns_loyalty_points` → false on any item | Publish the "some items do not earn points" line before excluding the first item |
| A campaign multiplier | Publish the promotion line. Multipliers only ever increase earning, so this is the least urgent |
| `loyalty_expiry_enabled` | **Publish the expiry section AND resolve §5 with counsel.** Do not enable before both |

Correcting the two errors in §1 needs no switch at all and should not wait for
one.
