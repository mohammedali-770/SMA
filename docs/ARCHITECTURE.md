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
- Sold-out items shown in place, not hidden, with availability refreshed on
  foreground and on returning to the menu.
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

### Branch-operations console — `src/components/ops/`

The same Vite bundle serves a second, much smaller surface for the
`branch_staff` and `call_center` roles, chosen by `src/lib/roles.ts` and
deliberately outside `StaffMfaGate`.

It is not a trimmed-down admin console. The branch is pinned from
`staff_branch_assignments`, so there is no branch picker and the "closed the
item at the wrong branch" mistake `STAFF_MANUAL.md` warns about cannot be made.
Closed items sit at the top with live countdowns, because mid-rush the question
is "what is off and when does it come back", not "where is this in the menu".
The item list is searched and grouped by category, where the admin equivalent is
a fixed-height scroll of the entire catalog.

Copy lives in a typed table (`src/components/ops/opsStrings.ts`) following the
customer app's i18n pattern rather than the admin console's inline ternaries,
defaults to Arabic and is persisted. The shared sign-in screen reads the same
preference but defaults to English, so adding the toggle changed nothing for
existing admins.

It uses only the catalog already loaded for these roles plus a narrow
availability read; it never triggers the admin order/profile bootstrap, which
`is_staff()` would refuse anyway.

The call-centre board shows **only branches with something wrong**, colour-banded
rather than numerically ranked, with a detail panel carrying contact, trading
hours, the closed-item list, and the two controls that role is authorized for
(delivery pause/resume and advisory area toggles). A branch that gains a closure
raises a toast and an optional sound; that comparison is per-branch, so one
branch recovering cannot mask another failing.

#### The operations realtime signal

`ops_change_events` carries a branch id and a change kind — never an item, a
reason or an actor — and is the only new table added to `supabase_realtime`.
Publishing the data tables directly would be wrong twice over: `postgres_changes`
re-evaluates RLS per subscriber and delivers whole rows, and
`branch_product_availability` is readable by `anon`, so every closure at every
branch would reach every anonymous browser holding a socket. The consoles treat
an event as a hint to refetch, never as data.

Realtime is an enhancement, never a dependency. `useOpsChangeFeed` mirrors the
admin order feed: a six-second connect timeout falls back to a fast poll, an
always-on slow backstop covers a channel that connects but never delivers (what
a missing publication looks like from the client), refetches are throttled to a
floor rather than debounced, and the trailing run is kept so an event arriving
mid-refresh is not lost until the backstop.

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

#### How availability reaches the customer

The customer app loads the catalog once per mount and subscribes to nothing.
Availability alone is re-read on two cheap triggers — app foreground, and
returning to the menu — which are the two moments a stale menu actually bites:
the app sat in the background while the branch closed half the menu, or the
customer was on the cart while an item went. Prices, categories and modifiers
still need the full reload.

A sold-out item **stays on the menu**, dimmed and inert, rather than
disappearing; a customer who cannot find yesterday's item concludes the app is
broken, whereas a greyed row with a reason is an answer. Delisted products
(`isActive` false) are a different thing and are still removed entirely.

Checkout re-reads availability and names anything that sold out mid-order,
instead of surfacing `place_order`'s raw "a product in your cart is not
available" at the very end of the flow without saying which one. If that refresh
fails the order proceeds and the server stays the authority — a flaky network
must not block a valid order.

The app deliberately gets no realtime subscription; it has never had one, and
refetch-on-focus is enough for this.

#### Timed delivery pause, advisory areas, working hours

`branches.delivery_temporarily_closed` stays the **authoritative** flag, with
`delivery_closed_until` as the scheduled resume time, so the two byte-identical
delivery guards keep their current meaning and no order-path function was
modified. Those guards live in `place_order` and — note — in
**`compute_order_snapshot`**, not `begin_checkout_session`, which declares no
branches rowtype. A pause with `delivery_closed_until IS NULL` is the admin's
untimed toggle and the sweeper never resumes it.

Authorization is the mirror image of item snoozing: delivery pause and area
disabling are **`is_admin() OR is_call_center()`**, deliberately not
`is_ops_operator()`, which would admit branch staff. Between the two files the
split is: the branch owns what is sellable, the call centre owns where it can
go, and an admin can do both.

`branch_delivery_areas` and `branch_working_hours` are **advisory and enforce
nothing**. Delivery eligibility is decided solely by
`point_in_active_delivery_zone` against the branch polygon, and branch
open/closed for ordering remains `is_active`. Disabling a named area does not
stop the app accepting orders from it — the names exist for call-centre staff
taking phone orders. Both tables carry that in a `comment on table`, and the SQL
suite asserts it by placing a real order with an area disabled.

Working hours are one window per weekday; a `closes_at` at or before `opens_at`
means the window **crosses midnight** (12:00 → 02:00), which is normal for a
late-night branch and must not be "fixed" as inverted data. Do not confuse this
with `app_settings.support_hours_*`, which is one global free-text *support*
hours string shown on the customer Legal screen.

Exposure follows the same rule as items: `branches` is readable by `anon` and
both clients request `select('*')`, so the staff actor and any free text live
only on `branch_delivery_events`. A reason code is kept off `branches` too — a
paused branch simply drops out of the delivery list, so unlike a product's
reason it has no customer-facing use and no reason to be exposed. Area names are
ops-only; working hours are public business information.

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

#### Timed modifier availability

Options are closed the same way through `branch_modifier_availability`
(`branch_id`, `modifier_id`, `is_available`, `snoozed_until`, …), with
`set_modifier_snooze` / `clear_modifier_snooze` under the same
`is_admin() OR is_branch_operator(branch)` authorization, the same
normalize-and-audit trigger pair writing to `branch_availability_events`
(`modifier_id` set, `product_id` null), and the same sweeper pass — counted
separately as `modifiers_reopened` so the existing `products_reopened`
assertions keep measuring what they claim to. Untimed modifier closures are
never auto-reopened either.

**This is the one part of branch availability that changes the order path.**
Nothing else enforces per-branch modifier stock: the deferred modifier-contract
trigger checks cardinality, not availability, and returns early for anything
that is not a cash order. So `place_order` is re-emitted once, adding exactly
two things to the `20260710120100` body:

1. an availability lookup inside the **existing** modifier loop, refusing a
   snoozed option before payment — the same boundary the product check already
   sits on, and deliberately not a commit-time re-check (see
   `20260810132000_order_modifier_contract.sql`: re-validating an authorized
   snapshot against mutable menu data can leave a charged customer without an
   order);
2. `and (snoozed_until is null or snoozed_until > now())` on both the product
   and modifier guards, so an elapsed timer stops blocking immediately instead
   of up to a minute later when the sweeper next runs. Lazy expiry at read,
   sweeper for the durable write.

`begin_checkout_session` and `compute_order_snapshot` are **not** touched — they
are payment-adjacent, and because `is_available` stays authoritative they never
needed to be.

On the clients, the required-group rule is a **computation, not a second
server check**. A product is orderable when its own row says so *and* every
required option group still has enough available options to satisfy its
minimum — `apps/mobile/src/lib/orderability.ts`, mirrored for the operator
console by `productBlockedByOptions` in `src/components/ops/branchConsole.ts`.
When it fails, the customer app renders the item as out of stock and
non-clickable and the branch console flags the product row, so a cashier is
never shown "available" for something nobody can buy. Closed options are
rendered inert (not merely disabled) on the product screen, and a cart line
being edited drops any option that has since closed rather than carrying it
silently. The re-emission also emits **no grants**: `create or replace
function` preserves the existing ACL, and `20260724200000` deliberately revoked
`place_order` from `authenticated` in favour of the `place_customer_order`
wrapper. Re-granting would silently undo that.

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

`branch-availability-sweep` is on the board as a **non-critical** automation
cron (6-minute staleness window), alongside the alerts evaluator and the digest
generator. The allowlist is a hardcoded list inside
`operations_health_snapshot_internal()`, so registering a job means re-emitting
that function and updating the two suites that assert its exact counts
(`operations_automation_cron_health_test.sql`,
`operations_health_center_test.sql`) — plus the client-side offline fallback
list in `src/lib/operationsHealthApi.ts`, which mirrors the same allowlist.

Non-critical is deliberate. The sweeper only ever *reopens* expired closures, so
a dead one means items and delivery pauses outlive their timers: over-blocking,
never over-selling. That is worth a warning — it raises
`OPERATIONS_AUTOMATION_JOBS_FAILING` and a
`database_jobs:job_health:branch-availability-sweep` alert condition at warning
severity — but it must never flip `database_jobs.state` or the overall platform
rollup, which stay the property of the three critical application crons. Its own
ledger, `branch_availability_runs`, remains the per-run record.

**The cron entry and the `branch_availability` card answer different questions,
and only the second one is trustworthy about the sweeper.**
`branch_availability_sweep` catches its own exceptions: it writes
`status='failed'` to `branch_availability_runs` and then **returns normally**, so
pg_cron records the run as `succeeded`. The Scheduled Jobs card would read the
sweeper healthy while every single sweep failed. The `branch_availability` card
(20260820160000) reads the ledger and the availability state instead — closed
items, closed options, paused branches, disabled areas, and how far past its
restore time the oldest closure is. It is the only place a sweeper that runs and
fails is visible.

It is non-critical for the same reason the cron entry is, and carries **counts
only**: no branch is ever named in Operations Health or in alert evidence. The
call-centre console is where an operator sees which branch and acts on it.

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