-- ============================================================================
-- Spicy Meal — branch availability sweeper (auto-reopen on timer expiry)
--
-- The old operations webapp reopened expired closures with a 30-second
-- client-side loop in the browser: it only ran while somebody had the tab open,
-- and it attributed the reopen to whoever happened to be looking. SMA already
-- runs real server-side automation (five pg_cron jobs), so this follows that
-- pattern instead — the one modelled by order_integrity_watchdog: a durable run
-- ledger, an advisory lock against overlap, transition-only writes, and a
-- SECURITY DEFINER function reachable only by service_role.
--
-- This job makes NO outbound HTTP call, so it needs no Edge Function driver,
-- no Vault secret and no pg_net — cron.job stores nothing but the bare internal
-- call.
--
-- THE ONE RULE THAT MATTERS: a row with `snoozed_until is null` is an UNTIMED
-- closure — an admin deliberately delisting an item through Branch Management.
-- The sweeper must never touch those. Auto-reopening one would put a withdrawn
-- item back on the menu, which is the worst failure this feature could have.
--
-- The audit row is written by the trigger on branch_product_availability, not
-- here. Because pg_cron runs with no JWT, auth.uid() is null and the trigger
-- records source='automatic' / action='opened_auto' without this function
-- having to say so.
--
-- NOT REGISTERED IN OPERATIONS HEALTH HERE. The health allowlist is a hardcoded
-- VALUES list inside the 925-line operations_health_snapshot_internal(), and
-- operations_automation_cron_health_test.sql asserts the exact job counts, so
-- adding an entry means re-emitting that function and updating that suite. That
-- is a separate change with its own review surface. An unlisted job is simply
-- invisible to the health board (the query is `from expected left join
-- cron.job`), never a false alarm.
-- ============================================================================

create extension if not exists pg_cron;

-- ---- 0. Foreign-job guard (idempotent) --------------------------------------
-- Raise only if a job with this name exists that is NOT ours. Re-applying is
-- safe: cron.schedule(name, ...) upserts by name, so our own job updates in
-- place. This is the order_integrity_watchdog variant deliberately — the
-- stricter lazywait/refund guard refuses ANY re-apply and makes its migration
-- permanently non-idempotent in the chain replay.
do $$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'branch-availability-sweep' limit 1;
  if v_cmd is not null and v_cmd not ilike '%branch_availability_sweep%' then
    raise exception
      'a foreign cron job named "branch-availability-sweep" already exists; verify/remove it before enabling this sweeper';
  end if;
end $$;

-- ---- 1. Durable run ledger ---------------------------------------------------
create table if not exists public.branch_availability_runs (
  id                 bigint generated always as identity primary key,
  started_at         timestamptz not null default now(),
  completed_at       timestamptz,
  status             text not null default 'running' check (status in ('running','success','failed')),
  products_reopened  integer not null default 0,
  safe_error_code    text,
  safe_error_message text,
  duration_ms        integer
);

create index if not exists bar_started_idx on public.branch_availability_runs (started_at desc);

alter table public.branch_availability_runs enable row level security;
revoke all on public.branch_availability_runs from public, anon, authenticated;

comment on table public.branch_availability_runs is
  'Durable per-run ledger for the branch availability sweeper. Counts, status, SQLSTATE-only error code and duration. No PII, no catalog payloads.';

-- ---- 2. The sweeper ----------------------------------------------------------
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
    -- `snoozed_until is not null` is the load-bearing clause: it excludes the
    -- untimed admin closures that must stay closed. The BEFORE trigger clears
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

    update public.branch_availability_runs
       set status = 'success', completed_at = now(),
           products_reopened = v_reopened,
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;

  exception when others then
    -- SQLSTATE only. A message from a catalog row could carry product names.
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
  'Reopens branch items whose snooze timer has expired. Never touches an untimed closure (snoozed_until is null). Advisory-locked, ledgered, service_role only.';

-- ---- 3. Schedule -------------------------------------------------------------
-- Every minute. cron.job stores only this bare internal call — no credentials,
-- no HTTP, no external target.
select cron.schedule(
  'branch-availability-sweep',
  '* * * * *',
  'select public.branch_availability_sweep();'
);

-- ---- 4. Post-schedule self-verification --------------------------------------
-- The whole migration is one transaction: if the end state is not EXACTLY one
-- canonical job, raise and roll everything back.
do $$
begin
  if (select count(*) from cron.job where jobname = 'branch-availability-sweep') <> 1
     or (select count(*) from cron.job
          where jobname = 'branch-availability-sweep'
            and schedule = '* * * * *'
            and btrim(command) = 'select public.branch_availability_sweep();') <> 1 then
    raise exception 'sweeper verification failed: branch-availability-sweep is not in the canonical single-job state';
  end if;
end $$;
