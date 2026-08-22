# Production migration application — 2026-08-22

> Companion record to `docs/MIGRATIONS.md`. That document remains the
> authoritative ledger; this file is the evidence for one application, in the
> same spirit as `docs/MIGRATION_RECONCILIATION_20260812.md`.

**Project:** `spicy-meal-ordering` (`wxfmmnihidsdyemasstf`)
**Repository base:** `0eeb66d` (squash-merge of PR #231) on `claude/project-build-ie4b56`
**Approval:** explicit owner approval in session, for **both** applications, given after the blocker in §2 was reported.

---

## 1. What was applied

Two migrations, via MCP `apply_migration`, one call per file, in this order.

| # | Repository file | Migration name | Applied version | Class |
| --- | --- | --- | --- | --- |
| 1 | `20260819120000_order_note_length_limit.sql` | `order_note_length_limit` | `20260822123620` | B |
| 2 | `20260821170000_order_item_notes.sql` | `order_item_notes` | `20260822123940` | B |

Ledger movement: **101 → 102 → 103** rows. Latest live version before the
application was `20260822115505` (`branch_availability_retention`).

Both are **class B**: `apply_migration` stamps an apply-time version that
differs from the repository filename. **§9-D version alignment was deliberately
NOT performed** — it is a separate live history write requiring its own explicit
owner approval.

## 2. The blocker the pre-live gate caught

The owner approved applying **one** migration: `order_item_notes`. Applying it
alone would have broken order placement in Production.

`order_item_notes` calls `public.order_note_normalized(text)` in all three write
paths (`place_order`, `compute_order_snapshot`, `insert_order_from_snapshot`)
and inside `enforce_order_item_note`. **That function did not exist in
Production** — a query for any function matching `%note%` returned zero rows.
It is defined by `20260819120000_order_note_length_limit`, which was in the
repository but had never been applied.

This would not have failed at apply time. **plpgsql resolves function calls at
RUNTIME, not at `create or replace` time**, so the migration would have reported
success and every subsequent order placement would have raised
`function public.order_note_normalized(text) does not exist`. The failure would
have appeared at the first customer order, not in the apply output.

Work stopped, the dependency was reported, and the owner approved both
applications in dependency order.

### Reconciliation at the time of the gate

Compared **by name**, because versions are apply-time stamps and filenames
cannot be compared directly:

- repository migration files on the default branch: **97**
- live `schema_migrations` rows: **101**
- **unapplied repository files: exactly 2** — `20260819120000_order_note_length_limit`
  and `20260821170000_order_item_notes`

Everything else was applied, including all fourteen migrations from PR #229
(`ops_roles_enum` … `branch_availability_health_card`, applied 2026-08-21
20:04–20:24) and `branch_availability_retention`.

## 3. Pre-live gate (§9-B) — all read-only

| Check | Value |
| --- | --- |
| `orders` rows / carrying a note | 40 / 4 |
| Longest existing order note | **14 characters** |
| Order notes exceeding 280 after trim | **0** |
| Order notes needing trimming | **0** |
| `checkout_sessions` rows / carrying a note | 6 / **0** |
| `order_items` rows | 65 |
| `order_items.note` column present | no |
| `order_note_normalized` present | **no** — see §2 |
| `trg_orders_note_length` / `trg_checkout_sessions_note_length` | absent / absent |
| `orders.notes` SELECT granted to `authenticated` | **no** |
| Combined fingerprint of the four redefined functions | `61b915175ac722d055e46a59c80b9c95` |

Because no existing row exceeded the bound or needed trimming, migration 1's
triggers rejected nothing and rewrote nothing.

### Drift check on every function `create or replace` would overwrite

`order_item_notes` redefines four functions with bodies copied from the
repository. If Production had drifted from the repository, applying it would
have **silently reverted** the live definitions — the same failure mode
described in the migration's own header, where a stale copy of `place_order`
nearly deleted PR #229's availability checks during a branch merge.

Each live body was measured against the repository migration that last defined
it. All four matched exactly:

| Function | Live body lines | Repository last-definer | Live md5 |
| --- | --- | --- | --- |
| `place_order` | 308 | `20260820140500` | `f70ae9312ea7cadfe8b336ac3480c811` |
| `compute_order_snapshot` | 173 | `20260712160000` | `f01287b722fc45e6d6fdd965c2c06fe1` |
| `insert_order_from_snapshot` | 78 | `20260712170000` | `f5c833d3a03a329e29d99bd4bc25f25d` |
| `admin_list_orders_with_items` | 56 | `20260806130000` | `97242ac5bfb580a78a3227728425cb76` |

Live `place_order` was additionally confirmed to contain the
`branch_modifier_availability` check and both lazy-expiry clauses before the
overwrite, and to still contain them afterwards (§5).

## 4. Verification after migration 1 (§9-E)

- `order_note_normalized`, `order_note_is_acceptable`, `enforce_order_note` all present.
- `trg_orders_note_length` and `trg_checkout_sessions_note_length` both installed.
- Normalizer behaviour, exercised live:
  - `'  no onion  '` → `'no onion'` (trimmed)
  - `'   '` → `NULL` (empty means none)
  - `'veg only'` → `'veg only'` — **the `\v` escape bug the migration header warns about does not occur**; the leading `v` survives
  - `chr(160) || 'x' || chr(160)` → `'x'` (NBSP trimmed)
- Bound: `NULL` acceptable, 280 acceptable, **281 rejected**.
- **Existing rows untouched**: still 4 orders carrying notes, longest still 14 characters.

## 5. Verification after migration 2 (§9-E)

| Check | Result |
| --- | --- |
| `order_items.note` column | present |
| `trg_enforce_order_item_note` | installed |
| `grant select (notes) on public.orders to authenticated` | present |
| `grant select (note) on public.order_items to authenticated` | present |
| Internal columns newly readable by `authenticated` | **0** (`order_number`, `customer_phone`, `pos_create_attempt_token`, `address_snapshot` all still refused) |
| Item-note bound: `NULL` / 140 / 141 | acceptable / acceptable / **rejected** |
| `place_order` retained `branch_modifier_availability` check | **yes** |
| `place_order` retained the modifier lazy-expiry clause | **yes** |
| `admin_list_orders_with_items` projects `'note', i.note` | yes |
| `place_order` EXECUTE re-granted to `authenticated` | **no** — ACL preserved by `create or replace`, as intended by `20260724200000` |
| `order_items` rows carrying a note | 0 (nothing backfilled) |

### The customer read path

The grants exist because PostgREST rejects an **entire** select when any named
column lacks a grant, rather than omitting that column. Every column the mobile
client asks for was confirmed readable by `authenticated`:

- `CUSTOMER_ORDER_COLUMNS` (16 columns incl. `notes`) — **0 missing**
- `CUSTOMER_ORDER_ITEM_COLUMNS` (incl. `note`) — **0 missing**
- `CUSTOMER_ORDER_MODIFIER_COLUMNS` — **0 missing**
- `orders.order_number` and `orders.customer_phone` — still **not** readable

### Advisors

**Security: zero ERROR-level findings.** No advisory names any object created by
either migration. Remaining findings are pre-existing WARN-level lints unrelated
to this change.

## 6. Not done

- **§9-D version alignment** — needs its own explicit owner approval.
- **§9-E step 5, application smoke test** — placing a real order carrying a
  per-item note, and reading it back on the receipt and in the staff console,
  requires a device and a signed-in account. **Not exercised.**
- **`docs/MIGRATIONS.md` §1 has not been updated.** Its headline still reads
  68 files / 70 rows dated 2026-08-07. See §8.

## 7. Rollback

Migration 2, then migration 1 (reverse order — migration 2 depends on
migration 1's normalizer):

```sql
-- order_item_notes
drop trigger if exists trg_enforce_order_item_note on public.order_items;
drop function if exists public.enforce_order_item_note();
drop function if exists public.order_item_note_is_acceptable(text);
revoke select (note)  on public.order_items from authenticated;
revoke select (notes) on public.orders      from authenticated;
-- the four functions revert by re-applying their previous definers:
--   place_order                  <- 20260820140500
--   compute_order_snapshot       <- 20260712160000
--   insert_order_from_snapshot   <- 20260712170000
--   admin_list_orders_with_items <- 20260806130000
-- dropping order_items.note is destructive and would discard customer
-- instructions; leave the column in place unless the owner decides otherwise.

-- order_note_length_limit
drop trigger if exists trg_checkout_sessions_note_length on public.checkout_sessions;
drop trigger if exists trg_orders_note_length on public.orders;
drop function if exists public.enforce_order_note();
drop function if exists public.order_note_is_acceptable(text);
drop function if exists public.order_note_normalized(text);
```

Revoking the two grants would restore the pre-application boundary, but it
breaks the merged mobile client, which now selects both columns.

## 8. Follow-up owed to `docs/MIGRATIONS.md`

§1 must be updated to reflect this application. The session that applied these
migrations could not edit it: `.claude/hooks/protect-default-branch.sh` fails
closed on an undeterminable branch, and its §5b recovery allowlist contains no
branch-creating command, so a detached HEAD denies every file write with no way
back. The replacement text is in the pull request that introduced this file.

Worth fixing separately: §5b recovers a detached HEAD from *rebase* state but
not from a plain detach, which is a reachable lockout.
