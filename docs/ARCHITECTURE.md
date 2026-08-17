# Spicy Meal — Current Production Architecture

> **Updated 2026-08-12.** This document describes the current repository architecture. Historical prototype/emulator descriptions are obsolete.

## 1. System topology

```text
┌──────────────────────────────┐          ┌──────────────────────────────┐
│ Customer application         │          │ Staff / admin console        │
│ apps/mobile/                 │          │ src/                         │
│ Expo / React Native          │          │ Vite / React                 │
│ iOS · Android · /app web     │          │ Vercel site root             │
└──────────────┬───────────────┘          └──────────────┬───────────────┘
               │                                        │
               │ Supabase anon/publishable key + JWT    │
               └──────────────────┬─────────────────────┘
                                  ▼
                    ┌──────────────────────────────┐
                    │ Supabase                    │
                    │                             │
                    │ Auth / GoTrue               │
                    │ PostgREST + RPC             │
                    │ Postgres + RLS              │
                    │ Realtime                    │
                    │ pg_cron / DB automation     │
                    │ Edge Functions (Deno)       │
                    └──────────────┬───────────────┘
                                   │ server-side only
                 ┌─────────────────┼──────────────────────┐
                 ▼                 ▼                      ▼
          Lazywait POS       Meta / WhatsApp       Other integrations
                                                    (email, maps, etc.)

          Payment/Tap code remains present but is PROVISIONAL + FROZEN.
          Push notifications (Expo) are LIVE — see §10.
```

The clients do **not** share an in-memory/localStorage database. Supabase is the authoritative backend.

## 2. Client surfaces

### Customer app — `apps/mobile/`

One Expo application targets native iOS, native Android and React Native Web.

Key properties:

- Expo SDK 57 / React Native 0.86.2 / Expo Router.
- Arabic + English with RTL support.
- System / Light / Dark runtime appearance.
- Supabase Auth with WhatsApp delivery for the Saudi-phone login flow.
- Order-type-first Pickup/Delivery context.
- Branch-aware catalog, modifiers, banners and availability.
- Saved-address and map/location workflows.
- Server-authoritative checkout/order placement.
- Order history, customer-safe references, confirmation/receipt states and account deletion.
- Sentry native/JS observability.

The web customer application is an Expo web export of this same codebase, served under `/app`; it is not a separate emulator.

### Staff/admin console — `src/`

The Vite/React staff surface is separate from the Expo customer app.

It includes:

- Live Orders and receipt/ticket workflows.
- Menu/categories/products/modifiers/banners.
- Branches, delivery zones and availability.
- Lazywait mapping/catalog administration.
- Reports and management statistics.
- Operations Health, Operations Alerts and Order Integrity.
- Stranded-order visibility and confirmation-required operational review.
- Staff Access role administration.
- TOTP/AAL2 staff MFA gate.
- Integration and legal/settings surfaces.

Staff roles and privileged operations are enforced server-side; hiding a UI control is never the authorization boundary.

## 3. Authorization and trust boundaries

### Public/client credentials

Both clients may hold:

- the Supabase project URL;
- the Supabase anon/publishable key;
- other credentials explicitly designed to be public client credentials (for example a restricted browser map key, when configured).

These values are not authorization secrets. **RLS, authenticated JWT claims and server-side functions are the security boundary.**

### Server-only credentials

Service-role credentials and third-party provider secrets stay server-side. They must never be exposed through `VITE_*`, `EXPO_PUBLIC_*`, logs, client responses or repository files.

### Staff authorization

Current staff access uses defense in depth:

- application role is stored server-side;
- privileged database paths use `is_admin()` / `is_staff()`-style server predicates;
- staff/admin privilege requires AAL2/TOTP where wired by the production hardening migrations;
- role administration is through audited admin-only RPCs rather than customer-writable profile fields;
- anonymous role-helper RPC exposure was removed.

## 4. Data and business authority

### Catalog and branch state

Catalog, branch, modifier, availability and delivery-zone data live in Supabase. The clients consume those rows/RPCs and do not own the authoritative state.

### Order placement

The backend owns the final order facts. A client can propose a cart/order request, but the server re-validates the authoritative inputs such as:

- authenticated customer;
- branch and order type;
- products and modifier relationships;
- modifier min/max/required cardinality;
- branch availability;
- delivery-zone/address requirements;
- current prices and monetary calculations;
- coupon/loyalty constraints that are actually wired into the order path.

Recent production hardening also enforces modifier selection rules at the database boundary so a forged client cannot bypass the UI's required/max-selection rules.

### Order lifecycle

Order status transitions are server-controlled and audited/hardened rather than trusted to arbitrary client updates. Cancellation compensation now handles loyalty/coupon consequences through the server lifecycle path.

Customer-facing order identifiers use safe external/display references and do not expose internal SMA row IDs.

## 5. Lazywait POS integration

Lazywait is an active operational integration with a typed API layer and server-side synchronization.

Key pieces include:

- `lazywait-sync` Edge Function worker;
- Lazywait webhook handling;
- catalog/mapping support;
- deadline/retry/fencing logic for Create Order outcomes;
- customer-visible confirmation states;
- `confirmation_required` handling for ambiguous outcomes that must not be blindly resent;
- admin verification/triage surfaces;
- Operations Health / stranded-order detection for blocked/dead-letter states.

The system deliberately distinguishes a usable POS reference from an ambiguous/missing reference so it never tells the customer that the restaurant confirmed an order without authoritative evidence.

## 6. WhatsApp authentication/verification

There are intentionally two different WhatsApp-related paths:

1. **Customer login** — Supabase Auth generates/verifies the OTP. The Auth Send-SMS hook calls `auth-send-sms-whatsapp` only to deliver that Auth-generated code over WhatsApp.
2. **Signed-in profile phone verification** — separate verification functions/challenge data handle phone verification and do not create a Supabase Auth session.

Do not merge these paths as cleanup; they have different trust and session responsibilities.

## 7. Account deletion

The account-deletion stack includes customer request flow, queued processing, server-side anonymization/erasure logic and audited manual-review resolution.

The production hardening includes normalized Saudi phone matching for deletion of phone-keyed OTP/WhatsApp records so erasure does not depend on inconsistent `+966` storage formats.

## 8. Operations and observability

### Database/operations monitoring

The admin system includes:

- Operations Health summary/cards;
- order-flow health signal;
- order-integrity health;
- stranded-order detection;
- internal Operations Alerts and digest generation;
- staff-visible health/attention indicators.

These are operational visibility controls, not a substitute for external paging or a completed restore/incident drill. Refer to `INCIDENT_RESPONSE.md` and `BACKUP_RECOVERY.md` for the current operational limitations.

### Sentry

Sentry is wired across native mobile, Expo web and admin web. Release/source-map handling is controlled by the documented Sentry gates and EAS/Vite configuration.

## 9. Payment/refund boundary — frozen

Payment/Tap source, database objects and Edge Functions remain in the repository, but the provider is **not treated as the final product decision**.

The owner decision recorded in [`PAYMENT_POSTPONEMENT.md`](PAYMENT_POSTPONEMENT.md) freezes payment/refund changes while the final gateway is unresolved.

Important consequences:

- Do not use the payment code as a foundation for new work.
- Do not change/deploy/test payment/refund behavior during ordinary development.
- Automated refund processing remains disabled.
- Reopening the area requires a separate provider decision and explicit approval.

Architecture diagrams or README text must not describe the provisional Tap stack as the final gateway.

## 10. Push notifications — LIVE

Enabled end-to-end 2026-08-17. `PUSH_CLIENT_ENABLED` is `true`, `apps/mobile/app.json` carries the `expo-notifications` plugin and `google-services.json`, EAS holds iOS APNs (Sandbox & Production) plus Android FCM V1 credentials, and the `integration_settings` push master flag is enabled, so `push-dispatch` passes its gate and delivers.

Customers opt in from Profile → Notifications. Registration writes go through the `register_push_device` / `deactivate_push_device` SECURITY DEFINER RPCs — there is no client write path on `push_devices`, so the token-format guard and the shared-device ownership transfer cannot be bypassed by a direct REST write.

Delivery paths:

- **order_status** — fired by `order-intake` (service role, best-effort, `waitUntil`) and by admin status changes. Idempotent per `(order_id, status)` via the unique index plus the `send_status` lifecycle, and anti-spoofed by re-reading the order's real status server-side. Targets only that order's customer, and only devices with `order_updates_enabled` (**defaults TRUE**).
- **pos_sync** — POS confirmation lifecycle, consumed from deduplicated events under a fenced claim.
- **broadcast** — admin-initiated, immediate, non-recallable. Targets only devices with `promos_enabled` (**defaults FALSE** — marketing is strictly opt-in).
- **test** — admin-initiated, targets only the calling admin's own registered devices.

Payloads carry only `{ type, orderId }`; tap navigation resolves through `resolveNotificationRoute`'s allow-list, so a payload can never open an arbitrary route or an external URL.

Known ledger quirk: `test` and `broadcast` rows are inserted without a terminal `send_status`, so they remain `processing` after a successful send. The delivery counters on the row are accurate, and the operations health center deliberately sums the `failed` device counter rather than trusting the lifecycle column for these kinds.

## 11. Shared design system

`design-system/` is the canonical shared source for Ember-on-Cream tokens/state contracts used by both application surfaces. Generated/mirrored client copies are checked by:

```bash
npm run design-system:check
```

The runtime theme system supports System/Light/Dark appearance. Mobile includes a palette-binding source scan because direct reads from the canonical light palette can be type-correct while still rendering incorrectly in dark mode.

## 12. Build/deployment topology

### Web

The root production command:

```bash
npm run build
```

performs the admin Vite build and the Expo customer web export, placing the customer SPA under `dist/app` for `/app` routing.

### Native

`apps/mobile/eas.json` defines development, preview and production EAS profiles. Store/native builds are separate release events and require explicit owner approval plus the release checklist.

### Production branch

`claude/project-build-ie4b56` is the default/production branch and the only **long-lived** branch after the historical feature-branch cleanup. Normal development uses short-lived purpose-specific PR branches that are deleted after merge.

## 13. Database change model

Production database state is not reconstructed by blindly comparing migration filename timestamps.

[`MIGRATIONS.md`](MIGRATIONS.md) remains the migration workflow/history ledger, but its last full live-count reconciliation was 2026-08-07. Aug 10 added further migration files, so use [`OWNER_ACTIONS.md`](OWNER_ACTIONS.md) §12 before treating the Aug 7 counts as current.

Rules:

- forward-only new migration files;
- never edit an already-applied migration;
- never run `supabase db push` against production;
- never run `supabase migration repair` against production;
- production applies require the approved migration workflow.

## 14. Related documentation

- [`../README.md`](../README.md) — project overview.
- [`README.md`](README.md) — documentation navigation.
- [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md) — current release/engineering state.
- [`MIGRATIONS.md`](MIGRATIONS.md) — migration workflow/history ledger.
- [`OWNER_ACTIONS.md`](OWNER_ACTIONS.md) — current owner/live reconciliation gaps.
- [`PAYMENT_POSTPONEMENT.md`](PAYMENT_POSTPONEMENT.md) — payment freeze.
- [`ORDER_CONFIRMATION_FLOW.md`](ORDER_CONFIRMATION_FLOW.md) — customer order confirmation lifecycle.
- [`OPERATIONS_ALERTS_DIGEST.md`](OPERATIONS_ALERTS_DIGEST.md) — operations alert engine.
- [`SENTRY_OBSERVABILITY.md`](SENTRY_OBSERVABILITY.md) / [`SENTRY_WEB_OBSERVABILITY.md`](SENTRY_WEB_OBSERVABILITY.md) — observability.
- [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) — release gates.