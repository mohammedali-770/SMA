# Lazywait — Delivery Payload Open Questions

Delivery orders are intentionally **not** synced to the Lazywait POS yet. The
confirmed Create Order payload (`POST /pos/orders/create`) only covers pickup
orders with `client_id`, `branch_id`, `order_type: "pickup"`, `order_items`
(`menu_item_id`, `name`, `quantity`, `price`), `customer_name`, and `source`.
No delivery-specific fields are confirmed, so we do not invent any.

Until the questions below are answered, delivery orders are held at
`lazywait_sync_state = 'blocked'` with `sync_blocked_reason =
'delivery_schema_unconfirmed'` (set in `set_lazywait_initial_sync`), and the
sync worker's queue only claims `pending`/`failed` — so a delivery order can
never be sent with unconfirmed fields, and is never marked `synced` unless the
POS actually accepts it. The Admin Live Orders screen surfaces this as
"Delivery Lazywait sync is blocked pending Lazywait delivery payload
confirmation."

## Questions for Lazywait

1. Does `POST /pos/orders/create` support `order_type = "delivery"`?
2. What fields are required for the delivery address?
3. Can we send customer latitude/longitude?
4. Can we send the customer phone number?
5. Can we send delivery instructions or order notes?
6. Can we send a delivery fee?
7. Can the Lazywait POS show whether the order is paid or cash-payment-required?
8. Can the driver/cashier see the customer delivery location or address clearly?

## When answers arrive

- Extend `buildCreateOrderPayload` (`supabase/functions/_shared/lazywait.ts`) to
  build a delivery payload from confirmed fields only.
- Relax `set_lazywait_initial_sync` so confirmed delivery orders enqueue
  (`pending`) instead of `blocked`, and update `requeue_lazywait_order`.
- Keep every new field gated on Lazywait documentation — never guess a field
  name or shape.
