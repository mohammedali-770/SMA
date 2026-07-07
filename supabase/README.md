# Spicy Meal — Supabase backend foundation

This directory is the **backend foundation** for Spicy Meal: the database schema,
idempotent migrations, and Row-Level-Security (RLS) policies. It is intentionally
**backend-only** — the front-end is not yet wired to it, and payments, SMS/OTP,
push, and Lazywait sync are **out of scope** here (they get their own migrations
later).

> Status: the migrations have been applied and idempotency-tested against
> PostgreSQL 16, and the RLS model + `place_order` flow were verified by
> simulating customer / admin / accountant / anon roles. See "Verification"
> below.

## Migration order

| # | File | Contents |
|---|------|----------|
| 1 | `20260707120000_extensions_enums_helpers.sql` | `pgcrypto`; enums (`user_role`, `order_status`, `order_type`, `payment_status`, `sync_status`, `coupon_type`); `set_updated_at()` trigger |
| 2 | `20260707120100_profiles.sql` | `profiles` (1:1 with `auth.users`); role helpers (`is_admin`, `is_staff`); signup auto-provision; RLS + column privileges |
| 3 | `20260707120200_catalog.sql` | `branches`, `categories`, `products`, `modifier_groups`, `modifiers`, `product_modifier_groups`, `branch_product_availability`; RLS |
| 4 | `20260707120300_addresses.sql` | `addresses` + customer-isolation RLS |
| 5 | `20260707120400_coupons.sql` | `coupons` (admin-only, codes hidden) + `validate_coupon()` RPC |
| 6 | `20260707120500_orders.sql` | `orders`, `order_items`, `order_item_modifiers`; order-number generator; RLS |
| 7 | `20260707120600_app_settings.sql` | `app_settings` singleton (brand + VAT + loyalty); RLS |
| 8 | `20260707120700_place_order.sql` | `place_order()` RPC — the only path that creates an order |
| 9 | `20260707120800_loyalty.sql` | `place_order()` gains `p_loyalty_points` (server-side earn + redeem); `adjust_loyalty_points()` admin RPC |
| 10 | `20260707120900_loyalty_audit.sql` | `orders.loyalty_points_earned/_redeemed/_awarded_at`; `loyalty_transactions` ledger (idempotency + reconciling `balance_after`); `place_order`/`adjust_loyalty_points` write the ledger under a row lock |
| 11 | `20260707121000_integration_settings.sql` | `integration_settings` (secrets hidden; no client grants) + admin-only `list_/upsert_integration_settings()` RPCs (return `has_secret` only) |
| 12 | `20260707121100_realtime_orders.sql` | Adds `orders` to the `supabase_realtime` publication (guarded no-op off Supabase) for the admin live console |
| 13 | `20260707121200_perf_indexes.sql` | High-traffic composite/partial indexes (orders by branch/status/customer + created_at, sync queue, Lazywait id, catalog); drops redundant single-column orders indexes |
| 14 | `20260707121300_payments_and_sync.sql` | `payment_records` + `integration_sync_logs` (staff-read RLS); service-role-only `confirm_order_payment()` + `record_order_sync()` hooks |
| 15 | `20260707121400_order_idempotency.sql` | `orders.idempotency_key` + partial unique index; `place_order` gains `p_idempotency_key` (retry-safe, no duplicate orders) |

`seed.sql` holds idempotent local demo data (catalog + coupons; no auth users).
See `docs/ARCHITECTURE.md` for the production topology, security boundary, Edge
Functions, and the high-traffic performance/monitoring/load-test plan.

## Applying

With the Supabase CLI (recommended):

```bash
supabase start          # local stack
supabase db reset       # applies all migrations + seed.sql
# or, against a linked project:
supabase db push
```

Manual (any Postgres): apply the files in `migrations/` in filename order. In a
real Supabase project the `auth` schema, `auth.uid()`, and the `anon` /
`authenticated` roles already exist; a local non-Supabase Postgres needs a small
shim for those.

## Access model (RLS summary)

| Table | anon | customer | accountant | admin |
|-------|------|----------|-----------|-------|
| branches / categories / products / modifiers | read (active) | read (active) | read (all) | read+write |
| product_modifier_groups / branch_product_availability | read | read | read | read+write |
| app_settings | read | read | read | read+write |
| profiles | — | own row (name/phone/email only) | read all | read all + role mgmt |
| addresses | — | own CRUD | read all | read all |
| coupons | — | — (validate via RPC) | — | read+write |
| orders / order_items / order_item_modifiers | — | read own | read all | read all + status update |
| loyalty_transactions | — | read own | read all | read all (writes only via RPC) |
| integration_settings | — | — | — (no access) | manage via RPC only (secrets never returned) |

Key guarantees (all verified):
- **Customer isolation** — a customer sees only their own orders and addresses.
- **No fake payments / no client-set totals** — orders are created **only** via
  `place_order()`, which recomputes subtotal, modifiers, delivery fee, coupon,
  and VAT server-side and leaves `payment_status = 'pending'`.
- **No privilege escalation** — customers can't change their own `role` or
  `loyalty_points` directly (column-level grants), and can't create/cancel orders.
- **Coupon codes are secret** — never client-readable; checked via
  `validate_coupon()`.
- **Loyalty is server-authoritative + audited** — points are earned and redeemed
  only inside `place_order()` (validated against the real balance under a
  `FOR UPDATE` lock + the `min_points_to_redeem` threshold, discount capped to
  the order), and adjusted by admins only via `adjust_loyalty_points()`. Both
  are the only sanctioned way to write the client-hidden `loyalty_points` column,
  and both append a reconciling `loyalty_transactions` row (a partial unique
  index blocks a second `earn` for the same order).
- **Integration secrets never reach the client** — `integration_settings` has
  all client grants revoked; admins manage it only through the SECURITY DEFINER
  `list_/upsert_integration_settings()` RPCs, which return a `has_secret` flag
  instead of `secret_config`. Server-side code (Edge Functions / service role)
  reads the secret. Accountants and customers get `42501`.

## Bootstrapping the first admin

New users default to `role = 'customer'`. Promote a user to admin/accountant via
the SQL editor / service role (never from the client):

```sql
update public.profiles set role = 'admin' where id = '<auth-user-uuid>';
```

## Deliberately NOT included yet

> Note: `integration_settings` now provides **secure config storage** for the
> payment / SMS / push / Lazywait providers (admin-managed, secrets server-only).
> The actual third-party calls below are still NOT implemented.

- Payment charge/capture, webhooks, and payment status transitions (only the
  provider config is stored).
- SMS/OTP send + phone-auth wiring (only the provider config is stored).
- Push notification send (only the provider config is stored).
- Lazywait Create-Order client, sync worker, and sync logs (only the provider
  config is stored; the `orders.sync_status` / `lazywait_*` columns are reserved
  placeholders).
- Store-credit wallet + voucher redemption (the mobile Wallet's points→credit
  conversion has no backing table yet; those actions stay disabled).
- Staff-management RPC (role changes are done via service role for now).
- Storage buckets/policies for product images.

## Verification performed

- All 8 migrations apply cleanly, then apply a **second time with no errors**
  (idempotent).
- Role simulation confirmed: customer places an order via `place_order` with
  correct server-computed totals (`54.00` subtotal, `SAVE10` → `5.40` off,
  inclusive VAT `6.34`, total `48.60`, payment `pending`); customer isolation,
  admin-only status updates, accountant read-only, anon restrictions, and
  privilege-escalation blocks all behaved as designed.
