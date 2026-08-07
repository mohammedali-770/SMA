# Supabase Migrations — Authoritative History Ledger & Production Workflow

> **This document is the single source of truth for the relationship between
> the repository's `supabase/migrations/` files and the production project's
> `supabase_migrations.schema_migrations` history, and for the ONLY approved
> way to apply migrations to production.** It must be updated after every
> approved live migration application.

---

## 1. Purpose and production status

**Class E holds exactly one file: `20260807170000_order_flow_alert_condition`
(§26), which is merged but NOT applied.** It closes the alert-engine gap
recorded in §25 and needs explicit owner approval to apply, like every other
production change. Everything else in the repository is applied.

Three files were applied on 2026-08-07 with explicit owner approval, via the MCP
`apply_migration` workflow, one call per file. The first two came from PR #166
and PR #167 (§24); the third from PR #169, corrected by PR #170 before it was
applied (§25).

| Repository file | Applied version | skel | Result |
| --- | --- | --- | --- |
| `20260806120000_erasure_phone_normalization` | `20260807140050` | `8759892535b7` | applied |
| `20260806130000_admin_ranged_orders_and_stats` | `20260807140206` | `a92bb07e58c7` | applied |
| `20260807150000_order_flow_health_card` | `20260807152347` | `f4df8ad27e85` | applied |

The three files unapplied before them — two from PR #142, one from PR #146 —
were applied on 2026-08-05, the same way.

| Repository file | Applied version | Result |
| --- | --- | --- |
| `20260801120000_address_single_default` | `20260805061621` | applied |
| `20260801120100_checkout_session_address_fk_set_null` | `20260805061912` | applied |
| `20260802120000_address_description_trim_all_whitespace` | `20260805061955` | applied |

- Repository migration files (default branch `claude/project-build-ie4b56`): **68**
- Live `schema_migrations` rows: **69**
- Unapplied repository files: **1** — `20260807170000_order_flow_alert_condition` (§26)
- Latest live version: **`20260807152347`**
  (`order_flow_health_card`; repository version `20260807150000`)

The 68 / 69 difference is the long-standing **history** divergence plus the one
pending file, not a *schema* divergence: **five** live-only F-class rows carry no
repository file, **three** H-class repository files (`place_order`, `loyalty`,
`order_idempotency`) were superseded by later consolidated migrations, and
**one** E-class file is not applied yet.
`68 files − 1 E-class − 3 H-class + 5 F-class = 69 rows`. §4 carries the full
class-by-class algebra, recomputed from live data on 2026-08-07 and reconciling
both sides exactly; §5 maps a subset of the rows.

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
> filenames, so these three are class **B**, which is what most of the ledger
> already looks like. Aligning them is a separate live history write needing its
> own explicit owner approval.

### The 2026-08-05 application

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

**Recomputed from live data on 2026-08-07 and now covering ALL 67 repository
files and ALL 69 live rows** — previous revisions of this table were scoped to a
56-file subset and, separately, undercounted two classes. Method: match by
`name`, then compare the repository filename version against the live `version`,
and the repository file's `skel` fingerprint against the live row's.

| primary classification | count |
|---|---|
| A. `EXACT_MATCH` (version + name + content) | **8** |
| B. `SAME_CONTENT_DIFFERENT_VERSION` | **53** |
| C. `SAME_NAME_DIFFERENT_CONTENT` | **3** |
| D. `SAME_VERSION_DIFFERENT_CONTENT` (version collision) | **0** |
| E. `REPOSITORY_ONLY_UNAPPLIED` | **1** |
| F. `LIVE_ONLY_MISSING_FROM_REPOSITORY` | **5** |
| H. `SUPERSEDED` (repository side) | **3** |

**Both sides reconcile exactly, with no residue:**

```
repository:  A 8 + B 53 + C 3 + E 1 + H 3 = 68 files
live      :  A 8 + B 53 + C 3         + F 5 = 69 rows
```

E contributes to the repository side only, which is what "unapplied" means.

Two movements since this table was recomputed, both on 2026-08-07:

- **B 52 → 53**, when `20260807150000_order_flow_health_card` was applied as
  live `20260807152347` (§25).
- **E 0 → 1**, when `20260807170000_order_flow_alert_condition` merged without
  being applied (§26). It returns to 0 and moves B to 54 when that file is
  applied with owner approval.

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
> **Class E was briefly empty on 2026-08-07 and now holds one file again.** It held the two rows added
> 2026-08-06 — `20260806120000_erasure_phone_normalization` (§22) and
> `20260806130000_admin_ranged_orders_and_stats` (§23) — which were applied on
> 2026-08-07 with explicit owner approval and are now class **B** (§24). It then
> briefly held `20260807150000_order_flow_health_card`, merged the same day and
> applied a few hours later, also class **B** (§25). The
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
| 56 | 20260729091000 | caller_can_read_order_anon_revoke | — | 20260729112238 | caller_can_read_order_anon_revoke | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Security hardening (not payment-specific)** — revokes `anon` EXECUTE on `public.caller_can_read_order(uuid)` while `authenticated` retains it, with a DO-block assertion. Closes the Supabase Security Advisor `anon_security_definer_function_executable` finding for that function. Shipped alongside row 55 in PR #112; applied 2026-07-29 (Wave C, §20). **Current latest live version** |

Reconciliation check: the rows above detail **56 repository / 57 live** rows.
That is a **subset**, not the whole picture — it predates the five
account-deletion migrations, the three applied 2026-08-05, the three applied
2026-08-07, and the `noop` probe.

**§4 is authoritative for totals** and reconciles the full set exactly:
`A 8 + B 53 + C 3 + E 1 + H 3 = 68` repository files, `A 8 + B 53 + C 3 + F 5 = 69`
live rows. The per-row table above has deliberately **not** been re-derived —
doing so is a mechanical expansion with no new information, and the counts it
would produce are already stated in §4.

**One repository-only/UNAPPLIED file exists** — `20260807170000_order_flow_alert_condition`
(§26), merged but not applied. The live-only F-class rows carry no repository
file; that part is a history divergence, not drift.

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

- **The order-flow alert condition is written but NOT YET APPLIED, so the gap is
  still live in Production.** Migration `20260807170000_order_flow_alert_condition`
  adds it (§26). Until an owner-approved apply lands, everything below still
  describes the running system. The alert engine derives its own fingerprints
  independently of the snapshot, so an `order_flow` card reading `failing` or
  `degraded` produces **no alert row at all**.

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

## 26. Pending migration: order-flow alert condition (class E — NOT APPLIED)

| | |
| --- | --- |
| Repository file | `20260807170000_order_flow_alert_condition.sql` |
| Class | **E** (`REPOSITORY_ONLY_UNAPPLIED`) |
| Live version | none — **not applied** |
| Closes | the §25 "still outstanding" gap |
| Approval to apply | **not yet given.** Owner approval is required (CLAUDE.md §5) |

> **Class E is no longer empty**, and §1, §4 and §6 were updated to say so the
> moment this file merged rather than at apply time. "Unapplied" is a fact about
> the repository, not the database, so deferring it would have left the ledger
> asserting "zero unapplied" while an unapplied file sat in the tree — the exact
> kind of confidently-wrong statement §25 was written to stop repeating.
>
> The algebra still reconciles because E contributes to the repository side only:
> `A 8 + B 53 + C 3 + E 1 + H 3 = 68 files` against
> `A 8 + B 53 + C 3 + F 5 = 69 rows`. Applying this file moves E to 0 and B to
> 54: the file total stays at **68**, and the row total rises to **70** because
> the apply stamps a fresh history row. Both sides still reconcile
> (`8+54+3+0+3 = 68`, `8+54+3+5 = 70`), which is the check that the counts are
> right in both states.

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

### How the body was produced

The function is 280 lines and had to be re-emitted whole. It was **not**
hand-transcribed — that is exactly the failure mode §24 recorded and §25 was
written to avoid. The body was extracted programmatically from
`20260723140000_operations_automation_cron_health.sql:881-1160`, the arm inserted
at a single anchor, and the result diffed against the original:

```
0 lines removed · 36 lines added · one hunk (158a159,194)
```

A **pure insertion**. No pre-existing line changed, so no other subsystem's
conditions could have shifted.

### Verification

Nine of the ten new cases in `supabase/tests/order_flow_alert_condition_test.sql`
were executed locally against a scratch PostgreSQL 16 database carrying the real
`operations_alerts_sanitize_evidence` / `safe_int` / `safe_bool` helpers; case 9
needs the full schema and runs in CI.

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

### Applying it

Ordinary §9 run-book, no special handling: `create or replace` only, zero write
statements, one function replaced in place, and the rollback is re-applying the
prior body (any open `order_flow:health` alert is then recovered by the
evaluator's normal resolution pass, so no manual cleanup). It needs explicit
owner approval like every other production apply.
