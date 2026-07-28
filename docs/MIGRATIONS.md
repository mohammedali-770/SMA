# Supabase Migrations — Authoritative History Ledger & Production Workflow

> **This document is the single source of truth for the relationship between
> the repository's `supabase/migrations/` files and the production project's
> `supabase_migrations.schema_migrations` history, and for the ONLY approved
> way to apply migrations to production.** It must be updated after every
> approved live migration application.

---

## 1. Purpose and production status

- Repository migration files: **52** (51 applied; the newest,
  `20260723140000_operations_automation_cron_health`, is the sole
  **repository-only and UNAPPLIED** file — not yet applied to Production — see §17)
- Live `schema_migrations` rows: **52**
- Latest live version: **`20260722165557`**
  (`activate_operations_alerts_digest_cron`; repository version `20260723120000`)
- **Every repository migration is applied EXCEPT the newest.** The
  operations-automation cron-health migration
  `20260723140000_operations_automation_cron_health` is repository-only and
  UNAPPLIED — no Production application is approved (§17). The three
  operations-automation migrations that shipped before it were all applied to
  Production on **2026-07-22** (owner-approved) via the `apply_migration`
  workflow, each **class B** (same reviewed content, generated apply-time
  version): the read-only **Operations Health Center**
  `20260722100000_operations_health_center` (PR #75, squash-merged `91c11b7`) →
  live **`20260722113923`** (§16); the **Smart Operations Alerts & Daily Digest**
  engine `20260723090000_smart_operations_alerts_digest` → live
  **`20260722143014`**; and its activation
  `20260723120000_activate_operations_alerts_digest_cron` → live
  **`20260722165557`** (the current latest live version). The Order Integrity
  Watchdog migration `20260721170000_order_integrity_watchdog` (PR #73,
  squash-merged `411c7c9`) was applied on **2026-07-22** → live
  **`20260722053151`** (§15); its observe-only cron `order-integrity-watchdog`
  (`*/2`) is active and healthy and the alert outbox stays **unsent** (no
  dispatcher). The activation migration created the internal-automation crons
  `operations-alerts-evaluator` (`*/5`) and `operations-digest-generator`
  (hourly) with external dispatch still **disabled**. The relationship between
  the **52 repository files** and the **52 live rows** remains a *history*
  divergence, not a *schema* divergence — the full class-by-class mapping is in
  §5; the sole repository-only/unapplied file is
  `operations_automation_cron_health` (§17), and the pre-existing live-only
  F-class history rows carry no repository file. The owner-approved 2026-07
  applications (all class B — same content, generated apply-time versions):
  - `20260721120000_lazywait_confirmation_lifecycle` → live **`20260721082325`**
    (owner-approved; PR #69)
  - `20260721130000_lazywait_synced_ref_guard` → live **`20260721084330`**
    (owner-approved; PR #70; version recorded in the migration file header)
  - `20260721150000_lazywait_sync_health_summary` → live **`20260721113811`**
    (owner-approved; PR #71; observability-only — see §14)
  - `20260721170000_order_integrity_watchdog` → live **`20260722053151`**
    (owner-approved; PR #73; observe-only monitoring — see §15)
  - `20260722100000_operations_health_center` → live **`20260722113923`**
    (owner-approved; PR #75; read-only Operations Health Center — see §16)
  - `20260723090000_smart_operations_alerts_digest` → live **`20260722143014`**
    (owner-approved; Smart Operations Alerts & Daily Digest engine)
  - `20260723120000_activate_operations_alerts_digest_cron` → live
    **`20260722165557`** (owner-approved; activation of the alerts/digest crons)
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
- **Post–Stage-4 applications.** Since the 2026-07-14 audit (§3, §10) further
  migrations were applied to Production; the current authoritative totals are the
  **52 repository / 52 live** stated at the top of this section, with the exact
  class-by-class algebra in §4 and §5. The applications included:
  - **Lazywait POS sync scheduler** — repository `20260720120000` → live
    `20260720075244`; owner-approved and applied via `apply_migration` on
    **2026-07-20**, verified (§13). Itemized in §5 (row 39) and §13.
  - **Lazywait confirmation lifecycle** (`20260721120000` → live
    `20260721082325`), **synced-ref guard**, **sync health summary**, **Order
    Integrity Watchdog**, **Operations Health Center**, **Smart Operations Alerts
    & Daily Digest**, and its **cron activation** — all owner-approved, applied
    2026-07-20…22, each class **B**, itemized in §5 (rows 40–46) and §14–§16.
  - **Five account-deletion migrations** — live versions `20260715120000`,
    `20260715130000`, `20260716160000`, `20260716170000`, `20260716180000`
    (repository files of the same names). Applied and live, but **not yet
    itemized/classified in §4/§5** — a known documentation gap to be reconciled in
    a **separate** documentation PR.
  The sole merged-but-UNAPPLIED repository file is
  `20260723140000_operations_automation_cron_health` (§17).

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
| B. `SAME_CONTENT_DIFFERENT_VERSION` | **38** |
| C. `SAME_NAME_DIFFERENT_CONTENT` | **3** |
| D. `SAME_VERSION_DIFFERENT_CONTENT` (version collision) | **0** |
| E. `REPOSITORY_ONLY_UNAPPLIED` | **1** |
| F. `LIVE_ONLY_MISSING_FROM_REPOSITORY` | **3** |
| H. `SUPERSEDED` / history-boundary differences (repository side) | **2** |

Classifications can overlap semantically in the detailed mapping (e.g. a
live-only row whose content was later consolidated into a repository file is
both "live-only" and "superseded-by-consolidation"); **each ledger entry below
carries exactly one primary classification**, with overlaps explained in its
notes.

> **Scope of these counts.** The table above itemizes the **47 repository / 47
> live** rows detailed in §5 (rows 1–47, through
> `20260723140000_operations_automation_cron_health`). Its per-class algebra is
> internally consistent: repository side 3 A + 38 B + 3 C + 2 H + 1 E = **47
> files**; live side 3 A + 38 B + 3 C + 3 F = **47 rows** (E is repository-only,
> F is live-only, and the 2 H repository files are superseded consolidations of
> live-only history). The **five account-deletion migrations** now live in
> Production (§1) are applied and live but **not yet itemized** here; adding them
> to both sides brings the true totals to the **52 repository / 52 live**
> authoritative production totals carried at the top of §1. The Lazywait sync
> scheduler (§5 row 39) is class **B** (`SAME_CONTENT_DIFFERENT_VERSION`):
> repository `20260720120000` vs. the apply-time live version `20260720075244`,
> same reviewed content; `20260721120000_lazywait_confirmation_lifecycle` (§5 row
> 40) is likewise **applied**, class B, live `20260721082325` — it is **not**
> unapplied.
>
> **Current class-E row.** The single `REPOSITORY_ONLY_UNAPPLIED` (E) row is now
> the operations-automation cron-health migration
> `20260723140000_operations_automation_cron_health` (§5 row 47) — **merged to the
> default branch** (commit `06c9bb0`) but not yet applied to Production (§17), and
> therefore contributing no live `schema_migrations` row. The read-only
> **Operations Health Center** `20260722100000_operations_health_center` (PR #75)
> is **no longer class E**: it was applied to Production on 2026-07-22 → live
> `20260722113923` as **class B** (same reviewed content, generated apply-time
> version), alongside the Smart Operations Alerts & Daily Digest engine
> (`20260723090000_smart_operations_alerts_digest` → `20260722143014`) and its
> activation (`20260723120000_activate_operations_alerts_digest_cron` →
> `20260722165557`). §1 carries the current authoritative production totals
> (52 repository / 52 live). See §5 and §16.

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

| 40 | 20260721120000 | lazywait_confirmation_lifecycle | — | 20260721082325 | lazywait_confirmation_lifecycle | = | B | ✔ verified live (`list_migrations` + live lifecycle objects in service) | CONFIRMED | none | high if `db push` | **Customer-visible POS confirmation lifecycle** (PR #69). Owner-approved; applied 2026-07-21 via MCP `apply_migration`; generated live version differs from the repository filename (class B, no §9-D alignment). No payment/cron/Vault change |
| 41 | 20260721130000 | lazywait_synced_ref_guard | — | 20260721084330 | lazywait_synced_ref_guard | = | B | ✔ verified live (`list_migrations`; version recorded in the migration file header) | CONFIRMED | none | high if `db push` | **Producer-side synced/usable-ref invariant guard** (PR #70). Owner-approved; applied 2026-07-21; redefines `record_lazywait_sync` only. No payment/cron/Vault change |
| 42 | 20260721150000 | lazywait_sync_health_summary | `0f4de301255c` | 20260721113811 | lazywait_sync_health_summary | = | B | ✔ verified live (function properties, grants, live output) | CONFIRMED | none | high if `db push` | **Service-role-only aggregate health summary for the lazywait-sync scheduler** (PR #71, squash `4c3d0bd…`). Owner-approved; applied **2026-07-21** via MCP `apply_migration` with the exact merged file content; observability-only (one new SECURITY DEFINER function; read-only over the ledger, `cron.job`, orders sync state). Full detail in §14 |
| 43 | 20260721170000 | order_integrity_watchdog | — | 20260722053151 | order_integrity_watchdog | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Observe-only order-integrity watchdog** (PR #73, squash `411c7c9`). Owner-approved; applied **2026-07-22** via MCP `apply_migration` with the exact merged content; generated live version differs from the repository filename (class B, no §9-D alignment). Observe-only cron `order-integrity-watchdog` (`*/2`) active; alert outbox populated but unsent. Full detail in §15 |
| 44 | 20260722100000 | operations_health_center | — | 20260722113923 | operations_health_center | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Read-only Operations Health Center** (PR #75, squash `91c11b7`; applied content SHA-256 `c86412dd…`, 33 198 bytes). Owner-approved; applied **2026-07-22** via MCP `apply_migration` with the exact merged content; generated live version differs from the repository filename (class B). Two staff-gated read-only functions only; no tables/cron/triggers. Full detail in §16 |
| 45 | 20260723090000 | smart_operations_alerts_digest | — | 20260722143014 | smart_operations_alerts_digest | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Smart Operations Alerts & Daily Digest engine.** Owner-approved; applied **2026-07-22** via MCP `apply_migration`; class B (generated live version differs from the repository filename). External dispatch remains disabled |
| 46 | 20260723120000 | activate_operations_alerts_digest_cron | — | 20260722165557 | activate_operations_alerts_digest_cron | = | B | ✔ verified live | CONFIRMED | none | high if `db push` | **Activation of the alerts/digest crons** — the current latest live version. Owner-approved; applied **2026-07-22** via MCP `apply_migration`; class B. Created internal crons `operations-alerts-evaluator` (`*/5`) and `operations-digest-generator` (hourly); external dispatch disabled |
| 47 | 20260723140000 | operations_automation_cron_health | — | — | — | — | **E** | — | CONFIRMED | apply pending | high if `db push` | **REPOSITORY-ONLY, UNAPPLIED.** Per-cadence staleness for the two internal-automation crons on the ops-health scheduled-jobs card. Reviewed and merged to the default branch; not yet applied to Production; no owner apply approval yet. Full detail in §17 |

Reconciliation check: the rows above detail **47 repository** rows
(3×A + 38×B + 3×C + 2×H + 1×E) and **47 live** rows (3×A + 38×B + 3×C + 3×F).
Adding the five applied-but-not-yet-itemized account-deletion migrations
(§1, §4 note) — present on both sides — yields the current production totals of
**52 repository / 52 live** recorded in §1 (47 + 5 repository; 47 + 5 live). The
sole repository-only/UNAPPLIED file is `operations_automation_cron_health`
(row 47, class E, §17); the pre-existing live-only F-class history rows carry no
repository file. This is a history divergence, not new drift.

## 6. Why `db push` is unsafe

Currently **eight** repository versions match live migration-history versions:
the three aligned July-14 migrations (`20260714070000`, `20260714090000`,
`20260714130000`) and the five account-deletion migrations (`20260715120000`,
`20260715130000`, `20260716160000`, `20260716170000`, `20260716180000`), whose
repository filenames were applied under matching version stamps. The Supabase
CLI compares by **version**, so it would still consider the remaining
**37 repository files** (45 − 8) unapplied and attempt to replay them against
production. Eight shared versions do **not** make `db push` any safer — the
permanent production prohibition stands, because **37 repository versions still
do not match live history** (including the intentionally-unapplied
`20260721120000_lazywait_confirmation_lifecycle`), content boundaries differ for
consolidated/split migrations, and replaying historical migrations against a live
database remains unsafe regardless. Risks:

- **historical replay** of the entire schema against a live database;
- **seed/data re-execution** (integration seeds, settings rows);
- **DO-block re-execution** (assertion/normalization blocks);
- **partial failure** mid-batch, leaving a half-applied, half-recorded state;
- **duplicate or misleading history rows** (37 junk records even on success);
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

**Ledger order.** Filename version `20260722100000` sorts strictly **after** every
currently applied migration, including its two runtime dependencies
`20260721150000_lazywait_sync_health_summary` (live `20260721113811`) and
`20260721170000_order_integrity_watchdog` (live `20260722053151`). A clean rebuild
from the repository applies it last, after both source functions exist.

**Purpose.** Adds a staff-gated, read-only Operations Health Center aggregate for
the Admin Dashboard. It composes the existing authoritative
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
The scheduled-jobs card observes exactly three allowlisted application jobs. Applying
this migration and any provider probe are separate future deliverables, each
requiring its own explicit owner approval.

## 17. Merged migration: Operations automation cron health (merged to default, UNAPPLIED to Production)

**Read-only observability. MERGED to the default branch, NOT applied to
Production.** Records the migration merged via the Issue #79 follow-up (commit
`06c9bb0`, PR #85); it is present in the repository but has **no** live
`schema_migrations` row. No Production application is approved — merge approval is
not apply approval (§2 rule 8).

- **Repository file:** `supabase/migrations/20260723140000_operations_automation_cron_health.sql`
- **PR:** Issue #79 follow-up — **merged** to `claude/project-build-ie4b56` (commit
  `06c9bb0`, PR #85); awaiting a separate owner-approved Production apply.
- **Live version:** none (UNAPPLIED). On a future owner-approved application this
  will be class **B** (same content; apply-time generated version differs from the
  repository filename version `20260723140000`), applied **only** via MCP
  `apply_migration` with the exact merged file content — never `db push` or
  `migration repair`.

**Ledger note.** The Operations Health Center (§16), the Smart Operations Alerts &
Daily Digest engine, and its activation migration are all merged and live in
Production; that reconciliation (**Issue #76**) is now **complete** — they are
itemized in §5 (rows 44–46, class B) and reflected in §1, §4 and §16. This §17
entry records the one operations-automation migration that remains repository-only
and UNAPPLIED: `20260723140000_operations_automation_cron_health` (§5 row 47,
class E).

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

**Dependencies (must exist at apply time).** The alerts/digest engine migration
(`operations_health_snapshot_internal`, `operations_alerts_derive`,
`operations_alerts_safe_bool`, `operations_alerts_sanitize_evidence`) and the
activation migration that schedules the two automation crons — all present in
Production today.

**Validation performed (repository / throwaway PG16 harness, not Production).**
`supabase/tests/operations_automation_cron_health_test.sql` (allowlist shape,
per-cadence boundaries, non-critical isolation of overall state, degraded/no-success
automation, critical-cron regression, derive severity-by-critical-flag, safe
projection) plus the updated `operations_health_center_test.sql` (5-job shape) and
`operations_alerts_digest_test.sql` (automation crons pinned healthy) suites.
Frontend gates: `tsc --noEmit`, vitest, `vite build`, mobile web build, mobile `tsc`.

**Rollback.** The feature is isolated and read-only. Before any application,
rollback is closing/reverting the PR. After a hypothetical application, re-apply the
prior definitions of the two functions from
`20260723090000_smart_operations_alerts_digest.sql` in a separate owner-approved
follow-up migration (never an edit of an applied file).
