# Payment & Refund Work — POSTPONED

> **Status: POSTPONED (owner decision, 2026-07-29).**
> The payment gateway provider has **not been selected yet**. Until it is,
> nothing in the payment / payment-processing / refund area may be modified,
> deployed, scheduled or tested.
>
> **Nothing was deleted.** All payment code, migrations, database objects and
> deployed Edge Functions remain exactly as they were. The only live change
> made under this decision was **disabling the `payment-refund-worker` cron
> job** so no automated refund processing can start while the area is frozen.

This document is the authoritative record of the postponement. It supplements
— and does not replace — the standing freeze in `CLAUDE.md` §6.

---

## 1. The decision

The owner instructed, on 2026-07-29:

- Ignore all payment gateway, payment processing and refund-related work.
- Do **not** modify, deploy, schedule or test any payment/refund functionality.
- Disable the `payment-refund-worker` cron job if it is active.
- Do **not** delete existing payment code or migrations.
- Continue with non-payment work only.
- Keep payment work clearly documented and postponed until the gateway is
  officially selected.

The existing Tap integration is treated as **provisional**. It is still wired
up in Production because live ordering depends on it, but it must not be
treated as the final provider choice, and no further work is to be built on
top of it until the decision is made.

## 2. What is frozen

No change of any kind — repository, Production, or configuration — may be made
to:

| Area | Includes |
| --- | --- |
| Payment Edge Functions | `payment-initiate`, `payment-verify`, `payment-webhook`, `payment-return`, `payment-test-config`, `payment-refund` |
| Tap diagnostic functions | `tap-admin-test-return`, `tap-diag-temp`, `tap-return-probe` |
| Shared payment helpers | `supabase/functions/_shared/tap.ts`, `supabase/functions/_shared/tapRefund.ts` |
| Checkout sessions | `checkout_sessions` table, its RPCs, and the checkout/session functions |
| Refund stack | `order_refunds`, `orders.refund_state` and its timestamp/failure columns, `claim_order_refund`, `finalize_order_refund`, `list_failed_order_refunds`, `order_refund_due`, `enforce_refund_state_transition`, `expire_stale_order_refund_claims`, `invoke_payment_refund_processor` |
| Scheduling | The `payment-refund-worker` cron job (and any new payment/refund schedule) |
| Provider configuration | The `payment`/`tap` row in `integration_settings`, Tap credentials, and the refund trigger secret in Vault |
| Payment business rules | Pricing→capture→settlement→refund policy, idempotency keys, retry policy |

Reopening any of the above requires **separate, explicit owner approval**
(`CLAUDE.md` §5 and §6).

## 3. What changed on 2026-07-29

Exactly one live change:

```sql
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'payment-refund-worker'),
  active := false
);
```

Verified afterwards:

| Check | Result |
| --- | --- |
| `payment-refund-worker` | jobid 6, schedule `*/5 * * * *`, **`active = false`** |
| Job row / schedule / command | **preserved** — disabled, not dropped |
| `invoke_payment_refund_processor()` | still exists, unchanged |
| `expire_stale_order_refund_claims()` | still exists, unchanged |
| `order_refunds`, `claim_order_refund`, `finalize_order_refund` | still exist, unchanged |
| Migration count | 62 live rows, unchanged |
| Orders / enrolled refunds / refund rows | 23 / 0 / 0 — unchanged |

Nothing else was touched: no function was redeployed, no migration was
applied, no secret was rotated or removed, no repository file was edited.

## 4. The five operational crons stay ACTIVE

Disabling the refund worker must not be confused with pausing operations.
These remain active and are **not** part of the payment freeze:

| Job | id | Schedule | Purpose |
| --- | --- | --- | --- |
| `account-deletion-processor` | 1 | `* * * * *` | Store-compliance account deletion |
| `lazywait-sync` | 2 | `* * * * *` | Lazywait POS order sync |
| `order-integrity-watchdog` | 3 | `*/2 * * * *` | Observe-only order integrity monitoring |
| `operations-alerts-evaluator` | 4 | `*/5 * * * *` | Internal operations alerts |
| `operations-digest-generator` | 5 | `0 * * * *` | Internal AR/EN daily digest |

## 5. Live payment state at the time of postponement

Recorded so the state can be compared when the area is reopened.

- **Tap integration row** (`integration_settings`, `payment`/`tap`):
  `enabled = true`, credentials present (3 secret keys / 5 public keys).
  **Deliberately left enabled** — customers place orders through the live
  checkout, and disabling the provider row would break ordering. Postponement
  freezes *work on* payments; it does not switch off the running checkout.
- **Deployed payment Edge Functions** (all left as-is): `payment-initiate` v6,
  `payment-webhook` v4, `payment-return` v6, `payment-verify` v2,
  `payment-test-config` v3, `payment-refund` v1, `tap-admin-test-return` v2,
  `tap-diag-temp` v2, `tap-return-probe` v2.
- **Refund trigger secret**: provisioned in Vault, retained, never printed.
  Without it `payment-refund` returns `503` and processes nothing — a second,
  independent reason no refund can run while the worker is disabled.
- **Data**: 23 orders, **0 paid**, **0** orders enrolled for refund
  (`refund_state` all `none`), **0** rows in `order_refunds`,
  9 `payment_records`.

Because zero orders are enrolled for refund and zero refund rows exist, the
disabled worker has **no backlog**. Nothing is queued and waiting.

## 6. Retained payment migrations (applied, not to be edited)

All of these are already applied to Production and are **never** to be edited
(`CLAUDE.md` §8, `docs/MIGRATIONS.md` §2). They stay exactly where they are:

| Repository file | Live version |
| --- | --- |
| `20260709140000_payment_methods.sql` | `20260709111046` |
| `20260712120000_tap_payments.sql` | `20260712070033` |
| `20260712160000_checkout_sessions.sql` | `20260712185657` |
| `20260712170000_checkout_sessions_hardening.sql` | `20260713044036` |
| `20260724120000_order_confirmation_state_machine.sql` | `20260729074810` |
| `20260724180000_tap_reference_order_opaque.sql` | `20260729080617` |
| `20260729090000_payment_refund_scheduler.sql` | `20260729112224` |

Any future change is a **new** migration, applied only through the
owner-approved `apply_migration` workflow.

## 7. Open design question to settle BEFORE reopening

This is recorded here because it is the strongest reason the worker must stay
disabled — it is **not** being fixed now, because the payment area is frozen
and the fix depends on which provider is chosen.

`classifyRefundResponse()` in `supabase/functions/_shared/tapRefund.ts`
resolves three outcomes: `succeeded`, `failed`, and `pending`. `pending`
covers everything ambiguous — in-flight, undocumented status, 5xx, timeout,
transport error — and a `pending` outcome **releases the claim so the refund
is retried later**.

That is the right conservative choice for a *manual* process: it never tells a
customer a refund completed when it may not have, and never writes off a
refund that may still succeed. But combined with an automatic every-5-minutes
scheduler it is a **double-refund risk**, because Tap's `reference.merchant`
is a reconciliation reference, **not** a provider-side idempotency key: a
refund that actually succeeded but returned ambiguously would be re-attempted.

`expire_stale_order_refund_claims()` mitigates *stuck leases* (it escalates a
stale `processing` claim to `failed`/`lease_expired` rather than retrying it),
but it does not change the in-function `pending` release path.

### UPDATE 2026-08-19 — Tap answers this, with a 24-hour caveat

Researched from Tap's public documentation (`docs/integrations/Tap_API_Reference.md`),
under an explicit owner instruction to investigate Tap. **Not confirmed by Tap and
not tested against a live account.**

Tap **does** provide a true idempotency key: `reference.idempotent` restricts
duplicate transactions on Authorize, Charges **and Refunds** — the same string
returns the first response instead of initiating a second refund. Tap also
documents a refund retrieve endpoint.

Two things follow, and they pull in opposite directions:

1. **The refund path now sends it.** `buildRefundBody` previously sent only
   `reference.merchant`, which is exactly the "reconciliation reference, not an
   idempotency key" this section describes. It now sends `reference.idempotent`
   as well.
2. **The key expires after 24 hours.** A refund retried beyond that window is a
   genuinely new refund as far as Tap is concerned. So the double-refund risk is
   **bounded, not eliminated**, and the every-5-minutes worker could still cross
   that boundary on a long-stuck refund.

**This section therefore stands.** The worker stays disabled. What has changed is
that the remaining work is now specific rather than open-ended: either confirm
`GET /v2/refunds/{id}` can resolve an ambiguous attempt (Q3 in the Tap
reference), or make the claim/release path refuse to retry past the idempotency
window and route those refunds to human review instead.

**A related defect was found and fixed in the same pass.** The CHARGE payload had
`idempotent` at the top level, where Tap's schema does not define it, so charge
idempotency had never been active at all — a retried `payment-initiate` could
have created a second charge. Nothing was affected in practice because online
payment has never been enabled. See the Tap reference §2.

**Before any automated refund processing is re-enabled**, the chosen provider
must supply either a true idempotency key on the refund endpoint, or a
reliable refund-status lookup that can resolve an ambiguous attempt before a
retry. If neither exists, ambiguous refunds must route to human review instead
of being retried automatically.

## 8. Resume checklist (when the gateway is officially selected)

Each item requires its own explicit owner approval — none of it is authorized
by this document.

1. Record the selected provider and supersede this document.
2. Decide the migration path for the provisional Tap integration (keep,
   replace, or run both during a transition).
3. Resolve §7: confirm provider idempotency / status-lookup guarantees, and
   rework `classifyRefundResponse()` and the claim/release path accordingly.
4. Re-review `payment-refund` end to end against the chosen provider.
5. Re-test in a non-production context — never against live customer orders.
6. Re-enable the worker only after 3–5 pass:
   ```sql
   select cron.alter_job(
     job_id := (select jobid from cron.job where jobname = 'payment-refund-worker'),
     active := true
   );
   ```
7. Verify the first scheduled runs against a zero backlog before any real
   refund is allowed to flow.
8. Update `docs/MIGRATIONS.md`, `PROJECT_STATUS.md` and `CLAUDE.md` §6.

## 9. Related documents

| Doc | Owns |
| --- | --- |
| `CLAUDE.md` §5, §6 | The standing payment/Tap freeze and approval rules |
| `docs/MIGRATIONS.md` | Migration ledger and the only approved Production schema workflow |
| `docs/ORDER_CONFIRMATION_FLOW.md` | Order confirmation lifecycle and refund enrolment rules |
| `PROJECT_STATUS.md` | Overall project state and onboarding |
