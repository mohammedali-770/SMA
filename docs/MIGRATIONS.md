# Supabase Migrations — Authoritative History Ledger & Production Workflow

> **This document is the single source of truth for the relationship between
> the repository's `supabase/migrations/` files and the production project's
> `supabase_migrations.schema_migrations` history, and for the ONLY approved
> way to apply migrations to production.** It must be updated after every
> approved live migration application.

---

## 1. Purpose and production status

**As of 2026-08-22 class E is empty again: every repository migration is applied
to Production.**

Two files were applied on 2026-08-22 with explicit owner approval, via the MCP
`apply_migration` workflow, one call per file. Full evidence — pre-live gate,
drift check, verification, advisors and rollback — is in
`docs/MIGRATION_APPLICATION_20260822.md`.

| Repository file | Applied version | Result |
| --- | --- | --- |
| `20260819120000_order_note_length_limit` | `20260822123620` | applied |
| `20260821170000_order_item_notes` | `20260822123940` | applied |

The first was a **dependency the second could not run without**:
`order_item_notes` calls `public.order_note_normalized`, which did not exist in
Production because `20260819120000` had never been applied. The first of those
calls sits in `order_item_note_is_acceptable`, a `language sql` function, and
PostgreSQL validates a SQL-language body at `create function` time under the
default `check_function_bodies = on` — so applying only the second would have
aborted there, in the apply output. The plpgsql write paths after it would have
been accepted, since plpgsql defers resolution to runtime, but the migration
never reaches them.

- Repository migration files (default branch `claude/project-build-ie4b56`): **97**
- Live `schema_migrations` rows: **103**
- Unapplied repository files: **0**
- Latest live version: **`20260822123940`**
  (`order_item_notes`; repository version `20260821170000`)

The 97 / 103 difference is the long-standing **history** divergence, not a
*schema* divergence. It has held at **6** since the 2026-08-12 reconciliation
(79 files / 85 rows) — see `docs/MIGRATION_RECONCILIATION_20260812.md`, and §28
for the 2026-08-21 application. The class-by-class algebra in §4 was last
recomputed from live data on 2026-08-07 and is **not** extended here by
arithmetic alone.

That divergence was **2** when §4 was last recomputed from live data on
2026-08-07, at 68 files / 70 rows: **five** live-only F-class rows carry no
repository file, and **three** H-class repository files (`place_order`,
`loyalty`, `order_idempotency`) were superseded by later consolidated
migrations. `68 files − 3 H-class + 5 F-class = 70 rows`. §4 carries that full
class-by-class algebra, reconciling both sides exactly **as of that date**;
§5 maps a subset of the rows.

> **One of those five F-class rows was discovered during the 2026-08-07 pre-live
> gate and had never been recorded here:** version `20260806045142`, name `noop`, whose
> entire content is `select 1;`. It is a connectivity probe, not a schema change
> — it creates, alters and drops nothing, and the schema is identical with or
> without it. It is documented rather than removed, because deleting a live
> history row is a destructive write needing its own approval and would buy
> nothing. Its presence is why the live count read 66 rather than the 65 this
> ledger previously asserted. Recomputing §4 while chasing it also turned up two
> further miscounts this document had carried for a long time — H was 2 and is
> 3, F was 3 and is 5. Both are recorded in §4.

> **Version alignment was deliberately NOT performed** (run-book Step 3, §9-D).
> `apply_migration` stamped apply-time versions that differ from the repository
> filenames, so the three applied on 2026-08-05 are class **B**, which is what
> most of the ledger already looks like. Aligning them is a separate live
> history write needing its own explicit owner approval.

### The 2026-08-05 application

The three files unapplied before the 2026-08-07 wave — two from PR #142, one
from PR #146 — were applied on 2026-08-05, the same way.

| Repository file | Applied version | Result |
| --- | --- | --- |
| `20260801120000_address_single_default` | `20260805061621` | applied |
| `20260801120100_checkout_session_address_fk_set_null` | `20260805061912` | applied |
| `20260802120000_address_description_trim_all_whitespace` | `20260805061955` | applied |

Pre-live gate (§9-B), recorded before applying:

| Check | Value |
| --- | --- |
| FK `checkout_sessions_address_id_fkey` | `confdeltype='a'` (NO ACTION) — not yet applied |
| `confupdtype` / `confmatchtype` / deferrable | `a` / `s` / false — to be preserved verbatim |
| `checkout_sessions.address_id` NOT NULL | false — the DROP NOT NULL branch does not run |
| Customers holding >1 default address | **0** — migration 1's normalisation UPDATE touched no rows |
| Sessions / snapshot fingerprint | 6 / `0bffc7257feb7ff29731ec6ac35247fd` |
| Sessions the new guard would block | **0** |
| Ledger before | 62 rows, latest `20260729112238` |

Verification (§9-E), after applying:

- **Snapshot fingerprint unchanged: `0bffc7257feb7ff29731ec6ac35247fd`.** This is
  the check that matters — no checkout session row was read for update, written
  or re-priced.
- FK now `confdeltype='n'` (SET NULL) with `confupdtype='a'`, `confmatchtype='s'`,
  not deferrable, same constraint name, still referencing `addresses(id)` — every
  property other than ON DELETE reproduced verbatim.
- `enforce_single_default_address()`, `guard_address_delete_live_checkout()`,
  triggers `trg_addresses_single_default` and `trg_addresses_guard_live_checkout`,
  and indexes `addresses_one_default_per_customer` and
  `checkout_sessions_address_idx` all present.
- Customers with multiple defaults: 0.
- `address_description_is_usable` behaviour re-checked in Production, including
  the assertion that had never run:
  `address_description_is_usable(E'\t\n  \t')` is now **false**. Narrowing
  confirmed — real AR/EN landmarks and the 5- and 500-character boundaries are
  still accepted, 501 still rejected.
- Advisors: **zero ERROR** on both Security and Performance. The only lint naming
  a new object is INFO `unused_index` on `checkout_sessions_address_idx`, which
  is expected for an index created to support a delete path that has not yet run.

**Run-book Step 0 was satisfied by CI, not by the local harness it describes.**
Since PR #145 the `SQL suites` workflow replays the entire migration chain onto a
throwaway PostGIS Postgres and runs all 26 suites against a fresh clone. All
three suites for these migrations (`address_single_default_test.sql`,
`checkout_session_address_fk_test.sql`, `require_address_description_test.sql`)
are present, none is quarantined in `.github/sql-ci/known-failing.txt`, and that
job is green on the merged head. That is a stronger gate than the manual
procedure the run-book was written against, because it runs on every push.

**Still outstanding: the application smoke test** (run-book Step 4.5). Adding two
addresses and promoting one, and the three delete cases, must be exercised in the
mobile app as a real customer. That needs a device and a signed-in account and has
**not** been done.

### Ten migrations were applied on 2026-07-29

Eight of them closed a **Production incident**: the deployed frontend was
calling RPCs that did not exist in the database, because the repository had run
eight migrations ahead of Production. The visible symptom was a single
PostgREST `PGRST202` error
(`Could not find the function public.admin_list_orders_with_items(p_limit) in
the schema cache`), but the cause was the whole eight-migration gap. Full
detail — including the per-wave verification and the data-drift evidence — is in
**§20**.

All ten are class **B** (same reviewed content; `apply_migration` stamps a
generated apply-time version that differs from the repository filename):

| Repository file | Live version | Applied |
| --- | --- | --- |
| `20260724130000_loyalty_reason_no_order_number` | `20260729073748` | Wave A |
| `20260724190000_loyalty_reason_history_safe` | `20260729073815` | Wave A |
| `20260728120000_discounts_campaigns` | `20260729073932` | Wave A |
| `20260723140000_operations_automation_cron_health` | `20260729074316` | Wave A |
| `20260724120000_order_confirmation_state_machine` | `20260729074810` | Wave B |
| `20260724200000_order_read_contracts` | `20260729074932` | Wave B |
| `20260724170000_require_address_description` | `20260729075631` | Wave B |
| `20260724180000_tap_reference_order_opaque` | `20260729080617` | Wave B |
| `20260729090000_payment_refund_scheduler` | `20260729112224` | Wave C |
| `20260729091000_caller_can_read_order_anon_revoke` | `20260729112238` | Wave C |

**The refund worker scheduled by `payment_refund_scheduler` is DISABLED.** The
cron job `payment-refund-worker` (jobid 6, `*/5 * * * *`) was set
`active = false` on 2026-07-29 when the owner postponed all payment work
pending gateway selection. The job row, its schedule and every refund object
were **retained, not dropped** — see **§21** and `docs/PAYMENT_POSTPONEMENT.md`.

### Earlier applications (all owner-approved, all class B)

The 2026-07-20…22 wave, itemized in §5 (rows 39–46) and detailed in §13–§16:

- `20260720120000_lazywait_sync_scheduler` → live **`20260720075244`** (§13)
- `20260721120000_lazywait_confirmation_lifecycle` → live **`20260721082325`** (PR #69)
- `20260721130000_lazywait_synced_ref_guard` → live **`20260721084330`** (PR #70)
- `20260721150000_lazywait_sync_health_summary` → live **`20260721113811`** (PR #71; §14)
- `20260721170000_order_integrity_watchdog` → live **`20260722053151`** (PR #73; §15)
- `20260722100000_operations_health_center` → live **`20260722113923`** (PR #75, squash `91c11b7`; §16)
- `20260723090000_smart_operations_alerts_digest` → live **`20260722143014`**
- `20260723120000_activate_operations_alerts_digest_cron` → live **`20260722165557`**

The **five account-deletion migrations** (live `20260715120000`,
`20260715130000`, `20260716160000`, `20260716170000`, `20260716180000`;
repository files of the same names) are applied and live but **not yet
itemized/classified in §4/§5** — a known documentation gap, deliberately left
for a separate documentation PR so this reconciliation stays reviewable. They
are counted in the 61 / 62 totals above.

### Schema alignment

The production schema is **functionally aligned with the repository in full**:
every repository migration is applied and verified, based on catalog/object-state
verification (tables, columns, functions and exact signatures,
SECURITY DEFINER/INVOKER state, pinned `search_path`, grants, RLS policies,
triggers, indexes, storage bucket and policies, realtime publication
membership). The 2026-07-14 trigger-function grant hardening is applied and
verified (§10). **Historical version identifiers and several migration
boundaries still differ** between the repository and production — a *history*
divergence only; the full mapping is in §5.

## 2. Non-negotiable safety rules

1. **NEVER run `supabase db push` against the production project** while this
   historical divergence exists.
2. **NEVER run `supabase migration repair`** merely to align filenames or
   version numbers.
3. **NEVER rename or rewrite historical repository migrations.**
4. **NEVER edit production `supabase_migrations.schema_migrations` without
   separate, explicit owner approval** (each single-row alignment write is its
   own approval — see §9-D).
5. **NEVER assume a migration is unapplied based only on filename/version.**
   Versions in production are apply-time stamps, not repository filenames.
6. Always consult **this ledger plus live object verification** before
   reasoning about what is or is not applied.
7. Migrations must be **reviewed (including Codex review) and merged** before
   any live application.
8. **Each live migration application requires separate explicit owner
   approval.** Merge approval is not apply approval.

## 3. Evidence and confidence terminology

Claims in this document are labelled: **CONFIRMED** (directly verified),
**STRONGLY SUPPORTED** (consistent, multi-source evidence; not directly
witnessed), **POSSIBLE** (plausible, incomplete evidence), **UNKNOWN**.

The following live facts are **CONFIRMED** (read-only inspection of
`supabase_migrations.schema_migrations`, 2026-07-14, post-Stage-4):

- 39 migration rows exist;
- all 39 store their SQL as **one statements-array entry** (a single blob);
- all 39 share the **same `created_by` value** (the owner's account);
- all 39 have **NULL `idempotency_key`**;
- all 39 have **no rollback entries**;
- earliest version is **`20260708062345`**; latest is **`20260714130000`**;
- `trigger_function_execute_hardening` exists exactly once; the generated
  version `20260714153905` no longer exists;
- table shape: `version` (PK), `statements text[]`, `name`, `created_by`,
  `idempotency_key` (UNIQUE), `rollback text[]`.

Provenance of historical rows: the claim that all historical migrations were
executed through the Supabase **MCP `apply_migration`** tool is
**STRONGLY SUPPORTED** (the single-statement-blob + `created_by` +
timestamp-version recording pattern matches that tool exactly, and does not
match CLI `db push`, which splits statements; the Dashboard SQL editor writes
no history rows at all) — but execution logs do not independently prove the
mechanism for each historical row. The three 2026-07-14 applications
(`support_contact`, `push_notifications`,
`trigger_function_execute_hardening`) are **CONFIRMED** first-hand MCP
`apply_migration` runs, including the observed behavior that the tool stamps
an apply-time version (e.g. `support_contact` was first recorded as
`20260714111153` before its approved single-row alignment to
`20260714070000`). For `trigger_function_execute_hardening` the following is
**CONFIRMED** first-hand: it was applied via `apply_migration` on
2026-07-14; the generated version was `20260714153905`; a separately
approved, exactly-one-row version alignment changed it to `20260714130000`;
**only the version column changed** during that alignment (all non-version
fields byte-identical before/after, fingerprint-verified).

## 4. Classification summary

**Recomputed from live data on 2026-08-07 and now covering ALL 68 repository
files and ALL 70 live rows** — previous revisions of this table were scoped to a
56-file subset and, separately, undercounted two classes. Method: match by
`name`, then compare the repository filename version against the live `version`,
and the repository file's `skel` fingerprint against the live row's.

| primary classification | count |
|---|---|
| A. `EXACT_MATCH` (version + name + content) | **8** |
| B. `SAME_CONTENT_DIFFERENT_VERSION` | **54** |
| C. `SAME_NAME_DIFFERENT_CONTENT` | **3** |
| D. `SAME_VERSION_DIFFERENT_CONTENT` (version collision) | **0** |
| E. `REPOSITORY_ONLY_UNAPPLIED` | **0** |
| F. `LIVE_ONLY_MISSING_FROM_REPOSITORY` | **5** |
| H. `SUPERSEDED` (repository side) | **3** |

**Both sides reconcile exactly, with no residue:**

```
repository:  A 8 + B 54 + C 3 + H 3 = 68 files
live      :  A 8 + B 54 + C 3 + F 5 = 70 rows
```

Three movements since this table was recomputed, all on 2026-08-07:

- **B 52 → 53**, when `20260807150000_order_flow_health_card` was applied as
  live `20260807152347` (§25).
- **E 0 → 1**, when `20260807170000_order_flow_alert_condition` merged without
  being applied (§26).
- **E 1 → 0 and B 53 → 54**, when that file was applied as live
  `20260807172027`. The file total stayed at **68** and the row total rose to
  **70**, exactly as §26 predicted before the apply — which is the check that
  the counts were right in both states.

A, C, D, F and H are unmoved.

**Two corrections to numbers this ledger had carried for a long time**, both
found by recomputing rather than by re-reading:

- **H was 2, is 3.** The repository-only files are `place_order`, `loyalty` and
  — previously unlisted — `order_idempotency`. All three were superseded by
  consolidations applied live.
- **F was 3, is 5.** The live-only rows are
  `order_idempotency_and_place_order` (the consolidation of two of the H files),
  `checkout_sessions_fix_payment_status_cast`, `checkout_sessions_zero_total`,
  `harden_trigger_functions`, and `noop` (§1).

**A is 8, not 3.** The five account-deletion migrations
(`account_deletion`, `account_deletion_lock`, and the three
`account_deletion_scheduler_*`) were applied from their repository filenames, so
their live versions equal their repository versions — verified against
`schema_migrations` on 2026-08-07. Earlier revisions listed them as "applied and
live but not yet itemized"; they are itemized now. The other three are
`support_contact`, `push_notifications` and
`trigger_function_execute_hardening`.

**C is unchanged at 3** — `checkout_sessions`, `homepage_banners`,
`loyalty_audit` — the same three names the original audit identified,
independently reconfirmed by fingerprint.

Classifications can overlap semantically in the detailed mapping (e.g. a
live-only row whose content was later consolidated into a repository file is
both "live-only" and "superseded-by-consolidation"); **each ledger entry below
carries exactly one primary classification**, with overlaps explained in its
notes.

> **Superseded scope note.** Revisions of this document before 2026-08-07
> carried a note here restricting the table to the 56 repository / 57 live rows
> itemized in §5 (rows 1–56), with the five account-deletion migrations
> described as "applied and live but not yet itemized". That scoping is gone:
> the table above covers every file and every row, and §5's row-by-row mapping
> is now a *subset* of it rather than its definition. §5 has not been re-derived
> and its own 61/62 totals remain as written — treat §4 as authoritative for
> counts and §5 as the detailed mapping of the rows it covers.
>
> **Class E is empty again as of 2026-08-07.** It held the two rows added
> 2026-08-06 — `20260806120000_erasure_phone_normalization` (§22) and
> `20260806130000_admin_ranged_orders_and_stats` (§23) — applied that day with
> explicit owner approval and now class **B** (§24); then
> `20260807150000_order_flow_health_card` (§25); then
> `20260807170000_order_flow_alert_condition` (§26). All four are class **B**. The
> operations-automation cron-health migration
> `20260723140000_operations_automation_cron_health` — the last remaining
> class-E row, recorded as repository-only in every earlier revision of this
> document — was applied to Production on **2026-07-29** → live
> **`20260729074316`**, reclassifying it to **B** (§5 row 47, §17, §20).
> Likewise the order confirmation state machine (§18) and the two
> loyalty-reason migrations (§19) are applied, not pending. **Class B is the
> normal steady state of this repository**, because `apply_migration` always
> stamps a generated apply-time version (§12).

Fingerprints: `skel` = MD5 (first 12 hex) of the SQL after removing `--`
comments, all whitespace and semicolons, lowercased — computed with identical
transforms on the repository file and on the live row's joined statements, so
equality means content equivalence regardless of formatting or statement
splitting. `=` in the live column means *identical to the repository
fingerprint on that row*.

## 5. Complete authoritative migration ledger

State result key: ✔ = live object state verified against the current catalog.
Replay risk = risk that mis-tooling (e.g. `db push`) would re-run it against
production.

| # | repo version | repo name | repo skel | live version | live name | live skel | class | state | confidence | action | replay risk | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 20260707120000 | extensions_enums_helpers | `01a3c9ac0bcd` | 20260708062345 | extensions_enums_helpers | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 2 | 20260707120100 | profiles | `4dc9d2ad19fc` | 20260708062402 | profiles | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 3 | 20260707120200 | catalog | `acd08850cca1` | 20260708062427 | catalog | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 4 | 20260707120300 | addresses | `64c077d4657d` | 20260708062440 | addresses | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 5 | 20260707120400 | coupons | `e13b80a53a31` | 20260708062503 | coupons | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 6 | 20260707120500 | orders | `73feb7b2d8b9` | 20260708062528 | orders | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 7 | 20260707120600 | app_settings | `fa291a8ee930` | 20260708062543 | app_settings | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 8 | 20260707120700 | place_order | `7058bd13c211` | — | — | — | **H** | ✔ | STRONGLY SUPPORTED | none | high if `db push` | original `place_order`; no live row matches this exact content. Final function state reached production via later exactly-matched migrations (`order_idempotency_and_place_order`, `sec_coupon_usage_race`, `payment_methods`, `place_order_delivery_zone`). Current live `place_order(9 args)` verified |
| 9 | 20260707120800 | loyalty | `f2f4ee1bbbfa` | — | — | — | **H** | ✔ | STRONGLY SUPPORTED | none | high if `db push` | early loyalty logic; content superseded. Loyalty objects verified live (see #10) |
| 10 | 20260707120900 | loyalty_audit | `91c01c701245` | 20260708062643 | loyalty_audit | `69c618090b0b` | **C** | ✔ | STRONGLY SUPPORTED | none | high if `db push` | live row is an earlier, smaller edition (orders loyalty columns, `loyalty_transactions` + indexes + RLS, `adjust_loyalty_points(uuid,int,text)` with admin `42501` guard — all verified live). The repository file gained 2 later edits (git: 3 commits) whose effects reached production through subsequently matched migrations |
| 11 | 20260707121000 | integration_settings | `19a5efeb35a0` | 20260708062704 | integration_settings | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 12 | 20260707121100 | realtime_orders | `20ad6abf51b4` | 20260708062725 | realtime_orders | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 13 | 20260707121200 | perf_indexes | `ca6c3c095d24` | 20260708062734 | perf_indexes | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 14 | 20260707121300 | payments_and_sync | `1db8e3d07cf3` | 20260708062802 | payments_and_sync | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 15 | 20260707121400 | order_idempotency | `cea1fcd356d9` | 20260708062851 | order_idempotency_and_place_order | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical; live name is a longer descriptive variant of the same file |
| — | — | — | — | 20260708063206 | harden_trigger_functions | `e66d3f5bc9e5` | **F** | ✔ | CONFIRMED (content read) | none | n/a (live-only) | live-only early hardening: pins `search_path` and revokes client EXECUTE on `set_updated_at`, `set_order_number`, `handle_new_user`. Effects verified live; repository superseded it with the broader `sec_trigger_search_path` |
| 16 | 20260708130000 | lazywait_integration | `8e64b42ebad9` | 20260709063858 | lazywait_integration | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 17 | 20260708140000 | lazywait_stale_reap | `3c593d8609e2` | 20260709063925 | lazywait_stale_reap | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 18 | 20260708150000 | lazywait_catalog_mapping | `2ef5934d7d7d` | 20260709064007 | lazywait_catalog_mapping | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 19 | 20260708160000 | sec_coupon_usage_race | `c6a0d4a1ed84` | 20260709064101 | sec_coupon_usage_race | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 20 | 20260709120000 | sec_trigger_search_path | `c71a95910669` | 20260709064120 | sec_trigger_search_path | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 21 | 20260709130000 | import_lazywait_catalog | `101b0d01f74b` | 20260709072709 | import_lazywait_catalog | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 22 | 20260709140000 | payment_methods | `ee630dfd7d28` | 20260709111046 | payment_methods | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical. **Payment area — frozen (§21)** |
| 23 | 20260710120000 | delivery_zones | `eab12cc0f3c1` | 20260709115813 | delivery_zones | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 24 | 20260710120100 | place_order_delivery_zone | `e63a1bfcba14` | 20260709151718 | place_order_delivery_zone | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical; recreates `place_order` (current live definition) |
| 25 | 20260710140000 | whatsapp_otp | `5b681f22d61f` | 20260709165615 | whatsapp_otp | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 26 | 20260710150000 | whatsapp_login | `86e2d67e4b6c` | 20260709174957 | whatsapp_login | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 27 | 20260710150100 | whatsapp_login_status_rpc | `ba23f23e2c9e` | 20260709175311 | whatsapp_login_status_rpc | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 28 | 20260710160000 | fix_whatsapp_login_review | `393db5b25757` | 20260709191229 | fix_whatsapp_login_review | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 29 | 20260710170000 | email_integration | `2994d9e5e98c` | 20260709203911 | email_integration | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 30 | 20260710180000 | lazywait_sync_one | `cf7f3fc5e851` | 20260710082112 | lazywait_sync_one | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 31 | 20260712120000 | tap_payments | `2f3d84f9b4b4` | 20260712070033 | tap_payments | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical. **Payment area — frozen (§21)** |
| 32 | 20260712130000 | homepage_banners | `a4070f36bcfc` | 20260712121739 | homepage_banners | `16fe7e5659ff` | **C** | ✔ | POSSIBLE (draft-vs-commit variance) | none | high if `db push` | live row was applied from a marginally different draft (one policy/phrasing delta). Final live state verified: 5 table policies + 4 `banner-images` storage policies + public bucket + trigger |
| 33 | 20260712140000 | legal_documents | `0930fee9750d` | 20260712123717 | legal_documents | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 34 | 20260712160000 | checkout_sessions | `4295c6e9ca6d` | 20260712185657 | checkout_sessions | `d3e294e05a77` | **C** | ✔ | STRONGLY SUPPORTED | none | high if `db push` | repository file is a pre-commit **consolidation** of the live base apply plus the two live-only fix applies below (repository file contains the payment_status-cast fix markers). Checkout flow verified live incl. zero-total settlement. **Payment area — frozen (§21)** |
| — | — | — | — | 20260712191643 | checkout_sessions_fix_payment_status_cast | `8639b171467f` | **F** | ✔ | STRONGLY SUPPORTED | none | n/a (live-only) | live-only fix; content folded into the repository's consolidated `checkout_sessions.sql` (also semantically SUPERSEDED-by-consolidation) |
| — | — | — | — | 20260712192526 | checkout_sessions_zero_total | `a62f0bfd577e` | **F** | ✔ | STRONGLY SUPPORTED | none | n/a (live-only) | live-only fix; content folded into the repository's consolidated `checkout_sessions.sql` (also semantically SUPERSEDED-by-consolidation) |
| 35 | 20260712170000 | checkout_sessions_hardening | `9f1d8844c9a7` | 20260713044036 | checkout_sessions_hardening | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical. **Payment area — frozen (§21)** |
| 36 | 20260714070000 | support_contact | `f02603422918` | 20260714070000 | support_contact | = | **A** | ✔ | CONFIRMED | none | none (aligned) | applied 2026-07-14 via MCP `apply_migration`; version aligned to the repository filename by an approved single-row history write |
| 37 | 20260714090000 | push_notifications | `d686d8f6e428` | 20260714090000 | push_notifications | = | **A** | ✔ | CONFIRMED | none | none (aligned) | applied 2026-07-14 via MCP `apply_migration`; version aligned as above |
| 38 | 20260714130000 | trigger_function_execute_hardening | `dbd86ce8831e` | 20260714130000 | trigger_function_execute_hardening | = | **A** | ✔ verified live | CONFIRMED | none | none (aligned) | applied via `apply_migration` on 2026-07-14; originally recorded under generated version `20260714153905`, then separately aligned to `20260714130000` by an approved exact-one-row version update. Removed PUBLIC/anon/authenticated EXECUTE from the three trigger-only functions; the pre-existing explicit `service_role=X` ACL entry remained — it originates from Supabase's platform **default function privileges** applied at creation (CONFIRMED in `pg_default_acl`: postgres-owned functions default-grant EXECUTE to anon/authenticated/service_role), NOT from any live-only grant, so it is not production drift and reproduces identically in any environment built from these repository migrations; function bodies and trigger definitions unchanged |
| 39 | 20260720120000 | lazywait_sync_scheduler | `26b85de4256e` | 20260720075244 | lazywait_sync_scheduler | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Lazywait POS sync pg_cron driver + durable run ledger.** Owner-approved; applied **2026-07-20** via MCP `apply_migration` (exact merged content from PR #67, squash `c6579e6…`); generated apply-time live version `20260720075244` — **not** version-aligned (repository filename version `20260720120000` differs; no §9-D write performed). Verified live objects: `public.lazywait_sync_requests`, `public.lazywait_sync_cron_health`, `public.invoke_lazywait_sync_processor()`, cron job `lazywait-sync` (jobid 2, `* * * * *`, active). No payment/order-intake/worker/payload/delivery/POS change. Full detail in §13 |
| 40 | 20260721120000 | lazywait_confirmation_lifecycle | — | 20260721082325 | lazywait_confirmation_lifecycle | = | B | ✔ verified live (`list_migrations` + live lifecycle objects in service) | CONFIRMED | none | high if `db push` | **Customer-visible POS confirmation lifecycle** (PR #69). Owner-approved; applied 2026-07-21 via MCP `apply_migration`; generated live version differs from the repository filename (class B, no §9-D alignment). No payment/cron/Vault change |
| 41 | 20260721130000 | lazywait_synced_ref_guard | — | 20260721084330 | lazywait_synced_ref_guard | = | B | ✔ verified live (`list_migrations`; version recorded in the migration file header) | CONFIRMED | none | high if `db push` | **Producer-side synced/usable-ref invariant guard** (PR #70). Owner-approved; applied 2026-07-21; redefines `record_lazywait_sync` only. No payment/cron/Vault change |
| 42 | 20260721150000 | lazywait_sync_health_summary | `0f4de301255c` | 20260721113811 | lazywait_sync_health_summary | = | B | ✔ verified live (function properties, grants, live output) | CONFIRMED | none | high if `db push` | **Service-role-only aggregate health summary for the lazywait-sync scheduler** (PR #71, squash `4c3d0bd…`). Owner-approved; applied **2026-07-21** via MCP `apply_migration` with the exact merged file content; observability-only (one new SECURITY DEFINER function; read-only over the ledger, `cron.job`, orders sync state). Full detail in §14 |
| 43 | 20260721170000 | order_integrity_watchdog | — | 20260722053151 | order_integrity_watchdog | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Observe-only order-integrity watchdog** (PR #73, squash `411c7c9`). Owner-approved; applied **2026-07-22** via MCP `apply_migration` with the exact merged content; generated live version differs from the repository filename (class B, no §9-D alignment). Observe-only cron `order-integrity-watchdog` (`*/2`) active; alert outbox populated but unsent. Full detail in §15 |
| 44 | 20260722100000 | operations_health_center | — | 20260722113923 | operations_health_center | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Read-only Operations Health Center** (PR #75, squash `91c11b7`; applied content SHA-256 `c86412dd…`, 33 198 bytes). Owner-approved; applied **2026-07-22** via MCP `apply_migration` with the exact merged content; generated live version differs from the repository filename (class B). Two read-only functions only — the `operations_health_summary()` RPC is staff-gated (`is_staff()`), the `operations_health_overall_state()` helper is `service_role`-only; no tables/cron/triggers. Full detail in §16 |
| 45 | 20260723090000 | smart_operations_alerts_digest | — | 20260722143014 | smart_operations_alerts_digest | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Smart Operations Alerts & Daily Digest engine.** Owner-approved; applied **2026-07-22** via MCP `apply_migration`; class B (generated live version differs from the repository filename). External dispatch remains disabled |
| 46 | 20260723120000 | activate_operations_alerts_digest_cron | — | 20260722165557 | activate_operations_alerts_digest_cron | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Activation of the alerts/digest crons.** Owner-approved; applied **2026-07-22** via MCP `apply_migration`; class B. Created internal crons `operations-alerts-evaluator` (`*/5`) and `operations-digest-generator` (hourly); external dispatch disabled |
| 47 | 20260723140000 | operations_automation_cron_health | — | 20260729074316 | operations_automation_cron_health | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Per-cadence staleness for the two internal-automation crons** on the ops-health scheduled-jobs card (merged `06c9bb0`, PR #85). **Reclassified E → B**: owner-approved and applied **2026-07-29** (Wave A, §20). Two `create or replace function` statements only; no tables/cron/triggers/grants. Full detail in §17 |
| 48 | 20260724130000 | loyalty_reason_no_order_number | — | 20260729073748 | loyalty_reason_no_order_number | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Stops the internal `SM-…` order number reaching the customer-readable `loyalty_transactions.reason`** (Issue #94). Applied 2026-07-29 (Wave A, §20). Adds a predicate, a safe-reason function, a normalizing trigger and a NOT VALID CHECK; `place_order` untouched. Full detail in §19 |
| 49 | 20260724190000 | loyalty_reason_history_safe | — | 20260729073815 | loyalty_reason_history_safe | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | Companion to row 48 — makes the historical loyalty reasons safe on read without rewriting them. Applied 2026-07-29 (Wave A, §20) |
| 50 | 20260728120000 | discounts_campaigns | — | 20260729073932 | discounts_campaigns | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Discounts & campaigns schema.** Applied 2026-07-29 (Wave A, §20). See `docs/DISCOUNTS_CAMPAIGNS.md` for the open business questions that still gate wiring it into `place_order` |
| 51 | 20260724120000 | order_confirmation_state_machine | — | 20260729074810 | order_confirmation_state_machine | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Customer-visible order confirmation state machine + refund enrolment** (Issue #94). Applied 2026-07-29 (Wave B, §20). Creates `order_refunds`, the `orders.refund_state` lifecycle columns, the transition-guard trigger, and the token-fenced `claim_order_refund`/`finalize_order_refund` worker RPCs. **Refund processing is NOT running** — the worker cron is disabled (§21). Full detail in §18 |
| 52 | 20260724200000 | order_read_contracts | — | 20260729074932 | order_read_contracts | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Order read contracts** — the admin/staff order-read RPCs the deployed frontend requires, including `admin_list_orders_with_items`. Applied 2026-07-29 (Wave B, §20); this is the migration whose absence produced the `PGRST202` incident symptom |
| 53 | 20260724170000 | require_address_description | — | 20260729075631 | require_address_description | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | Requires a delivery-address description. Applied 2026-07-29 (Wave B, §20) |
| 54 | 20260724180000 | tap_reference_order_opaque | — | 20260729080617 | tap_reference_order_opaque | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | Makes the provider-facing order reference opaque. Applied 2026-07-29 (Wave B, §20). **Payment area — frozen (§21)** |
| 55 | 20260729090000 | payment_refund_scheduler | — | 20260729112224 | payment_refund_scheduler | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Refund worker scheduler + stale-claim reaper** (PR #112, squash `e36fff1`). Applied 2026-07-29 (Wave C, §20). Adds `expire_stale_order_refund_claims()` and `invoke_payment_refund_processor()` and schedules cron `payment-refund-worker` (jobid 6, `*/5 * * * *`). **That cron was set `active = false` the same day** when the owner postponed payment work; the job row and all objects are retained (§21) |
| 56 | 20260729091000 | caller_can_read_order_anon_revoke | — | 20260729112238 | caller_can_read_order_anon_revoke | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Security hardening (not payment-specific)** — revokes `anon` EXECUTE on `public.caller_can_read_order(uuid)` while `authenticated` retains it, with a DO-block assertion. Closes the Supabase Security Advisor `anon_security_definer_function_executable` finding for that function. Shipped alongside row 55 in PR #112; applied 2026-07-29 (Wave C, §20). Latest live version until the 2026-08-05 application |
| 57 | 20260819120000 | order_note_length_limit | — | 20260822123620 | order_note_length_limit | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Server-side 280-character bound on the customer order note** (PR #222, `aff65ce`; 182 lines). Applied **2026-08-22 12:36:20 UTC** with explicit owner approval; generated live version differs from the repository filename (class B, no §9-D alignment). Adds `order_note_normalized`, `order_note_is_acceptable`, `enforce_order_note` and the `orders` / `checkout_sessions` triggers; no existing row exceeded the bound, so nothing was rejected or rewritten. Executable SQL identical to the file (`skel` `0262280dd19823dcf85ab2b8b125d10b` both sides) but the stored text is condensed, 182 → 86 lines — a §9-C1 deviation, §31. Applied by a **Claude Code session** (`session_01VXmTcJDSWXVD9qm7irPbpV`), which applied this and row 58 one after the other via MCP `apply_migration` — one call per file, in dependency order, each followed by read-only verification — on the owner's explicit in-conversation approval. **Corrected 2026-08-24:** this row previously credited the **repository owner** directly, sourced to an owner statement of 2026-08-23; the owner authorised and drove both applications but did not issue the calls, and the mechanism is no longer unrecorded. Detail in §27 and §31 |
| 58 | 20260821170000 | order_item_notes | — | 20260822123940 | order_item_notes | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Per-item order notes** (PR #231, `0eeb66d`; 833 lines). Applied **2026-08-22 12:39:40 UTC**, immediately after row 57, which it **depends on**: it calls `public.order_note_normalized` in five places — `order_item_note_is_acceptable`, `enforce_order_item_note`, `place_order`, `compute_order_snapshot` and `insert_order_from_snapshot`. The first of them, `order_item_note_is_acceptable`, is `language sql` — PostgreSQL validates such a body at `create function` time (`check_function_bodies` on by default) — so applying this one alone would have aborted there, loudly, in the apply output. An earlier revision of this row and of §1 claimed it would have succeeded silently and broken order placement; that was wrong and was corrected in PR #233 after review. Class B, no §9-D alignment. It re-emits four functions; all four matched their repository last-definers before the apply, so nothing live was silently reverted — PR #229's `branch_modifier_availability` guard in `place_order` confirmed present before *and* after. Executable SQL identical to the file (`skel` `89e6adeef95a6ff70b73a6298c672103` both sides), stored text condensed 833 → 721 lines — §9-C1 deviation, §31. Applied by the same **Claude Code session** as row 57, immediately after it, one after the other — see row 57, including the 2026-08-24 attribution correction. Detail in §31. |
| 59 | 20260824120000 | product_variants | — | 20260825061046 | product_variants | ≠ | B | ✔ verified live | CONFIRMED | none | high if `db push` | **`product_variants` — the Lazywait price tier made first-class** (PR #256, `b36e7d8`; 572 lines). Applied **2026-08-25 06:10:46 UTC** on explicit owner approval, via MCP `apply_migration`. Adds `public.product_variants` (12 columns, RLS enabled, 2 policies, 3 indexes), `order_items.variant_id` + `variant_name_en` + `variant_name_ar` with a customer SELECT grant to `authenticated`, and four columns on `lazywait_catalog_items`. Redefines `set_lazywait_mapping`, `clear_lazywait_mapping` and `import_lazywait_catalog`. **Version NOT aligned** — live carries the apply-time stamp `20260825061046`, not the repository filename; realignment is a separate §9-D owner action and has not been performed. Fidelity proven rather than assumed: every function body applied was hashed against the merged file and matched byte-for-byte (`import_lazywait_catalog` md5 `58d2b732f11c17d442350b393db3928c`, 14 387 chars; `set_lazywait_mapping` `951093a076e2e95fb477808eea6e8a6f`; `clear_lazywait_mapping` `4dd0dc0c46a4db8b2c4cabc11199f05c`). Security advisors after the apply: **zero** naming `product_variants`. Detail in §32 |
| 60 | 20260824130000 | place_order_variants | — | 20260825061502 | place_order_variants | ≠ | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Carry the chosen tier through every order-writing path** (PR #256, `b36e7d8`; 798 lines). Applied **2026-08-25 06:15:02 UTC**, immediately after row 59, which it **depends on**: every redefined body references `public.product_variants`, so applying this one first would have failed on an unknown relation. Redefines exactly four functions — `place_order`, `compute_order_snapshot`, `insert_order_from_snapshot`, `admin_list_orders_with_items`. `begin_checkout_session` is deliberately NOT redefined: it delegates item work to `compute_order_snapshot` and never touches a line. **Version NOT aligned** — live carries `20260825061502` (§9-D, separate approval). All four bodies hashed against the merged file and byte-identical: `place_order` md5 `dcd117de2c3a0f63c048bfa47a96587a` (15 287 chars), `compute_order_snapshot` `a37ee893140629b3636271089df3f576`, `insert_order_from_snapshot` `60b753bc57ef4d20ef529fc42b3ead79`, `admin_list_orders_with_items` `4d2b5d10d9d8124ca8891eb4a39f4d37`. No payment, coupon, loyalty or VAT arithmetic changed — the tier edits are the only difference from row 58's definitions. Detail in §32. **Current latest live version** |

Reconciliation check: the rows above detail **58 repository / 59 live** rows.
That is a **subset**, not the whole picture — rows 1–56 stop at 2026-07-29 and
omit the five account-deletion migrations, the three applied 2026-08-05, the
four applied 2026-08-07, everything applied between 2026-08-10 and 2026-08-21
(§28), `branch_availability_retention` (§30), and the `noop` probe. Rows 57–58
are appended out of that sequence because §1 now turns on them.

**§4 is authoritative for the class algebra**, and reconciled the full set
exactly **as of 2026-08-07**: `A 8 + B 54 + C 3 + H 3 = 68` repository files,
`A 8 + B 54 + C 3 + F 5 = 70` live rows. It has not been recomputed from live
data since; §1 carries the current totals (97 files / 103 rows). The rows
between 2026-07-29 and 2026-08-22 have deliberately **not** been re-derived —
doing so is a mechanical expansion with no new information, and the counts it
would produce are already stated in §1 and §4.

**There is no repository-only/UNAPPLIED file** (class E is empty). The live-only
F-class rows carry no repository file. This is a history divergence, not drift.

## 6. Why `db push` is unsafe

Currently **eight** repository versions match live migration-history versions:
the three aligned July-14 migrations (`20260714070000`, `20260714090000`,
`20260714130000`) and the five account-deletion migrations (`20260715120000`,
`20260715130000`, `20260716160000`, `20260716170000`, `20260716180000`), whose
repository filenames were applied under matching version stamps. The Supabase
CLI compares by **version**, so it would still consider the remaining
**60 repository files** (68 − 8) unapplied and attempt to replay them against
production — even though **every one of them is in fact already applied**.
Eight shared versions do **not** make `db push` any safer; the permanent
production prohibition stands, because 60 repository versions still do not
match live history, content boundaries differ for consolidated/split
migrations, and replaying historical migrations against a live database remains
unsafe regardless.

> The count grows with every migration applied through `apply_migration`, since
> each one stamps a fresh apply-time version. It was 53 against 61 files, then
> 58 against 66; it is now **60 against 68**. `db push` gets *more* dangerous
> over time, not less.

Risks:

- **historical replay** of the entire schema against a live database;
- **seed/data re-execution** (integration seeds, settings rows);
- **DO-block re-execution** (assertion/normalization blocks);
- **partial failure** mid-batch, leaving a half-applied, half-recorded state;
- **duplicate or misleading history rows** (53 junk records even on success);
- **incorrect skip/replay behavior around consolidated migrations** — the
  repository's `checkout_sessions.sql` and the loyalty-era files do not map
  1:1 onto live rows, so no version-based comparison can treat them correctly;
- **re-running the refund scheduler migration would re-create and re-activate
  the `payment-refund-worker` cron**, defeating the deliberate disable in §21.

## 7. Why `migration repair` is not recommended

- Content **boundaries differ** for the loyalty-era files and the
  checkout-sessions trio: there is no truthful version mapping for a
  consolidated or split history — repair would create **false equivalence**.
- Version repair cannot fix the three `SAME_NAME_DIFFERENT_CONTENT` drifts.
- There is **no production schema defect** requiring repair; the schema is
  functionally aligned.
- Repair therefore offers **no functional benefit** today, while adding real
  risk of a future `db push` replaying or skipping the wrong migrations.

## 8. Approved strategy

- **Strategy C (adopted):** this authoritative mapping ledger, with both
  historical timelines preserved untouched.
- **Strategy D (adopted):** individually owner-approved live migrations via
  MCP `apply_migration`, per the workflow in §9.
- **Strategy E (optional, future):** create NEW environments (e.g. staging)
  from the repository migrations on an empty database, keeping production
  history preserved separately (§11).
- **Strategy A (rejected for production):** repairing live history versions to
  repository filenames — see §7.
- **Strategy B (rejected for production):** renaming/rewriting repository
  migration files to match live versions — rewrites reviewed git history and
  still cannot express the differing content boundaries.

## 9. Approved future production migration workflow

**A. Repository preparation**
1. Create ONE migration file with a stable repository version/name.
2. Review it in a PR; run tests/static validation.
3. Obtain a Codex review on the final head.
4. Merge only after explicit owner approval.

**B. Pre-live gate** (all read-only)
1. Verify the repository base commit.
2. Verify the current live migration count and latest version.
3. Verify the expected live object state (the migration's preconditions).
4. Capture rollback SQL for every change the migration makes.
5. Verify the migration has not already been applied **semantically** (object
   state, not just history rows).
6. Record before-state fingerprints for everything the migration touches.

**C. Apply**
1. Apply **exactly the reviewed migration content** using MCP
   `apply_migration` — nothing added, nothing removed.
2. No `db push`. No batch replay. No unrelated SQL in the same operation.

**D. Version alignment** (separate, explicitly approved live history write)
1. `apply_migration` stamps an apply-time version (CONFIRMED behavior).
2. Updating that generated version to the repository filename version is a
   **separate live history write requiring its own explicit owner approval**.
3. It must affect **exactly one row**; the target repository version must not
   already exist in `schema_migrations` (the column is the primary key).
4. Identify the row by **name + generated version + SQL fingerprint together**
   — never by name alone.
5. Abort if more or fewer than one row matches.
6. Never perform broad migration-history repair under this step.

**E. Verification**
1. Verify the exact object/grant/policy changes the migration promised —
   nothing more, nothing less.
2. Verify the `schema_migrations` row and its SQL fingerprint.
3. Verify migration count and latest version.
4. Run the relevant Security/Performance Advisors.
5. Run application smoke tests.
6. Update this ledger (§5) and document the final state.
7. **Verify writes in a separate statement.** A data-modifying CTE is not
   visible to sibling SELECTs in the same statement; reading back in the same
   statement can report a successful write as absent (§20).

## 10. Completed migration: trigger-function EXECUTE hardening (Stage 4)

`supabase/migrations/20260714130000_trigger_function_execute_hardening.sql`

- **Status: merged, applied to production, version-aligned, verified —
  COMPLETE.**
- **Application date:** 2026-07-14.
- **Application method:** MCP `apply_migration` (exact merged file content;
  Stage 4A) — **not** `db push`.
- **Generated version:** `20260714153905` (apply-time stamp).
- **Version alignment:** a separately approved, exactly-one-row version
  update changed the recorded version to the final aligned version
  **`20260714130000`** (Stage 4B); only the version column changed.
- **Migration count after completion:** **39**.
- **Effect (verified):** PUBLIC/anon/authenticated EXECUTE removed from
  `public.handle_auth_user_phone_confirmed()`,
  `public.set_lazywait_initial_sync()` and
  `public.stamp_payment_record_ts()`; the explicit `service_role` EXECUTE
  entry remained. **Provenance of that entry (CONFIRMED, not drift):**
  Supabase's platform default function privileges (`pg_default_acl`) grant
  EXECUTE on every postgres-owned function to anon/authenticated/
  service_role at creation time — the hardening migration revoked the
  first two plus PUBLIC, and the platform-default service_role entry
  remains. No repository or live-only `GRANT` statement is involved, and
  any environment created from these repository migrations on a Supabase
  project reproduces the identical end-state. Function bodies, owners,
  SECURITY DEFINER/INVOKER state, `search_path` and all three trigger
  definitions unchanged; Security Advisor trigger-function findings
  cleared; business tables and push state untouched.

## 11. New environment guidance

- Production history must **not** be copied or "repaired" simply to create a
  new environment.
- A new staging environment should be created by applying the repository
  migrations, in order, to an **empty database**.
- The resulting schema and any test data must be verified independently
  (advisors + application test suite) before use.
- Production and new-environment migration histories **may legitimately
  differ**; each environment gets its own ledger section if tracked here.
- A new environment built this way **will** schedule `payment-refund-worker`
  as active, because the scheduler migration schedules it. While the payment
  postponement (§21) stands, disable that job immediately after building the
  environment.

## 12. Historical audit reference

- Original audit date: **2026-07-14**
- Audited production project: **`wxfmmnihidsdyemasstf`**
- Originally audited repository base:
  **`a058e2b436774c323f50320a2a32b44b8dc5ccfe`**
- **Ledger update (Stage 4):** Stage 4A application completed **2026-07-14**;
  Stage 4B version alignment completed **2026-07-14**; repository base used
  for the live operation:
  **`efb92aaf68c0e3331de7cda51903539a85835df6`**; current documented live
  migration count: **39**; current documented latest version:
  **`20260714130000`**.
- **Ledger update (2026-07-20):** the Lazywait POS sync scheduler
  (repository `20260720120000` → live `20260720075244`) was owner-approved,
  applied via MCP `apply_migration`, and verified — see §13. Documented live
  migration count at that point: **45**; latest live version:
  **`20260720075244`**. Repository base (default branch) for the live
  operation: **`c6579e6414106abb6940ea4a19e789fec9754c04`**.
- **Ledger update (2026-07-29):** ten migrations applied in three waves
  (§20) — eight of them closing a Production incident caused by the database
  running eight migrations behind the deployed frontend. Live migration count
  after the wave: **62**; latest live version: **`20260729112238`**; repository
  files on the default branch: **61**; unapplied files: **0**. Default-branch
  head for the final wave: **`e36fff1`** (PR #112 squash). This revision of the
  document also corrects §1, §4, §5, §6, §17, §18 and §19, which had continued
  to describe migrations as pending or repository-only after they were applied.
  The five account-deletion migrations remain to be itemized in §4/§5
  (documentation gap; see §1).
- This ledger records the state as of the **2026-07-29** update. It **must be
  updated after every approved live migration application** (new §5 row +
  fingerprints recorded), and re-validated if any tooling other than the §9
  workflow ever touches `schema_migrations`.
- **Expected classification of a newly applied migration.** **Class B**
  (`SAME_CONTENT_DIFFERENT_VERSION`) is the normal, expected result immediately
  after `apply_migration`, because the tool stamps a **generated apply-time
  version** that differs from the repository filename version — this is exactly
  what happened for all ten 2026-07-29 applications and for the Lazywait
  scheduler before them (repo `20260720120000` → live `20260720075244`, §5 row
  39 / §13). **Class A** (`EXACT_MATCH`) applies **only** when the live version
  already exactly equals the repository version, or after a **separate,
  explicitly owner-approved §9-D version-alignment** write changes the live
  version to match. Applying a migration **never** requires, implies, or
  pressures maintainers to perform a version-alignment write; version alignment
  is optional, separate, and needs its own explicit owner approval. **No
  version-alignment action is authorized by this documentation PR.**

## 13. Completed migration: Lazywait POS sync scheduler (2026-07-20)

`supabase/migrations/20260720120000_lazywait_sync_scheduler.sql`

- **Status: merged (PR #67, squash `c6579e6414106abb6940ea4a19e789fec9754c04`),
  owner-approved, applied to production, verified — COMPLETE.**
- **Application date:** 2026-07-20.
- **Application method:** MCP `apply_migration` (exact merged file content) —
  **not** `db push`, **not** `migration repair`.
- **Repository version:** `20260720120000`. **Generated live version:**
  `20260720075244` (apply-time stamp). **Not** version-aligned — no §9-D
  history write was performed, so the repository and live versions
  intentionally differ (classification **B**, `SAME_CONTENT_DIFFERENT_VERSION`).
- **Owner approval:** explicit owner approval for this activation was given in
  the working conversation (create the Vault URL entry + apply the migration),
  per §2 rule 8. Merge approval (PR #67) and apply approval were separate.
- **Live migration count after completion:** **45**.
- **Verified objects (post-apply, read-only):**
  - `public.lazywait_sync_requests` — durable per-tick run ledger; RLS enabled;
    all client grants revoked; service-role-only; no secret/customer/order-data
    columns.
  - `public.lazywait_sync_cron_health` — durable health view; service-role-only;
    exposes no secret/headers/response body/customer data.
  - `public.invoke_lazywait_sync_processor()` — `SECURITY DEFINER`, pinned
    `search_path`, service-role-only `EXECUTE` (no PUBLIC/anon/authenticated).
  - cron job **`lazywait-sync`** — jobid 2, schedule `* * * * *`, active; the
    stored command is only `select public.invoke_lazywait_sync_processor();`
    (no secret, token, Authorization header, or project URL). Exactly one such
    scheduler exists; the pre-existing `account-deletion-processor` cron
    (jobid 1) is unchanged.
- **Live health verification:** across **five-plus consecutive one-minute
  ticks** the driver reconciled to `success_2xx` / **HTTP 200** (Edge Function
  `lazywait-sync` `POST | 200`), with **no** `auth_failed` / `preflight_failed`
  / `driver_error` / `rate_limited` / `server_error_5xx` / `timeout` /
  `transport_error` / unexpected `expired_unknown`, and **no** duplicate cron
  executions.
- **Vault:** contains only the **non-secret** project URL
  `lazywait_sync_project_url` (created exactly once; value
  `https://wxfmmnihidsdyemasstf.supabase.co`). The Lazywait
  `sync_trigger_secret` is **not** stored in Vault — it remains sourced live
  from `integration_settings.secret_config` and is passed byte-for-byte.
- **Backlog / data safety:** the eligible sync backlog was **0 before and
  after**; **no** new/duplicate Lazywait/POS ticket was created; **no** real
  test order or payment was created.
- **Scope (unchanged):** no change to payment verification, order intake, the
  `lazywait-sync` worker, the Lazywait Create Order payload mapping, delivery
  behaviour, or POS logic; no Edge Function deployed or edited; no unrelated
  cron modified; no audit/business log deleted.
- **Config invariants (verified in the applied function):** every-minute
  schedule; bounded `{"limit":5}` batch; 140 000 ms pg_net timeout; 15-minute
  `expired_unknown` threshold; 14-day ledger retention on every path; trigger
  secret from `integration_settings`; project URL from Vault; no second
  scheduler.
- **Follow-up (documentation debt):** the five account-deletion migrations
  applied after Stage 4 (§1) are not yet itemized in §4/§5 and should be
  reconciled in a separate documentation PR.

---

## 14. Completed migration: Lazywait sync health summary (2026-07-21)

`supabase/migrations/20260721150000_lazywait_sync_health_summary.sql`

- **Status: merged (PR #71, squash `4c3d0bdcb419659aaefae21510fcc84e318cfea0`,
  PR head `213197aceed785a2fa766c48b8872fd801a4e973`), owner-approved, and
  APPLIED to production on 2026-07-21** via MCP `apply_migration` with the exact
  merged file content (sha256 `0f4de301255c0005f7345ee2a1f63bbbba07ac408b235400b7f58ccaa47dc829`).
- **Live version:** generated apply-time `20260721113811`
  (`lazywait_sync_health_summary`) — class **B** vs the repository filename
  version `20260721150000`; **no** §9-D version-alignment write performed.
- **Scope — observability only.** One new function
  `public.lazywait_sync_health_summary()` (SECURITY DEFINER, `search_path=public`,
  STABLE, EXECUTE revoked from PUBLIC/anon/authenticated, granted to
  service_role only). Read-only over `lazywait_sync_requests`, `cron.job` and
  the orders sync-state columns. **No change** to
  `invoke_lazywait_sync_processor`, the cron schedule/frequency, the
  lazywait-sync worker, payment, order intake, the Lazywait payload mapping,
  POS logic, Vault, secrets, integration settings, orders, or customer data.
- **Pre-live gate (recorded before apply):** scheduler migration live
  (`20260720075244`); cron job `lazywait-sync` jobid 2, `* * * * *`, active;
  `lazywait_sync_requests` present (1 664 rows); target function absent;
  zero name/version collisions; 47 live rows before apply → 48 after.
- **Post-apply verification:** function exists with the exact expected
  properties and grants (anon/authenticated denied, service_role allowed);
  live output contains exactly the 15 documented keys and no secret/header/
  body/customer data.
- **Initial health reading (11:38:34 UTC, same minute as apply):**
  `overall_state = healthy`, `cron_active = true`, latest tick 11:38:00,
  latest observed response HTTP 200 (11:37:01, age 93 s), streaks 0/0,
  due orders 0/0.
- **Steady-state reading (11:41:21 UTC, after three further one-minute ticks):**
  `overall_state = healthy`, `cron_active = true`, latest tick 11:41:00,
  latest observed response HTTP 200 (11:40:00, age 80 s),
  `consecutive_http_401 = 0`, `consecutive_5xx_or_timeout = 0`,
  `due_pending_failed_orders = 0`, `due_without_success_since = 0`.
  (The `latest_failure` field shows a historical 502 from 08:13 UTC — pre-apply
  history surfaced for operator context; it does not affect the streaks or the
  state.)
- **Operator usage:** the service role calls
  `select public.lazywait_sync_health_summary();` — state rules and the
  3-minute tick / 5-minute success staleness thresholds are documented in the
  migration header. An HTTP 2xx proves the worker invocation completed, not
  that every due order synced; per-order outcomes stay in `orders` /
  `integration_sync_logs`.

## 15. Completed migration: Order Integrity Watchdog (2026-07-22)

**Observe-only, shadow-mode monitoring.** Owner-approved application of the merged
Order Integrity Watchdog migration to Production.

- **Repository file:** `supabase/migrations/20260721170000_order_integrity_watchdog.sql`
- **Merged commit:** `411c7c9d82392dc7e7aaa6f74d942294361a5b47` (PR #73, squash of
  `feature/order-integrity-watchdog`; clean Codex review on `1cdd787`).
- **Applied repository content SHA-256:**
  `8f8392bc6b818177cddfc983772f3337155f61d5977245435c05fe833e8c0e89` (53991 bytes),
  read directly from the merged default branch.
- **Generated live version:** **`20260722053151`** (name `order_integrity_watchdog`).
  Class **B** (same content; apply-time version differs from the repository
  filename version `20260721170000`).
- **Method:** MCP `apply_migration` (single call, byte-exact merged content, no
  edits). No `db push`, no `migration repair`, no SQL-editor/untracked DDL.

**Pre-live gate (all passed):** default-branch SHA `411c7c9`; migration present at
that commit; latest live version was `20260721113811`; Production had zero
`order-integrity-watchdog` cron jobs / zero watchdog tables / zero
`public.order_integrity_*` functions / no watchdog migration row; existing jobs
`account-deletion-processor` (jobid 1) and `lazywait-sync` (jobid 2) active;
dependencies `orders`, `payment_records`, `checkout_sessions`, `profiles`,
`is_staff()`, `is_admin()`, `lazywait_pos_ref_is_usable(text)`, `pg_cron` all
present; no name/cron collision. Safe pre-apply baseline (counts only): 17 orders
all pickup, all `pending` payment (0 paid); sync states synced=13,
awaiting_payment=3, skipped=1; payment_records 6 failed + 3 initiated (0 paid);
all 11 supported-rule predicates 0.

**Objects created (isolated, additive):** 4 tables
(`order_integrity_config`/`_runs`/`_incidents`/`_alert_outbox`), all with RLS
enabled and no `anon`/`authenticated` direct grants; 7 functions, all
`SECURITY DEFINER` with `search_path=public` — `order_integrity_watchdog()` and
`order_integrity_health_summary()` **service-role-only**, and
`order_integrity_admin_summary`/`list_incidents`/`incident_timeline` (is_staff
gated) + `acknowledge`/`suppress` (is_admin gated) granted to `authenticated`;
config seeded with exactly one valid row for `rule_enabled` (object),
`abandoned_awaiting_payment_since` (timestamp), `excluded_order_ids` (array).

**Cron verification:** exactly one job `order-integrity-watchdog` (jobid 3),
schedule `*/2 * * * *`, command `select public.order_integrity_watchdog();`,
`active = true`, no secret/token/URL in `cron.job`. No existing job was changed;
the every-minute `account-deletion-processor` and `lazywait-sync` cadences are
unchanged.

**Shadow-mode observation (read-only):**
- Initial `order_integrity_health_summary()` (05:32 UTC, after the first
  scheduled run): `healthy`, cron active, `rules_evaluated=11`, 0 incidents.
- After 6 scheduled runs (through 05:42 UTC): **6 runs, all `success`**, 0
  non-benign failures, `rules_evaluated=11` each; `overall_state = healthy`,
  `watchdog_cron_active = true`, `open_critical_count = 0`, `open_warning_count = 0`,
  `acknowledged_count = 0`, `suppressed_count = 0`, `latest_incident = null`,
  `incidents_opened_last_24h = 0`, `incidents_resolved_last_24h = 0`.
- **Incidents:** 0 total, 0 unresolved.

**Observe-only safety (verified):** after 6 runs, `orders` = 17 and
`payment_records` = 9 (unchanged from baseline), `lazywait_sync_state`
distribution unchanged (synced=13, awaiting_payment=3, skipped=1), all
`payment_status` still `pending`. Writes occurred only in the four watchdog
tables. The watchdog created/cancelled no order, touched no payment or POS/Lazywait
state, called no external provider, and sent no notification.

**Alert dispatch remains DISABLED.** The `order_integrity_alert_outbox` is
populated only (0 rows so far; 0 `sent`); no sender exists. Enabling alert
dispatch, provider-side reconciliation, and any automatic remediation are
separate future deliverables, each requiring its own explicit owner approval.

**UI activation:** the capability-gated **Order Integrity** admin tab reveals now
that `order_integrity_admin_summary` is live and granted to `authenticated`
(it stayed hidden while the RPC was absent); triage controls render for admins
only, accountants/staff are read-only, and customers have no access.

## 16. Applied migration: Operations Health Center (Production rollout, class B)

**Read-only observability. MERGED and APPLIED to Production on 2026-07-22
(class B).** This entry records the migration that shipped with PR #75. It was
squash-merged, then applied to the Production project `wxfmmnihidsdyemasstf` via
the owner-approved MCP `apply_migration` workflow, and now has live
`schema_migrations` row `20260722113923`.

- **Repository file:** `supabase/migrations/20260722100000_operations_health_center.sql`
- **Applied content SHA-256:**
  `c86412dd413e26ce8d4db8fa43b79173781a9c98226dcb65a9f64f9d04ac2602` (33 198 bytes
  — the merged file on `claude/project-build-ie4b56`). *(The `0b231cdc2a07…`/26 578-byte
  hash previously recorded here was a stale pre-merge PR draft revision, corrected in
  this reconciliation.)*
- **PR:** #75 (`feature/operations-health-center`) — squash-merged `91c11b7`.
- **Live version:** **`20260722113923`** (name `operations_health_center`) —
  class **B** (`SAME_CONTENT_DIFFERENT_VERSION`: same reviewed content; the
  apply-time generated version differs from the repository filename version
  `20260722100000`). Applied **2026-07-22** via MCP `apply_migration` with the
  exact merged file content — never `db push` or `migration repair`. Rollback was
  not required.

**Ledger order.** Filename version `20260722100000` sorts **after** its two runtime
dependencies `20260721150000_lazywait_sync_health_summary` (live `20260721113811`)
and `20260721170000_order_integrity_watchdog` (live `20260722053151`), but **before**
the later migrations that build on it —
`20260723090000_smart_operations_alerts_digest`,
`20260723120000_activate_operations_alerts_digest_cron` and
`20260723140000_operations_automation_cron_health`. A clean rebuild therefore applies
it **after both source functions exist** (not last); the alerts/digest engine that
depends on `operations_health_overall_state()` applies afterwards — see the
dependency-ordering note under **Rollback**.

**Purpose.** Adds a read-only Operations Health Center aggregate for the Admin
Dashboard — its client-facing RPC `operations_health_summary()` is staff-gated
(`is_staff()`), while its internal `operations_health_overall_state()` helper is
`service_role`-only and never client-callable (see **Objects created** below). It
composes the existing authoritative
`lazywait_sync_health_summary()` and `order_integrity_health_summary()` outputs
with safe database/cron aggregates for account deletion, payments, push, email and
OTP, so staff can see what needs attention without touching secrets, provider
payloads or customer data.

**Objects created (additive; no tables/cron/triggers).** Two functions only:
- `public.operations_health_overall_state(text,text,text,text)` — IMMUTABLE SQL,
  `search_path=public`; EXECUTE revoked from PUBLIC/anon/authenticated, granted to
  `service_role` only (not client-callable). Deterministic precedence
  `configuration_error > failing > degraded (degraded|unavailable) > healthy` over
  the four critical monitored subsystems.
- `public.operations_health_summary()` — `SECURITY DEFINER`, STABLE,
  `search_path=public`; `is_staff()` gate raising `42501` for non-staff; EXECUTE
  revoked from PUBLIC/anon, granted to `authenticated`. Each subsystem is wrapped
  in its own `BEGIN/EXCEPTION` so one unavailable source degrades only its own card
  and returns a `safe_error_code` (SQLSTATE) instead of crashing the page. It reads
  `secret_config` only to derive a boolean and never returns it; it returns no PII,
  secrets, raw provider payloads, tokens or cron commands.

**Dependencies (must exist at apply time).** `is_staff()`;
`lazywait_sync_health_summary()` and `order_integrity_health_summary()` (invoked
dynamically, so a missing source fails only its card); tables `integration_settings`,
`account_deletion_requests`, `payment_records`, `push_devices`, `notification_log`,
`order_integrity_incidents`; `cron.job` and `cron.job_run_details`. All are present
in Production today.

**Validation performed (repository / throwaway PG16 harness, not Production).**
Full migration chain applies clean from an empty database with the ops-health
migration last; idempotent re-apply is clean; the SQL suite
`supabase/tests/operations_health_center_test.sql` passes all cases (object/security
contract, overall-state matrix, staff gate, safe-shape/no-PII, truthful
optional-integration states, missing-optional-config isolation, read-only
guarantee). Frontend gates pass: `tsc --noEmit`, vitest, `vite build`, mobile web
build, mobile `tsc`.

**Production application (completed 2026-07-22).** Applied via the §9 workflow:
owner-approved merge first (PR #75, squash `91c11b7`), then a separate owner-approved
apply. The pre-live gate recorded the then-current latest live version and confirmed
both source health functions and all dependency tables existed with no
`operations_health_*` name collision; applied via MCP `apply_migration` with the exact
merged content → live `20260722113923`. **Post-apply verification (CONFIRMED):** both
functions exist with the expected SECURITY DEFINER/IMMUTABLE properties and pinned
`search_path`; grants are correct (anon/public denied; `authenticated` allowed on the
summary; the state helper service-role-only); `operations_health_summary()` returns
only the safe documented keys; the owner's manual Admin-UI smoke test passed. **No
provider calls, messages, cron-schedule changes, Edge Function deploys, payment
operations, or Production data changes occurred** during the application.

**Rollback.** The feature is isolated and read-only, but rollback is **no longer a
plain function drop**. The later Smart Operations Alerts & Daily Digest engine
(`20260723090000_smart_operations_alerts_digest`, applied 2026-07-22) redefined
`operations_health_snapshot_internal()` to call
`operations_health_overall_state(text,text,text,text)` (see that migration's line
`v_overall_state := public.operations_health_overall_state(…)`), and the two
internal automation crons `operations-alerts-evaluator` (`*/5`) and
`operations-digest-generator` (hourly) consume that snapshot. Dropping the Health
Center functions in isolation would therefore **break the snapshot and make the
five-minute evaluator record failures**, not merely remove the Health Center card.
A safe rollback must proceed **in dependency order** within owner-approved
migration(s): (1) unschedule/disable the two automation crons (and any alerts/digest
consumers) so nothing reads the snapshot mid-change; (2) restore or replace
`operations_health_snapshot_internal()` / `operations_alerts_derive()` so they no
longer reference `operations_health_overall_state()`, **or** remove those dependents
in the same step; (3) disable the Health Center UI wiring; (4) only then drop the two
Health Center functions
(`drop function if exists public.operations_health_summary();` and
`drop function if exists public.operations_health_overall_state(text,text,text,text);`).
At its original 2026-07-22 apply time — before the alerts/digest engine existed — the
drop was dependency-free; that is no longer true. Dropping the functions still cannot
affect orders, payments, customer data, integrations or provider state (the migration
creates no tables, triggers or jobs), but it **will** break the alerts/digest
automation crons unless they are handled first. Full detail in
`docs/OPERATIONS_HEALTH_CENTER_ROLLBACK.md`.

**Known limitations.** Observability only — no action can create/cancel/resend an
order, initialize/confirm/refund a payment, change Lazywait/POS state, enable an
integration, rotate/expose a secret, send Push/Email/SMS/WhatsApp/OTP, change a cron
schedule, or acknowledge/suppress/resolve an incident. There is **no external
provider availability probe** in v1, so optional integrations (payment, push, email,
OTP) are reported from database/configuration evidence only and are never marked
`healthy` from `enabled/configured` alone — their normal state is `not_monitored`.
The scheduled-jobs card observed exactly three allowlisted application jobs in v1;
the two internal automation crons were added by the cron-health migration (§17),
applied 2026-07-29. Only an external provider availability probe remains a separate
future deliverable requiring its own explicit owner approval.

## 17. Applied migration: Operations automation cron health (applied 2026-07-29, class B)

**Read-only observability. MERGED and APPLIED to Production on 2026-07-29
(class B).** This entry was recorded as *merged but UNAPPLIED* from 2026-07-23
until 2026-07-29; it is now applied and has live `schema_migrations` row
`20260729074316`.

- **Repository file:** `supabase/migrations/20260723140000_operations_automation_cron_health.sql`
- **PR:** Issue #79 follow-up — merged to `claude/project-build-ie4b56` (commit
  `06c9bb0`, PR #85).
- **Live version:** **`20260729074316`** (name
  `operations_automation_cron_health`) — class **B** (same reviewed content; the
  apply-time generated version differs from the repository filename version
  `20260723140000`). Applied via MCP `apply_migration` with the exact merged file
  content in **Wave A** of the 2026-07-29 remediation (§20) — never `db push` or
  `migration repair`. No §9-D version-alignment write was performed.

**Purpose.** Extends the Operations Health scheduled-jobs card to also monitor the
two INTERNAL automation crons delivered by the alerts/digest engine —
`operations-alerts-evaluator` (`*/5`) and `operations-digest-generator` (hourly) —
with per-cadence staleness windows (evaluator 15 min; hourly digest 130 min) so a
healthy-but-idle sparse job is never mislabelled failing. They are monitored as
NON-CRITICAL jobs, so the platform-critical `database_jobs` rollup (and therefore
overall Operations Health state) is unchanged; a stuck automation cron surfaces as
a WARNING attention item and a truthful `automation_state`.

**Objects changed (additive; no tables/cron/triggers/grants).** Two
`create or replace function` statements only, both idempotent and preserving the
exact prior security contract (SECURITY DEFINER / STABLE / `search_path=public`;
grants unchanged):
- `public.operations_health_snapshot_internal()` — the single authoritative health
  core: 5-job allowlist, per-cadence windows, critical-only overall rollup, new
  `automation_state` + `OPERATIONS_AUTOMATION_JOBS_*` warning attention.
- `public.operations_alerts_derive(jsonb, jsonb)` — per-job alert severity now
  follows the job's `critical` flag (the three critical crons stay critical; the
  two automation crons become warning). No other derivation changes.

**Dependencies (present at apply time).** The alerts/digest engine migration
(`operations_health_snapshot_internal`, `operations_alerts_derive`,
`operations_alerts_safe_bool`, `operations_alerts_sanitize_evidence`) and the
activation migration that schedules the two automation crons.

**Note on the job allowlist.** The card monitors a 5-job allowlist. The
`payment-refund-worker` cron created later that day (§5 row 55) is **not** in that
allowlist, so disabling it (§21) does not register as a health regression — which
is correct, but means the Operations Health card is **not** the place to confirm
the refund worker's state. Query `cron.job` directly.

**Validation performed (repository / throwaway PG16 harness, not Production).**
`supabase/tests/operations_automation_cron_health_test.sql` (allowlist shape,
per-cadence boundaries, non-critical isolation of overall state, degraded/no-success
automation, critical-cron regression, derive severity-by-critical-flag, safe
projection) plus the updated `operations_health_center_test.sql` (5-job shape) and
`operations_alerts_digest_test.sql` (automation crons pinned healthy) suites.
Frontend gates: `tsc --noEmit`, vitest, `vite build`, mobile web build, mobile `tsc`.

**Rollback.** The feature is isolated and read-only. Re-apply the prior definitions
of the two functions from `20260723090000_smart_operations_alerts_digest.sql` in a
separate owner-approved follow-up migration (never an edit of an applied file).

---

## 18. Applied migration: Order confirmation state machine + refund enrolment (applied 2026-07-29, class B)

**Status: APPLIED to Production on 2026-07-29** (Wave B, §20) → live
`schema_migrations` row **`20260729074810`**, class **B**. This entry was
recorded as *repository-only / UNAPPLIED* from 2026-07-24 until 2026-07-29.

- Repository migration: `20260724120000_order_confirmation_state_machine.sql`
- Issue: **#94** (customer-visible "Order placed" + "Not confirmed" contradiction;
  internal `SM-…` order number exposed to customers)
- Owner approval on record: an explicit, scoped unfreeze of the payment /
  payment-verification / webhook / checkout-session / Lazywait-submission /
  retry / order-state / idempotency / automatic-refund areas for this issue,
  granted in-conversation on 2026-07-24, notwithstanding the CLAUDE.md §6 freeze.
  The Production apply on 2026-07-29 was separately approved as part of the
  incident remediation (§20).

> **Superseded by the payment postponement.** As of 2026-07-29 the owner has
> postponed all payment/refund work pending gateway selection (§21). The objects
> below remain live and intact, but **no automated refund processing runs** — the
> `payment-refund-worker` cron is `active = false`, and zero orders are enrolled.

### What it adds (all additive; no applied migration is edited)

| Object | Kind | Purpose |
|---|---|---|
| `orders.pos_customer_retry_count` / `…_last_at` | columns | SERVER-counted manual resends |
| `orders.refund_state` + `refund_required_at` / `refund_completed_at` / `refund_failure_code` | columns | refund lifecycle, guarded by an explicit transition trigger |
| `order_refunds` | table | append-only refund attempt ledger; RLS staff-read-only |
| `pos_confirmation_channel_active()` | function | does this order have a branch-confirmation step at all? |
| `customer_order_state()` | function | THE authority mapping columns → one customer-visible state |
| `customer_pos_resend_eligibility()` | function | pure proven-not-sent + budget predicate |
| `request_customer_pos_resend()` | RPC (authenticated) | owner-scoped, row-locked, server-counted resend |
| `order_refund_due()` + 2 triggers | predicate + triggers | automatic, path-independent refund enrollment |
| `enforce_refund_state_transition()` | trigger | rejects invalid/out-of-order refund transitions |
| `claim_order_refund()` / `finalize_order_refund()` | RPCs (service_role) | token-fenced, idempotent refund worker |
| `list_failed_order_refunds()` | RPC (admin) | manual-review feed; fingerprinted charge refs only |

`payment_status` is an enum of only `('pending','paid')` and is **not** extended —
the refund lifecycle lives in a separate `refund_state` column, avoiding an
`ALTER TYPE … ADD VALUE` in the migration path.

### Safety properties encoded in the migration

- **Never refund an order Lazywait accepted.** `order_refund_due()` requires a
  paid order with NO stored POS reference, NO may-have-been-sent phase marker, in
  a proven-not-sent terminal state (`dead_letter`/`blocked`), with the manual
  budget spent. Ambiguous orders (`confirmation_required`, or any stored ref
  marker) are excluded and continue to the existing human-verification feed.
- **Never refund twice.** A deterministic per-order idempotency key plus a partial
  unique index allowing at most one `pending|processing|succeeded` refund per order.
- **Never resend into a duplicate POS ticket.** Lazywait Create Order has no
  idempotency key, so the customer resend fires only from proven-not-sent state.
- **No false-success resends.** `request_customer_pos_resend()` extends
  `pos_sync_deadline_at` in the same locked statement that re-queues the row, so
  the deadline-bounded claim RPCs actually pick it up.
- **The retry budget is never disclosed.** The RPC returns only
  `{ outcome, state }` — no reason code, no counter, no limit.

### Delivery-channel note (forward compatibility)

Delivery orders are held at `blocked` / `delivery_schema_unconfirmed` because the
Lazywait delivery Create Order schema is unconfirmed. Gating them on Lazywait
acceptance would mark every delivery order permanently unconfirmed and refund all
of them. Participation is therefore decided by `pos_confirmation_channel_active()`,
expressed in terms of the SYNC STATE rather than the order type: when Lazywait
publishes the delivery API and `set_lazywait_initial_sync` begins enqueuing
delivery to `pending` like pickup, delivery becomes gate-active automatically with
no change to this migration.

### Pre-apply validation (repository harness, 2026-07-24)

**Executed against a disposable local PostgreSQL 16.9 + PostGIS 3.6.2
cluster (127.0.0.1:5433, loopback-only, destroyed afterwards).** `pg_cron` and
`pg_net` were installed as inert SHIMS: schedules are recorded but never run, and
`net.http_post`/`http_get` perform no network I/O — so no payment, Lazywait,
email, push, SMS or OTP call was possible during validation. The refund worker
was never scheduled or invoked.

| Check | Result |
|---|---|
| Full 53-migration chain from an EMPTY database | **53 / 53 applied**, 0 errors, 0 warnings |
| Notices across the whole chain | 110, **all** routine `… does not exist, skipping` / `… already exists, skipping` |
| SQL suites (`supabase/tests/*.sql`) | **18 / 18 passed** |
| SQL ↔ TypeScript state parity | **0 mismatches over 3,456 input combinations** |
| `order_confirmation_state_machine_test.sql` | PASS — `DERIVATION OK; ELIGIBILITY OK; RESEND OK; ENROLLMENT OK; WORKER OK; SECURITY OK` |
| Apply onto a production-schema stand-in (52 prior migrations + representative data) | applied clean |
| Retroactive refunds against existing orders | **0** — no historical order is enrolled |
| Idempotent re-apply (3× on a populated database) | clean; no duplicated triggers/objects |
| Mid-migration failure INSIDE a transaction | fully rolled back — 0 columns, 0 tables, 0 functions left |
| Mid-migration failure in autocommit | leaves partial state; a re-run of the corrected file converges (verified) |
| Frontend gates | `tsc --noEmit` (root + mobile), vitest **764**, `vite build`, mobile web build |

Pre-existing rows derive correct customer states after the migration
(`confirmed_by_branch`, `sending_to_branch`, `branch_failed_retry_available`,
`verifying_with_branch`, `accepted_no_pos_channel`, `payment_pending`), and a
paid, dead-lettered, proven-not-sent historical order is offered its three manual
resends rather than being refunded on sight.

### Post-apply state (2026-07-29)

Confirmed after the Wave B application and again after the payment postponement:
**0** orders enrolled for refund (every `refund_state` is `none`), **0** rows in
`order_refunds`, **0** paid orders, 23 orders total. The migration enrolled no
historical order, exactly as the harness predicted.

### The refund worker is NOT running

- The migration itself **creates no cron job**. Scheduling arrived separately in
  `20260729090000_payment_refund_scheduler` (§5 row 55).
- That scheduler's cron `payment-refund-worker` is **`active = false`** (§21).
- Enrollment alone only marks `orders.refund_state = 'pending'` and opens an
  `order_refunds` ledger row; nothing drains that queue while the worker is
  disabled.
- `payment-refund` additionally returns `503` without its trigger secret — a
  second, independent stop.
- **Re-enabling refund processing requires explicit owner approval** and is
  blocked by the payment postponement (§21).

### Rollback

The feature is additive and isolated. Rollback is a separate owner-approved
follow-up migration dropping the new triggers, functions and `order_refunds`
table (never an edit of an applied file); the added `orders` columns are
nullable/defaulted and may be left in place. Disable the `payment-refund-worker`
cron first if it has been re-enabled.

---

## 19. Applied migrations: loyalty reason without the internal order number (applied 2026-07-29, class B)

**Status: APPLIED to Production on 2026-07-29** (Wave A, §20). This entry was
recorded as *repository-only / UNAPPLIED* from 2026-07-24 until 2026-07-29.

- `20260724130000_loyalty_reason_no_order_number.sql` → live **`20260729073748`**
- `20260724190000_loyalty_reason_history_safe.sql` → live **`20260729073815`**
- Issue: **#94** (internal `SM-…` identifier must not reach a customer surface)
- Companion to §18.

### What it closes

`place_order` (latest definition `20260710120100`) and
`insert_order_from_snapshot` (latest `20260712170000`) write
`'Earned on order ' || orders.order_number` into
`public.loyalty_transactions.reason`. That table is customer-readable
(`grant select … to authenticated` from `20260707120900`, RLS
`profile_id = auth.uid() or is_staff()`), so any signed-in customer could read
their own `SM-…` id via `GET /rest/v1/loyalty_transactions?select=reason`. The
mobile app never queries the table — the exposure was PostgREST auto-exposure.

### What it adds (additive; no applied migration is edited)

| Object | Kind | Purpose |
|---|---|---|
| `text_has_internal_order_number(text)` | function | matches the generated VALUE SHAPE `SM-<4>-<6+>` |
| `loyalty_safe_reason(type, order_id, reason)` | function | neutral text for order-linked rows; redaction for free text |
| `set_loyalty_safe_reason()` + trigger | trigger | normalizes on INSERT **and** UPDATE, writer-independently |
| `loyalty_transactions_reason_no_order_number` | CHECK (**NOT VALID**) | forward-only backstop; history neither validated nor rejected |

**`place_order` is NOT redefined.** It is a ~200-line pricing authority; the fix
lives on the destination column so no pricing, award-timing or idempotency logic
is touched. Loyalty amounts, balances and `order_id` linkage are unchanged.

### Historical rows

**Deliberately not rewritten.** Verified on the production stand-in and again
after the live apply: a pre-existing row containing `SM-…` is still present and
unmodified. The companion migration `loyalty_reason_history_safe` makes the
history safe on read without rewriting it. Any further remediation is a separate,
explicitly owner-approved Production data action — the exact statements are in
`docs/ORDER_CONFIRMATION_FLOW.md` §10a.

### Pre-apply validation (repository harness, 2026-07-24)

Same disposable PostgreSQL 16.9 + PostGIS 3.6.2 harness as §18 (pg_cron/pg_net
inert shims; no scheduled job ran; no outbound HTTP possible).

| Check | Result |
|---|---|
| Full **54**-migration chain from an EMPTY database | **54 / 54 applied**, 0 errors, 0 warnings |
| SQL suites | **19 / 19 passed** |
| `loyalty_reason_no_order_number_test.sql` | PASS — PREDICATE · NORMALIZE · PLACE_ORDER AWARD · REDACT · CUSTOMER PROJECTION · ACCESS/CONSTRAINT · CUSTOMER SCAN · SECURITY CONTRACT |
| Real `place_order` run | loyalty awarded **exactly once**; idempotency key honoured; totals and points unchanged |
| End-to-end customer session (role `authenticated`, RLS on) | loyalty reason = "Points earned from an order"; `payment_records`, `integration_sync_logs`, `order_refunds` all **0 rows visible** |
| Apply onto production stand-in + 3× idempotent re-apply | clean |
| Historical `SM-…` loyalty row after apply | **still present, unmodified** |
| Mid-migration failure inside a transaction | fully rolled back (0 functions, 0 triggers, 0 constraints) |
| Mid-migration failure in autocommit | partial, then converges on re-run |
| SECURITY DEFINER / `search_path` contract | `place_order` + `insert_order_from_snapshot` unchanged |

### Post-apply verification (2026-07-29)

The loyalty fingerprint over `loyalty_transactions` was **byte-identical before
and after** the Wave A application (`9877ab3b…`) — the migrations changed no
historical loyalty row, exactly as designed.

### Rollback

Additive and isolated. A separate owner-approved follow-up migration drops the
trigger, the constraint and the three functions (never an edit of an applied
file).

---

## 20. The 2026-07-29 application wave (incident remediation + follow-ups)

**Ten migrations applied, in three waves, all owner-approved, all class B.**

### The incident

The Admin Dashboard failed with a PostgREST `PGRST202`:

```
Could not find the function public.admin_list_orders_with_items(p_limit)
in the schema cache
```

The missing RPC was only the visible symptom. The real cause: **the deployed
frontend was running eight migrations ahead of the Production database.** Eight
merged, reviewed migrations had never been applied, so the frontend was calling
RPCs, columns and contracts that did not exist live. Repairing the one named RPC
would have left the other seven gaps in place.

This is exactly the failure mode §2 rule 5 warns about — *never assume a
migration is unapplied (or applied) based only on filename/version*. It is also
why §1 of this document now leads with the applied/unapplied count rather than
burying it.

### Wave A — independent, non-blocking migrations

Applied first because nothing else depended on them:

| Repository file | Live version |
| --- | --- |
| `20260724130000_loyalty_reason_no_order_number` | `20260729073748` |
| `20260724190000_loyalty_reason_history_safe` | `20260729073815` |
| `20260728120000_discounts_campaigns` | `20260729073932` |
| `20260723140000_operations_automation_cron_health` | `20260729074316` |

### Wave B — the order-contract chain

Applied in dependency order. `order_read_contracts` is the migration that
supplies `admin_list_orders_with_items` and the rest of the admin/staff
order-read surface:

| Repository file | Live version |
| --- | --- |
| `20260724120000_order_confirmation_state_machine` | `20260729074810` |
| `20260724200000_order_read_contracts` | `20260729074932` |
| `20260724170000_require_address_description` | `20260729075631` |
| `20260724180000_tap_reference_order_opaque` | `20260729080617` |

**Mobile-ordering outage window.** `order_read_contracts` changes the order-read
contract that the deployed `order-intake` Edge Function relies on. The
replacement `order-intake` payload was staged **before** the migration was
applied and the function was redeployed (v4) **immediately after**, closing the
window rather than leaving customer ordering broken between the two steps.

### Wave C — refund scheduler + grant hardening

Merged as PR #112 (squash `e36fff1`) and applied the same day:

| Repository file | Live version |
| --- | --- |
| `20260729090000_payment_refund_scheduler` | `20260729112224` |
| `20260729091000_caller_can_read_order_anon_revoke` | `20260729112238` |

**The scheduler's cron was disabled hours later** when the owner postponed all
payment work (§21). The migration remains applied and its objects intact.

### Verification and data safety

Each migration was verified individually after its apply (object existence,
signatures, SECURITY DEFINER state, pinned `search_path`, grants, RLS, triggers,
indexes). Across the whole wave:

| Evidence | Result |
| --- | --- |
| Live `schema_migrations` rows | 52 → **62** |
| Repository files unapplied afterwards | **0** |
| Orders | **23**, unchanged |
| Loyalty fingerprint over `loyalty_transactions` | `9877ab3b…` — **byte-identical** before and after |
| Addresses | 1, untouched |
| Orders enrolled for refund | **0** |
| `order_refunds` rows | **0** |
| In-flight payment rows | 3, **byte-identical** before and after |

**One verification note worth recording**, because it produced a false negative
mid-wave: a data-modifying CTE is **not visible to sibling SELECTs in the same
statement**. A verification query that wrote and then read back in one statement
reported the write as absent. Re-querying in a **fresh statement** confirmed the
write had in fact succeeded. Always verify a write in a separate statement
(§9-E rule 7).

**A second note:** `admin_*` RPCs correctly raise `42501` when called through the
service role, because `is_staff()` returns FALSE in a service-role context. That
is the staff gate working, **not** a defect — do not "fix" it, and do not use a
service-role call to prove an admin RPC is broken.

---

## 21. Payment & refund work — POSTPONED (2026-07-29)

The owner has postponed all payment, payment-processing and refund work until a
payment gateway provider is officially selected. **The authoritative record is
`docs/PAYMENT_POSTPONEMENT.md`**; this section states only what the postponement
means for migrations.

- **No payment migration may be created, edited or applied** while the
  postponement stands. That includes anything touching `checkout_sessions`, Tap
  configuration, `payment_records`, the `order_refunds` stack, or the refund
  worker's scheduling.
- **Nothing was deleted.** Every payment/refund migration listed in §5 (rows 22,
  31, 34, 35, 54, 55) remains applied and intact, and the repository files remain
  in `supabase/migrations/`.
- **The only live change** was disabling the cron job created by
  `20260729090000_payment_refund_scheduler`:

  ```sql
  select cron.alter_job(
    job_id := (select jobid from cron.job where jobname = 'payment-refund-worker'),
    active := false
  );
  ```

  The job row, its `*/5 * * * *` schedule and its command are **retained**. Only
  `active` changed.
- **This was deliberately not done by a migration**: the postponement is a
  reversible operational state, not a schema change. Re-enabling it is a one-line
  `cron.alter_job` call requiring explicit owner approval — not a new migration.
- **Consequence for rebuilds (§11):** applying the repository chain to a fresh
  database **will** schedule `payment-refund-worker` as active, because the
  migration schedules it. Disable it immediately after building any new
  environment while the postponement stands.
- **Consequence for `db push` (§6):** replaying the chain against Production
  would re-create and re-activate the worker. One more reason the prohibition is
  permanent.

The five operational crons — `account-deletion-processor`, `lazywait-sync`,
`order-integrity-watchdog`, `operations-alerts-evaluator`,
`operations-digest-generator` — are **unaffected and remain active**.

---

## 22. Applied migration: erasure phone normalization (applied 2026-08-07, class B)

`supabase/migrations/20260806120000_erasure_phone_normalization.sql` was applied
to Production on **2026-08-07** with explicit owner approval → live version
**`20260807140050`**, class **B**. Content fingerprint `skel = 8759892535b7`,
verified identical to the repository file. The application record, pre-live gate
and verification are in §24.

### What it fixes

`anonymize_account_data` read the customer's phone from
`public.profiles.phone_number` and compared it raw against `phone_e164`:

```sql
select phone_number into v_phone from public.profiles where id = p_user_id;
delete from public.otp_challenges       where phone_e164 = v_phone;
delete from public.whatsapp_message_logs where phone_e164 = v_phone;
```

Those columns are not in the same format. `profiles.phone_number` is copied
verbatim from `auth.users.phone` by `handle_new_user` and
`handle_auth_user_phone_confirmed`, and GoTrue stores that value **without** a
leading `+`. `phone_e164` is written by `normalizeSaudiPhoneE164` in
`supabase/functions/_shared/whatsapp.ts`, which always emits `+966…`. So for any
profile whose phone came from the auth trigger, both deletes matched zero rows.

The summary then reported `'phone_purged', (v_phone is not null and btrim(v_phone) <> '')`
— true whenever a phone *string* existed, not when anything was deleted. That
value is written into `account_deletion_requests.retention_summary`, so the
compliance record asserted a purge that had not occurred.

### Production measurement (2026-08-06, shape only)

Read with a format-only query — counts of values matching `'+%'`, no phone
values selected:

| Column | Rows carrying a leading `+` |
| --- | --- |
| `auth.users.phone` | 0 of 1 |
| `otp_challenges.phone_e164` | 3 of 3 |
| `profiles.phone_number` | mixed — 1 of 2 |

Of the 2 profiles holding a phone, **1** matched an OTP row under the old raw
comparison and **2** match after normalization. Half the affected profiles would
have kept their OTP and WhatsApp records through an erasure.

### What the migration changes

1. Adds `public.normalize_ksa_e164(text)` — a SQL mirror of
   `normalizeSaudiPhoneE164`, returning `+9665XXXXXXXX` or `null`. Execute is
   granted to `service_role` only.
2. `anonymize_account_data` now sources the phone from `auth.users.phone`
   (authoritative, not customer-writable), falls back to the profile only if
   that is absent, and normalizes **both sides** of each delete predicate.
3. `phone_purged` is replaced by `phone_purge_attempted`. The two row counts the
   function already returned (`otp_challenges_purged`, `whatsapp_logs_purged`)
   are the honest record. No consumer of `phone_purged` exists anywhere in the
   repository, so the rename breaks nothing.
4. `revoke update (phone_number) on public.profiles from authenticated` — the
   grant from `20260707120100:82` let a customer point the value the erasure
   keys on at another customer's number. Neither app writes it directly.

### Safety

- Strictly additive plus one narrowing revoke. No table, column or constraint is
  altered; no existing row is modified.
- `create or replace function` preserves name, signature, volatility and
  `search_path`, so the account-deletion worker keeps calling it unchanged, and
  no applied migration is edited.
- Idempotent — re-running is a no-op.
- The behavioural change deletes **more** rows during an erasure, never fewer.

### Pre-apply validation (repository harness, 2026-08-06)

Docker was unavailable and PostGIS is not installed locally, so the full chain
could not be replayed. Validated instead against a local PostgreSQL 16 cluster
with the minimum schema stubbed:

- migration applied cleanly (exit 0);
- `supabase/tests/erasure_phone_normalization_test.sql` — 6 cases plus 15
  normalizer assertions — reported `ALL CASES PASSED`;
- the original `anonymize_account_data` body was then restored and the same
  suite re-run, which **failed** with
  `FAIL(1): otp_challenges survived erasure for a plus-less profile phone (1 left)`,
  confirming the suite actually pins the defect rather than passing vacuously.

Both scratch databases were dropped and the cluster stopped afterwards. The
suite also runs unconditionally in the `SQL suites` workflow, which replays the
whole chain on `postgis/postgis:16-3.4`.

### Applied

Done 2026-08-07 per §9 — pre-live gate, one `apply_migration` call, verification.
See §24.

### Rollback

```sql
grant update (phone_number) on public.profiles to authenticated;
```

…and restore the previous `anonymize_account_data` body from
`20260715120000_account_deletion.sql:228-295`. Doing so reinstates the silent
skip and the false `phone_purged` claim, so prefer fixing forward.

---

## 23. Applied migration: bounded admin order reads (applied 2026-08-07, class B)

`supabase/migrations/20260806130000_admin_ranged_orders_and_stats.sql` was
applied to Production on **2026-08-07** with explicit owner approval → live
version **`20260807140206`**, class **B**. Content fingerprint
`skel = a92bb07e58c7`, verified identical to the repository file. The application
record, pre-live gate and verification are in §24.

### Why it exists

`AppContext.refreshOrders()` called `admin_list_orders_with_items(null)` — the
UNBOUNDED arm — on every staff sign-in and after every status advance. That
returns every order in the system with every line item and every modifier as one
jsonb blob.

It was unbounded because it had to be. Three console surfaces read the whole
in-memory list: `ReportsPanel` filtered it by date range, `StatsPanel` summed it
for the four dashboard tiles and the per-branch chart, and `LiveOrdersPanel`
rendered it. Capping the fetch alone would have silently truncated the financial
reports, which is worse than being slow, so the two halves had to move together.

At ~300 orders/day the blob passes 100 MB inside a year, re-fetched on every
sign-in. That is a scheduled outage, not a slow page.

A PostgREST range filter was not an option: staff hold no direct privilege on
`public.orders` (`20260724200000`), so every staff read goes through a SECURITY
DEFINER RPC and the range has to be a function parameter. Hence a migration.

### What it adds

1. **`admin_list_orders_for_range(p_from, p_to, p_branch, p_max_rows)`** — the
   report feed for a half-open `[p_from, p_to)` window, optionally one branch.
   Returns an envelope `{row_count, max_rows, limit_exceeded, orders}`.
   - **Half-open** so the caller passes day boundaries without a 23:59:59.999
     fencepost. An order on the upper bound belongs to the next window, counted
     once rather than twice or never.
   - **Refuses rather than truncates.** Above the ceiling it returns NO rows and
     sets `limit_exceeded`, with the true `row_count` so the console can say how
     far over the range is. A truncated financial report is a wrong VAT figure
     that looks right.
   - `p_max_rows` can only LOWER the ceiling (`least` against a hard 10000), so a
     caller cannot restore the unbounded fetch. It exists so the refusal branch
     is testable without seeding ten thousand rows.
   - **Leaner projection than the live feed**: no customer name, phone or id, no
     notes, no address snapshot, no item modifiers. The reports read none of
     them, so running a financial report no longer pulls customer PII into a
     browser at all.
2. **`admin_order_stats()`** — the four dashboard tiles and the per-branch chart,
   aggregated server-side. Constant-size payload. The definitions match the
   previous in-memory expressions exactly, **including `total_amount` spanning
   cancelled orders**, because that is what the average-ticket tile has always
   divided by. Changing it would have moved a dashboard number under cover of a
   performance change.
3. **`admin_list_orders_with_items(p_limit)` is replaced** so its bounded arm is
   **status-aware**: the `p_limit` most recent orders **plus every unsettled
   order, however old**. Same name, signature, volatility, security and
   `search_path`; `20260724200000` is not edited, this supersedes it.

   This closes a hole that bounding the console fetch would otherwise have
   opened. The original returns the `p_limit` most recent orders by
   `created_at`, so once more than `p_limit` newer orders existed, an order stuck
   in `received`, `preparing`, `ready` or `out_for_delivery` was not fetched at
   all — it vanished from the Live Orders board, and neither the search box nor
   the "show older" control could recover it, because the row was never in the
   browser. Work still owed to a customer would silently stop being visible to
   the kitchen. Raised by automated review on PR #167 and confirmed against the
   code before fixing.

   The unsettled arm is deliberately **uncapped**: capping it would reintroduce
   the same silent drop one level down, and an unsettled backlog large enough to
   matter is an operational emergency the board should be showing. `p_limit is
   null` keeps the original unbounded behaviour exactly, so this is a widening —
   every caller sees a superset of what it saw before, never less.

   The client-side trim in `pollRecentOrders` is status-aware for the same
   reason (`trimOrderWindow`): those old unsettled rows sort to the tail of a
   newest-first list, so a plain `slice(0, limit)` would have discarded exactly
   the rows the server went out of its way to include.

Both are `is_staff()`-gated internally, `stable`, `security definer`, with a
pinned `search_path` — the same contract as `admin_list_orders_with_items`.

### Safety

- Purely additive. No table, column, constraint, policy or existing function is
  altered. `admin_list_orders_with_items` is untouched and still serves the live
  board.
- Read-only: both functions are `stable` and contain no write.
- Idempotent — `create or replace` only.

### Pre-apply validation (repository harness, 2026-08-06)

Docker was unavailable and PostGIS is not installed locally, so the full chain
could not be replayed. Validated against a local PostgreSQL 16 cluster with the
minimum schema stubbed:

- migration applied cleanly (exit 0);
- `supabase/tests/admin_ranged_orders_and_stats_test.sql` — 9 cases — reported
  `ALL CASES PASSED`;
- four deliberately broken variants were then applied to clones and the same
  suite re-run, to prove it is not passing vacuously:

  | Mutation | Caught by |
  | --- | --- |
  | `created_at <= p_to` (closed interval) | `FAIL(2): row_count is 4, expected 3 — the interval is not half-open` |
  | refusal replaced by `limit v_max_rows` (silent truncation) | `FAIL(4): 3 rows against a ceiling of 2 did not set limit_exceeded` |
  | `customer_name`/`customer_phone`/`notes` added to the projection | `FAIL(6): the report projection exposes customer_name` |
  | live feed reverted to the chronological-only window | `FAIL(9): limit 1 returned 1 orders, expected 2 (newest + the unsettled one)` |

All scratch databases were dropped and the cluster stopped afterwards. The suite
also runs unconditionally in the `SQL suites` workflow, which replays the whole
chain on `postgis/postgis:16-3.4`.

### The console half was live on merge; the server half followed ~20 minutes later

**Resolved 2026-08-07.** Recorded because the window was real and will recur on
any future PR that pairs a client change with an unapplied migration. Between
the merge of PR #167 and the apply, **both new RPCs 404'd** for the console:

- `ReportsPanel` renders its "Could not load orders for this range" card;
- `StatsPanel` renders "Could not load order statistics" and its tiles read zero.

Live Orders was unaffected — it uses the existing bounded feed. So the reports
and the dashboard tiles were DOWN between merge and apply, visibly and with a
stated reason rather than silently wrong, which is the behaviour the client half
was built to have. **The lesson for next time: approve the apply alongside the
merge, or hold the merge until the apply is approved.**

### Applied

Done 2026-08-07 per §9 — pre-live gate, one `apply_migration` call, verification.
See §24.

### Rollback

```sql
drop function if exists public.admin_list_orders_for_range(timestamptz, timestamptz, uuid, integer);
drop function if exists public.admin_order_stats();
```

…and restore `admin_list_orders_with_items` from `20260724200000:179-232`. Note
that doing so reinstates the hidden-outstanding-order problem whenever a caller
passes a limit, so prefer fixing forward.

The two added functions are additive and unreferenced by anything else in the
schema. The console would have to be reverted in the same step, since it is
their only caller.

---

## 24. The 2026-08-07 application (§22 + §23)

Both remaining class-E migrations were applied to Production on **2026-08-07**
with explicit owner approval ("apply both migrations"), following §9: pre-live
gate (§9-B), one `apply_migration` call per file in filename order, then
verification (§9-E). No `db push`, no batch replay, no unrelated SQL.

> ### ⚠️ Deviation from §9-C1 — recorded, not approved in advance
>
> **§9-C1 requires applying "exactly the reviewed migration content — nothing
> added, nothing removed." That was met for §22 and NOT met for §23.**
>
> The §23 `apply_migration` call replaced roughly 60 lines of reviewed header
> comment with a condensed header pointing at the repository file and at §23.
> The executable SQL is identical — see the fingerprint note below — but a
> matching `skel` fingerprint demonstrates *semantic* equivalence, which is a
> weaker claim than §9-C1 makes. **This section must not be read as full §9
> compliance.**
>
> **Provenance:** the condensation was the applying agent's own editorial choice
> while composing the call. It was **not** requested by the owner, **not**
> raised as an exception beforehand, and **not** separately approved. The owner
> approved *applying the two migrations*, not altering their text.
>
> **Consequence:** the live `schema_migrations` row for
> `admin_ranged_orders_and_stats` no longer carries the rationale the repository
> file carries. Anyone auditing from the database alone gets the SQL without the
> "why". The repository file remains the complete record, and §23 above restates
> the reasoning in full, so nothing is lost — but it is lost *from the live
> row*, and that is the deviation.
>
> **Rule for next time:** paste the migration file verbatim. If it is too long
> for one call, that is a reason to split the migration, not to edit its text on
> the way in. Raised by automated review on PR #168.

| Repository file | Live version | skel (repo = live) | Class |
| --- | --- | --- | --- |
| `20260806120000_erasure_phone_normalization` | `20260807140050` | `8759892535b7` | B |
| `20260806130000_admin_ranged_orders_and_stats` | `20260807140206` | `a92bb07e58c7` | B |

Repository files were confirmed byte-identical to the merged default branch
(`29cfb3a`) by SHA-256 before applying.

> **What the fingerprint does and does not prove.** `skel` strips `--` comments,
> whitespace and semicolons before hashing, so repo `a92bb07e58c7` = live
> `a92bb07e58c7` proves the **executable SQL is identical** — no statement was
> added, removed or altered. It says nothing about the comment text, which is
> exactly where §23 deviates. The fingerprint is therefore evidence that the
> deviation is *harmless to the schema*, not evidence that §9-C1 was satisfied.

### Pre-live gate (§9-B), recorded before applying

| Check | Value |
| --- | --- |
| Repository base | `29cfb3a` (default branch, post-#167) |
| Live rows before | **66**, latest `20260806045142` (`noop`) |
| `normalize_ksa_e164` exists | **false** — not already applied |
| `anonymize_account_data` body | md5 `9252ceb2e42ca3d7830bd3166af56cb2`, returns `phone_purged` |
| `authenticated` UPDATE on `profiles.phone_number` | **true** — the grant to be revoked |
| `admin_list_orders_for_range` exists | **false** |
| `admin_order_stats` exists | **false** |
| `admin_list_orders_with_items` body | md5 `3e89a4565e2082905a5b3c16b5751d91`, **not** status-aware |
| Row counts | orders 24 · order_items 27 · profiles 5 · otp_challenges 3 · whatsapp_logs 17 · deletion_requests 1 · branches 23 |
| `public` function count / digest | 121 / `042db5c27f0521d21d222ceb49ae3440` |
| `profiles` column-grant digest | `8248af3b497675a1a86d7d685aeffa48` |

Rollback SQL for both is in each migration file's trailing `Rollback` block.

### Verification (§9-E), after applying

**Objects — exactly the three promised additions, nothing else.**
`public` function count **121 → 124**: `normalize_ksa_e164`,
`admin_list_orders_for_range`, `admin_order_stats`. `anonymize_account_data` and
`admin_list_orders_with_items` were replaced in place, same signatures.

**Data — untouched.** Both migrations are DDL-only, and every row count is
identical before and after: orders 24 · order_items 27 · profiles 5 ·
otp_challenges 3 · whatsapp_logs 17 · deletion_requests 1 · branches 23.

**The `phone_purged` → `phone_purge_attempted` rename is real.** A naive
substring test reported the old name still present; the precise test shows it
appears **once, in an explanatory comment line**, and is not a returned key:

```
returns_old_key       false
returns_new_key       true
lines_mentioning_old  "-- Was `phone_purged`, which reported true whenever a phone STRING existed"
```

**The revoke is exactly one privilege.** `authenticated` retains `SELECT` on
`profiles.phone_number` (the app displays it) and `UPDATE` on `full_name` and
`email`; it has **lost** `UPDATE` on `phone_number`. `anon` holds no column
privilege on `profiles` at all. Grant digest `8248af3b…` → `7e673440…`,
accounted for entirely by that one revoke.

**The normalizer behaves as its suite proved.** `966555000001`, `+966555000001`
and `0555000001` all → `+966555000001`; `+14155550100` and `''` → `null`.
Execute is `service_role` only — `anon` and `authenticated` both denied.

**The staff gate fires.** With no staff identity, `admin_order_stats`,
`admin_list_orders_for_range` and `admin_list_orders_with_items` all raise
`42501`.

**The status-aware window measurably changes what the board sees.** Against live
data, replicating the new predicate at `p_limit = 1`: the old chronological
window returns **1** order, the new one returns **21** — 20 orders the old
window would have dropped, every one of them `received`. At the console's actual
`ORDERS_POLL_LIMIT` of 500 the practical difference is currently nil (24 orders
total), but the mechanism is confirmed on real rows rather than only in the
suite.

> **Operational observation, not a migration finding:** 21 of 24 Production
> orders sit in `received`. Whether that is seeded/test data or a real backlog is
> outside this ledger's scope, but it is exactly what the order-flow health card
> is meant to surface, and it is worth resolving before launch.

**Advisors (§9-E4).** 66 security advisories: 53 `WARN`, 13 `INFO`, **0
`ERROR`**. Three name objects from this change, all
`authenticated_security_definer_function_executable` — the deliberate,
pre-existing pattern this repository uses for staff RPCs (46 instances):
`SECURITY DEFINER` granted to `authenticated`, with `is_staff()` enforced inside
the function body. `admin_list_orders_with_items` already carried this warning
before the change; the two genuinely new ones are `admin_list_orders_for_range`
and `admin_order_stats`. **Neither `normalize_ksa_e164` nor
`anonymize_account_data` appears at all**, because both are `service_role`-only.
No new `anon`-executable function was introduced — all six in that category
pre-date this change.

**History (§9-E2/E3).** Live rows **66 → 68**; latest version
`20260807140206`. Version alignment (§9-D) was **deliberately not performed** —
it is a separate live history write needing its own explicit owner approval, and
class **B** is this repository's normal steady state.

### Still outstanding

Applying these fixed the *schema*. Two things they do not do:

- **Historical `retention_summary` rows are not corrected.** Any
  `account_deletion_requests` row written before 2026-08-07 still carries the
  old `phone_purged` claim, and where that claim was false the underlying
  `otp_challenges` / `whatsapp_message_logs` rows may still exist. Re-running
  erasure for affected users would purge them — that is a **data** change and
  needs its own owner approval and its own ledger entry.
- **The Reports/dashboard outage window closed** the moment §23 applied; no
  further action needed there.

## 25. Applied migration: order-flow health card (applied 2026-08-07, class B)

| | |
| --- | --- |
| Repository file | `20260807150000_order_flow_health_card.sql` (1062 lines) |
| Live version | `20260807152347`, name `order_flow_health_card` |
| Class | **B** (`SAME_CONTENT_DIFFERENT_VERSION`) |
| skel (repo = live) | `f4df8ad27e85` |
| From | PR #169, corrected by PR #170 (`ff1eff0`) before applying |
| Approval | explicit owner instruction, "merge it once green and apply the migration" |

### What it adds

`operations_health_snapshot_internal` had eight cards and every one watched a
**subsystem** — POS sync, the deletion cron, payment-record consistency,
scheduled jobs. None watched the thing those subsystems exist to produce. So the
console could not see its worst realistic outage: checkout breaks, orders go to
zero, and every card stays green because no subsystem is broken.

Two objects:

1. `operations_health_overall_state(text,text,text,text,text)` — a five-argument
   **overload**. The four-argument function is untouched and still resolves for
   every existing caller; arity disambiguates.
2. An `order_flow` card in the snapshot, in the **critical** set alongside
   `lazywait` / `order_integrity` / `account_deletion` / `database_jobs`.

The card compares orders in the last 60 minutes against the **same rolling
60-minute window shifted back whole weeks**, over the previous 8 weeks. Whole-week
offsets preserve weekday and time of day for free, and Saudi Arabia has no
daylight saving, so the card performs no timezone conversion and no clock-hour
bucketing at all. A week with no orders in that window is not counted as a
sample, so the mean is over weeks that actually traded.

It fails quiet by design: no open branch, fewer than 3 comparable weeks, or a
baseline below 1 all report `idle`, never `failing`.
`operations_health_overall_state` has no `idle` arm, so `idle` falls through to
`healthy` and a warming-up baseline cannot flip the platform red.

### §9-C1 was met this time

**The `apply_migration` call carried the repository file verbatim** — the
deviation recorded in §24 was not repeated. This is provable rather than
asserted, and by a stronger test than §24's:

| Fingerprint | Repository file | Live `schema_migrations` row |
| --- | --- | --- |
| `skel` | `f4df8ad27e85` | `f4df8ad27e85` |
| raw md5 | `be18c54752657305e88554cc7448b539` | — |
| raw md5, trailing newline stripped | `c3b6060a729e914f13867a7ad77ee4cd` | `c3b6060a729e914f13867a7ad77ee4cd` |

`skel` proves the executable SQL is identical. The **raw** md5 match proves the
stored text is byte-for-byte identical to the merged file, comments and all —
the only difference being the file's final newline, which the platform trims.
Nothing was condensed, reworded or dropped on the way in.

### A defect fixed before applying, not after (PR #170)

While transcribing the file for the apply, the `comment on function` statement
at its foot was found still describing the card's **first draft**: "a trailing
same-weekday-same-hour baseline over the previous 8 weeks (Riyadh local)".
Review had already replaced that design. Commit `03cdae5` corrected the file
header and the in-body comment and missed this third copy.

That copy is the one that is **executed**. It lands in `pg_description` and is
what an operator sees from `\df+`, with no code beside it to contradict it.
Applying the file as merged would have written into Production a description
saying the card buckets by weekday and clock hour in Riyadh local time, when it
does neither — sending anyone debugging a surprising `degraded` reading to look
for hour boundaries that do not exist.

It was fixed in PR #170 and merged **before** the apply, so the repository and
the live database agree from the first write rather than after a correction.
The fix moved both fingerprints (`skel` `905c8df44c72` → `f4df8ad27e85`), which
is expected: the text sits inside an executed statement, not in a `--` comment.

### Pre-live gate (§9-B), recorded before applying

| Check | Value |
| --- | --- |
| Repository base | `ff1eff0` (default branch, post-#170) |
| Live rows before | **68**, latest `20260807140206` |
| `operations_health_overall_state` overloads | **1** — the 4-arg only |
| 5-arg overload | **absent** |
| Snapshot contains `order_flow` | **false** |
| Snapshot source md5 | `9cdd8f41532e1c37ca4319b16de519d4` |
| Cards / `overall_state` | 8 / `healthy`, 0 critical, 0 warning |
| `public` function count | **124** |
| Row counts | orders 24 · branches 23 · open branches 4 |

Recoverability was established before the call rather than assumed: the file
contains **zero write statements**, uses `create or replace` throughout, and
wraps the new block in its own `begin … exception when others`, so a bad
transcription would have been re-appliable rather than destructive.

> **A gate check that was wrong, and how it was caught.** The first overload
> query tested `pg_get_function_identity_arguments(oid) = 'text, text, text,
> text'` and returned **0** for both arities — reported as "both absent", which
> would have been alarming. That function includes *parameter names*, so the
> equality could never match. Re-running by argument list showed the 4-arg
> overload present exactly as expected. Recorded because a gate check that
> silently under-reports is worse than no check.

### Verification (§9-E), after applying

**The card exists and reads correctly.**

| | |
| --- | --- |
| Cards | 8 → **9**; `order_flow` present |
| `critical_systems` | gained `order_flow`, kept all four pre-existing members |
| `order_flow` state | **`idle`** |
| `baseline_ready` / `baseline_samples` | `false` / `0` (minimum 3) |
| `open_branches` / `orders_in_window` | 4 / 0 |
| `safe_error_code` | **null** — the exception arm was not taken |

**`idle` here is the designed answer, not a null result.** Four branches are
open and zero orders arrived in the last hour, which is exactly the shape of the
outage this card exists to catch — but `baseline_samples` is **0** against a
required **3** (24 orders exist in total), so the card correctly declines to
call it. It will start producing signal once real volume exists. Reporting
`failing` today would have been the wrong answer, loudly.

**`idle` is inert, as promised.** `overall_state` is still `healthy`, with 0
critical and 0 warning attention items and an empty `attention` array — the new
card changed no existing number.

**Both overloads are present and correct.**

| nargs | volatility | secdef | `search_path` | ACL |
| --- | --- | --- | --- | --- |
| 4 | immutable | false | `public` | `postgres=X`, `service_role=X` |
| 5 | immutable | false | `public` | `postgres=X`, `service_role=X` |

The 4-arg behaviour is unchanged (`healthy`/`failing`/`degraded` on the same
inputs as before). The 5-arg resolves `idle → healthy`, `failing → failing`,
`degraded → degraded`, `configuration_error → configuration_error`. Neither is
executable by `anon` or `authenticated`.

**Objects — exactly one addition.** `public` function count **124 → 125**, the
five-argument overload. `operations_health_snapshot_internal` was replaced in
place, same signature, same `security definer`, same `service_role`-only grant.

**Data — untouched.** The migration is DDL-only and every count is identical
before and after: orders 24 · branches 23 · open branches 4.

**The stored description is now correct** — `obj_description` returns the
corrected text describing the rolling shifted-week baseline, with no mention of
weekday-hour bucketing or Riyadh local time.

**Advisors (§9-E4).** 66 security lints (46 + 6 `WARN`
`*_security_definer_function_executable`, 1 `WARN`
`auth_leaked_password_protection`, 13 `INFO`) and 79 performance lints — **0
`ERROR` in either**. Exactly one names an `operations_health*` object:
`operations_health_summary()`, the staff-facing wrapper that is deliberately
`authenticated`-callable with `is_staff()` enforced in its body. It pre-dates
this change. `operations_health_snapshot_internal` does not appear, because it
is `service_role`-only, and neither does the new overload. **No advisory is
attributable to this apply.**

**History (§9-E2/E3).** Live rows **68 → 69**; latest version
`20260807152347`. Version alignment (§9-D) was **deliberately not performed** —
a separate live history write needing its own explicit owner approval, and class
**B** is this repository's normal steady state.

### Still outstanding

- **~~The `orders:flow` fingerprint is missing~~ — CLOSED 2026-08-07 by
  `20260807170000_order_flow_alert_condition` (§26), applied as live
  `20260807172027`.** The description below is retained because it is what the
  running system looked like between §25 and §26, and because the reasoning that
  first got it wrong is worth keeping visible. The alert engine derives its own
  fingerprints independently of the snapshot, so an `order_flow` card reading
  `failing` or `degraded` produced **no alert row at all**.

  An earlier revision of this bullet said the function's "only consumer — the
  external alert dispatcher — is dormant by design". **That was wrong**, and it
  understated the gap. `operations_alerts_derive` is called by
  `operations_alerts_evaluate`
  (`20260723090000_smart_operations_alerts_digest.sql:1614`), which the **active**
  `operations-alerts-evaluator` cron runs every five minutes and which writes
  rows into `public.operations_alert_state` — the internal alerts inbox in the
  admin dashboard. That path is live today. External dispatch is a separate,
  later stage and is the part that is disabled by design; its being off does not
  make the omission harmless.

  So the console gets the *card* but not the *alert*: `order_flow` will show
  `failing` in the Operations Health Center and in the sidebar badge, while the
  alerts inbox stays silent. Wiring it up means re-emitting a second ~275-line
  function and is deferred deliberately — but it is deferred work with a real
  consequence, not a no-op. Raised by automated review on PR #171.

  Confirmed against Production on 2026-08-07, not inferred from the source:

  | Check | Value |
  | --- | --- |
  | `operations-alerts-evaluator` | **active**, `*/5 * * * *`, `select public.operations_alerts_evaluate();` |
  | Its last three runs | all `succeeded`, most recent `15:30:00Z` |
  | `operations_alert_state` | 2 rows, 0 open — the table is live and has been written |
  | Live `operations_alerts_derive` mentions `order_flow` | **false** |
  | Live fingerprint prefixes | `account_deletion`, `database_jobs`, `lazywait`, `order_integrity`, `payment`, `platform`, `push` — **no `orders`** |
- **§5 was not re-derived.** Consistent with §24, the row-by-row mapping in §5
  keeps its own totals; §4 is authoritative for counts.
- **The card needs 3 comparable weeks, not 8.** `v_of_min_samples` is **3**;
  the `generate_series(1, 8)` is the lookback *horizon*, not the requirement. A
  sample is a weekly-offset window that contained at least one order, so the
  card can begin firing once the same hour-of-week has traded on 3 of the
  previous 8 occurrences — roughly three weeks after orders start flowing at
  that hour, not eight.

  An earlier revision of this bullet said "roughly 8 weeks of order history",
  which overstated the warm-up by about five weeks and would have given
  operators the wrong expectation for when to start trusting the card. Also
  raised by automated review on PR #171.

  What remains true either way: with 24 orders in total and `baseline_samples`
  at 0, the console does not yet have the coverage this migration was written to
  provide. The mechanism is in place; the data is not.

## 26. Applied migration: order-flow alert condition (applied 2026-08-07, class B)

| | |
| --- | --- |
| Repository file | `20260807170000_order_flow_alert_condition.sql` (504 lines) |
| Live version | `20260807172027`, name `order_flow_alert_condition` |
| Class | **B** (`SAME_CONTENT_DIFFERENT_VERSION`) |
| skel (repo = live) | `0156c74bbf8d` |
| From | PR #172 (`07f25eb`) |
| Closes | the §25 "still outstanding" gap |
| Approval | explicit owner instruction, "merge it once green and apply the migration" |

> **The count prediction was recorded before the apply and held exactly.** While
> this file was merged-but-unapplied, §1, §4 and §6 said so immediately rather
> than at apply time — "unapplied" is a fact about the repository, not the
> database, and deferring it would have left the ledger asserting "zero
> unapplied" while an unapplied file sat in the tree.
>
> §26 then predicted that applying it would move E to 0 and B to 54, hold the
> file total at 68, and raise the row total to 70. That is what happened:
> `8+54+3+3 = 68 files`, `8+54+3+5 = 70 rows`. Reconciling in *both* states is
> the check that the counts were right in each.

### What it does

§25 recorded that `operations_alerts_derive` had no arm for `order_flow`, so the
card could read `failing` in the Operations Health Center and light the sidebar
badge while the alerts inbox stayed silent. This adds the missing arm.

| Card state | `condition_code` | severity |
| --- | --- | --- |
| `failing` | `flow_stopped` | **critical** |
| `degraded` | `flow_below_baseline` | warning |
| `unavailable` | `unavailable` | warning |
| `idle`, `healthy` | *nothing at all* | — |

**`idle` producing nothing is the point.** It is the card's fail-quiet state — no
branch open, or fewer than its minimum comparable weeks of history. Alerting on
it would fire every night after closing time and right through the warm-up,
which is precisely how a monitor teaches people to mute it.

**One fingerprint, `order_flow:health`, across all three alertable states.** This
function's stated contract is that a fingerprint is a stable condition
*identity*, so a shortfall that worsens into a full stop **escalates the same
alert** rather than recovering one identity and opening another. Per-state
fingerprints would shred the incident's timeline exactly when someone is reading
it.

The mute override (`system_rule_overrides.order_flow.muted`) works for free: the
arm sits inside the generic per-card guard at the top of the loop.

> **Naming — this is NOT `orders:flow`.** §25 and earlier notes used that
> shorthand. It does not match the convention every other fingerprint in this
> function follows, which is `<snapshot card id>:<condition>` — `lazywait:sync_health`,
> `payment:configuration`, `account_deletion:manual_review_backlog`. The card id
> is `order_flow`, and the alert row's `subsystem` must equal it so the inbox
> filter and the mute override agree. Hence `order_flow:health`. The shorthand
> was never a requirement, only my own loose phrasing carried forward.

### It also teaches the bilingual renderer the subsystem's name

Raised by automated review on PR #172, and a real defect in the first draft.

`operations_alerts_evaluate` calls `operations_alerts_outbox_for_event` on every
open / escalate / downgrade / reminder / recover — **unconditionally** — and that
enqueues a rendered AR and EN row into `public.operations_alert_outbox`.
`operations_alerts_render_event` maps the subsystem id to a human name with a
`case` that falls back to the raw id.

With no `order_flow` arm, the first real incident would have persisted an Arabic
row reading:

```
[حرج] order_flow — تنبيه جديد
```

A bare English identifier dropped into Arabic text, in an Arabic-first product.
Adding the label to `alertsView.ts` does not help — this rendering happens in the
database, before any client sees it. The migration now re-emits
`operations_alerts_render_event` with one line added per language arm, and the
labels match the frontend map exactly so the inbox and the outbox call the
subsystem the same thing.

### How both bodies were produced

Between them the two functions are ~350 lines and had to be re-emitted whole.
Neither was **hand-transcribed** — that is exactly the failure mode §24 recorded
and §25 was written to avoid. Each body was extracted programmatically, the
addition inserted at a fixed anchor, and the result diffed against the original:

| Function | Source | Diff |
| --- | --- | --- |
| `operations_alerts_derive` | `20260723140000:881-1160` | 0 removed · **36 added** · one hunk |
| `operations_alerts_render_event` | `20260723090000:1413-1483` | 0 removed · **2 added** · one per language |

**Both are pure insertions.** No pre-existing line changed in either, so no other
subsystem's conditions or rendered text could have shifted.

### Verification

Ten of the twelve cases in `supabase/tests/order_flow_alert_condition_test.sql`
were executed locally against a scratch PostgreSQL 16 database carrying the real
`operations_alerts_sanitize_evidence` / `safe_int` / `safe_bool` helpers. Case 9
(derive over the real snapshot) and case 12 (end-to-end through
`operations_alert_outbox`) need the full schema and run in CI.

**Every case was mutation-tested**, because a suite that cannot fail proves
nothing:

| Mutation | Result |
| --- | --- |
| `idle` added to the alerting states | fails `FAIL(1)` |
| severity hard-coded to `critical` | fails `FAIL(4)` |
| the arm disabled (`if false`) | fails `FAIL(3)` |
| a `customer_id` leaked into evidence | fails `FAIL(8)` |
| per-state fingerprints | fails `FAIL(3)` |
| **`degraded` alone given its own fingerprint** | fails `FAIL(6)` |
| the Arabic `order_flow` label removed | fails `FAIL(11)` with `[حرج] order_flow` |
| the English `order_flow` label removed | fails `FAIL(11)` with `[CRITICAL] order_flow` |

The last row exists because the blunt per-state mutation tripped case 3 first,
which left case 6 — the escalation-identity property, the whole reason for a
single fingerprint — **unproven**. A narrower mutation that keeps cases 3 and 4
passing was written specifically to exercise it, and it fails there as intended.

Frontend: `order_flow` gained EN/AR labels and a filter entry in
`alertsView.ts`; without them the inbox would attribute its alerts to the raw id
`order_flow` and the filter dropdown could not isolate the one card that watches
the business outcome. That test was mutation-checked too — deleting the label
makes it fail with `expected 'order_flow' to be 'Order Flow'`.

Full local run before pushing: `tsc --noEmit` clean, 1705 unit tests pass across
111 files, design-system sync and hygiene clean.

### Pre-live gate (§9-B), recorded before applying

| Check | Value |
| --- | --- |
| Live rows before | **69**, latest `20260807152347` |
| `operations_alerts_derive` contains `order_flow` | **false** |
| `derive` source md5 | `ea011fe74126d958ca68ada4fd3e835e` |
| `render_event` source md5 | `9623c15ffa75d98a89543ad25d9b6312` |
| **AR render, before** | **`[حرج] order_flow — تنبيه جديد`** |
| **EN render, before** | **`[CRITICAL] order_flow — Alert opened`** |
| `public` functions | **125** |
| `operations_alert_state` | 2 rows, 0 open |
| `operations_alert_outbox` | **42 rows** |
| `order_flow` card | `idle` |

Two things in that table are worth keeping. The AR/EN "before" values are the
defect measured on Production rather than argued from source — the raw id really
was what the renderer produced. And 42 outbox rows is the evidence that this path
writes rows in the ordinary course of business, which is what made §25's
"dormant" description wrong.

The file carries **zero write statements** and is `create or replace` throughout,
so a bad transcription would have been re-appliable rather than destructive.

### Verification (§9-E), after applying

**The transcription was verbatim, and provably so** — the same test §25 used:

| Fingerprint | Repository file | Live row |
| --- | --- | --- |
| `skel` | `0156c74bbf8d` | `0156c74bbf8d` |
| raw md5, trailing newline stripped | `21755be882e3cbc855df102f0d6c07d0` | `21755be882e3cbc855df102f0d6c07d0` |

**The prediction recorded before the apply held.** The card is `idle`, so the
arm had to stay silent:

| Check | Before | After |
| --- | --- | --- |
| `order_flow` card | `idle` | `idle` |
| `derive` `order_flow` conditions | — | **0** |
| `derive` conditions, all subsystems | — | 0 |
| `operations_alert_state` | 2 rows / 0 open | **2 / 0** |
| `order_flow` rows in `operations_alert_state` | — | **0** |
| `operations_alert_outbox` | 42 | **42** |
| `public` functions | 125 | **125** |
| orders | 24 | 24 |
| live rows | 69 | **70** |

The function count is unchanged **because both objects were replaced, not added**
— which is itself the check that nothing extra was created.

**The rendering defect is fixed on Production**, measured the same way it was
measured before:

| | Before | After |
| --- | --- | --- |
| AR | `[حرج] order_flow — تنبيه جديد` | **`[حرج] تدفق الطلبات — تنبيه جديد`** |
| EN | `[CRITICAL] order_flow — Alert opened` | **`[CRITICAL] Order Flow — Alert opened`** |
| Another subsystem | — | `[حرج] مزامنة Lazywait` — unchanged |
| Unknown subsystem | — | `[WARNING] brand_new_thing` — fallback intact |

**The arm behaves as specified**, exercised against synthetic snapshots on the
live function: a `failing` card yields `order_flow:health / critical /
flow_stopped`, and an `idle` card yields nothing at all.

**Contracts preserved.** `derive` is still `stable`, `render_event` still
`immutable`, neither is `security definer`, both carry `search_path=public`, and
both ACLs remain `{postgres=X, service_role=X}` — no `anon`, no `authenticated`.

**Advisors.** 66 security lints, the **same count as before the apply**, with
**0 `ERROR`** and **zero** naming `operations_alerts_derive`,
`operations_alerts_render_event` or `order_flow`. Nothing is attributable to
this apply.

**Version alignment (§9-D) was deliberately not performed** — a separate live
history write needing its own approval, and class **B** is this repository's
normal steady state.

### What this does and does not deliver

The alert path is now armed end to end: a `failing` order-flow card will raise
`order_flow:health` at critical severity, the evaluator will persist it to the
in-dashboard inbox within five minutes, and the outbox rows will name the
subsystem correctly in both languages.

**It has not fired, and on today's data it cannot — proven rather than inferred.**

An earlier revision of this paragraph argued that from the single
`baseline_samples = 0` reading taken at the verification instant. That reasoning
was not sound, and automated review on PR #173 was right to challenge it:
`operations_health_snapshot_internal` recomputes the sample count for whatever
window it is called in, so one observation says nothing about the other 167 hours
of the week. The conclusion happened to survive; the argument did not.

The actual check. An order at time `o` covers weekly-offset sample `w` for every
evaluation instant `t` in `[o + w weeks, o + w weeks + 60min)`, so the sample
count can only reach a maximum at some `t = o + w weeks`. Evaluating all 24 × 8
such candidates against Production's orders:

| | |
| --- | --- |
| Orders | **24**, spanning **24.47 days** (2026-07-08 → 2026-08-01), 4 ISO weeks |
| **Maximum `baseline_samples` at ANY evaluation instant** | **2** |
| Candidate instants reaching the required 3 | **0** |

So there is no hour of the week at which this card could currently leave `idle`.
That is a fact about the present data, not a permanent property: it changes the
moment the same hour-of-week trades in 3 of the previous 8 weeks.

This closes the gap in the **mechanism**. The **coverage** still depends on order
volume that does not exist yet. §25's closing note applies unchanged.

> Two things surfaced while checking this, neither part of this migration and
> both worth someone's attention:
>
> * **~~The newest order is 2026-08-01, an operational signal~~ — that reading
>   was WRONG, corrected 2026-08-07.** It looked at the newest timestamp without
>   the denominator. The full picture: 24 orders all time, **2 distinct
>   customers**, 5 profiles, 6 checkout sessions, **every order still
>   `payment_status = 'pending'`** and **none ever `delivered`**. There was never
>   an order flow to stop, so the quiet period is not a regression — this is
>   pre-launch test traffic. The real finding is the stronger one: **the order
>   lifecycle has never completed once in production.** See `PROJECT_STATUS.md`
>   → "Production reality check".
> * **`open_branches` counts `branches.is_active`**, a configuration flag rather
>   than a trading-hours state. Checked against the live schema on 2026-08-07:
>   `public.branches` has `is_active`, `delivery_enabled`, `pickup_enabled` and
>   `delivery_temporarily_closed` — and **no opening-hours data of any kind**.
>   So the card cannot know trading hours, and its "no branch open → idle" arm
>   fires only if every branch is deactivated, which is a config action rather
>   than a nightly event.
>
>   The card is nonetheless **not** wrong to be quiet at night. The protection
>   comes from the **minimum-sample arm, `baseline_samples < 3`**: at 04:00 the
>   historical 04:00 windows are equally empty, the `where c > 0` filter drops
>   them all, and the sample count is 0.
>
>   **A first attempt at this correction named the `baseline < 1` arm instead,
>   and that was also wrong** — caught in review on PR #176. That arm is
>   *unreachable*. The same `where c > 0` filter means every counted sample is
>   at least 1, so a non-empty baseline always averages >= 1; and an empty one is
>   already caught by the sample-count arm above it. An exhaustive search over
>   all 65,536 combinations of the eight weekly window counts reaches it zero
>   times. It is harmless dead code, but it should not be described as a guard.
>
>   Correcting the in-body comment would mean re-emitting a 1000-line function,
>   which is not worth it for a comment — recorded here and in the card's test
>   suite, where someone reasoning about the arms will look.


## 27. Applied migration: order-note length limit (applied 2026-08-22)

| | |
| --- | --- |
| Repository file | `20260819120000_order_note_length_limit.sql` (**182** lines) |
| Live version | `20260822123620` |
| Applied | 2026-08-22 12:36:20 UTC, **by a Claude Code session** (`session_01VXmTcJDSWXVD9qm7irPbpV`) via MCP `apply_migration`, on explicit owner approval — corrected 2026-08-24, see §31 |
| From | PR for `feat/order-note-length-limit` (`aff65ce`, #222) |
| Evidence | executable SQL identical to the repository file; the stored text is condensed — see §31 |

> The line count above read **145** until 2026-08-22 and was wrong on the day it
> was written: the file has 182 lines and has only ever had one commit. Corrected
> rather than quietly dropped, because §29 exists for exactly this — a count with
> no stated method is the thing that makes a record irreproducible.

**What it does.** Adds `public.order_note_normalized(text)`,
`public.order_note_is_acceptable(text)` and `public.enforce_order_note()`, plus
one `before insert or update of notes` trigger on `public.orders` and one on
`public.checkout_sessions`. An order note
may be NULL or at most 280 characters after trimming; the stored value is
trimmed, and a whitespace-only note becomes NULL.

**Why it exists.** `orders.notes` has been unbounded since `20260707120500`:32.
`place_customer_order` is granted to `authenticated`, so the UI limit was never
a control — a signed-in customer can call the RPC directly. Full rationale,
including why a trigger rather than a CHECK constraint and why
`checkout_sessions` is guarded too, is in `docs/ORDER_CONFIRMATION_FLOW.md`
§10c.

**Pre-apply evidence, read-only Production inspection 2026-08-19** (permitted by
CLAUDE.md §10; it authorizes no write):

| | |
| --- | --- |
| `orders` rows | 32 |
| rows with a non-empty note | 2 |
| longest existing note | **2 characters** |
| rows over 280 characters | **0** |
| `checkout_sessions` rows | 6 |
| sessions carrying any note | **0** |

So nothing in Production becomes unupdatable by this rule, and no unconsumed
checkout session carries a note that could strand a captured payment at
finalize. Re-verify both counts immediately before applying — these are dated
facts, not standing ones.

**Chain evidence.** Replayed on a disposable PostgreSQL 16 + PostGIS 3.4 cluster
on 2026-08-19 using `.github/sql-ci/run.sh`: **82 migrations applied cleanly from
empty**, and **41/44 SQL suites passed with 0 new failures** (the 3 quarantine
entries in `.github/sql-ci/known-failing.txt` are unchanged). The paired suite
`supabase/tests/order_note_length_test.sql` was additionally mutation-checked
twice — dropping both triggers makes it fail at CASE 2, and re-introducing the
`E''` escape set described in `docs/ORDER_CONFIRMATION_FLOW.md` §10c makes it
fail at CASE 1 — so its green run means the guard is present and correct rather
than merely that the file executed.

**Rollback.** Drop the two triggers and the three functions; the commands are in
the migration footer. No row is modified, no column type changes, and the rule
is strictly narrowing — every value accepted after it was accepted before.

---

## 28. Branch operations — APPLIED 2026-08-21 (thirteen migrations)

Thirteen migrations implementing the branch-operations feature (timed
item/option availability, delivery control, the two operations consoles, and the
health/alert surfaces) were applied to Production on **2026-08-21** with explicit
owner approval ("apply the migrations if safe", then "fix it first then apply all
thirteen", then "Apply all 13 now"), following §9: pre-live gate (§9-B), one
`apply_migration` call per file in filename order, then verification (§9-E). No
`db push`, no batch replay, no unrelated SQL.

They shipped as PR #229, squash-merged to `claude/project-build-ie4b56` as
`49fcf88`. Repository files were confirmed identical to that merged base by
`git diff` before applying.

### §9-C1 was met in full — unlike §24

Every one of the thirteen `apply_migration` calls carried the repository file's
**complete** text, header comments included. That is verifiable from the database
alone: `md5(array_to_string(statements, E'\n'))` on each live
`supabase_migrations.schema_migrations` row equals the md5 of the repository file
with its single trailing newline stripped (the MCP tool stores the whole
migration as one statement, and strips that newline).

This is the check §24 could not make. A `skel` fingerprint proves the executable
SQL matches; a full-text md5 proves **nothing at all differs**, which is what
§9-C1 actually requires. Use this method for future applications.

| # | Repository file | Live version | md5 (repo = live) |
| --- | --- | --- | --- |
| 1 | `20260820100000_ops_roles_enum` | `20260821200452` | `94cd6fdb63ee9617ab267c859d421f11` |
| 2 | `20260820100500_ops_branch_scoping` | `20260821200622` | `76cad20a77c22ce03e926a70406ead27` |
| 3 | `20260820110000_branch_availability_snooze` | `20260821200742` | `a20a4d2f55471dda84fa48c3838e7717` |
| 4 | `20260820110500_branch_availability_rpcs` | `20260821200822` | `b4f5c72352ca8eb4cafc9e8354b3fd59` |
| 5 | `20260820111000_branch_availability_sweeper` | `20260821200916` | `529130becdd3d1f0a6a021f0b4b35dc6` |
| 6 | `20260820120000_branch_delivery_control` | `20260821201035` | `a7417abee68823bb193f0f0830db22ac` |
| 7 | `20260820120500_branch_delivery_rpcs` | `20260821201133` | `eef40d46fcbcf0e3bd6d2804dd165b0c` |
| 8 | `20260820121000_sweeper_delivery_resume` | `20260821201208` | `21359679d8608195c7eb5089e4c71380` |
| 9 | `20260820130000_ops_change_events` | `20260821201250` | `98c9fa1fdfdf789b557db590e467cb66` |
| 10 | `20260820140000_branch_modifier_availability` | `20260821201409` | `b0d38148ccb30941e9f9e3b426ad03b4` |
| 11 | `20260820140500_place_order_modifier_availability` | `20260821201535` | `38b08403a9f875e11baf576a2b564b26` |
| 12 | `20260820150000_sweeper_operations_health` | `20260821201911` | `1e214e37781cb8bfb5941fa5b46dc616` |
| 13 | `20260820160000_branch_availability_health_card` | `20260821202429` | `655d75ca9189b5da71e5af2cce051547` |

**Live migration-history rows: 87 → 100.** The thirteen live versions are dated
`20260821`, not `20260820`: the MCP tool stamps its own timestamp, so live
versions are ordered by *application* time and will never match repository
filename prefixes. That is the same repo/live version skew §12 already records —
it is not drift, and nothing should be "repaired" to make the two sets look
alike (CLAUDE.md §8).

### Two of the thirteen do more than define objects

- **#1 is irreversible.** `ALTER TYPE public.user_role ADD VALUE` twice.
  PostgreSQL cannot drop an enum value. It was inert on application — zero
  profiles hold either role — but a rollback cannot take it back. It is alone in
  its own file because a new enum value cannot be *used* in the transaction that
  adds it.
- **#5 schedules a pg_cron job** and **#9 changes what Realtime broadcasts.**
  `branch-availability-sweep` began running one minute after application;
  `supabase_realtime` went from one published table to two
  (`order_change_events`, `ops_change_events`). Both were named in the approval.

`#8`, `#12` and `#13` deliberately re-emit function bodies **without**
re-scheduling the cron job or re-granting anything.

### Verification (§9-E), after applying

**The order path.** `place_order` is the one order-path change (its 8th
revision). Its ACL was captured before and after and is unchanged —
`{postgres=X/postgres,service_role=X/postgres}`, with **no** `authenticated`
grant, so the `20260724200000` hardening that wraps it in `place_customer_order`
survived. Still exactly one overload; both new guards present. A line diff
of the function definition (`create or replace function public.place_order(`
through the matching `end $$`) against the revision it replaces reports
**18 lines added and none removed** — 305 lines to 323 — grouped into three
insertions: the lazy-expiry comment (4 lines), the
`bpa.snoozed_until > now()` clause (1 line), and the
`branch_modifier_availability` check (13 lines). Hunk *grouping* depends on the
extraction bounds, so the reproducible figure is the line count, not the number
of hunks.

**Operations Health.** 9 → **10 cards**, the new one `branch_availability`,
state `healthy`. `critical_systems` is unchanged at five, `overall_state`
`healthy`, `expected_jobs` 5 → 6, and all six allowlisted cron jobs read
`healthy`. `operations_alerts_derive` emits **zero** conditions against the live
snapshot, so nothing spurious opened.

**No branch identity in the payload.** A `::text` scan of the whole snapshot
against every live branch's `name_en`, `name_ar` and `id` returns **0** matches
on all three.

**The sweeper.** 17 runs in the first 25 minutes, 17 `success`, 0 `failed`, and
0 non-`succeeded` pg_cron run rows.

**Exposure.** The new ops tables all have RLS on with `authenticated:SELECT`
only and no `anon` grant: `staff_branch_assignments`,
`branch_availability_events`, `branch_delivery_events`, `branch_delivery_areas`,
`ops_change_events`. `branch_working_hours` is `anon:SELECT` by design (public
trading hours). `branch_availability_runs` has RLS on with **no policy and no
client grant** — fail-closed, matching the 13 pre-existing internal ledgers
(`operations_alert_runs`, `order_integrity_runs`, `lazywait_sync_requests`, …)
that the platform advisor lists the same way.

**Advisors.** 19 of 82 findings name objects this work created: one
`rls_enabled_no_policy` (the ledger above, deliberate) and 18
`authenticated_security_definer_function_executable` — the house pattern of a
`SECURITY DEFINER` RPC granted to `authenticated` and authorized in its own body.
48 further instances of that warning pre-date this work. **No new finding class
was introduced.**

### A later migration re-emits `place_order` again

`20260821170000_order_item_notes.sql` (#231, merged after this application and
**not** applied to Production) is the 9th revision of `place_order`. It was
written on top of the 8th, so it carries both additions this work made — the
`branch_modifier_availability` check and the `bpa.snoozed_until > now()` lazy
expiry. Applying it will not silently revert the modifier guard.

That is worth stating because the reverse is the easy mistake: a re-emission
built from an older file would drop the guard without any test noticing, since
the guard's own suite exercises the RPCs rather than this specific function
body. Confirm the same before applying any future `place_order` revision.

### Still gated after this application

Applying the schema did **not** make the feature reachable. It stays dark until
an account holding `branch_staff` or `call_center` exists, and none does — see
[`OWNER_ACTIONS.md`](OWNER_ACTIONS.md) §16 for the three actions that remain.


**Do not recompute the §4 classification counts from this list.** Those are a
dated full-fingerprint snapshot (CLAUDE.md §8); adding rows here does not extend
them, and arithmetic is not evidence.

### One trap worth recording

`20260810113500` **renamed** the alert-engine's per-card function to
`operations_alerts_derive_pre_stranded` and made `operations_alerts_derive` a
thin wrapper that appends the independent `order_integrity:stranded_orders`
critical condition. While writing `20260820160000` the new arm was first added
by re-emitting the *wrapper's* name, which silently deleted that stranded-order
alert — a critical condition whose entire purpose is that a warning cannot mask
it. The migration-chain suite caught it. New per-card arms go in the **renamed**
function; `supabase/tests/branch_availability_health_card_test.sql` case H now
asserts the wrapper survives.

The general rule: before re-emitting any function, confirm which migration holds
its **current** definition — `grep -ln 'create or replace function public.<name>'
supabase/migrations/*.sql | sort | tail -1` — rather than the one you happen to
remember.

---

## 29. Repo/live divergence in `place_order` — comments only, resolved 2026-08-21

Recorded so nobody repeats the investigation. Applying §28 required proving the
live `place_order` matched the repository revision the new one was built from.
**It did not**, and the first look at that is alarming enough to stop a release.

### What was found

**Name the two artifacts precisely — the whole point of this section is that it
must be reproducible.** They are:

1. the repository file
   `supabase/migrations/20260710120100_place_order_delivery_zone.sql`, **336
   lines** (335 plus the trailing newline the applier strips);
2. the SQL actually applied to Production — the single statement stored on live
   version `20260709151718`, the last history row to define `place_order` before
   §28 — **304 lines**.

The live function body matched that row exactly, so the *repository file* had
been edited after it was applied, not the database after it was written.

Compare them by per-line md5 (the line text never has to leave the database) and
diff the hash sequences with `difflib.SequenceMatcher`. That yields **seven
hunks, every one a deletion — no insertion and no replacement anywhere**:
**32 repo lines absent from the applied text, 0 applied lines absent from the
repo**, similarity 0.95.

| Repo line(s) | Content | Where |
| --- | --- | --- |
| 1, 3–26 | the file-header comment block (24 comment lines and one blank) | above the function |
| 74 | `-- payment method` | in the declare block |
| 97–99 | the three-line "Resolve + validate the payment method against admin settings" block | in the body |
| 143 | `-- Coordinates come from the map picker; required for a delivery order.` | in the body |
| 147 | `-- The branch must have a configured active delivery zone...` | in the body |
| 154 | `-- ...and the customer point must fall inside it (GiST-indexed, boundary-inclusive).` | in the body |

Twenty-five of the 32 are the header block, which sits *outside* the function
definition; the remaining **seven are in-body comments**. Measuring only the
function region therefore reports 7 lines across 5 hunks, and measuring the
whole file reports 32 across 7 — the same finding at two scopes. State which
scope you mean; an unqualified line count is what made this record
irreproducible in the first place, and PR #232 review caught exactly that.

**Zero behavioural difference.** No statement, guard, clause or literal differed
at either scope.

### Why it happened, and why it is worth a section

The same class of thing §24 records in the other direction. There, the applying
agent condensed a header on the way *in*, so the live row lost rationale the file
kept. Here, comments were added to the file *after* application, so the file
gained rationale the live row never had. Both leave the repository and the
database describing the same schema in different words, and both are invisible
until someone tries to prove equality.

A `skel` fingerprint would have called these two identical and moved on. That is
the right answer for "is the schema the same" and the wrong answer for "is this
file what ran" — which is the question §9-C1 asks.

### Current state

Resolved as a side-effect of §28. Migration 11 re-emits `place_order` from the
repository file, so the **live function now carries all seven comment lines**
(verified with `pg_get_functiondef`), and live version `20260821201535` is a
history row whose text is byte-identical to its repository file.

What remains, permanently: the historical row `20260709151718` still holds the
283-line text that actually ran in July 2026. That is correct — it is a record of
what happened, not a copy of the file, and it must not be rewritten. Anyone
diffing that row against
`20260710120100_place_order_delivery_zone.sql` will find the seven comment lines
missing, and this section is the explanation.

### The rule

Do not edit a migration file after it has been applied — not even a comment. If
the rationale needs improving, put it in a follow-up migration's header or in
this document, where it can be read without implying that the edited text is
what ran.

---

## 30. Applied migration: branch-availability ledger retention (applied 2026-08-22)

`supabase/migrations/20260822090000_branch_availability_retention.sql`, live
version `20260822115505`, applied 2026-08-22 11:55:05 UTC with explicit owner
approval. Full-text md5-identical to the repository file — see §31.

### Why

`branch_availability_runs` takes one row per minute and §28 put it live with no
retention at all. Measured in Production the day after: ~245 bytes/row, so
~1,440 rows/day, ~526,000 rows and ~130 MB a year, growing without bound.

The house already answers this. `lazywait_sync_requests` is the other
once-per-minute run ledger and `20260720120000:150-159` prunes it to 14 days on
every tick — Production held **exactly 20,160** of those rows when this was
written, which is 14 × 1,440. This migration gives the availability ledger the
same window and the same steady state.

Nothing about the feature's behaviour changes. The `branch_availability` health
card reads only the newest run and the newest success, both index-served, so it
was never at risk from ledger size; this is housekeeping, not a fix.

### What it does, and deliberately does not

| | |
| --- | --- |
| Prunes | `branch_availability_runs`, rows older than 14 days |
| Never prunes | `branch_availability_events` — the append-only audit of who closed what. A business record whose retention nobody has decided; deleting from it needs its own owner decision. |
| Re-schedules the cron job | **No.** `branch-availability-sweep` keeps the exact name, schedule and command `20260820111000` asserts. |
| Adds an index | **No.** `bar_started_idx` on `(started_at desc)` already serves the range delete. |
| Adds a column | `rows_pruned` on the ledger, so each tick records what it removed |

### Two deliberate divergences from the lazywait precedent

**The prune is separately guarded.** lazywait's is not. Here it gets its own
`begin ... exception when others`, because an unguarded prune that threw would
abort the whole transaction and nothing would reopen that tick — a 30-minute
closure becoming indefinite because a DELETE hit a lock timeout. Restores are
customer-facing; retention is housekeeping, and housekeeping must never cost
that. The price is that a persistently failing prune is silent, so `rows_pruned`
makes it inspectable: nothing alerts on it, and a table growing while it stays 0
is the signal.

**It sits inside the advisory lock**, not before it, so two runs never contend
on the same delete — serialising this function is what the lock is for. The only
path that skips retention is `overlap_skipped`, which happens only when another
run holds the lock and is itself pruning.

It is in the OUTER block, above the sweep's own `begin ... exception`, because
that handler is a savepoint: a prune inside it is rolled back whenever the sweep
fails, and a database whose sweeps are all failing is precisely the one that
must keep pruning.

### Verification

`supabase/tests/branch_availability_retention_test.sql`, run against a fresh
97-migration database: 50/52 suites pass, 0 new failures, chain replays clean.

Mutation-checked, and the first attempt was **not** good enough — recorded
because the lesson generalises. A text-position assertion ("the delete appears
before the reopen work") passed against a mutant that moved the prune *inside*
the sweep's exception block, since that is still textually above the reopen. The
property is behavioural, so the test is now behavioural: force the sweep to fail
with a temporary trigger and assert the old rows are gone anyway.

| Mutant | Caught by |
| --- | --- |
| retention removed entirely | case 1 |
| window widened to 400 days | case 1 |
| prune moved inside the sweep's exception block | case 5b (behavioural) |
| prune also deletes from `branch_availability_events` | case 4 |

---

## 31. The 2026-08-22 application (§30 + §27 + order item notes)

Three migrations reached Production on 2026-08-22, taking live history from
**100 to 103 rows**. They were applied in two separate acts by two different
sessions, and the difference between them is the point of this section.

| # | Repository file | Live version | Applied (UTC) | By |
| --- | --- | --- | --- | --- |
| 1 | `20260822090000_branch_availability_retention` (204 lines) | `20260822115505` | 11:55:05 | this session, on explicit owner approval |
| 2 | `20260819120000_order_note_length_limit` (182 lines) | `20260822123620` | 12:36:20 | a **Claude Code session** (`session_01VXmTcJDSWXVD9qm7irPbpV`), via MCP `apply_migration`, on explicit owner approval |
| 3 | `20260821170000_order_item_notes` (833 lines) | `20260822123940` | 12:39:40 | a **Claude Code session** (`session_01VXmTcJDSWXVD9qm7irPbpV`), via MCP `apply_migration`, on explicit owner approval |

Order matters and was respected: #3 calls `order_note_normalized` seven times, so
it depends on #2. Filename order gives the right sequence.

### The evidence, and where it differs

| # | repo md5 (full text) | applied md5 | full text | executable SQL (`skel`) |
| --- | --- | --- | --- | --- |
| 1 | `9e225cf8247940059ff982473b6b5a37` | `9e225cf8247940059ff982473b6b5a37` | **identical** | — |
| 2 | `90ac03009e71ae9b6e9f5aa73875b56c` | `3982d6167ff005c5aa23f252930eae8d` | differs | `0262280dd19823dcf85ab2b8b125d10b` both sides |
| 3 | `d5a7c98d65641aee808f0f9a76d055a4` | `6cc898dd6b17d432dd08b2c0d6b5a7e5` | differs | `89e6adeef95a6ff70b73a6298c672103` both sides |

Migration 1 met §9-C1 in full: the `apply_migration` call carried the file's
complete text, so the live row is md5-identical to the file.

**Migrations 2 and 3 did not.** Their stored text is condensed — 182 lines → 86,
and 833 → 721, so roughly **200 comment lines were stripped on the way in**. The
executable SQL is untouched: strip `--` lines and blank lines from both sides,
normalise whitespace, and the fingerprints match exactly, to the character.

That is the same deviation §24 records, in the same direction, four migrations
later — and §28 wrote down the full-text md5 method two days earlier precisely to
prevent it. Recording it rather than smoothing it over, because the consequence
is specific: the live rows for #2 and #3 carry the SQL without the rationale the
files carry, and anyone diffing file against row will find a mismatch that looks
alarming and is not. §29 exists to defuse exactly that confusion; this section
extends it to two more versions.

**Who applied them — corrected 2026-08-24.** A **Claude Code session**,
`session_01VXmTcJDSWXVD9qm7irPbpV`, via two MCP `apply_migration` calls made on the
owner's explicit in-conversation approval. **This paragraph previously said the
owner applied them directly, working against Production rather than through an
agent session. That was wrong.** It rested on a statement the owner made on
2026-08-23, after this section first went in reading "outside this session". The
owner authorised and drove both applications — that much is true, and is what the
statement is best read as describing — but did not issue the calls.

`schema_migrations` still cannot answer "who": it records what ran and when,
never who ran it, and a ledger that cannot answer "who" is still only half a
record. What answers it is the applying session's transcript, which the ledger
cannot see but which does exist — `apply_migration` for
`order_note_length_limit`, read-only verification, `apply_migration` for
`order_item_notes`, read-only verification — producing exactly versions
`20260822123620` and `20260822123940` and moving live history 101 → 102 → 103,
which leaves no room for a second actor. Both the "outside this session"
placeholder and the incorrect owner attribution are recorded here rather than
pretended away.

**The mechanism, now recorded.** MCP `apply_migration` via the Supabase MCP
server, one call per file, in dependency order, each call followed by read-only
verification. This paragraph previously read "the mechanism is not known and is
not recorded here", which followed from the actor being wrong: with the owner
believed to be working directly against Production, nothing established how the
calls were submitted. Identifying the applying session supplies it.

What is still **not** established is why the stored headers were trimmed;
`schema_migrations` stores what ran and when, never how it was composed. An
earlier draft of this section asserted a console-paste explanation for that. It
was invented, it was removed on review, and it is mentioned so the remaining
absence reads as a known gap rather than an oversight — and so this correction is
not mistaken for licence to fill the rest of it by inference.

**What the correction costs this section.** The paragraph that stood here argued
that §24's condensation was "the applying **agent's** own editorial choice while
composing the call" whereas this one was the **owner** applying directly, and
concluded that two different *kinds* of actor had produced the same deviation —
offering that as the whole basis for the rule below being addressed to humans and
agents alike. With the actor corrected, that basis is gone: both known instances
were produced by an agent session composing an `apply_migration` call. The rule
below is still addressed to humans and agents alike, because nothing about it
depends on who has tripped it so far and narrowing it to agents would be a fix
aimed at the evidence rather than at the failure. But it is now supported by one
kind of actor, twice, and that is written down so a future reader does not
rediscover the "two kinds of actor" claim and take it as established.

**The `skel` fingerprint proves the schema is right and nothing more.** It says
no statement was added, removed or altered. It says nothing about the comment
text, which is where these two differ. It is evidence the deviation is harmless,
not evidence that §9-C1 was satisfied.

### Verification after all three

The order path was the exposure: #3 re-emits `place_order`,
`compute_order_snapshot` and `insert_order_from_snapshot`, and #3 was applied by
an actor other than the author of the revision it replaced. Checked directly
against the live catalog afterwards:

- `place_order` ACL still `{postgres, service_role}` — **no `authenticated`
  grant**, so the `20260724200000` hardening that wraps it in
  `place_customer_order` survived a third-party re-emission;
- still exactly **one** `place_order` overload;
- the modifier-availability guard and the `bpa.snoozed_until > now()` lazy
  expiry from §28 are **both still present** — a re-emission built from an older
  file would have dropped them silently, and no test would have caught it;
- the note plumbing is present in all three functions;
- `branch_availability_sweep` still carries its advisory-lock guard, 0 failed
  runs, 7 cron jobs, `overall_state` healthy.

The three re-emissions in #3 are pure note plumbing — `place_order` +3/−2,
`compute_order_snapshot` +1/−0, `insert_order_from_snapshot` +3/−2 — and touch no
payment logic, which is why they sit outside the CLAUDE.md §6 freeze despite
`compute_order_snapshot` being the online-checkout twin.

### Retention is live but will read zero until 2026-09-04

Migration 1's prune deletes ledger rows older than 14 days. The ledger's oldest
row dates from 2026-08-21 20:10, so **nothing is beyond the window yet** and
`rows_pruned` correctly reads 0 on every tick until roughly 2026-09-04. A zero
there is the window working, not retention failing. The signal for a broken
prune is the table growing *past* that date while `rows_pruned` stays 0.

### The rule, restated because it has now been missed twice

Paste the migration file verbatim. If it is too long for one call, that is a
reason to split the migration, not to edit its text on the way in. Verify with a
full-text md5 of the live `schema_migrations` row against the file with its
single trailing newline stripped — not a `skel` fingerprint, which cannot see
this class of drift at all.

## 32. The 2026-08-25 application (product variants + order-path tiers)

Applied on explicit owner approval in conversation, following §9 end to end. Two
files, in dependency order, one MCP `apply_migration` call each, each followed by
read-only verification. **No `db push`, no batch replay, no unrelated SQL.**

| | Repo file | Live version | Applied (UTC) |
| --- | --- | --- | --- |
| 1 | `20260824120000_product_variants.sql` | `20260825061046` | 2026-08-25 06:10:46 |
| 2 | `20260824130000_place_order_variants.sql` | `20260825061502` | 2026-08-25 06:15:02 |

Live migration history: **103 → 105**. Ledger rows 59–60.

### Pre-live gate (§9-B), recorded before applying

- Live state matched CLAUDE.md §8 exactly: 103 rows, latest `20260822123940`.
- Neither target version nor target name present in `schema_migrations`;
  `to_regclass('public.product_variants')` was NULL and `order_items` carried
  none of the three variant columns — so neither file was applied, by history
  **or** semantically (§9-B5).
- Before-state fingerprints captured for all seven functions the two files
  touch (§9-B6).
- Rollback source (§9-B4): the prior definitions of all four order-writing
  functions are in `20260821170000_order_item_notes.sql`; the first file is
  purely additive DDL, reversible with `drop table public.product_variants
  cascade` and three `alter table ... drop column`.

### Fidelity was proven, not assumed

MCP `apply_migration` takes the SQL as a parameter, so ~1 370 lines had to be
transcribed. A transcription slip inside `place_order` would not show up in any
object-level check, so **every applied function body was hashed against the
merged file afterwards**, and all seven matched byte-for-byte:

| Function | chars | md5 (live == file) |
| --- | --- | --- |
| `place_order` | 15 287 | `dcd117de2c3a0f63c048bfa47a96587a` |
| `compute_order_snapshot` | 8 631 | `a37ee893140629b3636271089df3f576` |
| `insert_order_from_snapshot` | 4 617 | `60b753bc57ef4d20ef529fc42b3ead79` |
| `admin_list_orders_with_items` | 2 454 | `4d2b5d10d9d8124ca8891eb4a39f4d37` |
| `import_lazywait_catalog` | 14 387 | `58d2b732f11c17d442350b393db3928c` |
| `set_lazywait_mapping` | 1 718 | `951093a076e2e95fb477808eea6e8a6f` |
| `clear_lazywait_mapping` | 1 036 | `4dd0dc0c46a4db8b2c4cabc11199f05c` |

**A normalisation trap worth recording**, because it produced a false alarm on
the first check: comparing `length(prosrc)` (Postgres counts **characters**)
against `len(body.encode('utf-8'))` (bytes) disagrees for any body containing
non-ASCII — `import_lazywait_catalog` embeds the Arabic literal `غير مصنّف`.
The md5s were identical throughout. Compare characters to characters.

### Verification (§9-E)

- **Objects, exactly as promised and nothing more:** `product_variants` with 12
  columns, RLS enabled, 2 policies, 3 indexes; `order_items` +3 columns with
  `select (variant_id, variant_name_en, variant_name_ar)` granted to
  `authenticated`; `lazywait_catalog_items` +4 columns.
- **Advisors:** 82 total, all pre-existing classes (66
  `authenticated_security_definer_function_executable`, 14
  `rls_enabled_no_policy`, 1 `anon_security_definer_function_executable`, 1
  `auth_leaked_password_protection`). **Zero** name `product_variants` — the new
  table is not flagged for missing RLS or a missing policy.
- **The frozen Moyasar migration was not swept in.** Checked explicitly, because
  `20260824100000` sorts ahead of both applied files: zero history rows, zero
  `%moyasar%` functions, zero `moyasar` provider rows, `provider_type='payment'`
  still `tap` and still `enabled = false`.
- **`orders` untouched** at 40 rows.

### Version alignment is NOT done (§9-D)

`apply_migration` stamps an apply-time version. Live history therefore carries
`20260825061046` and `20260825061502`, not the repository filenames. Aligning
them is a **separate live history write requiring its own explicit owner
approval**, and it has not been requested or performed. The repo filename
versions are absent from `schema_migrations` **by design** — that is not drift
and must not be "repaired".

### The catalog import that followed, and the bridge it needed

With the migrations applied, `import_lazywait_catalog()` was run on owner
approval. **The first run produced 61 products and 0 active ones** — the
original empty-menu bug one layer up.

The cause: this migration fixes the SQL **importer**, but the **parser** is
TypeScript inside the `lazywait-catalog` Edge Function, which has not been
redeployed. `lazywait_catalog_items.prices` therefore still held what the OLD
parser wrote — `price_excl_vat` null on all 147 rows, `price_with_vat` on only
the 21 dashboard-authored ones — so the importer read 0 and correctly marked 126
tiers unorderable.

The money was present in the cache all along, under `raw`, where the old parser
never looked. `lazywait_catalog_items.prices` was therefore **rebuilt from
`raw`** using the fixed parser's own rule (`price` → `price_excl_vat`), verified
by dry run first: 147/147 rows gained a net price, 147/147 carried a `price_id`,
and 147/147 gave a whole number at × 1.15. The import was then re-run.

**That backfill was a bridge, not the fix — and the bridge is now closed.**
`lazywait-catalog` was redeployed the same day on owner approval (version 3,
`verify_jwt` unchanged at `true`), so the deployed parser writes
`price_excl_vat` itself and the next pull rewrites that column with the same
values instead of nulling it. The deployed bundle was read back and verified
**byte-identical to the default branch across all six files** — the entrypoint
plus its five `_shared/` dependencies — by SHA-256, not by eye. The backfill is
recorded here so a future reader does not mistake a hand-written SQL rebuild for
parser output, and so the one pull that ran between the import and the redeploy
is accounted for.

Result, verified: **55 of 61 products active, 144 of 147 tiers active**, five
categories, prices 1.00–74.00 SAR, zero active products priced 0, zero active
products without a `lazywait_price_id`, every active tier a whole-riyal figure.
Coral imported with all **11** tiers and a "from" price of 20.00. The POS-only
records stayed out of the customer menu — `Extra Bread`, `Ranch Sauce`, the
`Change to Wedgez` upgrade and the `Offers` category — and `Macaroni Béchamel`
landed inactive as the orphan-category case the migration names by example.

### How the admin gate was satisfied — stated plainly

`import_lazywait_catalog()` is gated on `public.is_admin()`, which is
`current_app_role() = 'admin'` **and** `jwt_has_aal2()`. The session held
`postgres` credentials and no JWT, so the call was made after setting
`request.jwt.claims` to a **real admin who holds a verified TOTP factor**
(`b05de808-0666-4d2f-9184-6d3baa07174d`) with `aal: aal2`.

The entitlement is genuine; the session assertion is synthesised. This bypassed
the AAL2 requirement added on 2026-08-23, on the owner's explicit instruction,
and is recorded as such rather than glossed. The designed path — an admin
clicking Import in the console under their own TOTP session — remains the
correct one for routine use.

### Side effect: 16 branches created

None of the 16 Lazywait branches in the cache matched a local
`branches.lazywait_branch_id`, so the importer inserted all 16, taking the local
branch table from 25 to 41. They are created **inactive** by design and cannot
affect ordering until an admin sets their delivery configuration. It also means
branch mapping has never been done. See `docs/OWNER_ACTIONS.md`.
