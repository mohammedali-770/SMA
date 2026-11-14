# Store answers for card payment through Moyasar (draft)

> **Status: DRAFT, engineering-written 2026-11-13, revised the same day against
> its fact-check (`docs/readiness/20261113-card-payments-reviews/store_answers.review.md`), then re-checked the same
> evening by an independent checker against the code, the live rows and the
> sibling drafts as they stood at 22:42 UTC (the "re-check:" lines in the "Fix
> log" at the end). Nothing here has been entered in App Store Connect or Play
> Console, and nothing is published.** Entering these answers, publishing the
> listing and sending the review notes are owner steps.
>
> **Publishing plan (proposed; the owner decides).** `privacy_policy`, `payment_policy`,
> `cancellation_refund_policy` and `terms_conditions` are published
> **together**, in **both languages**, in **one** owner-approved session, before
> `docs/OWNER_ACTIONS.md` §47.18 (online payment on). No document goes out on
> its own, early, or in one language first. The store answers and the listing
> copy in this file change in the **same window**: the two privacy forms once the
> four documents are live and the public legal page has been rebuilt, still
> before §47.18; every text that tells customers card payment is available (the
> listing, the release notes, the TestFlight description, the App Store lines)
> once §47.18 has ended with card payment still on: its step 1 switched it on,
> its step 2 device checks have passed, and so has a check of which methods the
> page offers (C-CARD needs it, and it cannot run before the switch). That check
> is not yet one of §47.18 step 2's checks, nor in `RELEASE_CHECKLIST.md` §7, so
> it has to be added there first ("Knock-on edits in other records"). The App
> Review notes follow the switch's state when a build is
> submitted (3.5). The order inside the window is
> "Open owner decisions", item 6. Until all four documents change, each live one
> says card payment is not available (quoted under "Current (live) text").
>
> **The Arabic needs a native read.** It is engineering-drafted Modern Standard
> Arabic, written to match the register of the Arabic already in each record. Each
> record keeps its own spelling: the listing writes «نقدًا», the TestFlight text
> «نقداً». Every Arabic string is listed under "Open owner decisions", item 12.
>
> **Scope.** Only what card payment requires. Every other line of the three
> records stays as it is. Every answer that is the owner's choice is marked
> **[OWNER DECISION]**.
>
> **Read with** `docs/legal/PRIVACY_POLICY_CARD_PAYMENTS_DRAFT.md` (the privacy policy version that names
> Moyasar: 2.4 or 3.0, one owner decision for the four documents),
> `docs/legal/PAYMENT_POLICY_CARD_PAYMENTS_DRAFT.md`, `docs/legal/CANCELLATION_REFUND_POLICY_CARD_PAYMENTS_DRAFT.md` and
> `docs/legal/TERMS_CONDITIONS_CARD_PAYMENTS_DRAFT.md` (the Terms' PAYMENT clause, written in parallel).
> Apple and Google both read the published privacy policy beside these forms, so
> the forms below declare the same payment fields that the privacy draft lists.
>
> No secret was read or printed. Every live read below is read-only SQL; the
> drafter's last one, at 22:08 UTC on 2026-11-13, found the same state as the
> first, and the independent re-check read it again at 22:44 UTC, unchanged.

---

## Current (live) text

**What "live" means for these records.** None of them has a version number or a
database row. They are files on the default branch, read from the export at
the default branch at `04eb351` on 2026-11-13, and the consoles are filled from them by hand.
Console state cannot be read from here. What the records say about it:

| Record | Console state, as the record states it |
| --- | --- |
| Play listing (`docs/store/LISTING_COPY.md`) | "drafted 2026-09-16, NOT yet entered in Play Console" |
| Play Data safety (`docs/PLAY_STORE_SUBMISSION.md` §6, §6a) | answered in the Console 2026-09-16 |
| Apple App Privacy (`docs/APP_STORE_SUBMISSION.md` §4) | derived 2026-09-16, not yet entered (`GO_LIVE_READINESS.md` B3) |
| TestFlight test information (`APP_STORE_SUBMISSION.md` §6) | paste-ready; whether it was pasted is not recorded |
| App Review notes (`APP_STORE_SUBMISSION.md` §11) | drafted 2026-11-10; not recorded as submitted |

**The versioned documents these answers must agree with**, read live
(`public.legal_documents`, `is_active`), 2026-11-13:

| `document_type` | version | effective | `md5(content_en)` | `md5(content_ar)` |
| --- | --- | --- | --- | --- |
| `privacy_policy` | 2.3 | 2026-09-16 | `d3e760c5dc2823e6115003d23bcc0798` | `d2acff9656d3afa072feddb76947d226` |
| `payment_policy` | 2.0 | 2026-08-18 | `0f883dcd595250c2a6139d267a55008c` | `44e5b1f44f5a6ae8bb72e53eb9daefe9` |
| `cancellation_refund_policy` | 2.0 | 2026-08-18 | `5a67d9d5cbd95ecde3ce0b176553f252` | `91607002c901986d33deb285a2c2d03b` |
| `terms_conditions` | 2.0 | 2026-08-18 | `0da664333b24808294b771f436272c02` | `bcd2dc7af623a2b28b031e1a861d04c9` |

All four still tell customers that card payment is not available (read live
2026-11-13; English quoted, the Arabic says the same):

- `terms_conditions` 2.0, PAYMENT: "Orders are paid in cash at pickup or on
  delivery. See the Payment Policy." / «تُدفع الطلبات نقداً عند الاستلام أو عند
  التوصيل. انظر سياسة الدفع.»;
- `payment_policy` 2.0: "Online card payment is not currently available in the
  app.";
- `cancellation_refund_policy` 2.0: "Online card payment is not available in the
  app.";
- `privacy_policy` 2.3: "Online card payment is not available."

**The switches, read live 2026-11-13:** `online_payment_enabled` **false**,
`cash_payment_enabled` **true**, `default_payment_method` `cash`,
`payment_outage_mode_enabled` false. The payment row is provider `moyasar`,
**enabled**, mode **`test`**, invoice expiry (`public_config.invoice_expiry_minutes`)
**30** minutes, last written 2026-11-13 18:17:02 UTC; re-read at 22:08 UTC and
at 22:44 UTC, unchanged, and again on 2026-11-14. *Note:* the row was enabled
at 18:17 UTC on 2026-11-13, still in TEST mode, for the sandbox (`PAYMENTS.md`
§1 and `GO_LIVE_READINESS.md` G1 now say so). Customer checkout is still refused
in TEST mode (`supabase/functions/payment-initiate/index.ts:418`, `:495`), so
every "current" text below is still true today.

### A. Play listing: `docs/store/LISTING_COPY.md`

**A1. The claim row.**

`docs/store/LISTING_COPY.md:29-30`

````markdown
| ID | Appears in | The claim | What must be true | Decided by |
| --- | --- | --- | --- | --- |
````

`docs/store/LISTING_COPY.md:32`

````markdown
| **C-CASH** | full ar/en · release notes | payment is **cash**, on pickup or delivery | `app_settings.online_payment_enabled` is false. *Changed 2026-11-11: this column said "no payment provider is selected; the freeze holds". The owner chose Moyasar that day, so only the switch keeps this claim true* | CLAUDE.md §6 · PR #377 · [`../OWNER_ACTIONS.md`](../OWNER_ACTIONS.md) §47 |
````

**A2. The paragraph under the claims table.**

`docs/store/LISTING_COPY.md:39-45`

````markdown
**C-CASH becomes false the day online payment is switched on.** On 2026-11-11 the
owner chose Moyasar as the payment provider, and on the branch
`feat/moyasar-only-20261111` the app can take a card through Moyasar's page. The
switch was off on 2026-11-11 (read-only), so the copy below is still true and is
**not changed here**. Before online payment is switched on
(`OWNER_ACTIONS.md` §47.15 and §47.18), rewrite the "Payment" lines in both
languages and in the release notes, and publish the new listing.
````

**A3. Full description, the Payment section.** English, inside the block at lines
130-169, recorded as *1361 characters* (line 170):

`docs/store/LISTING_COPY.md:158-159`

````markdown
Payment
• Cash on pickup at the branch, or cash on delivery
````

Arabic, inside the block at lines 88-127, recorded as *1195 characters* (line 128):

`docs/store/LISTING_COPY.md:116-117`

````markdown
الدفع
• نقدًا عند الاستلام من الفرع أو عند التوصيل
````

**A4. Release notes, first release (`v1.0.0` versionCode 2), the last line.**
English, recorded as *411 characters* (line 204):

`docs/store/LISTING_COPY.md:202`

````markdown
Pay cash on pickup or on delivery.
````

Arabic, recorded as *365 characters* (line 190):

`docs/store/LISTING_COPY.md:188`

````markdown
الدفع نقدًا عند الاستلام أو التوصيل.
````

### B. Play Console answers: `docs/PLAY_STORE_SUBMISSION.md`

**B1. §6, the Data safety table: its header and the two rows that change.**

`docs/PLAY_STORE_SUBMISSION.md:465-466`

````markdown
| Play data type | Collected | Leaves our systems to | Purpose | Evidence |
| --- | --- | --- | --- | --- |
````

`docs/PLAY_STORE_SUBMISSION.md:473`

````markdown
| Purchase history | Yes | POS | App functionality | `orders`, `order_items` |
````

`docs/PLAY_STORE_SUBMISSION.md:479`

````markdown
| **Payment info** | **NO** | — | — | Launch is cash-only; no card number, expiry or CVV is ever collected or stored. `payment_method` records *how*, not an instrument. **True only while online payment is off — owner decision pending, see §6b** |
````

**B2. §6b, in full.**

`docs/PLAY_STORE_SUBMISSION.md:548-576`

````markdown
### 6b. Card payment through Moyasar — OWNER DECISION PENDING, before online payment is switched on

**Added 2026-11-12. No answer in §6 is changed here.** They are true while online
payment is off, which it was on 2026-11-11 (read-only). On 2026-11-11 the owner
chose Moyasar as the payment provider (CLAUDE.md §6). Before online payment is
switched on (`OWNER_ACTIONS.md` §47.18), the owner re-decides:

- **Financial info → Payment info**, now "NO";
- **Financial info → Purchase history**, where the table records `orders`;
- **App content → Financial features**, which §9 already says changes again the
  day online payment is enabled.

The facts, read from the code on 2026-11-12:

- the customer types the card details on **Moyasar's hosted page**, shown inside
  the app's own payment screen (a WebView). The app's code never reads the card
  number, expiry or CVV;
- after a payment our server stores, linked to the order: card scheme, the
  **last four digits**, issuer name and country, and the authorisation code
  (`payment_records`; `sanitizeMoyasarPayment` in
  `supabase/functions/_shared/moyasar.ts`). The card number and any token are
  never stored;
- our server sends Moyasar the amount, the currency, the fixed text "Spicy Meal
  order", two opaque references and the return addresses. No name, phone number
  or email (`RECORD_OF_PROCESSING.md` activity 15). Moyasar is a new recipient
  for the "Shared" column.

Whether that is "Payment info" collected by this app, and whether it is shared,
is the owner's call against Google's definitions on the day.
````

**B3. §6a, the two rows that change.**

`docs/PLAY_STORE_SUBMISSION.md:582-583`

````markdown
| Does your app collect or share any of the required user data types? | **Yes** | The table above; eleven types are collected |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | Everything is HTTPS to Supabase; no cleartext path exists, and the AAB carries no `android:usesCleartextTraffic` |
````

**B4. §9, the Financial features row and its coupling paragraph.**

`docs/PLAY_STORE_SUBMISSION.md:748`

````markdown
| **Financial features** | **Rewards, points, frequent flier miles, and other incentives** | See below — this was answered wrongly first |
````

`docs/PLAY_STORE_SUBMISSION.md:770-774`

````markdown
**This declaration is coupled to loyalty.** If loyalty is ever removed, this
answer changes. If online payment is ever enabled, a *second* financial feature
applies and this answer changes again — see the coupling table in §11.
**2026-11-11: the provider is chosen (Moyasar)**, so this is now a step before
online payment is switched on (§6b, `OWNER_ACTIONS.md` §47.15).
````

### C. App Store Connect answers: `docs/APP_STORE_SUBMISSION.md`

**C1. §4, the table header, the row that changes, and the closing line.**

`docs/APP_STORE_SUBMISSION.md:388-389`

````markdown
| Apple category | Type | Collected | Linked to You | Why / evidence |
| --- | --- | --- | --- | --- |
````

`docs/APP_STORE_SUBMISSION.md:398`

````markdown
| Purchases | Purchase History | Yes | **Linked** | `orders`, `order_items`. **No payment instrument** — launch is cash-only; `payment_method` records *how*, not a card. **True only while online payment is off — see "Card payment through Moyasar" below** |
````

`docs/APP_STORE_SUBMISSION.md:403-404`

````markdown
**Financial Info: NO. Health & Fitness: NO. Browsing History: NO. Search History:
NO. Sensitive Info: NO. Contacts: NO.**
````

**C2. §4, "Card payment through Moyasar", in full.**

`docs/APP_STORE_SUBMISSION.md:406-434`

````markdown
### Card payment through Moyasar — OWNER DECISION PENDING, before online payment is switched on

**Added 2026-11-12. The answers above are not changed here.** They are true while
online payment is off, which it was on 2026-11-11 (read-only). On 2026-11-11 the
owner chose Moyasar as the payment provider (CLAUDE.md §6). The day online payment
is switched on (`OWNER_ACTIONS.md` §47.18), two answers need re-deciding by the
owner, and a submission that declares them must go first:

- **Financial Info → Payment Info**, now "NO";
- **Purchases → Purchase History**, whose note says "no payment instrument".

The facts the decision rests on, read from the code on 2026-11-12:

- the customer types the card details on **Moyasar's hosted page**, which the
  app shows inside its own payment screen (a WebView). The app's code never reads
  the card number, expiry or CVV, and sends none of them anywhere;
- Apple Pay, where it works, is offered by that same Moyasar page;
- after a payment, our server stores what Moyasar returns about it, linked to the
  order and so to the account: card scheme, the **last four digits**, issuer name
  and country, and the authorisation code (`payment_records`;
  `sanitizeMoyasarPayment` in `supabase/functions/_shared/moyasar.ts`). The card
  number and any token are never stored;
- what our server sends Moyasar is the amount, the currency, the fixed text
  "Spicy Meal order", two opaque references and the return addresses. No name,
  phone number or email (`RECORD_OF_PROCESSING.md` activity 15).

Whether a card entered on a payment provider's page inside the app, plus a stored
last four, counts as "Payment Info" collected by this app is the owner's call.
Read Apple's own definitions on the day, rather than this paragraph.
````

**C3. §4, the line naming the privacy policy.**

`docs/APP_STORE_SUBMISSION.md:463-466`

````markdown
**These must agree with C5 / the Play Data Safety form.** They are the same facts
in two shapes, and Apple and Google both cross-check a published privacy policy
against the declared form. The policy is `privacy_policy` v2.3
(`OWNER_ACTIONS.md` §34).
````

**C4. §6, TestFlight beta app description, English and Arabic, and the note between them.**

`docs/APP_STORE_SUBMISSION.md:562-580`

````markdown
**Beta app description (EN)**

> Spicy Meal is the ordering app for a Saudi restaurant. Browse the menu, build
> an order with add-ons and variants, choose pickup or delivery, place the order
> and follow it through preparation to collection or dispatch. Payment at launch
> is cash on collection or delivery — no card is taken in the app. Prices include
> VAT. Loyalty points are earned and redeemed on pickup orders only.

*Both descriptions say no card is taken in the app. That is true while online
payment is off, and must change before it is switched on (`OWNER_ACTIONS.md`
§47.15).*

**Beta app description (AR)** *(engineering-drafted, no native read — §29)*

> سبايسي ميل هو تطبيق الطلب لمطعم سعودي. تصفّح القائمة، وكوّن طلبك مع الإضافات
> والأحجام، واختر الاستلام أو التوصيل، ثم أرسل الطلب وتابعه حتى التحضير والاستلام
> أو الانطلاق. الدفع عند الإطلاق نقداً عند الاستلام أو التوصيل — لا تُؤخذ أي بطاقة
> داخل التطبيق. الأسعار شاملة ضريبة القيمة المضافة. تُكتسب نقاط الولاء وتُستبدل في
> طلبات الاستلام فقط.
````

**C5. §11, the table row and the paste-ready review notes.**

`docs/APP_STORE_SUBMISSION.md:898`

````markdown
| **Card payment at checkout** | `app_settings.online_payment_enabled` | **off** | A card option beside cash, through Moyasar. **Dormant.** *Changed 2026-11-11: this said turning it on was under the payment freeze.* The provider is now Moyasar; turning it on is the last of the ordered owner steps in `OWNER_ACTIONS.md` §47, each its own approval |
````

`docs/APP_STORE_SUBMISSION.md:911-937`

````markdown
**Paste-ready notes (English).** Adjust any line whose switch reads differently on
the day:

```text
Spicy Meal is the ordering app for Spicy Meal restaurants in Saudi Arabia.
Customers browse the menu, order for pickup or delivery, and pay in cash when
they collect or receive the order.

Some features are switched on or off from our server without an app update.
At the time of this submission:
- Card payment: the app contains a card-payment option at checkout. It is
  switched OFF, and no customer can use it. Customers pay cash.
- Loyalty points: ON, earned and redeemed on pickup orders. Points do not
  expire; expiry is switched off.
- Availability: a branch can mark an item, or one size of an item, as
  unavailable, and can pause delivery for a while.
- Support: the phone, WhatsApp and email contacts in Profile can each be shown
  or hidden.
- Complimentary orders: a small number of accounts we choose can receive orders
  at no charge.

Sign-in is by a one-time code sent to the customer's WhatsApp. Reviewer access
is described under Sign-In Information.

Push notifications carry order updates and occasional offers. Offers can be
turned off in Profile > Notifications.
```
````

---

## Proposed text

Wherever a record is bilingual, its English and Arabic are shown one after the
other below, and both languages go out together: neither is entered or
published before the other. The Play listing, the release notes and the
TestFlight description are bilingual. The claims table, the two privacy forms
and the App Review notes are English-only, as they are today.

Dates of decisions are left as `[OWNER DECISION: date]`, because the decisions
have not been taken.

### 1. Play listing: `docs/store/LISTING_COPY.md`

**1.1 Claims table.** Replaces the C-CASH row with two rows. The other rows are
unchanged.

```markdown
| **C-CASH** | full ar/en · release notes | **cash** on pickup or delivery is offered | `app_settings.cash_payment_enabled` is true. *Changed [OWNER DECISION: date of publication]: until card payment was switched on, this claim was "payment is **cash**" and needed `online_payment_enabled` to be false* | `place_order` · `apps/mobile/src/lib/payment.ts:50-54` · [`../OWNER_ACTIONS.md`](../OWNER_ACTIONS.md) §47 |
| **C-CARD** | full ar/en · release notes | **card payment in the app**: mada, Visa or Mastercard, on Moyasar's secure page | all six: `app_settings.online_payment_enabled` is true; the payment row is `moyasar`, enabled, mode `live` (customer checkout is refused in TEST mode); the **Test connection in LIVE mode reads "Connection OK"** (`OWNER_ACTIONS.md` §47.13: live secret key and live webhook token saved, `MOYASAR_PROXY_URL` set, the proxy's IPs on Moyasar's Allowed IPs; without the key or the token checkout answers "Online payment is not available", and the console switch checks neither, §47.14); the live hosted page, **seen on a device**, offers mada, Visa and Mastercard, and Moyasar has confirmed in writing that SADAD, STC Pay and any scheme not named here are off for invoices (`OWNER_ACTIONS.md` §47.19); `terms_conditions`, `payment_policy`, `cancellation_refund_policy` and `privacy_policy` each have a **published version, in both languages, that describes card payment**, and the public legal page has been rebuilt to serve them; the build customers install has the in-app payment screen (`OWNER_ACTIONS.md` §47.17; older builds open Moyasar's page in the system browser). **Apple Pay is not claimed on Play**: the app offers it only on iPhone | `apps/mobile/src/lib/payment.ts:45-54` · `supabase/functions/payment-initiate/index.ts:414-418`, `:491-495` · `supabase/functions/_shared/moyasar.ts:264-269` · [`../PAYMENTS.md`](../PAYMENTS.md) §3, §5, §8 · [`../OWNER_ACTIONS.md`](../OWNER_ACTIONS.md) §47.13-§47.15, §47.17-§47.19 |
```

**1.2 The paragraph under the claims table.** Replaces "C-CASH becomes false the
day online payment is switched on…" in full.

```markdown
**C-CARD is true only while card payment is live, and C-CASH only while cash is
on.** Both are server switches, and the listing has to move with them. Card
payment needs `online_payment_enabled` **and** an enabled Moyasar row in live
mode whose LIVE Test connection reads "Connection OK" (`OWNER_ACTIONS.md`
§47.13), and it is one global setting (`OWNER_ACTIONS.md` §47.18). The listing
also sends readers to the "terms", so `terms_conditions`, `payment_policy`,
`cancellation_refund_policy` and `privacy_policy` must first be published
together, in both languages, in one session before `OWNER_ACTIONS.md` §47.18,
with the public legal page rebuilt to serve them. **Publish in this order,
inside that one window: the four documents and the rebuild, then §47.18 step 1
switches card payment on, then, once §47.18 has ended with it still on (its
step 2 device checks passed, and a check of which methods the page offers,
which must first be added to §47.18 step 2 and `RELEASE_CHECKLIST.md` §7, gap
PG-11), submit this listing** [OWNER DECISION]. Not straight after step 1:
C-CARD needs that device check, which cannot run before the switch, and a
listing already submitted when step 2 or 3 fails would advertise a switched-off
option for as long as Play takes to publish the correction. If Play
holds the listing change for review, the listing says less than the app does in
the meantime, which misleads nobody. The other order advertises a payment option
that no customer can use. If card payment is switched off again, including under
§47.18's "If anything fails, switch Online Payment off", take the C-CARD line
out of both languages of the listing, and leave it out of the next release's
notes: notes already published stay attached to their release. **Apple Pay stays
out of this listing:** Play is Android, and the app offers Apple Pay only on
iPhone.
```

**1.3 Full description, English: complete, ready to paste.** One line is added,
the second bullet under "Payment". Every other line is byte-identical to the
current block.

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
• Or pay online in the app with mada, Visa or Mastercard, on Moyasar's secure page

Language and appearance
• Arabic and English, with light and dark themes

Your privacy
• Request a copy of your data, or delete your account, from inside the app
• Privacy policy and terms are in the app and at https://app.spicymeal.com.sa/privacy

Contact: info@spicymeal.com.sa
```
*1432 characters* (limit 4000). The current block measures 1349 by the same method; see "Claims the drafter could not verify", item 9.

**1.4 Full description, Arabic: complete, ready to paste.** One line is added, the
second bullet under «الدفع». Every other line is byte-identical to the current
block.

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
• أو إلكترونيًا داخل التطبيق ببطاقة مدى أو Visa أو Mastercard، عبر صفحة Moyasar الآمنة

اللغة والمظهر
• التطبيق بالعربية والإنجليزية، ويدعم الوضع الفاتح والداكن

خصوصيتك
• تستطيع طلب نسخة من بياناتك أو حذف حسابك من داخل التطبيق
• سياسة الخصوصية والشروط متاحة في التطبيق وعلى https://app.spicymeal.com.sa/privacy

للتواصل: info@spicymeal.com.sa
```
*1270 characters* (limit 4000). The current block measures 1183.

**1.5 Release notes.** Two variants, because release notes stay attached to their
release while card payment is a server switch [OWNER DECISION: which applies].

**Variant A, the first public release, when card payment is already on as it
reaches users.** Only the last line changes; the six bullets above it stay. The
heading above the notes in `LISTING_COPY.md` names `v1.0.0` versionCode 2; the
build that carries the in-app payment screen will have a higher versionCode, so
name the one actually released.

```en
The first release of the Spicy Meal app.

• Browse the menu and order for branch pickup or delivery
• Sign in with your mobile number over WhatsApp — no password
• Follow your order step by step with instant notifications
• Earn loyalty points on pickup orders and redeem them at checkout
• Save your addresses and review past order invoices
• Available in Arabic and English

Pay cash on pickup or on delivery, or pay online in the app with mada, Visa or Mastercard.
```
*467 characters* (limit 500; current 411).

```ar
الإصدار الأول من تطبيق سبايسي ميل.

• تصفّح المنيو واطلب استلامًا من الفرع أو توصيلًا إلى عنوانك
• تسجيل الدخول برقم جوالك عبر واتساب — بدون كلمة مرور
• تابع حالة طلبك خطوة بخطوة مع إشعارات فورية
• اجمع نقاط الولاء على طلبات الاستلام واستبدلها عند الدفع
• احفظ عناوينك وراجع فواتير طلباتك السابقة
• التطبيق بالعربية والإنجليزية

الدفع نقدًا عند الاستلام أو التوصيل، أو إلكترونيًا داخل التطبيق ببطاقة مدى أو Visa أو Mastercard.
```
*426 characters* (limit 500; current 365).

If card payment is still off when the first release reaches users, keep the
current last line in both languages, unchanged.

**Variant B, a later release that reaches users after card payment is switched
on.** Use it only then: a release that goes out before the switch should say
nothing about card payment.

```en
• New: pay online in the app with mada, Visa or Mastercard, on Moyasar's secure page
• Cash on pickup or on delivery is still available
```
*135 characters.*

```ar
• جديد: ادفع إلكترونيًا داخل التطبيق ببطاقة مدى أو Visa أو Mastercard، عبر صفحة Moyasar الآمنة
• الدفع نقدًا عند الاستلام أو التوصيل ما زال متاحًا
```
*146 characters.*

### 2. Play Console: `docs/PLAY_STORE_SUBMISSION.md`

**2.1 §6, the Data safety table.** Two rows replaced. The row is renamed to the
Console's own term: Google renamed "Credit card, debit card, or bank account
number" to **"User payment info"**.

```markdown
| Purchase history | Yes | POS, **Moyasar** | App functionality | `orders`, `order_items`, and for an online payment `payment_records`. **Moyasar** receives, for each online payment, the amount, the currency, the fixed text "Spicy Meal order", an expiry, two opaque references (`sm_…`, and `ORD-` or `CS-` plus 12 hex digits of the order or checkout-session id) and the return addresses, which carry that order or session id (`buildInvoicePayload`, `supabase/functions/_shared/moyasar.ts:336-354`, called at `supabase/functions/payment-initiate/index.ts:258-268`), and the app's language, as `lang` on the page address the app opens (`moyasar.ts:384`). **No name, phone number, email or address is sent.** Once a payment is confirmed, the **POS** also receives the paid amount and Moyasar's payment id (`supabase/functions/_shared/paymentSync.ts:62-74`, called at `moyasarVerify.ts:485-487`), never card details. *Changed [OWNER DECISION: date]: Moyasar added* |
| **User payment info** | **Yes, REQUIRED** [OWNER DECISION: Required is what the code makes true today; Optional only if the card path gets the cash path's checks first, product gap PG-17] | — | App functionality | *Changed [OWNER DECISION: date] from "NO".* After each card or Apple Pay payment attempt, a declined one included, our server fetches the payment from Moyasar and keeps part of it on the **payment record**: the payment type (card or Apple Pay), card scheme, the **last four digits**, issuer name and country, Moyasar's result message (the reason, for a declined card), and the authorisation, reference and response codes (`payment_records.card_scheme`, `.card_last_four`, `.raw`; `sanitizeMoyasarPayment`, `supabase/functions/_shared/moyasar.ts:742-768`; `moyasarVerify.ts:306-310`, `:332-333`, `:524`). That record is linked to the order or, for a payment that completed no order (a declined card, for example), to the checkout session and so to the account (`payment_records.checkout_session_id` and `checkout_sessions.customer_id`, both `ON DELETE CASCADE`, read live 2026-11-13). **Never the full card number, expiry or CVV:** the customer types them on Moyasar's hosted page, which the app opens in its payment screen but does not control (it injects no script, `apps/mobile/src/app/payment/checkout.tsx:173-175`). Moyasar's payment object also carries the masked number's first six digits, the name on the card, a token and the payer's IP address; the sanitizer drops them and keeps only the last four digits (`moyasar.ts:726-740`; test "drops the BIN, the token, the name and the payer IP", `moyasar.test.ts:647-676`). **Required, not optional:** cash is offered beside card (`cash_payment_enabled`, true on 2026-11-13), but the card path skips the phone-verified check and the open-order and hourly limits that the cash path enforces, so a customer those checks refuse can order only by card (live: `begin_checkout_session` has neither check, `place_customer_order` has both; `supabase/migrations/20261005120000_server_input_bounds.sql:60-69`). Not processed ephemerally: it is stored. Reasoning: §6b |
```

**2.2 §6a.** The first row's "Why" cell, and the encryption row's "Why" cell.

```markdown
| Does your app collect or share any of the required user data types? | **Yes** | The table above. *Changed [OWNER DECISION: date]: User payment info is now collected* |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | Everything is HTTPS to Supabase; no cleartext path exists, and the AAB carries no `android:usesCleartextTraffic`. **Card payment adds two paths, and both are TLS** (*added [OWNER DECISION: date]*): the payment screen loads only `https` (`apps/mobile/src/features/checkout/webviewPolicy.ts:86-89`), and the server hands it only `https` pages on `moyasar.com` (`supabase/functions/_shared/moyasar.ts:373-386`). When `MOYASAR_PROXY_URL` is set, which live mode requires, the server's calls to Moyasar go through the static-IP proxy as a CONNECT tunnel, so the proxy relays TLS it cannot read (`supabase/functions/_shared/moyasarHttp.ts:20-32`). Whether hosted Supabase supports that route is proven only by the LIVE Test connection (`OWNER_ACTIONS.md` §47.13); a proxy that is set but cannot be used refuses the request rather than sending it another way (`moyasarHttp.ts:35-37`), so the answer stays Yes either way |
```

**2.3 §6b.** Replaced in full.

```markdown
### 6b. Card payment through Moyasar — decided [OWNER DECISION: date]

**Decided by the owner on [OWNER DECISION: date].** Enter these before online
payment is switched on (`OWNER_ACTIONS.md` §47.15, before §47.18), and only once
the privacy policy that names Moyasar is published with the other three
documents that describe card payment and the public legal page has been rebuilt
to serve it. Until the switch, the form over-discloses, which this file treats
as the safe direction.

| Console question | Answer | Why |
| --- | --- | --- |
| Financial info → **User payment info**: collected? | **Yes** [OWNER DECISION: Yes recommended] | Below |
| … shared? | **No** [OWNER DECISION: No recommended] | No payment details leave our systems. Moyasar is their source, and the POS receives only the amount and Moyasar's payment id |
| … processed ephemerally? | **No** | A fact, not a choice: it is stored on the payment record (§6) |
| … required or optional? | **Required** [OWNER DECISION: Required is what the code makes true today. If the card path gets the cash path's phone-verified check and order limits before go-live (product gap PG-17), answer **Optional** while cash is offered] | Cash is offered beside card (`apps/mobile/src/lib/payment.ts:50-54`; `cash_payment_enabled` true on 2026-11-13), but Google allows optional collection "only if all users – regardless of device or region – can either optionally provide information, opt-out, or opt-in to have the data collected". A customer who is not phone-verified, or who has reached the open-order or hourly limit, is refused in cash and can still order by card (§6), so not every user can avoid it. It stays **Required** if cash is ever switched off |
| … why is it collected? | **App functionality** [OWNER DECISION: add *Fraud prevention, security, and compliance* only once payment records are kept as financial records; today deleting the account deletes them (product gap PG-06)] | So staff can see which card paid an order: the console shows the card scheme and last four on the order (`src/components/admin/view/orders/PaymentDetails.tsx:91`), for reconciliation and customer support. Confirming and refunding do not use these fields: confirmation binds on Moyasar's invoice id, the amount and the currency (`moyasar.ts:900-920`), and a refund uses Moyasar's payment id |
| Financial info → Purchase history | **Unchanged: Yes, App functionality** | Moyasar added to "Leaves our systems to" in §6 |
| App content → Financial features | **Unchanged** [OWNER DECISION] | §9 |

**Why User payment info is declared although Moyasar collects the card.**
Google's FAQ exempts what a payment service collects, "such as a credit card
number", if "Your app never accesses this information" and "The payment service
collects this information directly from the user, and collection is governed by
that service's terms". Both hold for the card number. The app opens Moyasar's
page but does not control it, and Google counts a webview's data only "if your
app is in control of the code/behavior delivered through that webview". But the
same answer goes on: "You should also consider whether your app collects other
financial information, like purchase history, and whether your app receives any
relevant data from the payments service". Ours does: it keeps the card scheme,
last four digits and issuer, and drops the rest of what it receives, the masked
number's first six digits and the name on the card included (§6). Google's
definition of User payment info is
"Information about a user's financial accounts such as credit card number".
Declaring it is the safe direction, and it matches the privacy policy that names
Moyasar, which lists the same fields.

**The "Shared" column for Moyasar stays with the owner and counsel, as it does for
every vendor in §6.** Moyasar receives purchase data: the amount, the currency,
the fixed text "Spicy Meal order", the time the page expires, two opaque
references, return addresses that carry the order or checkout-session id, and the
app's language (§6, Purchase history). Two of Google's exceptions plausibly
apply. One is a service provider,
"an entity that processes user data on behalf of the developer and based on the
developer's instructions". The other is a transfer "based on a specific
user-initiated action, where the user reasonably expects the data to be shared":
the customer chose to pay online. Which one holds depends on the Moyasar
agreement. Under-disclosing is the dangerous direction.

**Encrypted in transit stays Yes** (§6a).

Google's text was read on 2026-11-13 from
[answer 10787469](https://support.google.com/googleplay/android-developer/answer/10787469).
```

**2.4 §9.** The Financial features row stays as it is. Its coupling paragraph is
replaced in full.

```markdown
**This declaration is coupled to loyalty.** If loyalty is ever removed, this
answer changes. **Card payment does not add a second financial feature, on the
reading recommended here** [OWNER DECISION]. The list's payment entries are
*Mobile payments and digital wallets* and *Money transfer and wire services*
([answer 13849271](https://support.google.com/googleplay/android-developer/answer/13849271)),
and Google's Financial Services policy defines its subject as products and
services "related to the management or investment of money"
([answer 9876821](https://support.google.com/googleplay/android-developer/answer/9876821)).
A restaurant that takes a card for its own food through a payment provider holds
no balance, stores no card and moves no money between people. *Changed
[OWNER DECISION: date]: this paragraph said that enabling online payment adds a
second financial feature.* If you prefer the conservative direction and want to
tick *Mobile payments and digital wallets* as well, first check whether that
brings the organization-account requirement. Google requires an organization
developer account to provide "Financial products and services, including
banking, loans, stock trading, investment funds, cryptocurrency software
wallets, and cryptocurrency exchanges"
([answer 13634885](https://support.google.com/googleplay/android-developer/answer/13634885)),
and this app is published from a personal developer account (§2).
```

### 3. App Store Connect: `docs/APP_STORE_SUBMISSION.md`

**3.1 §4, the table.** The Purchase History row is replaced; a Payment Info row is
added under it; the closing line is replaced.

```markdown
| Purchases | Purchase History | Yes | **Linked** | `orders`, `order_items`, and for an online payment `payment_records` (amount, status, Moyasar's payment and invoice ids). `payment_method` records *how* an order was paid. Moyasar receives the amount, the currency, the fixed text "Spicy Meal order", the time the page expires, two opaque references and return addresses that carry the order or checkout-session id, and the app's language on the page address; never a name, phone number, email or address (`buildInvoicePayload`, `supabase/functions/_shared/moyasar.ts:336-354`; `:384`). *Changed [OWNER DECISION: date]: this note said "No payment instrument — launch is cash-only"* |
| Financial Info | Payment Info | Yes (only when the customer pays online) | **Linked** | *Added [OWNER DECISION: date].* The payment type (card or Apple Pay) and the card scheme (Apple's own example: "form of payment"), the last four digits, issuer name and country, and the authorisation and reference codes, returned by Moyasar after each payment attempt and kept on the payment record, which is linked to the order or, for a payment that completed no order (a declined card, for example), to the checkout session and so to the account (`payment_records`; `sanitizeMoyasarPayment`, `supabase/functions/_shared/moyasar.ts:742-768`; `moyasarVerify.ts:306-310`, `:332-333`). The full card number, expiry and CVV are typed on Moyasar's page inside the app's payment screen; the app's code never reads them (`apps/mobile/src/app/payment/checkout.tsx:7-10`) and our servers never receive them. Moyasar's reply also carries the masked number's first six digits, the name on the card, a token and the payer's IP address, which the server drops (`moyasar.ts:726-740`). Purpose **App Functionality**; not used to track. Reasoning below |
```

```markdown
**Credit Info: NO. Other Financial Info: NO. Health & Fitness: NO. Browsing
History: NO. Search History: NO. Sensitive Info: NO. Contacts: NO.**
```

**3.2 §4, "Card payment through Moyasar".** Replaced in full.

```markdown
### Card payment through Moyasar — decided [OWNER DECISION: date], before online payment is switched on

**Decided by the owner on [OWNER DECISION: date]: Financial Info → Payment Info
is YES, Linked to You, App Functionality, not used to track** [OWNER DECISION:
YES recommended]. Purchases → Purchase History keeps its answer; only its note
changed. Enter both before online payment is switched on (`OWNER_ACTIONS.md`
§47.15, before §47.18), and only once the privacy policy that names Moyasar is
published and served by the rebuilt public legal page (below). Apple allows
that at any time: "You may update your
answers at any time, and you do not need to submit an app update in order to
change your answers."

**Why YES.** Apple defines Payment Info as "Such as form of payment, payment card
number, or bank account number", and exempts it only when all of this holds: "If
your app uses a payment service, the payment information is entered outside your
app, and you as the developer never have access to the payment information, it
is not collected and does not need to be disclosed." Two of the three conditions
fail on a plain reading:

- **"entered outside your app"**: the customer types the card on Moyasar's page
  inside the app's own payment screen (`apps/mobile/src/app/payment/checkout.tsx:1-5`).
  Apple also says "Data collected via web traffic must be declared, unless you
  are enabling the user to navigate the open web", and a payment page chosen by
  our server is not the open web;
- **"never have access"**: our server keeps the card scheme, which is Apple's
  "form of payment", with the last four digits, issuer name and country and the
  authorisation code (`supabase/functions/_shared/moyasar.ts:742-768`), and the
  staff console shows the scheme and last four on the order
  (`src/components/admin/view/orders/PaymentDetails.tsx:91`). It also receives,
  then drops, the masked number's first six digits and the name on the card
  (`moyasar.ts:726-740`).

It is not optional to disclose either. Apple's optional-disclosure test needs
collection "only in infrequent cases that are not part of your app's primary
functionality", and paying for the order is the app's primary function. And the
privacy policy version that names Moyasar (`docs/legal/PRIVACY_POLICY_CARD_PAYMENTS_DRAFT.md`; 2.4 or
3.0, decided once for the four documents published together) lists the same
fields, so a NO would contradict the policy Apple reads beside this form.

**What stays true:** the app's code never reads the full card number, expiry or
CVV, and our servers never receive them. Moyasar returns a masked number (its first
six and last four digits) and the name on the card; the server keeps only the
last four and drops the rest (`moyasar.ts:726-740`). What our server sends
Moyasar is the amount, the currency, the fixed text "Spicy Meal order", the time
the page expires, two opaque references and return addresses that carry the order
or checkout-session id; the app's language goes on the page address. No name,
phone number, email or address (`RECORD_OF_PROCESSING.md` activity 15).

**If the owner answers NO instead**, the label rests on Apple's payment-service
exception alone, and a reviewer comparing it with the privacy policy version
that names Moyasar will find card type and last four listed there.

Apple's text was read on 2026-11-13 from
[App privacy details](https://developer.apple.com/app-store/app-privacy-details/).
```

**3.3 §4, the line naming the privacy policy.** Replaces lines 463-466.

```markdown
**These must agree with C5 / the Play Data Safety form.** They are the same facts
in two shapes, and Apple and Google both cross-check a published privacy policy
against the declared form. The policy is `privacy_policy` v2.3
(`OWNER_ACTIONS.md` §34) until the version that names Moyasar is published
(`docs/legal/PRIVACY_POLICY_CARD_PAYMENTS_DRAFT.md`, `OWNER_ACTIONS.md` §47.15; 2.4 or 3.0, decided once
for the four documents published together). That version is
published together with the `payment_policy`, `cancellation_refund_policy` and
`terms_conditions` versions that describe card payment, in both languages, in
one owner-approved session before `OWNER_ACTIONS.md` §47.18. Then rebuild the
public legal page
(merge to the default branch) and confirm that
https://app.spicymeal.com.sa/privacy serves the new version without JavaScript:
that snapshot is what Apple's and Google's checkers read, and it changes only on
a rebuild (`OWNER_ACTIONS.md` §34, "A legal correction is two steps, not one").
Change these answers in the same window, after that check.
```

**3.4 §6, TestFlight test information.**

Beta app description (EN):

```markdown
> Spicy Meal is the ordering app for a Saudi restaurant. Browse the menu, build
> an order with add-ons and variants, choose pickup or delivery, place the order
> and follow it through preparation to collection or dispatch. Pay in cash on
> collection or delivery, or online on Moyasar's secure page with mada, Visa or
> Mastercard. Online payments are real charges. Prices include VAT. Loyalty
> points are earned and redeemed on pickup orders only.
```

The note between the two descriptions:

```markdown
*Both descriptions describe card payment. That is true only while online payment
is on and in live mode, and they name the card brands, so they go in once
`OWNER_ACTIONS.md` §47.18 has ended with online payment still on (its step 2
device checks passed, and the methods check, once it has been added there,
gap PG-11). A beta app description
applies to every build in TestFlight, and builds older than the one with the
in-app payment screen
(`OWNER_ACTIONS.md` §47.17) open Moyasar's page in the system browser,
without Apple Pay, so neither description says "inside the app". Once the Apple Pay
device check has passed, add "In builds that open that page inside the app, it
also offers Apple Pay on iPhone." / «وفي الإصدارات التي تفتح هذه الصفحة داخل
التطبيق، تتيح الصفحة أيضاً الدفع عبر Apple Pay على iPhone.» after the sentence
naming the cards* [OWNER DECISION]*. If online payment is switched off again,
replace the payment sentences with "Payment is cash on collection or delivery;
online card payment is switched off." / «الدفع نقداً عند الاستلام أو التوصيل،
والدفع الإلكتروني بالبطاقة متوقف.»*
```

Beta app description (AR) *(engineering-drafted, needs a native read)*:

```markdown
> سبايسي ميل هو تطبيق الطلب لمطعم سعودي. تصفّح القائمة، وكوّن طلبك مع الإضافات
> والأحجام، واختر الاستلام أو التوصيل، ثم أرسل الطلب وتابعه حتى التحضير والاستلام
> أو الانطلاق. الدفع نقداً عند الاستلام أو التوصيل، أو إلكترونياً عبر صفحة Moyasar
> الآمنة ببطاقة مدى أو Visa أو Mastercard. والدفع الإلكتروني عملية دفع حقيقية.
> الأسعار شاملة ضريبة القيمة المضافة. تُكتسب نقاط الولاء وتُستبدل في طلبات الاستلام
> فقط.
```

*Optional, a new step 8 under "What to test"* [OWNER DECISION: include only if
testers are expected to pay. The Apple Pay clause stays only once the Apple Pay
device check has passed (decision 5). The "about 30 minutes" is the live
`invoice_expiry_minutes`; put in the value configured on the day (3.5)]:

```markdown
> 8. **If online payment is switched on:** at checkout choose *Online Payment*.
>    Moyasar's page should open inside the app and, on an iPhone with a card in
>    Wallet, offer Apple Pay. **Paying charges a real card and sends a real order
>    to the branch**: close the page without paying unless you mean to buy. Once
>    you close it unpaid, returning to checkout or placing any new order on this
>    device, cash included, reopens that same page until it expires, about 30
>    minutes after it first opened, unless the last payment you tried on it was
>    declined.
```

**3.5 §11, App Review notes.**

The table row, replacing the current one:

```markdown
| **Card payment at checkout** | `app_settings.online_payment_enabled`, and the payment row (`integration_settings`: `moyasar`, enabled, mode `live`) | **off** on 2026-11-13 (row enabled, mode `test`); re-read on the day | An **Online Payment** option beside cash. Moyasar's hosted page opens inside the app: mada, Visa or Mastercard, and Apple Pay on iPhone where the page offers it. Refused for a total under 1.00 SAR. *Changed [OWNER DECISION: date]: this row said the feature was dormant* |
```

The paste-ready notes, **variant ON** (card payment on at submission). Lines
not about payment are unchanged.

```text
Spicy Meal is the ordering app for Spicy Meal restaurants in Saudi Arabia.
Customers browse the menu, order for pickup or delivery, and pay in cash when
they collect or receive the order, or pay by card in the app at checkout.

Payment: the app sells only restaurant food, which is prepared at a branch and
collected or delivered outside the app. Under guideline 3.1.3(e), card payment
for it goes through a payment provider, not In-App Purchase. Nothing digital is
sold, and no payment unlocks anything in the app.

Card payment: at checkout the customer chooses Online Payment or cash. Online
Payment opens the hosted payment page of Moyasar, a Saudi payment provider,
inside the app. The customer enters a mada, Visa or Mastercard card on that
page. The full card number, expiry date and security code are entered only
there: the app's code never reads them, and our servers never receive them.
After each payment attempt, our server fetches the result from Moyasar and
keeps the card network, the last four digits and the issuing bank with the
payment record, but not the first six digits or the name on the card, which
Moyasar also returns. On iPhone the page also offers Apple Pay. Before paying,
checkout shows the items, any delivery fee and discount, and the total
including VAT, and the payment page shows the amount to be charged.

Card payment takes real money: there is no test card, and a paid order is sent
to the restaurant. You can open the payment page and close it without paying;
nothing is charged. Until that page expires, about 30 minutes after it first
opened, returning to checkout or placing any new order on the same device, cash
included, reopens the same page instead of starting a second checkout. That is
how the app avoids a second payment for one checkout. Once the page has expired
and our server has confirmed that with Moyasar, any order, cash included, can
be placed. If the last payment tried on that page was declined, the page does
not hold the device: any order, cash included, can be placed straight away.

Some features are switched on or off from our server without an app update.
At the time of this submission:
- Card payment: ON. Customers choose card or cash at checkout. Card payment
  needs an order total of at least 1.00 SAR.
- Loyalty points: ON, earned and redeemed on pickup orders. Points do not
  expire; expiry is switched off.
- Availability: a branch can mark an item, or one size of an item, as
  unavailable, and can pause delivery for a while.
- Support: the phone, WhatsApp and email contacts in Profile can each be shown
  or hidden.
- Complimentary orders: a small number of accounts we choose can receive orders
  at no charge.

Sign-in is by a one-time code sent to the customer's WhatsApp. Reviewer access
is described under Sign-In Information.

Push notifications carry order updates and occasional offers. Offers can be
turned off in Profile > Notifications.
```

Four owner choices sit inside that text, and one value must be re-read on the
day:

- "On iPhone the page also offers Apple Pay." stays only if the Apple Pay device
  check passes (`RELEASE_CHECKLIST.md` §7) [OWNER DECISION];
- what a reviewer who wants to see a completed payment is offered. A suggested
  line, for App Review Information's attachment: "A screen recording of a
  completed card payment and of the Apple Pay sheet is attached." Whether to add
  "If you complete a payment, we will refund it" is yours too: the refund would
  be by hand in the Moyasar dashboard (`OWNER_ACTIONS.md` §47.20) [OWNER DECISION];
- whether to say what happens to a second payment. The text says how the app
  avoids one, not that one cannot happen: a payment on an older page that
  settles late, or two payments confirmed at the same moment, can still pay one
  checkout twice. The second is never applied to an order. It is recorded as a
  duplicate to refund by hand; nothing refunds it automatically and nothing
  alerts on it (`PAYMENTS.md` §10, §12; product gap PG-02), so "we refund it"
  would be a promise that rests on someone noticing. A sentence that is true of
  the code today, if you want one: "If a second payment is ever taken for a
  checkout that is already paid, it is not applied to any order: our server
  records it as a duplicate payment to be refunded." [OWNER DECISION: decide
  this with `cancellation_refund_policy` D2 and D3 and the payment policy
  draft's refund-promise decision, and use their words if they promise a
  refund; if duplicates are refunded automatically before submission, end it
  "…and it is refunded automatically." instead];
- whether to keep the expiry paragraph. It explains behaviour a reviewer could
  take for a fault [OWNER DECISION: keep recommended; if the "Pay another way"
  action of product gap PG-04 ships first, use the wording in "Product gaps
  found" instead];
- **"about 30 minutes" is a setting, not a constant.** It is the payment row's
  `invoice_expiry_minutes`, read live as 30 on 2026-11-13. The server holds it
  between 5 and 60 (`supabase/functions/_shared/moyasar.ts:259-260`), opens each
  attempt for that many minutes (`20261003120000_moyasar_only_payments.sql:253`),
  and ends the page one minute before its attempt (`moyasar.ts:399`, `:427-441`).
  Re-read it on the day and put the value in, here and in TestFlight step 8.
  Keep it at 30 or below: the checkout session itself lasts 30 minutes
  (`20260712160000_checkout_sessions.sql:53`), so a longer page keeps the device
  locked after the app can no longer reopen it (product gap PG-04).

**Variant OFF** (the build is submitted before card payment is switched on).
Paste-ready below. The first paragraph is today's, unchanged, and everything from
"Some features are switched on or off" down is the ON text's, except the
card-payment bullet. The "Payment" and "Card payment" paragraphs stay, but say
what happens *when* card payment is switched on: guideline 2.3.1(a) asks for "All new features,
functionality, and product changes" to be "described with specificity in the
Notes for Review section", and 2.5.19 says "Don't include any hidden, dormant,
or undocumented features in your app". Describing the switched-off feature
documents it; it is still dormant during review, which is the reason to prefer
Variant ON where the timing allows [OWNER DECISION]. The "Card payment takes real
money" paragraph and the Apple Pay sentence are left out: nobody can pay while
the switch is off, and the Apple Pay device check needs it on.

```text
Spicy Meal is the ordering app for Spicy Meal restaurants in Saudi Arabia.
Customers browse the menu, order for pickup or delivery, and pay in cash when
they collect or receive the order.

Payment: the app sells only restaurant food, which is prepared at a branch and
collected or delivered outside the app. When card payment is switched on, card
payment for the food goes through a payment provider under guideline 3.1.3(e),
not In-App Purchase. Nothing digital is sold, and no payment unlocks anything
in the app.

Card payment (switched off at the time of this submission): when card payment
is switched on, the customer chooses Online Payment or cash at checkout. Online
Payment opens the hosted payment page of Moyasar, a Saudi payment provider,
inside the app. The customer enters a mada, Visa or Mastercard card on that
page. The full card number, expiry date and security code are entered only
there: the app's code never reads them, and our servers never receive them.
After each payment attempt, our server fetches the result from Moyasar and
keeps the card network, the last four digits and the issuing bank with the
payment record, but not the first six digits or the name on the card, which
Moyasar also returns. Before paying, checkout shows the items, any delivery fee
and discount, and the total including VAT, and the payment page shows the
amount to be charged.

Some features are switched on or off from our server without an app update.
At the time of this submission:
- Card payment: the app contains a card-payment option at checkout, Online
  Payment through Moyasar's hosted page, described above. It is switched OFF
  at the time of this submission, and no customer can use it; customers pay
  cash. We will switch it on after [OWNER DECISION: date or event].
- Loyalty points: ON, earned and redeemed on pickup orders. Points do not
  expire; expiry is switched off.
- Availability: a branch can mark an item, or one size of an item, as
  unavailable, and can pause delivery for a while.
- Support: the phone, WhatsApp and email contacts in Profile can each be shown
  or hidden.
- Complimentary orders: a small number of accounts we choose can receive orders
  at no charge.

Sign-in is by a one-time code sent to the customer's WhatsApp. Reviewer access
is described under Sign-In Information.

Push notifications carry order updates and occasional offers. Offers can be
turned off in Profile > Notifications.
```

**3.6 Not in any record: the App Store product page.** `APP_STORE_SUBMISSION.md`
holds no App Store description, so there is nothing to replace. When one is
written, give it the Play listing's Payment section (1.3, 1.4), under the same
C-CASH and C-CARD conditions. Once the Apple Pay device check has passed, which
needs online payment on (§47.18 step 2), use the lines below instead, with Apple
Pay added, in the same window as the later `privacy_policy` and
`payment_policy` versions that name Apple Pay (option (a) of the payment policy
draft's Apple Pay decision), so that no customer-facing store text names a
method the published policies leave out [OWNER DECISION]. Apple's Apple Pay guidance asks for exactly this:
"Update your App Store product page description, screenshots, and previews to
let customers know that Apple Pay is available in your app." The Arabic Apple
Pay line says «من خلال صفحة Moyasar الآمنة» where every other text here says
«عبر صفحة Moyasar الآمنة», only because «عبر» already introduces Apple Pay in
the same line.

```en
Payment
• Cash on pickup at the branch, or cash on delivery
• Or pay online in the app with mada, Visa or Mastercard, or with Apple Pay, on Moyasar's secure page
```

```ar
الدفع
• نقدًا عند الاستلام من الفرع أو عند التوصيل
• أو إلكترونيًا داخل التطبيق ببطاقة مدى أو Visa أو Mastercard، أو عبر Apple Pay، من خلال صفحة Moyasar الآمنة
```

Promotional Text is the one App Store text that can follow the switch on the day.
Apple: it "lets you inform your App Store visitors of any current app features
without requiring an updated submission", 170 characters at most [OWNER DECISION:
use it or not]. Until the Apple Pay device check has passed:

```en
Pay online in the app with mada, Visa or Mastercard, or pay cash on pickup or delivery.
```
*87 characters.*

```ar
ادفع إلكترونيًا داخل التطبيق ببطاقة مدى أو Visa أو Mastercard، أو نقدًا عند الاستلام أو التوصيل.
```
*96 characters.*

Once it has passed, and the policy versions that name Apple Pay are published:

```en
Pay online in the app with mada, Visa, Mastercard or Apple Pay, or pay cash on pickup or delivery.
```
*98 characters.*

```ar
ادفع إلكترونيًا داخل التطبيق ببطاقة مدى أو Visa أو Mastercard أو عبر Apple Pay، أو نقدًا عند الاستلام أو التوصيل.
```
*113 characters.*

---

## What changed and why

Each change, the code fact it rests on, and the reason. Paths are relative to the
repository root. Line numbers are from the default branch at `04eb351` read on
2026-11-13.

| # | Change | Code fact (file:line) | Why |
| --- | --- | --- | --- |
| 1 | Listing: C-CASH now means "cash is offered", and C-CARD is added with six conditions (1.1) | `apps/mobile/src/lib/payment.ts:50-54`: `availableMethods` offers `online` only when `onlineEnabled` is set and the platform is not web, and `cash` only when `cashEnabled` is set. `apps/mobile/src/lib/mappers.ts:407` reads `online_payment_enabled`. `supabase/functions/payment-initiate/index.ts:418`, `:432`, `:495`, `:509` refuse customer checkout unless both the payment row and the attempt are `live`, and `:414-416`, `:491-493` answer "Online payment is not available" when the live secret key or webhook token is missing (`supabase/functions/_shared/moyasar.ts:264-269`). Live `legal_documents`: all four payment-related documents say card payment is not available ("Current (live) text"). The card brands rest on the owner's answer alone (`docs/PAYMENTS.md:15`), and the invoice request cannot restrict methods (`moyasar.ts:336-354`) | The old claim was exclusive ("payment is cash") and held only while card was off. With both methods on, each needs its own condition, or the table cannot say when the listing goes false. The switch alone is not enough: without the live keys, the published documents and a method list seen on a device, the claim is still false |
| 2 | Listing: publication order inside the proposed window, and the switch-off rule (1.2) | `docs/OWNER_ACTIONS.md` §47.18: "Online payment is one global setting", and "If anything fails, switch Online Payment off. Switching off is always allowed." The publishing plan in the header: four documents together, both languages, one session, before §47.18 | A listing claim has to follow a switch that can be turned back the same day, and the documents it points to must already say the same thing. Release notes already published stay with their release, so a switch-off changes the next release's notes |
| 3 | Full description: one Payment bullet, EN and AR (1.3, 1.4) | The app's own words: the option is "Online Payment" / «الدفع الإلكتروني» (`apps/mobile/src/i18n/strings.ts:138`, `:504`); the hosted page opens inside the app (`apps/mobile/src/app/payment/checkout.tsx:1-5`); the screen's footer says "Your card details are entered on Moyasar’s secure page." / «تُدخل بيانات بطاقتك في صفحة Moyasar الآمنة.» (`checkout.tsx:221`). The account has mada, Visa / Mastercard and Apple Pay enabled (owner's answer, `docs/PAYMENTS.md:15`); no device check yet confirms which methods the live page shows (`docs/RELEASE_CHECKLIST.md` §7), and §47.19 still asks Moyasar to confirm SADAD and STC Pay are off. Apple Pay is iPhone-only (`checkout.tsx:179`, "iOS only (a no-op on Android)") | Name only what a Play customer, on Android, can use, in the words the app shows. "Secure page" is a claim the app already makes. The brand list waits for the device check and Moyasar's written confirmation (C-CARD) |
| 4 | Release notes: the payment line, or a note for a later release (1.5) | As row 3 | Release notes belong to a release; card payment is a server switch, so the note must match the switch's state when that release reaches users |
| 5 | Play: Moyasar added to Purchase history's recipients (2.1) | `buildInvoicePayload` sends `amount`, `currency`, `description`, `success_url`, `back_url`, `expired_at` and `metadata` holding `reference_transaction` and `reference_order` (`supabase/functions/_shared/moyasar.ts:336-354`). The description is the literal "Spicy Meal order" (`payment-initiate/index.ts:456`, `:529`). The return addresses carry the order or checkout-session id (`:265-266`, `:457`, `:530`). The references are `sm_` plus a random uuid, and `ORD-` or `CS-` plus 12 hex digits of the order or session id (`supabase/migrations/20261003120000_moyasar_only_payments.sql:306-313`, `:405-406`). The app's language reaches Moyasar only as `lang` on the page address the app opens (`moyasar.ts:384`). Nothing else is sent: no customer name, phone, email or address. The POS also receives the paid amount and Moyasar's payment id (`supabase/functions/_shared/paymentSync.ts:62-74`, called at `moyasarVerify.ts:485-487`) | Transaction data now goes to a new recipient. No contact data does |
| 6 | Play: User payment info goes from NO to YES, required (2.1, 2.3) | What is kept: `sanitizeMoyasarPayment` (`moyasar.ts:742-768`), written to `raw` on every check of an attempt, a declined one included (`moyasarVerify.ts:306-310`, `:524`), and the `card_scheme` and `card_last_four` columns (`moyasarVerify.ts:332-333`, written at `:375`, `:473-474` and, for a duplicate, `:197-198`), shown to staff on the order (`src/components/admin/view/orders/PaymentDetails.tsx:91`). A record with no order hangs off its checkout session, and the session off the customer (live FKs, both `ON DELETE CASCADE`). Received and dropped: the masked number's first six digits, the name on the card, a token and the payer IP (`moyasar.ts:726-740`; `moyasar.test.ts:647-676`). Never received: the card number, expiry and CVV; the app injects no script into the page (`checkout.tsx:173-175`). Required: live `begin_checkout_session` has neither the phone-verified check nor the order limits that live `place_customer_order` has (`supabase/migrations/20261005120000_server_input_bounds.sql:60-69`) | Google's payment-service FAQ asks "whether your app receives any relevant data from the payments service". It does, and keeps it. Google allows "optional" only if all users can avoid the collection, and today some cannot |
| 7 | Play §6a: the collected-types cell, and the reason under "encrypted in transit" (2.2) | `apps/mobile/src/features/checkout/webviewPolicy.ts:86-89` (only `https` loads); `moyasar.ts:373-386` (only `https` pages on `moyasar.com` are handed to the app); `supabase/functions/_shared/moyasarHttp.ts:20-32` (CONNECT tunnel through the proxy, used only when `MOYASAR_PROXY_URL` is set, so the proxy relays TLS it cannot read) and `:35-37` (a set proxy that cannot be used refuses the request) | The answer stays Yes. The new paths are recorded so the next reader need not re-derive it. The proxy route is unproven on hosted Supabase until the LIVE Test connection (`PAYMENTS.md` §8.1, §12), so it is stated as conditional |
| 8 | Play §9: card payment adds no financial feature (2.4) | The app keeps no balance, stores no card and moves no money between people: `payment_records` holds Moyasar's ids and a masked last four (`moyasar.ts:742-768`) | Google scopes financial products and services as those "related to the management or investment of money". Declaring a second feature anyway may not be free: Google requires an organization account for financial products and services (answer 13634885), and this account is personal (`PLAY_STORE_SUBMISSION.md` §2) |
| 9 | Apple: a Payment Info row, YES and Linked (3.1, 3.2) | As row 6 | Two of the three conditions of Apple's payment-service exception fail on a plain reading (3.2); Apple's web-traffic rule; the privacy draft lists the same fields. Apple's form asks no "optional" question, so the row says only when the data is collected |
| 10 | Apple: the Purchase History note (3.1) | As row 5, and `payment_records` | "No payment instrument — launch is cash-only" stops being true |
| 11 | Apple: the privacy-policy line (3.3) | `docs/OWNER_ACTIONS.md` §34: the public legal page's no-JavaScript snapshot changes only on a rebuild, "A legal correction is two steps, not one" | Apple and Google check the forms against the published policy, and their checkers read that snapshot, so the four documents must be published and the page rebuilt before the forms change |
| 12 | TestFlight description, EN and AR, and an optional test step (3.4) | Customer checkout is refused in TEST mode (`payment-initiate/index.ts:418`, `:432`, `:495`, `:509`), so a tester's payment is a real charge; a paid order goes to the POS (`moyasarVerify.ts:480-487`). A beta app description covers every build in TestFlight, each installable for 90 days (`APP_STORE_SUBMISSION.md` §6), and builds older than the in-app payment screen open Moyasar's page in the system browser without Apple Pay (`PAYMENTS.md` §5). Closing the page unpaid locks new orders on that device until it expires, unless the last payment tried on it was declined (row 13) | "no card is taken in the app" becomes false; "inside the app" and Apple Pay are true only of the newer builds, so they stay out of the description |
| 13 | App Review notes, ON and OFF variants (3.5) | The minimum: `MOYASAR_MIN_INVOICE_MINOR_UNITS = 100` (`moyasar.ts:124-132`), refused before any attempt opens (`payment-initiate/index.ts:406`, `:484-487`, with the refusal at `:362-373`). What checkout shows before paying: subtotal, delivery fee, discounts, VAT and total (`apps/mobile/src/features/checkout/view/TotalsCard.tsx:65-84`). The reopen: recovery runs on entering checkout and before any order, cash included (`apps/mobile/src/features/checkout/CheckoutScreen.tsx:286-297`, `:721-733`); a pending session resumes (`pendingSession.ts:79-84`, `:164-188`) on the same open attempt and page (`20261003120000_moyasar_only_payments.sql:290-302`). A declined payment does not hold the device: `payment-verify` answers `failed` (`moyasar.ts:483-484`, `:1096-1100`), a terminal answer, so the app drops the saved session (`pendingSession.ts:70`, `:83`; `CheckoutScreen.tsx:907-908`; `PAYMENTS.md` §4). The window is the configured `invoice_expiry_minutes`, 30 live on 2026-11-13 and held between 5 and 60 (`moyasar.ts:259-260`), counted from when the attempt opened (`20261003120000_moyasar_only_payments.sql:253`), the page ending one minute before its attempt (`moyasar.ts:399`, `:427-441`); the checkout session lives 30 minutes (`supabase/migrations/20260712160000_checkout_sessions.sql:53`, and the insert at `20260826110000_checkout_zero_total_idempotency.sql:108-120` sets no other expiry). A second payment can still reach one checkout; it is recorded as a duplicate, never applied, and refunded only by hand (`moyasar.ts:930-934`, `:959-975`; `moyasarVerify.ts:144-263`; `PAYMENTS.md` §10, §12). What the server receives about the card: row 6 | Guidelines 2.3.1(a) and 2.5.19 (3.5), and 3.1.3(e) and 4.9 (below). The notes say what the code does, and promise nothing it does not guarantee |
| 14 | App Store product page lines and Promotional Text (3.6) | As row 3. The Apple Pay device check needs online payment on (`RELEASE_CHECKLIST.md` §7; §47.18 step 2) | Apple's Apple Pay guidance asks for the product page to say Apple Pay is available, once it is known to be |

### Apple: In-App Purchase does not apply

Guideline 3.1.1 covers unlocking things inside the app: "If you want to unlock
features or functionality within your app, (by way of example: subscriptions,
in-game currencies, game levels, access to premium content, or unlocking a full
version), you must use in-app purchase."

Guideline 3.1.3(e) covers this app: "If your app enables people to purchase
physical goods or services that will be consumed outside of the app, you must use
purchase methods other than in-app purchase to collect those payments, such as
Apple Pay or traditional credit card entry."

The app sells restaurant food, prepared at a branch and collected or delivered: a
physical good consumed outside the app. So 3.1.3(e) does more than permit card
payment; it **forbids** In-App Purchase for it, and names Apple Pay and
"traditional credit card entry" as the ways to pay. The sentence at the head of
3.1.3 about not encouraging other purchase methods cannot apply here, because
there is no In-App Purchase to steer away from. Loyalty points are not sold: they
are earned on pickup orders and taken off the price of food (`docs/LOYALTY.md`),
so 3.1.1's "in-game currencies" does not reach them either. The review notes say
this in one paragraph (3.5), so that a reviewer who sees a card form does not
have to work it out.

Source: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/),
"Last Updated: October 16, 2026", read 2026-11-13.

### Google: Play's billing system must not be used

Google's Payments policy: "Google Play's billing system must not be used in
cases where: payment is primarily: for the purchase or rental of physical goods
(such as groceries, clothing, housewares, electronics); for the purchase of
physical services (such as transportation services, cleaning services, airfare,
gym memberships, food delivery, tickets for live events)". The same policy's
rule against leading users to other payment methods concerns purchases that must
use Play's billing system, which a food order never is.

Source: [Payments policy, answer 9858738](https://support.google.com/googleplay/android-developer/answer/9858738),
read 2026-11-13.

### Apple Pay

- **Guideline 4.9:** "Apps using Apple Pay must provide all material purchase
  information to the user prior to sale of any good or service and must use Apple
  Pay branding and user interface elements correctly, as described in the Apple
  Pay Marketing Guidelines and Human Interface Guidelines." Before paying, the
  customer sees the items and the totals card (subtotal, delivery fee, discounts,
  VAT, total: `TotalsCard.tsx:65-84`), and Moyasar shows the description
  "alongside the amount" on its page (`docs/integrations/Moyasar_API_Reference.md`
  §3.1). The Apple Pay button itself is drawn by Moyasar's page, not by the app.
- **Writing the name.** The app and the listings use "Apple Pay" only as text, so
  the Marketing Guidelines' text rules bind: "always typeset Apple Pay as two
  words with an uppercase A and uppercase P followed by lowercase letters", and
  "Don't translate Apple Pay or any other Apple trademark. Always display Apple,
  Apple Pay, iPhone, Face ID, Touch ID, and other Apple trademarks in English,
  even when they appear within text in a language other than English." That is
  why the Arabic drafts write "Apple Pay" and "iPhone" in Latin letters.
- **What the app itself needs.** The app has no Apple Pay entitlement or merchant
  ID (none in `apps/mobile/app.json`); Apple Pay is offered by Moyasar's web page
  inside the app's WebView. WebKit refuses Apple Pay in a WebView that uses
  script-injection APIs, which is why the screen sets `enableApplePay` and injects
  nothing (`checkout.tsx:179-187`). Whether Moyasar's hosted invoice really offers
  Apple Pay there is unconfirmed (item 1 under "Claims the drafter could not
  verify").
- **Acceptable use.** Apple's guidelines for Apple Pay on the web list prohibited
  goods (tobacco, weapons and the like); restaurant food is not among them. Their
  rule that Apple Pay be offered "at least on parity with" other payment methods
  on a page applies to the page that shows the methods, which is Moyasar's.

Sources: [Apple Pay Marketing Guidelines](https://developer.apple.com/apple-pay/marketing/),
[Acceptable Use Guidelines for Apple Pay on the Web](https://developer.apple.com/apple-pay/acceptable-use-guidelines-for-websites/),
[WebKit, New WebKit Features in Safari 13](https://webkit.org/blog/9674/new-webkit-features-in-safari-13/),
all read 2026-11-13.

### Versioning

None of these texts has a version number. They are records in this repository,
typed into the consoles by hand, so there is nothing to bump in them. Each
changed passage instead carries a dated *Changed* or *Added* note, which is how
these files already record a change, and the date is the owner's decision date.

Two things around them do carry versions:

- **The documents the forms and the listing must agree with.** Four, published
  together (header), and their numbers are one owner decision for the whole set:
  the privacy, payment policy and terms drafts each leave minor or major open
  (`privacy_policy` 2.3 to 2.4 or 3.0; `payment_policy` and `terms_conditions`
  2.0 to 2.1 or 3.0), and the refund draft proposes `cancellation_refund_policy`
  2.0 to 3.0, with 2.1 as the alternative (its D6). The texts here point at "the
  version that names Moyasar" or "the version that describes card payment"
  rather than at a number for that reason, and because the pending location
  correction (`OWNER_ACTIONS.md` §43) could take privacy 2.4 first.
- **The app release the release notes belong to.** If card payment first reaches
  the public in the first public release, that release stays **1.0.0**, and only
  the build number moves (`eas.json` increments it remotely). If a cash-only
  1.0.0 is published first, release the card build as **1.1.0**: a minor bump,
  because it adds a feature customers can see and removes nothing. A major bump
  would announce a break that has not happened [OWNER DECISION].

### Left unchanged on purpose

- **The short description.** It makes no payment claim.
- **Name, Phone number, Email address and Address rows, on both forms.** Our
  server sends none of them to Moyasar (`moyasar.ts:336-354`). If Moyasar's card
  form asks for the name on the card, that name goes to Moyasar, and Moyasar
  returns it to our server in its payment object; `sanitizeMoyasarPayment` drops
  it, so it is never stored (`moyasar.ts:742-768`; the test "drops the BIN, the
  token, the name and the payer IP", `moyasar.test.ts:669-676`). Name is already
  declared on both forms (Apple: Linked, App Functionality; Play: optional), so
  no answer moves.
- **The location rows.** Moyasar's page sees the device's IP address, like any web
  page. We keep none: the sanitizer "Drops the BIN, tokens, the payer IP"
  (`moyasar.ts:740`). Apple's Coarse Location is already declared for App
  Functionality, so even if Moyasar locates by IP, no answer moves.
- **Device ID, crash and diagnostics rows, Advertising ID: NO.** Card payment adds
  no SDK; it removed one (`expo-web-browser`, `APP_STORE_SUBMISSION.md` §8).
- **C-PICKUP, C-VAT, C-DELIVERY, C-EXPORT, C-NOPROMO, C-NOBRANCH.**
- **The lines about order tracking and loyalty, byte-identical, although they
  depend on staff today** [OWNER DECISION]. The listing's tracking bullet ("An
  instant notification at every status change: preparing, ready, on the way,
  delivered") and its loyalty bullets, the release notes' "Follow your order
  step by step…" and "Earn loyalty points on pickup orders…", the TestFlight
  description's "follow it through preparation to collection or dispatch" and
  loyalty sentence, TestFlight step 3, and the review notes' loyalty bullet are
  outside this change and stay as they are, in both languages. They describe
  what the code does when an order's status is moved on, and today only an
  administrator in the console moves it: the POS's status never reaches the
  customer-facing status (`supabase/functions/lazywait-webhook/index.ts:15-17`),
  and pending points become spendable only when an administrator marks the order
  Delivered (`20260918120000_loyalty_earn_on_settlement.sql:65`). Live
  2026-11-13: 75 of 82 orders still `received`, 1 `delivered`; no `earn` row
  since 2026-09-07, 3 `earn_pending` rows. Not card-specific (product gaps PG-21,
  PG-22). Decide them in the same window: either orders reliably move on before
  these texts go out, or those lines come out of every text listed here, both
  languages together, when the card lines go in.
- **No store text mentions refunds, deliberately.** The code refunds automatically
  only a paid order that never reached the POS after the customer's resends. An
  admin cancelling a paid online order refunds nothing automatically, and a
  duplicate payment is recorded, not refunded (`OWNER_ACTIONS.md` §47.20). Refund
  wording belongs in `cancellation_refund_policy`, and the store texts promise
  nothing that wording would have to honour. The only refund sentences offered
  are two optional lines for App Review (3.5), each an owner decision.
- **Play's content rating and Apple's age rating.** The food is a physical good,
  so any question about digital purchases stays No. The payment screen raises one new
  age-rating question, which is "Open owner decisions", item 11.

### Knock-on edits in other records

Not store-facing, but they go stale the day these answers change (CLAUDE.md §14):

- `docs/GO_LIVE_READINESS.md` B3 says "All twelve Apple data types"; with
  Payment Info it is thirteen. C5 should name User payment info among the
  argued answers.
- `docs/OWNER_ACTIONS.md` §47.15: date the store-answers bullet when the forms,
  the listing and the notes are entered.
- *Done:* `docs/OWNER_ACTIONS.md` §47.15 has listed `terms_conditions` since
  2026-11-13, and the final review of 2026-11-14 added there the proposed
  publishing plan (the four documents together, both languages, one session,
  before §47.18), the rebuild of the public legal page with the no-JavaScript
  check of https://app.spicymeal.com.sa/privacy (§34), which makes them visible
  to Apple and Google, and the order of these answers inside the window ("Open
  owner decisions", item 6) (product gap PG-08). What stays open is the owner's
  decision on the plan.
- `docs/RELEASE_CHECKLIST.md` §7, "Online payment (Moyasar)": add a device check
  that the live hosted page offers mada, Visa and Mastercard (Apple Pay on
  iPhone only if that is decided), and no other method (product gap PG-11), and
  name it among `docs/OWNER_ACTIONS.md` §47.18 step 2's device checks. Neither
  has it yet. Until it passes, the brand list in every text here rests on the
  owner's word alone.
- `export_my_data()` must return the customer's payment records (card network,
  last four, issuer, status, amount) before card payment is switched on. Its own
  `about` text tells the customer "Everything Spicy Meal holds about you that is
  personal to you" (`supabase/migrations/20260912120000_export_my_data.sql:73-76`),
  and its live body reads `payment_records` 0 times (product gap PG-26). That is a
  migration, so a CLAUDE.md §5 apply.
- *Done 2026-11-13:* `docs/PAYMENTS.md` §1 and `docs/GO_LIVE_READINESS.md` G1
  now record the payment row as enabled, in TEST mode, since 2026-11-13 18:17:02
  UTC, as the live read at the top of this draft found it.
- `docs/APP_STORE_SUBMISSION.md` §11, the paragraph above the switches table,
  says "**card payment is compiled in and switched off**, which is the case the
  guideline describes". It goes stale when a build is submitted with the ON
  notes (3.5).

---

## Open owner decisions

1. **Apple, Payment Info: YES, Linked, App Functionality** (recommended), or NO.
   Reasoning in 3.2. [OWNER DECISION]
2. **Play, User payment info: collected YES, required, not shared, App
   functionality** (recommended), or NO. **Required** is what the code makes true
   today, because the card path skips the cash path's phone-verified check and
   order limits; **Optional** becomes available only if the card path gets them
   first (product gap PG-17). "Not processed ephemerally" is a fact, not a
   choice: the data is stored. Whether to add *Fraud prevention, security, and
   compliance* as a purpose, which needs payment records to survive account
   deletion first (product gap PG-06). Reasoning in 2.3. [OWNER DECISION]
3. **Play, the "Shared" column for Moyasar** (purchase data: the amount, the
   currency, a fixed description, the expiry time, opaque references, return
   addresses carrying the order or checkout-session id, and the app's language).
   A service provider, a user-initiated transfer, or shared.
   This depends on the Moyasar agreement, and on counsel where it is unclear, as
   for the four vendors already in §6. [OWNER DECISION]
4. **Play, Financial features: unchanged** (recommended), or add *Mobile payments
   and digital wallets*. Either way §9's sentence that a second feature applies
   is replaced (2.4). [OWNER DECISION]
5. **Apple Pay, every mention.** Keep each one only if the Apple Pay device check
   passes (`RELEASE_CHECKLIST.md` §7): the TestFlight description's Apple Pay
   sentence, TestFlight step 8's Apple Pay clause, the review notes, the App Store
   lines and the Promotional Text. That check runs in §47.18 step 2, with online
   payment on, so nothing entered before it names Apple Pay; add it afterwards
   where the text can change without a release (the TestFlight description, the
   Promotional Text). In a customer-facing text (the Promotional Text, the App
   Store lines), add it only in the same window as the later `privacy_policy`
   and `payment_policy` versions that name Apple Pay, so that no store text
   names a method the published policies leave out. This is the same choice as
   the payment policy draft's "Apple Pay" decision, option (a) ("name Apple Pay
   in a later version once that check has passed"), and product gap PG-12.
   Apple Pay never appears in a Play text. [OWNER DECISION]
6. **Timing, inside the proposed window.** The four documents (`privacy_policy`,
   `payment_policy`, `cancellation_refund_policy`, `terms_conditions`) are
   published together, in both languages, in one owner-approved session before
   §47.18, and the public legal page is rebuilt and checked without JavaScript
   (3.3). In the same window, in this order: enter the two privacy forms once
   that check passes, still before §47.18 (until the switch they over-disclose,
   the safe direction for a form); then, once §47.18 has ended with card payment
   still on (step 1 switched it on, the step 2 device checks passed, and so did
   the methods check, once it has been added there: "Knock-on edits in other
   records"), submit the listing, the
   release notes that apply, the TestFlight description and any App Store text
   that says card payment is available (until then they understate, the safe
   direction for a claim). Not straight after step 1: C-CARD needs the methods
   check, which cannot run before the switch, and a text already submitted when
   a later step fails would advertise a switched-off option. The App Review
   notes follow the switch's state when the build is submitted (3.5). If §47.18
   ends with card payment switched off again, the second group is not sent.
   [OWNER DECISION]
7. **Release notes: Variant A, Variant B, or no change** (1.5), and the version:
   1.0.0 for a first public release that already has card payment, or 1.1.0 for
   a later release that adds it. [OWNER DECISION]
8. **App Review notes: ON or OFF variant**, depending on the switch when the
   build is submitted (ON preferred: OFF describes a dormant feature, which
   guideline 2.5.19 names), and the four choices inside them (3.5): the Apple Pay
   sentence, what a reviewer who wants a completed payment is offered (a screen
   recording as the attachment; whether to promise to refund a reviewer's
   payment), whether to add the sentence about a second payment (decided with
   `cancellation_refund_policy` D2 and D3 and the payment policy draft's
   refund-promise decision), and whether to keep the expiry paragraph, with the
   live `invoice_expiry_minutes` put in. [OWNER DECISION]
9. **TestFlight: whether to add step 8**, which a tester can only complete by
   paying for real, and which warns that closing the page unpaid locks new
   orders on that device until the page expires, unless the last payment tried
   on it was declined (3.4). [OWNER DECISION]
10. **The App Store product page** has no description in any record. Give it the
    Payment lines in 3.6 when it is written, and decide whether to use the
    Promotional Text. [OWNER DECISION]
11. **Apple's age-rating question "Unrestricted Web Access"**: "Users can navigate
    to any webpage within the app or freely browse the web. May include: embedded
    browser functionality or browser app." A Yes rates the app 16+. Recommended
    answer: **No**. The payment screen has no address bar and opens one page that
    the server chooses, `https` on `moyasar.com` (`moyasar.ts:373-386`). The
    honest caveat: from that page it allows any `https` page, on purpose, because
    a bank's 3-D Secure page cannot be named in advance (`docs/PAYMENTS.md` §5).
    [OWNER DECISION]
12. **The Arabic, which needs a native read.** Every Arabic string in this draft:
    - 1.4: «• أو إلكترونيًا داخل التطبيق ببطاقة مدى أو Visa أو Mastercard، عبر صفحة Moyasar الآمنة»;
    - 1.5, Variant A: «الدفع نقدًا عند الاستلام أو التوصيل، أو إلكترونيًا داخل التطبيق ببطاقة مدى أو Visa أو Mastercard.»;
    - 1.5, Variant B: «• جديد: ادفع إلكترونيًا داخل التطبيق ببطاقة مدى أو Visa أو Mastercard، عبر صفحة Moyasar الآمنة» and «• الدفع نقدًا عند الاستلام أو التوصيل ما زال متاحًا»;
    - 3.4, TestFlight description: «الدفع نقداً عند الاستلام أو التوصيل، أو إلكترونياً عبر صفحة Moyasar الآمنة ببطاقة مدى أو Visa أو Mastercard. والدفع الإلكتروني عملية دفع حقيقية.»;
    - 3.4, the sentence added once the Apple Pay check passes: «وفي الإصدارات التي تفتح هذه الصفحة داخل التطبيق، تتيح الصفحة أيضاً الدفع عبر Apple Pay على iPhone.»;
    - 3.4, the sentence used if card payment is switched off again: «الدفع نقداً عند الاستلام أو التوصيل، والدفع الإلكتروني بالبطاقة متوقف.»;
    - 3.6: the App Store Payment line with Apple Pay, and both Promotional Texts.

    Points for the reader. The brand names follow the sibling drafts: «مدى» in
    Arabic letters, Visa, Mastercard and Moyasar in Latin letters, and «Moyasar»
    in the same form as the app's own footer. Whether to write «فيزا»,
    «ماستركارد» or Moyasar's Arabic name «ميسّر» instead is the reader's call
    [OWNER DECISION]. "Apple Pay" and "iPhone" must stay in Latin letters: Apple
    forbids translating them. «صفحة Moyasar الآمنة» is the footer's own phrase
    («تُدخل بيانات بطاقتك في صفحة Moyasar الآمنة.», `checkout.tsx:221`); these
    texts put «عبر» before it throughout, except the App Store line with Apple
    Pay, which says «من خلال» because «عبر» already introduces Apple Pay in that
    line. «والدفع الإلكتروني بالبطاقة» in the switch-off sentence is the live
    documents' own phrase for "online card payment". «عملية دفع حقيقية» replaces
    a first draft that said the card is "actually debited", which was narrower
    than the English "real charges".
13. **The checkout screenshot** in the Play listing shows no online option. That is
    not a false claim, and screenshots can be replaced without a release; re-take
    it once card payment is on if you want the listing to show it. [OWNER DECISION]
14. **The card brands named.** Every text here names mada, Visa and Mastercard on
    the owner's answer alone (`docs/PAYMENTS.md:15`), and the invoice request
    cannot restrict methods. Name them only after the live hosted page has been
    seen on a device offering exactly those, and Moyasar has confirmed in writing
    that SADAD, STC Pay and any scheme not named are off for invoices (§47.19;
    product gap PG-11). This is the same choice as the payment policy draft's
    "methods" decision. [OWNER DECISION]

---

## Product gaps found

Places where the product does not do what a reasonable store or reviewer claim
would need. In each, the text above says what is true of the code today, and the
[OWNER DECISION] marker gives the wording to use if the product changes first.
The IDs are those of `docs/readiness/20261113-card-payments-gaps.md`, where each gap has its evidence and
proposed fix.

| Gap | What it does to these texts | Wording today | If the product changes first |
| --- | --- | --- | --- |
| **PG-17**: the card path skips the phone-verified check and the open-order and hourly limits that the cash path enforces | A customer those checks refuse can order only by card, so Play's "optional" is false for them | Play User payment info: **Required** (2.1, 2.3) | **Optional** while cash is offered, once `begin_checkout_session` has both checks |
| **PG-02**: a second payment can still reach one checkout (a late payment on an older page, or two confirmed at once); it is recorded as a duplicate, refunded only by hand, and nothing alerts on it | The review notes cannot say a checkout "can never be paid twice" | They say how the app avoids a second payment, and promise nothing about one (3.5); an optional sentence says a second payment is recorded as a duplicate to be refunded, worded with the refund policy's D2 and D3 | "…and it is refunded automatically", once duplicates are |
| **PG-04**: closing the payment page unpaid blocks every new order on that device, cash included, until the page expires (the configured invoice expiry, 30 minutes today), and for as long as Moyasar or the proxy cannot be reached; a declined last payment does not (the app drops the session) | A reviewer or tester can take the lock for a fault | The review notes and TestFlight step 8 state the lock, its length and the declined-payment exception, and the notes say an order is possible once the server has confirmed the expiry with Moyasar (3.4, 3.5) | If the "Pay another way" action PG-04 proposes ships first, replace the lock sentences with: "If you close it without paying, the next order offers Pay another way, which cancels that page so you can pay in cash instead." (use the button's final name) |
| **PG-24**: a declined card attempt keeps card network, last four, issuer and the decline message on its payment record indefinitely, tied to the account through the checkout session; nothing cleans up abandoned checkouts either | Neither form can say the data is kept "with the order" | "Kept on the payment record, linked to the order or to the checkout session" (2.1, 3.1) | Unchanged wording; add the retention period to the privacy text once one is set |
| **PG-06**: deleting the account deletes the customer's card payment records | The record is not kept for a financial-records duty, so the Play purpose cannot claim compliance | Purpose: **App functionality** only (2.3) | Add *Fraud prevention, security, and compliance* once payment records survive account deletion |
| **PG-26**: "Get a copy of my data" returns no payment records, while its own text says "Everything Spicy Meal holds about you that is personal to you" | The listing's "Request a copy of your data" stays true as a statement that the request exists, but the copy is incomplete once card payment is on | Listing bullet unchanged; the export fix is a knock-on edit, recommended before §47.18 | Nothing to change in the store texts |
| **PG-08**: §47.15's publish set left out the Terms & Conditions, which say cash only (added 2026-11-13), and the rebuild of the public legal page | The listing sends readers to "terms" that contradict it | C-CARD requires all four documents published and the page rebuilt (1.1, 1.2, 3.3) | Nothing to change once §47.15 is corrected |
| **PG-11**: which methods the live page offers is set in Moyasar's dashboard and is unconfirmed | The brand list rests on the owner's word | C-CARD and decision 14 require a device check and Moyasar's written confirmation | Nothing to change once both are done |
| **PG-12**: card payment cannot be tried live with staff only, so the Apple Pay device check needs online payment on | Nothing entered before §47.18 can know Apple Pay works | No Apple Pay in any text until the check passes (decision 5) | Add the Apple Pay sentences after the check; in customer-facing texts, with the policy versions that name it |
| **PG-21, PG-22** (not card-specific): order status moves on only when an administrator moves it in the console, and pending loyalty points become spendable only when an administrator marks the order Delivered | Unchanged lines about status notifications and earning points describe what happens when staff move an order on, which they almost never do (live: 75 of 82 orders `received`) | Unchanged and byte-identical, outside this change ("Left unchanged on purpose") | Nothing to change once orders reliably move on; otherwise take those lines out when the card lines go in [OWNER DECISION] |

---

## Claims the drafter could not verify

1. **That Moyasar's hosted invoice offers Apple Pay inside the app's WebView.**
   Moyasar's documentation is silent. It is `docs/PAYMENTS.md` §11 question 1 and
   the Apple Pay device check in `RELEASE_CHECKLIST.md` §7. Every Apple Pay
   sentence here depends on it.
2. **That the app needs nothing for Apple Pay** (no entitlement, merchant ID or
   domain registration of ours). The reasoning is that the Apple Pay merchant is
   Moyasar's page on Moyasar's domain. Moyasar documents domain registration only
   for a merchant's own website; nothing was found for its hosted invoices.
3. **What Moyasar's hosted card form asks for.** It is expected to ask for the
   name on the card, because Moyasar's card source takes a name, but the live page
   was not seen. Whatever it asks, Moyasar's payment object can bring the name
   back to our server, with the masked number's first six digits, a token and the
   payer IP; the sanitizer drops all four, so nothing beyond what it keeps is
   stored (`moyasar.ts:726-740`; `moyasar.test.ts:647-676`). Whether the live
   object carries each of those fields was not seen either: the test models it.
4. **Where Moyasar stores the data, and for how long.** Moyasar's public
   privacy policy (last revised 8 December 2025) says inside the Kingdom, and
   gives no retention period; neither is confirmed from the Moyasar agreement
   (`docs/RECORD_OF_PROCESSING.md`, recipients table). The store forms do not
   ask this; the privacy policy does.
5. **Whether Moyasar is a "service provider" in Google's sense.** That is the
   Moyasar agreement (decision 3).
6. **The consoles' current state.** Not readable from here. Everything about it in
   this draft is what the records say.
7. **Whether an App Store description can change without a new version.** Apple's
   reference says Promotional Text can; it says nothing either way about the
   description.
8. **Whether, and for how long, Play reviews a listing change before it shows.**
   1.2 is written to be safe either way.
9. **The recorded listing counts.** `LISTING_COPY.md` records 1195 (Arabic) and
   1361 (English) characters for the full descriptions. Counting code points
   without the closing newline gives 1183 and 1349. That same method reproduces the
   other four recorded counts exactly (72, 78, 365, 411), so the two recorded
   figures are probably stale by 12 characters each. The counts in this draft use
   that method.
10. **`PLAY_STORE_SUBMISSION.md` §6a says "eleven types are collected"**, while the
    §6 table marks twelve types collected. This draft does not repeat either
    number; recount on the day.
11. **Whether Moyasar uses the payer's IP address to locate the customer.** No
    answer moves either way ("Left unchanged on purpose").
12. **The reopen window in the review notes and TestFlight step 8** is read from
    the code (row 13), not watched on a device. It is the configured invoice
    expiry, `invoice_expiry_minutes`, read live as 30 on 2026-11-13 and held
    between 5 and 60 by the server, counted from when the payment page first
    opened, and the page ends a minute before its attempt; so the texts say
    "about 30 minutes", and the number must be re-read on the day. Whether
    Moyasar marks an invoice expired exactly at its `expired_at`, and whether a
    3-D Secure payment in flight can still complete after it, are not known
    (`PAYMENTS.md` §11, question 6).
13. **Refund timings** (mada 24 hours to 3 business days, credit cards 7 to 14
    business days, weekends not included) come from Moyasar's FAQ
    (`moyasar.com/en/resources/faqs`, re-read 2026-11-13), as recorded in
    `docs/integrations/Moyasar_API_Reference.md` §3.2. No store text here uses
    them.
14. **How App Review treats a payment it cannot complete without a real charge.**
    Not knowable from here; the attachment in decision 8 is the mitigation.

---

## Sources

Read 2026-11-13.

- Apple, [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) (Last Updated October 16, 2026): 2.3.1(a), 2.5.19, 3.1.1, 3.1.3(e), 4.9.
- Apple, [App privacy details on the App Store](https://developer.apple.com/app-store/app-privacy-details/): "Collect", Payment Info, Purchase History, web views, optional disclosure, updating answers.
- Apple, [Apple Pay Marketing Guidelines](https://developer.apple.com/apple-pay/marketing/).
- Apple, [Acceptable Use Guidelines for Apple Pay on the Web](https://developer.apple.com/apple-pay/acceptable-use-guidelines-for-websites/).
- Apple, [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information) (Promotional Text, Description, What's New).
- Apple, [Age ratings values and definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions) (Unrestricted Web Access).
- WebKit, [New WebKit Features in Safari 13](https://webkit.org/blog/9674/new-webkit-features-in-safari-13/) (Apple Pay in WKWebView, script injection).
- Google, [Provide information for Google Play's Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469): collection, webviews, sharing exceptions, User payment info, the payment-service FAQ.
- Google, [Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738).
- Google, [Financial features declaration](https://support.google.com/googleplay/android-developer/answer/13849271).
- Google, [Financial Services policy](https://support.google.com/googleplay/android-developer/answer/9876821).
- Google, [Choose a developer account type](https://support.google.com/googleplay/android-developer/answer/13634885) (organization account for financial products and services).
- Moyasar, [Apple Pay web registration](https://docs.moyasar.com/guides/apple-pay/web-registration) (seen in search results only, not read in full).
- Repository: `docs/PAYMENTS.md`, `docs/OWNER_ACTIONS.md` §47, `docs/RECORD_OF_PROCESSING.md` activity 15, `docs/integrations/Moyasar_API_Reference.md`, and the code cited in "What changed and why".
- Live, read-only SQL on 2026-11-13: `public.legal_documents` (active rows, and the payment sentences of the four documents), `public.app_settings` (payment switches), `public.integration_settings` (the payment row's provider, `enabled`, mode and `invoice_expiry_minutes` only; no secret field read), the bodies of `begin_checkout_session`, `place_customer_order`, `place_order`, `compute_order_snapshot` and `export_my_data` (keyword checks only), and the foreign keys of `payment_records` and `checkout_sessions`.

---

## Fix log

Against `docs/readiness/20261113-card-payments-reviews/store_answers.review.md`. Each finding was re-checked in the
default branch at `04eb351` or by a read-only live query before it was applied; none
was rejected.

- **B1 → fixed.** Re-verified live: `terms_conditions` 2.0 PAYMENT says cash only in both languages, and the payment, refund and privacy documents say card payment is not available ("Current (live) text"). `terms_conditions` is now in the header's publishing plan, C-CARD's conditions (1.1), 1.2, 3.3, "Read with", Versioning, and a knock-on edit for `OWNER_ACTIONS.md` §47.15 (PG-08). The PAYMENT clause itself is not drafted here: `docs/legal/TERMS_CONDITIONS_CARD_PAYMENTS_DRAFT.md` owns it, so there is one source. Its proposed line, cash "or, where the app offers it, online", agrees with C-CASH and C-CARD.
- **B2 → fixed.** Re-verified: the server fetches the invoice and the payment from Moyasar (`moyasarVerify.ts:81-88`, `:297-298`; `payment-webhook/index.ts:194`), and that object carries the masked number with its first six digits, the name on the card, a token and the payer IP, all dropped by the sanitizer (`moyasar.test.ts:647-676`). The review notes now say what is entered only on Moyasar's page, what our server keeps (card network, last four, issuing bank) and what it drops; 2.1, 3.1, 3.2 and "Left unchanged on purpose" agree.
- **B3 → fixed.** Re-verified: a second settled payment is recorded as a duplicate (`moyasar.ts:930-934`, `:959-975`; `moyasarVerify.ts:144-263`; `PAYMENTS.md` §10, §12; `OWNER_ACTIONS.md` §47.20). "can never be paid twice" is gone; the notes say how the app avoids a second payment, give the window as the configured invoice expiry (`invoice_expiry_minutes`, read live as 30, held 5-60 by `moyasar.ts:259-260`) rather than a fixed value, and say any order, cash included, can be placed once the page has expired and the server has confirmed that with Moyasar (an unreachable Moyasar or proxy keeps the lock, PG-04). A sentence on refunding a duplicate by hand is offered as an owner decision (3.5; PG-02).
- **S1 → fixed.** Re-verified `moyasar.ts:264-269`, `payment-initiate/index.ts:414-416`, `:491-493` and §47.14. C-CARD and 1.2 require the LIVE Test connection to read "Connection OK".
- **S2 → fixed, with an owner decision.** The only source is `PAYMENTS.md:15`, and `RELEASE_CHECKLIST.md` §7 has no methods check. C-CARD requires a device check and Moyasar's written confirmation; knock-on edit for §7; decision 14 (PG-11).
- **S3 → fixed.** Apple's Payment Info row says "Yes (only when the customer pays online)".
- **S4 → fixed.** 3.3 requires the rebuild and the no-JavaScript check of https://app.spicymeal.com.sa/privacy (`OWNER_ACTIONS.md` §34), inside the proposed window.
- **S5 → fixed, with an owner decision.** Re-verified live: `begin_checkout_session` has no `phone_verified` or `order_limit_*` check, `place_customer_order` has both; Google's rule re-fetched from answer 10787469. Play's answer is now Required, with Optional as the wording if PG-17 is fixed first.
- **S6 → fixed.** Re-verified `moyasarVerify.ts:306-310` and `:524` (every check writes `raw`) and the live foreign keys (both `ON DELETE CASCADE`). 2.1, 2.3 and 3.1 say "payment record, linked to the order or to the checkout session" (PG-24).
- **S7 → fixed.** Variant OFF is now paste-ready in full. Its Payment paragraph keeps the first sentence, true either way, and conditions the rest on "When card payment is switched on"; the Card payment paragraph is titled "(switched off at the time of this submission)" and begins "when card payment is switched on".
- **S8 → fixed.** Re-fetched answer 13634885 (an organization account for "Financial products and services, including banking, loans, …"); the account is personal (`PLAY_STORE_SUBMISSION.md` §2). "costs little" is gone, and so is "Google asks for documents only for loan features", which was not re-confirmed.
- **S9 → fixed as a knock-on edit, with an owner decision.** Re-verified live: `export_my_data` reads `payment_records` 0 times, and its `about` text says "Everything Spicy Meal holds about you that is personal to you". Knock-on edit added; the listing bullet is kept, because it states that the request exists; PG-26 is in "Product gaps found".
- **S10 → fixed.** "Left unchanged on purpose" and claim 3 say Moyasar returns the name to our server and the sanitizer drops it.
- **N1 → fixed.** 2.2 conditions the proxy route on `MOYASAR_PROXY_URL` and states that an unusable proxy refuses the request (`moyasarHttp.ts:35-37`).
- **N2 → fixed.** TestFlight step 8 warns of the lock and its length; decision 5 lists step 8's Apple Pay clause.
- **N3 → fixed.** The purpose is now staff display for reconciliation and support; confirmation binds on the invoice id, amount and currency (`moyasar.ts:900-920`) and a refund on Moyasar's payment id.
- **N4 → fixed.** Decision 12 no longer says the texts repeat the footer: it says «صفحة Moyasar الآمنة» is the footer's phrase (`checkout.tsx:221`), that every text puts «عبر» before it, and why the App Store line with Apple Pay alone says «من خلال» (3.6).
- **N5 → fixed.** «والدفع الإلكتروني عملية دفع حقيقية».
- **N6 → fixed.** Re-fetched: 2.5.19 prohibits hidden, dormant or undocumented features, and 2.3.1(a) requires new features to be described in the Notes for Review. Variant OFF cites both, and decision 8 prefers Variant ON.
- **N7 → fixed.** 2.1, 2.3, 3.1, 3.2 and decision 3 list the same items Moyasar receives, the app's language included, as `docs/legal/PRIVACY_POLICY_CARD_PAYMENTS_DRAFT.md` does.
- **N8 → fixed.** Markers added to "shared? No" and to "Required"; "processed ephemerally? No" is stated as a fact rather than a choice, and decision 2 says so.
- **N9 → fixed.** The switch-off sentence is supplied in both languages (3.4).
- **N10 → fixed.** 1.2 says to leave the C-CARD line out of the next release's notes.
- **N11 → fixed.** The TestFlight descriptions no longer say "inside the app"; the Apple Pay sentence names the builds it applies to and waits for the device check.

Not from a finding, from the publishing plan and the sibling drafts: the header
records the proposed plan; nothing entered before the Apple Pay device check names
Apple Pay, the same choice as the payment policy draft (decision 5); the App
Store lines and Promotional Text gain versions without Apple Pay (3.6); and
"Product gaps found" is new.

### Independent re-check, 2026-11-13 22:44 UTC

Against the code in the default branch at `04eb351`, read-only SQL on Production, and
the four sibling drafts as they stood at 22:42 UTC. IDs R1 to R11 are this
check's; none came from the earlier review.

- **re-check: B1 to N11 → confirmed.** Each of the 24 earlier findings is still
  fixed in the text, or justified above (B1's terms clause lives in
  `docs/legal/TERMS_CONDITIONS_CARD_PAYMENTS_DRAFT.md`, whose PAYMENT line, cash "or, where the app
  offers it, online", agrees with C-CASH and C-CARD).
- **re-check: verified, no change.** All 22 quoted current passages are
  byte-identical to the repository files. Live at 22:44 UTC: the four
  `legal_documents` versions and md5s as tabled; the four "not available" / cash
  sentences present in the live text; `online_payment_enabled` false, cash on,
  default cash, outage off; the payment row `moyasar`, enabled, mode `test`,
  `invoice_expiry_minutes` 30, last written 18:17:02 UTC; `begin_checkout_session`
  without the phone or order-limit checks that `place_customer_order` has;
  `export_my_data` without `payment_records`; both foreign keys `ON DELETE
  CASCADE`. Every unchanged line in 1.3, 1.4, 1.5, 3.4 and 3.5 diffs
  byte-identical against its record, and all ten character counts reproduce.
  Re-fetched: Apple's age-rating page (Unrestricted Web Access is a 16+
  capability) and Google's Data safety page (the optional rule, the
  payment-service FAQ, the webview rule, User payment info and its 2022 rename).
- **re-check: R1 (should-fix) → fixed.** The header, 1.2, the 3.4 note and
  decision 6 sent the card texts "right after §47.18 step 1". C-CARD itself
  needs the live page's methods seen on a device, which can only happen in
  §47.18 step 2 with the switch on, and decision 6 also said the texts are not
  sent if §47.18 ends switched off, which "right after step 1" cannot honour. They
  now go out once §47.18 has ended with card payment still on, its step 2
  device checks (the methods check among them) passed.
- **re-check: R2 (should-fix) → fixed.** The review notes, TestFlight step 8,
  decision 9, rows 12 and 13 and PG-04 said any closed, unpaid page holds the
  device until it expires. A declined last payment does not: `payment-verify`
  answers `failed` (`moyasar.ts:483-484`, `:1096-1100`), a terminal answer, and
  the app drops the saved session (`pendingSession.ts:70`, `:83`;
  `CheckoutScreen.tsx:907-908`; `PAYMENTS.md` §4), so cash can be placed at once.
  A reviewer whose card is declined is exactly that case. Entering
  checkout also reopens the page (`CheckoutScreen.tsx:286-297`), as the payment
  policy draft says. Both are now stated.
- **re-check: R3 (should-fix) → owner decision.** The optional duplicate
  sentence ended "and we refund it by hand", offered as true today. It is a
  promise that rests on someone noticing (nothing alerts, PG-02;
  `OWNER_ACTIONS.md` §47.20), and the payment policy draft leaves any such
  promise to one decision with `cancellation_refund_policy` D2 and D3. The
  sentence now says what the code does ("our server records it as a duplicate
  payment to be refunded"), and the bracket ties it to that decision.
- **re-check: R4 (should-fix) → fixed.** The header, 3.2 (twice), 3.3 and
  Versioning gave the privacy version as 2.4. `docs/legal/PRIVACY_POLICY_CARD_PAYMENTS_DRAFT.md` now
  marks it "2.4 (minor) or 3.0 (major)", decided once for the four documents,
  and the refund draft's D6 offers 2.1 against its proposed 3.0. Every reference
  now names "the version that names Moyasar", with the numbers left to that
  decision.
- **re-check: R5 (nit) → fixed.** "English first, then Arabic, wherever a record
  is bilingual" described the layout but read as an English-first order; the
  publishing plan forbids one. Reworded: both languages go out together.
- **re-check: R6 (nit) → fixed.** The ON and OFF notes said the food "is paid
  through a payment provider", while cash stays on; they now say card payment
  for it goes through one.
- **re-check: R7 (nit) → fixed.** "The card number … our servers never receive
  them" now reads "the full card number" (ON, OFF, 2.1, 3.1, 3.2): the server does
  receive the masked number, first six digits included, and drops them
  (`moyasar.ts:726-740`). The privacy and payment drafts say "full card number".
- **re-check: R8 (nit) → owner decision.** Decision 5 and 3.6 let the
  Promotional Text and App Store lines add Apple Pay as soon as the device check
  passed, before any policy names it. The payment policy draft's option (a)
  names Apple Pay "in a later version once that check has passed" and asks for
  the same choice in the store answers. Customer-facing store texts now add it
  in the same window as those policy versions.
- **re-check: R9 (nit) → owner decision.** The unchanged tracking and loyalty
  lines in the listing, release notes, TestFlight text and review notes describe
  what happens when staff move an order on, which today only an administrator
  does (live: 75 of 82 orders `received`, 1 `delivered`; no `earn` row since
  2026-09-07; `lazywait-webhook/index.ts:15-17`;
  `20260918120000_loyalty_earn_on_settlement.sql:65`). Kept byte-identical,
  being outside this change; flagged in "Left unchanged on purpose" and as a
  PG-21/PG-22 row.
- **re-check: R10 (nit) → fixed.** Knock-on added: `APP_STORE_SUBMISSION.md`
  §11's paragraph above the table says card payment is "compiled in and switched
  off", which the ON notes make stale.
- **re-check: R11 (nit) → fixed.** C-CARD's "Decided by" cell now cites
  §47.17 and §47.18, which its conditions rely on.
- **re-check: R12 (nit) → fixed.** The header says the forms declare the same
  payment fields as the privacy draft, whose list starts with "the payment
  method". The sanitizer keeps it (`source.type`, `moyasar.ts:757`), but 2.1 and
  3.1 did not name it; both now list the payment type (card or Apple Pay).

### Final review, 2026-11-14

One line per review finding on this file. Each was checked against the
repository at `ebdec3a`, Moyasar's own pages and read-only SQL (the payment row
re-read on 2026-11-14: `moyasar`, enabled, `test`, last written 2026-11-13
18:17:02 UTC) before it was applied. No customer-facing text changed: the
listing descriptions, release notes, TestFlight descriptions, review notes, App
Store lines and Promotional Texts are byte-identical, so the ten character
counts stand. Only two record texts changed, the 1.2 paragraph and the 3.4
note.

- **K6 → applied.** No owner decision on the publishing plan is recorded
  anywhere. The header now reads "Publishing plan (proposed; the owner
  decides)", and "decided window" and "decided plan" became "proposed" in row
  2, decision 6, the S4 line, the "Not from a finding" paragraph and the
  knock-on list.
- **K12, L3, C2 → applied.** The note on the payment row said `PAYMENTS.md` §1
  and G1 record it as disabled; both have said enabled since 2026-11-13, and
  the note now says so. In "Knock-on edits in other records", the row-state
  item is marked done (2026-11-13). The §47.15 item is marked done too:
  `terms_conditions` was added on 2026-11-13, and the plan, the rebuild with
  its no-JavaScript check, and the order of these answers were added in this
  review. The PG-08 row says the terms were added.
- **C12 → applied, by rewording.** The finding allows either adding the
  methods check to `RELEASE_CHECKLIST.md` §7 and §47.18 step 2, or rewording
  this file; both of those are outside this file. The header, 1.2, the 3.4 note
  and decision 6 no longer say the methods check is one of §47.18 step 2's
  checks. They say it must first be added there and to the checklist, and the
  knock-on item now asks for both.
- **X3 → applied (claim 4).** Moyasar's public privacy policy (last revised 8
  December 2025) says it keeps personal data inside the Kingdom and gives no
  retention period; neither is confirmed from the Moyasar agreement.
- **X2, K11 → applied (claim 13).** The timings are now Moyasar's FAQ figures
  in business days, as recorded in `Moyasar_API_Reference.md` §3.2, and "were
  not re-read" is gone.
