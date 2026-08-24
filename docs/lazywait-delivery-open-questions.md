# Lazywait — Delivery Payload Open Questions

Delivery orders are intentionally **not** synced to the Lazywait POS.

The owner supplied a Lazywait **Create Order** contract on **2026-08-24**, and it
answered several of the questions below — but it documents a **PICKUP** order.
It does not settle delivery, so the delivery gate is **unchanged**: delivery
orders are still held at `lazywait_sync_state = 'blocked'` with
`sync_blocked_reason = 'delivery_schema_unconfirmed'` (set in
`set_lazywait_initial_sync`), and the sync worker's queue only claims
`pending`/`failed` — so a delivery order can never be sent with unconfirmed
fields, and is never marked `synced` unless the POS actually accepts it. The
Admin Live Orders screen still surfaces this as "Delivery Lazywait sync is
blocked pending Lazywait delivery payload confirmation."

> **Provenance caveat.** That contract was read from the **dev** host
> `apiv2-dev.lazywait.com`. `DEFAULT_BASE_URL` remains the production host
> `apiv2.lazywait.com` and was deliberately not changed. Field-level parity
> between the two hosts is **unverified**.

## Questions for Lazywait

### Still OPEN

1. **OPEN — Does `POST /pos/orders/create` support `order_type = "delivery"`?**
   The 2026-08-24 contract shows `order_type: "pickup"` only, and does not list
   the accepted values. The `order_status_id` a delivery ticket should take is
   likewise unknown (`"new-order"` is the documented pickup value).
2. **OPEN — What fields are required for the delivery address?**
   The contract has a top-level `delivery_address` string, but it is `""` on the
   pickup example and nothing describes its use for a real delivery. It also
   carries **`order_deliveries: []`** — an empty array on a pickup order, which
   is almost certainly **where delivery actually lives**. The element shape of
   `order_deliveries[]` is undocumented and is the missing piece.
3. **OPEN — Can we send customer latitude/longitude?**
   **Latitude and longitude are absent from the 2026-08-24 contract entirely.**
   Our assumed top-level `latitude`/`longitude` fields are therefore **not
   confirmed by that document** and stay gated behind `allowAssumedFields`. As
   with Q2, coordinates most plausibly belong inside an `order_deliveries[]`
   element rather than at the top level.
8. **OPEN — Can the driver/cashier see the customer delivery location or
   address clearly?** A POS-UI question the payload contract cannot answer.
9. **OPEN (new, 2026-08-24) — Are the money fields inclusive or exclusive of
   VAT?** The contract's example is **exclusive**: `subtotal: 30` +
   `tax: 4.5` (at `tax_percentage: 15`) = `total: 34.5`. Our prices are
   **VAT-inclusive**, so our `subtotal` for that same basket is 34.5, not 30.
   The document does not say whether the POS trusts `subtotal`/`tax`/`total` or
   recomputes them. Until that is settled we send **no** order-level money
   fields — not `subtotal`, `discount`, `tax`, `tax_percentage`,
   `taxes_charges`, `tip`, `total` or `order_delivery_fee`. The per-item `price`
   we do send is VAT-inclusive and is what the POS has priced from throughout
   the pilot. See `buildCreateOrderPayload` for the reasoning in code.

10. **OPEN (new, 2026-08-24) — Does the POS ADD `addons[].price` to
   `order_items[].price`, or is the item price taken as inclusive of its
   add-ons?** This matters because `place_order` folds modifier prices into
   `order_items.unit_price`
   (`v_unit_price := v_unit_price + v_modifier.price`), and `unit_price` is what
   we send as `price`. A "Volcano (+2)" burger therefore already reaches the POS
   at the +2 price. Echoing the add-on's own price would let a POS that sums
   item + add-ons charge the +2 **twice**. Until this is answered we send
   **`addons[].price = 0`** — explicitly 0 rather than an omitted key, so the POS
   cannot substitute its own catalog price and add that instead. The add-on is
   still itemised by name so the kitchen sees it. This is the reading that
   cannot overcharge a customer.

### ANSWERED by the 2026-08-24 contract

4. **ANSWERED — Can we send the customer phone number?** Yes, and it is
   **split**: the local subscriber number goes in **`customer_cell`**
   (`"541234567"`) and the dialling code in **`country_code`** (`"+966"`).
   This **corrects** the repo's earlier assumption that `customer_cell` takes an
   E.164 string. See `splitPhoneForPos`. `customer_id` (CRM id) is confirmed too.
5. **ANSWERED — Can we send delivery instructions or order notes?** Yes, as
   notes. The order-level note is **`order_details`** and the per-item note is
   **`order_items[].details`**. There is **no `delivery_notes` field** — that
   repo assumption was wrong and has been removed. (Delivery *instructions*
   specifically remain tied to Q2/Q3, since delivery itself is unconfirmed.)
6. **ANSWERED (field name only) — Can we send a delivery fee?** The field is
   **`order_delivery_fee`**, not `delivery_fee`. The name is corrected, but the
   *value* is blocked on Q9 above, so nothing is sent on the pickup path (where
   it would be 0 anyway).
7. **ANSWERED — Can the POS show whether the order is paid?** Yes —
   **`is_paid`** (boolean). Now sent, sourced from
   `orders.payment_status = 'paid'`.

## Also confirmed on 2026-08-24 (not previously questions)

- `order_items[].price_id` — confirmed; sourced from `products.lazywait_price_id`.
- `order_items[].menu_category_id` — sourced from `categories.lazywait_category_id`.
- `order_items[].names { en, ar }` and `addons[].names { en, ar }`.
- `addons[]` element shape: `{ addon_id, names{en,ar}, price, quantity,
  is_included_in_custom_addons }`. There is **no `addons_group_id`** on a
  create-order add-on — that repo assumption was wrong and has been removed.
  (`addons_group_id` remains a real field on the **catalog** endpoints
  `/menu/addons` and `/menu/addons-groups`; that is untouched.)
- `is_included_in_custom_addons` is **not sent**: the field name is confirmed,
  its semantics are not, and we hold no column that means it. Guessing `false`
  would be inventing data.

## When the remaining answers arrive

- Extend `buildCreateOrderPayload` (`supabase/functions/_shared/lazywait.ts`) to
  build a delivery payload from confirmed fields only — most likely by filling
  `order_deliveries[]` once its element shape is known (Q2/Q3).
- Relax `set_lazywait_initial_sync` so confirmed delivery orders enqueue
  (`pending`) instead of `blocked`, and update `requeue_lazywait_order`.
- Keep every new field gated on Lazywait documentation — never guess a field
  name or shape.
