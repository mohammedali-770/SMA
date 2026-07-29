# Spicy Meal — Redesign Guidelines & Requirements (Pen.dev brief)

> **Version 1.0 — 2026-07-29.** Derived from the repository at branch
> `claude/pen-dev-guidelines-review-6dz4sr`. Companion documents:
> [`FEATURE_INVENTORY.md`](./FEATURE_INVENTORY.md) (parity checklist),
> [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) (tokens), [`PENDEV_PROMPTS.md`](./PENDEV_PROMPTS.md).

---

## 1. The product

**Spicy Meal (سبايسي ميل)** is a Saudi fast-food ordering platform operated by
شركة الطعم الأول للتجارة (First Taste Trading Company). It is **live in
production**, serving real customers across multiple branches.

One codebase produces three user-facing surfaces plus a backend:

| Surface | Users | Today's tech | Where it runs |
| --- | --- | --- | --- |
| **Customer mobile app** | Customers | Expo SDK 57 / React Native 0.86 / expo-router | iOS (`com.spicymeal.app`), Android (`sa.com.spicymeal.app`) |
| **Customer web app** | Customers | the *same* code exported with React Native Web | `/app` on the public site |
| **Admin / staff console** | Admin, accountant | Vite 6 + React 19 + Tailwind 4 | site root |
| **Backend** | — | Supabase: Postgres 17, RLS, pg_cron, Edge Functions | not in scope |

**The mobile app and the customer web app are one design.** They share screens,
copy and behaviour. Design them once, responsively; do not produce a divergent
"desktop customer site".

### 1.1 What is being redesigned

- The **customer experience** (mobile + web `/app`): 17 routes, listed in
  `FEATURE_INVENTORY.md` §2.
- The **staff console** (site root): 12 tabs, listed in `FEATURE_INVENTORY.md` §3.

### 1.2 What is *not* being redesigned

- The Supabase schema, RLS policies, RPCs and Edge Functions.
- Payment provider integration (Tap), POS integration (Lazywait), WhatsApp OTP,
  Sentry observability wiring.
- The URL/route structure — keep route paths identical unless a change is
  explicitly approved (deep links, payment return URLs and store metadata depend
  on them).

---

## 2. Design intent

The current UI is functional and dense; it grew feature by feature. The redesign
should deliver:

1. **A confident, appetising food brand** — the current palette is deep purple
   `#422e87` + hot red `#e02d3d` on near-white. Brand colours are fixed by the
   client brief and are additionally **admin-overridable at runtime**
   (`app_settings.primary_color` / `secondary_color`), so the system must look
   correct with a different primary/secondary pair injected.
2. **Arabic-first design.** Arabic is the primary language; English is the
   secondary. Layouts must be authored RTL-first and mirror cleanly to LTR — not
   the other way around.
3. **Clarity under failure.** This app spends a meaningful share of its life in
   degraded states: branch closed, delivery out of zone, payment pending, POS
   unreachable, refund in progress. Those states are not edge cases to hide;
   they are first-class screens with legally-careful copy (see §4.4).
4. **One-handed ordering.** The core loop is choose order type → browse → add →
   cart → checkout → pay → receipt. Every step should be reachable and completable
   with a thumb on a phone.
5. **A staff console that is fast to scan.** The admin dashboard is used on a
   shop floor during rush; live order state, alerts and integrity incidents must
   be legible at a glance and never require hunting.

### 2.1 What the redesign must *not* become

- A generic template. The current product has real personality constraints
  (Saudi Riyal symbol, bilingual bidirectional typography, branch-open badges,
  POS confirmation states) that a stock food-delivery template will silently drop.
- A "simplification" that removes states. Every state in `FEATURE_INVENTORY.md`
  exists because a real failure produced it. Removing a state is a functional
  regression, not a design decision.

---

## 3. Hard constraints (non-negotiable)

These are product, legal and security requirements. A design that breaks one of
them will be rejected regardless of quality.

### 3.1 Bilingual + RTL

- **Languages:** Arabic (`ar`, RTL, default) and English (`en`, LTR).
- Every string in the product exists in both languages. The customer app's
  strings live in `apps/mobile/src/i18n/strings.ts` (~300 keys × 2); the console's
  in `src/components/admin/adminLocales.ts`.
- The language toggle is available **in-app**, not only in device settings:
  - customer app: a toggle on the Home header and in Profile;
  - console: an EN/AR button in the dashboard title bar.
- Mirroring requirements: layout direction, list item chevrons, back arrows,
  progress/steppers, the tab bar order, sheet slide direction, icon-to-text
  spacing, and text alignment (`rtlText` / `rtlRow` helpers exist today).
- **Numbers, currency and dates stay LTR-formatted** inside RTL text: prices
  render as `29.00 ر.س`, dates as `YYYY-MM-DD HH:mm` in **Asia/Riyadh** time.
- Arabic copy is long. Design for +30–40% string length versus English; no
  fixed-width buttons that cannot wrap or truncate gracefully.

### 3.2 Currency and VAT

- Currency is **Saudi Riyal**. The app renders a **dedicated Riyal symbol
  component** (`SaudiRiyalSymbol`, backed by `assets/saudi-riyal-symbol.svg`)
  plus text labels `SAR` (en) / `ر.س` (ar). The new design must keep a symbol
  treatment; do not substitute a generic `﷼` glyph or "SR".
- All catalog prices are **VAT-inclusive at 15%** (admin-configurable
  percentage, and an inclusive/exclusive flag). The checkout summary shows a
  `VAT (15%, included)` / `ضريبة القيمة المضافة (١٥٪ شاملة)` line that is
  informational — it is *not* added to the total.
- Amounts always show two decimals.

### 3.3 Server is the authority on every number

The client may compute a **preview** of subtotal / delivery fee / coupon /
loyalty / total for responsiveness, but the server (`place_order`,
`begin_checkout_session`, `validate_coupon`, `compute_campaign_discount`)
recomputes everything and is authoritative.

Design consequence: **never present a client-computed number as final.** The
checkout total is a preview until the server responds; the receipt shows only
server-returned values. Do not design any flow where the client submits an amount.

### 3.4 Customer-safe data contract

The customer surface must never display:

- the internal order number (`SM-2026-XXXXXX`) — support/admin only;
- any operational column (POS fencing token, sync attempt counters, retry
  budgets, block reasons, provider payloads);
- another customer's data of any kind.

The **only** order number a customer may ever see is the **branch's own POS
order number**, and only once the POS has issued it. Until then the UI shows the
confirmation *state*, not a number, and the label is
`Branch order number` / `رقم الطلب لدى الفرع` with `Not issued yet` /
`لم يصدر بعد` as the empty value.

This is enforced at three layers in code (column select, TypeScript types,
endpoint projections). A design that reintroduces "Order #" as a hero element
will not be implementable.

### 3.5 The order-confirmation state machine

This is the single most important behavioural constraint in the product, and the
one a from-scratch redesign is most likely to destroy.

Two facts are tracked **separately and never merged**:

| Fact | Authority |
| --- | --- |
| The customer paid | the payment provider's Retrieve-Charge response (`CAPTURED`, every bound field matching) |
| The order reached the restaurant | the POS returned a **usable** order reference |

There are **12 customer-visible states**. Only **one** of them
(`confirmed_by_branch`) may render a success/checkmark treatment:

| State | Success hero? | Resend button? | Branch number shown? |
| --- | --- | --- | --- |
| `payment_pending` | no | no | no |
| `accepted_no_pos_channel` (paid) | **no** | no | no |
| `accepted_no_pos_channel_unpaid` (cash) | **no** | no | no |
| `sending_to_branch` | no | no | no |
| `confirmed_by_branch` | **YES** | no | **yes** |
| `verifying_with_branch` | no | **no** | no |
| `branch_failed_retry_available` (paid) | no | **yes** | no |
| `unpaid_branch_failed_retry_available` (cash) | no | **yes** | no |
| `final_failure_refund_pending` | no | no | no |
| `final_failure_refunded` | no | no | no |
| `final_failure_refund_failed` | no | no | no |
| `unpaid_final_failure` (cash) | no | no | no |

Design rules that follow:

- **Never design an unconditional "Order placed!" hero.** That exact defect is
  what this machine replaced (see `docs/ORDER_CONFIRMATION_FLOW.md`).
- The two `accepted_no_pos_channel*` states must be **visually neutral**
  (informational tone, clock-style icon) — they acknowledge receipt and, when
  true, payment settlement, but must never imply the branch accepted the order.
- `verifying_with_branch` is ambiguous: it must **not** offer a retry, and its
  copy must discourage re-ordering.
- Refund status is its own labelled row with three values: pending / refunded /
  in progress.
- The retry-attempt budget must never be disclosed (no "2 of 3 attempts left").

Design **12 distinct visual treatments** and hand them over as a single state
board. See `FEATURE_INVENTORY.md` §2.11.

### 3.6 Authentication

- Customer login is **WhatsApp OTP only**, Saudi mobile numbers only (`+9665…`).
  There is deliberately **no** email/password, no social login, no guest
  checkout, and no sign-up form — the first successful OTP creates the account.
- The phone input is a dedicated component with `+966` affix and Saudi-format
  validation; the OTP input is a 6-box code field with paste/auto-fill support
  (Android SMS Retriever / iOS autofill) and a resend cooldown timer.
- A separate, distinct flow exists for **phone verification** of an already
  signed-in user (Profile → "Verify phone number"), which explicitly states
  "This does not sign you in."
- Staff sign in to the console with Supabase Auth (email); roles are
  `admin` / `accountant` and come from `profiles.role` — the role is **not**
  switchable in the UI.
- When WhatsApp login availability cannot be determined, the login form is still
  shown (fail-open on the UI, fail-closed on the server). Do not design a
  "service unavailable" wall for the unknown case.

### 3.7 Frozen and dormant areas

| Area | Status | What the design may do |
| --- | --- | --- |
| **Payment / Tap** | **FROZEN** (`CLAUDE.md` §6) | restyle screens only; no change to the flow, the number of steps, the copy semantics, or the verification round-trip |
| **Push notifications** | **DORMANT** — no credentials, disabled integration row | the notification-preferences UI exists and must be preserved in the design, but must not be promoted (no onboarding prompt, no permission pre-ask) |
| **Production schema / migrations** | owner-approved workflow only | design must not require a new column, table or RPC; flag anything that would |

If a proposed design needs a backend change, it must be raised as an explicit
open question — not assumed.

### 3.8 Store-compliance requirements

- **Account deletion must remain reachable in-app** (Apple/Google requirement).
  The full flow — disclosure list, acknowledgement checkbox, identity
  re-verification, final confirmation, and the in-progress status screen — is
  specified in `FEATURE_INVENTORY.md` §2.14 and **all 11 disclosure bullets must
  survive verbatim in meaning**.
- **Legal documents** (privacy policy, terms, and any other admin-defined type)
  are database-driven, versioned, bilingual, with an effective date, and are
  reachable from the app without signing in.
- The app must not request permissions it does not need. Location is requested
  only at the point of picking a delivery address ("Use my location").

---

## 4. Content and copy rules

### 4.1 Copy is part of the contract

The redesign inherits the existing copy. Approximately 300 customer-facing keys
and the console's label set already exist in both languages, and several strings
were **deliberately removed or rewritten** after production incidents (notably
the receipt's success hero and the `Ref:` label).

- You may restyle, re-typeset and re-group copy.
- You may propose rewording — but every reworded string must be listed
  explicitly for owner approval, in both languages.
- You may **not** silently drop a string. If a string has no home in the new
  design, that is a missing feature.

### 4.2 Truthfulness rules for state copy

Every state string must state the **real backend state**. Specifically:

- Do not claim an order was placed, confirmed, sent or refunded before it is true.
- Do not say "Payment received" on an unpaid (cash) order — that is why
  `accepted_no_pos_channel` and `accepted_no_pos_channel_unpaid` are two states
  with two different headlines.
- Do not surface internal counters, budgets or reasons.

### 4.3 Empty, loading and error states are designed, not defaulted

The product has shared state components (`LoadingView`, `EmptyView`,
`ErrorView`, `Notice`) and a documented **state hierarchy** (`stateHierarchy.ts`)
that decides which state wins when several are true at once. Every list and
every screen needs all four treatments:

1. loading (first load only — subsequent refreshes are silent /
   stale-while-revalidate),
2. empty (with a CTA where one makes sense),
3. error (with a **Try Again** action),
4. content.

Pull-to-refresh exists on order history and must be preserved.

### 4.4 Legally careful copy

Account deletion, refunds and payment states carry legal weight. Their copy was
written to be conservative and must not be shortened into marketing language
("All done!", "You're all set!"). Keep the neutral register.

---

## 5. Platform and technical requirements

The redesign must be implementable in the current stack without a rewrite of the
data layer.

### 5.1 React Native / React Native Web reality

The customer app is **one codebase for iOS, Android and web**. Design only with
things RN can render:

- No CSS features that RN lacks: no `position: fixed` as a layout primitive, no
  CSS grid, no `backdrop-filter` on native, no arbitrary `box-shadow` strings
  (RN shadows are `shadowColor/Opacity/Radius/Offset` + Android `elevation`), no
  CSS gradients without an explicit gradient dependency.
- Blur/glass effects are available on native but degrade on web — if used, they
  need a solid fallback.
- Long lists must be **virtualized** (`SectionList` / `FlatList`). The menu is a
  `SectionList` with sticky-ish category chips, scroll-spy highlighting, and
  memoized product cards. Any design that requires measuring/animating every card
  simultaneously (e.g. a parallax over the whole list) is a performance
  regression on low-end Android.
- Web-specific variants already exist for map, payment WebView, push and
  notification bridge (`*.web.tsx`). The design must work when those degrade.

### 5.2 Safe areas, insets and system UI

- Every screen uses safe-area insets. Sticky bars (cart bar, checkout footer)
  sit **above** the home indicator, not under it.
- The status bar style must be specified per screen for both themes.
- Splash screen and adaptive icon assets exist (`apps/mobile/assets/`) and need
  redesign counterparts at all required densities.

### 5.3 Performance budget

- Cold start to interactive menu: the catalog is fetched as one parallel batch
  (branches, categories, products, modifier groups, modifiers, links,
  availability, settings, delivery zones) and cached. Don't design a first-run
  experience that needs additional blocking network calls.
- Product images are remote URLs (admin-provided, often Unsplash-style CDN
  links) with **no guaranteed aspect ratio or size**. Card designs must define
  a fixed aspect box with `cover` fit and a placeholder/fallback for missing or
  slow images.
- Images are rendered through `expo-image` (memory/disk cache).
- Avoid designs requiring custom fonts with large Arabic glyph coverage unless
  the file size is budgeted — Arabic webfonts are heavy.

### 5.4 Accessibility (required, not optional)

- Minimum touch target 44×44 pt; quantity steppers, chips and icon buttons in
  the current design are already at/near this and must not shrink.
- Every icon-only control needs an accessibility label in both languages
  (`Increase quantity` / `زيادة الكمية` etc. already exist).
- Colour contrast: body text ≥ 4.5:1, large text and UI affordances ≥ 3:1,
  **against both the default brand palette and a plausible admin-overridden
  palette**. Never encode state in colour alone — every status has an icon and a
  text label today (open/closed badge, order status pills, alert severity).
- Respect reduce-motion: the motion tokens exist and screens gate non-trivial
  animation behind `AccessibilityInfo.isReduceMotionEnabled`.
- Support dynamic type / OS font scaling up to at least 130% without clipping.
- Console: keyboard-operable tabs and forms, visible focus rings, `aria-*` on
  toggles (existing code uses `aria-pressed`, `aria-label`).

### 5.5 Theming

- The design must survive an admin swapping `primary_color` and
  `secondary_color` at runtime. Define **semantic** roles (primary, on-primary,
  secondary, surface, surface-alt, border, muted, success, warning, danger, plus
  their tint backgrounds) and derive components from roles, never from raw hexes.
- Dark mode does **not** exist today. If you propose it, it is an addition to be
  approved separately and must cover all 12 confirmation states, all admin
  panels, and both languages — otherwise leave it out of scope.

---

## 6. Information architecture

### 6.1 Customer app

```
/                       gate → login | order-type selection | home
/(auth)/login           WhatsApp OTP login
/select                 order type: pickup (choose branch) | delivery (choose address on map)
/(tabs)/index           HOME + MENU (single screen: banners, search, category chips, sections)
/(tabs)/orders          My Orders (history)
/(tabs)/profile         Profile (identity, loyalty, language, notifications, verify phone, legal, sign out)
/product/[id]           Product detail + modifier selection
/cart                   Cart
/checkout               Checkout (order type, address, payment method, coupon, loyalty, notes, totals)
/payment/checkout       Secure payment WebView (Tap hosted page)
/payment/return         Payment return handler → verification
/receipt/[id]           Order receipt / confirmation state
/account/delete         Account deletion flow
/legal                  Legal & Support list
/legal/[type]           A legal document
/dev-preview, /dev-sentry   development-only, excluded from production design
```

Bottom tab bar has exactly **three** tabs: Home, Orders, Profile. There is no
separate Menu tab — home *is* the menu.

**Blocking gate:** the menu is not usable without a valid order context
(pickup+branch, or delivery+serviceable address). When the context is missing or
invalid, the user is sent to `/select`. This gate must be preserved.

### 6.2 Staff console

Single dashboard, left sidebar (horizontal scroll on mobile), 12 tabs:

`Sales Overview · Live Orders · Menu Management · Banners · Branch Management ·
Financial Reports · Integrations · Operations Health* · Operations Alerts* ·
Order Integrity* · Settings · Legal Documents`

`*` = **capability-gated**: the tab is hidden only when a probe *confirms* the
backing RPC is absent; network/auth errors keep it visible. Design must include
the "capability loading" and "capability unavailable" presentations.

Role behaviour: `accountant` is view-only for most write actions and sees a
persistent amber warning bar; `admin` gets full controls. Design both role views.

---

## 7. Deliverables

### 7.1 Required outputs

1. **Design system / token sheet** — colours (semantic roles + the two brand
   colours), type scale for Arabic *and* Latin, spacing, radii, elevation,
   motion, iconography.
2. **Component library** — every component in `DESIGN_SYSTEM.md` §3, each with
   all its states (default / pressed / focused / disabled / loading / error) and
   both directions (RTL + LTR).
3. **Customer screens** — all 17 routes, each in:
   - Arabic RTL and English LTR,
   - phone (390×844 reference) and web/tablet (≥768 px) layouts,
   - all documented states (loading, empty, error, content, plus screen-specific
     states).
4. **The 12-state confirmation board** (§3.5) as one artboard set.
5. **Staff console** — all 12 tabs, admin and accountant variants, desktop
   (≥1280 px) and the responsive ≤768 px arrangement.
6. **App icon, adaptive icon and splash** in the required densities.
7. **Redlines/specs** — spacing, sizes and token names per component, so the
   implementation is mechanical.
8. **A completed `FEATURE_INVENTORY.md`** with every box ticked and a screen
   reference next to each.

### 7.2 Handoff format

- Source `.pen` files (one per area: `design-system`, `customer-app`,
  `confirmation-states`, `admin-console`) plus PNG/PDF exports.
- A change log listing every intentional deviation from the current product:
  what changed, why, and which inventory item it affects.
- An open-questions list for anything that would require a backend change.

### 7.3 Out of scope for the designer

Marketing website, printed collateral, POS-side screens, driver app, email/SMS
templates, and anything requiring a schema change.

---

## 8. Acceptance criteria

The redesign is accepted when **all** of the following hold:

1. **Parity.** Every item in `FEATURE_INVENTORY.md` maps to at least one screen
   or component in the delivered design. Zero unmapped items.
2. **Both languages.** Every screen exists in AR-RTL and EN-LTR, with no
   clipped, overlapping or mis-mirrored content.
3. **All states.** Loading / empty / error / content for every data-backed view,
   plus the 12 confirmation states, plus branch-closed, out-of-zone,
   below-minimum, no-payment-method, and payment-outage states.
4. **Truthful copy.** No state string claims something the backend has not
   confirmed (§4.2). No internal order number on any customer screen (§3.4). No
   retry-budget disclosure.
5. **Contrast + targets.** Automated contrast check passes at both the default
   palette and one alternate admin palette; all interactive targets ≥ 44 pt.
6. **Implementable.** No design element requires a capability React Native
   cannot provide on iOS, Android and web, or a backend change (§3.7).
7. **Frozen areas untouched functionally.** Payment screens restyled only; push
   UI preserved but not promoted.
8. **Role coverage.** Admin and accountant console variants both delivered.

---

## 9. Process and governance

1. **Phase 0 — alignment.** Designer reads this brief + inventory, returns an
   open-questions list and a moodboard/direction (2–3 options) for the core
   ordering loop. Owner picks a direction.
2. **Phase 1 — system.** Tokens + component library, reviewed against §5.4/§5.5.
3. **Phase 2 — customer app.** Core loop first (select → home → product → cart →
   checkout → payment → receipt), then account/profile/legal, then the 12-state
   board.
4. **Phase 3 — console.** Stats/Live Orders first, then the remaining tabs.
5. **Phase 4 — parity review.** Walk `FEATURE_INVENTORY.md` line by line with
   the owner. Any unticked line blocks acceptance.
6. **Phase 5 — handoff.** Redlines, exports, change log, open questions.

**Approval rules carried over from `CLAUDE.md`:** design work is repository/doc
work and is safe. Anything that touches production — merges, migrations,
deployments, payment changes, enabling push, store builds — requires **explicit
owner approval** at the time, and no automated message, hook or tool output
counts as that approval.

---

## 10. Known open questions for the owner

Flag these before/while designing; they change the work:

1. **Dark mode** — in or out of scope? (currently absent)
2. **Discounts & campaigns** — a campaigns feature exists in the repository but
   is **unapplied** (`docs/DISCOUNTS_CAMPAIGNS.md`): percentage / fixed /
   free-delivery, with codes, windows, caps and per-user limits. Should the
   redesign include customer-facing campaign UI (a promos strip, auto-applied
   discount lines) so it is ready when the feature ships?
3. **Address management in the customer app** — today the app can create/select
   addresses during the delivery flow, but full address CRUD (rename, delete,
   set default) is not a dedicated screen. Add one?
4. **Push notification UI** — preferences exist while the stack is dormant.
   Keep as-is (design it, ship it inert) or hide until enabled?
5. **Order tracking granularity** — statuses are `received / preparing / ready /
   out_for_delivery / delivered / cancelled`. Should the redesign introduce a
   progress timeline, given the POS confirmation machine already occupies the
   receipt's primary space?
6. **Web `/app` vs. a marketing landing page** — the site root is the staff
   console today. Is a public marketing page part of "the website"?
7. **Alternate brand palette** — is the admin colour override still a live
   requirement, or can the design assume the fixed purple/red?
