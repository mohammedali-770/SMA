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
          Push code remains present but DORMANT.
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
- Staff Access role administration, and provisioning for branch/call-centre accounts.
- TOTP/AAL2 staff MFA gate (admin/accountant only — see §3).
- Branch-operations console for branch and call-centre operators.
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

### Branch-operations roles and branch scoping

The role vocabulary is `customer`, `admin`, `accountant`, `branch_staff` and
`call_center`. The last two were added for the branch-operations consoles
(`20260820100000_ops_roles_enum.sql`).

`staff_branch_assignments` pins a `branch_staff` operator to exactly one branch
— the primary key on `user_id` is what enforces "exactly one". The table is
read-only to clients (own row, or everything for an admin) and carries no client
write grant at all, so an operator cannot move themselves to another branch;
assignment happens through `admin_set_staff_branch` / `admin_clear_staff_branch`.

Authorization for branch operations goes through `is_ops_operator(branch_id)`,
which is `is_admin() OR is_call_center() OR is_branch_operator(branch_id)`.

**MFA boundary.** `is_admin()` and `is_staff()` still require JWT `aal=aal2`.
`is_branch_operator()` and `is_call_center()` deliberately do **not** — those
accounts work from shared shop-floor hardware and sign in with email and
password (owner decision 2026-08-20). That carve-out is only safe because the
new roles are narrow by construction: they inherit nothing from `is_staff()`,
and their predicates must never be used to gate orders, customers, profiles,
pricing, payments, reports or integration settings. `supabase/tests/ops_roles_test.sql`
asserts both halves — that the new roles gain no admin/staff privilege, and that
the existing predicates still require `aal2`.

Surface selection lives in one place, `src/lib/roles.ts`: `admin`/`accountant`
get the admin console behind `StaffMfaGate`, `branch_staff`/`call_center` get the
operations console, and everyone else is redirected to `/app`. It is deliberately
no longer expressed as "not a customer".

### Staff account provisioning

Admin and accountant access is still granted by promoting an account that
already exists. Branch and call-centre accounts are different: they are handed
out and revoked by an administrator through the `staff-accounts` Edge Function,
the only place in the repository that calls `auth.admin.createUser`.

Its guards are the point: `verify_jwt` plus an explicit `profiles.role === 'admin'`
re-check, and an allow-list that restricts every action to `branch_staff` /
`call_center` targets, so it can neither mint an administrator nor touch a
customer. Role and branch assignment run through the existing audited RPCs using
the caller's JWT, so `role_change_audit` records the human who acted rather than
the service role.

## 4. Data and business authority

### Catalog and branch state

Catalog, branch, modifier, availability and delivery-zone data live in Supabase. The clients consume those rows/RPCs and do not own the authoritative state.

#### Timed item availability

`branch_product_availability` carries `is_available` plus a `snoozed_until`
timer. **`is_available` remains the authoritative flag**: a snooze sets it
false, and `branch-availability-sweep` (pg_cron, every minute) flips it back
when the timer expires. That is deliberate — the eight `is_available = false`
guards across the `place_order` revisions and `begin_checkout_session` keep
their exact original meaning, so timed availability required no change to any
order-path function and none to the payment-adjacent checkout session.

A row with `is_available = false` and `snoozed_until IS NULL` is an **untimed**
closure — an admin delisting an item through Branch Management. The sweeper
never touches those.

Branch operators close items through `set_product_snooze` /
`clear_product_snooze`, which require a duration: everything a cashier closes
reopens by itself. The untimed close stays an admin control. Authorization is
`is_admin() OR is_branch_operator(branch)` — the call centre is deliberately
excluded from item availability, though it does control delivery.

Every transition is written to the append-only `branch_availability_events` by
a trigger on the table itself, so the pre-existing direct admin toggle is
audited too and no write path can escape the trail. Actor attribution needs no
flag: `auth.uid()` is null under pg_cron, which is what distinguishes an
automatic reopen from a manual one.

The table is world-readable (`bpa_select_public` is `using (true)` for `anon`)
and both clients request `select('*')`, so it carries only non-sensitive fields.
The staff user id and the operator's free-text note live exclusively on the
audit table, which has no anon grant. **Do not add identifying or free-text
columns to `branch_product_availability`.**

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

`branch-availability-sweep` is **not** on the Operations Health board yet. The
allowlist is a hardcoded list inside `operations_health_snapshot_internal()` and
`operations_automation_cron_health_test.sql` asserts its exact job counts, so
registering a job means re-emitting that function and updating that suite —
tracked as its own change. An unregistered job is invisible to the board rather
than alarming (the query drives from the allowlist), but it also means a failing
sweep will not surface there until it is registered. Its own ledger,
`branch_availability_runs`, is the interim record.

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

## 10. Push notifications — client enabled, sending flag-gated

Owner-approved 2026-08-17. The client/native side is live: `PUSH_CLIENT_ENABLED` is `true`, `apps/mobile/app.json` carries the `expo-notifications` plugin and `google-services.json`, and EAS holds iOS APNs (Sandbox & Production) plus Android FCM V1 credentials. Customers can opt in from Profile → Notifications; registration writes go through the `register_push_device` / `deactivate_push_device` SECURITY DEFINER RPCs (there is no client write path on `push_devices`).

Sending remains gated by the `integration_settings` push master flag (`provider_type='push'`, provider `expo`), re-checked by `push-dispatch` on every action. While that flag is disabled — its current state — every action no-ops with `{status:'disabled'}` and nothing is delivered.

Do not infer from the open client gate that push is an active production customer channel; the master flag and a shipping EAS build are both separate owner-approval steps.

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