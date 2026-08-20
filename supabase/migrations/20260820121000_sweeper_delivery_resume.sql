-- ============================================================================
-- Spicy Meal — extend the availability sweeper to resume expired delivery pauses
--
-- One tick, one ledger row. A second cron job would double the moving parts and
-- would additionally have to be reconciled with the operations-health allowlist,
-- which asserts exact job counts.
--
-- THE JOB IS NOT RE-SCHEDULED HERE. `20260820111000` ends with a verification
-- block asserting exactly one job whose command is
-- `select public.branch_availability_sweep();` on `* * * * *`. The signature and
-- schedule are unchanged, so replacing the body is enough and calling
-- cron.schedule again would only risk drifting from that assertion.
--
-- TWO LITERALS MUST SURVIVE VERBATIM. branch_availability_snooze_test.sql:394-402
-- pins this function's source text, asserting it still contains
-- `pg_try_advisory_xact_lock` and `snoozed_until is not null`. Both are below and
-- must stay — they are the overlap guard and the untimed-closure exclusion, i.e.
-- the two properties most worth never losing in a refactor.
--
-- `products_reopened` KEEPS ITS MEANING. That column is asserted =1, =0 and =0 at
-- three separate points in the existing suite, so delivery and area resumes get
-- their own counters rather than being folded into it.
-- ============================================================================

alter table public.branch_availability_runs
  add column if not exists delivery_resumed integer not null default 0,
  add column if not exists areas_reenabled  integer not null default 0;

create or replace function public.branch_availability_sweep()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  c_lock_key constant bigint := 815402977;   -- fixed advisory key for this sweeper
  v_run_id   bigint;
  v_start    timestamptz := clock_timestamp();
  v_reopened integer := 0;
  v_delivery integer := 0;
  v_areas    integer := 0;
begin
  -- Durable run row FIRST, before any work, so a failure is always visible.
  insert into public.branch_availability_runs (status) values ('running') returning id into v_run_id;

  -- Overlap prevention. Recorded as failed with a benign code: visible, but not
  -- counted as a success.
  if not pg_try_advisory_xact_lock(c_lock_key) then
    update public.branch_availability_runs
       set status = 'failed', completed_at = now(),
           safe_error_code = 'overlap_skipped',
           safe_error_message = 'another sweeper run holds the advisory lock',
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;
    return v_run_id;
  end if;

  begin
    -- Items. `snoozed_until is not null` is the load-bearing clause: it excludes
    -- the untimed admin closures that must stay closed. The BEFORE trigger clears
    -- snoozed_until/reason_code as part of this update, and the AFTER trigger
    -- writes one 'opened_auto' event per row.
    with reopened as (
      update public.branch_product_availability
         set is_available = true
       where is_available = false
         and snoozed_until is not null
         and snoozed_until <= now()
      returning 1
    )
    select count(*)::int into v_reopened from reopened;

    -- Branch delivery. Exactly the same rule one level up: a null
    -- delivery_closed_until is the admin's untimed pause, and auto-resuming
    -- delivery on a branch a manager deliberately shut would be the branch-level
    -- version of putting a withdrawn item back on the menu.
    with resumed as (
      update public.branches
         set delivery_temporarily_closed = false
       where delivery_temporarily_closed
         and delivery_closed_until is not null
         and delivery_closed_until <= now()
      returning 1
    )
    select count(*)::int into v_delivery from resumed;

    -- Advisory named areas. Same shape again.
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
           products_reopened = v_reopened,
           delivery_resumed  = v_delivery,
           areas_reenabled   = v_areas,
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;

  exception when others then
    -- SQLSTATE only. A message from a catalog or branch row could carry names.
    update public.branch_availability_runs
       set status = 'failed', completed_at = now(),
           safe_error_code = sqlstate,
           safe_error_message = 'sweep failed; see sqlstate',
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;
  end;

  return v_run_id;
end $$;

revoke all on function public.branch_availability_sweep() from public, anon, authenticated;
grant execute on function public.branch_availability_sweep() to service_role;

comment on function public.branch_availability_sweep() is
  'Reopens branch items, branch delivery and advisory delivery areas whose timer has expired. Never touches an untimed closure/pause (the corresponding *_until is null). Advisory-locked, ledgered, service_role only.';
