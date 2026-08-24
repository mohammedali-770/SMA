# Lazywait API v2 — Reference (scaffold)

> **This is a repo-maintained SCAFFOLD, not the vendor document.** The verbatim
> **Lazywait API Reference** is **owner-supplied** and, when provided, MUST be
> committed here to **replace/augment** this file. Every field still marked
> **[ASSUMPTION]** below is a documented guess that Lazywait must confirm — see
> the "ASSUMPTIONS TO CONFIRM WITH LAZYWAIT" section at the end.
>
> **Partial contract received 2026-08-24.** The owner supplied a Lazywait
> **Create Order** document covering `POST /pos/orders/create`. It has been
> folded in below: several fields are now **confirmed**, four repo assumptions
> were **corrected**, and the rest stay assumed. One endpoint's document does
> **not** make this file the vendor's reference — the scaffold warning stands
> for the other 26 endpoints.
>
> **Read from the DEV host.** That contract was documented on
> `https://apiv2-dev.lazywait.com/v1`. `DEFAULT_BASE_URL` in
> `supabase/functions/_shared/lazywait.ts` remains the **production** host
> `https://apiv2.lazywait.com/v1` and was deliberately **not** changed.
> **Field-level parity between the dev and production hosts is UNVERIFIED.**

Typed client: `supabase/functions/_shared/lazywaitApi.ts`
(request interfaces + pure serializers + runtime validators for all 27 endpoints,
layered over the audited transport in `supabase/functions/_shared/lazywait.ts`).
Contract tests: `supabase/functions/_shared/lazywaitApi.test.ts` with synthetic
fixtures under `supabase/functions/_shared/__fixtures__/lazywait/`.

- Base URL + `client_id` are non-secret (`integration_settings.public_config`).
- The API token is a **server-only** `Bearer` secret, injected by `lazywaitFetch`
  and never present in any serialized body/query, log, or client bundle.
- Environment note (issue #104): examples use `https://apiv2-dev.lazywait.com/v1`
  with an `lw_live_` placeholder — the correct env URL + key prefix must be
  confirmed with Lazywait before production use.

## Endpoint coverage (27)

Legend: **C** = confirmed/known casing · **A** = assumption pending Lazywait.

### POS orders (9)
| Method | Path | Client method | Notes |
|---|---|---|---|
| GET | `/pos/order` | `getOrder` | query `branch_id`, `order_ref` |
| GET | `/pos/orders/active-orders` | `getActiveOrders` | optional `branch_id`, `user_id`, `lookback` |
| GET | `/pos/orders/search` | `searchOrders` | `query` (+ pagination when both) |
| POST | `/pos/orders` | `fetchOrders` | body `order_refs: string[]` **[A]** |
| POST | `/pos/orders/create` | `createOrder` | contract 2026-08-24 **C** (pickup, add-ons, notes, phone split); delivery **[A]**, gated |
| PUT | `/pos/orders/:order_ref` | `updateOrder` | `order_items` = **full replacement** **[A]**; `order_ref` in path only |
| POST | `/pos/orders/update-cash-payment` | `updateCashPayment` | `Trans_Amount` **C** — Tap-frozen, typed only |
| POST | `/pos/orders/update-online-payment` | `updateOnlinePayment` | `Trans_Amount`/`Approval_No`/`Card_Type`/`Card_Number` **C** — Tap-frozen, typed only |
| POST | `/pos/orders/void-all` | `voidAll` | `cancelation_reason` (documented spelling) **C** |

### Menu products (6)
| Method | Path | Client method | Notes |
|---|---|---|---|
| GET | `/menu/products/items` | `listItems` | pagination `offset`+`limit` only when BOTH present |
| GET | `/menu/products/item` | `getItem` | query `menu_item_id` |
| POST | `/menu/products/item` | `createProduct` | create/upsert **[A: confirm vs update]** |
| PUT | `/menu/products/item` | `updateProduct` | update-only **[A: confirm]**; `user` object shape **[A]** |
| DELETE | `/menu/products/item` | `deleteProduct` | identify by query `menu_item_id` **[A]**; returns plain-text `ok` |
| POST | `/menu/products/delete-items` | `deleteProductsBulk` | body `menu_item_ids: string[]` |

### Menu categories (5)
| Method | Path | Client method | Notes |
|---|---|---|---|
| GET | `/menu/products/categories` | `listCategories` | |
| POST | `/menu/products/category` | `createCategory` | create/upsert |
| PUT | `/menu/products/category` | `updateCategory` | update |
| DELETE | `/menu/products/category` | `deleteCategory` | identify by query `category_id` **[A]**; returns plain-text `ok` |
| POST | `/menu/products/delete-categories` | `deleteCategoriesBulk` | body `category_ids: string[]` |

### Addons (6)
| Method | Path | Client method | Notes |
|---|---|---|---|
| GET | `/menu/addons` | `listAddons` | |
| GET | `/menu/addons-groups` | `listAddonGroups` | |
| POST | `/menu/addons` | `createAddon` | `alert_level` NUMERIC **C**, `consumption` OBJECT **C** |
| DELETE | `/menu/addons/:addonId` | `deleteAddon` | path param |
| POST | `/menu/addons-groups` | `createAddonGroup` | `auto_selected_addons` + `included_custom_addons_ids` STRING[] **C** |
| DELETE | `/menu/addons-groups/:addonsGroupId` | `deleteAddonGroup` | path param |

### Platform (1)
| Method | Path | Client method | Notes |
|---|---|---|---|
| GET | `/platform/branches` | `listBranches` | branch id mapping source |

## Field casing (preserve exactly — case-sensitive)
| Field | Where | Type |
|---|---|---|
| `Trans_Amount` | cash/online payment | number (server-trusted) |
| `Approval_No` | online payment | string |
| `Card_Type` | online payment | string |
| `Card_Number` | online payment | string (redacted from logs) |
| `transaction_uuid` | payment | string (stable per gateway txn) |
| `cancelation_reason` | void-all | string (documented spelling — one "l") |
| `alert_level` | addon | **number** (not string) |
| `consumption` | addon | **object** (not scalar) |
| `auto_selected_addons` | addon group | **string[]** |
| `included_custom_addons_ids` | addon group | **string[]** |
| `menu_item_id` / `category_id` / `branch_id` / `addon_id` / `price_id` | catalog + orders | string |
| `addons_group_id` | **catalog only** (`/menu/addons`, `/menu/addons-groups`) — NOT on a create-order add-on | string |
| `menu_category_id` | create-order item (contract 2026-08-24) | string |
| `country_code` | create-order, separate from `customer_cell` | string (`"+966"`) |
| `order_delivery_fee` | create-order (NOT `delivery_fee`) | number |
| `order_details` / `details` | create-order order-level / per-item note | string |

## Create Order — server-owned identity fields (NEVER sent in create/update)
`order_ref`, `order_id`, `order_number`, `order_date` are owned by the POS and are
stripped from every create/update body (enforced in `serializeCreateOrder` /
`buildUpdateOrderRequest`; `order_ref` on update travels in the URL path only).

## Retry / idempotency safety
Create Order has **no idempotency key**. The client refuses to re-POST once a
Lazywait `order_ref` is stored (`shouldResendCreateOrder`), and outcomes are
classified by `classifyCreateOrderResult` so a customer is never told "confirmed"
without a usable `order_ref` (ambiguous → confirmation-required, never a blind
resend).

---

## Create Order body — CONFIRMED 2026-08-24

Source: the owner-supplied Lazywait Create Order document, read from the **dev**
host (see the provenance caveat at the top). Per that document only `client_id`,
`branch_id` and a non-empty `order_items` are **required**; every other field is
optional. Identity fields are generated server-side and cannot be set.

Built by `buildCreateOrderPayload` (`supabase/functions/_shared/lazywait.ts`),
which the live `lazywait-sync` worker calls directly.

| Field | Source | Notes |
|---|---|---|
| `client_id`, `branch_id` | config, `branches.lazywait_branch_id` | required |
| `order_type: "pickup"` | — | delivery still BLOCKED |
| `source: "LWAPI"` | — | |
| `customer_name` | `orders.customer_name` \| `"Guest"` | |
| `customer_id` | `profiles.lazywait_customer_id` | CRM id; omitted on a miss |
| `customer_cell` + `country_code` | `orders.customer_phone`, split | **local** subscriber + dialling code |
| `order_details` | `orders.notes` | order-level note |
| `is_paid` | `orders.payment_status = 'paid'` | |
| `order_items[].menu_item_id` | `products.lazywait_item_id` | required mapping |
| `order_items[].name` | `order_items.name_en` | **undocumented but kept** — see below |
| `order_items[].names {en,ar}` | `order_items.name_en/name_ar` | |
| `order_items[].menu_category_id` | `categories.lazywait_category_id` | |
| `order_items[].price_id` | `products.lazywait_price_id` | no longer "reference only" |
| `order_items[].quantity`, `.price` | `order_items` | `price` is VAT-**inclusive** |
| `order_items[].details` | `order_items.note` | **key absent when there is no note** |
| `order_items[].addons[]` | `order_item_modifiers` × `modifiers.lazywait_addon_id` | `{addon_id, name, names{en,ar}, quantity, price: 0}` — **price is always 0**, see below |

**`name` is sent IN ADDITION to `names{en,ar}`, deliberately.** `name` is not in
the contract, yet pickup sync has worked in Production with it since the pilot —
evidence the API tolerates undocumented fields. Dropping the field the POS may
actually be reading, on the strength of one dev-host document, would risk
unnamed live tickets. If a later Production check shows `names` is what the POS
reads, `name` can be removed then.

**Not sent, though confirmed to exist:** `is_included_in_custom_addons` (name
confirmed, semantics not — we hold no column that means it), `order_status_id`,
`created_by`, `order_pickup_date`, `total_calories`, `printer_ids`,
`customer_email`, `user_*`, `table_*`, `area_*`, `people_count`, and all
order-level **money** fields (see below).

### Add-on prices are always 0 (open question Q10)
`place_order` folds modifier prices into `order_items.unit_price`
(`v_unit_price := v_unit_price + v_modifier.price`), and `unit_price` is what we
send as `price`. A "Volcano (+2)" burger therefore already reaches the POS at the
+2 price. Echoing the add-on's own price would let a POS that sums item +
add-ons charge the +2 **twice**, so `addons[].price` is always **`0`** —
explicitly 0 rather than an omitted key, so the POS cannot substitute its own
catalog price and add that instead. The add-on is still itemised by name for the
kitchen. Pinned by test.

### Money and totals — deliberately NOT sent (open question Q9)
The contract's example is **exclusive-VAT**: `subtotal: 30` + `tax: 4.5`
(`tax_percentage: 15`) = `total: 34.5`. Our prices are **VAT-inclusive**, so our
`subtotal` for that basket is 34.5, not 30. The document does not say whether the
POS trusts these fields or recomputes from them, so any mapping would be a guess
about a real-money figure on a live customer path. Nothing order-level is sent:
not `subtotal`, `discount`, `tax`, `tax_percentage`, `taxes_charges`, `tip`,
`tip_percentage`, `total` or `order_delivery_fee`. The per-item `price` **is**
sent and is VAT-inclusive, as it has been throughout the pilot. The existing rule
that the **Lazywait response total is NOT trusted** is unchanged.

### Corrected 2026-08-24 — repo assumptions the contract DISPROVED
| Was assumed | Actually | Where fixed |
|---|---|---|
| `delivery_fee` | **`order_delivery_fee`** | `serializeCreateOrder` |
| `delivery_notes` | **no such field** — order note is `order_details`, per-item note is `order_items[].details` | removed from the request type |
| add-on `addons_group_id` | **not on a create-order add-on** (still valid on the *catalog* endpoints) | removed from the add-on shape |
| `customer_cell` as E.164 | **split**: local subscriber in `customer_cell`, dialling code in `country_code` | `splitPhoneForPos` |

These are no longer marked `[ASSUMPTION]` anywhere — an assumption that is known
to be wrong must not survive as an assumption.

---

## ASSUMPTIONS TO CONFIRM WITH LAZYWAIT

The remaining unconfirmed fields are assembled **only** when the caller passes
**`allowAssumedFields: true`** (default **OFF** — nothing here reaches the live
POS until confirmed). The live `lazywait-sync` worker is **not** rewired: it
calls `buildCreateOrderPayload` and blocks delivery. See
`docs/lazywait-delivery-open-questions.md`.

### Still assumed (please correct)
| Assumed field | Assumed shape | Used for | Status |
|---|---|---|---|
| `order_type: "delivery"` | string | delivery create | Q1 — the contract documents `"pickup"` only and does not list accepted values; the delivery `order_status_id` is also unknown |
| `order_deliveries[]` | **unknown element shape** | delivery | Q2/Q3 — present but **empty** in the contract's pickup example. Almost certainly where delivery actually lives; this is the missing piece |
| `delivery_address` | string (full formatted address) | delivery | Q2 — the field NAME is confirmed (empty on the pickup example); its use for a real delivery is not |
| `latitude`, `longitude` | number | delivery | Q3 — **absent from the contract entirely.** NOT confirmed by that document; likely belongs inside `order_deliveries[]` rather than at top level |
| `order_delivery_fee` (value) | number | delivery | Q6 name confirmed / Q9 value blocked on inclusive-vs-exclusive VAT |
| `is_included_in_custom_addons` | boolean | order item add-on | name confirmed, semantics unknown — not sent rather than guessed |

### Other items to confirm
- **Field-level parity between `apiv2-dev` and `apiv2` (production).** The
  2026-08-24 contract was read from the dev host; `DEFAULT_BASE_URL` still points
  at production and was not changed.
- Dev vs prod base URL + compatible API-key prefix (`lw_live_` vs `lw_test_`).
- `POST /menu/products/item` create/upsert **vs** `PUT` update-only semantics.
- The `user` object schema for product updates.
- Product/category DELETE response `Content-Type` (we accept plain-text `ok`).
- The exact identifier mechanism for the non-path DELETEs (product/category) —
  currently sent as a query param (`menu_item_id` / `category_id`).
- `POST /pos/orders` reference-list field name (assumed `order_refs`).

When Lazywait confirms the rest, update this file (or replace it with the vendor
reference), then relax the gate/worker per
`docs/lazywait-delivery-open-questions.md`.
