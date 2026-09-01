# Restaurant Branch Onboarding Checklist

> **Updated 2026-08-12.** Everything that must be true before a new restaurant branch takes its first approved test/real order.

This document is about a Spicy Meal **restaurant branch**, not a Git branch.

## 1. Create/configure the branch — Admin → Branches

Set and verify the current branch fields in the admin UI/source schema, including:

- Arabic/English name and address;
- operational phone/contact;
- latitude/longitude;
- pickup/delivery enablement;
- delivery fee/minimum/estimate where delivery is supported;
- active/temporary-closure state.

Do not activate a branch simply because the row exists. Complete POS/menu/delivery verification first.

## 2. Menu availability

Branch availability is server-authoritative. Historically, absence of an explicit availability override means the catalog defaults to available, so a new branch can unintentionally expose products it does not stock.

Before activation:

- [ ] review the current product list with the branch manager;
- [ ] mark unavailable items deliberately;
- [ ] verify required modifier groups are usable for the branch/catalog combination;
- [ ] re-check availability after major menu additions/changes.

## 3. Lazywait POS mapping — critical

- [ ] `lazywait_branch_id` is the branch's real Lazywait identifier.
- [ ] Mapping is confirmed from the POS/Lazywait side, not guessed from a similar branch name.
- [ ] Lazywait catalog/mapping state is healthy.
- [ ] An approved pickup test order reaches the expected POS branch/ticket path before launch.

Without a valid mapping, the system cannot safely complete normal POS synchronization. Current production hardening surfaces unexpected blocked/dead-letter states through Order Integrity / Operations Health, and the customer confirmation lifecycle should not claim restaurant confirmation without a usable POS reference—but the kitchen still will not receive a valid POS ticket.

Do not activate a branch while relying on monitoring to catch a known bad mapping.

## 4. Pickup and delivery

Set each order type deliberately.

### Pickup

- [ ] pickup is enabled only when the branch can receive/prepare pickup orders;
- [ ] branch location is correct for nearest-branch sorting;
- [ ] menu availability is accurate;
- [ ] POS mapping/test succeeds.

### Delivery

- [ ] delivery is enabled only when the current product/process supports it;
- [ ] delivery zone exists and matches the real service area;
- [ ] delivery fee/minimum/estimate are correct;
- [ ] required address guidance/landmark behavior is understood by staff;
- [ ] branch has an agreed operational handling/dispatch process.

**Updated 2026-08-27.** The Lazywait integration *used* to treat `delivery_schema_unconfirmed` as a safety block rather than invent an unvalidated provider payload. That block is gone: the delivery payload has been validated against the live POS, and delivery orders now create real tickets. `delivery_schema_unconfirmed` survives only on four historical orders and can no longer be produced. The operational requirement is unchanged and now matters more, not less: do not enable a customer-facing delivery operation unless the branch has a verified current process for handling the resulting orders, because those orders now reach the kitchen.

## 5. Operating hours / open-close process

The repository has historically not had a full automatic branch-hours model. Verify the current schema/admin behavior before onboarding and document who owns daily open/close/temporary-delivery-closure operations.

- [ ] named person/role owns opening state;
- [ ] named person/role owns closing state;
- [ ] temporary closure procedure is understood;
- [ ] in-flight orders are checked before closing/deactivating.

Do not assume `is_active` is a harmless setup flag; it directly affects customer eligibility/order routing.

## 6. Approved pre-launch test

Do not use an online payment/refund test while the payment area is frozen unless separately approved.

For an approved cash/non-payment pickup test:

- [ ] customer can select the branch through the order-type gate;
- [ ] correct branch catalog is shown;
- [ ] order appears in Admin → Live Orders;
- [ ] Lazywait/POS lifecycle reaches the expected confirmed/synced state;
- [ ] usable external POS/order reference is shown where expected;
- [ ] physical/operational branch confirms the ticket/order was actually received;
- [ ] order status can be advanced through the supported lifecycle;
- [ ] Operations Health / Order Integrity shows no unexpected stranded state;
- [ ] Orders Requiring Verification does not contain the test order unless the scenario intentionally tests that state.

If delivery is being launched, perform a separate approved delivery process validation covering zone/address handling and the branch's real operational handoff.

## 7. Staff and access readiness

- [ ] intended staff can reach the admin console through the supported role/MFA flow;
- [ ] the branch has its own `branch_staff` account, created from Admin → Integrations → Staff Access → Accounts and pinned to this branch;
- [ ] that account signs in with email and password only — branch and call-centre roles are deliberately outside the TOTP requirement (see `ARCHITECTURE.md` §3), so it must not be shared beyond the people working the counter;
- [ ] no one is sharing a personal/admin credential as branch onboarding;
- [ ] staff know the Live Orders / receipt/ticket / POS verification workflow;
- [ ] staff have read `STAFF_MANUAL.md`;
- [ ] branch knows the incident/escalation contact, not merely “ask IT.”

## 8. Go-live check

Before setting the branch live:

- [ ] branch data/location correct;
- [ ] product availability reviewed;
- [ ] POS mapping verified;
- [ ] enabled order types operationally supported;
- [ ] delivery zone/process verified if enabled;
- [ ] staff access/MFA works;
- [ ] approved test completed;
- [ ] no unexpected critical Operations Health / Order Integrity issue;
- [ ] owner/operations approves activation.

## 9. Deactivation / temporary closure

Before deactivating a branch:

- check in-flight orders;
- confirm whether pickup, delivery or the entire branch needs to stop;
- use the supported branch controls;
- record who changed the state and expected restore time;
- communicate with the branch/affected customers when required.

Deactivation does not automatically resolve already-placed orders.

## Related docs

- `STAFF_MANUAL.md`
- `INCIDENT_RESPONSE.md`
- `ORDER_CONFIRMATION_FLOW.md`
- `ARCHITECTURE.md`
- `PAYMENT_POSTPONEMENT.md`