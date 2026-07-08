# Lazywait single-branch pickup pilot — runbook

A controlled, reversible pilot that syncs **pickup** orders from **one** local
branch (mapped to one Lazywait **test** branch) with **one or two simple
products**. Nothing else is exercised: no delivery, no addons/modifiers, no
`price_id`, no online-payment update, no cash flow, no loyalty sync. Supabase /
`place_order` stays the source of truth; Lazywait only receives the order.

> **Containment guarantee (read first).** Enabling the integration turns sync on
> for *all* new pickup orders, but the worker can only send an order whose branch
> AND every item are mapped. With just the test branch + its products mapped,
> every other order is **blocked** (`missing_branch_mapping` /
> `missing_item_mapping`) and is **never** sent to the POS. So the "single
> branch" scope is enforced by mapping, not by a per-branch switch. To avoid
> confusing real customers' orders showing as `blocked`, run the pilot on a
> branch that is not taking live orders, or in a staging project.

> **Token safety.** The token used in earlier testing is considered compromised.
> Generate a **fresh** Lazywait API token before the pilot and store it only in
> `integration_settings.secret_config` (server-side). Never commit it, never put
> it in a `VITE_` var, never paste it into the app.

---

## 0. What already exists (no new features needed for the pilot)

| Piece | Name | Notes |
|---|---|---|
| Order creation (SoT) | `place_order` RPC | pickup needs no address; `payment_status='pending'` |
| Enqueue on insert | trigger `set_orders_lazywait_initial_sync` | pickup → `pending` (queued now); delivery → `blocked` (`delivery_schema_unconfirmed`) |
| Catalog pull | Edge fn `lazywait-catalog` | admin-only (`verify_jwt` + `is_admin()`); caches to `lazywait_catalog_items` |
| Mapping RPCs | `set_lazywait_mapping` / `clear_lazywait_mapping` | admin-only; write only id/price-ref columns |
| Readiness | `lazywait_mapping_status()` | staff-only; counts + readiness + `secrets_configured` bool (no token) |
| Sync worker | Edge fn `lazywait-sync` | claims due orders (SKIP LOCKED) → `POST /pos/orders/create` (pickup) → `record_lazywait_sync` |
| Stale recovery | `reap_stale_lazywait_syncs()` | called at the start of every worker run |
| Requeue | `requeue_lazywait_order()` + admin **Retry** button | resets attempt count |
| POS status webhook | Edge fn `lazywait-webhook` | optional for the pilot (push works without it) |
| Admin UI | Settings → Integrations → **Lazywait POS** card + **Lazywait Sync Monitor** | pull, map, status/readiness, per-order state, Retry |

**Small code fixes required before the pilot: NONE.** Two operational facts to
respect (not code changes):
1. **The worker is not scheduled** — trigger `lazywait-sync` manually during the
   pilot (§2), or add a `pg_cron` schedule (§7 has the snippet).
2. **Set secrets & read readiness through the Admin UI** (admin JWT). The
   `upsert_integration_settings` / `lazywait_mapping_status` RPCs are
   `is_admin`/`is_staff`-gated and will raise `42501` in a raw SQL editor
   (no `auth.uid()`); §2 gives the direct-SQL alternatives for ops checks.

---

## 1. Pre-pilot checklist

Critical items are marked **[C]** (a NO-GO if failing). Others are strongly
recommended.

- [ ] **[C]** Lazywait API token **rotated** (fresh token; the leaked one is dead).
- [ ] **[C]** Lazywait secrets configured **server-side** (`integration_settings.secret_config.api_token`, `public_config.client_id`, `public_config.base_url`).
- [ ] **[C]** DB migrations pushed (incl. `20260708130000`, `20260708140000`, `20260708150000`).
- [ ] **[C]** `lazywait-sync` function deployed.
- [ ] **[C]** `lazywait-catalog` function deployed.
- [ ] `lazywait-webhook` function deployed (optional; only needed for POS→app status updates).
- [ ] **[C]** Catalog pulled successfully (a `lazywait_catalog_pulls` row with `status='success'` or `partial`).
- [ ] **[C]** Exactly **one** branch mapped (`branches.lazywait_branch_id` set to the Lazywait **test** branch id).
- [ ] **[C]** One or two **active** test products mapped (`products.lazywait_item_id` set); no other products need mapping for the pilot.
- [ ] **[C]** No missing `lazywait_item_id` on the test products you will order.
- [ ] **[C]** Order type used for the test is **pickup**.
- [ ] **[C]** Delivery sync verified **blocked** (a delivery order shows `lazywait_sync_state='blocked'`, reason `delivery_schema_unconfirmed`, and is NOT sent).
- [ ] Admin **Lazywait Sync Monitor** visible and loading (branch mapping, readiness, per-order state).
- [ ] **Retry** button visible on a blocked/failed test order and safe to press.
- [ ] Logs visible: `integration_sync_logs` (per-attempt) and Edge Function logs (Supabase dashboard → Functions → Logs).
- [ ] **[C]** Integration **enabled** flipped ON *after* mapping is verified (§3) and *before* the validating test order (§4) — with only the test branch/products mapped, enabling can only send the mapped test order; everything else still blocks.

---

## 2. Exact Supabase deployment commands

Run from the repo root with the Supabase CLI logged in and linked
(`supabase link --project-ref <PROJECT_REF>`).

### 2.1 Database migrations
```bash
supabase db push          # applies all migrations, incl. the 3 lazywait ones
supabase migration list   # confirm 20260708130000 / 140000 / 150000 are applied
```

### 2.2 Edge Functions
```bash
supabase functions deploy lazywait-sync lazywait-catalog lazywait-webhook
# (payment-webhook / order-intake unchanged; deploy only if not already live)
```

### 2.3 Secrets / config (server-side; NEVER committed)

**Preferred — Admin UI:** sign in as an **admin**, go to
Settings → Integrations → **Lazywait POS** card, enter:
- `base_url` = `https://apiv2.lazywait.com/v1`  (public)
- `client_id` = `<CLIENT_ID>`  (public)
- `api_token` = `<ROTATED_API_TOKEN>`  (secret)
- `webhook_secret` = `<WEBHOOK_SECRET>`  (secret; optional for pilot)
- `sync_trigger_secret` = `<SYNC_TRIGGER_SECRET>`  (secret; **REQUIRED** — the
  `lazywait-sync` worker fails closed and returns 503 until this is set, so it is
  never invocable unauthenticated)

Leave **Enabled OFF** for now (map first, enable last).

**Alternative — SQL editor (runs as superuser, bypasses the admin-gated RPC):**
```sql
update public.integration_settings
   set enabled       = false,   -- flip to true only at GO (§8)
       public_config = jsonb_build_object(
         'base_url','https://apiv2.lazywait.com/v1','client_id','<CLIENT_ID>'),
       secret_config = jsonb_build_object(
         'api_token','<ROTATED_API_TOKEN>',
         'webhook_secret','<WEBHOOK_SECRET>',
         'sync_trigger_secret','<SYNC_TRIGGER_SECRET>')
 where provider_type = 'lazywait';
```
> Do **not** use `select upsert_integration_settings(...)` in the SQL editor — it
> is `is_admin()`-gated and will raise `42501` there (no `auth.uid()`). Use the
> Admin UI or the direct `update` above.

### 2.4 Trigger one sync run (worker is not auto-scheduled)
```bash
curl -sS -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/lazywait-sync" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "x-sync-secret: <SYNC_TRIGGER_SECRET>" \
  -d '{"limit":5}'
# → {"status":"ok","claimed":N,"synced":N,"failed":0,"blocked":0,"dead_letter":0,"reaped":{...}}
# "status":"disabled" means the integration is not enabled yet (expected pre-GO).
```

### 2.5 SQL/RPC checks (ops — direct table reads, no admin JWT needed)
```sql
-- mappings in place?
select id, name_en, lazywait_branch_id from public.branches where lazywait_branch_id is not null;
select id, name_en, is_active, lazywait_item_id, lazywait_price_id
  from public.products where is_active order by name_en;

-- catalog pull happened?
select status, counts, created_at from public.lazywait_catalog_pulls order by created_at desc limit 3;
select entity_type, count(*) from public.lazywait_catalog_items group by 1;

-- per-order sync state (the pilot's main dashboard)
select order_number, order_type, lazywait_sync_state, lazywait_ref, lazywait_order_number,
       sync_attempt_count, sync_blocked_reason, sync_last_error, synced_at
  from public.orders where lazywait_sync_state <> 'skipped' order by created_at desc limit 20;

-- attempt log
select order_id, direction, status, error, created_at
  from public.integration_sync_logs where provider='lazywait' order by created_at desc limit 20;
```
> `lazywait_mapping_status()` (readiness) is `is_staff`-gated — view it in the
> Admin **Lazywait Sync Monitor**, not the raw SQL editor.

---

## 3. Exact Admin steps

Do these as a signed-in **admin** (accountants can view but every write is blocked).

1. Open **Settings → Integrations**.
2. In the **Lazywait POS** card, confirm `base_url` + `client_id` are set and the
   secret shows *configured* (never the value). (Keep **Enabled OFF** for now.)
3. In **Lazywait Sync Monitor → Catalog Mapping**, click **Pull from Lazywait**.
   Confirm "Last pull …" updates and any endpoint errors are shown (should be none).
4. **Map the branch:** on the **Branches** tab, find your local test branch, pick
   the matching Lazywait branch (suggestion is pre-highlighted; confidence shown),
   click **Confirm**. The row shows `mapped: <lazywait_branch_id>`.
5. **Map 1–2 products:** on the **Products** tab, for each test product select the
   matching Lazywait item and **Confirm**. (If the item has multiple prices, pick
   the price variant — stored for **reference only**, not sent.)
6. **Verify mapping status:** the summary shows Branches `1/…`, Products `≥1/…`,
   and **Blocked orders `0`** (before any test order).
7. **Verify sync readiness:** the readiness card shows ✓ for *≥1 branch mapped*,
   *active products mapped*, *no blocked orders*. *Secrets configured* turns green
   only once **Enabled** is ON — so once mapping looks right, flip **Enabled ON**
   in the Lazywait POS card. With only the test branch/products mapped this is
   safe (unmapped orders still block). The card then reads **READY**, and you can
   run the §4 test order.

---

## 4. Exact customer app test steps

Use the web app (or Expo build) as a **customer**. Before starting, confirm the
integration is **Enabled ON** (§3.7) — required for the worker to process, and
safe because only the mapped test branch/products can be sent.

1. **Sign in** as a customer (create a test customer if needed).
2. **Select the mapped branch** (the one you mapped in §3.4).
3. Choose **Pickup** as the order type.
4. **Add a mapped product** to the cart (one of the §3.5 items), quantity 1–2.
5. **Place the order.** `place_order` creates it locally (`payment_status='pending'`).
6. **Verify the local receipt** shows the order number, branch, pickup, item, total.
7. **Admin → Live Orders:** the order appears with status `received`.
8. **Admin → Lazywait Sync Monitor → Recent Order Sync:** the order shows
   `pending` (queued). **Trigger a sync run** (§2.4) — or wait for the schedule.
9. Refresh: state should become **`synced`** with a **POS ref / #** shown.
10. **Verify in the Lazywait POS:** the order appears at the test branch as a
    pickup ticket with the correct item(s), quantity, and server-trusted price.

> The test order is intentionally **unpaid** (no gateway, no cash). The order is
> still transmitted to the POS at creation; the online-payment update call is
> **not** triggered (it only fires after a verified Geidea payment, which the
> pilot doesn't use).

---

## 5. Expected successful result

- Local order created by `place_order` (`status='received'`, `payment_status='pending'`).
- Order enqueued: `lazywait_sync_state='pending'`, `sync_next_attempt_at≈now()`.
- Worker processes it on the next run.
- `lazywait_ref` (POS `order_ref`) saved on the order.
- `lazywait_order_number` saved (e.g. `#1`).
- `lazywait_sync_state='synced'` (and legacy `sync_status='synced'`).
- `synced_at` set; `sync_last_error` null; `sync_attempt_count` unchanged/low.
- `integration_sync_logs` has a `direction='push'`, `status='success'` row for the order.
- The order is visible in the **Lazywait POS** at the test branch (pickup).

Quick confirm:
```sql
select order_number, lazywait_sync_state, lazywait_ref, lazywait_order_number, synced_at
  from public.orders order by created_at desc limit 1;
select status, error from public.integration_sync_logs
  where provider='lazywait' order by created_at desc limit 1;   -- expect status='success'
```

---

## 6. Failure cases to verify (all should fail *safely*)

| # | Induce | Expected safe behavior |
|---|---|---|
| 1 | **Missing branch mapping** — clear the branch mapping, place a pickup order | `lazywait_sync_state='blocked'`, `sync_blocked_reason='missing_branch_mapping'`; **not** sent; a `skipped` sync log; local order unaffected |
| 2 | **Missing product mapping** — order a product with no `lazywait_item_id` | `blocked`, `sync_blocked_reason='missing_item_mapping'`; not sent |
| 3 | **Delivery order** — place a delivery order | `blocked`, `delivery_schema_unconfirmed` at insert; never sent |
| 4 | **Auth failure** — set an invalid `api_token`, trigger a run | order → `blocked` (`auth_invalid_key`), no retry storm; fix token + **Retry** |
| 5 | **Retryable network/5xx** — (e.g. wrong `base_url` host, or Lazywait 5xx) | order → `failed`, `sync_attempt_count++`, `sync_next_attempt_at=now()+backoff`; auto-retries; after 8 attempts → `dead_letter` |
| 6 | **Stale `syncing` reaper** — set a test order to `syncing` with an old `updated_at` (SQL below), trigger a run | ref-less row → `failed` (requeued) / `dead_letter`; a row *with* a `lazywait_ref` → recovered to `synced` (never re-sent); a `recovered_*` `integration_sync_logs` row is written |

Reaper induce (throwaway/staging only):
```sql
update public.orders
   set lazywait_sync_state='syncing', updated_at = now() - interval '30 minutes'
 where id = '<TEST_ORDER_ID>';       -- then trigger §2.4; watch it recover
```

---

## 7. Rollback / safety plan

- **Disable sync temporarily (fastest kill switch):** Admin UI → Lazywait POS
  card → toggle **Enabled OFF** (or `update integration_settings set enabled=false
  where provider_type='lazywait';`). The worker then returns `{"status":"disabled"}`
  and sends nothing. New orders still queue as `pending` but are never transmitted.
- **Stop the worker entirely:** simply stop triggering it. If you scheduled it,
  `select cron.unschedule('lazywait-sync');`.
- **Requeue a stuck/blocked order:** Admin **Retry** button, or
  `select public.requeue_lazywait_order('<ORDER_ID>');` (admin). Ops in SQL editor:
  ```sql
  update public.orders set lazywait_sync_state='pending', sync_attempt_count=0,
    sync_next_attempt_at=now(), sync_last_error=null, sync_blocked_reason=null
    where id='<ORDER_ID>';
  ```
- **Force an order off the queue (dead-letter it):**
  ```sql
  update public.orders set lazywait_sync_state='dead_letter', sync_next_attempt_at=null
    where id='<ORDER_ID>';
  ```
- **Clear an incorrect mapping:** Admin **Clear** button, or
  `select public.clear_lazywait_mapping('product','<PRODUCT_ID>');` (admin), or
  `update public.products set lazywait_item_id=null, lazywait_price_id=null, lazywait_price_ref=null where id='<PRODUCT_ID>';`
- **Avoid duplicate POS orders:** rely on the built-in guards and **do not
  manually re-POST**. The worker (a) never re-sends an order that already has a
  `lazywait_ref`, (b) persists the ref immediately on POST success, (c) blocks an
  ambiguous 2xx (`created_without_ref` / `unexpected_response`) instead of
  retrying, and (d) the reaper recovers a stale `syncing`-with-ref to `synced`.
  If a `blocked` order's reason is `created_without_ref`/`unexpected_response`,
  **check the POS first** — if the ticket exists, do not requeue (mark it synced
  manually or leave blocked); only requeue if the POS has no such order.
- **Scheduling (optional, if you want hands-off during the pilot):**
  ```sql
  select cron.schedule('lazywait-sync','* * * * *', $$
    select net.http_post(
      url := 'https://<PROJECT_REF>.supabase.co/functions/v1/lazywait-sync',
      headers := jsonb_build_object('Content-Type','application/json',
                                    'Authorization','Bearer <SUPABASE_ANON_KEY>',
                                    'x-sync-secret','<SYNC_TRIGGER_SECRET>'),
      body := jsonb_build_object('limit',5)) $$);
  ```

---

## 8. Final GO / NO-GO

This is the decision — after running the §4 validating order and the §6 failure
cases with **Enabled ON** — on whether to **continue the pilot** (keep placing
controlled pickup orders, then plan widening) or **halt** (flip Enabled OFF).

**GO — continue the pilot — only if ALL of these pass:**
- [ ] **[C]** Token rotated; secrets stored server-side only (never in app/repo).
- [ ] **[C]** Migrations applied; `lazywait-sync` + `lazywait-catalog` deployed.
- [ ] **[C]** Catalog pulled; exactly one branch mapped to the Lazywait **test** branch.
- [ ] **[C]** 1–2 active test products mapped; no missing `lazywait_item_id` on them.
- [ ] **[C]** A pickup test order reaches `lazywait_sync_state='synced'` with a
      `lazywait_ref` **and** appears in the Lazywait POS.
- [ ] **[C]** A delivery order is `blocked` and never sent.
- [ ] **[C]** Missing-mapping cases `block` (never send); auth failure `blocks`
      safely; a retryable error retries with backoff.
- [ ] **[C]** Rollback verified: toggling **Enabled OFF** stops all sending.

**NO-GO — do not enable / halt the pilot — if ANY of these:**
- Any token appears in the app bundle, repo, logs, or a client response.
- A pickup order **duplicates** in the POS, or an order syncs from an **unmapped**
  branch/product.
- A **delivery** order is transmitted to the POS.
- A stuck `syncing` order is not recovered by the reaper.
- The worker cannot be stopped (Enabled OFF still sends), or you cannot requeue/
  clear a mapping.
- Local order state, pricing, VAT, coupon, or loyalty is altered by anything
  Lazywait-related (Supabase must remain the source of truth).

**Still intentionally NOT sent in Create Order (unchanged):** delivery, addons/
modifiers, `price_id`, `customer_id`/`customer_cell`, online-payment update
(unless a real Geidea payment is verified server-side, which the pilot excludes).

---

## 9. After a successful pilot (next, not now)
Map the remaining active products for the pilot branch, run a few more pickup
orders, then widen branch-by-branch — re-checking readiness (`blocked_orders=0`,
all active products mapped) at each step. Only then revisit addons/`price_id`/
delivery once Lazywait confirms those schemas.
