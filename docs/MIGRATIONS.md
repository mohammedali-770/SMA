# Supabase Migrations — Authoritative History Ledger & Production Workflow

> **This document is the single source of truth for the relationship between
> the repository's `supabase/migrations/` files and the production project's
> `supabase_migrations.schema_migrations` history, and for the ONLY approved
> way to apply migrations to production.** It must be updated after every
> approved live migration application.

---

## 1. Purpose and production status

- Repository migration files: **44**
- Live `schema_migrations` rows: **45**
- Latest live version: **`20260720075244`**
  (`lazywait_sync_scheduler`; repository version `20260720120000`)
- The current production schema is **functionally aligned with the repository
  through `20260714130000`** — every repository migration, including the
  trigger-function grant hardening, is applied and verified — based on
  catalog/object-state verification (tables, columns, functions and exact
  signatures, SECURITY DEFINER/INVOKER state, pinned `search_path`, grants,
  RLS policies, triggers, indexes, storage bucket and policies, realtime
  publication membership). The grant hardening was **applied and verified on
  2026-07-14** (§10): PUBLIC/anon/authenticated EXECUTE removed from the
  three trigger-only functions, service_role EXECUTE retained, function and
  trigger definitions unchanged.
- **Historical version identifiers and several migration boundaries differ**
  between the repository and production. This is a *history* divergence, not a
  *schema* divergence. The full mapping is in §5.
- **Post–Stage-4 applications.** Since the 2026-07-14 audit (§3, §10) six
  further migrations were applied to production, taking the live count from 39
  to 45 and the repository count from 38 to 44:
  - **Lazywait POS sync scheduler** — repository `20260720120000` → live
    `20260720075244`; owner-approved and applied via `apply_migration` on
    **2026-07-20**, verified (§13). It is fully itemized in §5 (row 39) and §13.
  - **Five account-deletion migrations** — live versions `20260715120000`,
    `20260715130000`, `20260716160000`, `20260716170000`, `20260716180000`
    (repository files of the same names). These are applied and live but are
    **not yet itemized/classified in §4/§5** — a known documentation gap to be
    reconciled in a **separate** documentation PR (they are intentionally not
    detailed here so this PR stays scoped to the Lazywait scheduler activation).

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

| primary classification | count |
|---|---|
| A. `EXACT_MATCH` (version + name + content) | **3** |
| B. `SAME_CONTENT_DIFFERENT_VERSION` | **31** |
| C. `SAME_NAME_DIFFERENT_CONTENT` | **3** |
| D. `SAME_VERSION_DIFFERENT_CONTENT` (version collision) | **0** |
| E. `REPOSITORY_ONLY_UNAPPLIED` | **0** |
| F. `LIVE_ONLY_MISSING_FROM_REPOSITORY` | **3** |
| H. `SUPERSEDED` / history-boundary differences (repository side) | **2** |

Classifications can overlap semantically in the detailed mapping (e.g. a
live-only row whose content was later consolidated into a repository file is
both "live-only" and "superseded-by-consolidation"); **each ledger entry below
carries exactly one primary classification**, with overlaps explained in its
notes.

> **Scope of these counts.** The table above itemizes the **39 repository /
> 40 live** rows detailed in §5 (through the Lazywait sync scheduler, row 39).
> The five account-deletion migrations now live in production (§1) are **not
> yet itemized** here; adding them brings the true production totals to
> **44 repository / 45 live** (see §1 and §13). The Lazywait sync scheduler is
> class **B** (`SAME_CONTENT_DIFFERENT_VERSION`): repository `20260720120000`
> vs. the apply-time live version `20260720075244`, same reviewed content.

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
| 22 | 20260709140000 | payment_methods | `ee630dfd7d28` | 20260709111046 | payment_methods | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 23 | 20260710120000 | delivery_zones | `eab12cc0f3c1` | 20260709115813 | delivery_zones | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 24 | 20260710120100 | place_order_delivery_zone | `e63a1bfcba14` | 20260709151718 | place_order_delivery_zone | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical; recreates `place_order` (current live definition) |
| 25 | 20260710140000 | whatsapp_otp | `5b681f22d61f` | 20260709165615 | whatsapp_otp | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 26 | 20260710150000 | whatsapp_login | `86e2d67e4b6c` | 20260709174957 | whatsapp_login | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 27 | 20260710150100 | whatsapp_login_status_rpc | `ba23f23e2c9e` | 20260709175311 | whatsapp_login_status_rpc | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 28 | 20260710160000 | fix_whatsapp_login_review | `393db5b25757` | 20260709191229 | fix_whatsapp_login_review | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 29 | 20260710170000 | email_integration | `2994d9e5e98c` | 20260709203911 | email_integration | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 30 | 20260710180000 | lazywait_sync_one | `cf7f3fc5e851` | 20260710082112 | lazywait_sync_one | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 31 | 20260712120000 | tap_payments | `2f3d84f9b4b4` | 20260712070033 | tap_payments | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 32 | 20260712130000 | homepage_banners | `a4070f36bcfc` | 20260712121739 | homepage_banners | `16fe7e5659ff` | **C** | ✔ | POSSIBLE (draft-vs-commit variance) | none | high if `db push` | live row was applied from a marginally different draft (one policy/phrasing delta). Final live state verified: 5 table policies + 4 `banner-images` storage policies + public bucket + trigger |
| 33 | 20260712140000 | legal_documents | `0930fee9750d` | 20260712123717 | legal_documents | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 34 | 20260712160000 | checkout_sessions | `4295c6e9ca6d` | 20260712185657 | checkout_sessions | `d3e294e05a77` | **C** | ✔ | STRONGLY SUPPORTED | none | high if `db push` | repository file is a pre-commit **consolidation** of the live base apply plus the two live-only fix applies below (repository file contains the payment_status-cast fix markers). Checkout flow verified live incl. zero-total settlement |
| — | — | — | — | 20260712191643 | checkout_sessions_fix_payment_status_cast | `8639b171467f` | **F** | ✔ | STRONGLY SUPPORTED | none | n/a (live-only) | live-only fix; content folded into the repository's consolidated `checkout_sessions.sql` (also semantically SUPERSEDED-by-consolidation) |
| — | — | — | — | 20260712192526 | checkout_sessions_zero_total | `a62f0bfd577e` | **F** | ✔ | STRONGLY SUPPORTED | none | n/a (live-only) | live-only fix; content folded into the repository's consolidated `checkout_sessions.sql` (also semantically SUPERSEDED-by-consolidation) |
| 35 | 20260712170000 | checkout_sessions_hardening | `9f1d8844c9a7` | 20260713044036 | checkout_sessions_hardening | = | B | ✔ | CONFIRMED | none | high if `db push` | content-identical |
| 36 | 20260714070000 | support_contact | `f02603422918` | 20260714070000 | support_contact | = | **A** | ✔ | CONFIRMED | none | none (aligned) | applied 2026-07-14 via MCP `apply_migration`; version aligned to the repository filename by an approved single-row history write |
| 37 | 20260714090000 | push_notifications | `d686d8f6e428` | 20260714090000 | push_notifications | = | **A** | ✔ | CONFIRMED | none | none (aligned) | applied 2026-07-14 via MCP `apply_migration`; version aligned as above |
| 38 | 20260714130000 | trigger_function_execute_hardening | `dbd86ce8831e` | 20260714130000 | trigger_function_execute_hardening | = | **A** | ✔ verified live | CONFIRMED | none | none (aligned) | applied via `apply_migration` on 2026-07-14; originally recorded under generated version `20260714153905`, then separately aligned to `20260714130000` by an approved exact-one-row version update. Removed PUBLIC/anon/authenticated EXECUTE from the three trigger-only functions; the pre-existing explicit `service_role=X` ACL entry remained — it originates from Supabase's platform **default function privileges** applied at creation (CONFIRMED in `pg_default_acl`: postgres-owned functions default-grant EXECUTE to anon/authenticated/service_role), NOT from any live-only grant, so it is not production drift and reproduces identically in any environment built from these repository migrations; function bodies and trigger definitions unchanged |
| 39 | 20260720120000 | lazywait_sync_scheduler | `26b85de4256e` | 20260720075244 | lazywait_sync_scheduler | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Lazywait POS sync pg_cron driver + durable run ledger.** Owner-approved; applied **2026-07-20** via MCP `apply_migration` (exact merged content from PR #67, squash `c6579e6…`); generated apply-time live version `20260720075244` — **not** version-aligned (repository filename version `20260720120000` differs; no §9-D write performed). Verified live objects: `public.lazywait_sync_requests`, `public.lazywait_sync_cron_health`, `public.invoke_lazywait_sync_processor()`, cron job `lazywait-sync` (jobid 2, `* * * * *`, active). No payment/order-intake/worker/payload/delivery/POS change. Full detail in §13 |

Reconciliation check: the rows above detail **39 repository** rows
(3×A + 31×B + 3×C + 2×H) and **40 live** rows (3×A + 31×B + 3×C + 3×F).
Adding the five applied-but-not-yet-itemized account-deletion migrations
(§1, §4 note) yields the true production totals of **44 repository / 45 live**
recorded in §1.

## 6. Why `db push` is unsafe

Currently **eight** repository versions match live migration-history versions:
the three aligned July-14 migrations (`20260714070000`, `20260714090000`,
`20260714130000`) and the five account-deletion migrations (`20260715120000`,
`20260715130000`, `20260716160000`, `20260716170000`, `20260716180000`), whose
repository filenames were applied under matching version stamps. The Supabase
CLI compares by **version**, so it would still consider the remaining
**36 repository files** (44 − 8) unapplied and attempt to replay them against
production. Eight shared versions do **not** make `db push` any safer — the
permanent production prohibition stands, because **36 repository versions still
do not match live history**, content boundaries differ for consolidated/split
migrations, and replaying historical migrations against a live database remains
unsafe regardless. Risks:

- **historical replay** of the entire schema against a live database;
- **seed/data re-execution** (integration seeds, settings rows);
- **DO-block re-execution** (assertion/normalization blocks);
- **partial failure** mid-batch, leaving a half-applied, half-recorded state;
- **duplicate or misleading history rows** (36 junk records even on success);
- **incorrect skip/replay behavior around consolidated migrations** — the
  repository's `checkout_sessions.sql` and the loyalty-era files do not map
  1:1 onto live rows, so no version-based comparison can treat them correctly.

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
  applied via MCP `apply_migration`, and verified — see §13. Current documented
  live migration count: **45**; current documented latest live version:
  **`20260720075244`**. Repository base (default branch) for the live
  operation: **`c6579e6414106abb6940ea4a19e789fec9754c04`**. The five
  account-deletion migrations applied after Stage 4 remain to be itemized in
  §4/§5 (documentation gap; see §1).
- This ledger records the state as of the **2026-07-20** update. It **must be
  updated after every approved live migration application** (new §5 row +
  fingerprints recorded), and re-validated if any tooling other than the §9
  workflow ever touches `schema_migrations`.
- **Expected classification of a newly applied migration.** **Class B**
  (`SAME_CONTENT_DIFFERENT_VERSION`) is the normal, expected result immediately
  after `apply_migration`, because the tool stamps a **generated apply-time
  version** that differs from the repository filename version — this is exactly
  what happened for the Lazywait scheduler (repo `20260720120000` → live
  `20260720075244`, §5 row 39 / §13). **Class A** (`EXACT_MATCH`) applies **only**
  when the live version already exactly equals the repository version, or after a
  **separate, explicitly owner-approved §9-D version-alignment** write changes the
  live version to match. Applying a migration **never** requires, implies, or
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
- **Live migration count after completion:** **45** (see §1).
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
