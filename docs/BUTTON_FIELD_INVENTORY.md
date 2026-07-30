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
| 1 | **Authentication** | ✅ **Done** |
| 2 | Customer App — Home / Menu | ⬜ |
| 2 | Customer App — Product Details | ⬜ |
| 2 | Customer App — Cart | ⬜ |
| 2 | Customer App — Checkout | ⬜ |
| 2 | Customer App — Payment | ⬜ |
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

## Not yet removable

`components/Button.tsx` (legacy) still backs **38** call sites across the
customer app and cannot be deleted until surface 2 completes. It routes through
the shared `buttonState` module, so its disabled/loading/guard behaviour already
matches the design-system button.

## Remaining legacy inventory

| Surface | Legacy usage |
| --- | ---: |
| Mobile `<Button>` (legacy) | 38 call sites, 8 files |
| Mobile `<TextInput>` | 10 across 5 files |
| Web raw `<button>` | 129 (24 `glass-btn-*`) |
| Web raw `<input>` | 72 (64 `glass-input`, 10 `edit-input`) |

The web side has no shared Button or Field at all; admin panels use raw elements
with `.glass-*` utilities. Those utilities are deleted once the last panel that
references them is migrated.
