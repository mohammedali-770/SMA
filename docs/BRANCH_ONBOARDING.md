# Branch onboarding checklist

Everything that must be true before a new branch takes its first real order.
Derived from the actual schema (`branches`, `branch_availability`,
`delivery_zones`), not from memory.

> **The one that silently breaks things: `lazywait_branch_id`.** A branch with no
> POS mapping still accepts and charges for orders — they just never reach the
> kitchen. Nothing blocks it, and the customer sees a normal confirmation. Do not
> activate a branch before §3.

---

## 1. Create the branch — Admin → Branches

| Field | Notes |
| --- | --- |
| `name_en` / `name_ar` | **Both required.** The Arabic name is what most customers see. |
| `address_en` / `address_ar` | Shown on the receipt and used by staff on the phone. |
| `phone` | A number a customer or a driver can actually reach during service. |
| `latitude` / `longitude` | Used to pick the nearest branch. **Verify on a map** — a wrong pin silently routes orders to the wrong branch. |
| `delivery_fee` | Per branch, not global. |
| `min_delivery_order` | Below this, delivery is refused at checkout. |
| `estimated_delivery_minutes` | Shown to the customer as a promise. Be pessimistic. |

Leave **`is_active = false`** until everything below passes.

## 2. Menu availability — Admin → Menu

Availability is per branch (`branch_availability`), and **no row means
available**. A new branch therefore starts by offering the *entire* menu,
including items it cannot make.

- [ ] Walk the full product list with the branch manager.
- [ ] Mark every item the branch does **not** stock as unavailable.
- [ ] Re-check after any menu change — a new product is available everywhere by
      default.

## 3. POS mapping — the step that matters most

- [ ] `lazywait_branch_id` is set to the branch's real Lazywait id.
- [ ] Confirmed with the POS side that the id is correct — **not** guessed from a
      similar name.
- [ ] A test order reached the POS (see §6).

Without this, `lazywait-sync` cannot deliver the order. It will be accepted,
paid for, and never printed. The admin receipt shows whether a branch is mapped;
check it rather than assuming.

## 4. Order types and delivery area

- [ ] `pickup_enabled` — set deliberately.
- [ ] `delivery_enabled` — set deliberately.
- [ ] `delivery_temporarily_closed = false` (this is the day-to-day switch, §5 of
      the staff manual — not the onboarding one).
- [ ] If delivery is on: a **delivery zone polygon** is drawn (Admin → Branches →
      delivery zone). No zone means no delivery coverage, and the customer finds
      out at checkout.
- [ ] The polygon matches what the branch will actually drive to. Drawing it
      generously is how you get orders nobody delivers.

> ⚠️ Delivery orders currently do **not** reach the POS at all
> (`delivery_schema_unconfirmed`), and there is no driver or dispatch concept in
> the system. If you enable delivery, the branch must have a manual process for
> receiving and assigning those orders. Agree it before switching this on.

## 5. Hours

There is **no opening-hours model** in the schema. The platform will accept and
push an order to this branch at 03:00 if the branch is active.

- [ ] The branch manager knows they must toggle `is_active` (or
      `delivery_temporarily_closed`) at open and close, **every day**.
- [ ] Someone is named as responsible for doing it.

Adding a real `branch_hours` model is tracked in the readiness plan; until then
this is a human process and it will be forgotten at least once.

## 6. Test before going live

With `is_active = true` but before announcing the branch:

- [ ] Place a **cash pickup** order for this branch from a real customer account.
- [ ] It appears in Admin → Live Orders.
- [ ] It reached the POS — check the sync state, and confirm with the branch that
      the ticket actually printed.
- [ ] Advance it through the statuses; the branch sees each change.
- [ ] If delivery is enabled, repeat with a delivery order to an address inside
      the zone, and confirm the branch's manual process picks it up.
- [ ] Check Admin → Orders Requiring Verification is empty for this branch.

Do not use a live online payment for this. Cash exercises the same order path
without moving money.

## 7. Handover

- [ ] Branch staff can sign in and reach Live Orders.
- [ ] They have been walked through `docs/STAFF_MANUAL.md`.
- [ ] They know who to call when an order does not print — and that number is a
      person, not this repository.

---

## Deactivating a branch

- [ ] `is_active = false`.
- [ ] Check for in-flight orders **first** — deactivating does not cancel orders
      already placed, and those still need making.
- [ ] Tell the customers with open orders, or the branch does.
