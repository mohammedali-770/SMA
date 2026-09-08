# Offers & Loyalty Terms — engineering draft

**This is not legal advice and it is not binding wording.** It is a factual
description of what the code actually does, written so counsel can turn it into
terms and so the owner can see exactly which promises the current live text makes
that the system does not keep.

**Where the real document lives.** `public.legal_documents`, row
`offers_loyalty_terms`, edited in the admin console (Legal Documents). It is
**version 2.0, effective 18 August 2026, active** and visible to customers today.
Nothing in this file is live until somebody pastes it there — deliberately, since
that is a live data write and the owner's decision.

---

## 1. The live text is already wrong in two places

Found while drafting, and worth fixing regardless of whether any loyalty change
ships.

### "Points are added when the order is completed."

**They are not.** Points are granted when the order is **created** —
`place_order` writes the ledger row and updates the balance in the same
transaction that inserts the order, and the online path does the same inside
`insert_order_from_snapshot` immediately after payment. A customer sees the
points before the kitchen has started cooking.

This is not a quibble: the whole cancellation-reversal mechanism
(`20260810100000`) exists *because* points are granted early. A reader of the
current terms would not expect a reversal to be necessary at all.

### "points added to an order that is later cancelled or refunded are reversed"

**Approximately true for cancellation, and the approximation matters.**
`admin_set_order_status` on `cancelled`:

- reverses earned points **bounded by the balance that still exists**. If the
  customer has already spent them, the shortfall is *recorded* in the ledger and
  the balance is never taken negative — so the reversal can be partial;
- restores redeemed points **in full**, and deliberately after the clamp above,
  so points spent on a cancelled order can never be consumed to cover an
  earn-reversal shortfall.

**"refunded" is unverified.** Refund processing is disabled under the payment
freeze and no refund path touches loyalty today. The terms promise behaviour that
has never run.

---

## 2. What each shipped change adds, if and when it is switched on

None of this is live yet: four migrations are written and unapplied, and each
feature defaults to today's behaviour. **The terms must be updated before the
corresponding switch is flipped, not after.**

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
- Some items do not earn points. Where that applies it is shown with the item.
- Points are earned on pickup orders only. A delivery order does not earn points.
- If you use a discount or spend points on an order, the points you earn are
  calculated on what you actually pay for the eligible items.

During a promotion we may multiply the points an order earns. Where a promotion
applies, the multiplied amount is the amount added.

REDEEMING POINTS
Points are redeemed as a discount at checkout. At the time of writing each point
is worth [0.10] SAR, and you need at least [100] points before you can redeem.

Points can be spent on pickup orders only.

You choose how many points to use on an order. The discount is applied to the
order total by our system, and the amounts confirmed at checkout are final.

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
- بعض الأصناف لا تمنح نقاطاً، ويظهر ذلك مع الصنف.
- تُكتسب النقاط على طلبات الاستلام فقط، ولا تمنح طلبات التوصيل نقاطاً.
- عند استخدام خصم أو استبدال نقاط، تُحتسب النقاط على ما تدفعه فعلياً مقابل
  الأصناف المؤهلة.

خلال العروض قد نضاعف النقاط الممنوحة على الطلب، وتُضاف القيمة بعد المضاعفة.

استبدال النقاط
تُستبدل النقاط كخصم عند الدفع. حالياً قيمة كل نقطة [٠٫١٠] ريال، ويلزم [١٠٠] نقطة
على الأقل للاستبدال.

يمكن استخدام النقاط في طلبات الاستلام فقط.

أنت تختار عدد النقاط المستخدمة، ويطبّق النظام الخصم على إجمالي الطلب، والمبالغ
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
