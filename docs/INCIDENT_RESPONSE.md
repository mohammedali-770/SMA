# Incident Response

> **Updated 2026-08-12.** Internal health/alerting exists, but source does not prove that an independent external service can page a human. Treat independent monitoring/contact readiness as unverified until `OWNER_ACTIONS.md` §7 is completed.

## 1. Detection reality

The system has real internal visibility:

- Operations Health;
- Operations Alerts / digest;
- Order Integrity;
- stranded-order / confirmation-required signals;
- Sentry across the client surfaces.

These controls do **not** by themselves prove independent outage paging. They run in or around the system being observed and may be unavailable during a total platform outage.

Therefore:

- never assume an internal dashboard will wake someone;
- maintain an independent liveness/data-path monitor if approved/configured;
- keep primary/secondary responder contacts documented;
- record how an incident was actually detected.

## 1b. The launch-week alert watch — until dispatch exists, this IS the pager

**Added 2026-09-03 for X3.** The alert engine works and has never once reached a
human: every row it has ever produced is `('in_app','recorded')` and stops in the
database. A dispatcher is being built (`OPERATIONS_ALERTS_DIGEST.md`), but it is
inert until three separate owner actions land. Until then **this scheduled human
check is the entire notification system**, and it should be read that way rather
than as a nice-to-have.

### Who — owner must fill

| Role | Name | Contact | Days |
| --- | --- | --- | --- |
| Alert watcher (primary) | ☐ | | |
| Alert watcher (backup) | ☐ | | |

One named person per service day, not "whoever is around". An unnamed rota is how
a check silently stops happening.

### When

Fixed times, every service day. Anchor them to the service, not the clock hour:

| Check | Why this moment |
| --- | --- |
| **Before opening** | catches anything that broke overnight, before customers meet it |
| **Mid-service** (once per peak) | the window where POS sync failures actually happen |
| **After close** | catches a failure that stranded orders nobody chased |

### What to open

1. **Admin → Operations** — Operations Health and Operations Alerts.
2. **Admin → Order Integrity**.

### What counts as actionable

Judge on **status**, not on the presence of a row:

- **`open` + `critical`** → treat as SEV-1/SEV-2 and go to §3 and §4 now.
- **`open` + `warning`** → look, decide, and write down the decision. If the same
  warning is still open at the next check, escalate it.
- **`recovered`** → history. Do not chase it.

**The baseline, measured live 2026-09-03 so a watcher knows what normal looks
like.** Six alert states exist in total and **all six are `recovered`; nothing is
open.** Everything that has ever fired:

| Fingerprint | Severity | Times | Shape |
| --- | --- | --- | --- |
| `lazywait:sync_health` / `sync_degraded` | warning | 4 | opened and recovered within **5 minutes** each time — the evaluator's own interval |
| `order_integrity:stranded_orders` | critical | 1 | 2026-08-10, 3 stranded orders (all `missing_mapping`, oldest 2026-07-23), recovered in 2 hours |
| `platform:health` / `failing` | critical | 1 | same incident, same 2-hour window |

So a `lazywait` warning that clears by the next check is the known-normal shape.
A **critical**, or **any warning that survives two consecutive checks**, is not.

### What this does NOT do, stated plainly

It is a **poll, not a page**. Nothing covers the gap between checks, and nothing
covers out of hours. If the POS fails an hour after the mid-service check, the
first signal is still a customer complaint. That is the residual risk the
dispatcher exists to close, and it is accepted deliberately for launch week
rather than by omission.

## 2. Incident roles — owner must fill/maintain

| Role | Name | Contact/channel | Backup |
| --- | --- | --- | --- |
| Primary responder | ☐ | | |
| Secondary responder | ☐ | | |
| Owner / Production approval authority | ☐ | | |
| Restore authority | ☐ | | |
| Customer/branch communications | ☐ | | |

The repository requires explicit approval for many Production actions. Decide in advance what responders may do during a live emergency if the owner is unreachable; do not invent that authority at 02:00.

## 3. Severity

| Severity | Meaning | Examples | Target response |
| --- | --- | --- | --- |
| **SEV-1** | Money, security, safety or destructive data risk | suspected double charge, unintended refund processing, privilege leak, customer safety instruction lost | immediate escalation |
| **SEV-2** | Customers broadly cannot order/use the service | authentication outage, all checkout/orders fail, POS path broadly stopped | urgent, within the hour |
| **SEV-3** | Partial/degraded operation | one branch/mapping issue, delayed POS sync, admin-only degradation | same day |
| **SEV-4** | Cosmetic/internal | label/layout/report formatting | normal PR flow |

## 4. First 15 minutes

1. Record start time, reporter and exact symptom.
2. Scope the affected surface: customer native, `/app`, admin, Supabase, Lazywait, WhatsApp, one branch or all branches.
3. Check provider/platform status externally before assuming the code is at fault.
4. Check the intended production commit/deployment and recent PR/migration activity.
5. Check internal Operations Health / Order Integrity / relevant Sentry signals if those systems are reachable.
6. Decide whether immediate mitigation is safer than continued diagnosis.
7. Escalate SEV-1 immediately; escalate unresolved SEV-2 quickly.

Do not make a speculative Production database/provider change merely to “see if it fixes it.”

## 5. Safe mitigation hierarchy

Prefer the least invasive supported control:

1. **Supported admin setting/control** designed for the operation.
2. **Revert/rollback to a known reviewed web artifact** if the release itself is clearly bad.
3. **Disable an affected product/branch/integration through a supported admin control** only after understanding operational consequences.
4. **Privileged Production write/deploy/migration** only with the required explicit approval and a precise, auditable plan.

Do not normalize emergency SQL-editor edits into a general runbook. If a required lever exists only as a Production database write, treat that as both an approval-gated action and a product/operations gap to fix afterward.

## 6. Branch / catalog / POS incidents

### One restaurant branch is unavailable

Use the supported branch controls to stop accepting orders only after confirming the intended scope (pickup/delivery/entire branch). Record who changed it and when it should be restored.

### Product/menu problem

Use the supported catalog/product controls. Avoid bulk or direct SQL unless the supported UI/API is unavailable and the owner explicitly approves the exact fallback.

### Lazywait / POS sync problem

Before disabling any integration:

- determine whether the issue is one branch/mapping or system-wide;
- inspect confirmation-required/stranded/order-integrity state;
- check whether the branch has an agreed manual order-handling fallback;
- avoid blind Create Order resends after ambiguous outcomes.

The Lazywait lifecycle deliberately prevents ambiguous automatic resends because they can duplicate POS tickets.

## 7. Payment/refund incidents while payment work is frozen

The final payment provider has not been selected and payment/refund work remains frozen.

If a customer reports a money movement:

1. Locate the corresponding checkout/order/payment record if present.
2. Record the customer-safe reference, time and provider-visible reference without copying secret/full payment payloads into tickets/chat.
3. Do **not** trigger a new payment/refund/retry as a diagnostic step.
4. Verify the provider side through the approved owner/provider process.
5. Escalate any “provider movement with no internal record,” duplicate charge, or unexpected refund as SEV-1.
6. Any manual provider refund/financial correction is an explicit owner action and must be recorded.

The refund worker is intended to remain disabled while the freeze is active. After a restore/rebuild, re-verify `payment-refund-worker` before traffic resumes (`BACKUP_RECOVERY.md`).

## 8. Authentication / staff access incidents

Customer login currently depends on Supabase Auth plus WhatsApp OTP delivery.

Investigate separately:

- Supabase Auth/session issue;
- Auth Send-SMS hook issue;
- Meta/WhatsApp delivery issue;
- customer input/rate-limit outcome.

Staff access also has role and AAL2/TOTP gates. Do not bypass them by directly changing a user's role or weakening MFA as a routine incident workaround.

A true lockout recovery requires a separately approved privileged procedure.

## 9. Suspected data-loss incident

1. Stop destructive activity first.
2. Do not run `supabase migration repair` or a blind `db push`.
3. Preserve evidence: deployment/commit, timestamp, affected tables/IDs/counts.
4. Read `BACKUP_RECOVERY.md` before any restore decision.
5. Confirm current backup/PITR availability live; source documentation is not proof.
6. Restore/drill against a disposable environment unless this is an approved real recovery.
7. If Production is rebuilt/restored, verify dangerous manually-disabled automation before reopening traffic.

## 10. Security incident

For suspected credential leakage, privilege escalation or malicious access:

- stop exposing/using the affected credential/channel;
- rotate/revoke through the owning provider/dashboard as appropriate;
- preserve audit evidence;
- do not paste secrets into GitHub, chat or Sentry while investigating;
- verify RLS/staff authorization boundaries after containment;
- follow the project's security reporting/contact policy in `SECURITY.md` where applicable.

## 11. Deployment incident

If the symptom began after a web release:

- verify the production alias actually serves the expected commit;
- distinguish Vercel artifact failure from Supabase/provider failure;
- roll back to a known reviewed artifact when mitigation is safer than diagnosis;
- do not “fix forward” directly on the production branch.

See `DEPLOY.md` and `ROLLBACK.md`.

A 200 response from the SPA root is not enough to prove the correct/current build is served.

## 12. Communications

For a customer-visible incident:

- assign one person to coordinate the message;
- notify affected branches/operations;
- state observed impact and next update time, not an unverified root cause;
- avoid promising a refund/fix time that has not been approved/confirmed;
- keep customer PII out of broad incident channels.

## 13. After the incident

Within two working days, record:

- start/end time;
- customer/operational impact;
- detection method and detection latency;
- root cause and contributing conditions;
- mitigation/recovery steps;
- any manual Production/dashboard changes;
- what would have prevented/detected it earlier;
- owner/action items with named responsibility.

Keep it concise and evidence-based.

## 14. Related docs

- `docs/OWNER_ACTIONS.md` — unresolved owner/live-setting decisions.
- `docs/ROLLBACK.md` — deployment mitigation.
- `docs/BACKUP_RECOVERY.md` — recovery capability/drill.
- `docs/RELEASE_CHECKLIST.md` — pre-release gates.
- `docs/OPERATIONS_ALERTS_DIGEST.md` — internal alert behavior.
- `docs/ORDER_CONFIRMATION_FLOW.md` — customer/POS lifecycle.
- `docs/PAYMENT_POSTPONEMENT.md` — payment/refund freeze.
- `docs/SENTRY_OBSERVABILITY.md` — mobile observability.
- `docs/SENTRY_WEB_OBSERVABILITY.md` — web observability.