# PR #186 — account-deletion manual-review resolution

Production-readiness verification for the administrative exit from `manual_review`.

- Only admins can resolve a request currently in `manual_review`.
- `retry` clears the stale lease/failure budget and returns the request to the ordinary processor; it does not bypass active-order or financial blockers.
- `fail` makes the request terminal and releases the active-request dead end so a future request must re-verify identity.
- Admin investigation notes are bounded and stored only in the admin-only audit table; the customer-readable request keeps the existing server-generated safe reason.
- Every resolution is audited and the audit cannot be silently orphaned by deleting its request.
- Regression coverage includes authorization, state reset, invalid-state rejection, terminal re-request eligibility and customer-note privacy/RLS.
- No payment/Tap or Auth configuration is changed.

This note exists so the PR head is revalidated against the post-#187 production baseline and documents the exact release invariants being gated.
