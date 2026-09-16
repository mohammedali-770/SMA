# Google Play listing copy — the text, and what each claim depends on

The published listing text, kept byte-accurate here, in the same shape as
[`../legal/OFFERS_LOYALTY_TERMS_DRAFT.md`](../legal/OFFERS_LOYALTY_TERMS_DRAFT.md)
keeps the loyalty terms. The submission procedure is
[`../PLAY_STORE_SUBMISSION.md`](../PLAY_STORE_SUBMISSION.md); this file is the
text and nothing else.

> **Status: drafted 2026-09-16, NOT yet entered in Play Console.**
>
> **The Arabic is engineering-drafted and has not had a native read.** The default
> listing language is Arabic, so it is the version most customers see. Read it
> before pasting.
>
> **Do not answer the "what must be true" column of the claims table from this
> file.** Re-read each value live at the moment of publication. The whole failure
> mode this table exists to prevent is a sentence that was true on the day it was
> drafted.

---

## The claims this copy makes, and what must be true for each

Every load-bearing sentence below is coupled to a live behaviour. A change to that
behaviour makes the published listing false, and a false factual claim in a store
listing is a policy matter rather than a typo — Play cross-checks the listing
against the Data Safety form and the privacy policy it links.

| ID | Appears in | The claim | What must be true | Decided by |
| --- | --- | --- | --- | --- |
| **C-PICKUP** | short ar/en · full ar/en · release notes | points are earned on **pickup** orders | `app_settings.loyalty_pickup_only` is true | `place_order` / `compute_order_snapshot`; [`../LOYALTY.md`](../LOYALTY.md) §2 |
| **C-CASH** | full ar/en · release notes | payment is **cash**, on pickup or delivery | no payment provider is selected; the freeze holds | CLAUDE.md §6 · PR #377 · [`../PAYMENT_POSTPONEMENT.md`](../PAYMENT_POSTPONEMENT.md) |
| **C-VAT** | full ar/en | displayed prices **include VAT** | prices are VAT-inclusive as rendered | `previewTotals.ts` · `TotalsCard.tsx` |
| **C-DELIVERY** | short ar/en · full ar/en | delivery is offered | delivery orders reach the POS | [`../LAZYWAIT.md`](../LAZYWAIT.md); live since 2026-08-27 |
| **C-EXPORT** | full ar/en | you can request a copy of your data | the export screen ships in the installed build | `export_my_data()` is applied; the **screen** needs the next EAS build |
| **C-NOPROMO** | *(absent by design)* | **no promo-code claim is made** | campaigns have no customer-facing UI | [`../DISCOUNTS_CAMPAIGNS.md`](../DISCOUNTS_CAMPAIGNS.md) · `GO_LIVE_READINESS.md` G6 |
| **C-NOBRANCH** | *(absent by design)* | **no branch count is stated** | the marketing site says 16; Production has **1 active** of 40 | live `branches` |

**C-EXPORT is the one to watch before publishing.** `export_my_data()` is applied
in Production, but the *Get a copy of my data* screen reaches customers only in
the next EAS build. If the build you ship does not carry it, delete that bullet
rather than shipping a listing that promises a screen the app does not have.

**The two absent claims are deliberate and are recorded so nobody "improves" the
copy by adding them.** A promo-code line would advertise a feature with no UI; a
branch count would be quoted back at you.

---

## App name

Play's App name field, maximum 30 characters, separate from `app.json`.

```
سبايسي ميل
```

```
Spicy Meal
```

---

## Short description — maximum 80 characters

```ar
اطلب من سبايسي ميل: استلام من الفرع أو توصيل، مع نقاط ولاء على الاستلام.
```
*72 characters.*

```en
Order from Spicy Meal: branch pickup or delivery, with points on every pickup.
```
*78 characters.*

---

## Full description — maximum 4000 characters

```ar
سبايسي ميل — دجاج مقرمش وسندويتشات ووجبات، من 1997.

اطلب من المنيو مباشرة من جوالك، واستلم من الفرع أو اطلب التوصيل إلى عنوانك.

الطلب
• تصفّح المنيو حسب الأقسام: وجبات، ساندويتش، أطباق جانبية، مشروبات وصوصات
• اختر الحجم أو النوع وأضف ملاحظتك على كل صنف
• أضف ملاحظة للمطبخ على الطلب كامل
• أسعار شاملة ضريبة القيمة المضافة، بدون مفاجآت عند الدفع

الاستلام والتوصيل
• استلام من الفرع، أو توصيل إلى أحد عناوينك المحفوظة
• حدّد عنوانك على الخريطة واحفظه للطلبات القادمة
• التطبيق يوضح حالة الفرع قبل أن تبدأ الطلب

متابعة الطلب
• إشعار فوري عند كل تغيّر في حالة طلبك: قيد التحضير، جاهز، في الطريق، تم التوصيل
• صفحة طلباتي تحفظ كل طلباتك السابقة مع الفاتورة التفصيلية

نقاط الولاء
• اجمع نقاطًا على طلبات الاستلام من الفرع
• استبدل نقاطك خصمًا مباشرًا عند إتمام الطلب
• رصيدك ظاهر دائمًا في ملفك الشخصي

تسجيل الدخول
• برقم جوالك عبر واتساب، برمز تحقق — بدون كلمة مرور تُنسى

الدفع
• نقدًا عند الاستلام من الفرع أو عند التوصيل

اللغة والمظهر
• التطبيق بالعربية والإنجليزية، ويدعم الوضع الفاتح والداكن

خصوصيتك
• تستطيع طلب نسخة من بياناتك أو حذف حسابك من داخل التطبيق
• سياسة الخصوصية والشروط متاحة في التطبيق وعلى https://app.spicymeal.com.sa/privacy

للتواصل: info@spicymeal.com.sa
```
*1195 characters.*

```en
Spicy Meal — crispy chicken, sandwiches and meals, since 1997.

Order straight from your phone and collect at the branch, or have it delivered to your door.

Ordering
• Browse the menu by section: meals, sandwiches, sides, drinks and sauces
• Choose a size or variant and add a note to any item
• Add a kitchen note for the whole order
• Prices include VAT — no surprises at checkout

Pickup and delivery
• Collect at the branch, or deliver to one of your saved addresses
• Drop a pin on the map and save the address for next time
• The app shows whether the branch is open before you start

Order tracking
• An instant notification at every status change: preparing, ready, on the way, delivered
• My Orders keeps every past order with its itemised invoice

Loyalty points
• Earn points on branch pickup orders
• Redeem them as a direct discount at checkout
• Your balance is always visible in your profile

Signing in
• With your mobile number over WhatsApp and a verification code — no password to forget

Payment
• Cash on pickup at the branch, or cash on delivery

Language and appearance
• Arabic and English, with light and dark themes

Your privacy
• Request a copy of your data, or delete your account, from inside the app
• Privacy policy and terms are in the app and at https://app.spicymeal.com.sa/privacy

Contact: info@spicymeal.com.sa
```
*1361 characters.*

---

## Release notes — maximum 500 characters per language

For the first release, `v1.0.0` versionCode 2.

```ar
الإصدار الأول من تطبيق سبايسي ميل.

• تصفّح المنيو واطلب استلامًا من الفرع أو توصيلًا إلى عنوانك
• تسجيل الدخول برقم جوالك عبر واتساب — بدون كلمة مرور
• تابع حالة طلبك خطوة بخطوة مع إشعارات فورية
• اجمع نقاط الولاء على طلبات الاستلام واستبدلها عند الدفع
• احفظ عناوينك وراجع فواتير طلباتك السابقة
• التطبيق بالعربية والإنجليزية

الدفع نقدًا عند الاستلام أو التوصيل.
```
*365 characters.*

```en
The first release of the Spicy Meal app.

• Browse the menu and order for branch pickup or delivery
• Sign in with your mobile number over WhatsApp — no password
• Follow your order step by step with instant notifications
• Earn loyalty points on pickup orders and redeem them at checkout
• Save your addresses and review past order invoices
• Available in Arabic and English

Pay cash on pickup or on delivery.
```
*411 characters.*

---

## What was deliberately not reused

`metadata.json` describes the monorepo and `index.html`'s title advertises the
POS — neither is customer-facing. The marketing site claims sixteen branches
where Production has one active. None of that text appears above, and none of it
should be pasted into the Console.
