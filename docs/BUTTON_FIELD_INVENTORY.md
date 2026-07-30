# Button & Field migration inventory

Tracking for [#119](https://github.com/mohammedali-770/SMA/issues/119) — moving
call sites onto the "Ember on Cream" `Button` and `Field`.

**Status: behaviour consolidated, no call sites swapped yet.** See
"Why nothing was swapped in the first pass" below — that is a deliberate finding,
not an omission.

---

## What the design-system components change

Swapping a call site changes **two** things at once, not one:

| | Legacy | Design system |
| --- | --- | --- |
| Primary colour | purple `#422e87` | ember `#E02D3D` |
| Typeface | system font | IBM Plex Sans / Sans Arabic |

Nothing shipped uses IBM Plex today (the faces were registered in #118 but no
screen consumes them). So the first swapped button is the first Plex text in the
product, sitting beside system-font headings.

## Why nothing was swapped in the first pass

The brief asked for "shared, low-risk call sites first". Working through the
inventory, **no call site is currently low-risk to swap in isolation**: because
the delta is colour *and* typeface, a partial swap produces a visibly
half-migrated screen in production, and the smallest available units
(`StateViews`, 2 buttons) deliver almost no value while looking broken next to
their own headings.

The migration unit that does work is a **whole surface at once** — every button
*and* input on a screen — so the screen is at least internally consistent. That
is a larger, screen-shaped change and belongs in its own PR with its own visual
pass, which is exactly what #119 item 1 describes.

What this pass does instead is the part that is genuinely low-risk and high value:
consolidate the *behaviour* so every legacy call site is protected today, and
write down the complete map so the surface-by-surface swaps are mechanical.

## What this pass DID change

`apps/mobile/src/components/Button.tsx` now derives its disabled / loading /
accessibility rules from the shared framework-free `buttonState` module, and
**guards `onPress`** instead of handing it straight to `Pressable`.

Previously nothing stopped a caller — or a `Pressable` edge case — invoking the
handler while the button was mid-flight. On payment-retry and place-order that
is a double submit. All **42** legacy call sites are covered by that one change.

Pixels are unchanged: the background still greys for both disabled *and*
loading, the label colour rule is untouched, and `accessibilityState` resolves
to exactly the same values it did before.

---

## Mobile — `<Button>` call sites (42)

| File | Sites | Tier | Decision |
| --- | ---: | --- | --- |
| `features/checkout/CheckoutScreen.tsx` | 12 | **Excluded** | Payment submission, coupon apply, order-type change. Out of scope by the brief. |
| `features/account/DeleteAccountScreen.tsx` | 8 | **Excluded** | Destructive, irreversible; re-verification flow. |
| `features/order/OrderTypeSelectScreen.tsx` | 7 | **Excluded** | Order-context and cart-conflict transitions. |
| `features/auth/PhoneOtpLogin.tsx` | 4 | Surface | Migrate with the whole auth surface (needs `SaudiPhoneInput` + `OtpCodeInput` too). |
| `features/profile/VerifyPhoneWhatsApp.tsx` | 3 | Surface | Same auth surface. |
| `features/orders/ReceiptScreen.tsx` | 3 | Surface | Includes a resend-to-branch action — treat as order-adjacent. |
| `components/StateViews.tsx` | 2 | Shared | Best first swap once a surface is migrated, so error/empty views match it. |
| `app/payment/checkout.tsx` | 2 | **Excluded** | In-app payment WebView controls. |
| `app/payment/return.tsx` | 1 | **Excluded** | Payment return handling. |

**23 of 42** sit inside the brief's exclusion list (payment, destructive,
order-state).

## Mobile — input implementations (12 `<TextInput>`, 6 files)

| File | Notes |
| --- | --- |
| `components/SaudiPhoneInput.tsx` | Bespoke `+966` prefix, masking and validation. Not a plain `Field`; needs a `Field` variant before it can migrate. |
| `features/otp/OtpCodeInput.tsx` | Six-box OTP with auto-advance and paste handling. Not a `Field` shape at all. |
| `features/account/DeleteAccountScreen.tsx` | Password re-verification. Excluded (destructive). |
| `features/checkout/CheckoutScreen.tsx` | Order notes, coupon code. Excluded (payment/checkout). |
| `features/menu/HomeMenuScreen.tsx` | Menu search. No label or message — `Field`'s label + error anatomy does not fit a search box. |
| `features/order/OrderTypeSelectScreen.tsx` | Address form incl. the national short address. Excluded (order context), but this is the **best eventual `Field` target** — it is the only labelled form in the app. |

**Finding: mobile has no clean `Field` target in this pass.** The design-system
`Field` is label + control + one message; the mobile inputs are either bespoke
(phone, OTP), unlabelled (search), or inside an excluded flow.

## Web / admin — no shared component exists

There is **no** shared Button or Field on the web side at all. Panels use raw
elements with utility classes:

- **129** raw `<button>`, of which **24** use `glass-btn-*`
- **72** raw `<input>`, of which **64** use `glass-input` and **10** `edit-input`

Largest concentrations:

| File | buttons | inputs |
| --- | ---: | ---: |
| `admin/MenuManagementPanel.tsx` | 16 | 8 |
| `AdminDashboard.tsx` | 16 | 0 |
| `admin/SettingsPanel.tsx` | 12 | 18 |
| `admin/BranchPoliciesPanel.tsx` | 9 | 3 |
| `admin/BannerManagementPanel.tsx` | 6 | 7 |
| `admin/OperationsAlertsPanel.tsx` | 6 | 2 |
| `admin/DeliveryZoneModal.tsx` | 6 | 0 |
| `admin/OrderIntegrityPanel.tsx` | 5 | 2 |
| `admin/LiveOrdersPanel.tsx` | 5 | 1 |
| `admin/BranchEditModal.tsx` | 4 | 10 |

The `.glass-*` classes carry gradients, blur and hover transforms that the flat
design-system components deliberately drop, so every web swap is a visible
change. Web migration should go panel-by-panel, and `TapPaymentPanel`,
`LiveOrdersPanel` status controls and `OrderIntegrityPanel` actions are
excluded until the rest is settled.

---

## Suggested sequencing

1. **Auth surface** (mobile): `PhoneOtpLogin` + `VerifyPhoneWhatsApp` +
   `SaudiPhoneInput` + `OtpCodeInput`. Self-contained, no payment or order
   state, and it forces the `Field` variants (prefixed input, OTP boxes) that
   everything else will need.
2. **`StateViews`**, once one surface is migrated so error/empty views match.
3. **Address form** in `OrderTypeSelectScreen` — the first true `Field` target.
4. **Web panels**, least-destructive first: `LegalDocumentsPanel`,
   `BannerManagementPanel`, then `MenuManagementPanel`.
5. Excluded until last, each with its own PR and test plan: checkout, payment,
   account deletion, order-state controls.
