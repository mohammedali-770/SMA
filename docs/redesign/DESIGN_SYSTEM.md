# Spicy Meal — Current Design System (baseline for the redesign)

> These are the tokens and component contracts **as shipped today**
> (`apps/mobile/src/theme.ts`, `src/index.css`, and the component files). They
> are the baseline: the redesign may replace the *values*, but must keep an
> equivalent *role* for every token and a state-complete version of every
> component. Version 1.0 — 2026-07-29.

---

## 1. Colour

### 1.1 Brand (fixed by the client brief, admin-overridable at runtime)

| Role | Hex | Notes |
| --- | --- | --- |
| `primary` / purple | `#422e87` | overridable via `app_settings.primary_color` |
| `secondary` / red | `#e02d3d` | overridable via `app_settings.secondary_color` |
| `white` | `#ffffff` | |

> **Design implication.** Because an admin can change the two brand colours at
> runtime, the new system must define **semantic roles** (`primary`,
> `on-primary`, `secondary`, `on-secondary`, …) and derive every component from
> the role. Any composition that only works at `#422e87` is a defect.

### 1.2 Neutrals

| Role | Hex |
| --- | --- |
| `ink` (strongest text) | `#1c1630` |
| `text` (body) | `#241d3a` |
| `muted` (secondary text) | `#6b6580` |
| `border` | `#ece9f2` |
| `surface` (cards) | `#ffffff` |
| `bg` (screen) | `#f6f5fa` |
| `bgAlt` | `#faf9fd` |
| `disabled` | `#c9c4d6` |
| `overlay` | `rgba(28,22,48,0.45)` |

### 1.3 Status

| Role | Foreground | Tint background |
| --- | --- | --- |
| success | `#1f9d55` | `#e7f6ee` |
| danger | `#e02d3d` | `#fdeaec` |
| warning | `#c47f17` | — |
| brand tint | `#422e87` | `#f1edfb` |

**Rule:** status is never colour-only. Every status in the product also carries
an icon **and** a text label (open/closed badge, order status pill, payment
badge, alert severity, confirmation state). Keep that.

### 1.4 Console-specific

The staff console uses a translucent "glass" treatment (`glass-panel`,
`glass-btn-primary`: white/20 fills, `backdrop-blur-md`, `border-slate-200/60`)
over a light background, with Tailwind slate neutrals. If the redesign keeps a
glass language it must specify an opaque fallback — `backdrop-filter` is
unavailable or expensive on some targets.

---

## 2. Typography, spacing, shape, motion

### 2.1 Type scale (customer app)

| Token | Size / line-height / weight | Used for |
| --- | --- | --- |
| `display` | 26 / 32 / 800 | screen heroes |
| `title` | 20 / 26 / 800 | screen titles |
| `heading` | 17 / 23 / 700 | section headings, card titles |
| `body` | 15 / 22 / 500 | body copy |
| `label` | 13 / 18 / 600 | field labels, chips |
| `caption` | 12 / 16 / 500 | helper text, metadata |
| `button` | 17 / 22 / 700 | primary actions |

Raw size scale also in use: `xs 12 · sm 13 · md 15 · lg 17 · xl 20 · xxl 26`.

**Arabic requirement:** the redesign must supply a paired Arabic scale with its
own line-heights — Arabic needs more leading than Latin at the same optical
size, and Arabic strings run ~30–40% longer. Specify the Arabic typeface, its
weights, and its file size (Arabic families are heavy — budget it).

### 2.2 Spacing

`xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 28`

### 2.3 Radius

`sm 8 · md 12 · lg 16 · xl 22 · pill 999`

### 2.4 Elevation

Three levels, all in the same purple-grey hue family (`#2a2350`):

| Token | Opacity / radius / offset / elevation | Used for |
| --- | --- | --- |
| `sm` | 0.06 / 6 / (0,2) / 2 | pressable tiles, sticky bars |
| `card` | 0.08 / 12 / (0,4) / 3 | cards |
| `lg` | 0.12 / 20 / (0,8) / 6 | sheets, popovers, floating CTAs |

React Native shadows are `shadowColor/Opacity/Radius/Offset` + Android
`elevation`. Multi-layer CSS shadow stacks are **not** portable — specify
elevation as one of these three levels.

### 2.5 Motion

| Token | Value |
| --- | --- |
| duration.fast | 150 ms |
| duration.base | 220 ms |
| duration.slow | 320 ms |
| pressed opacity | 0.9 |
| pressed scale | 0.97 |

Non-trivial animation must be gated behind the OS reduce-motion setting.

---

## 3. Component contracts

Every component below must be delivered with: **default · pressed · focused ·
disabled · loading · error** (where applicable), in **RTL and LTR**.

### 3.1 Customer app

| Component | Contract |
| --- | --- |
| `Button` | primary / secondary / destructive; full-width and inline; loading spinner state; disabled state; min 44 pt target |
| `Screen` | screen scaffold with background + safe-area handling |
| `Header` | title, optional back action (mirrored), optional trailing action |
| `Logo` | wordmark lockup |
| `Price` + `SaudiRiyalSymbol` | amount + Riyal symbol, two decimals, LTR numerals inside RTL text |
| `QtyStepper` / `QuantityStepper` | −/+ with accessible labels, min/max clamping, and the **confirm-before-remove** rule at qty 1 |
| `Notice` | inline informational / warning / error banner |
| `StateViews` | `LoadingView`, `EmptyView` (icon + title + sub + optional CTA), `ErrorView` (message + Try Again) |
| `OpenClosedBadge` | Open / Closed with icon + label + tint |
| `SaudiPhoneInput` | `+966` affix, Saudi-mobile mask/validation, inline error |
| `OtpCodeInput` | 6 boxes, paste + platform autofill, per-box focus, error shake/tint, resend cooldown |
| `BannerCarousel` | 0 / 1 / 2+ behaviours, ~16:6, dots, loop, broken-image skip |
| `LocationPickerMap` (+ `.web`) | draggable pin, use-my-location, zone overlay, not-configured state |
| `TapWebView` (+ `.web`) **[FROZEN]** | secure payment container: loading, error+retry, abandon handling |
| `ObservabilityErrorBoundary` | crash fallback screen with a recovery action |
| `NotificationSettings` **[DORMANT]** | two toggles + permission-denied guidance |
| Tab bar | 3 items, icons + labels, mirrored order |
| Sticky bars | cart bar, checkout footer, add-to-cart bar — all safe-area aware |
| Dialogs | confirm/cancel pattern used by remove-item, change-order-type, cart-conflict, final delete |

### 3.2 Console

| Component | Contract |
| --- | --- |
| Sidebar tab item | icon + label, active state, count badge, horizontal-scroll variant |
| KPI tile | label, value, delta, unit/footnote |
| Data table / ledger | header, sortable-looking columns, zebra rows, horizontal scroll, empty + error rows |
| Order card | identity block, items with modifiers, totals, payment badges, status controller |
| Toggle / switch | on/off + `aria-pressed`, admin-only disabled variant |
| Secure config card | public fields + write-only secret field ("has secret", never the value) |
| Modal | branch edit, delivery zone editor, product edit, confirm dialogs |
| Alert banner | pulsing new-order banner; dismissible write-failure banner; role-warning bar |
| Capability states | loading probe, visible, confirmed-unavailable |
| Chart | daily branch sales distribution |

---

## 4. Layout references

| Target | Reference width | Notes |
| --- | --- | --- |
| Phone | 390 × 844 | primary customer target |
| Small phone | 360 × 640 | must not clip Arabic strings |
| Tablet / web `/app` | ≥ 768 | customer app responsive layout |
| Console desktop | ≥ 1280 | sidebar + content |
| Console small | ≤ 768 | sidebar collapses to a horizontal scroller |

---

## 5. What may change vs. what may not

| May change | May not change |
| --- | --- |
| Every colour value, provided semantic roles and contrast hold | The existence of a semantic role for each token listed above |
| Type family, sizes and scale | Bilingual coverage; Arabic-first mirroring |
| Component shapes, radii, elevation style | Component **states** — every state listed in §3 must exist |
| Iconography | Status = icon + label + colour (never colour alone) |
| Layout, grouping and hierarchy of a screen | The set of screens, and the set of states per screen (`FEATURE_INVENTORY.md`) |
| Copy typesetting | Copy meaning, especially payment/order/refund/deletion states |
| Motion feel | Reduce-motion support; 44 pt targets; virtualized long lists |
