# Server modifier contract — production-readiness invariant

New order items must satisfy the menu's modifier-group rules at the database boundary, not only in the customer UI.

For every newly inserted order item with a current `product_id`:

- every selected modifier has a non-null live ID;
- the same modifier ID cannot be selected twice;
- every selected modifier is active and belongs to a modifier group linked to the product;
- required groups satisfy at least one selection even if misconfigured with `min_select=0`;
- `min_select` and `max_select` are enforced for every linked group, including omitted groups;
- validation is deferred until transaction commit so the item and all modifiers can be inserted first;
- violations abort the containing transaction, preserving atomic coupon/loyalty/order behavior;
- historical snapshots are not revalidated when menu data changes later because the constraint is INSERT-only;
- an item inserted and deleted again inside the same transaction is safely ignored by its queued deferred event.

This change does not modify payment/Tap/refund/checkout-provider code or configuration.
