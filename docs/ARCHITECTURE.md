# Spicy Meal — Production Architecture (16 branches, high traffic)

## 1. Topology (text diagram)

```
 ┌──────────────────────┐        ┌──────────────────────┐
 │  Expo mobile app      │        │  Admin dashboard      │
 │  (customer)           │        │  (admin / accountant) │
 │  holds ANON key only  │        │  holds ANON key only  │
 └──────────┬───────────┘        └───────────┬──────────┘
            │  HTTPS (anon key + user JWT)    │
            ▼                                 ▼
      ┌───────────────────────────────────────────────┐
      │                 SUPABASE                        │
      │                                                 │
      │  GoTrue (Auth)   PostgREST (REST + RLS)         │
      │        │               │                        │
      │        │               ├── RPCs (source of truth)│
      │        │               │    place_order,         │
      │        │               │    validate_coupon,     │
      │        │               │    adjust_loyalty_points,│
      │        │               │    list/upsert_integration│
      │        ▼               ▼                        │
      │  ┌───────────────────────────────────────────┐  │
      │  │ Postgres 15/16 + RLS                       │  │
      │  │  profiles, branches, catalog, orders,      │  │
      │  │  order_items, coupons, app_settings,       │  │
      │  │  loyalty_transactions, payment_records,    │  │
      │  │  integration_settings (secrets), sync_logs │  │
      │  └───────────────────────────────────────────┘  │
      │        ▲                          ▲              │
      │        │ service role (secrets)   │ Realtime     │
      │  ┌─────┴───────────────────┐      │ (orders)     │
      │  │ Edge Functions (Deno)    │      │              │
      │  │  order-intake            │◀─────┘  admin live  │
      │  │  payment-webhook  ───────┼──▶ confirm_order_payment
      │  │  lazywait-sync    ───────┼──▶ record_order_sync
      │  │  push-dispatch           │                     │
      │  └──────────┬───────────────┘                     │
      └─────────────┼───────────────────────────────────┘
                    │ server-side only (secrets never leave here)
                    ▼
      Payment gateway · SMS provider · Push provider · Lazywait POS
```

## 2. What calls what (current)

- **App & Admin → PostgREST/RPC/GoTrue** with the anon key + the signed-in
  user's JWT. RLS is the security boundary. No secret ever reaches a client.
- **Source of truth = RPCs** — `place_order` computes subtotal, modifiers,
  delivery fee, coupon, VAT and loyalty **server-side**; coupons via
  `validate_coupon`; loyalty via `adjust_loyalty_points`; integrations via
  `list/upsert_integration_settings` (returns `has_secret`, never the secret).
- **Admin live orders** — Supabase Realtime on `orders` with a 12s polling
  fallback + 60s backstop (see `AppContext` live-orders effect).
- **Edge Functions** are the server-side boundary for anything with a secret or
  an external call. They read secrets from `integration_settings` via the
  service role and call the service-role-only RPCs (`confirm_order_payment`,
  `record_order_sync`). None are implemented against a real provider yet.

## 3. Security boundary (invariants)

- The Expo app / Admin never call a payment/SMS/push/Lazywait API directly.
- Secrets live in `integration_settings.secret_config`; the table has **all
  client grants revoked**. Admin manages it only through admin-only RPCs that
  return `has_secret` (boolean), never the value. Server code reads the secret
  via the service role inside Edge Functions.
- Orders are marked **paid** only by `confirm_order_payment` (service-role only,
  after a verified webhook, amount must equal the server total). Orders are
  marked **synced** only by `record_order_sync` (service-role only). Clients
  cannot execute either.
- `place_order` is the only order-creation path and rejects unauthenticated
  callers, closed/unknown branches, unavailable products, invalid modifiers, and
  below-minimum delivery orders — all server-side.

## 4. Order flow (hardened)

1. Customer must be authenticated (`auth.uid()` required).
2. Branch selected manually and must be `is_active` (server re-checks).
3. Order type (`delivery`/`pickup`) required.
4. Products re-validated for the branch (`branch_product_availability`).
5. Prices, modifiers, coupon, VAT and delivery fee **recomputed server-side**.
6. Payment stays `pending`; nothing is faked. Future: `payment-webhook` →
   `confirm_order_payment`.
7. **Idempotency**: an optional `p_idempotency_key` makes a retried checkout
   return the same order instead of duplicating it (a partial unique index on
   `orders(customer_id, idempotency_key)` guards the race). The app sends a
   per-checkout key that resets when the cart changes.
8. Future hook: `lazywait-sync` / `record_order_sync` push the order to POS.

## 5. Indexes (rationale)

Composite/partial indexes added for the hot paths (`20260707121200_perf_indexes`):
- `orders(branch_id, created_at desc)` — per-branch board (×16 branches).
- `orders(status, created_at desc)` — status filter + KPIs.
- `orders(customer_id, created_at desc)` — customer history + RLS.
- `orders(created_at) where sync_status in ('not_synced','failed')` — sync queue.
- `orders(lazywait_order_id) where … not null` — webhook → order mapping.
- `products(is_active, sort_order)`, `categories(is_active, sort_order)` — menu.
- Redundant single-column `orders` indexes dropped (they were prefixes of the
  composites → fewer indexes = cheaper writes on the busiest table).
- Already optimal (no index added): `branch_product_availability` (PK
  branch/product), `product_modifier_groups` (PK product/group), `coupons.code`
  (UNIQUE), `order_items(order_id)`, `loyalty_transactions`.

> On an already-large production table, create new indexes with `CREATE INDEX
> CONCURRENTLY` (outside a transaction) to avoid a write lock.

## 6. Performance & scalability

- **Catalog caching** — the menu (branches/categories/products/modifiers/
  availability/settings) changes rarely and is read on every app open. Cache it:
  client-side with a short TTL (e.g. 5 min) or a CDN/edge cache in front of the
  read endpoints. Avoid re-fetching the whole catalog per screen. Consider a
  single `get_menu(branch_id)` RPC later to return the branch-scoped menu in one
  round trip.
- **Connection pooling** — use Supabase's **transaction pooler (PgBouncer, port
  6543)** for serverless/Edge/high-concurrency clients; keep the direct
  connection (5432) for migrations only.
- **Realtime** — subscribe only `orders` for staff (already done). Do **not**
  broadcast catalog or customer tables. Each branch dashboard is one channel;
  16 branches ≈ tens of channels — well within limits. The polling fallback
  (12s) caps DB load if Realtime is unavailable.
- **Compute** — start at Small/Medium; watch CPU + connection count under load
  and scale compute before adding complexity. Add read replicas only if
  reporting queries start competing with the live order path.

## 7. Monitoring & reliability

- **Order failures** — `place_order` raises typed errors; surface them in the
  client and log server-side (Supabase logs / `get_logs`).
- **Payment** — every attempt is a `payment_records` row (`initiated/authorized/
  paid/failed/refunded`); the admin can list failures.
- **Lazywait sync** — every attempt is an `integration_sync_logs` row
  (`success/failed/skipped` + request/response/error); `orders.sync_status`
  reflects the latest state. Add an admin "failed sync / failed payment" view.
- **Advisors** — run Supabase `get_advisors` (security + performance) before
  launch and after each migration.

## 8. Load-test plan (before launch)

- Model 16 branches × peak concurrent customers (e.g. 50–200/branch at rush).
- Scenarios: browse menu (cached vs uncached), `place_order` throughput +
  p95 latency, admin boards open with Realtime, coupon spikes, loyalty redeem.
- Tools: k6 / Artillery against the REST + RPC endpoints with realistic JWTs.
- Watch: DB CPU, pooler saturation, `place_order` p95, index hit ratio,
  Realtime channel count, error rate. Tune compute/pooler, then re-test.

## 9. Deploy & test commands

```bash
# DB migrations (CLI, against a linked project)
# NOTE: do NOT run `supabase db push` against the live project until the
# migration-history reconciliation task is completed — the live
# schema_migrations history was recorded with different version stamps than
# the repo files, so `db push` would try to re-apply migrations.
supabase db push
# Edge Functions
supabase functions deploy order-intake payment-webhook lazywait-sync \
  push-dispatch
# Advisors
#   (MCP) get_advisors type=security ; get_advisors type=performance
# Frontend build
npm run lint && npm test && npm run build
```

## 10. Known limitations / decisions still needed

- No real payment gateway, SMS/OTP, push, or Lazywait Create-Order (awaiting API
  docs) — only secure architecture + placeholders.
- The current client is a **web SPA** (mobile emulator), not yet a native Expo
  app; the security model is identical for a future Expo client (anon key + RLS
  + Edge Functions for secrets).
- Realtime authorization on a real Supabase project must be enabled; the polling
  fallback covers the gap.

## 11. Recommended next task

Choose the payment provider and implement `payment-webhook` end-to-end
(signature verification → `confirm_order_payment`), since verified paid ordering
is the largest remaining gap for going live.
