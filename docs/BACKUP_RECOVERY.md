# Backup and recovery

> **STATUS: UNVERIFIED — THIS IS THE MOST IMPORTANT UNANSWERED QUESTION IN THE
> PROJECT.**
>
> Nothing in this repository establishes that backups exist, what the retention
> window is, or that a restore has ever been performed. This file exists to make
> that gap explicit and to give the owner an exact list of things to check, not
> to claim a capability the project has.
>
> **Do not treat this document as evidence of a working backup.** Until §1 is
> filled in with real values and §3 has a completed drill, the honest statement
> is: *we do not know that we could recover this business's order, payment and
> customer data.*

This matters concretely. The production database holds order history, payment
records, loyalty balances and customer PII for a registered Saudi entity. A bad
migration, an accidental bulk delete, or a platform incident with no recovery
path is an existential outcome, not an inconvenience.

---

## 1. What the owner must confirm (dashboard only — nobody else can)

None of this is answerable from the repository. Fill in the values, commit this
file, and re-date it.

| Question | Where | Answer | Confirmed on |
| --- | --- | --- | --- |
| Is Point-in-Time Recovery enabled on `wxfmmnihidsdyemasstf`? | Supabase → Project Settings → Database → Backups | ☐ | |
| If PITR: what is the retention window (days)? | same | ☐ | |
| If not PITR: are daily backups on, and how many are retained? | same | ☐ | |
| What is the current Supabase plan? | Supabase → Project Settings → Billing | ☐ | |
| Is anything backed up **off-platform**? | — | ☐ | |
| Who can perform a restore (named people)? | — | ☐ | |

**Plan note.** Daily backups and PITR availability depend on the Supabase plan.
On the Free plan there is no PITR and backup retention is minimal or absent. If
the project is on Free, the honest answer to "what is our RPO?" is "undefined,"
and enabling PITR is the single highest-value spend in the entire readiness plan.

### Targets to decide (write the decision down, even if it is "we accept this")

- **RPO** — how much data may we lose? _(PITR makes this minutes; daily backups
  make it up to 24 hours.)_ → ☐
- **RTO** — how long may recovery take? _(Unrehearsed restores routinely take
  far longer than teams expect.)_ → ☐

---

## 2. What we know without the dashboard

- Schema is reproducible from `supabase/migrations/` (63 files) — see
  `docs/MIGRATIONS.md`, which is current and reconciles. **Schema is not data.**
  Replaying the chain gives an empty database.
- ⚠️ **Rebuilding an environment from the migration chain schedules the
  `payment-refund-worker` cron ACTIVE**, per `docs/MIGRATIONS.md` §11/§21. In
  production it is held off by a manual `cron.alter_job(active := false)` set
  *outside* the chain. Any restore or rebuild must re-apply that flag
  immediately. This is the one place where "just replay the migrations" causes
  real financial damage.
- Storage buckets (product images) are separate from the Postgres backup and
  need their own answer.
- Edge Function source is in git; deployed state is not recorded anywhere
  (see `docs/ROLLBACK.md` §2).

---

## 3. Restore drill — UNPERFORMED

**An untested backup is not a backup.** Until this section records a completed
drill with a measured duration, the recovery capability is theoretical.

The drill must run against a **throwaway project**, never production:

1. Create a scratch Supabase project.
2. Restore the most recent production backup into it.
3. **Immediately disable `payment-refund-worker`** (§2) and confirm no cron in
   the scratch project can reach a live provider or send anything.
4. Verify the data actually landed, not just that the restore reported success:
   - `select count(*) from orders;` — compare against production
   - the most recent order's `created_at` — this is your true RPO
   - `select count(*) from profiles;`, `order_items`, `payment_records`
   - RLS still enabled on all tables; SECURITY DEFINER functions present
5. Point a local build at the scratch project and load the admin console.
6. **Record the wall-clock time from decision to verified-usable.** That is the
   RTO. Not the estimate — the measurement.
7. Delete the scratch project.

| Drill | Date | Performed by | Measured RTO | Notes |
| --- | --- | --- | --- | --- |
| _(none yet)_ | | | | |

Re-run after any major schema change, and at least twice a year.

---

## 4. If you are restoring right now

1. **Stop the bleeding first.** If an active process is still corrupting data,
   restoring underneath it just gives it fresh data to corrupt.
2. **Do not restore over production as a first move.** Restore to a new project,
   verify, then cut over. An in-place restore that turns out to be the wrong
   snapshot destroys your remaining options.
3. **Capture the current state before overwriting anything**, however broken —
   it may be the only copy of data written since the snapshot.
4. **Re-apply the `payment-refund-worker` disable** (§2) before anything can run.
5. Work out what was written between the snapshot and the incident. Those orders
   are real: customers were charged and food may have been made. Reconciling them
   is manual and is part of the recovery, not an afterthought.
6. After cutover, run the verification in `docs/ROLLBACK.md` §5.

---

## 5. Related

- `docs/MIGRATIONS.md` — migration ledger; the pre-apply gate is the main defence
  against needing any of this.
- `docs/ROLLBACK.md` — code rollback (does not recover data).
- `docs/INCIDENT_RESPONSE.md` — who does what during an incident.
