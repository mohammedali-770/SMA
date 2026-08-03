# Incident response

> **Read §1 first. The most important fact about this system's incident posture
> is that nothing in it can notify a human.**

---

## 1. Nothing here will page you

This must be stated plainly because the volume of monitoring in the codebase
implies otherwise. The Operations Health Center, the Smart Operations Alerts
engine, the daily digest and the order-integrity watchdog are all real, careful,
and working — and **none of them can reach a person**.

- External dispatch is disabled *by design*: `external_dispatch_enabled`
  defaults false, the settings RPC hard-raises on any attempt to enable it, and
  a CHECK constraint makes a "sent" row impossible.
- Nothing consumes `operations_alert_outbox`. There is no dispatcher.
- There is **no uptime or synthetic monitoring** of any kind.
- Sentry ingests errors from the three client surfaces but **not from any of the
  21 Edge Functions** — the entire server-side order and payment path is dark.

**Therefore: detection latency equals the time until a staff member happens to
open the admin console.** Overnight, that is until morning. The health monitor
also runs *inside* the system it monitors, so a total outage produces no signal
at all — the dashboard that would tell you is part of what is down.

Until an external prober and an alert dispatcher exist, incident response starts
with a **human noticing** — a customer complaint, a branch phoning in, or someone
opening the dashboard.

> The highest-value change available is external uptime monitoring hitting `/`
> and `/app` and alerting to a phone. It is independent of every code freeze and
> takes about half an hour.

---

## 2. Roles — TO BE FILLED IN BY THE OWNER

An escalation policy with no names is not a policy.

| Role | Who | Contact | Backup |
| --- | --- | --- | --- |
| Primary responder | ☐ | | |
| Secondary / escalation | ☐ | | |
| Owner (approves prod actions) | ☐ | | |
| Restore authority | ☐ | | |

**This matters more here than in most projects**, because CLAUDE.md §5 gates
migrations, Edge Function deploys, payment work and Vercel production changes
behind *explicit owner approval*. If the owner is unreachable at 02:00, the
responder cannot legitimately perform most fixes. Decide in advance what a
responder may do unilaterally during a live incident, and write it here.

---

## 3. Severity

| Sev | Means | Examples | Response |
| --- | --- | --- | --- |
| **1** | Money or safety. Customers charged wrongly, or an order defect that could harm someone. | Double charges, refunds firing repeatedly, allergy note lost end-to-end | Immediately; wake the owner |
| **2** | Customers cannot order. | Site down, checkout broken, OTP not sending, all orders failing to reach the POS | Within the hour |
| **3** | Degraded but ordering works. | POS sync backlog, admin console slow, one branch misconfigured | Same day |
| **4** | Cosmetic or internal. | Wrong label, report formatting | Normal PR flow |

---

## 4. First 15 minutes

1. **Write down the start time and what you observed.** Everything else is
   easier with this.
2. **Scope it.** Customer app, admin console, both? One branch or all? Ordering
   or just reporting?
3. **Check the platforms before the code** —
   <https://status.supabase.com>, <https://www.vercel-status.com>. If a provider
   is down, your job is customer communication, not debugging.
4. **Check what changed.** `git log --oneline origin/claude/project-build-ie4b56 -10`,
   the Vercel deployment list, and `docs/MIGRATIONS.md` for a recent apply.
5. **Decide: mitigate or diagnose.** For Sev 1–2, mitigate first. Diagnosis with
   customers affected is a luxury.
6. **Escalate if it is Sev 1**, or if it is Sev 2 and you cannot mitigate within
   15 minutes.

---

## 5. Levers that do not need a deploy

These are the fastest tools available and none of them requires a code release,
because most order behaviour is server-authoritative.

| Symptom | Lever | Where |
| --- | --- | --- |
| Online payments failing | Disable the online payment method; cash keeps working | Admin → Settings → Payments |
| One branch swamped or closed | Deactivate the branch | Admin → Branches |
| A menu item wrong or unavailable | Deactivate the product | Admin → Menu |
| A coupon over-redeeming | Deactivate the coupon | Admin → Coupons |
| POS integration misbehaving | Check the Lazywait integration state before disabling — orders may then need manual entry at the branch | Admin → Operations |

⚠️ Before disabling the POS integration, confirm the branch can take orders
another way. A silently disabled integration is worse than a visibly broken one.

---

## 6. "My money was taken and I got no food"

The single most likely serious customer report. Do not improvise this.

1. Get the customer's **phone number** and the approximate time.
2. Admin → Live Orders / Orders — find the order.
3. Establish which of these it is:
   - **Order exists, `payment_status = paid`, POS sync failed.** The kitchen
     never saw it. Phone the branch and place it manually. Check Orders Requiring
     Verification.
   - **Order exists, unpaid.** The charge did not complete on our side. Verify
     against the payment provider before promising anything.
   - **No order exists at all.** This is the serious case: money may have moved
     with no record here. Escalate to the owner immediately. Nothing currently
     reconciles the provider's ledger against `orders`, so this **cannot be
     resolved from the dashboard**.
4. Refunds: there is **no manual or partial refund path in the product**, and
   payment work is frozen (CLAUDE.md §6). A refund today is an owner action
   through the provider, recorded manually.
5. Whatever the outcome, tell the customer a specific next step and a time.

---

## 7. Communication

There is no status page and no customer notification channel. During a
customer-visible incident:

- Decide who talks to customers, and say the same thing on every channel.
- Tell the branches — they will be taking the phone calls.
- Prefer "we are working on it, try again in an hour" over silence. Do not give
  a fix time you are not confident in.

---

## 8. Afterwards

Within two working days, write a short note in the repo covering: what happened,
when it started, how it was detected (**and how long that took**), what fixed it,
and what would have caught it earlier.

Blameless and brief. The detection-latency number is the most valuable line —
it is the argument for the monitoring this system still lacks.

---

## 9. Related

- `docs/ROLLBACK.md` — getting back to a known-good deploy
- `docs/BACKUP_RECOVERY.md` — data loss (read its status warning)
- `docs/OPERATIONS_HEALTH_CENTER.md` — what the dashboard shows
- `docs/OPERATIONS_ALERTS_DIGEST.md` — the alert engine and why it stays internal
- `docs/ORDER_INTEGRITY_WATCHDOG.md` — order-integrity triage
