<!-- ------------------------------------------------------------------
     GENERATED FILE — DO NOT EDIT.
     Regenerate with: npm run docs:generate
     CI fails if this file drifts from its source (npm run docs:check).
     Derived from: `vitest.config.ts`, the test files it collects, `supabase/tests/*.sql`, `supabase/functions/*/*_test.ts`, `e2e/*.spec.ts`
     Describes the REPOSITORY, not live Production.
     ------------------------------------------------------------------ -->

# Test inventory

What is tested, where those tests live, and how to run them. Use it to find whether a behaviour you are about to change already has coverage.

**256 TypeScript test files declaring 3896 test blocks, plus 88 SQL suites.**

> The block count is a **floor, not the executed total**. A parameterised `it.each([...])` is one declared block that runs once per row, so vitest reports more cases than are counted here. `npm test` is the authoritative number; this table is for finding files, not for reporting coverage.

## Running the tests

| Command | Runs |
| --- | --- |
| `npm test` | Every Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run lint` | TypeScript, no emit |
| `npm run design-system:check` | Design-system mirrors and hygiene |
| `npm run docs:check` | Documentation drift and ownership |
| `npm run test:e2e` | The Playwright specs in `e2e/`, against a built `dist/` (run `npm run build` first) |
| `deno test --no-lock --node-modules-dir=none --allow-env supabase/functions/*/*_test.ts` | The Edge Function handler tests, with Deno as CI pins it |

Vitest runs under the **Node** environment, not jsdom or a device; suites that need a DOM opt in per file with a `@vitest-environment jsdom` docblock. A mobile test file therefore cannot import `react-native`. This is why feature modules keep their rules in pure, framework-free files — those are the parts under test.

## SQL suites

SQL suites run against a **disposable** database, never Production (CLAUDE.md §10). `.github/workflows/sql-suites.yml` gates them, and the heavier migration-chain job is path-gated so it only runs when SQL changes.

The same job ends with `.github/sql-ci/existing-data.sh`: the change's migrations applied onto a database that already holds rows (`.github/sql-ci/existing-data.sql`, written through the real RPCs), with invariants and a fingerprint diff. It is report-only until `SQL_CI_EXISTING_DATA_BLOCKING` is set.

- `supabase/tests/account_deletion_fencing_test.sql`
- `supabase/tests/account_deletion_lock_test.sql`
- `supabase/tests/account_deletion_manual_review_resolution_test.sql`
- `supabase/tests/account_deletion_resolution_note_privacy_test.sql`
- `supabase/tests/account_deletion_test.sql`
- `supabase/tests/address_single_default_test.sql`
- `supabase/tests/admin_loyalty_stats_test.sql`
- `supabase/tests/admin_push_closure_notifications_test.sql`
- `supabase/tests/admin_push_subscriptions_test.sql`
- `supabase/tests/admin_ranged_orders_and_stats_test.sql`
- `supabase/tests/admin_search_phone_normalization_test.sql`
- `supabase/tests/alert_recovery_email_pairing_test.sql`
- `supabase/tests/anon_role_helper_exposure_test.sql`
- `supabase/tests/branch_availability_health_card_test.sql`
- `supabase/tests/branch_availability_retention_test.sql`
- `supabase/tests/branch_availability_snooze_test.sql`
- `supabase/tests/branch_delivery_control_test.sql`
- `supabase/tests/branch_delivery_requests_test.sql`
- `supabase/tests/branch_reference_entries_test.sql`
- `supabase/tests/branch_variant_availability_test.sql`
- `supabase/tests/checkout_session_address_fk_test.sql`
- `supabase/tests/comp_members_test.sql`
- `supabase/tests/coupon_code_identity_guard_test.sql`
- `supabase/tests/db_advisor_hardening_test.sql`
- `supabase/tests/discounts_campaigns_test.sql`
- `supabase/tests/drop_tap_payment_rpcs_test.sql`
- `supabase/tests/erasure_phone_normalization_test.sql`
- `supabase/tests/export_my_data_test.sql`
- `supabase/tests/health_card_variant_coverage_test.sql`
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
- `supabase/tests/loyalty_earn_on_settlement_test.sql`
- `supabase/tests/loyalty_earn_snapshot_path_test.sql`
- `supabase/tests/loyalty_expiry_test.sql`
- `supabase/tests/loyalty_item_exclusion_test.sql`
- `supabase/tests/loyalty_multipliers_test.sql`
- `supabase/tests/loyalty_pickup_only_test.sql`
- `supabase/tests/loyalty_reason_history_safe_test.sql`
- `supabase/tests/loyalty_reason_no_order_number_test.sql`
- `supabase/tests/manual_only_pos_resend_test.sql`
- `supabase/tests/menu_display_order_test.sql`
- `supabase/tests/moyasar_begin_attempt_test.sql`
- `supabase/tests/moyasar_only_payments_test.sql`
- `supabase/tests/operations_alert_email_dispatch_test.sql`
- `supabase/tests/operations_alerts_activation_test.sql`
- `supabase/tests/operations_alerts_digest_test.sql`
- `supabase/tests/operations_automation_cron_health_test.sql`
- `supabase/tests/operations_digest_external_delivery_line_test.sql`
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
- `supabase/tests/otp_login_rate_limit_test.sql`
- `supabase/tests/otp_retention_sweep_test.sql`
- `supabase/tests/place_order_modifier_availability_test.sql`
- `supabase/tests/place_order_variants_test.sql`
- `supabase/tests/platform_rollup_suppression_test.sql`
- `supabase/tests/product_variants_guest_read_test.sql`
- `supabase/tests/promo_disclosure_test.sql`
- `supabase/tests/prune_operational_run_history_test.sql`
- `supabase/tests/refund_trigger_execute_privilege_test.sql`
- `supabase/tests/require_address_description_test.sql`
- `supabase/tests/rls_initplan_live_board_order_year_test.sql`
- `supabase/tests/security_performance_hardening_test.sql`
- `supabase/tests/server_input_bounds_test.sql`
- `supabase/tests/staff_access_directory_test.sql`
- `supabase/tests/staff_account_deletion_test.sql`
- `supabase/tests/staff_mfa_aal2_test.sql`
- `supabase/tests/staff_role_administration_test.sql`

## Edge Function handler tests (Deno)

Each calls a function's real request handler, exported from a module beside its `index.ts`, with `fetch` stubbed and without `--allow-net`, so nothing leaves the machine. The `Edge Function typecheck (Deno)` CI job runs them after `deno check`.

| File | Tests |
| --- | --- |
| `supabase/functions/account-delete-scheduler/handler_test.ts` | 10 |

## End-to-end specs

Playwright, against the **built** web app: `npm run build` produces `dist/`, `e2e/serve-dist.mjs` serves it with `vercel.json`'s headers and rewrites, and every Supabase and Sentry request is answered or refused inside the browser, so nothing reaches Production. The `Production build` CI job runs them straight after the build.

| File | Tests |
| --- | --- |
| `e2e/guest-journey.spec.ts` | 2 |

## TypeScript suites

Collected from the `include` patterns in `vitest.config.ts`: `src/**/*.test.{ts,tsx}`, `supabase/functions/**/*.test.ts`, `apps/mobile/src/**/*.test.{ts,tsx}`, `apps/mobile/plugins/**/*.test.ts`.

### `apps/mobile/plugins/`

1 files, 9 declared test blocks.

| File | Blocks | First suite |
| --- | --- | --- |
| `apps/mobile/plugins/withAndroidRtlLock.test.ts` | 9 | addAndroidRtlLock |

### `apps/mobile/src/`

96 files, 1281 declared test blocks.

| File | Blocks | First suite |
| --- | --- | --- |
| `apps/mobile/src/components/headerBack.test.ts` | 5 | resolveBack |
| `apps/mobile/src/components/headerInset.test.ts` | 6 | header top inset — exactly one source per screen |
| `apps/mobile/src/components/iosPurposeStrings.test.ts` | 11 | iOS Info.plist purpose strings (GO_LIVE_READINESS B8, N1) |
| `apps/mobile/src/components/legacyButtonBehaviour.test.ts` | 5 | legacy Button — behaviour is unchanged by the consolidation |
| `apps/mobile/src/components/locationControl.test.ts` | 25 | shouldStartLocate |
| `apps/mobile/src/components/stateHierarchy.test.ts` | 9 | looksTechnical |
| `apps/mobile/src/design-system/designSystem.test.ts` | 5 | mobile design-system mirror |
| `apps/mobile/src/design-system/ui/a11yState.test.ts` | 10 | selectedButtonState |
| `apps/mobile/src/design-system/ui/productCardA11y.test.ts` | 6 | productCardAccessibilityLabel |
| `apps/mobile/src/design-system/ui/statusInkWiring.test.ts` | 8 | StatusPill foregrounds are inks |
| `apps/mobile/src/dev/fixtureGate.test.ts` | 10 | fixture gate — fails closed |
| `apps/mobile/src/dev/fixtureSafety.test.ts` | 8 | fixture mechanism cannot reach production systems |
| `apps/mobile/src/features/account/accountDeletion.test.ts` | 19 | isActiveDeletionStatus |
| `apps/mobile/src/features/auth/guestBrowsingWiring.test.ts` | 13 | the menu is open to a guest |
| `apps/mobile/src/features/auth/loginAvailability.test.ts` | 18 | confirmed flag ON |
| `apps/mobile/src/features/auth/ordersTabGate.test.tsx` | 4 | the Orders tab renders OrdersScreen only for a signed-in customer |
| `apps/mobile/src/features/auth/returnPath.test.ts` | 8 | safeReturnPath — what is allowed through |
| `apps/mobile/src/features/auth/signInA11yWiring.test.ts` | 4 | PhoneOtpLogin errors are announced |
| `apps/mobile/src/features/cart/quantityLimit.test.ts` | 7 | MAX_LINE_QUANTITY |
| `apps/mobile/src/features/cart/repriceCart.test.ts` | 24 | repriceCart — the price the cart shows is the price the menu now asks |
| `apps/mobile/src/features/cart/suggestionScoring.test.ts` | 49 | classifyAddability |
| `apps/mobile/src/features/cart/suggestionState.test.ts` | 38 | parseSuggestionState |
| `apps/mobile/src/features/checkout/checkoutGuards.test.ts` | 31 | decideQuantityChange |
| `apps/mobile/src/features/checkout/checkoutHandoff.test.ts` | 5 | checkoutHandoff |
| `apps/mobile/src/features/checkout/deliveryLocationWarning.test.ts` | 14 | mismatchDistanceKm — silence is the default |
| `apps/mobile/src/features/checkout/paymentWebViewWiring.test.ts` | 14 | CheckoutScreen opens the hosted page only in the in-app WebView |
| `apps/mobile/src/features/checkout/pendingSession.test.ts` | 26 | parsePendingSession |
| `apps/mobile/src/features/checkout/previewTotals.test.ts` | 39 | lineTotal |
| `apps/mobile/src/features/checkout/vatLabel.test.ts` | 8 | the checkout VAT label carries the configured rate |
| `apps/mobile/src/features/checkout/webviewPolicy.test.ts` | 19 | decideNavigation — allow (Moyasar hosted page and 3-D Secure) |
| `apps/mobile/src/features/menu/bannerFetchOwnership.test.ts` | 5 | banner fetch ownership |
| `apps/mobile/src/features/menu/categoryFocus.test.ts` | 17 | categoryFocusReducer |
| `apps/mobile/src/features/menu/menuSections.test.ts` | 27 | menuItemKey (branch-selection crash regression) |
| `apps/mobile/src/features/notifications/notificationPolicy.test.ts` | 28 | resolveNotificationRoute (allow-listed internal routes ONLY) |
| `apps/mobile/src/features/notifications/pushDeviceOwnership.test.ts` | 8 | cross-account token transfer (Codex P1 scenarios) |
| `apps/mobile/src/features/notifications/sendLifecycle.test.ts` | 12 | order-status send lifecycle (claim / retry semantics) |
| `apps/mobile/src/features/onboarding/firstRun.test.ts` | 19 | shouldRequestFirstRunPermissions |
| `apps/mobile/src/features/onboarding/permissionPromptsWiring.test.ts` | 10 | location is asked only where it is used |
| `apps/mobile/src/features/order/brandMarkPriority.test.ts` | 2 | first-screen brand marks load eagerly at high priority |
| `apps/mobile/src/features/order/cartValidation.test.ts` | 21 | validateCartForBranch |
| `apps/mobile/src/features/order/itemNote.test.ts` | 8 | makeCartItemId — the note is part of the identity |
| `apps/mobile/src/features/order/locationDescription.test.ts` | 26 | checkDescription |
| `apps/mobile/src/features/order/orderContext.test.ts` | 21 | isBranchOpen |
| `apps/mobile/src/features/order/orderNote.test.ts` | 16 | checkOrderNote |
| `apps/mobile/src/features/order/stackedTabsWiring.test.ts` | 4 | screens opened above another route go back to it |
| `apps/mobile/src/features/order/variantSelection.test.ts` | 13 | makeCartItemId — the tier is part of the identity |
| `apps/mobile/src/features/orders/loyaltyEarnState.test.ts` | 7 | loyaltyEarnState |
| `apps/mobile/src/features/orders/orderConfirmation.test.ts` | 19 | reference and channel safety |
| `apps/mobile/src/features/orders/orderConfirmationSqlParity.test.ts` | 8 | customer_order_state — SQL/TS parity |
| `apps/mobile/src/features/orders/ordersRefresh.test.ts` | 8 | isTerminalOrderStatus |
| `apps/mobile/src/features/otp/otpAutofill.test.ts` | 23 | normalizeCode |
| `apps/mobile/src/features/otp/otpInput.test.ts` | 6 | sanitizeOtpDigits |
| `apps/mobile/src/features/profile/addressForm.test.ts` | 34 | validateAddressForm — a complete address |
| `apps/mobile/src/features/profile/customerName.test.ts` | 28 | normalizeCustomerName |
| `apps/mobile/src/features/profile/dataExport.test.ts` | 13 | shouldStartExport |
| `apps/mobile/src/features/profile/loyaltyExpiry.test.ts` | 8 | formatExpiryDate |
| `apps/mobile/src/features/profile/profileEdit.test.ts` | 4 | profile email |
| `apps/mobile/src/i18n/documentLang.test.ts` | 6 | applyDocumentLang |
| `apps/mobile/src/i18n/rtl.test.ts` | 2 | rtlText |
| `apps/mobile/src/i18n/strings.test.ts` | 6 | STRINGS |
| `apps/mobile/src/lib/chunkedSecureStorage.test.ts` | 15 | splitByUtf8Bytes |
| `apps/mobile/src/lib/env.test.ts` | 5 | SUPABASE_PUBLIC_KEY |
| `apps/mobile/src/lib/errors/orderRefusalWiring.test.ts` | 3 | order refusal wiring |
| `apps/mobile/src/lib/errors/userMessage.test.ts` | 11 | describeFailure |
| `apps/mobile/src/lib/maps.test.ts` | 10 | hasUsableCoordinates |
| `apps/mobile/src/lib/navigationLatch.test.ts` | 12 | createNavigationLatch |
| `apps/mobile/src/lib/observability/classify.test.ts` | 6 | expected (breadcrumb-only) failures |
| `apps/mobile/src/lib/observability/config.test.ts` | 19 | Sentry identity |
| `apps/mobile/src/lib/observability/sanitize.test.ts` | 28 | isSensitiveKey |
| `apps/mobile/src/lib/observability/webClassify.test.ts` | 3 | web expected-error classification |
| `apps/mobile/src/lib/observability/webConfig.test.ts` | 14 | web Sentry identity |
| `apps/mobile/src/lib/observability/webRoutes.test.ts` | 9 | normalizeWebRoute |
| `apps/mobile/src/lib/orderability.test.ts` | 25 | requiredCount |
| `apps/mobile/src/lib/orderSelect.test.ts` | 13 | customer order select — no internal columns |
| `apps/mobile/src/lib/orderSelectGrantParity.test.ts` | 6 | customer order select ↔ database grant parity |
| `apps/mobile/src/lib/payment.test.ts` | 7 | online payment is offered only in the native app |
| `apps/mobile/src/lib/phone.test.ts` | 20 | toSaudiE164 — accepts every Saudi input pattern |
| `apps/mobile/src/lib/readTimeoutFetch.test.ts` | 17 | isTimedRead — the boundary |
| `apps/mobile/src/lib/storageKeys.test.ts` | 4 | storageKeys |
| `apps/mobile/src/lib/variantAvailabilityMatrix.test.ts` | 10 | buildVariantAvailabilityMatrix |
| `apps/mobile/src/lib/webExportConfig.test.ts` | 1 | web export bundling |
| `apps/mobile/src/lib/webExportSourceMaps.test.ts` | 18 | planWebExport without SENTRY_AUTH_TOKEN |
| `apps/mobile/src/lib/webIndexTemplate.test.ts` | 5 | apps/mobile/public/index.html |
| `apps/mobile/src/services/addressPayload.test.ts` | 34 | ownership |
| `apps/mobile/src/services/catalogVariantAvailability.test.ts` | 5 | catalog.variantAvailability |
| `apps/mobile/src/services/rpcContractParity.test.ts` | 23 | the SQL reader |
| `apps/mobile/src/store/addressBook.test.ts` | 43 | loading and listing |
| `apps/mobile/src/store/cartSchema.test.ts` | 9 | cheapestVariant — the assumed tier must match the advertised price |
| `apps/mobile/src/store/catalogLanguage.test.tsx` | 4 | the menu does not reload when the language changes |
| `apps/mobile/src/store/catalogMapping.test.ts` | 1 | mapPricedMenu |
| `apps/mobile/src/store/profileCache.test.ts` | 10 | applyProfileEvent |
| `apps/mobile/src/theme/darkContrastContract.test.ts` | 15 | dark inks clear WCAG AA for normal text |
| `apps/mobile/src/theme/paletteBinding.test.ts` | 2 | runtime palette binding |
| `apps/mobile/src/types/webviewTypeShim.test.ts` | 4 | react-native-webview type shim |
| `apps/mobile/src/utils/formatSAR.test.ts` | 7 | formatSAR after migration |
| `apps/mobile/src/utils/orderLineLabel.test.ts` | 6 | orderLineLabel |

### `src/`

124 files, 1713 declared test blocks.

| File | Blocks | First suite |
| --- | --- | --- |
| `src/App.test.tsx` | 12 | console shell — unknown identity (#415 P1) |
| `src/components/admin/BranchDataImportPanel.test.tsx` | 12 | BranchDataImportPanel — working hours |
| `src/components/admin/branchDeletion.test.ts` | 5 | branchDeletionConfirmation |
| `src/components/admin/BranchEditModal.test.tsx` | 4 | BranchEditModal — working hours |
| `src/components/admin/BranchPoliciesPanel.test.tsx` | 11 | BranchPoliciesPanel — branch deletion |
| `src/components/admin/CompMembersPanel.test.tsx` | 13 | CompMembersPanel |
| `src/components/admin/CouponsPanel.test.tsx` | 24 | the standing answer to |
| `src/components/admin/IntegrationCard.payment.test.tsx` | 5 | payment card |
| `src/components/admin/IntegrationCard.test.ts` | 9 | Lazywait base_url placeholder |
| `src/components/admin/IntegrationsPanel.test.tsx` | 1 | Integrations → Payments |
| `src/components/admin/LiveOrdersPanel.test.tsx` | 15 | permission gate |
| `src/components/admin/LoyaltyCampaignsPanel.test.tsx` | 2 | LoyaltyCampaignsPanel — the dates in the list |
| `src/components/admin/loyaltyCampaignState.test.ts` | 10 | campaignState |
| `src/components/admin/MenuManagementPanel.test.tsx` | 20 | product price validation — the money contract |
| `src/components/admin/MoyasarPaymentPanel.test.tsx` | 13 | against the payment-test-config deployed before Moyasar |
| `src/components/admin/OperationsAlertsPanel.states.test.tsx` | 20 | in-flight states |
| `src/components/admin/OperationsAlertsPanel.test.tsx` | 19 | OperationsAlertsPanel — summary + inbox |
| `src/components/admin/OperationsHealthPanel.test.tsx` | 5 | OperationsHealthPanel — push failure metrics |
| `src/components/admin/ReportsPanel.test.tsx` | 19 | CSV export — the machine contract |
| `src/components/admin/SettingsPanel.payments.test.tsx` | 8 | the Online Payment caption |
| `src/components/admin/StaffAccessPanel.test.tsx` | 5 | StaffAccessPanel |
| `src/components/admin/staffAccounts.test.ts` | 10 | validateNewOpsAccount |
| `src/components/admin/StatsPanel.test.tsx` | 24 | the ranked chart |
| `src/components/admin/view/adminNav.test.ts` | 23 | grouping is total |
| `src/components/admin/view/AdminSidebar.test.tsx` | 29 | structure |
| `src/components/admin/view/adminTime.test.ts` | 4 | exactTime |
| `src/components/admin/view/alerts/alertsView.test.ts` | 18 | load contract |
| `src/components/admin/view/branches/DeliveryAreasEditor.test.tsx` | 10 | DeliveryAreasEditor |
| `src/components/admin/view/branches/workingHours.test.ts` | 20 | WEEKDAYS |
| `src/components/admin/view/consoleClock.test.tsx` | 5 | a banner row shows its window as Riyadh calendar dates |
| `src/components/admin/view/health/HealthSystemCard.test.tsx` | 5 | branch_availability health card |
| `src/components/admin/view/health/healthView.test.ts` | 22 | polling contract |
| `src/components/admin/view/integrity/integrityRuleParity.test.ts` | 4 | admin rule filter ↔ watchdog rule set |
| `src/components/admin/view/integrity/integrityView.test.ts` | 21 | ageLabel |
| `src/components/admin/view/NumericCommitField.test.tsx` | 11 | NumericCommitField |
| `src/components/admin/view/orders/OrderReceiptModal.test.tsx` | 4 | OrderReceiptModal — customer note |
| `src/components/admin/view/orders/ordersView.test.ts` | 28 | needsPaymentConfirm — the money contract |
| `src/components/admin/view/orders/PaymentDetails.test.tsx` | 7 | a Moyasar payment |
| `src/components/admin/view/PushBell.test.tsx` | 9 | pushBellLabel |
| `src/components/admin/view/shared/ModalShell.test.tsx` | 21 | modality is claimed only because it is enforced |
| `src/components/admin/view/stats/branchSales.test.ts` | 38 | buildBranchSalesRows |
| `src/components/AuthScreen.test.tsx` | 7 | AuthScreen |
| `src/components/ObservabilityErrorBoundary.test.tsx` | 4 | admin ObservabilityErrorBoundary |
| `src/components/ops/branchConsole.test.ts` | 56 | duration and reason vocabularies |
| `src/components/ops/BranchConsole.test.tsx` | 43 | BranchConsole |
| `src/components/ops/branchReference.test.ts` | 20 | delivery request state |
| `src/components/ops/BranchReferenceCard.test.tsx` | 9 | BranchReferenceCard |
| `src/components/ops/callCentre.test.ts` | 66 | buildClosureSummaries and closed price tiers |
| `src/components/ops/CallCentreConsole.test.tsx` | 34 | CallCentreConsole |
| `src/components/ops/opsRefreshQueue.test.ts` | 5 | makeRefreshQueue |
| `src/components/ops/opsStrings.test.ts` | 4 | ops console copy |
| `src/components/ops/RequestsWaitingCard.test.tsx` | 7 | RequestsWaitingCard |
| `src/components/ops/useOpsLang.test.ts` | 7 | useOpsLang |
| `src/components/Price.contract.test.tsx` | 13 | digits render mono |
| `src/components/Price.test.tsx` | 6 | Price (web) |
| `src/components/PriceMigration.test.tsx` | 10 | Price migration — displayed values are byte-identical to toFixed(2) |
| `src/components/StaffMfaGate.test.tsx` | 11 | StaffMfaGate |
| `src/context/AppContext.test.ts` | 14 | ORDER_STATUS_TRANSITIONS |
| `src/design-system/buttonState.test.ts` | 10 | resolveButtonState |
| `src/design-system/contrastContract.test.ts` | 12 | muted ink clears WCAG AA for normal text |
| `src/design-system/fieldState.test.ts` | 15 | resolveFieldState — accessibility wiring |
| `src/design-system/money.test.ts` | 19 | formatAmount — en-SA |
| `src/design-system/ui/Button.test.tsx` | 8 | Button (web) |
| `src/design-system/ui/consolePrimitives.test.ts` | 6 | admin console primitives |
| `src/design-system/ui/Field.test.tsx` | 9 | Field (web) — accessibility |
| `src/design-system/ui/FieldAccessibility.test.tsx` | 12 | required indicator is excluded from the accessible name |
| `src/design-system/ui/typographyLanguage.test.tsx` | 10 | console typography follows the active language |
| `src/legal/legalPage.test.ts` | 26 | slugForType |
| `src/legal/prerender.test.ts` | 17 | escapeHtml — the whole reason this module can use string concatenation |
| `src/lib/adminPushApi.test.ts` | 7 | sendAdminPushConfirmation |
| `src/lib/api.test.ts` | 6 | admin.deleteBranch |
| `src/lib/banners.test.ts` | 17 | selectActiveBanners |
| `src/lib/branchDeletion.test.ts` | 8 | branchHasBlockingDependencies |
| `src/lib/branchImport.test.ts` | 47 | splitRows |
| `src/lib/bundleForbiddenLibs.test.ts` | 12 | forbidden-library signatures — positive control |
| `src/lib/campaigns.test.ts` | 12 | selectLiveCampaigns (mirrors the public RLS) |
| `src/lib/consoleAudience.test.ts` | 12 | console audience |
| `src/lib/couponsApi.test.ts` | 41 | normaliseCode — the difference between a working code and a dead one |
| `src/lib/documentLang.test.ts` | 6 | applyDocumentLang |
| `src/lib/e2eServeDist.test.ts` | 3 | e2e/serve-dist.mjs source patterns |
| `src/lib/geo.test.ts` | 11 | pointInPolygon (UX pre-check) |
| `src/lib/googleMaps.test.ts` | 14 | closeRing / openRing — GeoJSON rings are closed, editor paths are open |
| `src/lib/imageUpload.test.ts` | 21 | fitWithin |
| `src/lib/immutableAssetNames.test.ts` | 3 | findUnhashedAssets |
| `src/lib/integrationProvider.test.ts` | 4 | initialProviderName |
| `src/lib/lazywaitMatch.test.ts` | 11 | normalizeName |
| `src/lib/lazywaitRequeue.test.ts` | 12 | lazywaitRequeueEligibility (mirror of SQL rule) |
| `src/lib/legal.test.ts` | 6 | legal document registry |
| `src/lib/loyaltyRulesSummary.test.ts` | 14 | loyaltyRulesSummary |
| `src/lib/mappers.test.ts` | 31 | catalog mappers |
| `src/lib/maps.test.ts` | 8 | isPlottable |
| `src/lib/menuOrdering.test.ts` | 13 | sortRows |
| `src/lib/mirrorParity.test.ts` | 4 | cross-app lib mirrors stay identical |
| `src/lib/moyasarAdminTest.test.ts` | 15 | canRunMoyasarAdminTestCheckout |
| `src/lib/moyasarWebhookVerification.test.ts` | 6 | webhookVerificationNotice |
| `src/lib/numericField.test.ts` | 13 | parseNumericCommit — inputs that must never persist a zero |
| `src/lib/observability/devTest.test.ts` | 3 | admin dev Sentry test facility |
| `src/lib/onlinePaymentGate.test.ts` | 6 | canEnableOnlinePayment |
| `src/lib/operationsAlertsApi.test.ts` | 13 | safeAlertCount |
| `src/lib/operationsAlertsCapability.test.ts` | 6 | classifyOperationsAlertsProbe |
| `src/lib/operationsHealthApi.test.ts` | 10 | pushFailureMetrics |
| `src/lib/operationsHealthCapability.test.ts` | 12 | classifyOperationsHealthProbe |
| `src/lib/opsApiResilience.test.ts` | 9 | opsApi.branchReference — missing-table resilience |
| `src/lib/opsVariantClosing.test.ts` | 11 | branchVariantAvailability |
| `src/lib/orderIntegrityCapability.test.ts` | 17 | classifyWatchdogProbe |
| `src/lib/orderIntegrityTriage.test.ts` | 7 | canTriageRole (admin-only triage) |
| `src/lib/payment.test.ts` | 17 | checkout payment availability |
| `src/lib/paymentGatewayApi.test.ts` | 5 | paymentGateway.testCheckoutResult |
| `src/lib/productEditMapper.test.ts` | 2 | product write mapping |
| `src/lib/productImages.test.ts` | 19 | product image type gate |
| `src/lib/pwa/adminPushState.test.ts` | 9 | resolveAdminPushState |
| `src/lib/pwa/pushSubscription.test.ts` | 13 | urlBase64ToUint8Array |
| `src/lib/pwa/pushSupport.test.ts` | 16 | pushReadiness |
| `src/lib/pwa/serviceWorkerPush.test.ts` | 21 | sw.js — push handler |
| `src/lib/reports.test.ts` | 8 | buildCouponUsage |
| `src/lib/roles.test.ts` | 6 | role surface routing |
| `src/lib/sessionPersistence.test.ts` | 3 | supabase client session persistence |
| `src/lib/staleAssetRecovery.test.ts` | 15 | failedAssetUrl |
| `src/lib/supabaseKey.test.ts` | 8 | publicSupabaseKey |
| `src/lib/supportContact.test.ts` | 15 | placeholder guard (no placeholder ever reaches a customer) |
| `src/lib/vercelConfig.test.ts` | 13 | vercel.json is expressible by this model |
| `src/lib/webBudget.test.ts` | 8 | startupFontNames |
| `src/utils/calculations.test.ts` | 64 | getVATBreakdown |
| `src/utils/csvReader.test.ts` | 15 | readCsv — fields and records |

### `supabase/functions/`

35 files, 893 declared test blocks.

| File | Blocks | First suite |
| --- | --- | --- |
| `supabase/functions/_shared/accountDeletion.test.ts` | 21 | classifyBlockers — only real, prioritized states |
| `supabase/functions/_shared/adminAuth.test.ts` | 9 | decideAdminAuthorization |
| `supabase/functions/_shared/adminAuthWiring.test.ts` | 18 | staff-accounts privileged actions |
| `supabase/functions/_shared/adminPush.test.ts` | 50 | scopeFor |
| `supabase/functions/_shared/adminPushWiring.test.ts` | 29 | the admin channel is separate from the customer channel |
| `supabase/functions/_shared/alertDispatchWiring.test.ts` | 18 | operations-alert-dispatch is inert until deliberately enabled |
| `supabase/functions/_shared/apiKeys.test.ts` | 16 | key selection |
| `supabase/functions/_shared/authHook.test.ts` | 14 | normalizeHookSecret |
| `supabase/functions/_shared/deployFunctionsWiring.test.ts` | 9 | deploy-functions.yml |
| `supabase/functions/_shared/emailTestConfigWiring.test.ts` | 7 | email-test-config validates the SMTP endpoint before connecting |
| `supabase/functions/_shared/lazywait.test.ts` | 102 | buildCreateOrderPayload — confirmed contract (owner-supplied 2026-08-24) |
| `supabase/functions/_shared/lazywaitApi.test.ts` | 50 | request serialization — paths/methods/query |
| `supabase/functions/_shared/lazywaitBaseUrlWiring.test.ts` | 11 | lazywait-sync guards before it claims any order |
| `supabase/functions/_shared/lazywaitCatalog.test.ts` | 27 | extractCatalogList (response envelope) |
| `supabase/functions/_shared/lazywaitGateLogWiring.test.ts` | 6 | lazywait-sync: a gate refusal that writes no row logs the order id |
| `supabase/functions/_shared/moyasar.test.ts` | 118 | minor units (halalas) |
| `supabase/functions/_shared/moyasarDuplicatePayment.test.ts` | 24 | a declined payment no longer closes its attempt (C1 part 1) |
| `supabase/functions/_shared/moyasarHttp.test.ts` | 10 | parseMoyasarProxyUrl |
| `supabase/functions/_shared/moyasarRefund.test.ts` | 38 | moyasarRefundUrl / moyasarPaymentUrl |
| `supabase/functions/_shared/orderIntakeSyncWiring.test.ts` | 35 | order-intake — immediate POS sync, and no premature promise |
| `supabase/functions/_shared/paymentInitiateGuards.test.ts` | 9 | no invoice outlives its attempt (C1 part 4) |
| `supabase/functions/_shared/paymentVerifyTerminal.test.ts` | 26 | a session with nothing payable is answered terminal, without a key |
| `supabase/functions/_shared/paymentWiring.test.ts` | 68 | payment functions talk to Moyasar only |
| `supabase/functions/_shared/pushDispatchTimeoutWiring.test.ts` | 7 | push-dispatch: the Expo send is bounded |
| `supabase/functions/_shared/pushReadyCopyWiring.test.ts` | 5 | push-dispatch ready copy is order-type aware |
| `supabase/functions/_shared/rest.test.ts` | 41 | cleanSelect — whitespace stripped exactly as postgrest-js stripped it |
| `supabase/functions/_shared/restNoSupabaseJs.test.ts` | 5 | order-intake carries no npm dependency |
| `supabase/functions/_shared/smtpTarget.test.ts` | 24 | parseSmtpTarget |
| `supabase/functions/_shared/syncLog.test.ts` | 8 | syncLogOutcome |
| `supabase/functions/_shared/webhookReliabilityWiring.test.ts` | 11 | lazywait-webhook |
| `supabase/functions/_shared/webPush.test.ts` | 29 | base64url |
| `supabase/functions/_shared/whatsapp.test.ts` | 18 | normalizePhoneE164 |
| `supabase/functions/_shared/whatsappLoginSendWiring.test.ts` | 10 | whatsappSend.ts — the Meta send has a deadline |
| `supabase/functions/payment-return/returnLink.test.ts` | 11 | sanitizeUuid |
| `supabase/functions/staff-accounts/guards.test.ts` | 9 | staff-accounts manageable-role allow-list |
