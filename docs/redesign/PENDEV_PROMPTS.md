# Pen.dev — Workflow and Ready-to-Run Prompts

> Companion to [`PENDEV_BRIEF.md`](./PENDEV_BRIEF.md) and
> [`FEATURE_INVENTORY.md`](./FEATURE_INVENTORY.md). Version 1.0 — 2026-07-29.

---

## 1. Setup

```bash
npm install -g @pen.dev/cli     # installed here: @pen.dev/cli@0.3.0
pen status                       # auth check
pen login                        # email + password, or OTP
pen --list-workspaces
pen --workspace <org>/<workspace>
```

Useful flags (from `pen --help`):

| Flag | Purpose |
| --- | --- |
| `--in, -i` | input `.pen` file (omit to start from an empty canvas) |
| `--out, -o` | output `.pen` file (**required**) |
| `--prompt, -p` | the design instruction |
| `--prompt-file, -f` | attach a file — reference screenshots, or a `.md` from this folder (repeatable) |
| `--repo, -C` | run the agent with this repository as its working directory |
| `--export, -e` + `--export-type` | export png / jpeg / webp / pdf |
| `--export-scale` | export scale factor |
| `--enable-preview` | write a preview PNG after each change |
| `--tasks, -t` | JSON tasks file for batch runs |
| `--model / --agent / --effort` | model selection and reasoning effort |
| `--usage` | write token usage + cost to JSON |

`pen interactive` is the recommended mode for iterative design sessions; the
one-shot form below is best for reproducible batch generation.

**Always attach the brief.** Every prompt should carry the governing documents
so the tool designs against the real contract rather than a generic food app:

```bash
-f docs/redesign/PENDEV_BRIEF.md \
-f docs/redesign/DESIGN_SYSTEM.md \
-f docs/redesign/FEATURE_INVENTORY.md
```

---

## 2. Suggested file layout

```
design/
  01-design-system.pen
  02-customer-core.pen        select → home → product → cart → checkout
  03-customer-payment.pen     payment webview, return, receipt
  04-confirmation-states.pen  the 12-state board
  05-customer-account.pen     login, profile, notifications, delete, legal
  06-admin-shell.pen          shell, sidebar, stats, live orders
  07-admin-panels.pen         menu, banners, branches, reports, integrations
  08-admin-ops.pen            health, alerts, integrity, settings, legal
  exports/
```

---

## 3. Batch prompts

Run these in order; each takes the previous system file as input so the language
stays consistent.

### Batch 1 — design system

```bash
pen -o design/01-design-system.pen -C . \
  -f docs/redesign/PENDEV_BRIEF.md -f docs/redesign/DESIGN_SYSTEM.md \
  -p "Create the design system for Spicy Meal, a Saudi fast-food ordering app that is Arabic-first (RTL) with English (LTR) as a secondary language.

Deliver, as a single system page:
1. Semantic colour roles (primary, on-primary, secondary, on-secondary, surface, surface-alt, background, border, text, text-muted, disabled, overlay, success, warning, danger, and a tint background for each status). Brand primary is deep purple #422e87 and secondary is hot red #e02d3d, but BOTH are overridable at runtime by an administrator — show the system rendered with the default palette and with one alternate palette, and prove body text stays above 4.5:1 in both.
2. A paired type scale for Arabic and Latin: display, title, heading, body, label, caption, button. Arabic needs greater leading and strings run 30-40% longer than English; state the typefaces and their weights.
3. Spacing 4/8/12/16/20/28, radii 8/12/16/22/pill, and exactly three elevation levels expressed as React Native shadows (colour, opacity, radius, offset) plus Android elevation.
4. Motion tokens at 150/220/320 ms with a pressed state of 0.9 opacity and 0.97 scale.
5. An icon set covering: home, receipt, person, search, dish, alert, award, sign-out, chevron, plus/minus, open, closed, and the twelve console tab icons.
6. A Saudi Riyal currency treatment — a dedicated symbol plus the labels SAR and ر.س — with amounts always at two decimals and numerals staying LTR inside Arabic text.

Constraints: everything must be renderable by React Native on iOS, Android and web. No CSS grid, no backdrop-filter without an opaque fallback, no multi-layer box shadows. Status must never be conveyed by colour alone."
```

### Batch 2 — core ordering loop

```bash
pen -i design/01-design-system.pen -o design/02-customer-core.pen -C . \
  -f docs/redesign/PENDEV_BRIEF.md -f docs/redesign/FEATURE_INVENTORY.md \
  -p "Using the attached design system, design the core ordering loop for the Spicy Meal customer app. Phone reference 390x844, plus a responsive layout at 768px and above. Every screen in BOTH Arabic RTL and English LTR.

Screens and required states — see FEATURE_INVENTORY.md sections 2.3 to 2.8 for the exact list:
1. Order-type selection (a full-screen blocking gate): Pickup and Delivery tabs; pickup branch list sorted nearest-first with open/closed badges where closed branches are visible but unselectable; delivery with saved addresses, a map pin picker, a required landmark description, plus the resolving, out-of-zone, no-zones and map-not-configured states; the change-order-type confirmation and the cart-conflict dialog.
2. Home and menu on ONE screen: logo header with a language toggle, a manual branch selector with an open/closed badge and a closed-branch notice, a promotional banner carousel that collapses entirely when there are no banners, a search field, horizontal category chips with scroll-spy highlighting, and a virtualised sectioned product list. Product cards show image, name, description, calories, price and either Add or Customize & Add. Include the sticky cart bar.
3. Product detail with modifier groups: single-select as radios, multi-select as bounded checkboxes, Required and Optional badges, a quantity stepper, and a sticky add-to-cart bar with a live price.
4. Cart: line rows with a modifier summary and quantity stepper, a remove-confirmation dialog, a subtotal preview, an empty state, and a sticky checkout bar.
5. Checkout: order type, delivery address, payment method (online / cash on delivery / cash on pickup, including the states where only one or neither is available), promo code, loyalty redemption, kitchen notes, and a totals block showing subtotal, delivery fee, discount, loyalty discount, an informational 15% VAT-included line, and the total. Include the sticky footer that shows exactly one blocking reason at a time, covering: no branch, branch closed, no order type, empty cart, below the delivery minimum, no payment method, delivery unserviceable, and missing address description.

Rules: all sticky bars sit above the safe area. Every list needs loading, empty and error treatments, and errors always offer Try Again. Touch targets are at least 44pt. Prices are VAT-inclusive; the VAT line is informational and is not added to the total. No screen may present a client-computed number as final."
```

### Batch 3 — payment screens (restyle only)

```bash
pen -i design/01-design-system.pen -o design/03-customer-payment.pen -C . \
  -f docs/redesign/PENDEV_BRIEF.md -f docs/redesign/FEATURE_INVENTORY.md \
  -p "Design the payment surfaces for the Spicy Meal customer app, in Arabic RTL and English LTR. This area is FROZEN: restyle only — do not change the flow, the number of steps, or the meaning of any message.

1. Secure payment screen hosting the provider's page in an embedded web view: loading, load-failure with retry, and the abandoned-payment state offering Continue payment. Convey security without impersonating the payment provider's own branding.
2. Payment return / verification screen: a verifying state, and separate outcome states for success, declined, cancelled, expired, still pending, unconfirmable, and generic failure. Each outcome gets its own copy and its own action (Try again or Check again). The unconfirmable state must tell the customer to contact support if an amount was deducted.

The client never trusts the redirect result — the design must make 'verifying with the server' a real, visible step, not an instant success."
```

### Batch 4 — the twelve confirmation states ★

```bash
pen -i design/01-design-system.pen -o design/04-confirmation-states.pen -C . \
  -f docs/redesign/PENDEV_BRIEF.md -f docs/redesign/FEATURE_INVENTORY.md \
  -p "Design the order status / receipt screen for Spicy Meal as a board of TWELVE distinct states, in Arabic RTL and English LTR. This is the most constrained screen in the product.

Two facts are tracked separately and must never be merged: whether the customer PAID, and whether the order actually reached the restaurant's point-of-sale system. The screen renders exactly one server-derived state at a time — never two competing messages.

The twelve states, with their rules:
1. payment_pending — 'Payment not completed'. No success treatment, no resend, no order number.
2. accepted_no_pos_channel — 'Payment received'. Deliberately NEUTRAL: informational tone, a clock-style icon, NO success check. It must not imply the branch accepted or is preparing the order.
3. accepted_no_pos_channel_unpaid — 'Order received' (cash). Same neutral treatment. Never say 'Payment received' here.
4. sending_to_branch — 'Sending to the branch…' with copy asking the customer to stay on the screen.
5. confirmed_by_branch — 'Order confirmed'. This is the ONLY state that renders a success check, and the only state that shows the branch's own order number.
6. verifying_with_branch — 'Checking with the branch'. Ambiguous: NO retry button, and the copy must discourage re-ordering.
7. branch_failed_retry_available — paid, proven not sent. Offers a 'Resend order' button.
8. unpaid_branch_failed_retry_available — cash, proven not sent. Also offers Resend.
9. final_failure_refund_pending — refund happening automatically.
10. final_failure_refunded — refund confirmed.
11. final_failure_refund_failed — refund being arranged manually.
12. unpaid_final_failure — cash, no refund language, customer was not charged.

Also design: the branch-order-number row, which shows 'Not issued yet' until the point-of-sale issues one; a refund-status row with pending / refunded / in progress; the resend button's sending and failure states; the payment row (Paid, Pending/Unpaid, or Online payment not configured); the full order summary with line items, modifiers, subtotal, delivery fee, discounts, loyalty, the informational VAT line and the total; and the actions View my orders and Back to menu.

Absolute rules: never design an unconditional 'Order placed!' hero. Never show an internal database order number — only the branch's number, and only once it exists. Never disclose how many resend attempts remain. Every state's copy must state the real backend state and nothing more."
```

### Batch 5 — account, profile, legal

```bash
pen -i design/01-design-system.pen -o design/05-customer-account.pen -C . \
  -f docs/redesign/PENDEV_BRIEF.md -f docs/redesign/FEATURE_INVENTORY.md \
  -p "Design the account and support surfaces of the Spicy Meal customer app, Arabic RTL and English LTR. See FEATURE_INVENTORY.md sections 2.2 and 2.12 to 2.16.

1. Login — WhatsApp one-time-code only, Saudi mobile numbers only. Brand lockup and tagline, a +966 phone input with validation, a Send login code action, a six-box code entry supporting paste and platform autofill, Verify & Login, Change number, a resend cooldown timer, a send-failure state, and a service-unavailable state. There is no email/password, no sign-up form, no social login and no guest checkout. When availability is unknown the form is still shown — do not design an unavailable wall.
2. My Orders — reverse-chronological list with branch, Riyadh-time timestamp, total, an order-status pill (received, preparing, ready, out for delivery, delivered, cancelled) and the confirmation tone from the state board; pull-to-refresh; empty and error states.
3. Profile — avatar initial, name, loyalty points card, phone and role, an entry point to verify the phone number over WhatsApp (which explicitly does not sign the user in, and shows a Verified badge when done), a notifications card with two per-device toggles (order updates on by default, offers opt-in) plus permission-blocked guidance, a language row, a Legal & Support entry, a Delete account entry, and Sign out.
4. Account deletion — a four-step flow: a disclosure screen carrying ELEVEN bullets about what deletion does, an acknowledgement checkbox that gates the continue action, identity re-verification by one-time code with a password fallback, a final irreversible-action confirmation dialog, and a success screen. Then an in-progress status screen with five sub-states: received, waiting for an active order, waiting for a financial process, manual review, and completed. Plus offline and generic error states. Keep the register neutral and legally careful — never celebratory.
5. Legal & Support — a contact card whose Call, WhatsApp and Email rows each appear ONLY when an administrator has configured and enabled them, so design the partially-populated and fully-empty variants; working hours; then the list of active legal documents; and a document viewer showing title, version, effective date and plain-text body with preserved line breaks."
```

### Batch 6 — console shell, stats, live orders

```bash
pen -i design/01-design-system.pen -o design/06-admin-shell.pen -C . \
  -f docs/redesign/PENDEV_BRIEF.md -f docs/redesign/FEATURE_INVENTORY.md \
  -p "Design the staff console for Spicy Meal — used on a shop floor during rush, so scannability beats decoration. Desktop 1280px and above, plus the responsive layout at 768px and below. Arabic RTL and English LTR. Two role variants: admin (full control) and accountant (view-only, with a persistent amber warning bar).

1. Shell: sign-in screen; a top bar with logo, signed-in user and role chip, and sign out; a left sidebar with twelve tabs and icons that becomes a horizontally scrolling row on small screens; a live-orders count badge; a live-mode pill showing either 'Live' (realtime) or 'Auto-refreshing' (polling) with a last-updated timestamp; a pulsing new-order alert banner with Replay Ring and Dismiss; a sound mute toggle; a language toggle that flips the whole console; a full-screen initial-load error with retry; and a DISMISSIBLE non-fatal save-failure banner overlaid on the dashboard that must never replace the console. Three of the twelve tabs are capability-gated — design their loading, visible and confirmed-unavailable presentations.
2. Sales Overview: KPI tiles for today's sales with a versus-yesterday delta, active orders, completed today, VAT-inclusive average ticket and closed-branch count; a daily branch sales distribution chart; and sync indicators covering realtime, sync failed, awaiting sync and not scheduled.
3. Live Orders: a searchable, status-filterable order stream. Each order card shows the internal order number, customer name and phone (or 'No phone provided'), branch, order type, items with modifiers, coupon and loyalty discounts and totals; payment badges for pending online payment, cash payment required, unpaid, and payment method not set, each with an explanatory line; a payment re-verification action with loading and result states; a live status controller for the six order statuses; and a warning when the branch is not mapped to the point-of-sale system."
```

### Batch 7 — console management panels

```bash
pen -i design/06-admin-shell.pen -o design/07-admin-panels.pen -C . \
  -f docs/redesign/PENDEV_BRIEF.md -f docs/redesign/FEATURE_INVENTORY.md \
  -p "Continue the Spicy Meal staff console. Design these tabs, in both languages and both role variants (admin full, accountant view-only). See FEATURE_INVENTORY.md sections 3.3 to 3.7.

1. Menu Management — category and product CRUD with bilingual names and descriptions, price validation, calories, image URL, active flag, sort order and modifier-group assignment; modifier groups with minimum and maximum selection and a required flag; a CSV import with a downloadable template, file picker and per-row error reporting; delete confirmations.
2. Banners — list with sort order and active toggles; create/edit with bilingual titles, image upload, a schedule window, a tap action and sort order; reorder, enable/disable and delete.
3. Branch Management — branch list with a mapped/unmapped point-of-sale chip; an edit modal with bilingual names and addresses, phone, a map location picker, delivery fee, delivery minimum and estimated delivery minutes; toggles for delivery on/off, pickup on/off and a temporary delivery pause; a map-based delivery-zone editor with draw, edit and view modes plus the not-configured and 'set the branch location first' guards; the warning shown when delivery is enabled without a zone; and a branch-by-product availability matrix.
4. Financial Reports — branch and date-range filters defaulting to the current month in Riyadh time; six report ledgers (sales by day, by branch, by product, coupon usage, delivery fees, point-of-sale audit); summary tiles for revenue including 15% VAT, completed order volume, coupon savings and delivery fees collected; and a CSV export.
5. Integrations — three sub-tabs (Payments, Messaging & Notifications, POS & Delivery). Each provider has a secure config card where secret fields are WRITE-ONLY: the interface shows only that a secret exists and never displays or reads back its value. Include the payment provider status and connection test, the WhatsApp code panel, the email server panel, a dormant push-notification panel, the point-of-sale panel with per-feature sync flags and a catalog pull, and a catalog mapping screen with mapped and unmapped states. Accountants see an admin-only gate instead of the controls."
```

### Batch 8 — console operations panels

```bash
pen -i design/06-admin-shell.pen -o design/08-admin-ops.pen -C . \
  -f docs/redesign/PENDEV_BRIEF.md -f docs/redesign/FEATURE_INVENTORY.md \
  -p "Complete the Spicy Meal staff console with the operations and configuration tabs, in both languages and both role variants. See FEATURE_INVENTORY.md sections 3.8 to 3.12.

1. Operations Health — a read-only subsystem health summary with per-subsystem cards and shortcuts into the related tabs; plus loading, permission-denied and unavailable states.
2. Operations Alerts — an alerts inbox with severity, timestamp, entity and a bilingual message, a per-alert timeline, a daily digest list with a bilingual preview, and admin-only alert settings that accountants see read-only. External delivery of these alerts is disabled by design, so nothing in the interface may imply an email, SMS or push is sent.
3. Order Integrity — an observe-only incident monitor: incident list with severity and type carrying no personally identifying data, an incident timeline, and ONLY two actions, Acknowledge and Suppress, available to admins alone. There must be no retry, refund, resend, mark-paid or auto-fix control anywhere on this screen.
4. Settings — four to five grouped sections: Brand & VAT (logo URL, primary and secondary hex colours, VAT percentage, prices-include-VAT toggle, bilingual privacy policy and terms); Payment Methods (admin-only, accountant read-only — online on/off, cash on/off, a default method or automatic, an outage mode, and the advisory messages for no method enabled, online off with cash on, and cash orders reaching the point-of-sale unpaid); Map Settings (public configuration only); Loyalty Program (enabled, points per riyal, minimum points to redeem, discount value per point, plus live metrics for members, accumulated points, outstanding liability and total discount value); and Support & Contact (phone, WhatsApp and email each with its own enable toggle, plus bilingual working hours and description).
5. Legal Documents — per document type: bilingual title and plain-text content with preserved line breaks, version, effective date, an active flag and a requires-acceptance flag."
```

---

## 4. Iterating

```bash
# Refine an existing file in place, with a preview after each change
pen -i design/02-customer-core.pen -o design/02-customer-core.pen \
  --enable-preview \
  -p "Tighten the product card: image at a 4:3 fixed aspect with cover fit, and make sure the Arabic name can wrap to two lines without pushing the price out of the card."

# Export for review
pen -i design/04-confirmation-states.pen -o design/04-confirmation-states.pen \
  -e design/exports/confirmation-states.pdf --export-type pdf --export-scale 2 \
  -p "No changes — export only."
```

Attach real reference images with repeated `-f` flags (`-f shots/home.png
-f shots/receipt.png`) when you want the tool to see the current UI it is
replacing.

---

## 5. Review loop

After each batch:

1. Export a PDF/PNG set.
2. Walk the matching section of `FEATURE_INVENTORY.md` and tick every line the
   batch covers; list anything unmapped.
3. Check both languages render, both role variants exist (console), and every
   documented state has an artboard.
4. Feed the gaps back as a follow-up prompt on the same `.pen` file.

Do not move to the next batch while the current section has unticked lines —
that is exactly how features get lost.
