# Lazywait API v2 — Reference (scaffold)

> **This is a repo-maintained SCAFFOLD, not the vendor document.** The verbatim
> **Lazywait API Reference** is **owner-supplied** and, when provided, MUST be
> committed here to **replace/augment** this file. Every field marked
> **[ASSUMPTION]** below is a documented guess that Lazywait must confirm — see
> the "ASSUMPTIONS TO CONFIRM WITH LAZYWAIT" section at the end.

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
| POST | `/pos/orders/create` | `createOrder` | confirmed pickup **C**; delivery/add-on **[A]**, gated |
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
| `menu_item_id` / `category_id` / `branch_id` / `addon_id` / `addons_group_id` / `price_id` | catalog + orders | string |

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

## ASSUMPTIONS TO CONFIRM WITH LAZYWAIT

The full pickup **+ delivery + add-on** Create Order body is implemented and
tested, but every field below is an **assumption** the client will only send when
the caller passes **`allowAssumedFields: true`** (default **OFF** — nothing here
reaches the live POS until confirmed). The live `lazywait-sync` worker is **not**
rewired: it stays pickup-only and blocks delivery. These map 1:1 to the 8 open
questions in `docs/lazywait-delivery-open-questions.md`.

### Assumed field names/shapes (please correct)
| Assumed field | Assumed shape | Used for | Source of the guess |
|---|---|---|---|
| `order_type: "delivery"` | string | delivery create | Q1 — does create support delivery? |
| `delivery_address` | string (full formatted address) | delivery | Q2 — required address fields? |
| `latitude`, `longitude` | number | delivery | Q3 — lat/long accepted? |
| `customer_cell` | string, E.164 (via `normalizePhone`) | delivery/customer | Q4 — customer phone accepted? |
| `delivery_notes` | string | delivery | Q5 — notes/instructions accepted? |
| `delivery_fee` | number | delivery | Q6 — delivery fee accepted? |
| `is_paid` | boolean | order | Q7 — can the POS show paid vs cash-required? |
| (address/lat-long visibility) | n/a | delivery | Q8 — can the driver/cashier see the location clearly? |
| `customer_id` | string (CRM id) | customer link | catalog mapping `profiles.lazywait_customer_id` |
| per-item `price_id` | string | order item | catalog mapping `products.lazywait_price_id` (was "reference only") |
| per-item `addons` | `[{ addon_id, addons_group_id, name, price, quantity }]` | order item add-ons | catalog mapping `modifiers.lazywait_addon_id` + `modifier_groups.lazywait_group_id` |

### Other items to confirm
- Dev vs prod base URL + compatible API-key prefix (`lw_live_` vs `lw_test_`).
- `POST /menu/products/item` create/upsert **vs** `PUT` update-only semantics.
- The `user` object schema for product updates.
- Product/category DELETE response `Content-Type` (we accept plain-text `ok`).
- The exact identifier mechanism for the non-path DELETEs (product/category) —
  currently sent as a query param (`menu_item_id` / `category_id`).
- `POST /pos/orders` reference-list field name (assumed `order_refs`).

When Lazywait confirms, update this file (or replace it with the vendor
reference), then relax the gate/worker per
`docs/lazywait-delivery-open-questions.md`.
