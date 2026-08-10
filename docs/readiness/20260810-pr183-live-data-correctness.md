# PR #183 — live data correctness verification

Production-readiness verification for order lifecycle, cancellation compensation, historical VAT and report export hardening.

- Order lifecycle transitions are server-authoritative and forward-only.
- Cancellation is transactional and idempotent under retries/concurrent clicks.
- Redeemed loyalty is restored, available earned loyalty is reversed without taking the balance negative, and any unrecoverable earned-point shortfall is recorded in the ledger.
- Coupon usage is compensated and the coupon code identity is protected from rename/delete/reuse after an order references it.
- Receipts and financial reports use the immutable `vat_amount` stored with each order rather than today's configured VAT rate.
- CSV cells neutralize spreadsheet formulas and use syntax-correct escaping while preserving simple-cell output.
- Regression suites cover authorization, lifecycle boundaries, compensation/idempotency, coupon identity and report UI behavior.
- No payment/Tap implementation or configuration is changed.

This note exists so the PR head is revalidated against the post-#187 production baseline and documents the exact release invariants being gated.
