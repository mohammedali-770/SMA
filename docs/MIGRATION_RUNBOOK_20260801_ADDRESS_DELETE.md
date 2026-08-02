# Run-book — applying the two address-deletion migrations

> **Status: NOT APPLIED anywhere.** Both files are merged to the default branch
> and applied to no environment. Nothing in this document has been executed.
>
> This is an *owner-executed* run-book. It exists because the agent sessions
> that wrote these migrations can neither run the SQL harness (no Docker, no
> local Postgres) nor reach `apply_migration`. Every command below is for a
> human with production access to run, in order, stopping at the first
> surprise.

Migrations covered, in apply order:

| # | File | What it changes |
| --- | --- | --- |
| 1 | `supabase/migrations/20260801120000_address_single_default.sql` | One default address per customer, enforced server-side |
| 2 | `supabase/migrations/20260801120100_checkout_session_address_fk_set_null.sql` | `checkout_sessions.address_id` FK → `ON DELETE SET NULL`, plus a BEFORE DELETE guard |

Repository base: `e3130a2c1695bd14e75902845428cd863a05cbb3`.

This follows [`docs/MIGRATIONS.md`](MIGRATIONS.md) §9 (A → E) and does not
replace it. §2's non-negotiable rules apply in full: no `db push`, no
`migration repair`, no editing applied migrations, and **each live application
needs its own explicit owner approval — merge approval is not apply approval**.

---

## 0. Why these two go together

Migration 2 is the one that matters to customers: today a saved address that
has *ever* backed an online checkout can never be deleted, because
`checkout_sessions.address_id` references `addresses(id)` with no `ON DELETE`
action and session rows are kept forever. The customer sees a permanent
failure on a button that looks like it should work.

Relaxing that FK alone would open a worse hole, which is why migration 2 also
installs a guard. `insert_order_from_snapshot` **inserts**
`snapshot->>'address_id'` into `public.orders.address_id`, itself a live FK.
`ON DELETE SET NULL` governs *parent deletion*; it does not permit inserting a
dangling child reference. So without the guard, deleting an address mid-checkout
could leave a **captured payment that can never become an order** — invisible to
the watchdog. The guard refuses deletion only while a session for that address
is still convertible (`order_id IS NULL` and status in
`pending_payment`/`expired`), and exempts non-`authenticated` callers so
`anonymize_account_data` — which deletes addresses *before* sessions — still
works.

Migration 1 is ordered first because the app's address book relies on the
single-default invariant that migration 1 enforces, and its one-time
normalisation is easiest to reason about before the delete path changes.

### Known limitation, accepted deliberately

An **abandoned or declined** online checkout keeps its address undeletable by
the customer, because nothing in the schema ever writes `status = 'cancelled'`
and no reaper clears dead sessions. This is strictly better than today, where
*every* address that ever backed a checkout is undeletable forever. Closing it
properly needs a session-cancellation transition in the payment state machine,
which is frozen under `CLAUDE.md` §6. Do not attempt to narrow the guard to
work around this — every narrowing reopens the captured-payment hole above.

---

## Step 0 — run the SQL harness (PG16). **Gate: do not proceed if anything fails.**

These suites were written and reviewed but **have never been executed**. This is
the single most important step in this document.

```bash
# From a clean checkout of the default branch, against a scratch PG16.
createdb sma_migration_check

# Full migration chain, in filename order, on an empty database.
for f in supabase/migrations/*.sql; do
  echo "--- $f"
  psql -v ON_ERROR_STOP=1 -d sma_migration_check -f "$f" || { echo "CHAIN FAILED at $f"; break; }
done

# The two suites for this change.
psql -v ON_ERROR_STOP=1 -d sma_migration_check -f supabase/tests/address_single_default_test.sql
psql -v ON_ERROR_STOP=1 -d sma_migration_check -f supabase/tests/checkout_session_address_fk_test.sql
```

`checkout_session_address_fk_test.sql` covers 12 cases including: deleting an
address NULLs `checkout_sessions.address_id`; the session's `snapshot` JSONB is
byte-identical afterwards; another customer cannot delete someone else's
address; and the live-checkout guard refuses with SQLSTATE `55006`. Its
permitted-delete cases run as the real `authenticated` role, so they exercise
RLS rather than bypassing it. `address_single_default_test.sql` covers 8 cases.

**Also re-run the chain twice** on the same database to prove idempotence — both
migrations are written to be safe on a clean *and* an already-migrated database,
and a second pass must be a no-op:

```bash
psql -v ON_ERROR_STOP=1 -d sma_migration_check -f supabase/migrations/20260801120000_address_single_default.sql
psql -v ON_ERROR_STOP=1 -d sma_migration_check -f supabase/migrations/20260801120100_checkout_session_address_fk_set_null.sql
# Expect: NOTICE 'checkout_sessions.address_id already ON DELETE SET NULL; no change'
```

If any case fails, **stop**. Do not apply. Report the failure.

---

## Step 1 — §9-B pre-live gate (read-only, run against Production)

Every query here is a `SELECT`. Record the output; several are the before-state
fingerprints §9-B.6 requires.

### 1.1 Confirm the FK is still in its old state

```sql
select c.conname,
       c.confdeltype,      -- expect 'a'  (NO ACTION)  -- 'n' means already applied
       c.confupdtype,      -- record verbatim; migration must preserve it
       c.confmatchtype,    -- record verbatim
       c.condeferrable,
       c.condeferred
  from pg_constraint c
 where c.conrelid = 'public.checkout_sessions'::regclass
   and c.contype  = 'f'
   and c.confrelid = 'public.addresses'::regclass;
```

If `confdeltype` is already `'n'`, migration 2 has been applied — **stop and
re-read the ledger** rather than applying again.

### 1.2 Confirm `address_id` nullability

```sql
select attnotnull        -- expect false; if true the migration will DROP NOT NULL
  from pg_attribute
 where attrelid = 'public.checkout_sessions'::regclass
   and attname  = 'address_id'
   and not attisdropped;
```

### 1.3 How much the single-default normalisation will touch

Migration 1 opens with a one-time `UPDATE` that keeps the **oldest** default per
customer (`order by created_at, id`) and demotes the rest. This tells you how
many rows that will be, before it happens:

```sql
select count(*) as customers_with_multiple_defaults
  from (select customer_id
          from public.addresses
         where is_default
         group by customer_id
        having count(*) > 1) t;

-- The exact rows that will be demoted:
with ranked as (
  select id, customer_id, created_at,
         row_number() over (partition by customer_id order by created_at, id) as rn
    from public.addresses
   where is_default
)
select id, customer_id, created_at from ranked where rn > 1 order by customer_id;
```

**Save that row list.** It is the rollback input for migration 1's data change
and the only record of which addresses were demoted.

### 1.4 Snapshot fingerprint — the thing that must not change

```sql
select count(*)                                   as sessions,
       count(address_id)                          as with_address_pointer,
       md5(string_agg(id::text || coalesce(snapshot::text, ''), '|' order by id))
                                                  as snapshot_fingerprint
  from public.checkout_sessions;
```

Record `snapshot_fingerprint`. §9-E re-runs this; it **must be identical**.
Migration 2 changes a pointer column's delete behaviour and touches no session
row.

### 1.5 Sessions the new guard would currently block

```sql
select count(*) as blocking_sessions,
       count(distinct address_id) as addresses_affected
  from public.checkout_sessions
 where address_id is not null
   and order_id is null
   and status in ('pending_payment', 'expired');
```

These are the addresses that remain undeletable after the change (the known
limitation above). Expect a small number; a large number is worth understanding
before proceeding.

### 1.6 Ledger position

```sql
select count(*) as migration_rows,
       max(version) as latest_version
  from supabase_migrations.schema_migrations;
```

---

## Step 2 — §9-C apply

Apply **exactly the merged file content**, one migration per `apply_migration`
call, nothing added or removed, in this order:

1. `20260801120000_address_single_default`
2. `20260801120100_checkout_session_address_fk_set_null`

No `db push`. No batch replay. No unrelated SQL in the same operation.

Migration 2 does its drop-and-recreate of the constraint **under the same name,
inside one transaction**, so the DDL lock is held throughout and no write can
slip past an absent constraint. It locates the constraint by catalog lookup
rather than by hardcoded name, because the name was generated by the inline
`CREATE TABLE`, and it reproduces the recorded `confupdtype`, `confmatchtype`
and deferrability verbatim — compare against what you recorded in 1.1.

Expect these notices on a database that has not had it applied:

```
NOTICE:  dropping NOT NULL on checkout_sessions.address_id  (only if 1.2 returned true)
```

and on a re-run:

```
NOTICE:  checkout_sessions.address_id already ON DELETE SET NULL; no change
```

---

## Step 3 — §9-D version alignment (**separate approval**)

`apply_migration` stamps an apply-time version that differs from the repository
filename. Aligning it is a **separate live history write needing its own
explicit owner approval** (§9-D, §2.4). If you do it:

- it must affect **exactly one row**;
- identify the row by **name + generated version + SQL fingerprint together**,
  never by name alone;
- abort if more or fewer than one row matches;
- never perform broad history repair.

Skipping this step is fine. It leaves a class-B entry, which is what most of
the ledger already looks like.

---

## Step 4 — §9-E verification (run against Production)

### 4.1 Migration 1 delivered exactly what it promised

```sql
-- Function, trigger, index all present.
select to_regprocedure('public.enforce_single_default_address()') is not null as fn_exists;

select tgname, tgenabled
  from pg_trigger
 where tgrelid = 'public.addresses'::regclass
   and tgname  = 'trg_addresses_single_default';

select indexdef
  from pg_indexes
 where schemaname = 'public'
   and indexname  = 'addresses_one_default_per_customer';

-- The invariant now holds. Expect 0.
select count(*) as customers_still_with_multiple_defaults
  from (select customer_id from public.addresses
         where is_default group by customer_id having count(*) > 1) t;
```

### 4.2 Migration 2 delivered exactly what it promised

```sql
-- confdeltype must now be 'n'; every other property must match what 1.1 recorded.
select c.conname, c.confdeltype, c.confupdtype, c.confmatchtype,
       c.condeferrable, c.condeferred
  from pg_constraint c
 where c.conrelid  = 'public.checkout_sessions'::regclass
   and c.contype   = 'f'
   and c.confrelid = 'public.addresses'::regclass;

-- Still referencing the same table and column.
select confrelid::regclass as referenced_table,
       (select attname from pg_attribute
         where attrelid = c.confrelid and attnum = c.confkey[1]) as referenced_column
  from pg_constraint c
 where c.conrelid = 'public.checkout_sessions'::regclass and c.contype = 'f'
   and c.confrelid = 'public.addresses'::regclass;

-- Guard function, trigger and supporting index.
select to_regprocedure('public.guard_address_delete_live_checkout()') is not null as guard_exists;

select tgname from pg_trigger
 where tgrelid = 'public.addresses'::regclass
   and tgname  = 'trg_addresses_guard_live_checkout';

select indexdef from pg_indexes
 where schemaname = 'public' and indexname = 'checkout_sessions_address_idx';
```

### 4.3 Snapshots and sessions are untouched — **the important one**

```sql
select count(*)                                   as sessions,
       count(address_id)                          as with_address_pointer,
       md5(string_agg(id::text || coalesce(snapshot::text, ''), '|' order by id))
                                                  as snapshot_fingerprint
  from public.checkout_sessions;
```

`sessions` and `snapshot_fingerprint` **must equal** the values from 1.4. Only
`with_address_pointer` may drift later, and only as customers delete addresses.
If the fingerprint moved, something wrote to a session row — investigate before
going further.

### 4.4 Ledger and advisors

```sql
select count(*) as migration_rows, max(version) as latest_version
  from supabase_migrations.schema_migrations;
```

Then run the Security and Performance Advisors (§9-E.4) and application smoke
tests (§9-E.5).

> §9-E.7: **verify writes in a separate statement.** A data-modifying CTE is
> not visible to sibling `SELECT`s in the same statement, so reading back inline
> can report a successful write as absent. This bit the 2026-07-29 wave (§20).

### 4.5 Application smoke test

In the mobile app, signed in as a real customer:

1. Add two addresses; make the second default. The first must stop being
   default (migration 1's trigger).
2. Delete an address that has never backed a checkout → succeeds.
3. Delete an address whose only checkout **completed** → succeeds, and the
   session row survives with `address_id` NULL and its snapshot intact.
4. Delete an address with a live `pending_payment` session → refused with the
   *"A checkout you started still uses this address…"* message, **not** the
   generic constraint error. That distinction is SQLSTATE `55006` vs `23503`
   and is what tells you the guard fired rather than a raw FK.

---

## Step 5 — rollback

Both migrations carry their rollback in a trailing comment block. Reproduced
here so it is in one place.

### Migration 2

```sql
drop index  if exists public.checkout_sessions_address_idx;
drop trigger if exists trg_addresses_guard_live_checkout on public.addresses;
drop function if exists public.guard_address_delete_live_checkout();
```

To restore the original FK behaviour, recreate the constraint with the
`confupdtype` / `confmatchtype` / deferrability you recorded in 1.1 and
`ON DELETE NO ACTION`. **Restore the FK before dropping the guard**, not after:
between the two states there is a window where deletion is permitted and
unguarded, which is precisely the captured-payment hole.

### Migration 1

```sql
drop index    if exists public.addresses_one_default_per_customer;
drop trigger  if exists trg_addresses_single_default on public.addresses;
drop function if exists public.enforce_single_default_address();
```

The one-time normalisation is **data**, not schema, and dropping these objects
does not undo it. To restore demoted rows, use the id list saved in 1.3:

```sql
update public.addresses set is_default = true where id in (/* ids from 1.3 */);
```

Note this reintroduces multiple defaults per customer, which the app does not
expect. Only do it as part of a full revert.

---

## Step 6 — update the ledger

[`docs/MIGRATIONS.md`](MIGRATIONS.md) §1 currently states *"every repository
migration is applied to Production. There are no unapplied migration files."*
That has been untrue since PR #142 merged — these two files are class **E**.
After applying, update:

- §1's counts and "latest live version";
- §5's row-by-row mapping with the generated apply-time versions;
- a new completed-migration section in the §10-style format, recording the
  before/after fingerprints from 1.4 and 4.3 and the guard's accepted
  limitation.
