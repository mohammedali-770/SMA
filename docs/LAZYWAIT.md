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

Two things in source still name the **production** host. Both were traps; both
are now closed — the first on 2026-08-24, the second on 2026-08-31:

- `DEFAULT_BASE_URL` (`supabase/functions/_shared/lazywait.ts`) is
  `https://apiv2.lazywait.com/v1`. It **used to be a fallback**: the worker
  preferred `public_config.base_url`, and if that key were ever cleared it would
  silently start POSTing real customer orders to a POS nobody watches. That
  fallback is **gone** — see "Missing `base_url` fails closed" below. The
  constant itself is deliberately left unchanged, because it names what the
  applied `20260708130000` migration seeded into Production.
- The admin Integrations card used to show the production URL as its input
  **placeholder** (`src/components/admin/IntegrationCard.tsx`), which is how the
  wrong host could get typed back in. **Fixed 2026-08-31**: it now suggests the
  dev host, and `IntegrationCard.test.ts` asserts both that it names the live
  host and that it does not name the production one. The negative assertion is
  the load-bearing half — the fail-closed guard rejects a blank or malformed
  `base_url`, but a well-formed URL pointing at the wrong POS would be accepted,
  and every order sent there would look successful.

  This one survived a year of being written down. It was recorded here as a known
  trap and still shipped, which is the argument for pinning a claim with a test
  rather than a sentence.

The `20260708130000` migration also seeds the production URL as a default. That
file is applied history and must never be edited; the live row overrides it.

## Missing `base_url` fails closed
Added 2026-08-24, alongside the host correction above.

Because the live POS is the **dev** host, an implicit fallback to
`DEFAULT_BASE_URL` was not a safe default — it was a silent redirect of live
customer orders to the **production** POS. A cleared, blank, whitespace-only or
**malformed** `public_config.base_url` now **fails closed** instead:

> **SUPERSEDED IN PART, 2026-09-14 — read "The base URL is now allowlisted"
> below before configuring anything from this section.** The shape check
> described here is still the first gate, but it is no longer the only one: the
> scheme is now **https only**, the host must be on an allowlist, and there is a
> **third** terminal reason. This section is kept because the fail-closed
> reasoning is still why the guard exists at all; its *permissiveness* is not
> current. Review caught the contradiction on #371 — an operator following this
> section alone would configure values the implementation now rejects.

- `resolveLazywaitBaseUrl()` (`_shared/lazywait.ts`) is the single resolution
  point, and it reports **three distinct terminal reasons**, because the
  operator response differs in each case — nobody filled the field in, somebody
  filled it in wrongly, or somebody pointed it somewhere it may not go:
  - absent / empty / whitespace-only → **`lazywait_base_url_not_configured`**;
  - present but not an absolute `https` URL →
    **`lazywait_base_url_invalid`**;
  - well-formed `https` but the host is not allowlisted →
    **`lazywait_base_url_host_not_allowed`** (added 2026-09-14).

  There is no fallback in any case.

**Why the shape check is not optional.** Rejecting only blanks would have left
this PR's own failure mode open one keystroke away. `lazywaitFetch` builds
`` `${base}${path}?${params}` `` and hands it to `fetch`, which **throws** on a
malformed URL; the catch there returns `status: 0`, and
`classifyCreateOrderResult({status: 0})` is `ambiguous → confirmation_required`.
So a mistyped host would mark real customer orders as needing manual
confirmation — the exact outcome this guard exists to prevent, reached by a typo
instead of a blank. The admin card **used** to make that concrete by offering the
*production* host as its input placeholder; that was fixed on 2026-08-31 and is
pinned by `IntegrationCard.test.ts`. The guard still matters — it is what catches
a hand-typed malformed value — but the card no longer suggests a wrong one.

The shape check asks "would `fetch` accept this?", via the same `URL` parse the
platform performs, plus a protocol requirement. **That protocol requirement is
now `https` alone**, where it used to admit `http` as well: a plaintext base URL
put the POS token on the wire in the clear.

**This check used to be deliberately narrow — "it does not check host, path or
reachability, so it cannot reject a legitimately reconfigured POS" — and that is
no longer true of the host.** A separate allowlist now applies, for the reason
given in "The base URL is now allowlisted" below: the field is edited in a
browser, so "cannot reject a reconfigured POS" also meant "cannot reject a POS
reconfigured to an attacker's host". Path and reachability are still unchecked.

`lazywait.test.ts` pins every direction — the live value resolves; no-scheme,
misspelled-scheme, free text, bare path and non-https schemes are rejected as
`lazywait_base_url_invalid`; and a well-formed https URL on an unlisted host is
rejected as `lazywait_base_url_host_not_allowed`. The cases that used to assert
`some-new-pos.example.com`, `localhost:54321` and `10.0.0.4:8443` MUST resolve
were revised rather than deleted — see below for why that revision is recorded
rather than quiet.

**One deliberate loosening.** `resolveLazywaitBaseUrl` trims before validating,
which the pre-2026-08-24 transport did not: `'  https://host  '` used to be
passed into the request URL verbatim and fail, and now resolves cleanly and
sends. That is the desirable behaviour for a hand-edited config field, but it is
a live-path change and is recorded rather than glossed.
- `lazywait-sync` resolves it **before** the stale reaper and **before**
  `claim_lazywait_sync_batch`, and returns `500 lazywait_base_url_not_configured`
  without claiming anything. No order is claimed, no order changes state, and no
  HTTP request is attempted; the queue simply waits for the config to be fixed.
- `lazywait-catalog` refuses the same way (`400`).
- `createLazywaitApiClient()` throws `LazywaitConfigError` at construction.
- `lazywaitFetch()` is the transport backstop: it throws `LazywaitConfigError`
  before building a request, rather than falling back.
- `lazywait-webhook` makes no outbound Lazywait call, so it needs no guard.

**Why it is not reported as `status: 0`.** That was the tempting shortcut and it
would have been an order-integrity bug. `classifyLazywaitError(0)` is
`retryable`, and `classifyCreateOrderResult({status: 0})` is `ambiguous →
confirmation_required`. Routing a configuration mistake through the network path
would therefore either retry it forever or mark real customer orders as needing
manual confirmation. Config is validated **before** any request is attempted and
recorded as its own terminal reason; the retry budget
(`MAX_POS_ATTEMPTS` / `POS_DEADLINE_MINUTES` / `POS_RETRY_OFFSETS_MIN`) and the
create-order confirmation classification are unchanged, and tests pin that.

Coverage: `_shared/lazywait.test.ts` (resolver + transport),
`_shared/lazywaitApi.test.ts` (client construction), and
`_shared/lazywaitBaseUrlWiring.test.ts` (a source-shape tripwire that the
handlers call the guard *before* claiming or sending — the handlers import
Deno-only modules, so Vitest cannot execute them).

**Still open (not changed here):**

- ~~The admin Integrations card still offers the production host as its input
  **placeholder**~~ — **FIXED 2026-08-31.** It now suggests the dev host, and
  `IntegrationCard.test.ts` asserts both that it names the live host and that it
  does not name the production one in any form. The negative assertion is the
  load-bearing half: this guard rejects a blank or malformed `base_url`, but a
  well-formed URL pointing at the wrong POS would be accepted and every order
  sent there would look successful.
- `_shared/paymentSync.ts` still reads `base_url ?? DEFAULT_BASE_URL`. It is
  under the CLAUDE.md §6 payment freeze and was not touched. The residual risk is
  small and bounded: `pushLazywaitOnlinePayment` only runs for an order that
  **already** carries a `lazywait_ref`, so it cannot create a POS ticket, and an
  empty/whitespace value now throws out of `lazywaitFetch` (every caller already
  wraps it in `.catch()`). The one uncovered case is an entirely **absent**
  `base_url` key, which `??` still resolves to the production host for that one
  best-effort call. Closing it is a one-line change to a frozen file.
  *(2026-11-12: the payment freeze was lifted for repository work on
  2026-11-11, when the owner chose Moyasar. The Moyasar-only change did not touch
  this fallback, so the residual risk above still stands.)*
  *(2026-11-19: CLOSED by removal. `pushLazywaitOnlinePayment` was deleted, so
  `paymentSync.ts` no longer calls Lazywait at all and holds no `base_url`
  fallback; the payment reaches the POS on the ticket, through lazywait-sync.)*

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

   The mapping card's **Last pull** line shows the latest run's time in Riyadh
   time, `YYYY-MM-DD HH:mm:ss` (since 2026-11-12). It used the device's zone and
   locale, so an administrator outside Saudi Arabia read a different clock from
   the rest of the console.

   **Add-on groups have never imported a single record.** Every
   `lazywait_catalog_pulls` row in Production records `addon_groups: 0` with
   `status: "success"` and no error — an empty parse is not an error, so the
   count is the only signal there is.

   The envelope unwrapper (`extractCatalogList`) tried a fixed key list that
   carried a bare `groups` but **not** `addons_groups` or `addon_groups` — the
   `addons_`-prefixed style the item payload itself uses for
   `addons_groups_ids`. If `/menu/addons-groups` wraps its list under either of
   those spellings, the unwrapper found nothing. It now takes the entity and
   tries that entity's own envelope keys **first**; only `addon_group` needs it,
   since the generic list already covers the other four. Trying them first
   rather than appending them matters: a group envelope may itself carry an
   `addons` key listing each group's add-ons, and `addons` precedes `groups` in
   the generic order, so a group response could otherwise be read as an add-on
   list. Pinned by `lazywaitCatalog.test.ts`, including a regression case
   asserting the old path returned nothing for an `addons_groups` body.

   **This is a hypothesis, not a confirmed root cause.** Confirmed: the old key
   list had no `addons_groups` / `addon_groups`, and every pull returns zero.
   Not confirmed: what `/menu/addons-groups` actually returns, which nobody has
   captured. If it wraps under `data`, `results` or a bare `groups` — all of
   which the old list already tried — then the parse was never the problem and
   this changes nothing. Two further shapes would also survive the fix: a nested
   wrapper, and a list of bare ids rather than objects.

   What makes it worth fixing regardless is that the vendor side is **not**
   empty: one item in the live catalog (`Extreme`) carries three ids in
   `addons_groups_ids`, so at least three groups exist to be returned. Capture
   one raw response before concluding either way.

   A zero count from a healthy endpoint is indistinguishable from an empty
   catalog in the pull log. If a future entity starts reporting 0 where records
   are expected, suspect the envelope key before the vendor.
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
   **Images (from `20261124130000`, F-X10-002):** the POS `photo` fills a
   product's image only while it is EMPTY and only when it is a plain https URL;
   it never replaces an image already there (an upload to the product-images
   bucket or a URL an administrator pasted), because nothing records where an
   image came from. A later change of the photo in the POS therefore does not
   reach a product that already has one; clear the image in the console to take
   the POS's. A `photo` that is not https is ignored rather than aborting the
   import.

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
   INSERT trigger sets `lazywait_sync_state='pending'` — for **pickup and
   delivery alike** as of `20260827120000`. The only gate left is payment: an
   **online** order that is not yet paid parks at `'awaiting_payment'`.
2. `lazywait-sync` (cron/scheduled) calls `claim_lazywait_sync_batch(N)` —
   `FOR UPDATE SKIP LOCKED` so concurrent workers never double-send — flipping
   claimed rows to `'syncing'`. **Neither claim takes a cancelled order**
   (`status <> 'cancelled'`, `20261012120000`, gap PG-03; written 2026-11-14,
   applied 2026-11-14 17:27 UTC, ledger row 117). Cancelling did not touch the sync state, so before it a
   cancelled order that was queued, re-queued by a customer resend or re-queued
   by an admin Retry was sent to the kitchen. It now stays in the queue unsent;
   see the cancelled-order note under *Retry / backoff / dead-letter*.
3. Per order: load branch mapping + items via `ORDER_ITEM_SELECT` — the
   server-trusted snapshots (`name_en`, `name_ar`, `note`, qty, `unit_price`)
   joined to `products.lazywait_item_id` / `lazywait_price_id`, the product's
   `categories.lazywait_category_id`, and `order_item_modifiers` joined to
   `modifiers.lazywait_addon_id` — map them with `mapOrderItemRows`, read the
   stored CRM link and optionally refresh it by phone, then
   `buildCreateOrderPayload` (pickup **and** delivery, validates mapping).
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
- `order_details` carries the customer's own kitchen note, and — for a **comped**
  order — a label in front of it. **Since 2026-11-24 the customer's note is
  itself labelled** (F-X10-001), so it cannot pass for a system marker:

  ```
  *** COMPLIMENTARY / ضيافة *** — ملاحظة العميل / CUSTOMER NOTE: No onions
  ```

  The line is up to three parts joined by an em dash — the comp label, the
  `DELIVER TO` line (delivery only) and the note — and until then the note was
  last with nothing saying whose words it was, so a note typed as
  `*** COMPLIMENTARY / ضيافة ***` or `التوصيل إلى / DELIVER TO: …` printed exactly
  like the system's own text. The label does not stop a customer typing it; it
  says who wrote it. It applies on **every** order that has a note (a forged
  comp label on a pickup ticket is the main case), so a note-only ticket now
  reads `ملاحظة العميل / CUSTOMER NOTE: Extra napkins` where it used to read
  `Extra napkins`. A line's `details` gets the same label only when the note
  follows modifier choices the system wrote (`Volcano — … CUSTOMER NOTE: No
  onions`); a note alone there has nothing to be mistaken for and is unchanged.
  The label is `CUSTOMER_NOTE_LABEL` in `_shared/lazywait.ts`; its Arabic is
  engineering-drafted (`OWNER_ACTIONS.md` §35). **LIVE since 2026-11-24 11:12 UTC**
  (`lazywait-sync` v27, `OWNER_ACTIONS.md` §64). **No printed ticket has been
  checked yet**, and whether the POS prints `order_details` verbatim is not
  verifiable from the repository.

  It is prefixed rather than appended so it survives a POS display that
  truncates a long note.

  It mattered even more before totals were sent: with no order-level money at
  all, a free ticket was byte-for-byte indistinguishable from a paid one. Since
  2026-08-27 a comped ticket also prints `Subtotal 9.00 / Discount 9.00 /
  Total 0.00`, so the numbers now corroborate the label — but the label stays,
  because each LINE still carries its undiscounted menu price and "why is nobody
  paying" is a question the label answers in words.

  It is deliberately **not** the contract's `is_paid` flag. `is_paid` changes the
  POS's own payment state, which is the financial signal CLAUDE.md §6 reserves
  for a separate owner decision; this only annotates the field that already
  carries the customer's instructions, and states what the order **is** rather
  than instructing the cashier what to collect. `lazywait.test.ts` pins the
  label. (`is_paid` itself is sent since 2026-11-19, for a card order with a
  captured payment only; a comped order has none, so it never gets it. See the
  payment-flag note below.) Comped orders themselves are
  documented in `docs/DISCOUNTS_CAMPAIGNS.md`.

  **LIVE since 2026-08-26 12:46 UTC**, when `lazywait-sync` was redeployed to
  **v5** on explicit owner approval (`verify_jwt` unchanged at `false`). All five
  bundle files were read back and hashed byte-identical to the repository; the
  cron ran the new version at 12:47:00 and succeeded. Detail:
  `docs/OWNER_ACTIONS.md` §20.

  The redeploy was order-independent with respect to the migration — the worker
  reads orders through `claim_lazywait_sync_batch`, which returns
  `setof public.orders`, so a missing `is_comped` column would have yielded
  `undefined` rather than a failed select — but in the event the migration went
  first anyway.
- `name` and `names{en,ar}` carry the **chosen tier**, not the bare product name
  — `Chicken Wings — Small` / `أجنحة الدجاج — صغير`, composed by
  `posLineName`. **The POS renders the name we send; it does not resolve
  `price_id` into a label.** Ticket #2 / invoice 19 (2026-08-26) printed
  "Chicken Wings" for a line ordered as صغير even though the payload carried
  the correct `price_id` (`20005a3e…`, straight from Lazywait's own catalog), so
  the kitchen could not tell a 7.00 Small from a 13.00 Large. The separator and
  the drop-a-tier-that-repeats-the-name rule mirror the app's `orderLineLabel`,
  so receipt and ticket read identically. Tier names come from the
  `order_items.variant_name_*` snapshots, so a ticket keeps naming what the
  customer bought even after the catalog changes.
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

  The decomposition **assumes the POS sums** item price and add-on prices, which
  is the reading the contract's own example shows. If the POS instead treats
  `order_items[].price` as final, a decomposed line **undercharges** by the
  add-on total. This is inert while zero modifiers are mapped — `addons[]` is
  never emitted and nothing is subtracted — and activates the first time one is.
  Open question **Q10**; settle it before mapping the first add-on.
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
- **Totals ARE sent, since 2026-08-27** — `subtotal`, `discount`, `tax`, `total`
  and, on a delivery order, `order_delivery_fee`. Each is copied **verbatim**
  from the order snapshot (`orders.subtotal`, `vat_amount`, `total`,
  `delivery_fee`, and the three discount columns summed), so the ticket carries
  the same numbers as the customer's receipt and nothing is recomputed. `tax` is
  the VAT **contained within** `total`, never added to it. Q9 was answered by a
  printed ticket — see "Order totals printed as 0.00" below. **`tax_percentage`
  is still not sent**: it is optional, `tax` says the same thing, and a
  percentage is the one field that might invite the POS to recompute
  `subtotal × 1.15`.
- **`order_payments` carries the card payment, for the same orders
  (2026-11-19).** With only `is_paid`, the receipt printed "Paid" but the POS
  order list showed paid 0.00 and no payment type, even once
  `update-online-payment` was accepted (SM-2026-000110, 07:51 UTC): that call
  is built for a card terminal in the branch, and the list reads the order's
  own payment lines, which we always sent empty. Owner: "just fill it with
  Online Credit Card for now". A ticket created paid now carries one line
  (`posOrderPayments`, `_shared/posPaidFlag.ts`): `names` "ONLINE CREDIT CARD" /
  «بطاقة ائتمانية», `amount` = the order total, `Card_Type` (the scheme, e.g.
  `MADA`), `Card_Number` (`****` + last four), `status: 'approved'`, and
  `Approval_No`/`transaction_uuid` (Moyasar's payment id). **Lazywait does not
  document the entry shape**; it mirrors the sibling lists and its own
  update-online-payment fields. So a Create Order answered **400** while the
  line is attached is re-sent **once** without it: a 400 is a validation
  refusal, so no ticket exists and the retry cannot duplicate one. The order
  always reaches the kitchen; the sync log's `order_payments` says `sent` or
  `dropped_after_400: <reason>`. No other status is retried (a 5xx or timeout
  may have created the ticket). Pinned by `lazywaitOrderPayments.test.ts`,
  which drives the real worker.
  - **First result (SM-2026-000111, POS #8, 08:26 UTC):** the list showed
    payment type ONLINE CREDIT CARD but still **Paid 0.00 / Remaining 221.00**.
    Reading the order back (`GET /pos/order`, one read-only call on owner
    approval, made from SQL through `pg_net` so the key never left the
    database) showed Lazywait stored our line verbatim, `amount: 221` included,
    and itself recorded `is_paid: true`, `received_amount: 221`, `balance: 0`.
    The order was the only line; `update-online-payment` had added nothing. So
    the list reads a different field per line. `Trans_Amount` was tried next
    (#509, POS #9) and the list still read 0.00.
  - **Measured, not guessed (owner's idea, 2026-11-19):** one probe order
    (POS **#10**, "TEST - DO NOT PREPARE", 13.00, created straight through
    `pg_net` on owner approval, no deploy) carried a single line with eleven
    candidate fields, each set to a distinct power of two: `amount` 0.01,
    `Trans_Amount` 0.02, `paid` 0.04, `paid_amount` 0.08, `amount_paid` 0.16,
    `payment_amount` 0.32, `value` 0.64, `total` 1.28, `received_amount` 2.56,
    `tendered_amount` 5.12, `price` 10.24. The list showed **Paid 0.32 /
    Remaining 12.68**: the Paid column reads **`payment_amount`** and nothing
    else. The line now carries the order total in `payment_amount`;
    `Trans_Amount` is dropped. Lazywait sets the order's own `received_amount`
    to the total from `is_paid` alone, independent of every line field.
  - **The label names the card (owner, 2026-11-19):** `names` is built from
    the brand Moyasar reported (`card_scheme`) and, from the stored `raw`,
    whether it came through Apple Pay: `MADA`/«مدى», `VISA`/«فيزا»,
    `MASTERCARD`/«ماستركارد», `AMEX`/«أمريكان إكسبريس», or `APPLE PAY - MADA`
    / «Apple Pay - مدى»; an unknown brand keeps ONLINE CREDIT CARD
    (`posPaymentNames`). Measured the same day: 12 of 13 paid card payments
    were Apple Pay on mada, 1 a Visa card.
  - **A TEST payment says so (2026-11-22, audit finding F-EFP-05-001; deployed
    2026-11-22 with `lazywait-sync` v25):** when the paid record's `mode` is `test`
    (a Moyasar test card, admitted only by the testing-phase switch for a
    listed customer, `docs/PAYMENTS.md` §3), the label is prefixed
    `TEST - ` / «اختبار - », for example `TEST - VISA` / «اختبار - فيزا». The
    worker's paid-record read now also selects `mode`. Every other field, and
    `status: 'approved'`, is unchanged. The Arabic is engineering-drafted and
    needs a native read. Deploy implied: `lazywait-sync`.
- **Create Order `warnings` are logged (2026-11-19).** Lazywait answers with
  `warnings` when the till would charge something other than what we sent
  (`ORDER_TOTAL_MISMATCH`, with its own figures). They were ignored; the sync
  log now keeps them (`posWarnings`: at most 5, 1 000 characters, long digit
  runs masked). A terminal refusal now logs its response as well.
- **`is_paid` is sent, for a certain card payment only (owner decision,
  2026-11-19).** The owner's rule: a card order goes to Lazywait as paid when
  its ticket is created, never sent first and marked paid later, and only when
  the payment is 100% done. `posIsPaidFlag` (`_shared/posPaidFlag.ts`) returns
  `true` only when the claimed order row is `payment_method = 'online'` and
  `payment_status = 'paid'` **and** a `payment_records` row for it has status
  `paid`. Only the server writes that row, after fetching the payment from
  Moyasar itself. A cash order or an unpaid or comped order sends no flag, so
  the failure direction is "shown unpaid", never "shown paid". **A failed
  lookup is the exception (2026-11-24, audit F-D2-001):** for an online order
  the row calls paid, an error reading `payment_records` no longer sends the
  ticket unpaid, because Create Order has no idempotency key and nothing
  corrects the ticket afterwards. The worker releases the claim before the
  fenced gate (`posPaidLookupMustDefer`): state back to `pending`, due 30
  seconds later, no attempt counted, no customer message, one `skipped` sync-log
  row `payment_lookup_deferred`. The minute cron claims it again inside the
  10-minute deadline; if the read keeps failing, the deadline sweep dead-letters
  it as for any order and R1 raises it for a paid one. A lookup that succeeds
  and finds no paid record is not an error and still sends unpaid, as before. Why it was needed: read live 2026-11-19, the separate
  `update-online-payment` call had been refused with HTTP 400 on all 9 card
  orders since 2026-11-18 13:23 UTC, so every card order showed **unpaid** at
  the branch (confirmed by the owner on the POS). That call ran after payment
  until it was **removed on 2026-11-19** (see "The separate payment call is
  removed" below). Since the same day it sends the payment type **"Online Credit
  Card"** (owner: "send it to Lazywait as Online Credit Card"; it was the bare
  word `card`), and a refusal is logged with Lazywait's own code and message
  (`paymentPushError` in `_shared/paymentSync.ts`), not just the HTTP status.
  That log read `Missing required fields`, and still did after the call also
  sent `transaction_uuid` and the masked last four. Lazywait's documentation
  for the call (owner-supplied 2026-11-19, recorded in
  `integrations/Lazywait_API_Reference.md`) lists the required set, including
  three terminal ids. The body now carries all of them: the terminal ids as the
  fixed `MOYASAR-APP`, `Card_Type` as the card scheme (`MADA`, `VISA`),
  `Card_Number` as `****1234`, `status: 'approved'`, and the "Online Credit
  Card" label in `names`.

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

Every active product, price and category is mapped — *non-null*, which is not the
same as *resolvable*; see the caveat below. **No modifier is.** All three
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

**Those gates test presence, not resolvability.** `missing_item_mapping` fires
only on a NULL `lazywait_item_id` (`!it.menuItemId`), so a mapping that exists in
our rows but no longer resolves in the vendor catalog passes every gate and is
POSTed unchanged. The table above says our rows are non-null; it says nothing
about whether Lazywait still knows those ids.

Nothing in this worker detects a stale id, and the POS answer is not reliably
legible either. A rejection *can* land as a terminal `client_error_4xx`, but a
5xx is classified ambiguous and left for confirmation, and a 2xx is recorded as
delivered — so a stale id can equally surface as a silently wrong ticket rather
than as a mapping error. Do not read "every product is mapped" as "every product
will be accepted"; see `docs/OWNER_ACTIONS.md` §17.

**Catalog size moves between pulls, so a single pull is not evidence of drift.**
Six `lazywait-catalog` pulls ran on 2026-08-24, all logging `success` with an
empty `errors` array. The first three (10:45, 10:57, 11:02 UTC) recorded 4 items
and 1 category; the next three (11:06, 11:15, 11:16 UTC) recorded 61 items and 6
categories, against 64 items and 7 categories on 2026-07-23. Add-ons read 10 in
all six. Whatever produced the four-item reads was transient and had cleared
within about twenty minutes. Size the catalog — and judge whether mappings have
gone stale — from the latest pull and a repeat, never from one reading.

Creating the three add-ons in the Lazywait catalog and mapping them is still the
only way to get heat level onto the ticket as a **structured, separately priced**
add-on rather than as text. That remains an owner decision
(`docs/OWNER_ACTIONS.md` §17) — it is now an improvement, not a prerequisite.

**Deployment status — LIVE, version 4 as of 2026-08-26.** This was repository
code only until 2026-08-25: the deployed worker was still the July build, which
sent no add-ons, no per-item note, no category or price id, and no customer
phone. Version 3 shipped all of that on explicit owner approval, verified
byte-identical to the default branch by SHA-256 across all five bundled files.

**Version 4 (2026-08-26) puts the chosen tier in the line name.** Version 3 sent
the correct `price_id`, but the POS renders the `name`/`names` we send and does
not resolve `price_id` into a label, so ticket #2 / invoice 19 printed "Chicken
Wings" for an order placed as صغير. `mapOrderItemRows` now composes the name from
the `order_items.variant_name_*` snapshots via `posLineName`, which mirrors the
app's `orderLineLabel` — same separator, and the same rule that a tier merely
repeating the product name is dropped, so receipt and ticket read identically.
Reading the snapshots rather than the live catalog means the ticket keeps naming
the tier the customer actually bought after the catalog changes.
`ORDER_ITEM_SELECT` gains `variant_name_en` and `variant_name_ar`; both were
confirmed granted to `service_role` before the deploy, because an ungranted
column makes PostgREST reject the whole select. Deployed with zero orders in
flight and read back: four files byte-identical, and `_shared/lazywait.ts`
differing only where the deploy pipeline normalised a Unicode escape on the
separator line — since corrected in the repository so the file matches
byte-for-byte. No money field and no provider behaviour changed.

**The money on a ticket did not move.** Only a modifier carrying a real
`modifiers.lazywait_addon_id` becomes an `addons[]` entry and is subtracted back
out of `price`; all **three** live modifiers are unmapped, so nothing is
subtracted and every line is charged exactly what it was under the July build.
What changed is that the customer's heat-level choice now reaches the kitchen as
`details` text instead of being silently dropped.

### Add-ons went live 2026-08-26 — what actually landed

Applied on explicit owner approval as live version `20260826080319`, then run
from the admin console. Before it, `product_modifier_groups` held **zero** rows
and no product offered an option of any kind. Verified read-only afterwards:

| | before | after |
| --- | --- | --- |
| `modifier_groups` | 1 (hand-made) | 2 |
| `modifiers` | 3 | 13 |
| `product_modifier_groups` | **0** | 1 |

The imported group is **مشروب الوجبة** — `min_select 1`, `max_select 1`,
`is_required true` — carrying all **ten** drinks at 0.00, attached to **Coral**.
The stray "Test" group was **not** imported, by the rule rather than by name: no
item references it. The hand-made group and its rows are untouched, and there
are zero duplicate groups and zero duplicate (group, add-on) pairs. The wider
import left the menu where it was: 55 of 61 products active, 144 of 147 tiers.

**`name_en` on that group is the Arabic string**, because Lazywait sent
`name_en = null` and the column is `NOT NULL`. The fallback did what it was
built to do — a blank heading would be worse — but an English-locale customer
reads Arabic for the group title while the ten options themselves have proper
English names. Fixing it is one field in Lazywait plus a re-pull and re-import;
no code change.

**Coral now requires a choice.** `min_select 1` on a required group means the
Add button stays disabled until the customer picks a drink. That is Lazywait's
setting, faithfully imported, not a decision made here.

**Customers can read all of it**: `modifier_groups` and
`product_modifier_groups` are publicly selectable, `modifiers` on `is_active`,
and all ten are active.

### Add-ons: how a Lazywait group becomes an app option

Until 2026-08-26 nothing connected the two. `import_lazywait_catalog` wrote
categories, products, variants and branches and mentioned modifiers nowhere, so
`product_modifier_groups` held **zero** rows in Production and no product
offered an option of any kind. `import_lazywait_addon_groups()` is the missing
consumer, called last by the importer once its products exist.

**Two facts from the 2026-08-26 07:18 pull drive the design.** Both are the kind
that produce a silent empty result rather than an error if you assume otherwise:

- **Membership is readable only from the group.** Every add-on carries an
  `addons_group_id` key and every one of them is null — 0 of 10 non-empty. The
  group's `addons_ids` array is the only link. Reading it add-on-first, which is
  the obvious direction, finds nothing.
- **One add-on may sit in several groups.** Mango juice belongs to both
  "مشروب الوجبة" and the stray "Test" group. `modifiers.group_id` is `NOT NULL`,
  so one row cannot serve both: there is **one modifier row per (group, add-on)
  pair**, `lazywait_addon_id` is deliberately not unique across the table, and
  the unique index is on `(group_id, lazywait_addon_id)`.

| Lazywait | App |
| --- | --- |
| add-on group referenced by ≥1 item | `modifier_groups` row, `lazywait_group_id` set |
| group's `min_selection` | `min_select`; `>= 1` also sets `is_required` |
| group's `max_selection`, else `multi_max` | `max_select` (0/absent → null, meaning no cap) |
| each id in the group's `addons_ids` | a `modifiers` row in that group |
| item's `addons_groups_ids` | `product_modifier_groups` link, for mapped products |

**Groups no item references are not imported.** That is a rule, not a special
case, and it is what keeps a stray group — the real catalog has one called
"Test" — out of every customer's menu.

**An item's own `addons_ids` is ignored on purpose.** Coral lists Mango juice
directly *and* through the group. This model has no add-on outside a group, and
importing the direct one as well would show it twice on the product screen.

**Names fall back across languages.** Lazywait sent `name_en = null` for both
groups; `modifier_groups.name_en` is `NOT NULL` and the app renders
`pick(nameEn, nameAr)` by locale, so without a fallback an English-locale
customer would read a blank heading.

**Prices use the same rule as products and variants** — a stated gross wins,
otherwise the net is grossed up by the configured VAT, never negative. On the
2026-08-26 pull every add-on is priced 0, so this path is exercised but proves
nothing about the arithmetic until one carries a real price.

**Removal is deactivation, never deletion**, for both options and links, because
an `order_item_modifiers` row references a modifier for the life of the order.

**Consequence for the POS.** Once a modifier carries a real `lazywait_addon_id`,
`lazywait-sync` starts emitting it as an `addons[]` entry and subtracting its
price back out of `price`. Before this import every live modifier was unmapped,
which is why no ticket has ever carried one. At a 0 price the subtraction is 0.

### Delivery (enabled 2026-08-27)
Delivery orders **are synced**, and this is no longer a claim about code:
**SM-2026-000059 reached the POS as ticket #3 on 2026-08-27 at 10:15 UTC**, 42
seconds after it was placed, accepted on the first attempt with no retries
(`success: true`, `order_ref e5d6bf08…`, `order_status_id new-order`). That
answers Q1 — Lazywait **accepts `order_type: "delivery"`**.

`order_type: "delivery"` and the confirmed top-level `delivery_address` are
sent; the destination is composed from `orders.address_snapshot`
(`label · national_short_address · description`).

**Confirmed on a real ticket, 2026-08-27.** SM-2026-000065 (ticket #9) was placed
with a saved address whose `label` still equals its `description`, so the dedupe
was genuinely exercised rather than merely present — and the printed DELIVER TO
line carries the address **once**. Before the fix the same shape put it on the
ticket four times.

**Repeated parts are deduped**, case-insensitively on the trimmed value, keeping
the first occurrence. Nothing stops a customer saving the same text as both the
label and the directions, and SM-2026-000059 did exactly that: its line composed
as `X · X` for a single address, which — repeated again into `order_details` —
put that address on the ticket four times. The real value is deliberately not
quoted anywhere in this repository; it is a customer's home address
(CLAUDE.md §9).

**The address is sent twice, and Q8 now says it must stay that way.**

The printed ticket for SM-2026-000059 (ticket #3, invoice 24) was inspected on
2026-08-27. It prints `Order Type: Delivery` — so `order_type` is accepted *and*
displayed — but there is **no delivery-address row anywhere on it**. The
destination appears **only** in the note line, as
`التوصيل إلى / DELIVER TO: …`, printed below `Payments`.

**Q8 is therefore answered, and the answer is the unwelcome one: the POS does
not render `delivery_address`.** Had the builder trusted that confirmed contract
field alone, this ticket would have reached the kitchen with no destination on
it — food made, nobody knowing where it goes, which is the exact failure the
duplication exists to prevent. The `order_details` copy is not belt-and-braces
any more; it is the only thing carrying the address.

Do **not** remove it. If a future ticket ever shows a rendered
`delivery_address` row, revisit then — on evidence, as before.

A delivery order whose snapshot yields **no** usable address is blocked with
`missing_delivery_address` rather than sent: better no ticket than a ticket the
driver cannot use.

**What opened the gate.** It was never only the Edge Function — the real block
was `set_lazywait_initial_sync`, a BEFORE INSERT trigger that parked every
delivery order at `blocked` before the worker could claim it. That is why
SM-2026-000057 died with `sync_attempt_count = 0`.

### How fast an order reaches the branch, and why it used to be slow

`order-intake` kicks `lazywait-sync` **synchronously** right after `place_order`,
bounded by an ~11 s timeout, so the confirmation screen can show the branch
number immediately. The once-a-minute cron is the *backstop*, not the primary
path.

**Where the kick runs (2026-11-18).** A function-to-function call runs
nearest its caller. Kicks from `order-intake` (called from Saudi Arabia) and
from Moyasar's payment webhook ran `lazywait-sync` in Mumbai, far from the
Frankfurt database: 5.7 s average there against 0.65 s for the in-region cron.
The two kicks, and the worker's own `push-dispatch` drain, are now pinned to
`eu-central-1` with `forceFunctionRegion` (`_shared/functionRegion.ts`).
Nothing the worker does changes; only where it runs. Detail: `PAYMENTS.md` §2.

**Delivery did not get that kick until 2026-08-27.** The block read
`if (order_type === 'pickup')`, which was correct only while the insert trigger
parked every delivery order at `blocked` — kicking the worker for an order it
would refuse was pointless. Once migration `20260827120000` opened that gate the
condition became a leftover, and delivery orders fell through to the cron:

| Order | Placed → branch number | Attempts |
| --- | --- | --- |
| SM-2026-000059 | 42.3 s | first try |
| SM-2026-000060 | 32.2 s | first try |
| SM-2026-000061 | 17.8 s | first try |
| SM-2026-000062 | 44.6 s | first try |

Every one succeeded on the **first attempt**, so none of that time was Lazywait.
It was the wait for the next cron tick, and the 18-45 s spread is just where in
the minute the order happened to land.

**It also produced the false push.** The "order received" push fires *after* the
sync block, so for pickup it followed a real attempt; for delivery the block was
skipped entirely and the customer was told the kitchen had an order that had not
been sent anywhere. Closing the gate makes the ordering honest for both, and
`orderIntakeSyncWiring.test.ts` now pins that the sync call precedes the push
call in the source.

That gate was the **fifth** place the pickup-only assumption was written down,
after the insert trigger, `buildCreateOrderPayload`, `confirm_order_payment` and
the watchdog's R1/R7.

**Also fixed, 2026-08-27:** `order-intake` no longer sends any push at all. The
POS outcome owns the customer's first message, and `lazywait-sync` now drains the
`pos_sync` notification queue that — until this change — **nothing was
draining**. Detail in `docs/ORDER_CONFIRMATION_FLOW.md`.

### Two POS-side defects the first ticket exposed

Both were found on ticket #3 and neither is fixable from our payload.

**1. The POS reverses Arabic word order.** On the printed ticket the shop's own
header reads `الناصرة ،ثابت بن حسان شارع` where it should read
`شارع حسان بن ثابت، الناصرة`, and its tagline reads `الموحد رقمنا على اتصل`
where it should read `اتصل على رقمنا الموحد`. Both are **word-for-word reversed,
with the comma displaced to the wrong side** — the signature of a renderer that
prints Arabic in logical order without applying the Unicode bidirectional
algorithm.

That header is the POS's own data. **We never send it.** So the fault is in
Lazywait's receipt renderer, not in anything this repository controls, and the
header is a clean vendor repro that does not involve our integration at all.
Our `التوصيل إلى / DELIVER TO:` note is mangled by the same bug.

**Do not "fix" this by pre-reversing our Arabic.** It would break the day the
vendor fixes the renderer, and it would be wrong everywhere else the field is
read — their dashboard, any export, any other template. Report it with the
header as evidence.

**2. Order totals printed as 0.00 — FIXED 2026-08-27 (Q9 answered).** Ticket #3
showed the two line items at 23.00 and 5.00, then `Subtotal 0.00`, `VAT 0.00`,
`Total 0.00`. SM-2026-000059 is a **cash** order with a real total of **28.00**,
not comped — so a driver reading that ticket had no idea what to collect. It was
never a delivery bug: no money was sent for pickup either, so every ticket had
it. Delivery only made it dangerous, because the food leaves with a driver.

**The ticket itself answered the question that had blocked this.** The open
worry was that the contract's example computes `total = subtotal × 1.15` — VAT
added on top — while our prices are VAT-inclusive, so we could not tell whether
the POS **computes** or **displays**. Ticket #3 settles it: we sent no money and
it printed `0.00` for all three. **A POS that computed a subtotal from the lines
would have printed 28.00**, because the lines were right there at 23.00 and 5.00.
It displays what it is given.

So the money is now sent, and every value is copied **verbatim** from the order
snapshot — `orders.subtotal`, `orders.vat_amount`, `orders.total`,
`orders.delivery_fee`, and the three discount columns summed into the contract's
single `discount`. Nothing is recomputed, which is the whole point: these are the
same numbers on the customer's own receipt, so the ticket cannot disagree with
what was charged and no new rounding enters the path.

`tax` is the VAT **contained within** `total`, not added to it — the template
already prints "Total includes VAT". Line prices are **unchanged** and stay
VAT-inclusive: they match what the customer saw in the app and have printed
correctly for weeks, and re-basing them exclusive would put prices on the ticket
the customer never agreed to.

Two fields stay deliberately unsent:

- **`tax_percentage`** — optional, and the explicit `tax` amount carries the same
  information. A percentage is exactly the field that might invite the POS to
  recompute `subtotal × 1.15` and print 32.20 on a 28.00 order. Not worth the
  tidiness on a customer-facing money figure.
- **`is_paid`** — sent since 2026-11-19, but only for a card order with a
  captured payment (see "`is_paid` is sent" above). Telling a branch what an
  order is *worth* is still not the same as telling the POS it has been
  *settled*, which is why the flag needs the captured payment record.

A comped order now prints `Subtotal 9.00 / Discount 9.00 / Total 0.00` beside the
COMPLIMENTARY label, which explains itself.

### Still intentionally NOT sent (do not invent)
`latitude`/`longitude` (the contract has **no** coordinate field anywhere), the
`order_deliveries[]` element shape — the vendor's own **pickup** sample sends it
EMPTY next to `order_payments[]`/`order_taxes[]`, so it is a POS-side collection
rather than caller input (`order_payments[]` is no longer sent empty for a card
order created paid, 2026-11-19, above) — `order_status_id` and `tax_percentage` (see the
payload section: `tax` carries the same information without inviting a
recompute). `is_paid` left this list on 2026-11-19 (above).

**The money fields are no longer on this list.** `subtotal`, `discount`, `tax`,
`total` and `order_delivery_fee` have been sent since 2026-08-27; Q9 was answered
by a printed ticket rather than by the vendor.

## Retry / backoff / dead-letter
- **Correction 2026-11-24: there is no automatic retry.** The worker still
  classifies a failure as retryable (429, 5xx, network/timeout) and writes
  `sync_attempt_count++`, state `failed` and a `sync_next_attempt_at`
  (30s→60s→…→1h, ±20% jitter; 429 honors `Retry-After`) — **but the database
  discards it.** A BEFORE trigger (`20260813143000_manual_only_pos_resend`)
  sets `sync_next_attempt_at` to null for `failed`, `dead_letter` and `blocked`,
  and `claim_lazywait_sync_batch` selects only `pending` rows (restated in
  `20261012120000`), so nothing ever claims a `failed` order again. It stays
  `failed` until the customer resends or an admin presses **Retry**, which
  resets it to `pending`. A `pos_retrying` event the worker writes for it is
  rewritten to `pos_failed`, so the customer is told "we could not send your
  order" with a resend button, not that the restaurant is confirming it.
  `MAX_SYNC_ATTEMPTS` (8, `_shared/lazywait.ts`) is therefore not an automatic
  retry budget; each manual requeue clears the count. Read the rest of this
  bullet list, and the 30s→1h schedule, as the worker's code, not the system's
  behaviour.
- Terminal (401 INVALID_KEY, 403 LICENSE_EXPIRED, other 4xx, missing mapping) →
  `blocked` (no auto-retry; admin fixes config/mapping then **Retry**).
- **Ambiguous 2xx** (HTTP success but no usable `order_ref`, or `success` not
  `true`) → `blocked` (`unexpected_response` / `created_without_ref`), NOT
  retried: the POS may have created the order and Create Order has no idempotency
  key, so a blind re-send would duplicate the ticket. Admin confirms in Lazywait,
  then **Retry** or resolves manually.
- The queue index `orders_lazywait_queue_idx` serves the claim, which pulls due
  `pending` rows oldest-first (a `failed` row is never due: see the correction above). `requeue_lazywait_order(id)` (admin-only) resets to `pending`
  **and** clears `sync_attempt_count` so the retry gets a full attempt budget.
- **A cancelled order is never claimed, and never resent by the customer**
  (`20261012120000`, gap PG-03; applied 2026-11-14, ledger row 117). Both
  claims skip it and `request_customer_pos_resend` refuses it with reason
  `order_cancelled`. Three things were left as they were, and are recorded in
  `ORDER_CONFIRMATION_FLOW.md` §11. **All three are fixed, and LIVE since
  2026-11-18** (#478; `MIGRATIONS.md` §67, `OWNER_ACTIONS.md` §57):
  `20261015120000` applied at 04:51:45 UTC (ledger row 120) and
  `push-dispatch` deployed as version 10:
  - an admin **Retry** on a cancelled order still moves it to `pending` (the
    worker then leaves it there). *Fix:* `requeue_lazywait_order` refuses it
    with P0001 `order_cancelled: …`, which the panel shows as it is;
  - a cancelled order left in `pending` or `failed` is swept to `dead_letter`
    at its deadline, which queues the customer's `pos_failed` push. *Fix:*
    `push-dispatch` sends no POS-outcome push for a cancelled order and closes
    the event as `superseded`. The sweep itself is unchanged;
  - **an order cancelled after the worker has claimed it is still sent.** The
    claim moves it to `syncing`, and the pre-send gate
    `begin_lazywait_create_attempt` reads the sync state, the marker and the
    deadline, never `status`. So a cancel that lands in the seconds between
    the claim and the POST still prints a ticket. Measured 2026-11-14 on a
    local chain with this file applied: an order claimed while `received`,
    then cancelled, got `ready_to_send` from the gate. *Fix:* the gate answers
    `order_cancelled` and parks the order `blocked` /
    `sync_blocked_reason = 'order_cancelled'` in the same locked statement.
    The worker is unchanged: it treats the answer as "not ready" (below).
- **No second ticket for an order the branch already has, and no ticket for an
  order whose money is going back** (`20261022120000`, audit F-X04-001 and
  F-X03-002; **applied 2026-11-22**, `MIGRATIONS.md` §75). Every
  non-429 4xx is recorded `blocked` and clears the may-have-sent marker, so the
  order looked resendable even after staff had taken it by hand and moved it to
  preparing, ready or delivered; and nothing on the Retry, claim or pre-send
  path read `refund_state`. Once applied:
  - the customer's Resend answers `unavailable` with reason `order_in_progress`
    for any status but `received`;
  - the admin **Retry** refuses with P0001 `refund_in_progress: …` for any
    refund lifecycle and `order_in_progress: …` for any status but `received`.
    The panel still shows Retry for such an order (neither the feed nor the
    client mirror sees `status` or `refund_state`) and shows the refusal as it
    is;
  - the pre-send gate answers `refund_started` (any refund lifecycle) or
    `order_progressed` (ready, out for delivery, delivered) and parks the order
    `blocked` with that `sync_blocked_reason`, the same way as
    `order_cancelled`. A `preparing` order is still sent, because an unpaid card
    order an administrator advanced reaches its first send only when the payment
    lands.
- **There are currently TWO of that index, and this line named only one.** The
  2026-09-02 audit found `orders_lazywait_deadline_queue_idx`
  (`20260721120000_lazywait_confirmation_lifecycle.sql:1126`) with a definition
  **identical** to `orders_lazywait_queue_idx` — same column, same predicate,
  different name, so `create index if not exists` could not dedupe them. Both are
  live and both are being scanned (45,808 and 34,622), which is what
  interchangeable indexes look like. Every insert and every sync-state update on
  `orders` maintains both for one query's benefit.
  `20260902120000_orders_index_cleanup.sql` drops the duplicate; it was **applied
  2026-09-02 12:37 UTC** (ledger row 78, `docs/MIGRATIONS.md` §42), so one of the two is gone.

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

**DEFERRED off the checkout kick entirely (2026-08-27, second revision).**
Capping it at 1.5 s was not enough: on SM-2026-000067 the search spent the
**whole cap** and still returned nothing, so the customer waited 1.5 s for a
value that could not arrive. It now runs AFTER the response on the kick path,
alongside the push drain, and keeps its full inline 8 s on the cron path.

**It was deferred rather than deleted, and that distinction is the whole
design.** Moving it "to the cron path" would have looked equivalent and been a
silent feature removal: the kick now syncs every order the moment it is placed,
so every observed cron tick reports `claimed: 0` — a search that only ran there
would never run at all, and `profiles.lazywait_customer_id` would stay null for
ever. Deferring keeps the backfill alive, so the NEXT order for that customer
can carry `customer_id`, while THIS ticket simply uses whatever link is already
stored. The link is a nice-to-have on the ticket; the order number is not.

The superseded first attempt, kept because the measurements are the argument:
**time-boxed to 1.5 s on the checkout kick, 8 s on the cron.** This
lookup measured **3.47 s** on SM-2026-000065 and 3.68 s on -000064 — larger than
the `POST /pos/orders/create` call itself — and returned nothing both times. It
cannot yet do otherwise: `profiles.lazywait_customer_id` has never been populated
for anybody (0 of 10 rows), so there is no stored link for a match to supersede.

Its old 8 s ceiling alone exceeded most of `order-intake`'s whole 11 s budget, so
one slow CRM response could spend the entire window and leave the customer with
no branch number for an order that synced perfectly.

Capping it is **safety-positive, not merely faster**: the search sits *before*
`begin_lazywait_create_attempt`, so every millisecond it burns is deadline budget
spent before that gate re-checks `pos_sync_deadline_at`. The stored link is still
read and used; only the refresh is bounded, and the cron path — where nothing is
waiting — keeps the full 8 s so a slow CRM still gets its chance to establish the
link.

## The worker has two modes, and the fast one syncs exactly one order

`lazywait-sync` behaves differently depending on who invoked it. Nothing about
the payload, the claim predicate or the retry rules differs — only *how much* it
does before returning. The two claims keep byte-identical predicates apart from
the id filter and the ordering; `20261012120000` added the same
`status <> 'cancelled'` line to both.

| | **Targeted** (`{orderId}`) | **Untargeted** (`{limit: n}`) |
| --- | --- | --- |
| Invoked by | `order-intake`, per checkout | cron job 2, and the post-payment handoff in `_shared/paymentSync.ts` |
| Claim | `claim_lazywait_sync_one` | `claim_lazywait_sync_batch` |
| `reap_stale_lazywait_syncs` | runs, **deferred** past the response | runs, awaited |
| Notification drain | runs, **deferred** past the response | runs, awaited |
| CRM search | **deferred past the response** (8 s there) | 8 s, inline |

Untargeted is byte-for-byte the old behaviour. Targeted exists because the kick
used to send `{limit: 5}`, and `claim_lazywait_sync_batch` orders by `created_at`
**ascending** while the worker processes serially — so the customer's brand-new
order was handled **last** of whatever the batch claimed, and their checkout
blocked while other people's orders were sent to the POS.

**The reaper is deferred, never skipped**, and the distinction is the point.
`reap_stale_lazywait_syncs` has exactly one production caller — this worker — so
the cron and the checkout kick are also its only two reaping drivers, and they do
**not** share a failure mode: `invoke_lazywait_sync_processor()` returns early
without invoking anything when the vault secret `lazywait_sync_project_url` is
missing, whereas the kick builds its URL from `SUPABASE_URL`. Skipping the reaper
on the kick path would save the same ~0.9 s and leave one missing secret able to
stop all reaping — and a **cash** order stranded in `syncing` with no ref is
invisible to the watchdog as well, since R1 and R7 both require
`payment_status = 'paid'`.

Deferring is safe because everything the reaper decides is time-thresholded
(`STALE_SYNC_TIMEOUT_MINUTES` = 10), so nothing it would act on can have become
stale during the invocation that deferred it. Both deferrals degrade to
*awaiting* — never to skipping — on a runtime without `EdgeRuntime.waitUntil`.

**The sweeps run when the integration is off or misconfigured (F-X09-002, 2026-11-24).**
Orders keep entering `pending` whatever the integration switch says (`place_order`
and the insert trigger do not read it), and the reaper is also the deadline sweep —
branch (d) dead-letters a `pending` or `failed` order past
`pos_sync_deadline_at` and queues its `pos_failed` message. The worker used to
answer `disabled` / 503 / 401 / 500 before reaching it, so a switched-off
integration left every queued order on "sending to the branch" with no deadline,
then dead-lettered the whole backlog in one burst when it was switched back on.
The order is now: authenticate the caller (`x-sync-secret`, unchanged), run the
reaper, then the exits — `disabled`, base URL unresolvable, `client_id` / token
missing — and each of those drains the queued customer messages before it
returns. **Nothing that claims an order or calls the POS sits above those exits**
(`lazywaitSweepsWiring.test.ts` pins that), so a disabled integration still sends
nothing. Two consequences to know: a disabled integration with no trigger secret
still answers 200 `disabled` and sweeps nothing (there is no one to
authenticate), and an order left `pending` past its 10-minute deadline during an
outage now becomes `dead_letter` on time, with the customer told, instead of at
re-enable.

**A connection that was never established is a safe retry (F-X09-003, 2026-11-24).**
`lazywaitFetch` turned every thrown fetch error into `status: 0`, which
`classifyCreateOrderResult` reads as ambiguous, so a POS outage sent every order
to `confirmation_required` — never resendable, never refunded. It now reports
`neverConnected` when the error PROVES nothing was written
(`classifyConnectFailure`): DNS failure, connection refused, or a TLS handshake
rejected, recognised from Node codes (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`,
certificate codes) or from Deno/hyper's `client error (Connect)`, which that
runtime raises only before a connection exists. Such an order is `safe_retry`
(reason `connect_failed`) and takes the 429 branch: `failed`, the known-failure
normalizer clears the phase marker, and it becomes resendable and, once the
budget is spent, refundable. Anything not provable stays ambiguous: timeouts and
aborts, `ECONNRESET`, `EPIPE`, `ETIMEDOUT`, `EHOSTUNREACH`, `client error
(SendRequest)`, body-read failures, and any chain mixing a connect marker with a
send-side or timeout signal. **The Deno wording is taken from hyper's documented
error kinds, not observed on this project's Edge runtime** — if its messages
differ, the failure simply stays ambiguous (the previous behaviour). A health
probe or breaker, so a known-down POS holds orders instead of burning each one,
is not part of this change.

**Deployed 2026-11-24 as `lazywait-sync` v26** (with the paid-lookup deferral of
`docs/PAYMENTS.md`, #526), so the sweeps and the connect-failure classification
above are live. One comment in `_shared/lazywait.ts` (lines 496-499) differs from
the repository in its line wrapping; the code is identical.

**Redeployed 2026-11-24 11:12 UTC as `lazywait-sync` v27** (the #535 changes: the
labelled customer note above, and the push drain counting a dispatch only when
`push-dispatch` answered `ok`), from the default branch at `70b72d5`. Seven of
the eight bundle files read back byte-identical. The same comment in
`_shared/lazywait.ts` differs again, now at **lines 496-497** (the line break after
"`is_paid`" sits one word later in the live copy); size and line count are
unchanged and the code is identical once comments are removed. It was not
redeployed for a comment. This supersedes the line numbers in the v26 paragraph
above.

## Online payment (prepared, not live)
*Changed 2026-11-12: this said "the Geidea webhook". The provider is Moyasar
(owner decision, 2026-11-11), and online payment was off on that date.*

After Moyasar's payment is verified server-side and `confirm_order_payment` marks
the local order paid, the confirmation (`_shared/moyasarVerify.ts`, reached from
`payment-webhook`, `payment-verify` or the admin re-verify) best-effort calls
`POST /pos/orders/update-online-payment` with the **server-trusted** total (only
if the order already has a `lazywait_ref`). Never called from the frontend; never
fatal. It sends every field Lazywait's documentation marks required:
`Approval_No` and `transaction_uuid` (both Moyasar's payment id), `Card_Type`
(the card scheme, such as `MADA`), `Card_Number` (`****` and the last four),
the three terminal ids as the fixed `MOYASAR-APP`, plus `status: 'approved'`
and the label `names` ("ONLINE CREDIT CARD" / «بطاقة ائتمانية»),
`_shared/paymentSync.ts`. *Changed 2026-11-19: this said `Card_Type: 'card'`,
then `'Online Credit Card'`.*

**REMOVED 2026-11-19 — the paragraph above is history.** The call was deleted
(owner: "remove it"). Once the ticket's own payment line worked (POS #11:
Grand total 222.00 / Paid 222.00 / Remaining 0.00, APPLE PAY - MADA), the
separate call was accepted by Lazywait and recorded nothing, and it would have
counted the payment twice had it ever started to. The confirmation now only
kicks `lazywait-sync`; the payment travels on the ticket as its
`order_payments` line, created paid (`posOrderPayments`). The four payment
functions carry the change only once redeployed. `paymentPosTiming.test.ts`
drives the real handlers and finds no POS request on any confirmation, and
`paymentSyncDisclosure.test.ts` fails if `update-online-payment` reappears in
`paymentSync.ts`, `moyasarVerify.ts` or `lazywait-sync`.

## Webhook receiver (`lazywait-webhook`)
Verifies `X-LazyWait-Signature` = HMAC-SHA256 **hex** of the body with the
webhook secret (checked against the raw body AND re-serialized JSON). Invalid →
401. Reads `X-LazyWait-Event`; maps `order_ref`→local order and records
`lazywait_status` (does NOT auto-flip the customer-facing local status). Unknown
events are verified, logged, and accepted (200) — never throw.

### Two silent failure modes, fixed 2026-09-02 (source only — see Deployment)

Both were the same shape: **a result that was never looked at.** supabase-js
resolves with `{ error }` rather than throwing, so a write that failed reads
exactly like one that succeeded unless somebody destructures it.

**1. A missing webhook secret returned 200.** The handler answered
`{status:'ignored', reason:'webhook secret not configured'}` with a **200**, which
is an acknowledgement — it tells Lazywait the delivery succeeded, so the event is
never retried and is gone for good. A configuration slip would have silently
discarded real POS callbacks for as long as it lasted. It now returns **503**,
which keeps the event in Lazywait's retry queue and is exactly what
`whatsapp-webhook` already did for the identical condition. Two functions, one
rule.

**2. The log row claimed success unconditionally.** The `orders` update ran as
`.eq('id', …).then(() => {}, () => {})` — the result discarded — and the
`integration_sync_logs` insert that followed hardcoded `status: 'success'` with
`error: null`. A dropped POS status change left behind a row asserting it had
landed, which is the worst shape a log can take: it is the row an operator reads
when they are trying to work out what happened. The status now comes from
`syncLogOutcome` in `_shared/syncLog.ts`, so a failed lookup or update produces
`status:'failed'` plus a bounded, PII-free error string. The log insert's own
failure is now `console.error`'d instead of swallowed — losing the log must not
fail an authenticated callback, but "best effort" is not "unobservable".

**Unchanged on purpose:** an authenticated callback whose `order_ref` we do not
recognise is still a **200**. Making the POS retry a callback for an order that
does not exist locally would achieve nothing. Both properties are pinned by
`_shared/webhookReliabilityWiring.test.ts`.

> **DEPLOYED 2026-09-02 as version 2** (v1 → v2), on explicit owner approval,
> `verify_jwt` preserved at `false`. Both fixes are live.
>
> **The bundle was scoped to the change, deliberately.** `lazywait-webhook` had
> not been redeployed since **2026-07-09**, so shipping the current repository
> tree would also have swept in two months of unrelated drift — `_shared/lazywait.ts`
> alone would have gone from 230 to 1 133 lines. That module is imported for
> exactly ONE symbol here (`verifyWebhookSignature`), and the three functions this
> handler actually reaches — `verifyWebhookSignature`, `hmacSha256Hex`,
> `timingSafeEqual` — were verified **byte-identical** between the deployed copy
> and the repository first. So the shared modules were re-sent unchanged and the
> bundle diff is exactly: the new `index.ts` plus its new dependency
> `_shared/syncLog.ts`. Signature verification is provably untouched.
>
> Verified after deploying, without sending a synthetic callback (a forged
> payload would either prove only the signature gate or write a real log row):
>
> | check | result |
> | --- | --- |
> | `GET` unauthenticated | **405** `{"error":"Method not allowed"}` — from the handler, so `verify_jwt` is still off; a platform gate would have returned 401 |
> | `POST` unsigned | **401** `{"error":"invalid signature"}` — and reaching that line proves it got PAST the `!secret` check, so config still reads and the new 503 branch correctly did not fire |
> | bundle read back | `index.ts` byte-identical to the merged source; 503 branch, `syncLogOutcome`, `status: outcome.status` and the `console.error` guard all present; no swallowing `.then` in code |
> | `integration_sync_logs` | 76 rows before and after — the probes wrote nothing |

## Admin monitoring
Admin → Settings → Integrations → **Lazywait Sync Monitor**: branch mapping
(with unmapped count), per-order sync state / POS ref / attempts / blocked-reason
/ last-error, and a **Retry** button (failed/blocked/dead-letter; delivery orders
are retryable since `20260827120000`, except one parked at
`delivery_schema_unconfirmed`, which is `not_retryable` by design). Accountants can view but not edit. Secrets are never shown.

**The monitor lists the 50 newest orders whose sync state is set and not
`skipped`**, read through `admin_lazywait_sync_monitor` (migration
`20261009120000`). The server filters them and returns twelve sync columns and
no customer field. It also returns `pos_sync_deadline_at`, so the console's
requeue-eligibility mirror no longer offers Retry on an order past its
deadline.

Before that it read the general staff order feed. From 2026-11-12 that was `admin_list_orders(200)`, kept down to 50 in
the browser, and before that `admin_list_orders(null)`, every order with
customer names, phones, notes and addresses (63 MB and 2.7 s at 50 000 orders).
The 200-row window also meant a failed order older than the 200 most recent was
not listed; the server-side filter removes that gap. The order-integrity
watchdog and the Live Orders board are unchanged. The mapping screen's read of `lazywait_catalog_items` no longer
fetches the `raw` snapshot column, which it never displayed.

## Deployment
```bash
# 1) DB migration. NEVER `supabase db push` against Production (CLAUDE.md §8,
#    permanently forbidden). Apply each file by version through the
#    owner-approved workflow in docs/MIGRATIONS.md. For a LOCAL database only,
#    the first migrations were:   20260708130000_lazywait_integration
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
  asserts the two are equal. The live `lazywait-sync` worker syncs **pickup and
  delivery** as of worker v6 (2026-08-27); what it sends for delivery is the
  confirmed-fields-only set described above, not the typed client's assumed
  block. Remaining assumed field names are in the reference doc's
  "STILL ASSUMED" section.
- **Payment endpoints** (`update-cash-payment`, `update-online-payment`) are
  typed/serialized/validated only in this client. *(2026-11-12: this said live
  wiring stays frozen. The freeze is lifted for repository work; the live call is
  the one in "Online payment" above, and it runs only once online payment is on.)*
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
- ~~Delivery Create Order schema, addons/modifiers, `price_id`, and
  `customer_cell`/`customer_id` in Create Order are **not confirmed** → not
  sent.~~ **Superseded.** The owner-supplied contract of 2026-08-24 confirmed
  add-ons, `price_id`, `customer_cell`/`country_code` and `customer_id`; add-ons
  went live 2026-08-26 and delivery on 2026-08-27, proven by SM-2026-000059.
  What remains genuinely unconfirmed is narrower and listed under "Still
  intentionally NOT sent": coordinates, the `order_deliveries[]` element shape,
  and `order_status_id`. The money fields left that list on 2026-08-27 when Q9
  was answered by a printed ticket. **Q8 is answered too, and negatively** — the
  POS does NOT render `delivery_address`, which is why the duplicate line in
  `order_details` is permanent.
  **Corrected 2026-11-24 (F-X20-003):** the console's catalog-mapping screen
  still told operators that `price_id`, add-ons and delivery are "intentionally
  NOT sent in Create Order yet", which had been false since 2026-08-26/27 and
  could lead an operator to "fix" an add-on the POS already has. Its caption now
  says a confirmed mapping is used when an order is sent (the mapped price tier
  and add-ons go in Create Order, delivery orders go with their address) and that
  an add-on with no mapping is written into the item's kitchen note rather than
  dropped. The builder's own code comments (`_shared/lazywait.ts`) are a
  separate, no-runtime-effect cleanup and were not touched here.
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
The single-branch pilot is **done**: catalog mapping, pickup, add-ons, variant
`price_id` and now delivery have all created real POS tickets on the live host.

Next, in order:

1. **Close Q8 by looking at a printed delivery ticket.** If `delivery_address`
   renders, drop the duplicate line from `order_details` — on evidence. No API
   response can answer this.
2. **Decide what to do with the four parked delivery orders**
   (SM-2026-000032, -000049, -000057, -000058). All carry the retired
   `delivery_schema_unconfirmed` reason, are `not_retryable` by design, and
   would create real kitchen tickets for food nobody is waiting for if
   re-driven. Leaving them parked is the current decision.
3. **Widen to all branches** once Q8 is closed.

## The POS base URL is allowlisted (2026-09-14)

`integration_settings.public_config.base_url` decides where every Lazywait
request goes, and `lazywaitFetch` attaches the live POS **Bearer token** to it.
Until 2026-09-14 `resolveLazywaitBaseUrl` validated only *shape* — deliberately,
so that "a real host change is never blocked by a validator".

The 2026-09-13 audit showed the cost. That column is edited in a browser by an
administrator. Any well-formed URL was accepted, so a single save plus one
"Pull catalog" would send the live token to an arbitrary host; the same field
could reach `169.254.169.254` or anything else inside the function's network.

`resolveLazywaitBaseUrl` now additionally requires:

- **https only** — `http:` used to be accepted, putting the token in cleartext;
- **the host on an allowlist** — `lazywait.com` and its subdomains by default,
  extendable via the `LAZYWAIT_ALLOWED_HOSTS` Edge Function environment
  variable. An env var, not another DB column, so changing it needs a deploy and
  cannot be done from the console by the actor in the attack above;
- **no IP literals** — dotted-quad, bare decimal (`2130706433`), hex
  (`0x7f000001`) and IPv6 are all refused.

It is an **allowlist, not a blocklist**, on purpose: blocklists of "bad" hosts
are evadable by construction (alternate notations, redirects, DNS rebinding).

A new reason, `LAZYWAIT_BASE_URL_HOST_NOT_ALLOWED`, is distinct from
`..._INVALID` so an operator who mistyped a hostname is told something different
from one who pointed the integration somewhere it may not go.

**Nothing legitimate breaks.** The host in use today
(`apiv2-dev.lazywait.com`) and the production host a move would use
(`apiv2.lazywait.com`) are both `lazywait.com` subdomains.

**Deployed 2026-11-18, two months after the merge.** Until then the live
`lazywait-sync` and `lazywait-catalog` bundles carried the older
`resolveLazywaitBaseUrl`, which accepted any `http:` or `https:` host
(`docs/readiness/20261111-app-hardening-checklist.md`, S05). Both were deployed
from the default branch at `5c78d17` for the API-key switch-over:
`lazywait-sync` v15 and `lazywait-catalog` v7, every file byte-identical. The
stored base URL was read live first (`https` on `apiv2-dev.lazywait.com`) and
passes the allowlist.

**One existing test was revised rather than deleted.** `lazywait.test.ts` had a
case asserting the guard was "shape only", listing `some-new-pos.example.com`,
`localhost:54321` and `10.0.0.4:8443` as values that MUST resolve. That was a
genuine contract and it is now wrong; it is rewritten in place with the reason
recorded, because left alone it would have stood as an argument against the fix.

## Supabase API keys in the POS path (2026-11-09)

Two calls in the POS path carry a Supabase key, and both now come from
`supabase/functions/_shared/apiKeys.ts` for the move off the legacy keys
(`docs/SUPABASE_API_KEYS.md`):

- `order-intake` → `lazywait-sync` (the instant kick) sends `publishableKey()`
  as `apikey`. The call is authorized by `x-sync-secret`; the key only
  identifies the project, but a deactivated legacy key there is the one thing
  that could make the gateway refuse the kick and leave orders on the
  once-a-minute cron.
- `lazywait-sync` → `push-dispatch` (the POS-outcome push drain) sends
  `serviceCallHeaders(secretKey())`: the old `apikey` + `Bearer` while only
  legacy keys exist, `apikey` alone once a secret key does.

The POS bearer token, the webhook HMAC and the `x-sync-secret` are untouched.

**Step 9 cleanup (2026-11-18, merged only after step 8 held).** Both calls now
use only the new keys: the instant kick sends the publishable key, or is skipped
without one, and the push drain sends the secret key on `apikey` alone. The
post-payment kick in `_shared/paymentSync.ts` moves from `SUPABASE_ANON_KEY` to
the publishable key in the same change. It reaches Production only with a
separately approved redeploy of the payment functions. Until then the live
bundles keep the old kick. `lazywait-sync` itself ignores `apikey`, but after
step 8 that kick should be treated as refused at the gateway, and the
once-a-minute cron picks the paid order up on its next run
(`SUPABASE_API_KEYS.md` §2).

## Gate refusals that write no row now log the order id (2026-11-11)

`begin_lazywait_create_attempt` is the fenced gate just before the Create Order
POST. Two of its outcomes write nothing: the RPC itself failing, and a status
the worker does not handle (`invalid_state`, `not_found`). Both skip the order,
send nothing, and leave it 'syncing' for the stale reaper.

**`refund_started` and `order_progressed` take it too** (`20261022120000`,
applied 2026-11-22): parked in the same statement, one `skipped`
row each (`refund_started_before_send`, `order_progressed_before_send`), and
the same test drives the real handler with both.

**`order_cancelled` takes the same branch, and is not left 'syncing'**
(`20261015120000`, written 2026-11-17, applied 2026-11-18, ledger row 120). The gate answers it for a
cancelled order at the point an attempt would start, after the ref, state and
marker checks and before the deadline checks, and parks the order itself, in
the same locked statement, as `blocked` / `order_cancelled` with one `skipped`
sync-log row (`order_cancelled_before_send`). The worker logs the line below
with `"gate_status":"order_cancelled"`, counts the order skipped and writes
nothing, so it cannot overwrite the park. The reaper never touches `blocked`.
`_shared/lazywaitCancelledGate.test.ts` drives the real handler to pin this,
with a control case that does POST. Neither calls
`record_lazywait_sync`, so no `integration_sync_logs` row exists for that
attempt. Until this change the log line was free text without the order id, so
a responder chasing a stuck order could not find the attempt.

Each branch now writes one JSON line, in the shape of `order-intake`'s timing
line. These two were emitted by the real handler against a stub database
(synthetic order ids):

```json
{"at":"lazywait-sync.gate","order_id":"33333333-3333-4333-8333-000000000001","outcome":"rpc_error","sent":false,"error":"canceling statement due to statement timeout"}
{"at":"lazywait-sync.gate","order_id":"33333333-3333-4333-8333-000000000002","outcome":"not_ready","sent":false,"gate_status":"invalid_state"}
```

- `rpc_error` is logged with `console.error` and `not_ready` with
  `console.warn`, the levels the free-text lines used.
- `order_id` is the UUID on the claimed row, never a value from the request.
  Nothing about the customer is logged. `error` is the existing `safeErr` text.
- To find an order's attempt, search the function's logs for the order's UUID.

Control flow is unchanged. Both branches still count a skip and move to the next
order, and the same stub run showed it: identical RPC sequence before and after,
no `record_lazywait_sync`, no outbound request.
`_shared/lazywaitGateLogWiring.test.ts` pins the fields and the control flow.

**Live only after `lazywait-sync` is redeployed**, a §5 action with its own
approval. The bundle is the whole current source, so the deploy also ships the
2026-11-09 key handling above, and the 2026-09-14 base-URL allowlist, whose
deploy is not recorded here. If `push-dispatch` is deployed in the same session,
deploy it first (`docs/OWNER_ACTIONS.md` §42: receivers before senders).

**Live since 2026-11-18.** `lazywait-sync` was deployed as **v15** (from v14)
from the default branch at `5c78d17`, on the owner's word ("deploy the 9
key-switch functions"), after `push-dispatch` (v10, the same day). Every file
read back byte-identical to the bundle, and `verify_jwt` stays `false`. So the
gate lines above, the 2026-11-09 key handling and the base-URL allowlist are now
the running code. Detail: `docs/SUPABASE_API_KEYS.md` §3 "Progress".
