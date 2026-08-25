# Lazywait API v2 — Reference (scaffold)

> **This is a repo-maintained SCAFFOLD, not the vendor document.** The verbatim
> **Lazywait API Reference** is **owner-supplied** and, when provided, MUST be
> committed here to **replace/augment** this file. Every field still marked
> **[ASSUMPTION]** below is a documented guess that Lazywait must confirm — see
> the "STILL ASSUMED" section at the end.
>
> **Partial confirmation, 2026-08-24.** The owner supplied the vendor contract
> for **one endpoint** — `POST /pos/orders/create` — and the Create Order
> sections below now reflect it. That does not make this file the vendor's
> reference: it covers 1 of the 27 endpoints, and it describes a **pickup** order
> and says nothing about delivery. It was read from `apiv2-dev.lazywait.com` —
> **the host this integration actually posts to** (confirmed 2026-08-24; the dev
> host is the live POS for this branch, see `docs/LAZYWAIT.md`), so it describes
> the endpoint we use rather than a different environment's. An earlier revision
> of this note said we POST to production and called host parity unverified; that
> was wrong. The scaffold warning stands regardless: one document covering one
> endpoint is not the vendor reference.

Typed client: `supabase/functions/_shared/lazywaitApi.ts`
(request interfaces + pure serializers + runtime validators for all 27 endpoints,
layered over the audited transport in `supabase/functions/_shared/lazywait.ts`).
Contract tests: `supabase/functions/_shared/lazywaitApi.test.ts` with synthetic
fixtures under `supabase/functions/_shared/__fixtures__/lazywait/`.

- Base URL + `client_id` are non-secret (`integration_settings.public_config`).
- The API token is a **server-only** `Bearer` secret, injected by `lazywaitFetch`
  and never present in any serialized body/query, log, or client bundle.
- Environment note: examples use `https://apiv2-dev.lazywait.com/v1`, which is
  the live POS host for this branch (confirmed 2026-08-24). The `lw_live_` key
  prefix in examples is a placeholder; the real token lives server-side only.

## Endpoint coverage (27)

Legend: **C** = confirmed/known casing · **A** = assumption pending Lazywait.

### POS orders (9)
| Method | Path | Client method | Notes |
|---|---|---|---|
| GET | `/pos/order` | `getOrder` | query `branch_id`, `order_ref` |
| GET | `/pos/orders/active-orders` | `getActiveOrders` | optional `branch_id`, `user_id`, `lookback` |
| GET | `/pos/orders/search` | `searchOrders` | `query` (+ pagination when both) |
| POST | `/pos/orders` | `fetchOrders` | body `order_refs: string[]` **[A]** |
| POST | `/pos/orders/create` | `createOrder` | pickup body **C** (vendor contract 2026-08-24, dev host); delivery **[A]**, gated |
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
| `addons_group_id` | catalog add-on **groups** only — **not** an order add-on field | string |
| `names` | order item + order add-on | **object** `{ en, ar }` (not a string) |
| `details` | order **item** | string (per-item note) |
| `order_details` | order | string (order-level note) |
| `customer_cell` | order | string — **local subscriber number**, never E.164 |
| `country_code` | order | string — dialling prefix, e.g. `"+966"` |
| `order_delivery_fee` | order | number (**not** `delivery_fee`) |

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

## Create Order — the confirmed pickup body (contract 2026-08-24)

Only `client_id`, `branch_id` and a non-empty `order_items` are **required**;
every other field is optional. What `buildCreateOrderPayload` sends today:

```json
{ "client_id": "…", "branch_id": "<lazywait_branch_id>", "order_type": "pickup",
  "order_items": [{
    "menu_item_id": "<products.lazywait_item_id>",
    "name": "<server name>",
    "names": { "en": "Beef Burger", "ar": "برجر لحم" },
    "quantity": 2, "price": 25.00,
    "menu_category_id": "<categories.lazywait_category_id>",
    "price_id": "<products.lazywait_price_id>",
    "details": "No onions",
    "addons": [{ "addon_id": "<modifiers.lazywait_addon_id>", "name": "Extra Cheese",
                 "names": { "en": "Extra Cheese", "ar": "جبن إضافي" },
                 "quantity": 1, "price": 5.00 }]
  }],
  "customer_name": "<profile.full_name|Guest>",
  "customer_id": "<profiles.lazywait_customer_id>",
  "customer_cell": "541234567", "country_code": "+966",
  "order_details": "<orders.notes>",
  "source": "LWAPI" }
```

### Confirmed by the contract, promoted out of the assumed gate
| Field | Source in our data |
|---|---|
| `order_items[].price_id` | `product_variants.lazywait_price_id` (the ordered tier), falling back to `products.lazywait_price_id` for an untiered line |
| `order_items[].menu_category_id` | `products.category_id` → `categories.lazywait_category_id` |
| `order_items[].names{en,ar}` | `order_items.name_en` / `name_ar` |
| `order_items[].details` | `order_items.note` (per-item kitchen note) |
| `order_items[].addons[].addon_id` | `order_item_modifiers` → `modifiers.lazywait_addon_id` |
| `order_details` | `orders.notes` (order-level note) |
| `customer_id` | `profiles.lazywait_customer_id` |
| `customer_cell` + `country_code` | `orders.customer_phone`, split |
| `is_paid` | supported by the builder; **not wired** to the live worker (CLAUDE.md §6) |
| `delivery_address` | **name only** — what a delivery order needs in it is still Q2 |

### Corrections — assumptions the contract proved WRONG
| Was assumed | Actually | Where fixed |
|---|---|---|
| `delivery_fee` | **`order_delivery_fee`** | `serializeCreateOrder` |
| `delivery_notes` | **no such field**; order note is `order_details`, per-item note is `order_items[].details` | removed from `CreateOrderRequest` |
| `addons[].addons_group_id` | not part of the order add-on object; it belongs to the catalog add-on-**group** endpoints. The add-on object is `{addon_id, names{en,ar}, price, quantity, is_included_in_custom_addons}` | `serializeCreateOrderItem` |
| `customer_cell` as E.164 | **split**: local subscriber number in `customer_cell`, prefix in `country_code` | `splitPhoneForPos` |

### Deliberate omissions (confirmed field, not sent)
| Field | Why not |
|---|---|
| `subtotal`, `discount`, `tax`, `tax_percentage`, `total`, `order_delivery_fee` | The contract's example computes `total = subtotal × 1.15` — tax **added on top**. Our prices are VAT-**inclusive**, and the document does not say what the POS does when the tax fields are absent (today's case). Sending a guessed total would disagree with what the customer was charged. Open question **Q9**. |
| `is_included_in_custom_addons` | Nothing in our data model says whether a modifier came through a custom-addons group. Optional, so omitted rather than guessed. |
| `order_status_id`, `created_by`, `order_pickup_date`, `people_count`, `total_calories`, `printer_ids`, `metadata`, `table_*`, `area_*`, `user_*`, `customer_email` | Available and optional; nothing in the current flow needs them, and pickup tickets are correct without them. |
| `name` (item and add-on) | The inverse case: **not** in the contract, but sent anyway. Pickup sync has worked in Production with it, which is evidence the API tolerates undocumented fields and no evidence that dropping it is safe. `names` is sent **in addition to** `name`, not instead of it. If a Production check shows the POS reads `names`, `name` can go then. |

### Money — how a line adds up
`order_items[].price` is the **bare item price**: `order_items.unit_price` already
includes the selected modifiers (`place_order` adds them in), and the contract's
example sums the add-on prices into the order (`25 + 5 = subtotal 30`). Emitting
the modifier-inclusive price *and* the add-on lines would charge add-ons twice, so
the serializer subtracts them back out. The invariant
`price + Σ(addon.price × addon.quantity) === unit_price` is asserted in
`lazywait.test.ts`. The Lazywait response total remains **untrusted**.

---

## `GET /menu/products/items` — the confirmed response shape (observed 2026-08-24)

Not from the contract document: read directly off the **production** host's own
response, cached in `lazywait_catalog_items.raw`. Recorded because the field
names here are what the catalog import depends on, and getting one wrong emptied
the entire app menu without any endpoint reporting an error.

```jsonc
{
  "menu_item_id": "92dd15fb-…", "id": "92dd15fb-…",
  "names":   { "en": "Chicken Wings", "ar": "أجنحة الدجاج" },
  "details": { "en": "Five or ten pieces…", "ar": "خمس أو عشر قطع…" },
  "menu_category_id": "be06eeb9-…",     // NOT `category_id`
  "active": true, "show_online": true, "photo": null, "sort_id": null,
  "source": "XLS",                       // or "DASHBOARD"
  "branches_ids": ["0dDRHGE1hSBZjDvgg1bN", …],
  "prices": [
    { "price_id": "20005a3e-…",
      "names": { "en": "Small", "ar": "صغير" },
      "price": 6.086956521739131,        // <- THE MONEY. EXCLUDES VAT.
      "active": true, "show_online": true, "taxable": true, "calories": 0,
      "menu_item_id": "92dd15fb-…", "menu_category_id": "be06eeb9-…" },
    { "price_id": "85b9b63d-…", "names": { "en": "Large", "ar": "كبير" },
      "price": 11.304347826086957, "active": true, "show_online": true }
  ]
}
```

| Fact | Evidence |
|---|---|
| The price key is **`price`**, not `price_with_vat` / `price_excluding_vat` / `net_price` | all 147 Production price rows carry `price`; only 21 carry `price_with_vat` |
| `price` is **VAT-EXCLUSIVE** | on every row that has both, `price_with_vat === price × 1.15` exactly (45.21739130434783 → 52; 66.08695652173914 → 76). For spreadsheet rows the shelf price is likewise `price × 1.15` (6.086956521739131 → 7.00) |
| An item names its category **`menu_category_id`** | `category_id` is absent from every item |
| The description is **`details{en,ar}`** | same shape as `names` |
| `show_online` appears on the **category, the item AND the price** | e.g. the "Offers" category and the "Change to Wedgez" price are both `false` |
| One item can carry **many** prices | 30 of 61 Production items are multi-price; "Coral" has 11 |

**Two menu generations coexist in the live catalog.** Items carry
`source: "XLS"` (uploaded from a spreadsheet) or `source: "DASHBOARD"` (authored
in the portal). As of 2026-08-24 Production held 57 XLS items **plus 4 leftover
DASHBOARD items at older prices** — "Dinner Family Meal" (52/64/76 vs the XLS
"Diner Family Meal" at 65/80/95), "Slices Family Meal" (44/56/68 vs 55/68/85),
a second "Extreme" (25 vs 29), and "Macaroni Béchamel" whose `menu_category_id`
resolves to no returned category. Three sit in the hidden "Offers" category, so
honouring `show_online` keeps them off the menu; the orphan lands in an inactive
"Uncategorized" bucket. **Cleaning them up is the owner's call inside Lazywait —
the import deliberately does not guess which price is current.**

## STILL ASSUMED

What remains an assumption is the **delivery half**, which the contract does not
describe at all. The client assembles it only when the caller passes
**`allowAssumedFields: true`** (default **OFF**). The live `lazywait-sync` worker
is **not** rewired for delivery: it stays pickup-only, and delivery orders are
still held at `blocked` / `delivery_schema_unconfirmed`. These map to the
remaining open questions Q1, Q2, Q3, Q8 and Q9 in
`docs/lazywait-delivery-open-questions.md`.

### Assumed field names/shapes (please correct)
| Assumed field | Assumed shape | Used for | Status |
|---|---|---|---|
| `order_type: "delivery"` | string | delivery create | Q1 — the contract documents `"pickup"` only |
| `order_status_id` for a new delivery order | string | delivery create | Q1 — `"new-order"` is the documented *pickup* value |
| `order_deliveries[]` element shape | unknown | delivery | Q2 — empty array in the example; almost certainly where delivery lives. **Not implemented** — we do not guess an element |
| `delivery_address` contents | string | delivery | Q2 — field name confirmed, required contents are not |
| `latitude`, `longitude` | number, top-level | delivery | Q3 — **the contract has no coordinate field anywhere**; ours is an invention and stays gated |
| `order_delivery_fee` on a delivery order | number | delivery | Q6 — name corrected and confirmed, but only meaningful once Q1 is answered; see Q9 before sending any money field |
| (address/lat-long visibility) | n/a | delivery | Q8 — needs a look at a real delivery ticket |

### Other items to confirm
- **Whether a production host is ever in scope.** The live POS is the dev host,
  so Create Order is documented and exercised on the same environment. If the
  integration is ever pointed at `apiv2.lazywait.com`, none of this is known to
  transfer — the catalog ids (`client_id`, item/addon ids) would differ, and
  field parity between the hosts would need confirming from scratch.
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
