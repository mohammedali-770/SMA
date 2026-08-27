<!-- ------------------------------------------------------------------
     GENERATED FILE — DO NOT EDIT.
     Regenerate with: npm run docs:generate
     CI fails if this file drifts from its source (npm run docs:check).
     Derived from: `vitest.config.ts`, the test files it collects, `supabase/tests/*.sql`
     Describes the REPOSITORY, not live Production.
     ------------------------------------------------------------------ -->

# Test inventory

What is tested, where those tests live, and how to run them. Use it to find whether a behaviour you are about to change already has coverage.

**153 TypeScript test files declaring 2364 test blocks, plus 60 SQL suites.**

> The block count is a **floor, not the executed total**. A parameterised `it.each([...])` is one declared block that runs once per row, so vitest reports more cases than are counted here. `npm test` is the authoritative number; this table is for finding files, not for reporting coverage.

## Running the tests

| Command | Runs |
| --- | --- |
| `npm test` | Every Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run lint` | TypeScript, no emit |
| `npm run design-system:check` | Design-system mirrors and hygiene |
| `npm run docs:check` | Documentation drift and ownership |

Vitest runs under the **Node** environment, not jsdom or a device; suites that need a DOM opt in per file with a `@vitest-environment jsdom` docblock. A mobile test file therefore cannot import `react-native`. This is why feature modules keep their rules in pure, framework-free files — those are the parts under test.

## SQL suites

SQL suites run against a **disposable** database, never Production (CLAUDE.md §10). `.github/workflows/sql-suites.yml` gates them, and the heavier migration-chain job is path-gated so it only runs when SQL changes.

- `supabase/tests/account_deletion_fencing_test.sql`
- `supabase/tests/account_deletion_lock_test.sql`
- `supabase/tests/account_deletion_manual_review_resolution_test.sql`
- `supabase/tests/account_deletion_resolution_note_privacy_test.sql`
- `supabase/tests/account_deletion_test.sql`
- `supabase/tests/address_single_default_test.sql`
- `supabase/tests/admin_ranged_orders_and_stats_test.sql`
- `supabase/tests/admin_search_phone_normalization_test.sql`
- `supabase/tests/anon_role_helper_exposure_test.sql`
- `supabase/tests/branch_availability_health_card_test.sql`
- `supabase/tests/branch_availability_retention_test.sql`
- `supabase/tests/branch_availability_snooze_test.sql`
- `supabase/tests/branch_delivery_control_test.sql`
- `supabase/tests/checkout_session_address_fk_test.sql`
- `supabase/tests/comp_members_test.sql`
- `supabase/tests/coupon_code_identity_guard_test.sql`
- `supabase/tests/discounts_campaigns_test.sql`
- `supabase/tests/erasure_phone_normalization_test.sql`
- `supabase/tests/lazywait_addon_group_import_test.sql`
- `supabase/tests/lazywait_confirmation_lifecycle_test.sql`
- `supabase/tests/lazywait_delivery_sync_test.sql`
- `supabase/tests/lazywait_fencing_test.sql`
- `supabase/tests/lazywait_mapping_test.sql`
- `supabase/tests/lazywait_presend_concurrency_test.sql`
- `supabase/tests/lazywait_reap_test.sql`
- `supabase/tests/lazywait_requeue_test.sql`
- `supabase/tests/lazywait_sync_health_summary_test.sql`
- `supabase/tests/lazywait_sync_scheduler_test.sql`
- `supabase/tests/lazywait_variant_import_test.sql`
- `supabase/tests/loyalty_reason_history_safe_test.sql`
- `supabase/tests/loyalty_reason_no_order_number_test.sql`
- `supabase/tests/manual_only_pos_resend_test.sql`
- `supabase/tests/menu_display_order_test.sql`
- `supabase/tests/moyasar_begin_attempt_test.sql`
- `supabase/tests/operations_alerts_activation_test.sql`
- `supabase/tests/operations_alerts_digest_test.sql`
- `supabase/tests/operations_automation_cron_health_test.sql`
- `supabase/tests/operations_health_center_test.sql`
- `supabase/tests/ops_change_events_test.sql`
- `supabase/tests/ops_roles_test.sql`
- `supabase/tests/order_cancellation_integrity_test.sql`
- `supabase/tests/order_confirmation_state_machine_test.sql`
- `supabase/tests/order_flow_alert_condition_test.sql`
- `supabase/tests/order_flow_health_card_test.sql`
- `supabase/tests/order_integrity_stranded_health_test.sql`
- `supabase/tests/order_integrity_watchdog_test.sql`
- `supabase/tests/order_item_notes_test.sql`
- `supabase/tests/order_modifier_contract_test.sql`
- `supabase/tests/order_note_length_test.sql`
- `supabase/tests/order_read_contracts_test.sql`
- `supabase/tests/order_refund_claim_liveness_test.sql`
- `supabase/tests/place_order_modifier_availability_test.sql`
- `supabase/tests/place_order_variants_test.sql`
- `supabase/tests/refund_trigger_execute_privilege_test.sql`
- `supabase/tests/require_address_description_test.sql`
- `supabase/tests/security_performance_hardening_test.sql`
- `supabase/tests/staff_access_directory_test.sql`
- `supabase/tests/staff_mfa_aal2_test.sql`
- `supabase/tests/staff_role_administration_test.sql`
- `supabase/tests/tap_reference_order_opaque_test.sql`

## TypeScript suites

Collected from the `include` patterns in `vitest.config.ts`: `src/**/*.test.{ts,tsx}`, `supabase/functions/**/*.test.ts`, `apps/mobile/src/**/*.test.{ts,tsx}`, `apps/mobile/plugins/**/*.test.ts`.

### `apps/mobile/plugins/`

1 files, 7 declared test blocks.

| File | Blocks | First suite |
| --- | --- | --- |
| `apps/mobile/plugins/withTapCardInterop.test.ts` | 7 | addTapCardInterop |

### `apps/mobile/src/`

59 files, 857 declared test blocks.

| File | Blocks | First suite |
| --- | --- | --- |
| `apps/mobile/src/components/headerInset.test.ts` | 6 | header top inset — exactly one source per screen |
| `apps/mobile/src/components/legacyButtonBehaviour.test.ts` | 5 | legacy Button — behaviour is unchanged by the consolidation |
| `apps/mobile/src/components/locationControl.test.ts` | 25 | shouldStartLocate |
| `apps/mobile/src/components/stateHierarchy.test.ts` | 9 | looksTechnical |
| `apps/mobile/src/design-system/designSystem.test.ts` | 5 | mobile design-system mirror |
| `apps/mobile/src/dev/fixtureGate.test.ts` | 10 | fixture gate — fails closed |
| `apps/mobile/src/dev/fixtureSafety.test.ts` | 7 | fixture mechanism cannot reach production systems |
| `apps/mobile/src/features/account/accountDeletion.test.ts` | 19 | isActiveDeletionStatus |
| `apps/mobile/src/features/auth/loginAvailability.test.ts` | 18 | confirmed flag ON |
| `apps/mobile/src/features/cart/suggestionScoring.test.ts` | 39 | classifyAddability |
| `apps/mobile/src/features/cart/suggestionState.test.ts` | 38 | parseSuggestionState |
| `apps/mobile/src/features/checkout/checkoutGuards.test.ts` | 23 | decideQuantityChange |
| `apps/mobile/src/features/checkout/checkoutHandoff.test.ts` | 5 | checkoutHandoff |
| `apps/mobile/src/features/checkout/deliveryLocationWarning.test.ts` | 14 | mismatchDistanceKm — silence is the default |
| `apps/mobile/src/features/checkout/paymentFlow.test.ts` | 3 | chooseCheckoutTransport |
| `apps/mobile/src/features/checkout/pendingSession.test.ts` | 16 | parsePendingSession |
| `apps/mobile/src/features/checkout/previewTotals.test.ts` | 32 | lineTotal |
| `apps/mobile/src/features/checkout/vatLabel.test.ts` | 8 | the checkout VAT label carries the configured rate |
| `apps/mobile/src/features/checkout/webviewPolicy.test.ts` | 16 | decideNavigation — allow (Tap ecosystem) |
| `apps/mobile/src/features/menu/menuSections.test.ts` | 27 | menuItemKey (branch-selection crash regression) |
| `apps/mobile/src/features/notifications/notificationPolicy.test.ts` | 20 | resolveNotificationRoute (allow-listed internal routes ONLY) |
| `apps/mobile/src/features/notifications/pushDeviceOwnership.test.ts` | 8 | cross-account token transfer (Codex P1 scenarios) |
| `apps/mobile/src/features/notifications/sendLifecycle.test.ts` | 12 | order-status send lifecycle (claim / retry semantics) |
| `apps/mobile/src/features/onboarding/firstRun.test.ts` | 13 | shouldRequestFirstRunPermissions |
| `apps/mobile/src/features/order/cartValidation.test.ts` | 15 | validateCartForBranch |
| `apps/mobile/src/features/order/itemNote.test.ts` | 8 | makeCartItemId — the note is part of the identity |
| `apps/mobile/src/features/order/locationDescription.test.ts` | 26 | checkDescription |
| `apps/mobile/src/features/order/orderContext.test.ts` | 17 | isBranchOpen |
| `apps/mobile/src/features/order/orderNote.test.ts` | 16 | checkOrderNote |
| `apps/mobile/src/features/order/variantSelection.test.ts` | 13 | makeCartItemId — the tier is part of the identity |
| `apps/mobile/src/features/orders/orderConfirmation.test.ts` | 16 | reference and channel safety |
| `apps/mobile/src/features/orders/ordersRefresh.test.ts` | 2 | isTerminalOrderStatus |
| `apps/mobile/src/features/otp/otpAutofill.test.ts` | 23 | normalizeCode |
| `apps/mobile/src/features/otp/otpInput.test.ts` | 6 | sanitizeOtpDigits |
| `apps/mobile/src/features/profile/addressForm.test.ts` | 34 | validateAddressForm — a complete address |
| `apps/mobile/src/features/profile/customerName.test.ts` | 28 | normalizeCustomerName |
| `apps/mobile/src/features/profile/profileEdit.test.ts` | 0 | — |
| `apps/mobile/src/i18n/rtl.test.ts` | 2 | rtlText |
| `apps/mobile/src/i18n/strings.test.ts` | 6 | STRINGS |
| `apps/mobile/src/lib/errors/userMessage.test.ts` | 7 | describeFailure |
| `apps/mobile/src/lib/maps.test.ts` | 10 | hasUsableCoordinates |
| `apps/mobile/src/lib/observability/classify.test.ts` | 6 | expected (breadcrumb-only) failures |
| `apps/mobile/src/lib/observability/config.test.ts` | 16 | Sentry identity |
| `apps/mobile/src/lib/observability/sanitize.test.ts` | 24 | isSensitiveKey |
| `apps/mobile/src/lib/observability/webClassify.test.ts` | 3 | web expected-error classification |
| `apps/mobile/src/lib/observability/webConfig.test.ts` | 14 | web Sentry identity |
| `apps/mobile/src/lib/observability/webRoutes.test.ts` | 9 | normalizeWebRoute |
| `apps/mobile/src/lib/orderability.test.ts` | 15 | requiredCount |
| `apps/mobile/src/lib/orderSelect.test.ts` | 13 | customer order select — no internal columns |
| `apps/mobile/src/lib/phone.test.ts` | 20 | toSaudiE164 — accepts every Saudi input pattern |
| `apps/mobile/src/lib/storageKeys.test.ts` | 4 | storageKeys |
| `apps/mobile/src/lib/supportContact.test.ts` | 15 | placeholder guard (no placeholder ever reaches a customer) |
| `apps/mobile/src/services/addressPayload.test.ts` | 34 | ownership |
| `apps/mobile/src/store/addressBook.test.ts` | 43 | loading and listing |
| `apps/mobile/src/store/cartSchema.test.ts` | 9 | cheapestVariant — the assumed tier must match the advertised price |
| `apps/mobile/src/store/profileCache.test.ts` | 10 | applyProfileEvent |
| `apps/mobile/src/theme/paletteBinding.test.ts` | 2 | runtime palette binding |
| `apps/mobile/src/utils/formatSAR.test.ts` | 7 | formatSAR after migration |
| `apps/mobile/src/utils/orderLineLabel.test.ts` | 6 | orderLineLabel |

### `src/`

77 files, 1029 declared test blocks.

| File | Blocks | First suite |
| --- | --- | --- |
| `src/components/admin/branchDeletion.test.ts` | 5 | branchDeletionConfirmation |
| `src/components/admin/BranchEditModal.test.tsx` | 4 | BranchEditModal — working hours |
| `src/components/admin/BranchPoliciesPanel.test.tsx` | 11 | BranchPoliciesPanel — branch deletion |
| `src/components/admin/CompMembersPanel.test.tsx` | 12 | CompMembersPanel |
| `src/components/admin/LiveOrdersPanel.test.tsx` | 15 | permission gate |
| `src/components/admin/MenuManagementPanel.test.tsx` | 16 | product price validation — the money contract |
| `src/components/admin/OperationsAlertsPanel.states.test.tsx` | 20 | in-flight states |
| `src/components/admin/OperationsAlertsPanel.test.tsx` | 16 | OperationsAlertsPanel — summary + inbox |
| `src/components/admin/OperationsHealthPanel.test.tsx` | 5 | OperationsHealthPanel — push failure metrics |
| `src/components/admin/ReportsPanel.test.tsx` | 17 | CSV export — the machine contract |
| `src/components/admin/StaffAccessPanel.test.tsx` | 4 | StaffAccessPanel |
| `src/components/admin/staffAccounts.test.ts` | 10 | validateNewOpsAccount |
| `src/components/admin/StatsPanel.test.tsx` | 24 | the ranked chart |
| `src/components/admin/view/adminNav.test.ts` | 23 | grouping is total |
| `src/components/admin/view/AdminSidebar.test.tsx` | 29 | structure |
| `src/components/admin/view/alerts/alertsView.test.ts` | 18 | load contract |
| `src/components/admin/view/branches/DeliveryAreasEditor.test.tsx` | 10 | DeliveryAreasEditor |
| `src/components/admin/view/branches/workingHours.test.ts` | 20 | WEEKDAYS |
| `src/components/admin/view/health/healthView.test.ts` | 22 | polling contract |
| `src/components/admin/view/integrity/integrityView.test.ts` | 21 | ageLabel |
| `src/components/admin/view/NumericCommitField.test.tsx` | 11 | NumericCommitField |
| `src/components/admin/view/orders/OrderReceiptModal.test.tsx` | 3 | OrderReceiptModal — customer note |
| `src/components/admin/view/orders/ordersView.test.ts` | 28 | needsPaymentConfirm — the money contract |
| `src/components/admin/view/shared/ModalShell.test.tsx` | 20 | modality is claimed only because it is enforced |
| `src/components/admin/view/stats/branchSales.test.ts` | 38 | buildBranchSalesRows |
| `src/components/ObservabilityErrorBoundary.test.tsx` | 4 | admin ObservabilityErrorBoundary |
| `src/components/ops/branchConsole.test.ts` | 31 | duration and reason vocabularies |
| `src/components/ops/BranchConsole.test.tsx` | 15 | BranchConsole |
| `src/components/ops/callCentre.test.ts` | 51 | buildClosureSummaries |
| `src/components/ops/CallCentreConsole.test.tsx` | 28 | CallCentreConsole |
| `src/components/ops/opsRefreshQueue.test.ts` | 5 | makeRefreshQueue |
| `src/components/ops/opsStrings.test.ts` | 4 | ops console copy |
| `src/components/Price.contract.test.tsx` | 13 | digits render mono |
| `src/components/Price.test.tsx` | 6 | Price (web) |
| `src/components/PriceMigration.test.tsx` | 10 | Price migration — displayed values are byte-identical to toFixed(2) |
| `src/components/StaffMfaGate.test.tsx` | 11 | StaffMfaGate |
| `src/context/AppContext.test.ts` | 14 | ORDER_STATUS_TRANSITIONS |
| `src/design-system/buttonState.test.ts` | 10 | resolveButtonState |
| `src/design-system/contrastContract.test.ts` | 9 | muted ink clears WCAG AA for normal text |
| `src/design-system/fieldState.test.ts` | 15 | resolveFieldState — accessibility wiring |
| `src/design-system/money.test.ts` | 19 | formatAmount — en-SA |
| `src/design-system/ui/Button.test.tsx` | 8 | Button (web) |
| `src/design-system/ui/consolePrimitives.test.ts` | 6 | admin console primitives |
| `src/design-system/ui/Field.test.tsx` | 9 | Field (web) — accessibility |
| `src/design-system/ui/FieldAccessibility.test.tsx` | 12 | required indicator is excluded from the accessible name |
| `src/design-system/ui/typographyLanguage.test.tsx` | 10 | console typography follows the active language |
| `src/lib/api.test.ts` | 6 | admin.deleteBranch |
| `src/lib/banners.test.ts` | 13 | selectActiveBanners |
| `src/lib/branchDeletion.test.ts` | 8 | branchHasBlockingDependencies |
| `src/lib/campaigns.test.ts` | 12 | selectLiveCampaigns (mirrors the public RLS) |
| `src/lib/geo.test.ts` | 11 | pointInPolygon (UX pre-check) |
| `src/lib/googleMaps.test.ts` | 14 | closeRing / openRing — GeoJSON rings are closed, editor paths are open |
| `src/lib/integrationProvider.test.ts` | 4 | initialProviderName |
| `src/lib/integrationProviderFields.test.ts` | 4 | providerFieldSet |
| `src/lib/lazywaitMatch.test.ts` | 11 | normalizeName |
| `src/lib/lazywaitRequeue.test.ts` | 12 | lazywaitRequeueEligibility (mirror of SQL rule) |
| `src/lib/legal.test.ts` | 6 | legal document registry |
| `src/lib/mappers.test.ts` | 27 | catalog mappers |
| `src/lib/maps.test.ts` | 8 | isPlottable |
| `src/lib/menuOrdering.test.ts` | 13 | sortRows |
| `src/lib/moyasarAdminTest.test.ts` | 9 | canRunMoyasarAdminTestCheckout |
| `src/lib/numericField.test.ts` | 13 | parseNumericCommit — inputs that must never persist a zero |
| `src/lib/observability/devTest.test.ts` | 3 | admin dev Sentry test facility |
| `src/lib/operationsAlertsApi.test.ts` | 13 | safeAlertCount |
| `src/lib/operationsAlertsCapability.test.ts` | 6 | classifyOperationsAlertsProbe |
| `src/lib/operationsHealthApi.test.ts` | 10 | pushFailureMetrics |
| `src/lib/operationsHealthCapability.test.ts` | 12 | classifyOperationsHealthProbe |
| `src/lib/orderIntegrityCapability.test.ts` | 17 | classifyWatchdogProbe |
| `src/lib/orderIntegrityTriage.test.ts` | 7 | canTriageRole (admin-only triage) |
| `src/lib/payment.test.ts` | 13 | checkout payment availability |
| `src/lib/productEditMapper.test.ts` | 2 | product write mapping |
| `src/lib/productImages.test.ts` | 15 | product image type gate |
| `src/lib/reports.test.ts` | 8 | buildCouponUsage |
| `src/lib/roles.test.ts` | 6 | role surface routing |
| `src/lib/supportContact.test.ts` | 15 | placeholder guard (no placeholder ever reaches a customer) |
| `src/lib/tapAdminTest.test.ts` | 4 | canRunAdminTestCheckout |
| `src/utils/calculations.test.ts` | 35 | getVATBreakdown |

### `supabase/functions/`

16 files, 471 declared test blocks.

| File | Blocks | First suite |
| --- | --- | --- |
| `supabase/functions/_shared/accountDeletion.test.ts` | 21 | classifyBlockers — only real, prioritized states |
| `supabase/functions/_shared/adminAuth.test.ts` | 9 | decideAdminAuthorization |
| `supabase/functions/_shared/adminAuthWiring.test.ts` | 18 | staff-accounts privileged actions |
| `supabase/functions/_shared/authHook.test.ts` | 14 | normalizeHookSecret |
| `supabase/functions/_shared/lazywait.test.ts` | 96 | buildCreateOrderPayload — confirmed contract (owner-supplied 2026-08-24) |
| `supabase/functions/_shared/lazywaitApi.test.ts` | 50 | request serialization — paths/methods/query |
| `supabase/functions/_shared/lazywaitBaseUrlWiring.test.ts` | 11 | lazywait-sync guards before it claims any order |
| `supabase/functions/_shared/lazywaitCatalog.test.ts` | 27 | extractCatalogList (response envelope) |
| `supabase/functions/_shared/moyasar.test.ts` | 85 | minor units (halalas) |
| `supabase/functions/_shared/moyasarRefund.test.ts` | 36 | moyasarRefundUrl / moyasarPaymentUrl |
| `supabase/functions/_shared/orderIntakeSyncWiring.test.ts` | 21 | order-intake — immediate POS sync, and no premature promise |
| `supabase/functions/_shared/tap.test.ts` | 31 | formatTapAmount / currencyDecimals |
| `supabase/functions/_shared/tapRefund.test.ts` | 18 | classifyRefundResponse — confirmed success |
| `supabase/functions/_shared/whatsapp.test.ts` | 18 | normalizePhoneE164 |
| `supabase/functions/payment-return/returnLink.test.ts` | 7 | sanitizeUuid |
| `supabase/functions/staff-accounts/guards.test.ts` | 9 | staff-accounts manageable-role allow-list |
