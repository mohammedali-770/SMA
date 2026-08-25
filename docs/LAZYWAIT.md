# Spicy Meal — Lazywait POS Integration

Server-side order sync to the **Lazywait POS**. The POS this integration talks
to is the **dev host `https://apiv2-dev.lazywait.com/v1`** — see "Which host is
live" below; it is the real POS for this branch, not a staging convenience.
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

## Which host is live — read before changing `base_url`
**The live POS is the DEV host** (`https://apiv2-dev.lazywait.com/v1`). Confirmed
by the owner on **2026-08-24** and matching the live
`integration_settings.public_config.base_url` in Production, last written
2026-07-24. Every pickup order that has synced went there.

Two things in source still name the **production** host and are now traps:

- `DEFAULT_BASE_URL` (`supabase/functions/_shared/lazywait.ts`) is
  `https://apiv2.lazywait.com/v1`. It is only a **fallback** — the worker prefers
  `public_config.base_url` — but if that key were ever cleared, the worker would
  silently start POSTing real customer orders to a POS nobody watches. It is
  deliberately left unchanged here; changing it is a separate decision.
- The admin Integrations card shows the production URL as its input
  **placeholder** (`src/components/admin/IntegrationCard.tsx`), which is how the
  wrong host could get typed back in.

The `20260708130000` migration also seeds the production URL as a default. That
file is applied history and must never be edited; the live row overrides it.

## Configuration (never committed)
Set with the admin **Lazywait POS** card, or via SQL (service role / SQL editor):
```sql
select public.upsert_integration_settings(
  'lazywait', 'lazywait', true,
  -- public_config (non-secret): base URL + client id
  -- base_url is the DEV host — that is the live POS (see "Which host is live")
  '{"base_url":"https://apiv2-dev.lazywait.com/v1","client_id":"<CLIENT_ID>"}'::jsonb,
  -- secret_config (server-only): API token + webhook secret (+ optional cron gate)
  '{"api_token":"lw_live_…","webhook_secret":"whsec_…","sync_trigger_secret":"…"}'::jsonb
);
```

## Menu structure — three levels, not two

Lazywait models a menu as:

```
category  ->  item  ->  price      (a NAMED tier carrying its own price_id)
```

"Chicken Wings" is ONE item with two prices (Small 7.00, Large 13.00). "Coral"
is one item with **eleven**, from 20.00 to 29.00. The local schema mirrors that
exactly since `20260824120000_product_variants`:

| Lazywait | Local |
|---|---|
| category | `categories` |
| item | `products` |
| **price** | **`product_variants`** |

`products.price` is still a VAT-inclusive price and still means what it always
did — but for a product WITH tiers it is the **cheapest orderable tier**, i.e.
the "from" price a menu card shows. The line is priced from the chosen
`product_variants` row. A product with no tiers behaves exactly as it did
before variants existed.

**Why this level is not optional.** `order_items[].price_id` is how the POS
knows which tier was sold. Before variants it came from a single column on
`products`, so every Coral ever synced would have claimed to be the same tier —
the right money, the wrong food. `order_items.variant_id` now records the tier
and `ORDER_ITEM_SELECT` reads its price id.

## Mapping (external ids)
Columns added by `20260708130000_lazywait_integration`; the pull/confirm flow by
`20260708150000_lazywait_catalog_mapping`; the price tier by
`20260824120000_product_variants`. All confirmed by an admin in the UI:
| Local column | Lazywait field | Catalog endpoint |
|---|---|---|
| `branches.lazywait_branch_id` | `branch_id` | `GET /platform/branches` |
| `categories.lazywait_category_id` | `category_id` | `GET /menu/products/categories` |
| `products.lazywait_item_id` | `menu_item_id` | `GET /menu/products/items` |
| `products.lazywait_price_id` + `lazywait_price_ref` | the CHEAPEST tier's `price_id` + snapshot (a fallback for an untiered line; the ordered tier wins) | `GET /menu/products/items` |
| **`product_variants.lazywait_price_id`** + `lazywait_price_ref` | **`price_id`** + price snapshot — **this is what Create Order sends** | `GET /menu/products/items` |
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
   local names or the local price. `entity` accepts `variant` as well as
   `branch` / `category` / `product` / `modifier_group` / `modifier`.
   `clear_lazywait_mapping(entity, local_id)` removes a mapping. Accountants can
   view the mapping tables + status but the RPCs reject them (42501).
4. **Import (admin-only RPC):** `import_lazywait_catalog()` writes the local
   menu from the cache — one product per item, one `product_variants` row per
   price. "Replace" semantics: anything absent from the latest pull is
   DEACTIVATED, never deleted, so order-history FKs survive.

### What the pull actually returns, and the bug it hid

These are contract facts confirmed against Production on 2026-08-24, not
assumptions. They are written down because getting them wrong is what kept the
menu out of the app entirely.

- **The money is in a plain `price` key, and it EXCLUDES VAT.** A price row
  looks like `{price_id, names:{en,ar}, price, active, show_online, calories}`.
  Items authored in the Lazywait dashboard ALSO send `price_with_vat`; items
  uploaded from a spreadsheet do not. Across all 21 dashboard-authored rows
  `price_with_vat === price × 1.15` exactly, and the customer-facing menu price
  of a spreadsheet row is likewise `price × 1.15` (`6.086956521739131` → 7.00).
  The importer therefore grosses `price_excl_vat` up using
  `app_settings.vat_percentage`, and uses `price_with_vat` verbatim when
  Lazywait states one. **The VAT rate is never hardcoded in the parser.**
- **An item names its category `menu_category_id`**, not `category_id`.
- **The description is `details{en,ar}`**, the same shape as `names`.
- **`show_online: false` means POS-only** and appears at all three levels. It is
  inherited downwards: a hidden category hides its items. In Production this is
  what keeps the "Offers" category, "Extra Bread", "Ranch Sauce" and the "Change
  to Wedgez" upgrade off the customer menu.

**The failure this explains.** `extractPrices()` used to look only for
`price_with_vat` / `price_excluding_vat` / `net_price`. None of those exist on a
spreadsheet-sourced item, so all 126 such Production price rows normalized to
`{price_with_vat: null, price_excl_vat: null}`; `import_lazywait_catalog()` then
read 0, and `v_active := ... and v_price > 0` made every product inactive at
price 0. The pull had been succeeding for months — 61 items, 6 categories, no
errors — and the app still had **zero products**. A green pull log is not
evidence that the menu imported; check `products` count.

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
3. Per order: load branch mapping + items via `ORDER_ITEM_SELECT` — the
   server-trusted snapshots (`name_en`, `name_ar`, `note`, qty, `unit_price`)
   joined to `products.lazywait_item_id` / `lazywait_price_id`, the product's
   `categories.lazywait_category_id`, and `order_item_modifiers` joined to
   `modifiers.lazywait_addon_id` — map them with `mapOrderItemRows`, read the
   stored CRM link and optionally refresh it by phone, then
   `buildCreateOrderPayload` (pickup-only, validates mapping).
4. `POST /pos/orders/create`; on success save `order_ref`→`lazywait_ref`,
   `order_id`, `order_number`, `order_status_id`→`lazywait_status`, mark
   `synced`; on failure classify + retry/block/dead-letter. Every attempt writes
   an `integration_sync_logs` row via `record_lazywait_sync`.

### Create Order payload (only CONFIRMED fields)
The owner supplied the vendor Create Order contract on **2026-08-24**, read from
`apiv2-dev.lazywait.com` — **the same host this integration actually posts to**,
so it describes the endpoint we use rather than a different environment's. (An
earlier revision of this section claimed we post to production and called
dev-vs-prod parity unverified; that was wrong — it read `DEFAULT_BASE_URL`
instead of the live config row.) Field-by-field state:
`docs/integrations/Lazywait_API_Reference.md`.

```json
{ "client_id": "…", "branch_id": "<lazywait_branch_id>", "order_type": "pickup",
  "order_items": [{
    "menu_item_id": "<lazywait_item_id>", "name": "<server name>",
    "names": { "en": "Beef Burger", "ar": "برجر لحم" },
    "quantity": 2, "price": 25.00,
    "menu_category_id": "<lazywait_category_id>", "price_id": "<lazywait_price_id>",
    "details": "No onions",
    "addons": [{ "addon_id": "<lazywait_addon_id>", "name": "Extra Cheese",
                 "names": { "en": "Extra Cheese", "ar": "جبن إضافي" },
                 "quantity": 1, "price": 5.00 }]
  }],
  "customer_name": "<profile.full_name|Guest>",
  "customer_id": "<profiles.lazywait_customer_id>",
  "customer_cell": "541234567", "country_code": "+966",
  "order_details": "<orders.notes>", "source": "LWAPI" }
```
- `price` is the **server-trusted, VAT-inclusive** item price with the **mapped**
  add-on money subtracted back out. `order_items.unit_price` already includes
  every selected modifier (`place_order` adds them in) and the contract sums
  add-on prices into the order, so sending both un-decomposed would charge
  add-ons twice. The invariant
  `price + Σ(mapped addon.price × addon.quantity) === unit_price` is pinned by
  `lazywait.test.ts`. An **unmapped** modifier is never subtracted, so its money
  stays inside `price` — the ticket implies exactly what the customer was
  charged either way. The Lazywait response total is still **ignored** (test
  returned 0).
- `price_id` is the **ordered tier's** id — `product_variants.lazywait_price_id`
  reached through `order_items.variant_id`, falling back to
  `products.lazywait_price_id` for a line with no tier (an untiered product, or
  any order placed before variants existed). Reading it from `products` alone,
  as the worker used to, names the CHEAPEST tier on every line: a customer's
  Large would reach the kitchen as a Small. Pinned by `lazywait.test.ts`.
- `details` carries the line's kitchen note **and** any modifier we cannot map
  (see below): `"Volcano ×2, حار — No onions"` — choices joined by `, `, then the
  note after an em dash. Either half is emitted alone, and the key is **omitted
  entirely** when there is neither — never sent as null.
- `customer_cell` is the **local subscriber number**; the dialling prefix travels
  separately in `country_code`. E.164 is never sent in `customer_cell`. A number
  we cannot split confidently (non-Saudi, unparseable) sends **neither** field.
- **No totals are sent** — not `subtotal`, `tax`, `total` or
  `order_delivery_fee`. The contract's example adds tax on top of the item
  prices; ours are VAT-inclusive, and the document does not say what the POS does
  when the tax fields are absent. Open question **Q9**.
- **`is_paid` is supported but not wired.** It is a confirmed field, but telling
  a cashier an order needs no cash is a financial signal and payment work is
  frozen (CLAUDE.md §6). Wiring it is a separate owner decision.

### Unmapped modifiers — folded into `details`, never dropped, never re-priced
Only a modifier carrying a `modifiers.lazywait_addon_id` can become a contract
`addons[]` entry. A modifier without one is written into the item's `details`
text and its money is **left inside `price`**, which is exactly where
`place_order` put it (`v_unit_price := product.price + Σ modifier.price`).

That reproduces what the pre-contract worker sent — it emitted `price =
unit_price` and no add-ons at all — so neither the kitchen nor the till sees a
change for an unmapped modifier: the choice is on the ticket in text, and the
line is charged what the customer paid. Pinned by `lazywait.test.ts`, including
the mixed case where one line carries a mapped **and** an unmapped modifier.

**This replaces the `missing_addon_mapping` block introduced by PR #246**, which
refused the whole order instead. The two objections that justified blocking —
the choice would be hidden from the kitchen, and the line would be undercharged
— are both answered by the fold, and neither applies to it. Blocking cost more
than it bought: it is only recoverable if a mapping exists to add, and here none
does.

**There is nothing to map heat level to.** The check was run read-only against
Production the day the payload change merged (`536a6cb`):

| Entity | Total | Mapped | Active unmapped |
|---|---|---|---|
| `modifiers.lazywait_addon_id` | 3 | **0** | **3** |
| `products.lazywait_item_id` | 70 | 65 | 0 |
| `products.lazywait_price_id` | 70 | 65 | 0 |
| `categories.lazywait_category_id` | 9 | 6 | 0 |

Every active product, price and category is mapped. **No modifier is.** All three
— Mild, Hot, Volcano (+2) — are active, sit in one "Heat Level" group and are
offered by two active products. Lazywait's own catalog has no heat-level add-on
in either language: two independent pulls (2026-07-23, 27 add-ons; 2026-08-24,
10 add-ons) searched across every mirrored row returned zero matches for
`mild|hot|spic|volcano|heat|level|chilli|flame` or
`حار|حرا|نار|بركان|درجة`. Their add-ons are juices, drinks, cheese, salad items
and wedges. Our three modifiers are local rows that never had a POS counterpart,
which is why the catalog import left them null.

So the earlier instruction to "check `lazywait_mapping_status()` before
deploying, and hold if any modifier is unmapped" is **obsolete** — that
precondition can never be met by mapping alone, and the deploy no longer depends
on it. `lazywait_mapping_status()` (staff role required) and the admin
**Lazywait catalog mapping** card remain the right way to check *item*, *price*
and *category* mappings, which do still block.

Creating the three add-ons in the Lazywait catalog and mapping them is still the
only way to get heat level onto the ticket as a **structured, separately priced**
add-on rather than as text. That remains an owner decision
(`docs/OWNER_ACTIONS.md` §17) — it is now an improvement, not a prerequisite.

**Deployment status.** All of this is repository code. The live `lazywait-sync`
Edge Function is still the July build, which sends no add-ons at all. Deploying
is a separate owner action under CLAUDE.md §5.

### Intentionally NOT sent (schemas unconfirmed — do not invent)
Delivery address/fields, `latitude`/`longitude` (the contract has **no**
coordinate field), the `order_deliveries[]` element shape, and every money field
(Q9). Delivery orders are **blocked** (not synced) until Lazywait confirms the
schema — unchanged by the 2026-08-24 contract, which documents a pickup order.

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

## Typed API v2 client (all 27 endpoints — additive, not yet wired live)
`supabase/functions/_shared/lazywaitApi.ts` (partial issue #104) is a PURE,
fully-typed layer over `lazywaitFetch` covering **all 27** documented endpoints
(POS orders, menu products/categories, addons/groups, branches). For each: an
explicit request interface, a pure serializer, an explicit response interface,
and a hand-rolled runtime validator. It preserves the exact documented casing
(`Trans_Amount`, `Approval_No`, `Card_Type`, `Card_Number`, `transaction_uuid`,
`cancelation_reason`; addon `alert_level` numeric + `consumption` object; group
`auto_selected_addons` / `included_custom_addons_ids` string arrays), applies
menu pagination only when BOTH `offset` and `limit` are given, treats
`order_items` on update as a full replacement, and parses the plain-text `ok`
product/category DELETE as a typed success. `redactLazywait()` scrubs
token/Bearer, customer phone/email, and card fields from any log/error.

The reference scaffold + the field-casing table + the assumptions to confirm are
in `docs/integrations/Lazywait_API_Reference.md` (the verbatim vendor reference
is owner-supplied and replaces it once provided).

- **Create Order** produces the confirmed body from the single audited builder
  in `lazywait.ts`; `serializeCreateOrder` calls it and then adds only the
  **delivery** assumptions, which are assembled ONLY when the caller passes
  `allowAssumedFields: true` (default OFF). Because the confirmed body has one
  source, the typed client cannot drift from the worker's payload — a test
  asserts the two are equal. The live `lazywait-sync` worker is pickup-only and
  delivery stays blocked. Remaining assumed field names are in the reference
  doc's "STILL ASSUMED" section.
- **Payment endpoints** (`update-cash-payment`, `update-online-payment`) are
  typed/serialized/validated only; live wiring stays **frozen** (CLAUDE.md §6).
- The client never re-POSTs Create Order once an `order_ref` exists and never
  reports a false success (reuses `shouldResendCreateOrder` +
  `classifyCreateOrderResult`).

## Testing
`supabase/functions/_shared/lazywait.test.ts` (Vitest) covers: Create Order
payload mapping (the full confirmed body — names/details/price_id/
menu_category_id/addons, the phone split, the add-on price decomposition, and
`details` being absent rather than null when a line has no note), the
`order_items` join via `mapOrderItemRows` (including an unmapped modifier being
folded into `details` with its money left in `price`, rather than blocking the
order or vanishing), `composeItemDetails` on its own,
delivery/missing-branch/missing-item blocking, price rounding,
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
rows being dropped. `supabase/functions/_shared/lazywaitApi.test.ts` (with
synthetic, PII-free fixtures under `__fixtures__/lazywait/`) covers the typed v2
client: request serialization + exact field casing for all 27 endpoints, menu
pagination (both-or-neither), the confirmed pickup vs gated delivery/add-on
Create Order body (assumed fields absent by default, present only under
`allowAssumedFields`, server-owned identity fields never emitted), catalog/order
response parsing incl. Arabic/English names and unknown/deactivated branches, the
plain-text `ok` delete, redaction of token/phone/email/card, timeout+error
mapping, create-order duplicate prevention / no-false-success, and a guard that
no Lazywait secret or server client is importable from `src/**` or
`apps/mobile/**`.

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
- **No stock/86/snooze endpoint exists.** Corrected 2026-08-20: this line
  previously said stock auto-sync was "prepared (webhook + endpoint)", which
  overstated the code. The typed v2 client covers POS orders, menu
  products/categories, addons/groups and branches — there is no stock or
  availability endpoint among them, none is documented in
  `docs/integrations/Lazywait_API_Reference.md`, and `lazywait-webhook` only maps
  `order_ref` → `lazywait_status`. Nothing reads or writes
  `branch_product_availability` from the Lazywait side. Item availability is
  therefore maintained by staff in the branch-operations console, not synced.
- If Lazywait later exposes stock reads/events, note that an empty response means
  **unknown**, not "everything is out of stock" — a naive sync would 86 the whole
  menu, so any such sync must be additive. The planned availability tables carry a
  `source` column for exactly this reason, so a POS sync can write the same rows
  without fighting a manual closure.
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
