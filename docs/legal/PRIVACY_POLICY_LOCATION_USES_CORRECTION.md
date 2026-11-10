# Privacy policy — device location is used for more than the delivery pin

> **Status: DRAFT, awaiting owner publication.** Editing a live `legal_documents`
> row is a CLAUDE.md §5 action and is not something an agent does. This file
> holds the exact replacement text and the evidence behind it, so publishing is
> a copy-paste in the admin console rather than a rewrite.
>
> **Found 2026-11-10**, while rewriting the iOS location purpose string to name
> every use (pull request #425). The policy has the same gap the purpose string
> had, and **it already applies to the app customers have today**: none of the
> uses below is new in #425.

## The defect, stated precisely

`privacy_policy` **v2.3**, effective 2026-09-16, active, says in both languages:

| Language | Live text |
| --- | --- |
| EN | `Device location: your location, only while you are choosing a delivery point on the map, and only if you allow it. We do not follow your location in the background.` |
| AR | `موقع الجهاز: موقعك، فقط أثناء تحديدك لنقطة التوصيل على الخريطة، وفقط إذا سمحت بذلك. ولا نتتبع موقعك في الخلفية.` |

The app uses the device location in **three** places, and the policy names one:

| Where | What it does with the location | Leaves the phone? | Evidence |
| --- | --- | --- | --- |
| Delivery map, "Use my location" | Moves the delivery pin to where the customer is, at high accuracy | **Only the point the customer then picks**, which becomes the delivery address (already disclosed under "Delivery address") and is shown on Google's map | `apps/mobile/src/components/LocationPickerMap.tsx:203`, `Accuracy.High` |
| Pickup tab | Lists the branches nearest to the customer | **No** — the distance is computed on the device (`distanceKm`) and only orders the list | `apps/mobile/src/features/order/OrderTypeSelectScreen.tsx:44,71,82`, `Accuracy.Balanced` |
| Checkout, delivery orders | Warns when the delivery pin is far from where the customer is standing | **No** — compared on the device; it never asks, it only reads a permission already given | `apps/mobile/src/features/checkout/CheckoutScreen.tsx:258` → `deliveryLocationWarning.ts` |

The pickup and checkout uses are present in the earliest history this check
could read (2026-09-13), so the policy has been behind the app since at least
v2.3's publication. Neither use sends the location anywhere, which is why this
is a disclosure gap rather than an undisclosed transfer — but PDPL disclosure is
about **purposes**, and two of the three are missing.

Until the 2026-11-10 change in #425, the app also asked for location on the
first run after sign-in, with no context at all. #425 removes that prompt, so
after the next build location is asked only on the pickup tab and at "Use my
location" — exactly the uses the text below names.

## Replacement text

Replace the single "Device location" line. Nothing else in the document changes:
"Delivery address" already covers the saved pin, and the Google line already
names who draws the map and receives its coordinates.

**EN**

```
Device location: your location, only while the app is open and only if you allow it. We use it for three things: to list the branches nearest to you when you choose pickup, to place your delivery pin precisely at your door, and to warn you at checkout if your delivery pin is far from where you are. Of these, only the delivery point you choose is saved, as your delivery address. We do not follow your location in the background.
```

**AR** *(engineering-drafted — needs the native read in `OWNER_ACTIONS.md` §35)*

```
موقع الجهاز: موقعك، فقط أثناء فتح التطبيق وفقط إذا سمحت بذلك. ونستخدمه لثلاثة أمور: لعرض أقرب الفروع إليك عند اختيار الاستلام، ولوضع دبوس التوصيل بدقة عند بابك، ولتنبيهك عند إتمام الطلب إذا كان دبوس التوصيل بعيداً عن مكانك. ولا نحفظ من ذلك إلا نقطة التوصيل التي تختارها، بوصفها عنوان التوصيل. ولا نتتبع موقعك في الخلفية.
```

The English uses the same three uses, in the same order, as the iOS purpose
string #425 ships, so the permission prompt and the policy say the same thing.

## Publishing

1. Admin console → Legal → `privacy_policy`, replace the line in both languages.
2. Bump the version to **v2.4** and set the effective date to the publication
   date. Adding a purpose is a substantive change, not a typo fix.
3. The public pages update with no redeploy (`docs/GO_LIVE_READINESS.md` B7).
4. Record it in `docs/OWNER_ACTIONS.md` §43 and close that item.

**Do not publish the Arabic without a native read.** The English is safe to
publish on its own if the Arabic has to wait — a correct English disclosure
beside an unchanged Arabic one is strictly better than leaving both incomplete.

**The order does not depend on #425.** Both uses this adds are in the app
customers already have, so the correction is due now rather than with the next
build.
