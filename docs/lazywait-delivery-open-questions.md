# Lazywait — Delivery Payload Open Questions

> **SUPERSEDED IN PART, 2026-08-27 — delivery IS live.** This document opened by
> saying delivery orders are "intentionally **not** synced to the Lazywait POS"
> and that this "has not changed". It changed. Migration `20260827120000` removed
> the insert-time block and `lazywait-sync` v6 shipped the same day; seven
> delivery orders have since created real POS tickets (#3 … #9), all on the first
> attempt. **Q1, Q8 and Q9 are now answered on printed paper**, joining Q2, Q4,
> Q5, Q6 and Q7. **Exactly two remain genuinely open: Q3** (coordinates, which
> the contract has nowhere) **and Q10** (whether the POS sums `addons[].price`).
> Both are inert — the fields behind them are not sent, and Q10 cannot activate
> until a modifier is mapped.

The original framing, kept because the reasoning behind the remaining questions
depends on it: the owner supplied a Create Order contract on **2026-08-24**, but
it documents a **pickup** order and says nothing about delivery.

What the contract did change is the pickup payload. `POST /pos/orders/create`
requires only `client_id`, `branch_id` and a non-empty `order_items`; everything
else is optional; and the identity fields (`order_ref`, `order_id`,
`order_number`, `order_date`) are generated server-side and cannot be set. The
pickup body now also carries the confirmed per-item and customer fields listed
under Q4–Q7 below. See `docs/integrations/Lazywait_API_Reference.md` for the
field-by-field state, including the caveat that the contract was read from the
**dev** host.

**No longer true as of 2026-08-27.** Delivery orders *were* held at
`lazywait_sync_state = 'blocked'` with `sync_blocked_reason =
'delivery_schema_unconfirmed'` (set in `set_lazywait_initial_sync`). That branch
is gone: delivery orders now enqueue as `pending` and are claimed like any other.
Four historical orders still carry the reason and are `not_retryable`; nothing
reachable can produce it again.

What still protects the remaining open questions is **not** the block but the
payload itself: the fields behind Q3 are simply not sent and stay behind
`allowAssumedFields` (default OFF), and Q10 stays inert while no modifier
carries a `lazywait_addon_id`. An order is
still never marked `synced` unless the POS actually accepts it.

## Questions for Lazywait

1. **ANSWERED IN PRACTICE, 2026-08-27** — delivery is now SENT. `order_type`
   is a free string and the endpoint has proven lenient about body shape (our
   body is flat while the vendor's own sample wraps it in `{ order: … }`, and
   pickup has synced for weeks), so `"delivery"` is sent and a rejection would
   surface as an ordinary sync failure carrying the API's own message.
   `order_status_id` is not sent at all — it is optional and pickup is correct
   without it. Original question kept below.

   ~~Does `POST /pos/orders/create` support `order_type = "delivery"`,
   and what `order_status_id` does a new delivery order take? The contract's
   example is `"order_type": "pickup"` with `"order_status_id": "new-order"`;
   neither value is documented as an enumeration, so the delivery equivalents
   are still guesses.~~
2. **CLOSED, 2026-08-27** — `order_deliveries[]` is NOT caller input. The
   owner's vendor request sample sends it **empty on a PICKUP order**, next to
   `order_payments: []`, `order_discounts: []`, `order_taxes: []` and
   `metadata: {}` — POS-side collections. Nothing is invented for it. The
   destination goes in the confirmed top-level `delivery_address`, and is
   repeated into `order_details` because whether the POS *renders*
   `delivery_address` is Q8 and still unverified. Original question below.

   ~~What fields are required for the delivery address? The contract has
   a top-level `delivery_address` string (empty on the pickup example), which
   confirms the *name* but not what a delivery order needs in it. It also has an
   **`order_deliveries[]`** array, empty in the example and undocumented — that
   is almost certainly where delivery actually lives, and its element shape is
   the missing piece.~~
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
8. **ANSWERED 2026-08-27, negatively — and the duplication is now permanent.**
   The owner read a real delivery ticket: it shows `Order Type: Delivery` but
   **no address row at all**. The POS does **not** render the confirmed
   top-level `delivery_address`. The destination reaches the kitchen only
   through the `التوصيل إلى / DELIVER TO:` line inside `order_details`.

   So the duplication that existed "precisely because this is unverified" is
   what is actually doing the work, and dropping it would put a delivery ticket
   in front of a driver with nowhere to go. Keep both. Confirmed again on ticket
   **#9**, where the deduped address printed **once** on that line.

   ~~Can the driver/cashier see the customer delivery location or
   address clearly? Unanswerable from the contract, which documents field names
   rather than what the POS renders. It depends on Q2's `order_deliveries[]`
   shape and needs a look at a real delivery ticket.~~
9. **ANSWERED 2026-08-27 — the POS displays what we send; it does not
   recompute.** Money is now sent, and ticket **#9** (SM-2026-000065) printed
   `Subtotal 84.00 / VAT 10.96 / Total 84.00` against a stored total of 84.00.
   Both sub-questions below are settled by that single ticket: the POS did
   **not** add 10.96 on top to print 94.96, and it did not re-derive anything
   from `order_items[].price`. It rendered our numbers verbatim, so our
   VAT-**inclusive** convention survives the trip intact and the ticket agrees
   with what the customer was charged.

   Corroborating evidence from before money was sent: ticket #3 printed
   `0.00` for all three totals while its line items showed real prices — a POS
   that computed would have produced a non-zero total there. Original question
   kept below.

   ~~Are the money fields VAT-**inclusive** or VAT-**exclusive**?~~ The contract carries `subtotal`, `discount`, `tax`,
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
10. **OPEN (new, 2026-08-24)** — Does the POS **add** `addons[].price` to
   `order_items[].price`, or does it treat the item price as already inclusive
   of its add-ons? This is a real-money question, and the current
   implementation answers it by assumption rather than by confirmation.

   Why it arises: `place_order` folds each selected modifier's price into
   `order_items.unit_price` (`v_unit_price := product.price + Σ modifier.price`),
   so a "Volcano (+2)" burger already reaches us at the +2 price.

   **What we send today.** `serializeCreateOrderItem` decomposes the line: the
   emitted `price` is `unit_price` **minus** the mapped add-on total, and each
   `addons[]` entry carries its own price, so
   `price + Σ(addon.price × quantity) === unit_price` exactly. That is correct
   **if the POS sums**, which is what the contract's own worked example shows
   (item `price` 25 + addon `price` 5 = `subtotal` 30).

   **The exposure, stated rather than buried.** If the POS instead reads
   `order_items[].price` as final and ignores `addons[].price`, the ticket
   **undercharges by the add-on total**. The contract example is good evidence
   for the summing reading, but it is evidence, not vendor confirmation — and
   the failure direction is a ticket worth less than the customer paid.

   **It is inert today, and that is the only reason this is not urgent.** Zero
   of the three live modifiers carry a `lazywait_addon_id`, so `addons[]` is
   never emitted, nothing is ever subtracted, and the full VAT-inclusive
   `unit_price` goes out exactly as the pre-contract worker sent it. Unmapped
   modifiers are folded into `details` as text and keep their money inside
   `price`. **The assumption activates the first time a modifier is mapped.**

   **The alternative that was rejected**, recorded because it is the safer
   answer if Lazywait ever confirms the inclusive reading: closed PR #245 sent
   `addons[].price = 0` always and kept the whole price on the item, which is
   correct under *both* readings. It was not adopted because it contradicts the
   contract's example and hides the add-on's price from the POS entirely.

   **Before mapping the first modifier**, settle this — ask Lazywait, or map one
   add-on, place a single test order and read the POS total against ours.

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
