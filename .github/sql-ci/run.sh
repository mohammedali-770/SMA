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

# -X ignores ~/.psqlrc; ON_ERROR_STOP makes a mid-file error fail that file
# rather than ploughing on and reporting a misleading later error.
psql_on() { psql -X -q -v ON_ERROR_STOP=1 --no-align --tuples-only -d "$1" "${@:2}"; }

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m    %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; }

# ---------------------------------------------------------------------------
step "Server"
psql_on "$ADMIN_DB" -c 'select version();'

# ---------------------------------------------------------------------------
step "Build the template database"
dropdb --if-exists "$TEMPLATE_DB"
createdb "$TEMPLATE_DB"
ok "created $TEMPLATE_DB"

psql_on "$TEMPLATE_DB" -f "$HERE/bootstrap.sql"
ok "bootstrap.sql"

# ---------------------------------------------------------------------------
step "Migration chain"
migration_count=0
# Filename order IS apply order — versions are date-prefixed. `find | sort`
# rather than glob expansion, whose order is locale-dependent.
while IFS= read -r f; do
  migration_count=$((migration_count + 1))
  if psql_on "$TEMPLATE_DB" -f "$f" >/dev/null 2>"$ERR"; then
    ok "$(basename "$f")"
  else
    bad "$(basename "$f")"
    sed 's/^/        /' "$ERR"
    # The chain is ordered and cumulative: everything after a failure would
    # fail for a reason that is not its own, so stop and report cleanly.
    printf '\n\033[31mMigration chain failed at file %d. Suites not run.\033[0m\n' "$migration_count"
    exit 1
  fi
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' | sort)
printf '\n  %d migrations applied cleanly.\n' "$migration_count"

# ---------------------------------------------------------------------------
step "Idempotence — re-applying the chain (REPORT ONLY)"
# Non-fatal, deliberately. Some migrations are intentionally NOT re-runnable:
# the Lazywait and refund schedulers refuse with "a cron job named X already
# exists; verify/remove it before enabling this driver", which is a guard
# against double-scheduling and is correct behaviour. Failing the build on
# that would be asserting a property this codebase has deliberately chosen not
# to have. The result is still worth printing — an UNEXPECTED entry here is a
# migration that could not be retried after a partial failure.
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

# ---------------------------------------------------------------------------
step "Test-harness contract"
# AFTER the idempotence replay: replaying the chain would overwrite the
# function overrides this installs.
psql_on "$TEMPLATE_DB" -f "$HERE/harness.sql"
ok "harness.sql"

# ---------------------------------------------------------------------------
step "Seed"
# The repository's OWN seed, the one `supabase db reset` runs. Suites reference
# its fixed branch ids (b0000000-…-0001) directly, so without it a third of
# them fail on orders_branch_id_fkey for a reason that has nothing to do with
# what they are testing. It seeds catalog and coupons only — deliberately no
# auth users, which is why suites that need a customer create their own.
psql_on "$TEMPLATE_DB" -f "$ROOT/supabase/seed.sql"
ok "supabase/seed.sql"

# ---------------------------------------------------------------------------
step "SQL suites"
suite_total=0
suite_failed=0
suite_known=0
suite_unexpected_pass=0
failed_names=()
unexpected_pass_names=()

# Quarantine list. Entries are suites that fail for reasons pre-dating this
# harness — see known-failing.txt for the reason attached to each one.
KNOWN_FILE="$HERE/known-failing.txt"
is_known() {
  [ -f "$KNOWN_FILE" ] || return 1
  grep -vE '^[[:space:]]*(#|$)' "$KNOWN_FILE" | grep -qxF "$1"
}

while IFS= read -r f; do
  suite_total=$((suite_total + 1))
  name="$(basename "$f")"
  db="sma_suite_$suite_total"

  # Clone per suite. `createdb -T` needs no other session connected to the
  # template, which is why nothing holds a connection to it outside the steps
  # above.
  dropdb --if-exists "$db"
  createdb -T "$TEMPLATE_DB" "$db"

  if psql_on "$db" -f "$f" >/dev/null 2>"$ERR"; then
    if is_known "$name"; then
      # A quarantined suite that passes means the list is stale. Failing here
      # is what stops known-failing.txt decaying into a permanent ignore-list.
      printf '  [33mFIXED[0m %s — now passes; remove it from known-failing.txt
' "$name"
      suite_unexpected_pass=$((suite_unexpected_pass + 1))
      unexpected_pass_names+=("$name")
    else
      ok "$name"
    fi
  elif is_known "$name"; then
    printf '  [33mknown[0m %s
' "$name"
    suite_known=$((suite_known + 1))
  else
    bad "$name"
    sed 's/^/        /' "$ERR"
    suite_failed=$((suite_failed + 1))
    failed_names+=("$name")
  fi

  dropdb --if-exists "$db"
done < <(find "$TESTS_DIR" -maxdepth 1 -name '*.sql' | sort)

# ---------------------------------------------------------------------------
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

# Only NEW failures and stale quarantine entries fail the build. Idempotence is
# reported, not enforced — see the note on that step.
if [ "$suite_failed" -ne 0 ] || [ "$suite_unexpected_pass" -ne 0 ]; then
  exit 1
fi

printf '\n\033[32mNo new failures: %d/%d suites pass against a fresh %d-migration database (%d quarantined).\033[0m\n' \
  "$((suite_total - suite_known))" "$suite_total" "$migration_count" "$suite_known"
