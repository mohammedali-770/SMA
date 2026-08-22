-- ============================================================================
-- Spicy Meal — bound the branch-availability run ledger
--
-- THE GAP
-- `branch_availability_runs` gets one row per minute, forever. 20260820111000
-- created it with no retention and 20260820140000 left it that way, so it grows
-- at ~1,440 rows/day — roughly 526,000 rows and ~130 MB a year at the ~245
-- bytes/row observed in Production.
--
-- That is not dangerous and it changes no behaviour: the `branch_availability`
-- health card reads only the newest row and the newest success, both index-
-- served, so the card stays fast however large the table gets. It is simply
-- unbounded where the house pattern is bounded, and it is cheapest to fix while
-- the table is still small.
--
-- THE PRECEDENT IT NOW MATCHES
-- `lazywait_sync_requests` is the other once-per-minute run ledger in this
-- schema, and 20260720120000:150-159 prunes it to 14 days on every tick. The
-- window here is the same 14 days, giving a steady state of ~20,160 rows and a
-- few MB. Production confirmed that shape: at the time of writing the lazywait
-- ledger held exactly 20,160 rows — 14 × 1,440.
--
-- WHAT THIS DOES NOT DO
-- - It does NOT re-schedule the cron job. `branch-availability-sweep` keeps the
--   exact schedule and command 20260820111000 asserted, and re-registering it
--   would only risk drifting from that assertion.
-- - It does NOT touch `branch_availability_events`. That is the append-only
--   AUDIT of who closed what and when, a business record with a different
--   retention question that nobody has decided. Only the operational run ledger
--   is pruned here. Deleting audit rows would need an explicit owner decision.
-- - It needs NO new index. `bar_started_idx` on `(started_at desc)`
--   (20260820111000:65) already serves the range delete.
--
-- TWO LITERALS MUST SURVIVE VERBATIM. branch_availability_snooze_test.sql:397-402
-- pins this function's source text, asserting it still contains
-- `pg_try_advisory_xact_lock` and `snoozed_until is not null` — the overlap
-- guard and the untimed-closure exclusion, the two properties most worth never
-- losing in a refactor. Both are below. `products_reopened` also keeps its exact
-- meaning; that column is asserted =1, =0 and =0 at three points in the same
-- suite.
--
-- WHY THE PRUNE IS GUARDED, WHERE lazywait's IS NOT
-- The retention delete gets its own `begin ... exception when others` so a
-- failing prune can never stop a sweep. That is a deliberate divergence from
-- the lazywait precedent, and the reasoning is this feature's governing rule:
-- restores are customer-facing and retention is housekeeping. An unguarded
-- prune that threw would abort the whole transaction, so no items, options or
-- delivery pauses would reopen that tick — a 30-minute closure quietly becomes
-- indefinite because a DELETE hit a lock timeout. Housekeeping must never cost
-- that.
--
-- The cost of guarding is that a persistently failing prune is silent, so it is
-- made inspectable rather than invisible: `rows_pruned` on the ledger row
-- records what each tick actually removed. Nothing alerts on it — a table
-- growing while `rows_pruned` sits at 0 is the signal, found by looking, and
-- that is the right weight for a housekeeping fault that cannot affect a
-- customer.
--
-- WHERE IT SITS
-- Inside the advisory lock, in the OUTER block. Inside the lock, so two runs
-- never contend on the same delete — the lock exists precisely to serialise
-- this function. In the outer block, so it is not rolled back by the inner
-- handler's savepoint when a sweep fails; a database whose sweeps are all
-- failing is exactly the one that must not also stop pruning.
--
-- The only path that skips retention is `overlap_skipped`, which returns before
-- the lock is held. That path occurs only when another run holds the lock and
-- is itself pruning, so retention still runs on every productive tick.
-- ============================================================================

alter table public.branch_availability_runs
  add column if not exists rows_pruned integer not null default 0;

comment on column public.branch_availability_runs.rows_pruned is
  'Ledger rows older than the retention window removed by this tick. Housekeeping only: nothing alerts on it, and a prune failure is swallowed so it can never stop a sweep. A table growing while this stays 0 is the signal that retention has stopped.';

create or replace function public.branch_availability_sweep()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  c_lock_key  constant bigint := 815402977;   -- fixed advisory key for this sweeper
  c_retention constant interval := interval '14 days';
  v_run_id   bigint;
  v_start    timestamptz := clock_timestamp();
  v_reopened integer := 0;
  v_mods     integer := 0;
  v_delivery integer := 0;
  v_areas    integer := 0;
  v_pruned   integer := 0;
begin
  insert into public.branch_availability_runs (status) values ('running') returning id into v_run_id;

  if not pg_try_advisory_xact_lock(c_lock_key) then
    update public.branch_availability_runs
       set status = 'failed', completed_at = now(),
           safe_error_code = 'overlap_skipped',
           safe_error_message = 'another sweeper run holds the advisory lock',
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;
    return v_run_id;
  end if;

  -- Retention. Outer block and separately guarded — see the header. The
  -- just-inserted row (started_at = now()) and everything newer are far outside
  -- the window, so the current run can never delete itself.
  begin
    with pruned as (
      delete from public.branch_availability_runs
       where started_at < now() - c_retention
      returning 1
    )
    select count(*)::int into v_pruned from pruned;
  exception when others then
    -- Housekeeping must never stop a sweep. Left at 0, which is the signal.
    v_pruned := 0;
  end;

  begin
    -- Items. `snoozed_until is not null` excludes untimed admin closures.
    with reopened as (
      update public.branch_product_availability
         set is_available = true
       where is_available = false
         and snoozed_until is not null
         and snoozed_until <= now()
      returning 1
    )
    select count(*)::int into v_reopened from reopened;

    -- Modifiers, same rule.
    with reopened_mods as (
      update public.branch_modifier_availability
         set is_available = true
       where is_available = false
         and snoozed_until is not null
         and snoozed_until <= now()
      returning 1
    )
    select count(*)::int into v_mods from reopened_mods;

    -- Branch delivery: a null delivery_closed_until is the admin's untimed pause.
    with resumed as (
      update public.branches
         set delivery_temporarily_closed = false
       where delivery_temporarily_closed
         and delivery_closed_until is not null
         and delivery_closed_until <= now()
      returning 1
    )
    select count(*)::int into v_delivery from resumed;

    with reenabled as (
      update public.branch_delivery_areas
         set is_disabled = false
       where is_disabled
         and disabled_until is not null
         and disabled_until <= now()
      returning 1
    )
    select count(*)::int into v_areas from reenabled;

    update public.branch_availability_runs
       set status = 'success', completed_at = now(),
           products_reopened  = v_reopened,
           modifiers_reopened = v_mods,
           delivery_resumed   = v_delivery,
           areas_reenabled    = v_areas,
           rows_pruned        = v_pruned,
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;

  exception when others then
    -- SQLSTATE only. A message from a catalog or branch row could carry names.
    -- rows_pruned is still recorded: the prune already committed to this
    -- transaction outside the failing block, so the ledger should say so.
    update public.branch_availability_runs
       set status = 'failed', completed_at = now(),
           safe_error_code = sqlstate,
           safe_error_message = 'sweep failed; see sqlstate',
           rows_pruned = v_pruned,
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;
  end;

  return v_run_id;
end $$;

revoke all on function public.branch_availability_sweep() from public, anon, authenticated;
grant execute on function public.branch_availability_sweep() to service_role;

comment on function public.branch_availability_sweep() is
  'Reopens branch items, branch delivery and advisory delivery areas whose timer has expired, and prunes its own run ledger to 14 days. Never touches an untimed closure/pause (the corresponding *_until is null), and never touches branch_availability_events, which is the audit record. Advisory-locked, ledgered, service_role only.';

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- Re-apply the branch_availability_sweep body from
-- 20260820140000_branch_modifier_availability.sql. That removes the prune; the
-- rows_pruned column can stay (it is nullable-by-default and unread) or be
-- dropped separately. Rows already pruned are not recoverable, which is the
-- point of retention and the reason the window is 14 days rather than shorter.
