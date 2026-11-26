# Branch deletion behavior

Administrators can permanently delete a branch from **Dashboard → Branch Management**.

- Accountants remain read-only and do not see the delete control.
- Deleting is confirmed with a **type-to-confirm** prompt: the admin must type the
  branch name (English or Arabic). The prompt names the branch, states the delete
  cannot be undone, and lists what is deleted with the branch. *(Corrected
  2026-11-26: this named only the delivery area and product-availability
  settings. Fourteen tables cascade with a branch, listed in
  `BRANCH_CASCADE_TABLES` in `src/lib/branchDeletion.ts` and pinned by
  `branchDeletion.test.ts`: product, add-on and size availability, delivery
  zones and areas, working hours, staff assignments, branch-scoped campaigns
  and points campaigns, delivery requests, the branch reference sheet, and
  three append-only audit tables (delivery pause events, availability closure
  events, and the log of who revealed a stored credential). The prompt in
  `src/components/admin/branchDeletion.ts` now says all of it, and that vault
  secrets held for the branch's reference entries are NOT deleted and stay
  behind unreferenced.)*
- The delete control is disabled **only for the row being deleted**, so other
  branches stay usable while one delete is in flight.

## Order history is protected

A branch that still owns order history **cannot** be deleted:

- `orders.branch_id` is `ON DELETE RESTRICT`.
- `checkout_sessions.branch_id` is `NO ACTION`.

These foreign keys — plus the admin-only RLS (`branches` policy
`for all to authenticated using is_admin()`) — are the authoritative guarantees.
A non-admin's delete matches zero rows; an admin's delete of a branch with orders
is rejected by the FK.

On top of those guarantees the app adds friendly UX instead of surfacing a raw
Postgres error:

1. **Advisory pre-check** (`api.deleteBranch`): counts the branch's orders +
   checkout sessions first and, if any exist, blocks with a typed
   `BranchHasDependenciesError` before any delete is attempted.
2. **Hard backstop**: if a delete still trips the FK (e.g. an order landed
   between the count and the delete), the Postgres `23503` violation is mapped to
   the same typed error.

Either way the dashboard shows a **bilingual (AR/EN)** message —
"This branch has existing orders and can't be deleted. Deactivate it instead
(use the *Close Branch* toggle)…" — the branch is kept in place (never removed
locally), and the admin is steered to the `is_active` deactivation path, which
preserves order history.

- A deleted selected branch is replaced by another active branch when one is available.
