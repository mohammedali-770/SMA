# Spicy Meal — Feature Parity Inventory ("nothing lost" checklist)

> **This file is the acceptance contract.** Every line is a feature, state,
> control or rule that exists in the shipped product today. A redesign is
> complete only when every box maps to a delivered screen or component.
>
> Legend: `☐` to design · **[FROZEN]** payment area, restyle only ·
> **[DORMANT]** exists but intentionally inactive · **[ADMIN]** / **[ACCT]**
> role-specific.
>
> Source of truth: `apps/mobile/src/` (customer), `src/` (console),
> `supabase/` (contracts), `docs/` (runbooks). Version 1.0 — 2026-07-29.

---

## 1. Cross-cutting (applies to every screen)

| # | Item | Notes |
| --- | --- | --- |
| ☐ 1.1 | Arabic (RTL, default) and English (LTR) for every screen | full mirroring: layout, icons, arrows, tab order, text alignment |
| ☐ 1.2 | In-app language toggle | Home header + Profile (customer); title bar (console) |
| ☐ 1.3 | Prices as `NN.NN` + Riyal symbol/label (`SAR` / `ر.س`) | dedicated `SaudiRiyalSymbol` asset, never a generic glyph |
| ☐ 1.4 | Dates/times in **Asia/Riyadh**, format `YYYY-MM-DD HH:mm` | reports slice days by Riyadh local date, not UTC |
| ☐ 1.5 | VAT 15%, prices VAT-inclusive; VAT shown as an informational line | percentage + inclusive flag are admin-configurable |
| ☐ 1.6 | Brand colours overridable at runtime (`primary_color`, `secondary_color`) | design must survive a palette swap |
| ☐ 1.7 | Loading / empty / error / content treatment for every data view | shared `LoadingView`, `EmptyView`, `ErrorView`, `Notice` |
| ☐ 1.8 | Documented state precedence when several states are true at once | `stateHierarchy.ts` |
| ☐ 1.9 | Errors always offer **Try Again** / `إعادة المحاولة` | never a dead end |
| ☐ 1.10 | Stale-while-revalidate: spinner only on first load; later refreshes silent | orders list, catalog |
| ☐ 1.11 | Safe-area aware sticky bars (cart bar, checkout footer, add-to-cart bar) | above the home indicator |
| ☐ 1.12 | Error boundary screen (crash fallback) | `ObservabilityErrorBoundary`, both surfaces |
| ☐ 1.13 | Reduce-motion respected; motion tokens 150/220/320 ms | |
| ☐ 1.14 | Accessibility labels on every icon-only control, both languages | |
| ☐ 1.15 | No internal `SM-…` order number anywhere on a customer surface | see §2.11 |
| ☐ 1.16 | No disclosure of retry budgets, attempt counters or block reasons to customers | |

---

## 2. Customer app (mobile + web `/app`) — 17 routes

### 2.1 `/` — entry gate
- ☐ Splash / branded loading while the session and catalog hydrate.
- ☐ Routes to: login (no session) · `/select` (no valid order context) · Home.

### 2.2 `/(auth)/login` — WhatsApp OTP login
- ☐ Brand lockup, tagline (`Hot, Crispy, Fresh and Golden Bites` / `حار، مقرمش، طازج ولقيمات ذهبية`), sub-headline.
- ☐ **Saudi phone input** with `+966` affix, Saudi-mobile validation, inline error
  `Enter a valid Saudi mobile number, e.g. 05XXXXXXXX.`
- ☐ Helper text `Saudi mobile numbers only (+966).`
- ☐ Primary action `Send login code` → sent confirmation `We sent a login code to your WhatsApp.`
- ☐ **OTP code entry**: 6 boxes, paste + platform auto-fill, per-box focus states.
- ☐ `Verify & Login`, `Change number`, resend with **cooldown timer** (`Resend in NN`).
- ☐ Send-failure state `Could not send the login code. Please try again.`
- ☐ Service-unavailable state `WhatsApp login isn't available right now.` + sub-copy.
- ☐ **Unknown-availability case still shows the form** (do not design an unavailable wall).
- ☐ No email/password, no sign-up form, no social login, no guest checkout.

### 2.3 `/select` — order-type selection (blocking gate)
- ☐ Full-screen, two tabs: **Pickup** / **Delivery**.
- ☐ Pickup: branch list, **nearest-first when location granted**, each row with
  name, address, distance (`km` / `كم`), delivery fee, minimum order, and an
  **Open/Closed badge**; closed branches visible but **not selectable**.
- ☐ Delivery: saved-address list (`Saved addresses`, empty state `No saved addresses yet.`)
  + `Add new address`.
- ☐ **Map pin picker**: draggable pin, `Use my location`, hint `Move the pin to your exact location`.
- ☐ **Location description / landmark** field (required) with placeholder
  `Example: near Al Salam grocery, beside the mosque`.
- ☐ `Confirm location` → resolving state `Finding a branch for your location…`.
- ☐ Out-of-zone state `Sorry, delivery is not available for your selected location right now.`
- ☐ No-zones-at-all state `Delivery is not available right now. Please choose pickup.`
- ☐ Map-not-configured state `Map setup required — ask support to enable the map.`
- ☐ Resolved summary: `Delivered from <branch>` + distance + `Change`.
- ☐ **Change-order-type confirmation dialog** (`Changing the order type may affect the branch, delivery fee, item availability, and cart contents…`).
- ☐ **Cart-conflict dialog** when items are unavailable for the new branch/type:
  `Remove unavailable items and continue` / `Review cart` — items are **never**
  removed silently.
- ☐ Empty state `No branches available right now.`

### 2.4 `/(tabs)/*` — tab bar
- ☐ Exactly three tabs: **Home**, **Orders**, **Profile**, with icons + labels, RTL order mirrored.
- ☐ Active/inactive states; no badge requirement today.

### 2.5 `/(tabs)/index` — Home + Menu (one screen)
- ☐ Header: logo, EN/AR toggle (no phone icon).
- ☐ **Branch selector** (manual, never auto-selected) with Open/Closed badge, delivery fee, min order, `Change`.
- ☐ No-branch CTA `Choose a branch to see the menu` / `Select a branch`.
- ☐ **Closed-branch notice**: `This branch is currently closed. You can browse, but ordering is disabled.`
- ☐ **Banner carousel** below the branch selector, above search:
  - ☐ 0 banners → area collapses entirely;
  - ☐ 1 banner → static;
  - ☐ 2+ → auto-rotating, swipeable, looping, with dot indicators;
  - ☐ ~16:6 aspect, rounded, cover-fit, broken image skipped not crashed;
  - ☐ tappable → deep-link action (product / other).
- ☐ **Search field** `Search burgers, sides…` with clear affordance and no-results state `No items match your search.`
- ☐ **Horizontal category chips**, dynamic, with active state, **scroll-spy** highlight, and tap → scroll to section.
- ☐ **Virtualized sectioned menu** (category header + product cards).
- ☐ **Product card**: image (fixed aspect, cover, fallback), name, description,
  calories (`kcal` / `سعرة`), price, and either `Add` (simple) or
  `Customize & Add` (has modifier groups).
- ☐ Unavailable-for-this-branch products hidden/disabled per availability matrix.
- ☐ **Sticky cart bar** above the safe area whenever the cart has items
  (item count `item`/`items`, subtotal, go-to-cart).
- ☐ Loading, error (+retry) and empty-menu states.

### 2.6 `/product/[id]` — product detail
- ☐ Large image, name, description, calories, base price.
- ☐ `Choose your options` — modifier groups:
  - ☐ single-select (max 1) as **radios**; multi-select as **checkboxes bounded by max**;
  - ☐ `Required` / `Optional` badges; required groups block Add until satisfied;
  - ☐ per-modifier price deltas.
- ☐ **Quantity stepper** with accessible `Increase/Decrease quantity` labels.
- ☐ **Sticky Add-to-Cart bar** with a live, recomputed price.
- ☐ Disabled-Add state with the reason visible.

### 2.7 `/cart` — cart
- ☐ Line rows: image/name, **modifier summary**, unit/line price, quantity stepper, remove.
- ☐ **Remove confirmation** — a decrement at qty 1 must open a confirm dialog; rapid double-taps must never silently drop a line.
- ☐ Subtotal preview + note that the server recomputes.
- ☐ Empty state `Your cart is empty` / `Add some spicy items to get started!` + `Browse the menu`.
- ☐ Sticky `Go to Checkout` bar above the safe area.

### 2.8 `/checkout` — checkout
- ☐ **Order type** segment (Delivery / Self-Pickup) with change-confirmation semantics.
- ☐ **Delivery address** block (selected address + description) or `No saved address…` guidance.
- ☐ **Payment method** selector — `Online Payment` · `Cash on Delivery` / `Cash on Pickup`;
  availability, default selection and an **outage mode** are admin-controlled:
  - ☐ online-disabled state, cash-disabled state,
  - ☐ **no method enabled** → checkout blocked with an explicit message,
  - ☐ `Online payment is unavailable right now.`
- ☐ **Promo code**: input, `Apply`, applied state `Discount applied!`, invalid state.
- ☐ **Loyalty redemption**: toggle `Redeem loyalty points`, balance `NNN points available`,
  hint `Points are redeemed and validated by the server at checkout.`, min-points rule.
- ☐ **Kitchen notes** field with placeholder `Add a note (e.g. extra spicy, no onions)`.
- ☐ **Totals block**: Subtotal · Delivery Fee · Discount · Loyalty discount ·
  `VAT (15%, included)` · **Total** — every number moves together when a
  quantity changes.
- ☐ Per-line quantity stepper inside checkout with the same remove-confirmation rule.
- ☐ **Sticky footer** with one blocking message at a time, covering every reason:
  `no-branch`, `branch-closed`, `no-order-type`, `empty-cart`, `below-minimum`
  (`Below the branch minimum for delivery.` + how much more is needed),
  `no-payment`, `delivery-unserviceable`, `need-description`.
- ☐ `Confirm & Order` → `Placing your order…` submitting state.
- ☐ Errors: `This branch is closed. Please choose an open branch.`, generic failure + retry.

### 2.9 `/payment/checkout` — secure payment WebView **[FROZEN]**
- ☐ Title `Secure Payment`, loading state `Loading secure payment…`.
- ☐ Load-failure state `We couldn't load the secure payment page…` + retry.
- ☐ Abandon/back handling: `Payment was not completed. You can continue or try again.` with `Continue payment`.
- ☐ Trust affordances (lock/secure framing) without impersonating the provider.

### 2.10 `/payment/return` — payment return **[FROZEN]**
- ☐ Verifying state `Verifying payment…` (the client trusts nothing from the redirect).
- ☐ Outcome states: success · declined · cancelled · expired · pending · unknown ·
  generic failure — each with its own copy and action (`Try again` / `Check again`).
- ☐ `We could not confirm the payment. Please contact support if an amount was deducted.`

### 2.11 `/receipt/[id]` — order state / receipt ★ most constrained screen
- ☐ **12 confirmation states**, one artboard each, rendered from a single
  server-derived state — never two competing messages on one screen:

  | State | Headline (EN) | Success check? | Resend? |
  | --- | --- | --- | --- |
  | ☐ `payment_pending` | Payment not completed | no | no |
  | ☐ `accepted_no_pos_channel` | **Payment received** | no | no |
  | ☐ `accepted_no_pos_channel_unpaid` | **Order received** | no | no |
  | ☐ `sending_to_branch` | Sending to the branch… | no | no |
  | ☐ `confirmed_by_branch` | Order confirmed | **YES** | no |
  | ☐ `verifying_with_branch` | Checking with the branch | no | **no** |
  | ☐ `branch_failed_retry_available` | Order not sent yet (paid) | no | **yes** |
  | ☐ `unpaid_branch_failed_retry_available` | Order not sent yet (cash) | no | **yes** |
  | ☐ `final_failure_refund_pending` | Order not placed — refund automatic | no | no |
  | ☐ `final_failure_refunded` | Order not placed — refunded | no | no |
  | ☐ `final_failure_refund_failed` | Order not placed — refund in progress | no | no |
  | ☐ `unpaid_final_failure` | Order not placed — not charged | no | no |

- ☐ `confirmed_by_branch` is the **only** state with a success/check treatment.
- ☐ The two `accepted_no_pos_channel*` states are **neutral/informational** (clock icon, no check).
- ☐ **Branch order number** row: `Branch order number` / `رقم الطلب لدى الفرع`,
  value or `Not issued yet` / `لم يصدر بعد`. **Never** the internal `SM-…` number.
- ☐ **Refund status** row with `Refund pending` / `Refunded` / `Refund in progress`.
- ☐ **Resend order** button (only in the two proven-not-sent states) with
  `Sending…` and failure `We could not send it just now. Please try again in a moment.`
- ☐ Payment row: `Paid` / `Pending / Unpaid`, plus `Online payment not configured`.
- ☐ **Order summary**: line items with modifiers, subtotal, delivery fee, discounts, loyalty, VAT line, total.
- ☐ Actions `View my orders`, `Back to menu`.
- ☐ `sending_to_branch` copy asks the customer to stay on the screen; `verifying_with_branch`
  copy asks them **not** to re-order.

### 2.12 `/(tabs)/orders` — my orders
- ☐ Reverse-chronological list, paginated to a recent window.
- ☐ Row: branch name, date/time (Riyadh), total, **order status pill**
  (Received / Preparing / Ready / Out for delivery / Delivered / Cancelled) and the
  **confirmation-state tone** from §2.11.
- ☐ **Unpaid online orders are hidden** (a checkout-in-progress is not an order); cash orders show.
- ☐ Pull-to-refresh + silent focus refresh.
- ☐ Empty state `No orders yet` / `Your past orders will show up here.`
- ☐ Error state + retry; tap row → receipt.

### 2.13 `/(tabs)/profile` — profile
- ☐ Avatar (initial), full name or `Guest`, email when present.
- ☐ **Loyalty points card** with balance.
- ☐ Details: phone, role.
- ☐ **Verify phone number** entry point → WhatsApp verification flow with
  explicit `This does not sign you in.`, `Verified` badge when done, resend cooldown,
  invalid/expired code error, unavailable state.
- ☐ **Notifications card [DORMANT]** — two per-device toggles:
  `Order updates` (default on) and `Offers & promotions` (opt-in); OS permission
  requested only on first enable; blocked-permission guidance copy.
- ☐ **Language** row (Arabic / English).
- ☐ **Legal & Support** entry point.
- ☐ **Delete account** entry point.
- ☐ **Sign out** (deactivates this device's push token first).

### 2.14 `/account/delete` — account deletion (store compliance)
- ☐ Step 1 disclosure screen with **all 11 bullets**: access removed · saved
  addresses deleted · profile deleted/anonymised · loyalty points lost ·
  signed out & sessions revoked · notification devices removed · some records
  retained (legal/accounting/fraud/dispute) · retained records anonymised where
  possible · deleting the app ≠ deleting the account · usually processed
  automatically · may take up to 30 days in exceptional cases.
- ☐ **Acknowledgement checkbox** with the full legal sentence; `Continue account deletion` disabled until ticked.
- ☐ Step 2 **re-verify identity**: OTP to the registered number *or* password
  fallback (`Confirm with password instead`), with `Code verification isn't
  available right now — please confirm with your password.` and wrong-password error.
- ☐ Step 3 **final confirmation dialog** `Delete account?` / `This starts deleting your account and cannot be undone.` / `Delete my account`.
- ☐ Submitting state, then success screen `Request received` + the 30-day explanation + `Done`.
- ☐ **In-progress status screen** with five distinct sub-states: received ·
  waiting for an active order · waiting for a financial process · manual review ·
  completed.
- ☐ Offline state, generic error state, and the `Account deletion isn't available in the app right now…` fallback.
- ☐ `You won't receive a separate confirmation message…` note + support contact block.

### 2.15 `/legal` — Legal & Support
- ☐ **Contact & Support card**: `Call Support` · `WhatsApp Support` · `Email Support` · `Working Hours` +
  admin-written description.
- ☐ A channel renders **only** when enabled *and* its value passes sanitisation —
  placeholder values (`+966 5X XXX XXXX`, `support@example.com`, `edit in Admin`)
  must never appear. Design the collapsed/absent case.
- ☐ Action failure state `Could not open this action on your device.`
- ☐ **Active legal documents** list in canonical order, each opening in-app.
- ☐ Load failure → friendly retry, never a broken screen.

### 2.16 `/legal/[type]` — legal document viewer
- ☐ Title (AR/EN), version, effective date, plain-text body with preserved line breaks.
- ☐ Long-document scrolling, back action, loading/error states.

### 2.17 Development-only routes
- ☐ `/dev-preview`, `/dev-sentry` — **excluded** from the design (not in production UX).

---

## 3. Staff console (site root) — 12 tabs

### 3.0 Shell
- ☐ Sign-in screen (email/password, Supabase Auth) with error states.
- ☐ Top brand bar: logo, wordmark, signed-in user + role chip, sign out.
- ☐ Left sidebar (vertical ≥ md, horizontally scrollable row on small screens) with 12 items + icons.
- ☐ **Live Orders badge** = count of active orders.
- ☐ Title bar: dashboard title, **live-mode pill** (`Live` via Realtime / `Auto-refreshing` via polling) with last-updated timestamp.
- ☐ **New-order alert banner** (pulsing) with `Replay Ring` and `Dismiss`.
- ☐ **Sound toggle** (mute/unmute) for the new-order chime.
- ☐ **EN/AR toggle** with full RTL flip of the console.
- ☐ **[ACCT]** persistent amber role-warning bar for accountants.
- ☐ Initial-load error panel (full screen + retry) vs. **non-fatal write-failure
  banner** (dismissible, overlaid — must not unmount the console).
- ☐ Lazy-chunk loading placeholder.
- ☐ **Capability-gated tabs** (Health, Alerts, Integrity): loading, visible, and
  confirmed-unavailable presentations; a hidden tab must fall back to Sales Overview.

### 3.1 Sales Overview (`stats`)
- ☐ KPI tiles: today's sales, `vs yesterday` delta, active orders, completed today,
  **VAT-inclusive average ticket**, branches closed count.
- ☐ Daily branch sales distribution chart.
- ☐ Realtime sync indicator; sync-failed / awaiting-sync / not-scheduled states.

### 3.2 Live Orders (`orders`)
- ☐ Order stream with search (`Search by order#, client, phone...`) and status filter (`All` + each status).
- ☐ Order card: internal order number, customer name/phone (or `No phone provided`), branch,
  type, items with modifiers, coupon discount, loyalty discount, totals.
- ☐ **Payment badges**: `PENDING ONLINE PAYMENT` · `CASH PAYMENT REQUIRED` · `UNPAID` ·
  `Payment method not set`, each with its explanatory line.
- ☐ **[FROZEN]** `Re-verify via Tap` action with loading (`Loading payment details…`) and result display.
- ☐ **Live POS Status Controller**: set realtime order status (the 6 statuses).
- ☐ POS mapping warning when the branch is not mapped.
- ☐ **[ACCT]** read-only variant.

### 3.3 Menu Management (`menu`)
- ☐ Category CRUD (create, rename AR/EN, sort, activate, delete + confirm).
- ☐ Product CRUD: AR/EN name + description, price (validated `> 0`), calories,
  image URL, active flag, sort order, category, modifier-group assignment.
- ☐ Modifier groups & modifiers: min/max selection, required flag, per-modifier price.
- ☐ **CSV import** with a downloadable template, file picker, and per-row error reporting.
- ☐ Delete confirmations for product and category.
- ☐ **[ACCT]** view-only.

### 3.4 Banners (`banners`)
- ☐ List of homepage banners with sort order and active toggle.
- ☐ Create/edit: AR/EN title, **image upload** to the public bucket, schedule
  (`starts_at` / `ends_at`), tap action (type + value), sort order.
- ☐ Reorder, enable/disable, delete + confirm.
- ☐ **[ACCT]** view-only.

### 3.5 Branch Management (`branches`)
- ☐ Branch list with AR/EN name, address, phone, active state, POS `Mapped`/`Unmapped` chip.
- ☐ Branch edit modal: names, addresses, phone, **location** (`Set` / `Not set` + map picker),
  delivery fee, delivery minimum, estimated delivery minutes.
- ☐ Channel toggles: **Delivery ON/OFF**, **Pickup ON/OFF**, **Delivery temporarily closed** (`PAUSED` chip).
- ☐ **Delivery zone editor** on a map: draw / edit / view polygon, `Configured` vs
  `Delivery area not configured`, and the guard `Set branch location before drawing delivery area.`
- ☐ Warning state `Delivery is enabled but no delivery zone is configured.`
- ☐ **Branch × product availability matrix** (stock on/off per branch).
- ☐ Branch deletion flow with its safety checks.
- ☐ **[ACCT]** view-only.

### 3.6 Financial Reports (`reports`)
- ☐ Filters: branch scope (`All Branches` + each), start date, end date (default = current Riyadh month).
- ☐ Six reports: **Sales by Day · Sales by Branch · Sales by Product · Coupon Usage ·
  Delivery Service Fees · Lazywait POS Audit**, each with its own ledger table.
- ☐ Summary tiles: filtered revenue (`Includes 15% VAT`), completed order volume,
  total coupon savings, delivery fees collected.
- ☐ **CSV export** of the active report.
- ☐ Empty-range and error states.

### 3.7 Integrations (`integrations`)
- ☐ Three sub-tabs: **Payments · Messaging & Notifications · POS & Delivery**.
- ☐ Generic secure-config card per provider: enabled toggle, public fields,
  **secret fields that are write-only** (the UI shows "has secret", never the value),
  `Secure storage` affordance.
- ☐ **[FROZEN]** Tap payment panel: mode (test/live), status, connection test + result.
- ☐ WhatsApp OTP panel: config, status, test send.
- ☐ Email server panel: config + test.
- ☐ **[DORMANT]** Push tools panel.
- ☐ Lazywait panel: enable flags (menu / stock / order sync), catalog pull, sync status.
- ☐ **Lazywait catalog mapping**: map local products/branches to POS items, mapped/unmapped state, clear mapping.
- ☐ `Admin only` gate + `Integration settings are available to admins only.` for accountants.
- ☐ Loading / retry states.

### 3.8 Operations Health (`health`) — capability-gated
- ☐ Read-only health summary panel (staff-gated RPC), section cards per subsystem.
- ☐ Navigation shortcuts into the related tabs.
- ☐ Unavailable/permission-denied and loading states.

### 3.9 Operations Alerts (`alerts`) — capability-gated
- ☐ **Alerts inbox**: severity, timestamp, entity, AR/EN message; timeline per alert.
- ☐ **Daily digest** list + preview (AR/EN), generated hourly with an 08:00 Asia/Riyadh gate.
- ☐ Admin-only alert settings (thresholds/toggles); accountant read-only.
- ☐ **External dispatch is disabled by design** — the design must not imply email/SMS/push delivery.
- ☐ Empty, loading and error states.

### 3.10 Order Integrity (`integrity`) — capability-gated
- ☐ Incident list with severity/type, safe (no-PII) fields only.
- ☐ Incident timeline.
- ☐ **Acknowledge** and **Suppress** actions — **[ADMIN]** only; accountants read-only.
- ☐ **No** Retry / Refund / Resend / Mark-Paid / Auto-Fix controls may appear (observe-only by design).
- ☐ Admin summary counters.

### 3.11 Settings (`settings`)
- ☐ **Brand & VAT**: logo URL, primary colour (HEX), secondary colour (HEX),
  VAT percentage, prices-include-VAT toggle, privacy policy + terms (AR/EN),
  auto-save confirmation.
- ☐ **Payment Methods** **[ADMIN only, ACCT view-only]**: online on/off, cash on/off,
  default method (or `Auto (first enabled)`), **outage mode**, plus the live-state
  advisories (no method enabled · online off/cash on · cash orders go to POS unpaid).
- ☐ **Map Settings**: provider, public-token-configured indicator, style URL, token restriction — **public config only**.
- ☐ **Loyalty Program**: enabled toggle, points per riyal, min points to redeem,
  discount value per point, plus live loyalty metrics (members, accumulated points,
  outstanding liability, total discount value).
- ☐ **Support & Contact**: phone / WhatsApp / email + per-channel enable toggles,
  working hours (AR/EN), description (AR/EN).
- ☐ Save states, validation errors, and the non-fatal save-failure banner.

### 3.12 Legal Documents (`legal`)
- ☐ Per document type: AR/EN title, AR/EN content (plain text, preserved line breaks),
  version, effective date, active flag, requires-acceptance flag.
- ☐ Only active documents reach the customer app.
- ☐ **[ACCT]** view-only.

### 3.13 Database Playground
- ☐ Developer/console utility screen (lazy-loaded). Confirm with the owner whether
  it stays in the redesign or is dropped.

---

## 4. Business rules the UI must express

| # | Rule |
| --- | --- |
| ☐ 4.1 | An order can only be placed by an authenticated customer. |
| ☐ 4.2 | A branch must be selected manually and must be active; the server re-checks. |
| ☐ 4.3 | Order type (delivery/pickup) is required before the menu is usable. |
| ☐ 4.4 | Product availability is **per branch**; changing branch may invalidate cart lines. |
| ☐ 4.5 | Delivery requires a point inside an **active delivery zone** of an open branch, plus a location description. |
| ☐ 4.6 | Delivery has a **per-branch minimum order**; below it, checkout is blocked with the shortfall shown. |
| ☐ 4.7 | Delivery fee is per branch; pickup has none. |
| ☐ 4.8 | Coupons are validated server-side; codes are never listed to the client. |
| ☐ 4.9 | Loyalty: earn per riyal, redeem above a minimum, value per point — all server-validated. |
| ☐ 4.10 | VAT is extracted from the inclusive total, never added on top. |
| ☐ 4.11 | Payment method availability, default and outage mode are admin-controlled and can leave **no** method enabled. |
| ☐ 4.12 | Online orders are created only **after** payment verification (checkout session first). |
| ☐ 4.13 | Cash orders are sent to the POS as unpaid; the cashier/driver collects. |
| ☐ 4.14 | An unpaid online order is not a real order and must not appear in My Orders. |
| ☐ 4.15 | "Paid" and "placed" are separate facts and must never be merged in the UI (§2.11). |
| ☐ 4.16 | A resend is offered **only** in proven-not-sent states; ambiguous states offer none. |
| ☐ 4.17 | Checkout is idempotent per cart; a retried submit must not create a second order. |
| ☐ 4.18 | Order statuses: received → preparing → ready → out_for_delivery → delivered, plus cancelled. |
| ☐ 4.19 | Roles: customer / admin / accountant; the role is displayed but never switchable in the UI. |
| ☐ 4.20 | Secrets are never displayed or read back in any admin screen. |

---

## 5. Assets to redesign

- ☐ App icon (iOS), adaptive icon (Android foreground/background), favicon.
- ☐ Splash screen (both platforms + web).
- ☐ Wordmark / logo lockups (light backgrounds; horizontal + stacked).
- ☐ Saudi Riyal symbol treatment (an SVG asset exists today).
- ☐ Icon set covering: home, receipt, person, search, dish, alert, award, sign-out,
  chevrons, quantity +/−, open/closed, and every console tab icon.
- ☐ Empty-state and error-state illustrations (currently icon-based).
- ☐ Banner image spec sheet for admins (aspect ratio, min resolution, safe area for text).
- ☐ Product image spec sheet for admins (aspect ratio, min resolution, background guidance).

---

## 6. Sign-off

| Area | Designer | Reviewer | Date |
| --- | --- | --- | --- |
| Cross-cutting (§1) | | | |
| Customer app (§2) | | | |
| Confirmation states (§2.11) | | | |
| Staff console (§3) | | | |
| Business rules (§4) | | | |
| Assets (§5) | | | |

Acceptance requires **zero** unticked lines, or an owner-approved written
exception per unticked line.
