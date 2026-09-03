# Design-system migration tracker

Tracking for [#119](https://github.com/mohammedali-770/SMA/issues/119).

**Strategy: surface-by-surface replacement.** The product is pre-production —
no users, no customer data, no requirement to preserve the current UI — so
legacy components are replaced outright rather than maintained in parallel, and
removed as soon as nothing references them. Consistency beats backwards
compatibility.

**That premise has expired, recorded 2026-09-03.** It was true when the strategy
was chosen; it is not true now. There are **68 real orders** in Production, real
saved addresses, and push notifications that reach real customer devices
(`GO_LIVE_READINESS.md` X5, live-verified; `CLAUDE.md` §7). The remaining
unmigrated surfaces are all **Admin**, so "replace outright" still costs no
customer anything — but it is now a judgement about staff workflow rather than a
free move, and nothing on this page licenses a customer-facing rewrite.

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
| 2 | Customer App — Order Tracking / Receipt | ✅ **Done** — this PR |
| 2 | Customer App — Profile | ✅ **Done** — this PR |
| 2 | Customer App — Order Type Selection | ✅ **Done** — this PR |
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

## Surface 5 — Order Tracking + Receipt + Profile ✅

Orders, Receipt, Profile, Delete Account, Notification settings and the Legal /
Support screens.

`OrdersScreen` and `ReceiptScreen` now own **fetching and polling only**; the
order card, the confirmation hero, the receipt body and the skeletons are pure
components under `features/orders/view`. That split is what makes the order
states reviewable: the screens call `orders.byId` / `orders.listWithItems` on
mount and `orders.requestResend` is a real POS action, so the fixture renders
the COMPONENTS against fixed mock orders and never mounts the screens.

The confirmation states in those fixtures are not hand-written. Each mock order
sets the RAW inputs the real state machine reads — payment status, sync state,
POS ref, blocked reason, retry count, refund state — and
`orderConfirmationState` derives the state exactly as in production, so the
fixtures move with the machine instead of quietly disagreeing with it.

**Preserved verbatim:** the order-status map, the focus/poll cycle and its
terminal-status no-op, stale-while-revalidate on the list, the resend debounce,
`accountDeletion` submit, the hardware-back lock, the OTP/reauth fallback
choice, and the automatic post-acceptance sign-out (including `deactivateThisDevice`
running before the JWT disappears).

Fixes found by the fixture pass:

* two confirmation tone maps had already drifted — `danger` resolved to
  `colors.danger` in the receipt and `colors.red` in My Orders. One map now;
* an order card with no branch number printed the state title as BOTH heading
  and chip. The old rule named two states explicitly; the real rule is "never
  repeat the heading", which is exactly `branchNo != null`.

**Deferred by this pass: name editing and address management.** The screen's own
docblock recorded them as deferred, and at the time the addresses API was touched
only by Checkout and the order-type gate. Adding them meant new profile writes and
address CRUD — feature work rather than a design migration, and this pass added no
API calls, so they were tracked separately.

**CORRECTED 2026-09-03 — both have since been built, and this paragraph claimed
"Neither exists in the app" for as long as they have existed.** Name and email
editing is `features/profile/EditableName.tsx`, which writes `full_name` and
`email` through `profileService.updateCustomerProfile`. Address management is
`AddressListScreen` and `AddressEditScreen`, behind `/profile/addresses` and
`/profile/address/[id]`, backed by `AddressProvider`'s `create` / `update` /
`remove` / `setDefault`. Both are reached from the Profile screen; the Addresses
row was moved onto an auth guard the same day (#324). The deferral above is kept
because it accurately records what THIS pass chose not to do — it simply stopped
being a description of the app.

## Surface 6 — Order Type Selection + legacy removal ✅

The blocking order-type gate migrated, and with it the last legacy consumers.

**Deleted:** `apps/mobile/src/theme.ts`, `components/Button.tsx`,
`components/Notice.tsx`. The mobile app now has **zero** legacy UI.

The hygiene guard changed from an allowlist to a **global ban**: it walks the
whole `apps/mobile/src` tree, so the rule cannot be sidestepped by adding a new
file — which is exactly what the per-surface list could not prevent. It also
fails if any of the three deleted files reappears. Both branches were
negative-tested.

**Tablet width** now uses one shared container, `design-system/ui/ContentColumn`,
promoted from the pattern Checkout adopted first: `alignItems` on the scrolling
parent plus `width: '100%'` up to a 640px cap on the child. `CONTENT_MAX_WIDTH`
has exactly one definition. Applied to Checkout, Order Tracking, Receipt,
Profile and Order Type Selection. On the orders list the cap sits on each ROW,
not the scroller, so the pull-to-refresh control still spans the full width.

**Preserved verbatim:** branch selection, the pickup/delivery rules, the
location permission flow, `validateCartForBranch` and the cart-conflict sheet,
`resolveDeliveryBranch`, the mandatory-landmark rule, the blocking hardware-back
behaviour and every navigation target.

Contrast fix caught in review: the busy overlay was a LIGHT scrim with dark
text; moving it to the shared dark `scrim` token would have made the label
invisible, so its spinner and label are now white.

## Remaining legacy inventory

| Surface | Legacy usage |
| --- | ---: |
| Mobile legacy theme / Button / Notice | **ZERO — deleted** |
| Web raw `<button>` | 129 (24 `glass-btn-*`) |
| Web raw `<input>` | 72 (64 `glass-input`, 10 `edit-input`) |

The legacy `Button` and `Notice` are deleted once Order Tracking and Profile
land. The web side has no shared Button or Field at all; admin panels use raw
elements with `.glass-*` utilities, deleted once the last panel is migrated.
