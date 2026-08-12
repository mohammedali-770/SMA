# Branch Feature-Retention Audit

Baseline build branch: `claude/project-build-ie4b56`
Baseline build commit: `e01c8b5ad5ac48c69d0163a875792f7ef5a4e582`
Next-build integration branch: `release/mobile-next-build`

## Non-negotiable rule

A historical branch is not considered preserved merely because it was merged, is an ancestor, or produces `git cherry -`. Later work can remove or replace the behavior. Before any branch is deleted we must identify what that branch actually delivered and prove the intended behavior or operational control still exists in the next-build tree. Missing behavior is reimplemented on top of the stable Build 4 baseline; stale branches are never merged wholesale.

Status meanings:

- **RETAINED** — intended behavior is present in the next-build source and current wiring.
- **RETAINED / NEWER** — the original implementation was superseded, but its intended behavior is present in a newer implementation.
- **INTENTIONALLY INACTIVE** — source/contracts remain but activation is deliberately disabled by a later product decision.
- **NON-RUNTIME** — documentation/diagnostic/history only; there is no application behavior to copy into the build.
- **NO UNIQUE FEATURE** — the branch pointer contains no independent product behavior beyond work already audited elsewhere.
- **GAP — PORT** — wanted behavior from the branch is absent from the next-build source and must be restored safely before Build 5.

Source-level retention is only phase 1. Final classification as deletable waits for the full test/typecheck/Expo/native release gate and physical-device Build 5 validation.

## Protected / target branches

| Branch | Intended behavior | Current evidence | Status |
|---|---|---|---|
| `claude/project-build-ie4b56` | Build 4 production baseline | Exact Build 4 source; app launches and order submission was physically verified | **RETAINED / BASELINE** |
| `main` | Historical manual EAS-build workflow | Current `.github/workflows/eas-build.yml` still supports manual/tag EAS builds and is substantially hardened | **RETAINED / NEWER** |
| `release/mobile-next-build` | Integration target for Build 5 | Created directly from the stable Build 4 commit; only audited changes go here | **TARGET** |

## Application / operational branches

| Branch | Intended behavior delivered by branch | Evidence in `release/mobile-next-build` | Status |
|---|---|---|---|
| `agent/delete-branches-dashboard` | Safe admin branch deletion with confirmation, API handling, role guard | `src/components/admin/branchDeletion.ts`, `BranchPoliciesPanel.tsx`; accountants remain read-only | **RETAINED** |
| `agent/delete-branches-dashboard-copy` | Later duplicate/refinement of the same deletion control | Same current deletion helper/panel includes the refinements and bilingual confirmation | **RETAINED / NEWER** |
| `chore/eas-status-7725c5de` | Read-only EAS status polling for one historical build | `.github/workflows/eas-status.yml` is now generic `workflow_dispatch`, takes `build_id`, and runs `eas build:view` from `apps/mobile` | **RETAINED / NEWER** |
| `chore/eas-status-map-preview-build` | Same status poller pointed at a map preview build | Generic current status workflow supersedes the hard-coded historical build | **RETAINED / NEWER** |
| `chore/mobile-store-readiness` | Store metadata hardening; push dormant; iOS encryption false; no tablet; locales | `apps/mobile/app.json` + `app.config.js`: encryption false, tablet false, AR/EN, conditional push plugin | **RETAINED** |
| `chore/release-discipline` | Production Sentry gate, function-drift gate, release checklist | Current `app.config.js`, `.github/workflows/function-drift.yml`, production workflow/release docs | **RETAINED** |
| `chore/standardize-node-22` | Node 22 single source of truth | `.nvmrc` = `22`; workflows read it | **RETAINED** |
| `ci/production-readiness-gates` | Build, Edge typecheck and mobile dependency gates | `.github/workflows/production-gates.yml` and mobile audit script remain | **RETAINED** |
| `ci/sql-suite-postgres` | Throwaway PostGIS migration-chain + SQL suites | `.github/workflows/sql-suites.yml` and SQL CI harness remain | **RETAINED** |
| `claude/fix-sentry-gate-verification-commands` | Correct Sentry verification commands | Current Sentry docs/config use the corrected release gate | **RETAINED / NEWER** |
| `claude/mobile-sentry-conditional-plugin` | Remove Sentry Expo plugin safely when token absent | `apps/mobile/app.config.js` conditionally removes the plugin | **RETAINED** |
| `claude/mobile-sentry-upload-graceful-degradation` | Non-production Sentry upload degradation instead of crashing builds | Current app/EAS config preserves this; production still fails closed via release gate | **RETAINED / NEWER** |
| `claude/record-sentry-gate-verification` | Record Sentry gate verification | Documentation/evidence retained; no runtime feature to port | **NON-RUNTIME** |
| `claude/spicy-meal-apk-build-nioaew` | Product decision: payment/refund automation postponed, push dormant, campaigns inert | Current code/docs keep payment/provider area frozen; campaign engine exists without checkout activation; push remains gated | **INTENTIONALLY INACTIVE** |
| `feat/admin-dashboard-navigation` | Grouped responsive admin navigation and branch overview usability | `AdminSidebar.tsx`, `adminNav.ts`, stats/branch view modules remain | **RETAINED** |
| `feat/admin-ux-resilience` | Persist active admin tab in hash, offline warning, usable receipt printing | `adminNav.ts` hash helpers, current console offline handling, `src/index.css` print rules | **RETAINED** |
| `feat/button-field-migration` | Consolidated safe Button/Field primitives | Current Ember-on-Cream `design-system/ui/Button.tsx` + `Field.tsx` supersede the migration | **RETAINED / NEWER** |
| `feat/checkout-address-ux` | Current-location map control, required delivery landmark, keyboard-safe form, editable checkout quantities | Current `LocationPickerMap`, `locationDescription`, shared address book and `CheckoutScreen` retain the behaviors | **RETAINED / NEWER** |
| `feat/delivery-map-link` | Open delivery address in Maps from admin receipt | `OrderReceiptModal.tsx` imports `mapsUrlFor`, calculates a validated maps URL and renders map behavior | **RETAINED** |
| `feat/design-system-ember-on-cream` | Ember-on-Cream tokens/fonts/primitives | `design-system/tokens.ts`, generated mobile tokens, DS fonts and UI primitives remain canonical | **RETAINED** |
| `feat/discounts-campaigns` | Campaign schema/RLS/discount engine, intentionally not wired into order placement | `20260728120000_discounts_campaigns.sql` remains and explicitly preserves the non-wired safety boundary | **RETAINED AS SCOPED** |
| `feat/ds-admin-catalog` | DS migration for menu/banner/branch/delivery/Lazywait catalog admin UI | Current admin catalog panels plus `AdminModal`, `ToggleChip`, branch view components remain | **RETAINED / NEWER** |
| `feat/ds-admin-final` | DS completion for settings/reports/stats/integrations/payment/OTP/email/push/legal | Current panels and DS UI remain; fabricated/legacy glass claims stay removed | **RETAINED** |
| `feat/ds-admin-operations` | DS migration for Live Orders, health, alerts, integrity | Current operation panels + extracted view modules remain | **RETAINED** |
| `feat/ds-admin-primitives` | Shared admin design primitives | `src/design-system/ui/*` and generated tokens remain | **RETAINED** |
| `feat/ds-admin-shell-ops` | Admin shell and language-aware typography | Current shell/sidebar/header and DS language/font helpers remain | **RETAINED / NEWER** |
| `feat/ds-auth-surface` | Customer auth/OTP DS migration without changing auth authority | `LoginScreen`, `PhoneOtpLogin`, `OtpCodeInput`, Saudi phone input use current DS | **RETAINED / NEWER** |
| `feat/ds-checkout-payment-surface` | Safe `__DEV__` fixture/preview surfaces | `dev-fixture`, fixture gate/safety modules and tests remain | **RETAINED** |
| `feat/ds-checkout-payment-ui` | Checkout/payment visual migration while preserving frozen payment logic | Current checkout/payment screens use DS; provider behavior remains frozen | **RETAINED / NEWER** |
| `feat/ds-home-menu-surface` | Home/menu/banner/product-card DS surface | Current `HomeMenuScreen`, `BannerCarousel`, `ProductCard` remain | **RETAINED** |
| `feat/ds-modal-focus` | Portal modal, focus trap, Escape, restore focus, inert background | `src/components/admin/view/shared/ModalShell.tsx` contains all of those behaviors | **RETAINED** |
| `feat/ds-order-type-legacy-removal` | Order-type DS migration and removal of legacy theme/Button/Notice path | Current `OrderTypeSelectScreen` is DS-based and legacy components are no longer authoritative | **RETAINED / NEWER** |
| `feat/ds-orders-profile` | Orders/receipt/profile/delete-account/notifications/legal DS migration | Current corresponding feature screens use DS | **RETAINED / NEWER** |
| `feat/ds-product-cart-surface` | Product/cart/header/quantity DS migration | Current product/cart/Header/quantity components use DS | **RETAINED / NEWER** |
| `feat/lazywait-api-v2` | Typed 27-endpoint Lazywait v2 client + safe Create Order builder; assumed delivery fields gated | `supabase/functions/_shared/lazywaitApi.ts` remains; live path still refuses unconfirmed delivery assumptions | **RETAINED AS SCOPED** |
| `feat/mobile-profile-management` | Editable customer name and saved-address CRUD/default/map flow | Current `ProfileScreen`, `EditableName`, `AddressListScreen`, `AddressEditScreen`, `AddressProvider` remain wired | **RETAINED** |
| `feat/order-confirmation-state-machine` | Customer-safe confirmation/POS/refund display states and resend rules | `features/orders/orderConfirmation.ts` + current order/receipt views remain | **RETAINED** |
| `feat/order-read-contracts` | Customer-safe order projections and internal-ID hiding | Current order mappers/selectors/views use customer-safe display contracts | **RETAINED / NEWER** |
| `feat/otp-autofill` | Multi-box OTP, WebOTP on web, iOS `oneTimeCode`, Android `sms-otp` hints | `OtpCodeInput`, `otpAutofill`, `useOtpAutofill`, `PhoneOtpLogin` remain wired | **RETAINED AS ORIGINALLY SCOPED** |
| `feat/price-component-migration` | Shared Riyal/price rendering | Current `Price.tsx` delegates to DS `MoneyText` with SAMA symbol | **RETAINED / NEWER** |
| `feat/whatsapp-only-saudi-login` | WhatsApp-only Saudi +966 login; no email fallback | Current `PhoneOtpLogin` normalizes/validates Saudi mobile and uses Supabase phone auth/WhatsApp hook | **RETAINED** |
| `feature/whatsapp-ai-inbox-mvp` | Branch name is misleading; current pointer is ordinary already-merged project history, not an AI-inbox implementation | No independent AI-inbox implementation exists at this branch tip to recover; its history is covered by the relevant feature branches below | **NO UNIQUE FEATURE** |
| `fix/address-description-whitespace` | Server-side trimming of tabs/newlines from delivery guidance | Current address payload/server migration tests and validation path preserve normalization | **RETAINED** |
| `fix/checkout-money-display` | Correct VAT label/receipt money display/empty-cart fee behavior | Current checkout/receipt DS components and VAT helpers retain the corrected display contract | **RETAINED / NEWER** |
| `fix/customer-app-guards-and-locale` | AuthGate on customer routes; legal/payment-return exceptions; no fake locale auto-seeding | Current `AuthGate` and root route wrappers remain; locale persistence remains explicit | **RETAINED** |
| `fix/ds-muted-text-contrast` | WCAG-safe tertiary muted text | Current DS token `appText3` / `conText3` = `#746886` with contrast contract comments/tests | **RETAINED** |
| `fix/eas-status-poller-project-dir` | Run `eas build:view` inside mobile project directory | Current generic `eas-status.yml` uses `working-directory: apps/mobile` | **RETAINED / NEWER** |
| `fix/hook-node-json-parser` | Capability-probed jq/python/node parser fallback; fail closed | Current `.claude/hooks/protect-default-branch.sh` contains the capability-probe chain and Node fallback | **RETAINED** |
| `fix/lazywait-lifecycle-test-case7` | Regression coverage for synced-reference lifecycle guard | Current Lazywait lifecycle tests remain in the suite | **RETAINED** |
| `fix/mobile-map-google-config` | Production Google map/WebView env validation and graceful error path | `app.config.js`, `lib/map`, `LocationPickerMap` preserve config validation and fallback behavior | **RETAINED / NEWER** |
| `fix/order-integrity-and-false-claims` | Customer notes, truthful CSV behavior, removal of false ZATCA claims | Current admin order/catalog surfaces retain notes and truthful import behavior; legacy fabricated compliance copy remains removed | **RETAINED / NEWER** |
| `fix/refund-worker-scheduler` | Scheduler/security contracts for refund worker | Code/contracts are preserved but later payment-postponement decision intentionally keeps refund automation disabled | **INTENTIONALLY INACTIVE** |
| `perf/admin-order-feed` | Optimistic status update and bounded polling instead of full refetch on each click | Current admin order context/feed implementation retains local update + bounded refresh behavior | **RETAINED** |

## Documentation / historical branches

These are still audited one by one, but they do not add code to the mobile binary.

| Branch | Purpose | Status |
|---|---|---|
| `docs/address-delete-migration-runbook` | Address-delete migration/runbook | **NON-RUNTIME — retained in docs** |
| `docs/incident-readiness` | Incident response/readiness docs | **NON-RUNTIME — retained in docs** |
| `docs/reconcile-ops-health-migration-ledger` | Operations-health migration ledger reconciliation | **NON-RUNTIME — retained/superseded by current ledger** |
| `docs/staff-operations` | Staff operations manual | **NON-RUNTIME — retained in docs** |
| `claude/organize-project-branches-m7uun2` | Historical readiness/branch-organization work; two tip commits are stale documentation | **NON-RUNTIME — do not copy stale claims into Build 5** |
| `claude/pendev-redesign-prompt-r2cnl1` | Pen.dev from-scratch redesign brief | **NON-RUNTIME — design brief retained/superseded** |
| `diag/mobile-audit-advisory-20260810` | Temporary read-only npm advisory diagnostic workflow | **NON-RUNTIME DIAGNOSTIC — current production dependency audit is the durable control** |

## Active branch verification

| Branch | Result |
|---|---|
| `agent/delete-branches-dashboard-copy` | Functionality retained by current admin branch-deletion implementation. |
| `chore/eas-status-7725c5de` | Historical build ID is intentionally not retained; its useful behavior is retained by the generic current status workflow. |
| `chore/eas-status-map-preview-build` | Same: historical build ID obsolete, generic poller retained. |
| `claude/organize-project-branches-m7uun2` | Unique tip is stale documentation only. No app feature to port. |
| `claude/pen-dev-guidelines-review-6dz4sr` | **Requires feature extraction rather than wholesale merge. Three lost behaviors found so far; see below.** |
| `claude/pendev-redesign-prompt-r2cnl1` | Design prompt only. No runtime code to port. |
| `diag/mobile-audit-advisory-20260810` | Diagnostic workflow only; intentionally not part of production behavior. |
| `fix/health-detect-stranded-orders-clean-20260810` | Stranded-order health/alert behavior is retained by merged #185 (`order_integrity_health_summary`, independent critical alert and bounded partial index). |

## Confirmed retention gaps to port before Build 5

### 1. Pen.dev dark mode — mobile and admin

`claude/pen-dev-guidelines-review-6dz4sr` ended with commit `689aac3` (`dark mode for both surfaces`). That branch implemented a persisted System/Light/Dark preference and dark palettes. The current next-build tree has no mobile `ThemeProvider`, `apps/mobile/app.json` is fixed to `userInterfaceStyle: "light"`, the Profile screen has no appearance control, and the admin CSS has no active dark theme. This is a genuine feature regression, not a Git-history artifact.

**Action: GAP — PORT.** Reimplement dark mode against the current Ember-on-Cream DS instead of copying the stale pre-DS theme files.

### 2. Language switch on the blocking order-type screen

Pen.dev mobile implementation commit `3ef6cdd` deliberately put a language switch on the blocking Pickup/Delivery gate because a first-run customer can be redirected there before reaching Profile. The current Home screen has a language switch, but `OrderTypeSelectScreen` does not.

**Action: GAP — PORT.** Restore a compact AR/EN control on `/select` using the current `I18nProvider`; do not resurrect legacy theme/components.

### 3. Visible `#` prefix for branch-facing order numbers

The same Pen.dev implementation explicitly changed the visible branch order reference to `#<number>`. Current `orderDisplayNumber()` returns the provider reference without the prefix and current order cards render it directly.

**Action: GAP — PORT after confirming every receipt/card location uses the shared display formatter**, so the change is applied once and does not leak internal SMA UUIDs.

## Not a branch-retention gap: native OTP behavior

The OTP branch itself never implemented a native SMS-Retriever/WhatsApp zero-tap module. It delivered WebOTP plus native OS autofill hints, and those exact behaviors are still present. If true native WhatsApp zero-tap is wanted, that is a new enhancement rather than missing code from the historical branch. It will not be used as a reason to delete or retain unrelated branches.

## Final gate before any branch cleanup

1. Finish the source-level check for every row above and any branch created while this audit is in progress.
2. Port every **GAP — PORT** item onto `release/mobile-next-build` without overwriting Build 4 stability fixes.
3. Run root/mobile TypeScript, complete unit suites, design-system sync/hygiene/contrast checks, Expo Doctor/install check/autolinking, dependency gate, clean iOS prebuild and production iOS export.
4. Review the exact final diff against `e01c8b5...`; payment/provider code must remain untouched unless separately approved.
5. Build Build 5 from the audited commit and physically verify startup, login, language/order-type gate, menu/cart/checkout/order submission, maps/address flow, order history/receipt, profile management, appearance modes, and crash reporting.
6. Only after those gates may an old branch be called safe to delete.
