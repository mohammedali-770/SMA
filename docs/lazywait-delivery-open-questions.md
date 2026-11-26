# Lazywait — Delivery Payload Open Questions

> **SUPERSEDED IN PART, 2026-08-27 — delivery IS live.** This document opened by
> saying delivery orders are "intentionally **not** synced to the Lazywait POS"
> and that this "has not changed". It changed. Migration `20260827120000` removed
> the insert-time block and `lazywait-sync` v6 shipped the same day; seven
> delivery orders have since created real POS tickets (#3 … #9), all on the first
> attempt. **Q1, Q8 and Q9 are now answered on printed paper**, joining Q2, Q4,
> Q5, Q6 and Q7. **Exactly two remain genuinely open: Q3** (coordinates, which
> the contract has nowhere) **and Q10** (whether the POS sums `addons[].price`).
> Q3's fields are not sent. **Q10 is NOT inert (corrected 2026-11-26):** the
> add-on importer (`20260826080000`) maps every modifier it creates, ten mapped
> add-ons have existed since 2026-08-26 (all priced 0.00 then, so nothing
> moved), and the decomposition takes effect on the first mapped add-on priced
> above zero. See Q10. Also, `is_paid` is now sent (Q7), and `allowAssumedFields`
> is a flag of the unused typed client only (see the note after this banner).

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
payload itself: the fields behind Q3 are simply not sent (the live builder
`buildCreateOrderPayload` has no coordinate field; `allowAssumedFields` exists
only in `serializeCreateOrder` of `_shared/lazywaitApi.ts`, which no production
code calls). *Written 2026-08-24: "Q10 stays inert while no modifier carries a
`lazywait_addon_id`" — that stopped being true on 2026-08-26, see Q10.* An
order is still never marked `synced` unless the POS actually accepts it.

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
   therefore *not* confirmed by it and are not sent (corrected 2026-11-26: the
   live builder has no coordinate field; `allowAssumedFields` belongs to the
   unused typed client only).
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
   corrected, but it is still only meaningful on a delivery order. *(Corrected
   2026-11-26: this said it "remains gated behind `allowAssumedFields`" and that
   "nothing about the money fields is being sent today". Both were true on
   2026-08-24 and false from 2026-08-27: `buildCreateOrderPayload` sends
   `order_delivery_fee` whenever the order is delivery and the fee is above
   zero, with no gate, and Q9 records the money fields being sent.)*
7. **ANSWERED** — Can the POS show whether the order is paid or
   cash-payment-required? Yes: **`is_paid`** (boolean). *Superseded 2026-11-19:
   the worker sets it now.* When this was written the builder supported it and
   the live worker deliberately did **not** set it, because telling a cashier an
   order needs no cash is a financial signal and payment work was frozen
   (CLAUDE.md §6). On the owner's decision of 2026-11-19, `lazywait-sync` passes
   `isPaid` only when the payment is certain: an online order whose row says
   paid **and** a server-written captured payment record exists
   (`_shared/posPaidFlag.ts`, `lazywait-sync/index.ts`); the ticket is created
   paid in the same call, never marked paid later. Cash orders, and anything
   uncertain, send no `is_paid`.
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

   **The original question, retained as a record and fully superseded.** Read
   everything in the quote below as what was unknown on 2026-08-24, not as
   current behaviour. Its closing claim — "no totals field is sent" — is now the
   *opposite* of what happens, and a half-applied strikethrough left it reading
   as live text under an ANSWERED heading. That is why it is quoted whole rather
   than struck by the sentence.

   > Are the money fields VAT-**inclusive** or VAT-**exclusive**? The contract
   > carries `subtotal`, `discount`, `tax`, `tax_percentage`, `total` and
   > `order_delivery_fee`, and its example computes `total = 34.5` from
   > `subtotal = 30` and `tax = 4.5` at `tax_percentage = 15` — i.e. tax
   > **added on top** of the item prices. Ours are VAT-**inclusive** (KSA), and
   > `place_order` derives `vat_amount` by extracting the VAT portion *out of*
   > the payable total. The example also does not say what the POS does with
   > prices when the tax fields are **absent**, which is the case today and is
   > the only case that matters for the pickup tickets currently in Production.
   > Until that is settled, **no totals field is sent** — sending a guessed
   > `subtotal`/`tax`/`total` would put a number on the ticket that disagrees
   > with what the customer was charged. Two sub-questions:
   >
   > - when `tax`/`tax_percentage` are omitted, does the POS apply its own
   >   configured tax to `order_items[].price`, or treat the prices as final?
   > - is there a flag that declares the submitted prices tax-inclusive?

   **Both sub-questions are moot.** The tax fields are no longer omitted, and
   ticket #9 showed the POS rendering what we send verbatim rather than applying
   its own tax — which answers the first, and makes the second unnecessary.
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

   **It was inert on 2026-08-24, and it is not now (corrected 2026-11-26).**
   When this was written, zero of the three live modifiers carried a
   `lazywait_addon_id`, so `addons[]` was never emitted and nothing was
   subtracted. Two days later `import_lazywait_addon_groups` (applied
   2026-08-26) began creating one `modifiers` row per (group, add-on) pair with
   `lazywait_addon_id` already set, so every imported add-on is mapped from the
   moment it exists: ten were imported then, all at price 0.00, so the
   subtraction was zero and no ticket changed. **The assumption is live:** the
   first orderable add-on priced above zero goes out decomposed. The current
   count of mapped modifiers, and whether any order line has used one, are not
   known from the repository. Q10 is still unanswered by Lazywait. Unmapped
   modifiers are folded into `details` as text and keep their money inside
   `price`.

   **The alternative that was rejected**, recorded because it is the safer
   answer if Lazywait ever confirms the inclusive reading: closed PR #245 sent
   `addons[].price = 0` always and kept the whole price on the item, which is
   correct under *both* readings. It was not adopted because it contradicts the
   contract's example and hides the add-on's price from the POS entirely.

   **Before a priced add-on is imported or mapped** (the importer maps by
   default, so this gate is the price, not the mapping), settle this — ask
   Lazywait, or place a single test order with one priced add-on and read the
   POS total against ours.

## What the contract already changed

Implemented in this repository (see `buildCreateOrderPayload` in
`supabase/functions/_shared/lazywait.ts`):

- per-item `names{en,ar}`, `details`, `price_id`, `menu_category_id` and
  `addons[{addon_id, names{en,ar}, price, quantity}]`;
- order-level `order_details`, `customer_id`, `customer_cell` + `country_code`;
- `is_paid`, sent only when the payment is certain (since 2026-11-19, Q7).

## When the remaining answers arrive

*Historical, written 2026-08-24 as a to-do list. The first two items were done
on 2026-08-27 (delivery orders enqueue as `pending`; `buildCreateOrderPayload`
builds the delivery payload, using the top-level `delivery_address` plus the
`DELIVER TO` line, not `order_deliveries[]`). Only the last bullet still applies.*

- Extend `buildCreateOrderPayload` (`supabase/functions/_shared/lazywait.ts`) to
  build a delivery payload from confirmed fields only — most likely by filling
  `order_deliveries[]` rather than the top-level delivery fields.
- Relax `set_lazywait_initial_sync` so confirmed delivery orders enqueue
  (`pending`) instead of `blocked`, and update `requeue_lazywait_order`.
- Keep every new field gated on Lazywait documentation — never guess a field
  name or shape. The four corrections recorded above are what guessing produced.
