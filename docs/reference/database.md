<!-- ------------------------------------------------------------------
     GENERATED FILE — DO NOT EDIT.
     Regenerate with: npm run docs:generate
     CI fails if this file drifts from its source (npm run docs:check).
     Derived from: `supabase/migrations/*.sql`
     Describes the REPOSITORY, not live Production.
     ------------------------------------------------------------------ -->

# Database objects

Tables, functions, policies and triggers **as declared by the migrations in this repository**.

> This is a source-derived index, not a live schema dump. It is built by reading migration text, so it shows what the repository declares. For what Production actually holds — including migration-history rows that have no file here — see the dated read-only snapshot in [`../OWNER_ACTIONS.md`](../OWNER_ACTIONS.md) and [`../MIGRATION_RECONCILIATION_20260812.md`](../MIGRATION_RECONCILIATION_20260812.md). Never reconcile the two by applying anything.

Migration files in the repository: **97**. Earliest `20260707120000_extensions_enums_helpers.sql`, latest `20260822090000_branch_availability_retention.sql`.

## Tables

The *RLS policies* column counts `create policy` statements across all migrations. A table showing **none declared** either is not client-reachable or is a genuine gap — check before assuming the former.

| Table | Created in | Later migrations altering it | RLS policies |
| --- | --- | --- | --- |
| `account_deletion_requests` | `20260715120000_account_deletion.sql` | 0 | 2 |
| `account_deletion_resolution_audit` | `20260810120000_account_deletion_manual_review_resolution.sql` | 0 | 1 |
| `addresses` | `20260707120300_addresses.sql` | 0 | 2 |
| `app_settings` | `20260707120600_app_settings.sql` | 2 | 2 |
| `branch_availability_events` | `20260820110000_branch_availability_snooze.sql` | 0 | 1 |
| `branch_availability_runs` | `20260820111000_branch_availability_sweeper.sql` | 3 | **none declared** |
| `branch_delivery_areas` | `20260820120000_branch_delivery_control.sql` | 0 | 1 |
| `branch_delivery_events` | `20260820120000_branch_delivery_control.sql` | 0 | 1 |
| `branch_delivery_zones` | `20260710120000_delivery_zones.sql` | 0 | 3 |
| `branch_modifier_availability` | `20260820140000_branch_modifier_availability.sql` | 0 | 2 |
| `branch_product_availability` | `20260707120200_catalog.sql` | 1 | 1 |
| `branch_working_hours` | `20260820120000_branch_delivery_control.sql` | 0 | 1 |
| `branches` | `20260707120200_catalog.sql` | 3 | 3 |
| `campaign_redemptions` | `20260728120000_discounts_campaigns.sql` | 0 | 1 |
| `campaigns` | `20260728120000_discounts_campaigns.sql` | 0 | 5 |
| `categories` | `20260707120200_catalog.sql` | 1 | 3 |
| `checkout_sessions` | `20260712160000_checkout_sessions.sql` | 1 | 1 |
| `coupons` | `20260707120400_coupons.sql` | 0 | 1 |
| `homepage_banners` | `20260712130000_homepage_banners.sql` | 0 | 5 |
| `integration_settings` | `20260707121000_integration_settings.sql` | 2 | **none declared** |
| `integration_sync_logs` | `20260707121300_payments_and_sync.sql` | 0 | 1 |
| `lazywait_catalog_items` | `20260708150000_lazywait_catalog_mapping.sql` | 0 | **none declared** |
| `lazywait_catalog_pulls` | `20260708150000_lazywait_catalog_mapping.sql` | 0 | **none declared** |
| `lazywait_sync_requests` | `20260720120000_lazywait_sync_scheduler.sql` | 0 | **none declared** |
| `legal_documents` | `20260712140000_legal_documents.sql` | 0 | 5 |
| `loyalty_transactions` | `20260707120900_loyalty_audit.sql` | 2 | 1 |
| `modifier_groups` | `20260707120200_catalog.sql` | 1 | 1 |
| `modifiers` | `20260707120200_catalog.sql` | 1 | 3 |
| `notification_log` | `20260714090000_push_notifications.sql` | 1 | 2 |
| `operations_alert_events` | `20260723090000_smart_operations_alerts_digest.sql` | 0 | **none declared** |
| `operations_alert_outbox` | `20260723090000_smart_operations_alerts_digest.sql` | 0 | **none declared** |
| `operations_alert_runs` | `20260723090000_smart_operations_alerts_digest.sql` | 0 | **none declared** |
| `operations_alert_settings` | `20260723090000_smart_operations_alerts_digest.sql` | 0 | **none declared** |
| `operations_alert_state` | `20260723090000_smart_operations_alerts_digest.sql` | 0 | **none declared** |
| `operations_digest_runs` | `20260723090000_smart_operations_alerts_digest.sql` | 0 | **none declared** |
| `ops_change_events` | `20260820130000_ops_change_events.sql` | 0 | 1 |
| `order_change_events` | `20260724200000_order_read_contracts.sql` | 0 | 1 |
| `order_integrity_alert_outbox` | `20260721170000_order_integrity_watchdog.sql` | 0 | **none declared** |
| `order_integrity_config` | `20260721170000_order_integrity_watchdog.sql` | 0 | **none declared** |
| `order_integrity_incidents` | `20260721170000_order_integrity_watchdog.sql` | 0 | **none declared** |
| `order_integrity_runs` | `20260721170000_order_integrity_watchdog.sql` | 0 | **none declared** |
| `order_item_modifiers` | `20260707120500_orders.sql` | 0 | 2 |
| `order_items` | `20260707120500_orders.sql` | 1 | 2 |
| `order_refunds` | `20260724120000_order_confirmation_state_machine.sql` | 0 | 1 |
| `orders` | `20260707120500_orders.sql` | 6 | 2 |
| `otp_challenges` | `20260710140000_whatsapp_otp.sql` | 1 | **none declared** |
| `payment_records` | `20260707121300_payments_and_sync.sql` | 2 | 1 |
| `product_modifier_groups` | `20260707120200_catalog.sql` | 0 | 1 |
| `products` | `20260707120200_catalog.sql` | 2 | 3 |
| `profiles` | `20260707120100_profiles.sql` | 2 | 2 |
| `push_devices` | `20260714090000_push_notifications.sql` | 0 | 3 |
| `role_change_audit` | `20260810140000_staff_role_administration.sql` | 0 | 1 |
| `staff_branch_assignments` | `20260820100500_ops_branch_scoping.sql` | 0 | 1 |
| `whatsapp_message_logs` | `20260710140000_whatsapp_otp.sql` | 0 | 1 |

## Functions and RPCs

A function defined by more than one migration has been redefined; the last definition wins. Several of these are `security definer`, which means they run with the definer’s rights rather than the caller’s — read the migration before changing one.

| Function | Definitions | Last defined in |
| --- | --- | --- |
| `aal_claim_satisfies_staff_mfa` | 1 | `20260810142000_staff_mfa_aal2.sql` |
| `address_description_is_usable` | 2 | `20260802120000_address_description_trim_all_whitespace.sql` |
| `adjust_loyalty_points` | 2 | `20260707120900_loyalty_audit.sql` |
| `admin_add_delivery_area` | 1 | `20260820120500_branch_delivery_rpcs.sql` |
| `admin_clear_staff_branch` | 1 | `20260820100500_ops_branch_scoping.sql` |
| `admin_delete_delivery_area` | 1 | `20260820120500_branch_delivery_rpcs.sql` |
| `admin_list_orders` | 1 | `20260724200000_order_read_contracts.sql` |
| `admin_list_orders_for_range` | 1 | `20260806130000_admin_ranged_orders_and_stats.sql` |
| `admin_list_orders_with_items` | 3 | `20260821170000_order_item_notes.sql` |
| `admin_list_role_change_audit` | 1 | `20260810141000_staff_access_directory.sql` |
| `admin_list_staff` | 1 | `20260810140000_staff_role_administration.sql` |
| `admin_order_stats` | 1 | `20260806130000_admin_ranged_orders_and_stats.sql` |
| `admin_search_role_candidates` | 1 | `20260810141000_staff_access_directory.sql` |
| `admin_set_order_status` | 2 | `20260810100000_order_status_cancellation_integrity.sql` |
| `admin_set_staff_branch` | 1 | `20260820100500_ops_branch_scoping.sql` |
| `admin_set_user_role` | 1 | `20260810140000_staff_role_administration.sql` |
| `admin_update_delivery_area` | 1 | `20260820120500_branch_delivery_rpcs.sql` |
| `admin_upsert_branch_working_hours` | 1 | `20260820120500_branch_delivery_rpcs.sql` |
| `anonymize_account_data` | 2 | `20260806120000_erasure_phone_normalization.sql` |
| `assert_order_item_modifier_contract` | 1 | `20260810132000_order_modifier_contract.sql` |
| `begin_checkout_session` | 2 | `20260712170000_checkout_sessions_hardening.sql` |
| `begin_lazywait_create_attempt` | 1 | `20260721120000_lazywait_confirmation_lifecycle.sql` |
| `branch_availability_sweep` | 4 | `20260822090000_branch_availability_retention.sql` |
| `caller_can_read_order` | 1 | `20260724200000_order_read_contracts.sql` |
| `claim_due_account_deletions` | 1 | `20260715120000_account_deletion.sql` |
| `claim_lazywait_sync_batch` | 3 | `20260813143000_manual_only_pos_resend.sql` |
| `claim_lazywait_sync_one` | 3 | `20260813143000_manual_only_pos_resend.sql` |
| `claim_order_refund` | 1 | `20260724120000_order_confirmation_state_machine.sql` |
| `claim_pos_sync_notification` | 1 | `20260721120000_lazywait_confirmation_lifecycle.sql` |
| `clear_branch_delivery_pause` | 1 | `20260820120500_branch_delivery_rpcs.sql` |
| `clear_branch_delivery_zone` | 1 | `20260710120000_delivery_zones.sql` |
| `clear_delivery_area_disabled` | 1 | `20260820120500_branch_delivery_rpcs.sql` |
| `clear_lazywait_mapping` | 1 | `20260708150000_lazywait_catalog_mapping.sql` |
| `clear_modifier_snooze` | 1 | `20260820140000_branch_modifier_availability.sql` |
| `clear_product_snooze` | 1 | `20260820110500_branch_availability_rpcs.sql` |
| `compute_campaign_discount` | 1 | `20260728120000_discounts_campaigns.sql` |
| `compute_order_snapshot` | 2 | `20260821170000_order_item_notes.sql` |
| `confirm_order_payment` | 2 | `20260709140000_payment_methods.sql` |
| `create_account_deletion_request` | 1 | `20260715120000_account_deletion.sql` |
| `current_app_role` | 1 | `20260707120100_profiles.sql` |
| `current_staff_branch_id` | 1 | `20260820100500_ops_branch_scoping.sql` |
| `customer_manual_pos_resend_eligibility` | 1 | `20260813143000_manual_only_pos_resend.sql` |
| `customer_order_state` | 1 | `20260724120000_order_confirmation_state_machine.sql` |
| `customer_pos_resend_eligibility` | 1 | `20260724120000_order_confirmation_state_machine.sql` |
| `customer_pos_resend_limit` | 1 | `20260724120000_order_confirmation_state_machine.sql` |
| `customer_pos_resend_window` | 1 | `20260724120000_order_confirmation_state_machine.sql` |
| `deactivate_push_device` | 1 | `20260714090000_push_notifications.sql` |
| `emit_branch_availability_event` | 1 | `20260820110000_branch_availability_snooze.sql` |
| `emit_branch_delivery_event` | 1 | `20260820120000_branch_delivery_control.sql` |
| `emit_delivery_area_event` | 1 | `20260820120000_branch_delivery_control.sql` |
| `emit_modifier_availability_event` | 1 | `20260820140000_branch_modifier_availability.sql` |
| `emit_ops_change_event` | 1 | `20260820130000_ops_change_events.sql` |
| `emit_order_change_event` | 1 | `20260724200000_order_read_contracts.sql` |
| `enforce_account_deletion_lock` | 1 | `20260715130000_account_deletion_lock.sql` |
| `enforce_address_description` | 1 | `20260724170000_require_address_description.sql` |
| `enforce_customer_manual_resend_limit` | 1 | `20260813143000_manual_only_pos_resend.sql` |
| `enforce_new_order_item_modifier_contract` | 1 | `20260810132000_order_modifier_contract.sql` |
| `enforce_order_item_note` | 1 | `20260821170000_order_item_notes.sql` |
| `enforce_order_note` | 1 | `20260819120000_order_note_length_limit.sql` |
| `enforce_refund_state_transition` | 1 | `20260724120000_order_confirmation_state_machine.sql` |
| `enforce_single_default_address` | 1 | `20260801120000_address_single_default.sql` |
| `expire_stale_order_refund_claims` | 1 | `20260729090000_payment_refund_scheduler.sql` |
| `finalize_checkout_session` | 2 | `20260712170000_checkout_sessions_hardening.sql` |
| `finalize_order_refund` | 1 | `20260724120000_order_confirmation_state_machine.sql` |
| `finalize_pos_sync_notification` | 1 | `20260721120000_lazywait_confirmation_lifecycle.sql` |
| `guard_address_delete_live_checkout` | 1 | `20260801120100_checkout_session_address_fk_set_null.sql` |
| `guard_used_coupon_identity` | 1 | `20260810100500_coupon_code_identity_guard.sql` |
| `handle_auth_user_phone_confirmed` | 1 | `20260710150000_whatsapp_login.sql` |
| `handle_new_user` | 2 | `20260710150000_whatsapp_login.sql` |
| `has_active_account_deletion` | 1 | `20260715130000_account_deletion_lock.sql` |
| `import_lazywait_catalog` | 1 | `20260709130000_import_lazywait_catalog.sql` |
| `insert_order_from_snapshot` | 3 | `20260821170000_order_item_notes.sql` |
| `invoke_account_deletion_processor` | 1 | `20260716180000_account_deletion_scheduler_job.sql` |
| `invoke_lazywait_sync_processor` | 1 | `20260720120000_lazywait_sync_scheduler.sql` |
| `invoke_payment_refund_processor` | 1 | `20260729090000_payment_refund_scheduler.sql` |
| `is_admin` | 2 | `20260810142000_staff_mfa_aal2.sql` |
| `is_branch_operator` | 1 | `20260820100500_ops_branch_scoping.sql` |
| `is_call_center` | 1 | `20260820100500_ops_branch_scoping.sql` |
| `is_ops_operator` | 1 | `20260820100500_ops_branch_scoping.sql` |
| `is_staff` | 2 | `20260810142000_staff_mfa_aal2.sql` |
| `jwt_has_aal2` | 1 | `20260810142000_staff_mfa_aal2.sql` |
| `lazywait_mapping_status` | 1 | `20260708150000_lazywait_catalog_mapping.sql` |
| `lazywait_pos_ref_is_usable` | 1 | `20260721120000_lazywait_confirmation_lifecycle.sql` |
| `lazywait_requeue_eligibility` | 1 | `20260721120000_lazywait_confirmation_lifecycle.sql` |
| `lazywait_sync_health_summary` | 1 | `20260721150000_lazywait_sync_health_summary.sql` |
| `list_failed_order_refunds` | 1 | `20260724120000_order_confirmation_state_machine.sql` |
| `list_integration_settings` | 1 | `20260707121000_integration_settings.sql` |
| `list_pos_confirmation_required` | 1 | `20260721120000_lazywait_confirmation_lifecycle.sql` |
| `loyalty_safe_reason` | 1 | `20260724130000_loyalty_reason_no_order_number.sql` |
| `mark_phone_verified` | 1 | `20260710140000_whatsapp_otp.sql` |
| `normalize_branch_availability` | 1 | `20260820110000_branch_availability_snooze.sql` |
| `normalize_branch_delivery_pause` | 1 | `20260820120000_branch_delivery_control.sql` |
| `normalize_delivery_area` | 1 | `20260820120000_branch_delivery_control.sql` |
| `normalize_known_pos_failure_for_manual_resend` | 1 | `20260813143000_manual_only_pos_resend.sql` |
| `normalize_ksa_e164` | 1 | `20260806120000_erasure_phone_normalization.sql` |
| `normalize_manual_pos_sync_notification` | 1 | `20260813143000_manual_only_pos_resend.sql` |
| `normalize_modifier_availability` | 1 | `20260820140000_branch_modifier_availability.sql` |
| `open_order_refund_record` | 1 | `20260724120000_order_confirmation_state_machine.sql` |
| `operations_alert_settings_get` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_alert_settings_safe` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_alert_settings_update` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_alert_timeline` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_alerts_admin_summary` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_alerts_derive` | 4 | `20260810113500_stranded_order_alert_and_index.sql` |
| `operations_alerts_derive_pre_stranded` | 1 | `20260820160000_branch_availability_health_card.sql` |
| `operations_alerts_evaluate` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_alerts_list` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_alerts_outbox_for_event` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_alerts_render_event` | 3 | `20260820160000_branch_availability_health_card.sql` |
| `operations_alerts_safe_bool` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_alerts_safe_int` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_alerts_sanitize_evidence` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_alerts_state_label` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_digest_build` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_digest_generate` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_digest_list` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_digest_preview` | 1 | `20260723090000_smart_operations_alerts_digest.sql` |
| `operations_health_overall_state` | 2 | `20260807150000_order_flow_health_card.sql` |
| `operations_health_snapshot_internal` | 5 | `20260820160000_branch_availability_health_card.sql` |
| `operations_health_summary` | 2 | `20260723090000_smart_operations_alerts_digest.sql` |
| `order_integrity_acknowledge_incident` | 1 | `20260721170000_order_integrity_watchdog.sql` |
| `order_integrity_admin_summary` | 1 | `20260721170000_order_integrity_watchdog.sql` |
| `order_integrity_health_summary` | 2 | `20260810113000_order_integrity_stranded_orders_health.sql` |
| `order_integrity_incident_timeline` | 1 | `20260721170000_order_integrity_watchdog.sql` |
| `order_integrity_list_incidents` | 1 | `20260721170000_order_integrity_watchdog.sql` |
| `order_integrity_suppress_incident` | 1 | `20260721170000_order_integrity_watchdog.sql` |
| `order_integrity_watchdog` | 1 | `20260721170000_order_integrity_watchdog.sql` |
| `order_item_note_is_acceptable` | 1 | `20260821170000_order_item_notes.sql` |
| `order_note_is_acceptable` | 1 | `20260819120000_order_note_length_limit.sql` |
| `order_note_normalized` | 1 | `20260819120000_order_note_length_limit.sql` |
| `order_refund_due` | 1 | `20260724120000_order_confirmation_state_machine.sql` |
| `otp_begin_send` | 1 | `20260710140000_whatsapp_otp.sql` |
| `otp_consume` | 1 | `20260710140000_whatsapp_otp.sql` |
| `otp_get_active_challenge` | 1 | `20260710140000_whatsapp_otp.sql` |
| `otp_increment_attempt` | 1 | `20260710140000_whatsapp_otp.sql` |
| `place_customer_order` | 1 | `20260724200000_order_read_contracts.sql` |
| `place_order` | 9 | `20260821170000_order_item_notes.sql` |
| `point_in_active_delivery_zone` | 1 | `20260710120000_delivery_zones.sql` |
| `pos_confirmation_channel_active` | 1 | `20260724120000_order_confirmation_state_machine.sql` |
| `pos_next_attempt_at` | 1 | `20260721120000_lazywait_confirmation_lifecycle.sql` |
| `pos_sync_status_matches` | 1 | `20260721120000_lazywait_confirmation_lifecycle.sql` |
| `reap_stale_lazywait_syncs` | 2 | `20260721120000_lazywait_confirmation_lifecycle.sql` |
| `record_lazywait_sync` | 3 | `20260721130000_lazywait_synced_ref_guard.sql` |
| `record_order_sync` | 1 | `20260707121300_payments_and_sync.sql` |
| `record_whatsapp_message` | 1 | `20260710140000_whatsapp_otp.sql` |
| `register_push_device` | 1 | `20260714090000_push_notifications.sql` |
| `release_pos_sync_notification` | 1 | `20260721120000_lazywait_confirmation_lifecycle.sql` |
| `request_customer_pos_resend` | 2 | `20260813143000_manual_only_pos_resend.sql` |
| `requeue_lazywait_order` | 3 | `20260721120000_lazywait_confirmation_lifecycle.sql` |
| `resolve_account_deletion_request` | 1 | `20260810120000_account_deletion_manual_review_resolution.sql` |
| `set_branch_delivery_pause` | 1 | `20260820120500_branch_delivery_rpcs.sql` |
| `set_branch_delivery_zone` | 1 | `20260710120000_delivery_zones.sql` |
| `set_delivery_area_disabled` | 1 | `20260820120500_branch_delivery_rpcs.sql` |
| `set_lazywait_initial_sync` | 2 | `20260709140000_payment_methods.sql` |
| `set_lazywait_mapping` | 1 | `20260708150000_lazywait_catalog_mapping.sql` |
| `set_loyalty_safe_reason` | 2 | `20260724190000_loyalty_reason_history_safe.sql` |
| `set_modifier_snooze` | 1 | `20260820140000_branch_modifier_availability.sql` |
| `set_order_number` | 2 | `20260709120000_sec_trigger_search_path.sql` |
| `set_order_refund_enrollment` | 1 | `20260724120000_order_confirmation_state_machine.sql` |
| `set_payment_settings` | 1 | `20260709140000_payment_methods.sql` |
| `set_pos_sync_deadline` | 1 | `20260721120000_lazywait_confirmation_lifecycle.sql` |
| `set_product_snooze` | 1 | `20260820110500_branch_availability_rpcs.sql` |
| `set_updated_at` | 2 | `20260709120000_sec_trigger_search_path.sql` |
| `signal_area_change` | 1 | `20260820130000_ops_change_events.sql` |
| `signal_availability_change` | 1 | `20260820130000_ops_change_events.sql` |
| `signal_delivery_change` | 1 | `20260820130000_ops_change_events.sql` |
| `signal_modifier_availability_change` | 1 | `20260820140000_branch_modifier_availability.sql` |
| `stamp_payment_record_ts` | 1 | `20260712120000_tap_payments.sql` |
| `tap_begin_payment_attempt` | 2 | `20260724180000_tap_reference_order_opaque.sql` |
| `tap_begin_session_attempt` | 2 | `20260712170000_checkout_sessions_hardening.sql` |
| `text_has_internal_order_number` | 1 | `20260724130000_loyalty_reason_no_order_number.sql` |
| `upsert_integration_settings` | 4 | `20260710170000_email_integration.sql` |
| `validate_coupon` | 1 | `20260707120400_coupons.sql` |
| `validate_pos_sync_notification_before_send` | 1 | `20260721120000_lazywait_confirmation_lifecycle.sql` |
| `verify_account_deletion_process_secret` | 1 | `20260716160000_account_deletion_scheduler_auth.sql` |
| `whatsapp_login_enabled` | 2 | `20260710160000_fix_whatsapp_login_review.sql` |

## Triggers

62 trigger names are declared across the migration set: `aa_normalize_known_pos_failure_for_manual_resend`, `emit_branch_availability_event`, `emit_branch_delivery_event`, `emit_delivery_area_event`, `emit_modifier_availability_event`, `emit_orders_change_event`, `enforce_customer_manual_resend_limit`, `enforce_deletion_lock_addresses`, `enforce_deletion_lock_checkout_sessions`, `enforce_deletion_lock_orders`, `enforce_deletion_lock_push_devices`, `enforce_orders_refund_transition`, `guard_used_coupon_identity`, `normalize_branch_availability`, `normalize_branch_delivery_pause`, `normalize_delivery_area`, `normalize_manual_pos_sync_notification`, `normalize_modifier_availability`, `on_auth_user_created`, `on_auth_user_phone_confirmed`, `open_orders_refund_record`, `set_`, `set_account_deletion_requests_updated_at`, `set_addresses_updated_at`, `set_app_settings_updated_at`, `set_branch_delivery_areas_updated_at`, `set_branch_delivery_zones_updated_at`, `set_branch_modifier_availability_updated_at`, `set_branch_working_hours_updated_at`, `set_campaigns_updated_at`, `set_checkout_sessions_updated_at`, `set_coupons_updated_at`, `set_homepage_banners_updated_at`, `set_integration_settings_updated_at`, `set_legal_documents_updated_at`, `set_loyalty_transactions_safe_reason`, `set_notification_log_updated_at`, `set_operations_alert_outbox_updated_at`, `set_operations_alert_settings_updated_at`, `set_operations_alert_state_updated_at`, `set_order_refunds_updated_at`, `set_orders_lazywait_initial_sync`, `set_orders_number`, `set_orders_refund_enrollment`, `set_orders_updated_at`, `set_otp_challenges_updated_at`, `set_payment_records_updated_at`, `set_pos_sync_deadline`, `set_profiles_updated_at`, `set_push_devices_updated_at`, `set_staff_branch_assignments_updated_at`, `signal_area_change`, `signal_availability_change`, `signal_delivery_change`, `signal_modifier_availability_change`, `stamp_payment_record_ts`, `trg_addresses_guard_live_checkout`, `trg_addresses_require_description`, `trg_addresses_single_default`, `trg_checkout_sessions_note_length`, `trg_enforce_order_item_note`, `trg_orders_note_length`.
