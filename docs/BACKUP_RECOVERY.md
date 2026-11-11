# Backup and Recovery

> **Read live 2026-11-11: there is no backup to restore from.** The Supabase
> organisation is on the **Free plan**, and Supabase takes no automatic backup of
> a Free-plan project: no daily backups and no point-in-time recovery. No
> off-platform copy is known to exist, and nothing in this repository makes one.
> If the Production database were lost today, every order, customer account and
> loyalty balance since the project was created on **2026-07-08** would go with
> it, unless the owner holds a dump this document does not know about. No restore
> has ever been rehearsed, and no recovery targets are set.

Do not treat this document as evidence of a working backup. Until §1 and §2 hold
the owner's answers and §7 holds a completed drill, the honest statement is: **the
project cannot be restored.**

## 1. Live facts

These are dashboard and provider facts. Source cannot prove them, so each carries
the date it was read. The plan is an organisation setting and can change without a
commit: re-read it before relying on this table.

| Question | Answer | How it was verified |
| --- | --- | --- |
| Supabase plan | **Free** (`tier_free`) | `get_organization`, 2026-11-11; also read 2026-09-02 |
| Automatic daily backups | **None.** Supabase backs up Pro, Team and Enterprise projects daily, and recommends that Free projects export their own data with `supabase db dump` and keep it off-site | Supabase docs, [Database Backups](https://supabase.com/docs/guides/platform/backups), read 2026-11-11 |
| Point-in-time recovery | **Not available.** It is an add-on for Pro, Team and Enterprise projects, and needs at least the Small compute add-on | same page |
| Restore to a new project | **Not available.** Paid plans with physical backups only | Supabase docs, [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project), read 2026-11-11 |
| Any database dump kept off-platform | **Unknown. Owner to answer.** Nothing in the repository makes one: no workflow, script or package script runs `pg_dump` or `supabase db dump` | repository search, 2026-11-11 |
| Storage files | **In no database backup or dump.** Two public buckets: `banner-images` (4 objects, about 2.2 MB) and `product-images` (4 objects, about 3.1 MB) | Supabase docs (Database Backups); live read 2026-11-11 |
| What is at stake | 80 orders, 16 Auth users and 5 push devices, plus the loyalty ledger, addresses, catalog and configuration | live row counts, 2026-11-11 |
| Project | `wxfmmnihidsdyemasstf`, `eu-central-1`, Postgres 17.6.1.141, created 2026-07-08 | `get_project`, 2026-11-11 |
| Who can start a restore | ☐ owner to answer | |
| Who stands in if they are unavailable | ☐ owner to answer | |

Supabase's general Features page says "Projects are backed up daily". The Backups
page is the one that names the plans, and it leaves Free out. Do not read the
first as covering this project.

## 2. Recovery objectives: NOT SET (owner decision)

A backup setting is not a recovery plan until the business accepts targets.

**What is true today, with no decision made:**

- **RPO** (the data you would lose) is **everything since 2026-07-08**, the day the
  project was created. If a dump exists, it is the dump's age instead.
- **RTO** (the time back to usable service) is **undefined**. No restore path has
  ever been run, let alone timed.

**A recovery into a new project cannot move the installed apps quickly.** All
three EAS build profiles hard-code the Production project URL
(`apps/mobile/eas.json`), and the `/app` export falls back to it
(`apps/mobile/scripts/export-web.js`). The two web surfaces move with a Vercel
environment change and a redeploy, both owner actions. Every installed iOS and
Android app keeps calling `wxfmmnihidsdyemasstf` until a new build passes store
review. So a target shorter than a store review assumes the recovery happens
inside the existing project.

**Targets:**

- RPO target: ☐ owner decision
- RTO target: ☐ owner decision

Record the values and the owner's approval here.

The capability has to match the targets, and choosing it is the owner's too
(`OWNER_ACTIONS.md` §3). Supabase documents two routes:

- **Upgrade the organisation to Pro.** Daily backups, the last 7 kept. PITR then
  becomes available as a further add-on. Pro also lifts the 500 MB cap in §3: its
  quota is 8 GB of disk per project.
- **Scheduled off-platform logical dumps** with `supabase db dump`, as three files:
  roles, schema and data ([Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)).
  A dump holds every customer's personal data and the provider credentials kept in
  the database (§4.3), so the PDPL covers it as it covers the database, and it must
  be stored encrypted with access restricted. Making one needs a Production database
  credential.

Either route is a spending or credential decision. Neither is something this
repository can do.

## 3. Capacity: the Free plan's 500 MB cap

This outage loses no data and still stops every order. Supabase puts a Free-plan project into
**read-only mode** when its database size passes **500 MB**. Every write then fails
with `cannot execute INSERT in a read-only transaction`, so no order can be placed
([Understanding Database and Disk Size](https://supabase.com/docs/guides/platform/database-size),
"Free Plan behavior", read 2026-11-11).

Measured read-only on 2026-11-11:

| | Size |
| --- | --- |
| The `postgres` database | **207 MB** |
| Every database in the cluster, summed: the query Supabase says its Database report shows | 222 MB |
| `cron.job_run_details`: 660,860 rows since 2026-07-16, 7,082 added in the last 24 hours, never pruned | 124 MB |
| `public.operations_alert_runs` | 22 MB |
| `public.order_integrity_runs` | 19 MB |

88 MB was recorded on 2026-09-02 (`GO_LIVE_READINESS.md`; the method was not
recorded), so the database has grown by about 1.7 MB a day. At that rate it
reaches 500 MB in roughly five to six months.

**The fix is written and not live.** PR #435 adds the migration
`20261001120000_prune_operational_run_history`, which prunes those three logs. On
2026-11-11 it is open: not merged and not applied. Applying it is an owner action
(CLAUDE.md §5). It stops the growth; it does not shrink what is already on disk,
which would take a one-off `VACUUM FULL`.

## 4. What a restore or rebuild depends on

Read live on 2026-11-11, names only, never values. Every row here is a dated fact:
re-read it before relying on it.

Some of this state lives in the database and comes back with a restore, including
things that must not run in a copy. The rest lives outside it. Supabase lists what
needs "manual reconfiguration" after a copy as Edge Functions, Auth settings and
API keys, Realtime settings, extensions, and Storage objects
([Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)).

### 4.1 Scheduled jobs: stop the five that call out, first

There are eleven `pg_cron` jobs. Five of them run a function that calls an Edge
Function over `pg_net`. These five functions are the only ones in the database that
call out, and only `pg_cron` calls them (catalog read, 2026-11-11).

| Job | Schedule | Active, 2026-11-11 | Calls out | What it reaches |
| --- | --- | --- | --- | --- |
| `lazywait-sync` | every minute | yes | **yes** | `lazywait-sync`, which sends orders to the POS as **real kitchen tickets** |
| `account-deletion-processor` | every minute | yes | **yes** | `account-delete-scheduler`, which works through account-deletion requests |
| `admin-push-dispatch` | every minute | yes | **yes** | `admin-push-dispatch`, web push to staff browsers, only while `app_settings.admin_push_enabled` is on |
| `operations-alert-dispatch` | every 5 minutes | yes | **yes** | `operations-alert-dispatch`, alert email, only while `external_dispatch_enabled` is on |
| `payment-refund-worker` | every 5 minutes | **no** | **yes** | `payment-refund`. Frozen; it must stay off (§5) |
| `branch-availability-sweep` | every minute | yes | no | |
| `order-integrity-watchdog` | every 2 minutes | yes | no | |
| `operations-alerts-evaluator` | every 5 minutes | yes | no | |
| `operations-digest-generator` | hourly | yes | no | |
| `loyalty-expiry` | 00:20 UTC daily | yes | no | expires points, only while `loyalty_expiry_enabled` is on |
| `otp-retention-sweep` | 00:40 UTC daily | yes | no | deletes expired sign-in codes |

**Why they are stopped before anything else.** Each caller takes its target URL from
a Vault entry (§4.2) and authenticates with a secret the receiving function
accepts. In a copy, both still belong to Production. So a copy whose jobs run, and
whose Vault can be read, calls **Production's** functions with credentials
Production accepts. Production then does its own work, an unplanned extra pass
rather than a duplicate order, but the copy is now driving Production. Once the URLs
point at the copy and functions are deployed there, the copy's own workers act on
the copy's data with Production's provider credentials (§4.3): `lazywait-sync` would
send every order still queued in the copy to the real POS. Supabase gives the same
advice for any copy: disable `pg_net` and `pg_cron` work once the copy completes
(Restore to a new project, above).

In the **copy**, never in Production, run this as soon as it comes up:

```sql
select cron.alter_job(job_id := jobid, active := false)
from cron.job
where jobname in ('lazywait-sync', 'account-deletion-processor',
                  'admin-push-dispatch', 'operations-alert-dispatch',
                  'payment-refund-worker');

select jobname, active from cron.job order by jobname;  -- all five: false
```

- **For a drill, stop all eleven:** run it without the `where`. The other six touch
  only the copy's own rows, but they change the counts you are about to compare.
- **Deactivate; do not unschedule.** A real recovery needs the definitions, and
  disabling the `pg_cron` extension deletes every job
  ([Supabase Cron quickstart](https://supabase.com/docs/guides/cron/quickstart)).
- **Anything that ran before you got there is in `cron.job_run_details`.** Read it.
- **If the copy has no jobs at all**, it came from a dump that left them out:
  `supabase db dump` skips the schemas that extensions create, and `cron` is one
  ([CLI reference](https://supabase.com/docs/reference/cli/supabase-db-dump)). For a
  real recovery, re-create them from the `cron.schedule` statements in the
  migrations that made them (`grep -n "select cron.schedule(" supabase/migrations/*.sql`
  lists all eleven), then stop `payment-refund-worker` again.

### 4.2 Vault secrets

Seven entries, read by name on 2026-11-11:

| Name | What it is | Read by |
| --- | --- | --- |
| `lazywait_sync_project_url` | the URL the job calls | `invoke_lazywait_sync_processor`, and also `invoke_payment_refund_processor` |
| `account_deletion_project_url` | the URL the job calls | `invoke_account_deletion_processor` |
| `admin_push_dispatch_project_url` | the URL the job calls | `invoke_admin_push_dispatch` |
| `operations_alert_dispatch_project_url` | the URL the job calls | `invoke_operations_alert_dispatch` |
| `account_deletion_process_secret` | shared secret | its invoker, and `verify_account_deletion_process_secret` |
| `admin_push_dispatch_secret` | signing key | its invoker, and `verify_admin_push_dispatch_signature` |
| `operations_alert_dispatch_secret` | signing key | its invoker, and `verify_operations_alert_dispatch_signature` |

- **The four `*_project_url` entries name Production.** Rewrite them to the new
  project's URL before its jobs are re-enabled, and only in a real recovery: a drill
  leaves them alone and keeps the jobs off. Use `vault.update_secret` with named
  arguments; it takes five, four of them defaulted (`MIGRATIONS.md` ledger row 91).
- **The three secrets are checked inside the same database**, so a copy's functions
  verify against the copy's own values and need no rewrite.
- **Check whether the copy can read them without printing them:**
  `select name, decrypted_secret is not null as readable from vault.decrypted_secrets order by name;`
  Whether Vault comes back, and decrypts, depends on how the copy was made. That was
  not established here.
- **A rebuild from the repository creates only `admin_push_dispatch_secret`**
  (`20260928120000` generates it). The other six are made by hand:
  `account-deletion-scheduler.md`, `LAZYWAIT.md` and `MIGRATIONS.md` §13,
  `OWNER_ACTIONS.md` §28 and §41. Until they exist, each job stops before calling
  anything. `account-deletion-processor` does it by raising, every minute, which
  fills `cron.job_run_details` with failures.
- No `branch_ref:` entries existed on 2026-11-11. Once the branch reference sheet
  holds credentials (`BRANCH_ONBOARDING.md`), they live in Vault too.

### 4.3 Provider credentials and push tokens are inside the database

`integration_settings.secret_config` holds the providers' credentials, so every
backup and every data dump carries them. Key names on 2026-11-11; no value was read:

| Provider row | Secret keys |
| --- | --- |
| `lazywait` | `api_token`, `sync_trigger_secret`, `webhook_secret` |
| `whatsapp` (`meta_cloud`) | `access_token`, `otp_hmac_secret`, `send_sms_hook_secret`, `webhook_verify_token` |
| `email` (`smtp`) | `password` |
| `payment` (`tap`) | `live_secret_key`, `refund_trigger_secret`, `test_secret_key`. Frozen area, CLAUDE.md §6 |
| `push` (`expo`), `sms` (`sandbox`) | none |

`push_devices` holds the push token of every registered device: 5 rows on 2026-11-11.
`push-dispatch` sends to Expo with no credential of its own
(`supabase/functions/push-dispatch/index.ts:203-207`), so a token is all a sender
needs.

**So a restored copy is not "an environment with no live provider credentials".**
The restore brings them back. For a drill:

- deploy **no** Edge Functions to the copy. With its jobs off and no functions,
  nothing in it can reach a provider;
- treat the copy as holding Production secrets and customer personal data:
  restrict access, and delete it when the drill ends.

For a real recovery these credentials are exactly what you need. Do not scrub them.

### 4.4 Outside the database: recreate by hand

- **Edge Functions.** 25 were deployed on 2026-11-11: the 24 in
  `supabase/functions/`, plus `latency-probe`, a deliberate stub with no source
  that a rebuild does not need (`OWNER_ACTIONS.md` §23). Deploy from a known reviewed
  commit (§9), with each function's `verify_jwt` as `supabase/config.toml` sets it.
- **Edge Function secrets.** These are in no backup. The names the code reads are
  generated in [`reference/environment.md`](reference/environment.md): the
  `SUPABASE_*` values the platform supplies, plus `ADMIN_PUSH_VAPID_PUBLIC_KEY`,
  `ADMIN_PUSH_VAPID_PRIVATE_KEY`, `ADMIN_PUSH_VAPID_SUBJECT`,
  `ADMIN_PUSH_ALLOWED_HOSTS`, `SEND_SMS_HOOK_SECRET`, `SMTP_ALLOWED_HOSTS` and
  `WHATSAPP_OTP_HMAC_SECRET`. Which of them are set live was not read: no read-only
  tool here lists them. **`ADMIN_PUSH_VAPID_PRIVATE_KEY` exists only there.** Lose
  the project and every staff web-push subscription is unusable: a new key pair has
  to be made and the console subscribed again (`OWNER_ACTIONS.md` §41).
- **Auth settings.** Phone sign-in, and the Send SMS hook pointed at the project's
  `auth-send-sms-whatsapp` (`WHATSAPP_LOGIN.md` §4); the store-review test number,
  if one is configured (`OWNER_ACTIONS.md` §27); redirect URLs. **A hook set up on a
  new project gets a new secret.** The function takes `SEND_SMS_HOOK_SECRET` from its
  environment, else the stored `send_sms_hook_secret`
  (`supabase/functions/auth-send-sms-whatsapp/index.ts:50-55`), and refuses any call
  it cannot verify. A restored copy holds the old project's secret, so customer
  sign-in fails until the new one replaces it. Auth users come back with the
  database, but sessions issued by the old project are not valid in a new one:
  everybody signs in again.
- **Storage.** The two buckets are created by migrations (`20260712130000`,
  `20260827140000`), but the 8 files are in no backup. Copy them separately; Supabase
  publishes a script for it (Backup and Restore using the CLI, above).
- **Extensions**, enabled before a dump is restored: `pg_cron` 1.6.4, `pg_net`
  0.20.3, `pg_stat_statements`, `pgcrypto`, `postgis` 3.3.7, `supabase_vault` 0.3.1
  and `uuid-ossp` (2026-11-11).
- **Realtime.** The publications are `supabase_realtime` and
  `supabase_realtime_messages_publication`. There were no replication slots or
  subscriptions to drop first (2026-11-11).
- **Clients.** The Vercel environment for `/` and `/app`, the EAS environments, and
  the URL hard-coded in the build files (§2).

### 4.5 Switches to compare after any restore

A backup brings the switches back as they were when it was taken; a rebuild brings
back migration defaults. Compare each against a read-only Production reading taken
when the restore is decided, not against this list, which holds names only:

- **`integration_settings.enabled`**, one row per provider: `email`, `lazywait`,
  `payment`, `push`, `sms`, `whatsapp`. The `push` row is the master flag for live
  customer push (CLAUDE.md §7). `payment` must stay disabled while the freeze stands.
- **`app_settings`**: `loyalty_enabled`, `online_payment_enabled`,
  `cash_payment_enabled`, `payment_outage_mode_enabled`, `support_phone_enabled`,
  `support_whatsapp_enabled`, `support_email_enabled`, `loyalty_pickup_only`,
  `loyalty_expiry_enabled`, `variant_closing_enabled`, `admin_push_enabled`.
- **`operations_alert_settings`**: `alert_evaluation_enabled`,
  `digest_generation_enabled`, `external_dispatch_enabled`,
  `recovery_notifications_enabled`, `optional_system_alerts_enabled`.

### 4.6 Rebuilding the schema from the repository

**Schema source is not a data backup.** Replaying migrations onto an empty project
restores no business data.

- **Name every exclusion by version.** Never replay "whatever is in the
  directory". On 2026-11-11 two repository files are unapplied in Production:
  `20260824100000_moyasar_payment_provider` (frozen, CLAUDE.md §6) and
  `20260929120000_db_advisor_hardening` (awaiting approval). Read the current set from
  CLAUDE.md §8 and `MIGRATIONS.md` §1 on the day; do not copy this list forward. A
  replay that includes the Moyasar file installs the frozen payment objects.
- The two superseded July files, `20260707120700_place_order` and
  `20260707120800_loyalty`, replay as normal; later files replace what they define.
- A rebuild schedules all eleven jobs, `payment-refund-worker` among them, as
  **active**, because the scheduler migration schedules it (`MIGRATIONS.md` §11).
  Stop it at once (§5).
- Apply file by file, each named, as `MIGRATIONS.md` §9 describes. `supabase db push`
  is forbidden against Production (CLAUDE.md §8).

## 5. Critical restore safety: payment refund worker

The payment/refund area remains frozen and automated refund processing is intended to stay disabled.

A restore/rebuild must **not** assume that the manually disabled Production cron state is reproduced by the migration chain.

Immediately after creating/restoring a replacement environment, before live traffic or provider access:

```sql
select jobname, schedule, active
from cron.job
where jobname = 'payment-refund-worker';
```

Expected while the payment freeze is active: `active = false`.

If it is active, do not allow the restored environment to process refunds. Correcting live cron state is a Production write and requires the normal explicit approval path.

## 6. Restore drill: not yet recorded

Run the drill against a **disposable project**, never by experimenting on
Production. On the Free plan the only thing there is to drill is a dump the owner
made. If none exists, record that in §7 and stop.

1. **Pick the source**: the dump, or after an upgrade the backup, that you are
   testing. Note its age; that age is the RPO the drill measures.
2. **Create a disposable project.** Enable the extensions in §4.4 first. Deploy
   **no** Edge Functions to it.
3. **Restore it**, for a dump with the `psql` steps in Supabase's Backup and Restore
   using the CLI. Start the clock.
4. **Stop all eleven jobs at once** (§4.1), then read `cron.job_run_details` for
   anything that ran before you did. Leave the Vault URLs alone (§4.2).
5. **Give the copy a sign-in that sends nothing.** Customers normally sign in
   through the Send SMS hook (`auth-send-sms-whatsapp`), which the copy deliberately
   lacks, and Auth settings are not restored anyway (§4.4). In the copy's
   **Authentication → Sign In / Providers → Phone**:
   - enable the provider;
   - configure an SMS provider with placeholder values. Auth requires one to be
     configured but uses none for a test number. Never point the copy at the
     WhatsApp hook;
   - add a **Test Phone Numbers and OTPs** pair for a number the owner controls:
     their own customer account, never another customer's;
   - set **Test OTPs Valid Until** to the end of the drill.

   Supabase's [Test auth flows](https://supabase.com/docs/guides/auth/testing-auth-flows)
   guide (read 2026-11-11) says Auth doesn't send an SMS to a test number.

   Staff sign in with email and password as usual. An admin also needs a TOTP
   factor for AAL2. If the restored `auth` data did not bring theirs, enrol a fresh
   one in the copy.
6. **Compare** row counts and latest timestamps with a read-only Production reading
   taken when the drill started: orders, Auth users, profiles, addresses, the
   loyalty ledger, push devices, branches and products.
7. **Check the boundaries**, read-only: RLS enabled on every `public` table, the
   advisors, and two sessions each reading only what they should:
   - the customer, signed in with the step 5 test number;
   - a staff member.
8. **Copy Storage separately** (§4.4) and check the 8 files open.
9. **Point a local build at the copy.** Sign in with the step 5 test number and use
   read journeys only: menu, order history, profile. Placing an order needs
   `order-intake`, which the copy deliberately lacks.
10. **Stop the clock** when those journeys work. Record the snapshot age and the
    elapsed time in §7.
11. **Delete the copy.** It holds Production personal data and provider credentials
    (§4.3).

Do not use real online payment/refund operations as part of this drill while the payment area is frozen.

## 7. Drill record

| Drill date | Backup/restore point | Performed by | Data loss observed (RPO) | Time to usable (RTO) | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| _none recorded_ | | | | | **UNVERIFIED** | |

## 8. Minimum validation after a real disaster restore

Before reopening customer traffic:

- [ ] Production database endpoint/project identity is the intended restored environment.
- [ ] The five call-out jobs were stopped before anything else ran (§4.1), and each was re-enabled only after its target and credentials were checked.
- [ ] `payment-refund-worker` is disabled while the freeze remains active.
- [ ] The four `*_project_url` Vault entries name the restored project (§4.2).
- [ ] No test/scratch provider credentials can reach live providers.
- [ ] The Send SMS hook points at the restored project, and `auth-send-sms-whatsapp` holds that hook's secret (§4.4). Otherwise every customer sign-in fails.
- [ ] Auth/login works for an approved test account.
- [ ] Branch/catalog/product data is present, and the Storage files are copied (§4.4).
- [ ] Order history/latest order timestamp matches the accepted recovery point.
- [ ] Profiles/addresses/loyalty records are present within the accepted RPO.
- [ ] RLS is enabled and staff/customer boundaries behave correctly.
- [ ] The switches in §4.5 match the last known Production values.
- [ ] Required Edge Functions are deployed from a known reviewed commit, and their secrets are set (§4.4).
- [ ] Lazywait/WhatsApp provider configuration is deliberately restored/verified before enabling live traffic.
- [ ] Sentry/monitoring points at the correct environment.
- [ ] Vercel/EAS client env points at the restored Production project only after verification. A new project also needs new native builds (§2).

## 9. Edge Function recovery

Function source is in Git, but a name-level drift check cannot prove byte-for-byte deployed content.

Recovery should therefore deploy required functions from a **known reviewed production commit**, using the controlled owner-approved deployment workflow. Do not restore by copying an unknown deployed function back into Git.

Payment functions remain frozen and require a separate exception/decision even during recovery unless restoring the last known running state is explicitly approved.

## 10. What Git can and cannot recover

Git contains:

- application/admin source;
- Edge Function source;
- database migration files;
- SQL regression tests;
- deployment/workflow definitions.

Git does **not** contain:

- customer/order/payment/loyalty production data;
- live Auth users/sessions;
- Storage bucket contents;
- dashboard secrets, Edge Function secrets and Vault values;
- a full proof of which Edge Function bytes are deployed;
- dashboard configuration: Auth settings, the Send SMS hook, Vercel and EAS
  environments.

For the current count of applied and unapplied migrations, read CLAUDE.md §8 and
`MIGRATIONS.md` §1. The count moves with every apply, so it is not repeated here.

## 11. Documentation ownership

After any backup-setting change, dump schedule or restore drill:

- update this file with the live values and the date;
- update `docs/OWNER_ACTIONS.md` §3 so resolved items disappear;
- update `docs/INCIDENT_RESPONSE.md` if roles/channels change;
- update migration-status evidence after any approved migration action.

A backup feature shown in a dashboard is not "ready" until the team has demonstrated that it can restore usable data inside the agreed RPO/RTO.
