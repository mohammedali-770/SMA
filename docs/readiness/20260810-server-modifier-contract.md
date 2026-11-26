# Server modifier contract — production-readiness invariant

New **cash** order items must satisfy the menu's modifier-group rules at the database boundary, not only in the customer UI.

> **Correction, 2026-11-26.** This note used to say "new order items" without qualification. The trigger returns early for every order whose `payment_method` is not `cash` (`supabase/migrations/20260810132000_order_modifier_contract.sql`, deliberately: an online snapshot is finalized after a payment may already have been captured, so re-checking it against mutable menu data could strand a charged customer, and the migration header and `supabase/tests/order_modifier_contract_test.sql` both say so). Online orders are priced by `compute_order_snapshot`, which checks that each modifier id is active and linked to the product and does **not** reject a repeated id, a missing required group or a selection above `max_select` (last defined in `20260924120000_place_order_variant_availability.sql`, read from source on 2026-11-26; the full audit reported reproducing the gap on a disposable clone, which was not re-run for this note). Server-side cardinality validation for online orders is therefore not in place; whether to add it is a money-path decision for the owner and not made here.

For every newly inserted **cash** order item with a current `product_id`:

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
