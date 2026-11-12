#!/usr/bin/env bash
#
# Existing-data stage: apply this change's migrations to a database that
# ALREADY HOLDS ROWS, and check what they did to them.
#
# WHY THIS EXISTS. run.sh replays the chain onto an EMPTY database and loads the
# seed afterwards, so every backfill in the chain has only ever run against
# empty tables. A migration that fails on existing rows, or rewrites them
# wrongly, passed CI. Measured on 2026-11-11: with 20260801120000's
# normalization mutated to demote EVERY default address (`r.rn > 0`), the whole
# CI-shaped run stayed green, because the suite that re-tests that backfill runs
# its own copy of the SQL rather than the migration file.
#
# WHAT IT DOES
#   1. Picks the change's migrations: the files this commit ADDS under
#      supabase/migrations (git diff --diff-filter=A HEAD^1 HEAD). With none
#      added, it re-applies the newest file, so the stage keeps exercising
#      itself on every run. SQL_CI_NEW_MIGRATIONS (space-separated file names)
#      overrides both, for a local run.
#   2. Builds a database from bootstrap.sql and every OTHER migration, in order:
#      the schema as it stood before the change.
#   3. Loads supabase/seed.sql and existing-data.sql, each from the base
#      revision when the base has it (the rows that exist before a change were
#      written by the code before it). existing-data.sql writes through the auth
#      trigger, RLS and the real RPCs.
#   4. Fingerprints every public table (row count and a digest over the columns
#      that existed before), applies the change's files ONE TRANSACTION EACH, in
#      order, and fingerprints again.
#   5. Asserts the invariants below, runs a place-and-settle smoke through the
#      migrated RPCs, and prints the fingerprint diff.
#
# INVARIANTS (any failure makes this script exit 1)
#   - every file of the change applies;
#   - no NOT VALID constraint is added (an unvalidated constraint is a check
#     that existing rows were never held to);
#   - no row of profiles, addresses, orders, order_items, loyalty_transactions
#     or push_devices disappears;
#   - every customer who had a default address still has exactly one;
#   - each profile's balance equals its ledger (every row except earn_pending,
#     which records a promise rather than a movement);
#   - at most one `earn` row per order;
#   - a customer can still place an order, and an administrator can still take
#     it to delivered, and both invariants above still hold afterwards.
#
# REPORT-ONLY IN CI for now: run.sh prints the result and a warning, and does
# not fail on it unless SQL_CI_EXISTING_DATA_BLOCKING=1. See run.sh.
#
# Like run.sh, this needs a disposable Postgres and must never point at
# Production. It creates and drops one database, named below.

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIGRATIONS_DIR="$ROOT/supabase/migrations"

EXISTING_DB="sma_existing_data"

WORK="$(mktemp -d)"
cleanup() {
  dropdb --if-exists "$EXISTING_DB" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

psql_on() { psql -X -q -v ON_ERROR_STOP=1 --no-align --tuples-only -d "$1" "${@:2}"; }

ok()   { printf '  \033[32mok\033[0m    %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; failures=$((failures + 1)); }
info() { printf '        %s\n' "$*"; }

failures=0

# ---------------------------------------------------------------------------
# 1. Which files are the change?
# ---------------------------------------------------------------------------
mapfile -t ALL < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' -printf '%f\n' | sort)

base_rev=""
if git -C "$ROOT" rev-parse -q --verify 'HEAD^1' >/dev/null 2>&1; then
  base_rev="$(git -C "$ROOT" rev-parse 'HEAD^1')"
fi

NEW=()
if [ -n "${SQL_CI_NEW_MIGRATIONS:-}" ]; then
  read -r -a NEW <<<"$SQL_CI_NEW_MIGRATIONS"
  chosen_by="SQL_CI_NEW_MIGRATIONS"
elif [ -n "$base_rev" ]; then
  mapfile -t NEW < <(git -C "$ROOT" diff --name-only --diff-filter=A "$base_rev" HEAD -- supabase/migrations \
    | grep -E '^supabase/migrations/[^/]+\.sql$' | xargs -r -n1 basename | sort)
  chosen_by="files this commit adds (against ${base_rev:0:12})"
fi
if [ "${#NEW[@]}" -eq 0 ]; then
  NEW=("${ALL[-1]}")
  chosen_by="no migration added, so the newest file is re-applied"
fi

for f in "${NEW[@]}"; do
  if [ ! -f "$MIGRATIONS_DIR/$f" ]; then
    printf '  \033[31mFAIL\033[0m  %s is not a file in supabase/migrations\n' "$f"
    exit 1
  fi
done

is_new() { local x; for x in "${NEW[@]}"; do [ "$x" = "$1" ] && return 0; done; return 1; }

printf '  change     : %s\n' "$chosen_by"
for f in "${NEW[@]}"; do info "$f"; done

# A file from the base revision when it has one, else from the working tree.
from_base() {
  local path="$1" out="$2"
  if [ -n "$base_rev" ] && git -C "$ROOT" cat-file -e "$base_rev:$path" 2>/dev/null; then
    git -C "$ROOT" show "$base_rev:$path" >"$out"
    echo "base ${base_rev:0:12}"
  else
    cp "$ROOT/$path" "$out"
    echo "working tree"
  fi
}

# ---------------------------------------------------------------------------
# 2. The schema before the change.
# ---------------------------------------------------------------------------
dropdb --if-exists "$EXISTING_DB" >/dev/null 2>&1
createdb "$EXISTING_DB"
if ! psql_on "$EXISTING_DB" -f "$HERE/bootstrap.sql" >/dev/null 2>"$WORK/err"; then
  bad "bootstrap.sql did not load"
  sed 's/^/        /' "$WORK/err"
  exit 1
fi

before_count=0
for f in "${ALL[@]}"; do
  is_new "$f" && continue
  if ! psql_on "$EXISTING_DB" -f "$MIGRATIONS_DIR/$f" >/dev/null 2>"$WORK/err"; then
    bad "the schema before the change did not build: $f"
    sed 's/^/        /' "$WORK/err"
    exit 1
  fi
  before_count=$((before_count + 1))
done
ok "schema before the change: bootstrap + $before_count migrations"

# ---------------------------------------------------------------------------
# 3. Rows, written the way production writes them.
# ---------------------------------------------------------------------------
for spec in "supabase/seed.sql:seed" ".github/sql-ci/existing-data.sql:existing-data"; do
  path="${spec%%:*}"
  name="${spec##*:}"
  where="$(from_base "$path" "$WORK/$name.sql")"
  if ! psql_on "$EXISTING_DB" -f "$WORK/$name.sql" >/dev/null 2>"$WORK/err"; then
    bad "$path ($where) did not load onto the schema before the change"
    sed 's/^/        /' "$WORK/err"
    exit 1
  fi
  ok "$path ($where)"
done

# ---------------------------------------------------------------------------
# 4. Fingerprint, apply, fingerprint.
#
# The snapshot lives in its own schema in this throwaway database. The digest
# covers only the columns that existed BEFORE the change, so adding a column is
# not reported as rewriting every row — but changing a value in an old column
# is.
# ---------------------------------------------------------------------------
psql_on "$EXISTING_DB" >/dev/null <<'SQL'
create schema sql_ci_existing;

create table sql_ci_existing.columns_before as
  select c.table_name::text as table_name,
         array_agg(c.column_name::text order by c.ordinal_position) as cols
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
   group by c.table_name;

create table sql_ci_existing.fingerprint (
  phase text, table_name text, row_count bigint, digest text,
  primary key (phase, table_name)
);

create function sql_ci_existing.take(p_phase text) returns void
language plpgsql as $$
declare r record; v_cols text; v_n bigint; v_d text;
begin
  for r in select table_name, cols from sql_ci_existing.columns_before loop
    if to_regclass(format('public.%I', r.table_name)) is null then
      continue;
    end if;
    select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position)
      into v_cols
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = r.table_name
       and c.column_name = any (r.cols);
    v_cols := coalesce(v_cols, 'null'); -- every old column dropped
    execute format(
      'select count(*), coalesce(md5(string_agg(x, E''\n'' order by x)), ''-'')
         from (select row(%s)::text as x from public.%I) s', v_cols, r.table_name)
      into v_n, v_d;
    insert into sql_ci_existing.fingerprint values (p_phase, r.table_name, v_n, v_d);
  end loop;
end $$;

create table sql_ci_existing.not_valid_before as
  select conrelid::regclass::text as rel, conname::text
    from pg_constraint
   where not convalidated and connamespace = 'public'::regnamespace;

create table sql_ci_existing.default_holders_before as
  select distinct customer_id from public.addresses where is_default;

select sql_ci_existing.take('before');
SQL

applied=0
for f in "${NEW[@]}"; do
  if psql_on "$EXISTING_DB" -1 -f "$MIGRATIONS_DIR/$f" >/dev/null 2>"$WORK/err"; then
    ok "applied onto existing rows: $f"
    applied=$((applied + 1))
  else
    bad "did not apply onto existing rows: $f"
    sed 's/^/        /' "$WORK/err"
    break
  fi
done
psql_on "$EXISTING_DB" -c "select sql_ci_existing.take('after')" >/dev/null

# ---------------------------------------------------------------------------
# 5. Invariants. Each query returns one line per offence.
# ---------------------------------------------------------------------------
# `check` only prints; the caller counts the FAIL lines. That lets the same
# invariants run twice (before and after the smoke) without counting a failure
# twice, and lets the second run report only what the smoke itself broke.
check() {
  local label="$1" sql="$2" out
  if ! out="$(psql_on "$EXISTING_DB" -c "$sql" 2>&1)"; then
    printf '  FAIL  %s — the check itself failed\n' "$label"
    printf '%s\n' "$out" | sed 's/^/        /'
  elif [ -n "$out" ]; then
    printf '  FAIL  %s\n' "$label"
    printf '%s\n' "$out" | sed 's/^/        /'
  else
    printf '  ok    %s\n' "$label"
  fi
}

invariants() {
  check "no NOT VALID constraint added" "
    select format('%s.%s is NOT VALID', conrelid::regclass, conname)
      from pg_constraint
     where not convalidated and connamespace = 'public'::regnamespace
       and (conrelid::regclass::text, conname::text) not in
           (select rel, conname from sql_ci_existing.not_valid_before)"

  check "no business row disappeared" "
    select format('%s: %s rows before, %s after', b.table_name, b.row_count, coalesce(a.row_count, 0))
      from sql_ci_existing.fingerprint b
      left join sql_ci_existing.fingerprint a on a.phase = 'after' and a.table_name = b.table_name
     where b.phase = 'before'
       and b.table_name in ('profiles', 'addresses', 'orders', 'order_items',
                            'loyalty_transactions', 'push_devices')
       and coalesce(a.row_count, 0) < b.row_count"

  check "every customer who had a default address has exactly one" "
    select format('customer %s now has %s default addresses', h.customer_id, count(a.id))
      from sql_ci_existing.default_holders_before h
      left join public.addresses a on a.customer_id = h.customer_id and a.is_default
     group by h.customer_id
    having count(a.id) <> 1"

  check "every balance equals its ledger" "
    select format('%s: balance %s, ledger %s', p.id, p.loyalty_points, coalesce(sum(l.points), 0))
      from public.profiles p
      left join public.loyalty_transactions l on l.profile_id = p.id and l.type <> 'earn_pending'
     group by p.id, p.loyalty_points
    having p.loyalty_points <> coalesce(sum(l.points), 0)"

  check "at most one earn per order" "
    select format('order %s has %s earn rows', order_id, count(*))
      from public.loyalty_transactions
     where type = 'earn' and order_id is not null
     group by order_id
    having count(*) > 1"
}

if [ "$applied" -eq "${#NEW[@]}" ]; then
  invariants >"$WORK/invariants"
  cat "$WORK/invariants"
  failures=$((failures + $(grep -c '^  FAIL' "$WORK/invariants" || true)))

  # The smoke: a new order through the migrated RPCs, settled by an admin.
  if psql_on "$EXISTING_DB" >"$WORK/smoke" 2>"$WORK/err" <<'SQL'
begin;
select set_config('request.jwt.claims',
  '{"sub":"0e000000-0000-0000-0000-00000000000c","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select public.place_customer_order(
  'b0000000-0000-0000-0000-000000000001', 'pickup',
  '[{"product_id":"a0000000-0000-0000-0000-000000000003","quantity":1}]'::jsonb,
  null, null, null, 0, '0e100000-0000-0000-0000-0000000000c9', 'cash') ->> 'id' as smoke_order \gset
commit;

begin;
select set_config('request.jwt.claims',
  '{"sub":"0e000000-0000-0000-0000-0000000000ad","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.admin_set_order_status(:'smoke_order', 'preparing');
select public.admin_set_order_status(:'smoke_order', 'ready');
select public.admin_set_order_status(:'smoke_order', 'delivered');
commit;

select o.status || ' ' || count(l.*)
  from public.orders o
  left join public.loyalty_transactions l on l.order_id = o.id and l.type = 'earn'
 where o.id = :'smoke_order'
 group by o.status;
SQL
  then
    result="$(grep -v '^$' "$WORK/smoke" | tail -n 1)"
    if [ "$result" = "delivered 1" ]; then
      ok "smoke: a customer order placed and settled after the change"
    else
      bad "smoke: expected a delivered order with one earn row, got '$result'"
    fi
  else
    bad "smoke: placing or settling an order failed after the change"
    sed 's/^/        /' "$WORK/err"
  fi

  invariants >"$WORK/after-smoke"
  if grep -vxF -f "$WORK/invariants" "$WORK/after-smoke" | grep -q .; then
    bad "the smoke broke an invariant that held before it"
    grep -vxF -f "$WORK/invariants" "$WORK/after-smoke" | sed 's/^/  /'
  else
    ok "the smoke broke no invariant"
  fi
fi

# ---------------------------------------------------------------------------
# The fingerprint diff: what the change did to rows that already existed.
# Printed whatever the verdict; it is information, not an assertion.
# ---------------------------------------------------------------------------
printf '\n  fingerprint diff (tables whose rows changed; columns added by the change excluded):\n'
diff_out="$(psql_on "$EXISTING_DB" -F ' | ' -c "
  select format('%-34s', b.table_name),
         case when a.table_name is null then 'table dropped'
              else format('%s -> %s rows%s', b.row_count, a.row_count,
                          case when a.digest <> b.digest then ', content changed' else '' end)
         end
    from sql_ci_existing.fingerprint b
    left join sql_ci_existing.fingerprint a on a.phase = 'after' and a.table_name = b.table_name
   where b.phase = 'before'
     and (a.table_name is null or a.row_count <> b.row_count or a.digest <> b.digest)
   order by 1")"
if [ -n "$diff_out" ]; then
  printf '%s\n' "$diff_out" | sed 's/^/        /'
else
  info "(no existing row changed)"
fi

if [ "$failures" -ne 0 ]; then
  printf '\n  existing data: %d check(s) FAILED\n' "$failures"
  exit 1
fi
printf '\n  existing data: every check passed\n'
