# Privacy policy — the map sub-processor is named wrongly

> **Status: DRAFT, awaiting owner publication.** Editing a live `legal_documents`
> row is a CLAUDE.md §5 action and is not something an agent does. This file
> holds the exact replacement text and the evidence behind it, so publishing is
> a copy-paste in the admin console rather than a rewrite.
>
> **Found 2026-09-10** during the go-live re-verification. It is the only case
> found where a live legal document states something the software does not do.

## The defect, stated precisely

`privacy_policy` **v2.1**, effective 2026-09-08, active, lists sub-processors in
both languages. One line reads:

| Language | Live text |
| --- | --- |
| EN | `Mapbox — the map you use to choose a delivery location.` |
| AR | `Mapbox — الخريطة التي تستخدمها لاختيار موقع التوصيل` |

**Mapbox is named. Google is not** — the only mention of Google anywhere in the
document is `Expo, with Apple (APNs) and Google (FCM) — delivery of push
notifications to your device`, which is the push channel, not the map.

That matters more than a typo would, for three reasons:

1. The delivery-point map receives **the coordinates of the customer's door** —
   the most precise personal data the app handles.
2. This document is served at `https://app.spicymeal.com.sa/privacy`, which is
   **the URL destined for both store listings**. Apple's privacy labels and
   Play's data-safety form both have to agree with it.
3. PDPL disclosure runs on the *actual* recipients. A named processor that
   receives nothing, beside an unnamed one that receives the coordinates, is the
   wrong disclosure in both directions at once.

## The evidence

The app is built to support **both** providers and picks one at build time —
`apps/mobile/src/lib/map.ts`:

```ts
export type MapProvider = 'mapbox' | 'google';
const provider: MapProvider = MAP_PROVIDER === 'google' ? 'google' : 'mapbox';
isConfigured: provider === 'mapbox' ? Boolean(MAPBOX_PUBLIC_TOKEN) : Boolean(GOOGLE_MAPS_BROWSER_KEY),
```

So source alone cannot answer which provider ships. The **built artifact** can,
and it was read on 2026-09-10 from the live customer web channel
(`https://app.spicymeal.com.sa/app`, entry bundle
`entry-37a202dd2c65fa07e82c31fa66f5f47c.js`, 4 429 268 bytes):

| Probe | Result | Reading |
| --- | --- | --- |
| Mapbox public-token prefix `pk.` | **0 occurrences** | `MAPBOX_PUBLIC_TOKEN` is empty in the shipped build |
| Google API-key prefix `AIza` | **1 occurrence** | `GOOGLE_MAPS_BROWSER_KEY` is populated |
| `maps.googleapis.com/maps/api/js` | present | the Google JS embed is the map that can initialise |

With no Mapbox token, `isConfigured` is false on the Mapbox branch — so the map
either runs on Google or does not run at all. It runs. `apps/mobile/src/lib/googleMaps.ts`
and `src/components/MapSearchBox.tsx` additionally use **Google Places** for
address search, which is a second flow of the same data and is likewise
undisclosed.

**The honest limit of this evidence, stated rather than glossed.** It proves the
**web** channel. The native iOS binary (build 22, 2026-08-26) was built from a
separate EAS environment whose `EXPO_PUBLIC_MAP_PROVIDER` is not readable from a
session. Both providers are compiled into both artifacts. So either:

- the native build also uses Google, and the correction below is simply right; or
- the native build uses Mapbox, and the policy needs to name **both**, because
  both then receive delivery coordinates from customers on different platforms.

**Determine this before publishing**, by reading `EXPO_PUBLIC_MAP_PROVIDER` and
`EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN` in the EAS `production` environment. It is one
look, and it decides which of the two texts below to publish.

## Replacement text — Option A (Google only; correct if the native build also uses Google)

Replace the single Mapbox line. Nothing else in the document changes.

**EN**

```
Google — the map and address search you use to choose a delivery location. It receives the map coordinates of the point you pick.
```

**AR** *(engineering-drafted — needs the same native read as `OWNER_ACTIONS.md` §29/§33a)*

```
Google — الخريطة والبحث عن العناوين اللذان تستخدمهما لاختيار موقع التوصيل. وتتلقى إحداثيات النقطة التي تحددها.
```

## Replacement text — Option B (both, if the two platforms differ)

**EN**

```
Google and Mapbox — the map and address search you use to choose a delivery location. Whichever the app uses on your device receives the map coordinates of the point you pick.
```

**AR** *(engineering-drafted)*

```
Google وMapbox — الخريطة والبحث عن العناوين اللذان تستخدمهما لاختيار موقع التوصيل. وتتلقى الخدمة المستخدمة على جهازك إحداثيات النقطة التي تحددها.
```

## A second, smaller wording gap in the same document

Not a false statement, so not urgent — but it is the same subject and would be
cheapest to publish together.

The document says:

```
Device location: your location, only while you are choosing a delivery point on the map, and only if you allow it. We do not follow your location in the background.
```

The word **precise** does not appear anywhere in the policy, while the app
requests `ACCESS_FINE_LOCATION` and `Location.Accuracy.High` in the delivery-pin
picker (`LocationPickerMap.tsx`). That is a deliberate, defensible design — it
is what puts the pin at the right door — and the iOS purpose string was
corrected to say so on 2026-09-09. The policy is the one surface still
describing it in the older, vaguer terms.

Suggested EN, if published alongside the above:

```
Device location: your precise location, only while you are choosing a delivery point on the map, and only if you allow it. Precise location is what puts the delivery pin at the right door. We do not follow your location in the background.
```

**AR** *(engineering-drafted)*

```
موقع الجهاز: موقعك الدقيق، فقط أثناء تحديدك لنقطة التوصيل على الخريطة، وفقط إذا سمحت بذلك. والموقع الدقيق هو ما يضع مؤشر التوصيل عند الباب الصحيح. ولا نتتبع موقعك في الخلفية.
```

## Publishing

1. Read `EXPO_PUBLIC_MAP_PROVIDER` in the EAS `production` environment; pick
   Option A or B.
2. Admin console → Legal → `privacy_policy`, edit both languages.
3. Bump the version to **v2.2** and set the effective date to the publication
   date. Changing the sub-processor list is a substantive change, not a typo fix.
4. The public pages update with no redeploy (`docs/GO_LIVE_READINESS.md` B7).
5. Record it in `docs/OWNER_ACTIONS.md` §34 and close that item.

**Do not publish the Arabic without a native read.** Every Arabic string in this
file is engineering-drafted, which is the standing caveat in `OWNER_ACTIONS.md`
§29 and §33a. The English is safe to publish on its own if the Arabic has to
wait — a correct English disclosure beside an unchanged Arabic one is strictly
better than leaving both wrong.
