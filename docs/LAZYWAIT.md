# Spicy Meal — Lazywait POS Integration

Server-side order sync to the **Lazywait POS** (`https://apiv2.lazywait.com/v1`).
Supabase / `place_order` stays the **source of truth** for order creation,
pricing, VAT, coupon, loyalty and order state. Lazywait is a sync **destination**
only — a Lazywait failure NEVER blocks or alters a customer order.

## Security model
- The Lazywait **API token** and **webhook secret** live only in
  `integration_settings.secret_config` (all client grants revoked) and are read
  server-side via the service role. They never reach the Expo app or the admin
  browser (the admin UI shows *configured / not configured* only).
- The `client_id` is not a secret (it's a query param) — it may be shown in the
  admin config UI.
- All Lazywait API calls happen inside Edge Functions. Errors are sanitized
  (`Bearer ***`, truncated) before being stored/logged.
- ⚠️ **Rotate the token used during testing** before production — treat any token
  pasted into a chat/playground as compromised. Generate a fresh `lw_live_…` key
  in the Lazywait portal and store it via the admin card / SQL below.

## Configuration (never committed)
Set with the admin **Lazywait POS** card, or via SQL (service role / SQL editor):
```sql
select public.upsert_integration_settings(
  'lazywait', 'lazywait', true,
  -- public_config (non-secret): base URL + client id
  '{"base_url":"https://apiv2.lazywait.com/v1","client_id":"vAK1AmUr7Xhoa6KsYNhU"}'::jsonb,
  -- secret_config (server-only): API token + webhook secret (+ optional cron gate)
  '{"api_token":"lw_live_…","webhook_secret":"whsec_…","sync_trigger_secret":"…"}'::jsonb
);
```

## Mapping (external ids)
Columns added by `20260708130000_lazywait_integration`; the pull/confirm flow by
`20260708150000_lazywait_catalog_mapping`. All confirmed by an admin in the UI:
| Local column | Lazywait field | Catalog endpoint |
|---|---|---|
| `branches.lazywait_branch_id` | `branch_id` | `GET /platform/branches` |
| `categories.lazywait_category_id` | `category_id` | `GET /menu/products/categories` |
| `products.lazywait_item_id` | `menu_item_id` | `GET /menu/products/items` |
| `products.lazywait_price_id` + `lazywait_price_ref` | `price_id` + price snapshot (**reference only, NOT sent in Create Order**) | `GET /menu/products/items` |
| `modifier_groups.lazywait_group_id` | `addons_group_id` | `GET /menu/addons-groups` |
| `modifiers.lazywait_addon_id` | `addon_id` | `GET /menu/addons` |
| `profiles.lazywait_customer_id` | CRM `id` (matched by phone) | set automatically on CRM match |

### Catalog pull → suggest → confirm
1. **Pull (server-side):** the `lazywait-catalog` Edge Function (admin-only,
   `verify_jwt` + `is_admin()`) fetches the five endpoints with the server-held
   token and upserts normalized records into `lazywait_catalog_items`
   (staff-readable cache; only names/ids/prices/raw — **no secret**). Each run
   logs a `lazywait_catalog_pulls` row (last sync time + sanitized per-endpoint
   errors); records removed from Lazywait are pruned on the next successful pull.
   Parsing is **defensive**: handles en/ar/Turkish-only names, multi-price items,
   `branches_ids`, and null addon prices / null group min/max/multi safely.
2. **Suggest (client-side, pure):** `src/lib/lazywaitMatch.ts` normalizes names
   (Arabic alef/hamza/taa-marbuta/tashkeel, Latin diacritics, Turkish letters)
   and scores each local record against the pulled candidates →
   `high | medium | low | none`. Anything below `high` is flagged **review**.
3. **Confirm (admin-only RPC):** `set_lazywait_mapping(entity, local_id,
   lazywait_id, price_ref?)` writes **only** the id column(s) — it never touches
   local names or the local price. `clear_lazywait_mapping(entity, local_id)`
   removes a mapping. Accountants can view the mapping tables + status but the
   RPCs reject them (42501).

`lazywait_mapping_status()` (staff) returns mapped/total per entity, the count of
orders blocked on missing mapping, a **`secrets_configured` boolean** (computed
server-side — the token is never returned), and a pickup-sync **readiness**
checklist (secrets configured · ≥1 branch mapped · all active products mapped ·
no blocked orders).

## Order sync flow
1. `place_order` creates the local order (`payment_status='pending'`). A BEFORE
   INSERT trigger sets `lazywait_sync_state='pending'` for **pickup**, or
   `'blocked'` (`delivery_schema_unconfirmed`) for **delivery**.
2. `lazywait-sync` (cron/scheduled) calls `claim_lazywait_sync_batch(N)` —
   `FOR UPDATE SKIP LOCKED` so concurrent workers never double-send — flipping
   claimed rows to `'syncing'`.
3. Per order: load branch mapping + items + `products.lazywait_item_id`
   (server-trusted name/qty/price), optional CRM match by phone, then
   `buildCreateOrderPayload` (pickup-only, validates mapping).
4. `POST /pos/orders/create`; on success save `order_ref`→`lazywait_ref`,
   `order_id`, `order_number`, `order_status_id`→`lazywait_status`, mark
   `synced`; on failure classify + retry/block/dead-letter. Every attempt writes
   an `integration_sync_logs` row via `record_lazywait_sync`.

### Create Order payload (only CONFIRMED fields)
```json
{ "client_id": "…", "branch_id": "<lazywait_branch_id>", "order_type": "pickup",
  "order_items": [{ "menu_item_id": "<lazywait_item_id>", "name": "<server name>",
                    "quantity": 2, "price": 25.00 }],
  "customer_name": "<profile.full_name|Guest>", "source": "LWAPI" }
```
- `price` = the **server-trusted, VAT-inclusive** unit price (KSA prices are
  VAT-inclusive). The Lazywait response total is **ignored** (test returned 0).

### Intentionally NOT sent (schemas unconfirmed — do not invent)
`price_id`, addons/modifiers, delivery address/fields, `customer_cell`/`customer_id`.
Delivery orders are **blocked** (not synced) until Lazywait confirms the schema.

## Retry / backoff / dead-letter
- Retryable (429, 5xx, network/timeout): `sync_attempt_count++`,
  `sync_next_attempt_at = now()+backoff` (30s→60s→…→1h, ±20% jitter; 429 honors
  `Retry-After`, delta-seconds or HTTP-date). After `MAX_SYNC_ATTEMPTS` (8) →
  `dead_letter` (off the queue).
- Terminal (401 INVALID_KEY, 403 LICENSE_EXPIRED, other 4xx, missing mapping) →
  `blocked` (no auto-retry; admin fixes config/mapping then **Retry**).
- **Ambiguous 2xx** (HTTP success but no usable `order_ref`, or `success` not
  `true`) → `blocked` (`unexpected_response` / `created_without_ref`), NOT
  retried: the POS may have created the order and Create Order has no idempotency
  key, so a blind re-send would duplicate the ticket. Admin confirms in Lazywait,
  then **Retry** or resolves manually.
- The queue index `orders_lazywait_queue_idx` pulls due `pending`/`failed` rows
  oldest-first. `requeue_lazywait_order(id)` (admin-only) resets to `pending`
  **and** clears `sync_attempt_count` so the retry gets a full attempt budget.

### Stale-'syncing' reaper (crash/timeout recovery)
`claim_lazywait_sync_batch` flips a whole batch to `syncing` up front, then the
worker processes orders one at a time. If the worker crashes / times out / is
redeployed mid-batch, a row can be left in `syncing` — which is **outside** the
queue predicate (`pending`/`failed`), the admin requeue guard, and the UI retry
set — so nothing would ever recover it.

`reap_stale_lazywait_syncs(p_timeout_minutes default 10, p_max_attempts default 8)`
(service-role) is called by the worker at the **start of every run** (before
claiming) to recover rows stuck in `syncing` past the lease timeout:
- **With a `lazywait_ref`** → `synced`. The Create Order already succeeded; we
  **never** re-POST (no idempotency key). `synced_at` is preserved/backfilled.
- **Without a ref** → `failed` with `sync_attempt_count++` and a backoff delay
  (safe to resend — no POS ticket was created), or `dead_letter` at the ceiling.

Each reaped row writes an `integration_sync_logs` row
(`recovered_stale_syncing_with_ref` / `stale_syncing_no_ref_requeued` /
`stale_syncing_no_ref_dead_letter`) so Admin sees the recovery, and the worker
returns a `reaped: {recovered_synced, requeued, dead_lettered}` summary. The
10-minute lease is comfortably longer than the worker's per-order network budget
(8s CRM + 15s Create Order), so an in-flight attempt is never reaped early. A
partial index `orders_lazywait_syncing_idx (updated_at) where lazywait_sync_state
= 'syncing'` keeps the scan cheap.

The worker also **guards before every POST**: if a claimed order already carries
a `lazywait_ref` (`shouldResendCreateOrder` → false), it finalizes as `synced`
(`already_created_no_resend`) instead of re-sending.

> **Residual duplicate risk (unavoidable without an idempotency key):** a network
> timeout that happens *after* Lazywait created the order but *before* the response
> is received leaves us with no ref, so the retry re-creates it. Mitigations above
> cover crash-after-success and ambiguous-2xx; a true lost-response-after-create
> can still duplicate until Lazywait exposes an idempotency key or a
> reconcile-by-reference lookup. Tracked in *Known limitations*.

## CRM matching
Before create, if the order has a phone, `GET /crm/customers/search` with a
normalized (E.164) phone; on match save `profiles.lazywait_customer_id`. Never
blocks the order (no match → continue). No Create-Customer endpoint is confirmed
— we don't create Lazywait customers, and `customer_id`/`customer_cell` are NOT
sent to Create Order.

## Online payment (prepared, not live)
After the Geidea webhook verifies a payment and `confirm_order_payment` marks the
local order paid, `payment-webhook` best-effort calls
`POST /pos/orders/update-online-payment` with the **server-trusted** total (only
if the order already has a `lazywait_ref`). Never called from the frontend; never
fatal. The payment gateway itself is a separate task.

## Webhook receiver (`lazywait-webhook`)
Verifies `X-LazyWait-Signature` = HMAC-SHA256 **hex** of the body with the
webhook secret (checked against the raw body AND re-serialized JSON). Invalid →
401. Reads `X-LazyWait-Event`; maps `order_ref`→local order and records
`lazywait_status` (does NOT auto-flip the customer-facing local status). Unknown
events are verified, logged, and accepted (200) — never throw.

## Admin monitoring
Admin → Settings → Integrations → **Lazywait Sync Monitor**: branch mapping
(with unmapped count), per-order sync state / POS ref / attempts / blocked-reason
/ last-error, and a **Retry** button (failed/blocked/dead-letter; delivery
excluded). Accountants can view but not edit. Secrets are never shown.

## Deployment
```bash
# 1) DB migration
supabase db push                       # applies 20260708130000_lazywait_integration
                                       #     + 20260708140000_lazywait_stale_reap
                                       #     + 20260708150000_lazywait_catalog_mapping

# 2) Edge Functions
supabase functions deploy lazywait-sync lazywait-catalog lazywait-webhook payment-webhook

# 3) Secrets (server-side; NOT committed) — via admin card or the upsert SQL above.

# 4) Schedule the worker (pg_cron example — every minute):
--   select cron.schedule('lazywait-sync','* * * * *', $$
--     select net.http_post(
--       url := 'https://<ref>.supabase.co/functions/v1/lazywait-sync',
--       headers := '{"Content-Type":"application/json","x-sync-secret":"<sync_trigger_secret>"}'::jsonb,
--       body := '{"limit":5}'::jsonb) $$);

# 5) Trigger one sync run manually:
curl -sX POST https://<ref>.supabase.co/functions/v1/lazywait-sync \
  -H 'Content-Type: application/json' -H 'x-sync-secret: <secret>' -d '{"limit":5}'

# 6) Verify: admin Lazywait Sync Monitor, or
select order_number, lazywait_sync_state, lazywait_ref, sync_last_error
  from orders where lazywait_sync_state <> 'skipped' order by created_at desc;
select * from integration_sync_logs where provider='lazywait' order by created_at desc limit 20;
```

## Testing
`supabase/functions/_shared/lazywait.test.ts` (Vitest) covers: Create Order
payload mapping, delivery/missing-branch/missing-item blocking, price rounding,
error classification (401/403 terminal, 429/5xx retryable), webhook HMAC verify
(valid/tampered/missing, cross-checked vs Node crypto), backoff, phone
normalization, the `shouldResendCreateOrder` duplicate-send guard, and
`Retry-After` parsing (delta-seconds/HTTP-date, valid `0` preserved). No real
Lazywait token is used in tests.

`src/lib/lazywaitMatch.test.ts` covers name normalization (Arabic/Latin/Turkish),
confidence scoring, and that a low-confidence match requires manual confirmation
while an exact match does not. `supabase/functions/_shared/lazywaitCatalog.test.ts`
covers defensive catalog parsing: multi-price items, null addon price/price_id,
null group min/max/multi, Turkish-only names, localized name objects, and id-less
rows being dropped.

`supabase/tests/*.sql` run against a throwaway Postgres 16 (all migrations
applied):
- `lazywait_reap_test.sql` — the stale-'syncing' reaper (young NOT reclaimed, old
  reclaimed, `synced` never reclaimed, stale-with-ref recovered without resend,
  max-attempts → `dead_letter`, idempotency, recovery logging).
- `lazywait_mapping_test.sql` — mapping RPCs write only id/price-ref columns
  (local names + prices untouched), accountant rejected 42501 on set/clear,
  `lazywait_mapping_status()` counts + readiness, and **the api_token never
  appears in the status payload**.
```bash
psql -h 127.0.0.1 -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f supabase/tests/lazywait_reap_test.sql
psql -h 127.0.0.1 -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f supabase/tests/lazywait_mapping_test.sql
```

## Known limitations (confirm with Lazywait)
- Delivery Create Order schema, addons/modifiers, `price_id`, and
  `customer_cell`/`customer_id` in Create Order are **not confirmed** → not sent.
- No Create-Customer CRM endpoint → we never create Lazywait customers.
- No documented sandbox → live end-to-end waits on a test env/creds from Lazywait.
- Stock endpoint may return `[]` (unknown ≠ out of stock); stock/86 auto-sync is
  prepared (webhook + endpoint) but not yet wired to `branch_product_availability`.
- Lazywait Loyalty is **not** used — app loyalty stays internal in Supabase.
- Lazywait response `total` is ignored; the Supabase order total is authoritative.
- Webhook URL registration method + exact event catalog are not fully confirmed.

## Recommended next task
Catalog id mapping (pull + suggest + confirm) is now implemented. Next: run a
**single-branch pickup pilot** against a Lazywait sandbox — map that branch + its
active products, place a real pickup order, confirm it creates in the POS with
the right `order_ref`, then widen to all branches. (Addons/modifiers, `price_id`,
and delivery are mapped for reference but still intentionally **not** sent in
Create Order until Lazywait confirms those schemas.)
