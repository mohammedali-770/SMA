# Design-system migration tracker

Tracking for [#119](https://github.com/mohammedali-770/SMA/issues/119).

**Strategy: surface-by-surface replacement.** The product is pre-production —
no users, no customer data, no requirement to preserve the current UI — so
legacy components are replaced outright rather than maintained in parallel, and
removed as soon as nothing references them. Consistency beats backwards
compatibility.

Business logic, auth flow, payment logic, order workflow, pricing, APIs,
Supabase, Edge Functions and migrations are **not** touched by any surface pass.
Where a component mixed logic and presentation, the logic is extracted first.

## How a completed surface is kept from regressing

`scripts/check-design-system-hygiene.mjs` holds a `MIGRATED_SURFACES` list. A
file on that list may not import the legacy `theme` module or the legacy
`components/Button`, and CI fails if it does. Add files as each surface lands;
never remove them.

---

## Progress

| # | Surface | Status |
| --- | --- | --- |
| 1 | **Authentication** | ✅ **Done** — PR #123 |
| 2 | Customer App — Home / Menu | ✅ **Done** — PR #124 |
| 2 | Customer App — Product Details | ✅ **Done** — PR #125 |
| 2 | Customer App — Cart | ✅ **Done** — PR #125 |
| 2 | Customer App — Checkout | ✅ **Done** — this PR |
| 2 | Customer App — Payment | ✅ **Done** — this PR |
| 2 | Customer App — Order Tracking | ⬜ |
| 2 | Customer App — Profile | ⬜ |
| 3 | Admin — Dashboard | ⬜ |
| 3 | Admin — Live Orders | ⬜ |
| 3 | Admin — Menu Management | ⬜ |
| 3 | Admin — Branches | ⬜ |
| 3 | Admin — Promotions | ⬜ |
| 3 | Admin — Reports | ⬜ |
| 3 | Admin — Settings | ⬜ |

---

## Surface 1 — Authentication ✅

| File | What changed |
| --- | --- |
| `features/auth/LoginScreen.tsx` | Cream ground, DS `Text` + `Card`; the WhatsApp-unavailable panel is now a `warning` card. Legal links keep the platform `Text` because inline links must compose inside one text node. |
| `features/auth/PhoneOtpLogin.tsx` | DS `Button` + `Text`; the code destination renders mono (structured number). |
| `features/profile/VerifyPhoneWhatsApp.tsx` | DS `Card` + `Button` + `Text`; drop-shadow removed. |
| `components/SaudiPhoneInput.tsx` | DS tokens, mono digits, ember focus edge, `error` prop. **Removed the "Saudi numbers only" helper line** — the `+966` prefix and the phone keypad already say it, and the DS voice rule is that a field never explains the format in advance. |
| `features/otp/OtpCodeInput.tsx` | DS tokens; OTP boxes render in IBM Plex Mono. |

New primitives added for this surface: `design-system/ui/Text.tsx` (language-aware
IBM Plex + the type scale) and `design-system/ui/Card.tsx` (flat surface with
semantic tints). Semantic tint tokens (`warnTint`/`warnLine`, `dangerTint`,
`infoTint`, `mintTint`) were added to the canonical token set rather than being
inlined — the hygiene check caught them as hardcoded colours.

**Unchanged:** every handler, the Supabase `signInWithOtp` / `verifyOtp` calls,
`requestLoginCode`, `sanitizeSaudiNationalInput`, `toSaudiE164`, the OTP autofill
and cooldown hooks, keyboard types, `textContentType` / `autoComplete` autofill
wiring, and all accessibility labels.

## Surface 4 — Checkout + Payment ✅

`CheckoutScreen` was 1,032 lines mixing payment-session orchestration with
layout. It now owns **state and decisions only**; every piece of layout moved to
`features/checkout/view/*` as pure presentational components.

That split is not cosmetic. The payment states live in the screen's own state
rather than in context, so before `PaymentStatusDialog` was extracted there was
no way to look at "declined", "expired" or "still pending" without running a
real charge. The dev fixture now renders that component directly, one scene per
state, with every handler inert.

Also migrated: `app/payment/checkout.tsx` (chrome only — the WebView props are a
frozen security surface and are byte-identical) and `app/payment/return.tsx`.

**Verified byte-identical** by diffing the logic half of the file: every effect,
handler and guard — mount recovery, `placeOrder`, `runTapPaymentSession`,
`verifyPaymentSession`, `retryFresh`, the single-flight `payRunningRef`, the
`recalcRef` double-tap guard, `changeQuantity`, coupon validation, the
address-resolution branch and every `router` call.

Fixes found by the fixture pass, not by reading:

* the below-minimum message printed **"31.00 SAR"** — the letters, which the
  design system forbids for a visible amount. `Notice` gained an `amount` slot
  so the figure renders through `<Price>` with the SAMA glyph;
* the delivery problem rendered as a full red notice **twice** on one screen;
* "Promo code" and "Notes for the kitchen" appeared as both a section heading
  and a field label — `Field` gained `labelHidden` (visual only; still
  announced);
* the payment dialog stacked three near-identical buttons, so the dismissal read
  as loud as the retry. `Close` is now `ghost`;
* the column now caps at 640px so a tablet does not stretch checkout to a
  120-character line and drag the money away from its labels.

## Removed

`components/QuantityStepper.tsx` — deleted, zero references. Checkout was its
last consumer; the design-system `QtyStepper` absorbed its `busy` guard and
per-item accessibility labels.

## Remaining legacy inventory

| Surface | Legacy usage |
| --- | ---: |
| Mobile `<Button>` (legacy) | 3 files: `DeleteAccountScreen`, `OrderTypeSelectScreen`, `ReceiptScreen` |
| Mobile `components/Notice` | 1 file: `OrderTypeSelectScreen` |
| Web raw `<button>` | 129 (24 `glass-btn-*`) |
| Web raw `<input>` | 72 (64 `glass-input`, 10 `edit-input`) |

The legacy `Button` and `Notice` are deleted once Order Tracking and Profile
land. The web side has no shared Button or Field at all; admin panels use raw
elements with `.glass-*` utilities, deleted once the last panel is migrated.
