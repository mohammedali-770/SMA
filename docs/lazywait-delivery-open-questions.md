# Lazywait — Delivery Payload Open Questions

Delivery orders are intentionally **not** synced to the Lazywait POS. That has
not changed: the owner supplied a Create Order contract on **2026-08-24**, but it
documents a **pickup** order and says nothing about delivery.

What the contract did change is the pickup payload. `POST /pos/orders/create`
requires only `client_id`, `branch_id` and a non-empty `order_items`; everything
else is optional; and the identity fields (`order_ref`, `order_id`,
`order_number`, `order_date`) are generated server-side and cannot be set. The
pickup body now also carries the confirmed per-item and customer fields listed
under Q4–Q7 below. See `docs/integrations/Lazywait_API_Reference.md` for the
field-by-field state, including the caveat that the contract was read from the
**dev** host.

Until the questions still marked OPEN are answered, delivery orders are held at
`lazywait_sync_state = 'blocked'` with `sync_blocked_reason =
'delivery_schema_unconfirmed'` (set in `set_lazywait_initial_sync`), and the
sync worker's queue only claims `pending`/`failed` — so a delivery order can
never be sent with unconfirmed fields, and is never marked `synced` unless the
POS actually accepts it. The Admin Live Orders screen surfaces this as
"Delivery Lazywait sync is blocked pending Lazywait delivery payload
confirmation."

## Questions for Lazywait

1. **OPEN** — Does `POST /pos/orders/create` support `order_type = "delivery"`,
   and what `order_status_id` does a new delivery order take? The contract's
   example is `"order_type": "pickup"` with `"order_status_id": "new-order"`;
   neither value is documented as an enumeration, so the delivery equivalents
   are still guesses.
2. **OPEN** — What fields are required for the delivery address? The contract has
   a top-level `delivery_address` string (empty on the pickup example), which
   confirms the *name* but not what a delivery order needs in it. It also has an
   **`order_deliveries[]`** array, empty in the example and undocumented — that
   is almost certainly where delivery actually lives, and its element shape is
   the missing piece.
3. **OPEN** — Can we send customer latitude/longitude? The contract contains **no
   coordinate field anywhere**. Our assumed top-level `latitude`/`longitude` are
   therefore *not* confirmed by it and stay gated behind `allowAssumedFields`.
   If coordinates are accepted at all, they are most likely inside an
   **`order_deliveries[]`** element — see Q2.
4. **ANSWERED** — Can we send the customer phone number? Yes, but **split**:
   `customer_cell` carries the **local subscriber number** (`"541234567"`) and
   `country_code` carries the dialling prefix (`"+966"`) as a separate field.
   This corrects the earlier assumption that `customer_cell` took an E.164
   string. `splitPhoneForPos` does the split and sends **neither** field for a
   number it cannot split confidently.
5. **ANSWERED** — Can we send delivery instructions or order notes? Yes, and
   there are two distinct fields: **`order_details`** for the order-level note
   (`orders.notes`) and **`order_items[].details`** for the per-item note
   (`order_items.note`). There is **no** `delivery_notes` field; that assumed
   name was wrong and has been removed. Both are now sent on the pickup path.
6. **ANSWERED** — Can we send a delivery fee? Yes: the field is
   **`order_delivery_fee`**, not the assumed `delivery_fee`. The name is
   corrected, but it is still only meaningful on a delivery order, so it remains
   gated behind `allowAssumedFields` along with the rest of Q1–Q3. See also Q9:
   nothing about the money fields is being sent today.
7. **ANSWERED** — Can the POS show whether the order is paid or
   cash-payment-required? Yes: **`is_paid`** (boolean). The builder supports it;
   the live worker deliberately does **not** set it. Telling a cashier that an
   order needs no cash is a financial signal, and payment work is frozen
   (CLAUDE.md §6) — wiring it is a separate owner decision.
8. **OPEN** — Can the driver/cashier see the customer delivery location or
   address clearly? Unanswerable from the contract, which documents field names
   rather than what the POS renders. It depends on Q2's `order_deliveries[]`
   shape and needs a look at a real delivery ticket.
9. **OPEN (new, 2026-08-24)** — Are the money fields VAT-**inclusive** or
   VAT-**exclusive**? The contract carries `subtotal`, `discount`, `tax`,
   `tax_percentage`, `total` and `order_delivery_fee`, and its example computes
   `total = 34.5` from `subtotal = 30` and `tax = 4.5` at `tax_percentage = 15`
   — i.e. tax **added on top** of the item prices. Ours are VAT-**inclusive**
   (KSA), and `place_order` derives `vat_amount` by extracting the VAT portion
   *out of* the payable total. The example also does not say what the POS does
   with prices when the tax fields are **absent**, which is the case today and
   is the only case that matters for the pickup tickets currently in Production.
   Until that is settled, **no totals field is sent** — sending a guessed
   `subtotal`/`tax`/`total` would put a number on the ticket that disagrees with
   what the customer was charged. Two sub-questions:
   - when `tax`/`tax_percentage` are omitted, does the POS apply its own
     configured tax to `order_items[].price`, or treat the prices as final?
   - is there a flag that declares the submitted prices tax-inclusive?

## What the contract already changed

Implemented in this repository (see `buildCreateOrderPayload` in
`supabase/functions/_shared/lazywait.ts`):

- per-item `names{en,ar}`, `details`, `price_id`, `menu_category_id` and
  `addons[{addon_id, names{en,ar}, price, quantity}]`;
- order-level `order_details`, `customer_id`, `customer_cell` + `country_code`;
- `is_paid` supported but not wired (Q7).

## When the remaining answers arrive

- Extend `buildCreateOrderPayload` (`supabase/functions/_shared/lazywait.ts`) to
  build a delivery payload from confirmed fields only — most likely by filling
  `order_deliveries[]` rather than the top-level delivery fields.
- Relax `set_lazywait_initial_sync` so confirmed delivery orders enqueue
  (`pending`) instead of `blocked`, and update `requeue_lazywait_order`.
- Keep every new field gated on Lazywait documentation — never guess a field
  name or shape. The four corrections recorded above are what guessing produced.
