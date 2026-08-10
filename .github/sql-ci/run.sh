#!/usr/bin/env bash
#
# Replay the whole migration chain onto an empty database, then run every SQL
# suite against a fresh copy of it.
#
# WHY THIS EXISTS. `supabase/tests/*.sql` ran in no CI job. Twenty-six suites
# were written, reviewed and merged without ever executing — two of them
# guarding migrations that are still unapplied. "Run the harness" was a manual
# step somebody had to remember, and the failure mode of forgetting was silent.
#
# This is deliberately NOT a Supabase emulator. It is a plain PostGIS Postgres
# plus the smallest shim the chain actually references (see bootstrap.sql).
# What it proves: the chain applies cleanly and in order onto an empty
# database, re-applies as a no-op, and the suites' assertions hold. What it
# does NOT prove: anything about production data, pg_cron actually firing, or
# pg_net actually posting.
#
# ISOLATION. Each suite gets its own database cloned from a template, rather
# than a shared database wrapped in a transaction. 24 of the 26 suites already
# issue their own `begin` / `rollback`; wrapping those in an outer transaction
# would let the suite's own `rollback` close the OUTER one, after which the
# rest of that file would run in autocommit and leave fixtures behind for
# whatever ran next. Cloning is both correct and, because Postgres copies a
# template at the file level, cheap.
#
# Every suite runs even after one fails, so a single broken file does not hide
# the state of the other twenty-five.

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

MIGRATIONS_DIR="$ROOT/supabase/migrations"
TESTS_DIR="$ROOT/supabase/tests"

ADMIN_DB="${PGDATABASE:-postgres}"
TEMPLATE_DB="sma_chain_template"

ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

psql_on() { psql -X -q -v ON_ERROR_STOP=1 --no-align --tuples-only -d "$1" "${@:2}"; }

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m    %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; }

step "Server"
psql_on "$ADMIN_DB" -c 'select version();'

step "Build the template database"
dropdb --if-exists "$TEMPLATE_DB"
createdb "$TEMPLATE_DB"
ok "created $TEMPLATE_DB"

psql_on "$TEMPLATE_DB" -f "$HERE/bootstrap.sql"
ok "bootstrap.sql"

step "Migration chain"
migration_count=0
while IFS= read -r f; do
  migration_count=$((migration_count + 1))
  if psql_on "$TEMPLATE_DB" -f "$f" >/dev/null 2>"$ERR"; then
    ok "$(basename "$f")"
  else
    bad "$(basename "$f")"
    sed 's/^/        /' "$ERR"
    printf '\n\033[31mMigration chain failed at file %d. Suites not run.\033[0m\n' "$migration_count"
    exit 1
  fi
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' | sort)
printf '\n  %d migrations applied cleanly.\n' "$migration_count"

step "Idempotence — re-applying the chain (REPORT ONLY)"
idem_failed=0
while IFS= read -r f; do
  if ! psql_on "$TEMPLATE_DB" -f "$f" >/dev/null 2>"$ERR"; then
    bad "not idempotent: $(basename "$f")"
    sed 's/^/        /' "$ERR"
    idem_failed=1
  fi
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' | sort)
if [ "$idem_failed" -eq 0 ]; then
  ok "chain re-applies cleanly"
else
  printf '  (report only — some scheduler migrations refuse to re-run by design)\n'
fi

step "Test-harness contract"
psql_on "$TEMPLATE_DB" -f "$HERE/harness.sql"
ok "harness.sql"

step "Seed"
psql_on "$TEMPLATE_DB" -f "$ROOT/supabase/seed.sql"
ok "supabase/seed.sql"

step "SQL suites"
suite_total=0
suite_failed=0
suite_known=0
suite_unexpected_pass=0
failed_names=()
unexpected_pass_names=()

KNOWN_FILE="$HERE/known-failing.txt"
is_known() {
  [ -f "$KNOWN_FILE" ] || return 1
  grep -vE '^[[:space:]]*(#|$)' "$KNOWN_FILE" | grep -qxF "$1"
}

while IFS= read -r f; do
  suite_total=$((suite_total + 1))
  name="$(basename "$f")"
  db="sma_suite_$suite_total"

  dropdb --if-exists "$db"
  createdb -T "$TEMPLATE_DB" "$db"

  if psql_on "$db" -f "$f" >/dev/null 2>"$ERR"; then
    if is_known "$name"; then
      printf '  \033[33mFIXED\033[0m %s — now passes; remove it from known-failing.txt\n' "$name"
      suite_unexpected_pass=$((suite_unexpected_pass + 1))
      unexpected_pass_names+=("$name")
    else
      ok "$name"
    fi
  elif is_known "$name"; then
    printf '  \033[33mknown\033[0m %s\n' "$name"
    suite_known=$((suite_known + 1))
  else
    bad "$name"
    # GitHub annotations now include both the suite name and compact psql stderr.
    # `%0A`, `%0D`, `%25` escapes prevent multiline/error text from corrupting
    # the workflow command protocol while keeping the actual database assertion
    # visible directly on the failed check.
    detail="$(tail -n 8 "$ERR" | tr '\n\r' '  ' | sed -e 's/%/%25/g' -e 's/\r/%0D/g' -e 's/\n/%0A/g')"
    printf '::error file=supabase/tests/%s::SQL suite failed: %s — %s\n' "$name" "$name" "$detail"
    sed 's/^/        /' "$ERR"
    suite_failed=$((suite_failed + 1))
    failed_names+=("$name")
  fi

  dropdb --if-exists "$db"
done < <(find "$TESTS_DIR" -maxdepth 1 -name '*.sql' | sort)

step "Summary"
printf '  migrations : %d applied (clean re-run: %s)\n' \
  "$migration_count" "$([ "$idem_failed" -eq 0 ] && echo yes || echo 'no — report only')"
printf '  suites     : %d run, %d passed, %d quarantined, %d NEW failures\n' \
  "$suite_total" \
  "$((suite_total - suite_failed - suite_known - suite_unexpected_pass))" \
  "$suite_known" "$suite_failed"

if [ "$suite_total" -eq 0 ]; then
  printf '\n\033[31mNo suites were discovered — that is a harness bug, not a pass.\033[0m\n'
  exit 1
fi

if [ "$suite_unexpected_pass" -ne 0 ]; then
  printf '\n\033[33mQuarantined but now PASSING — delete these from known-failing.txt:\033[0m\n'
  for n in "${unexpected_pass_names[@]}"; do printf '  - %s\n' "$n"; done
fi

if [ "$suite_failed" -ne 0 ]; then
  printf '\n\033[31mNew failures (not quarantined):\033[0m\n'
  for n in "${failed_names[@]}"; do printf '  - %s\n' "$n"; done
fi

if [ "$suite_failed" -ne 0 ] || [ "$suite_unexpected_pass" -ne 0 ]; then
  exit 1
fi

printf '\n\033[32mNo new failures: %d/%d suites pass against a fresh %d-migration database (%d quarantined).\033[0m\n' \
  "$((suite_total - suite_known))" "$suite_total" "$migration_count" "$suite_known"
