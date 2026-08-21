# Tap Payments API — Reference (researched, not vendor-supplied)

> **PROVENANCE.** This file was assembled on **2026-08-19** by reading Tap's
> **public** developer documentation and Tap's public GitHub organisation. It is
> **not** a vendor-supplied document and has **not** been confirmed by Tap or
> validated against a live Tap account. Anything account-specific — key values,
> merchant IDs, which payment methods are enabled — is unknowable from here and
> is listed under "Open questions" at the end.
>
> When Tap supplies their own reference, commit it here and treat it as
> authoritative over this file.

> **THE PAYMENT FREEZE IS STILL IN FORCE.** See `docs/PAYMENT_POSTPONEMENT.md`.
> Nothing in this document authorises enabling online payment, deploying a
> payment Edge Function, or applying a migration. The agreement with Tap is
> **not signed**, and online payment stays **disabled** regardless of whether
> the code is ready (owner instruction, 2026-08-19).

Our implementation: `supabase/functions/_shared/tap.ts` (payload builder, webhook
hash, status mapping), `supabase/functions/_shared/tapRefund.ts` (refund body and
response classification), `supabase/functions/_shared/tapVerify.ts` (charge
retrieve + verification binding), and the `payment-*` Edge Functions.

---

## 1. Authentication

| | |
| --- | --- |
| Scheme | `Authorization: Bearer <key>` |
| Secret key prefix | `sk_` — e.g. `sk_test_…`, and a live equivalent |
| Base URL | `https://api.tap.company/v2` |

**The secret key is server-only.** It is injected by our Edge Functions and must
never appear in the mobile bundle, a client response, or a log. Tap's public
authentication page documents only the `sk_` secret key; whether a
publishable/public key exists for client-side SDK use is **not** established
here and is open question **Q1** — it matters, because the card SDK needs a key
in the app and it must not be `sk_`.

## 2. Idempotency — the field that was in the wrong place

`reference.idempotent` is a string that **restricts duplicate transactions**.
Passing the same string returns the **original** response instead of creating a
second charge, authorization or refund.

| | |
| --- | --- |
| Location | **Inside** the `reference` object — there is **no top-level `idempotent` field** |
| Applies to | Authorize, Charges, **Refunds** |
| Validity | **24 hours** |
| On duplicate | The first response is returned; no new transaction is created |

**This repository had it in the wrong place.** `buildTapChargePayload` sent
`idempotent` as a top-level field, which Tap's schema does not define, so it was
discarded and charges were never deduplicated — a retried `payment-initiate`
could have created a second charge. Fixed on `fix/tap-idempotent-placement`;
`tap.test.ts` now pins the value inside `reference` and fails if it moves back.
The previous test asserted the broken shape, so it certified the bug rather than
catching it.

**Refunds now send it too.** `buildRefundBody` previously sent only
`reference.merchant`, which is a *reconciliation* reference and deduplicates
nothing — exactly the gap `PAYMENT_POSTPONEMENT.md` §7 identified as the
double-refund risk. It now sends `reference.idempotent` as well.

**This bounds the §7 risk; it does not close it.** The idempotent string expires
after 24 hours, so a refund retried beyond that window is a genuinely new refund
to Tap. Our own database claim remains the primary control, and §7 must still be
resolved before automated refund processing is re-enabled.

## 3. Endpoints we use

| Method | Path | Used by |
| --- | --- | --- |
| POST | `/v2/charges` | `payment-initiate` |
| GET | `/v2/charges/{id}` | `tapVerify.ts`, `payment-verify` |
| POST | `/v2/refunds` | `payment-refund` |
| GET | `/v2/refunds/{id}` | **not used yet** — see §5 |

### 3.1 Create a charge — `POST /v2/charges`

Required: `amount`, `currency`, `customer`, `source`, `redirect`.

Other top-level fields Tap documents: `customer_initiated`, `threeDSecure`,
`save_card`, `payment_agreement`, `description`, `order`, `metadata`, `receipt`,
`reference`, `merchant`, `post`, `payment_provider`, `platform`.

`reference` object:

| Field | Meaning |
| --- | --- |
| `transaction` | Merchant transaction reference |
| `order` | Merchant order reference — **our verification binding** |
| `idempotent` | Duplicate restriction (§2) |

**`reference.order` is load-bearing for us.** `validateAndConfirmTapCharge`
binds verification to it, so it must carry the exact stored attempt reference.
`docs/ORDER_CONFIRMATION_FLOW.md` §10b records why `description` is a constant
and must never be used for binding.

### 3.2 Create a refund — `POST /v2/refunds`

Top-level: `charge_id`, `amount`, `currency`, `reason`, `destinations`, `post`,
`metadata`, `reference`.

`reference` object: `merchant` (reconciliation) and `idempotent` (§2). We send
the same deterministic per-refund key as both.

## 4. Mobile SDKs (from the 2026-08-19 spike)

Tap publishes React Native wrappers. Scope confirmed by the owner is **Apple Pay,
Google Pay and card only** — no STC Pay, Tamara or Tabby.

| Purpose | Package / repo | Last updated |
| --- | --- | --- |
| Card fields + tokenisation | `card-react-native` (`Tap-Payments/Card-React-Native`) | 2026-06-28 |
| Apple Pay | `Tap-Payments/TapApplePayKit-RN` | 2026-06-18 |
| Google Pay | `Tap-Payments/TapGooglePayKit-ReactNative` | 2026-05-06 |

**Do not use `Tap-Payments/Checkout-ReactNative`.** Despite the promising name it
is an unmodified `create-react-native-library` scaffold — it still exports the
template's `multiply()` example. `gosellSDK-ReactNative` is the older goSell
product (last touched 2025-12) and covers methods that are now out of scope.

### 4.1 The New Architecture problem — verified, with a fix

`card-react-native@1.0.8` ships a **legacy paper view manager on both
platforms** — `RCTViewManager` (iOS) and `SimpleViewManager` (Android) — and
declares **no `codegenConfig`**, so it is not a Fabric component. We are on
React Native **0.86.2** / Expo SDK 57, where the New Architecture is mandatory
and cannot be disabled, so the view must go through the interop layer.

The platforms differ, and the difference is the whole risk:

| Platform | Status |
| --- | --- |
| **Android** | Works as-is. `ReactNativeFeatureFlagsDefaults.useFabricInterop()` returns `true` by default and view managers resolve via `ViewManagerRegistry`. |
| **iOS** | **Fails silently without a fix.** `RCTLegacyViewManagerInteropComponentView` matches a hardcoded allowlist — `DatePicker`, `ProgressView`, `MaskedView`, the ART views — and a third-party component is not in it. |

The failure mode is misleading: `card-react-native`'s `index.tsx` guards with
`UIManager.getViewManagerConfig(...) != null` and substitutes a component that
throws its generic *"did you rebuild / are you on Expo Go"* linking error, which
points at a build problem that does not exist.

**The fix** is to register the component before first render:

```objc
[RCTLegacyViewManagerInteropComponentView
    supportLegacyViewManagerWithName:@"CardSdkReactNativeView"];
```

We have no `ios/` directory (Expo CNG), so this requires an Expo config plugin.
One was written and unit-tested during the spike but is **not committed** — it is
payment work under the freeze and needs its own owner approval.

**Not proven:** whether the card fields actually render once registered, and
whether Tap's Android SDK dependencies collide with Expo SDK 57. Both need an
EAS build on a real device.

## 5. Open questions for Tap

| # | Question | Why it matters |
| --- | --- | --- |
| **Q1** | Is there a publishable/public key for client-side SDK use, and what is its prefix? | The card SDK needs a key in the app. `sk_` must never ship in a bundle. |
| **Q2** | Are Apple Pay and Google Pay enabled for our account, and what merchant-ID setup is required? | Neither is configured in `apps/mobile/app.json` today. |
| **Q3** | Is `GET /v2/refunds/{id}` a reliable status lookup for an ambiguous refund attempt? | `PAYMENT_POSTPONEMENT.md` §7 accepts *either* idempotency *or* a status lookup. With the 24-hour expiry on the former, the latter is what would fully close it. |
| **Q4** | What is the charge webhook's exact hashstring field order? | `computeChargeWebhookHash` implements one; it is unverified against a live webhook. |
| **Q5** | Does `card-react-native` support the React Native New Architecture, and is a Fabric-native version planned? | Decides whether §4.1's interop shim is a stopgap or permanent. |
| **Q6** | Are the RN SDKs supported on Expo (config plugin), or is a hand-written plugin expected? | None of the three mention Expo. |

## 6. What this document does NOT establish

- Any account-specific value: keys, merchant IDs, enabled payment methods.
- That any of the above works against a live or sandbox Tap account. **No Tap API
  call has been made from this repository during this research.**
- Fee structure, settlement timing, or anything commercial.
- That the mobile SDKs render correctly on a device (§4.1).

---

**Sources.** [Authentication](https://developers.tap.company/docs/authentication) ·
[Idempotency](https://developers.tap.company/docs/idempotency) ·
[Create a charge](https://developers.tap.company/reference/create-a-charge) ·
[Create a refund](https://developers.tap.company/reference/create-a-refund) ·
[Tap-Payments on GitHub](https://github.com/orgs/Tap-Payments/repositories)
