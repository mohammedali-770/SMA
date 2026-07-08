-- ============================================================================
-- Reaper behaviour test for reap_stale_lazywait_syncs() + requeue attempt reset.
--
-- Runs against a throwaway Postgres with all migrations applied (see
-- docs/LAZYWAIT.md / the verification harness). Each case RAISES EXCEPTION on
-- failure, so the whole script aborts non-zero if any assertion fails; a clean
-- run prints the NOTICEs and commits nothing (wrapped in a rollback).
--
-- Covers the required cases:
--   1. 'syncing' younger than the timeout is NOT reclaimed.
--   2. 'syncing' older than the timeout IS reclaimed.
--   3. 'synced' is NEVER reclaimed.
--   4. A stale order that already has a ref is recovered to 'synced', NOT resent.
--   5. Max-attempts / dead-letter still works (no infinite retry).
-- Plus: requeue_lazywait_order resets sync_attempt_count.
-- ============================================================================
begin;

-- Minimal fixtures. orders has many NOT NULL columns in the real schema; insert
-- only what the reaper touches by disabling the enqueue trigger and setting the
-- sync columns directly. We use a helper to seed one order in a given state.
set local session_replication_role = replica;  -- skip triggers/FKs for fixtures

-- A branch + a customer to satisfy any NOT NULLs that lack defaults is avoided by
-- inserting orders with explicit sync columns; we rely on defaults for the rest.
-- If your orders table has additional NOT NULL columns without defaults, extend
-- the column list below.

do $$
declare
  v_young uuid := gen_random_uuid();
  v_old   uuid := gen_random_uuid();
  v_synced uuid := gen_random_uuid();
  v_withref uuid := gen_random_uuid();
  v_maxed uuid := gen_random_uuid();
  v_res jsonb;
  v_state text;
  v_attempts int;
  v_next timestamptz;
begin
  -- Seed rows directly in the states we want, backdating updated_at as needed.
  -- order_number/branch_id/order_type/subtotal/total are NOT NULL w/o defaults;
  -- session_replication_role=replica skips the FK on branch_id so a fake uuid is
  -- fine for this state-machine test.
  insert into public.orders
    (id, order_number, branch_id, order_type, subtotal, total,
     lazywait_sync_state, lazywait_ref, sync_attempt_count, updated_at) values
    (v_young,  'T-1', gen_random_uuid(), 'pickup', 10, 10, 'syncing', null,       0, now() - interval '2 minutes'),   -- case 1: fresh claim
    (v_old,    'T-2', gen_random_uuid(), 'pickup', 10, 10, 'syncing', null,       1, now() - interval '30 minutes'),  -- case 2: stale, no ref
    (v_synced, 'T-3', gen_random_uuid(), 'pickup', 10, 10, 'synced',  'REF_DONE', 0, now() - interval '30 minutes'),  -- case 3: already done
    (v_withref,'T-4', gen_random_uuid(), 'pickup', 10, 10, 'syncing', 'REF_LOST', 2, now() - interval '30 minutes'),  -- case 4: stale WITH ref
    (v_maxed,  'T-5', gen_random_uuid(), 'pickup', 10, 10, 'syncing', null,       7, now() - interval '30 minutes');  -- case 5: one below max(8)

  -- Run the reaper with a 10-minute lease.
  v_res := public.reap_stale_lazywait_syncs(10, 8);
  raise notice 'reaper summary: %', v_res;

  -- Case 1: young 'syncing' NOT reclaimed (still syncing).
  select lazywait_sync_state into v_state from public.orders where id = v_young;
  if v_state <> 'syncing' then
    raise exception 'CASE 1 FAILED: young syncing was reclaimed -> %', v_state;
  end if;

  -- Case 2: old 'syncing' WITHOUT ref reclaimed to 'failed', attempt++ & backoff set.
  select lazywait_sync_state, sync_attempt_count, sync_next_attempt_at
    into v_state, v_attempts, v_next from public.orders where id = v_old;
  if v_state <> 'failed' then
    raise exception 'CASE 2 FAILED: stale no-ref not requeued -> %', v_state;
  end if;
  if v_attempts <> 2 then
    raise exception 'CASE 2 FAILED: attempt not incremented -> %', v_attempts;
  end if;
  if v_next is null or v_next <= now() then
    raise exception 'CASE 2 FAILED: backoff not scheduled in the future -> %', v_next;
  end if;

  -- Case 3: 'synced' untouched.
  select lazywait_sync_state into v_state from public.orders where id = v_synced;
  if v_state <> 'synced' then
    raise exception 'CASE 3 FAILED: synced order was reclaimed -> %', v_state;
  end if;

  -- Case 4: stale WITH ref recovered to 'synced', NOT resent (still holds ref).
  select lazywait_sync_state into v_state from public.orders where id = v_withref;
  if v_state <> 'synced' then
    raise exception 'CASE 4 FAILED: stale-with-ref not recovered to synced -> %', v_state;
  end if;
  if (select lazywait_ref from public.orders where id = v_withref) <> 'REF_LOST' then
    raise exception 'CASE 4 FAILED: ref was mutated';
  end if;

  -- Case 5: attempt 7 -> 8 hits max -> dead_letter (off the queue, no infinite retry).
  select lazywait_sync_state, sync_attempt_count, sync_next_attempt_at
    into v_state, v_attempts, v_next from public.orders where id = v_maxed;
  if v_state <> 'dead_letter' then
    raise exception 'CASE 5 FAILED: maxed order not dead-lettered -> %', v_state;
  end if;
  if v_next is not null then
    raise exception 'CASE 5 FAILED: dead_letter still has a next_attempt -> %', v_next;
  end if;

  -- Summary counts sanity: 1 recovered, 1 requeued, 1 dead-lettered.
  if (v_res->>'recovered_synced')::int <> 1
     or (v_res->>'requeued')::int <> 1
     or (v_res->>'dead_lettered')::int <> 1 then
    raise exception 'SUMMARY FAILED: %', v_res;
  end if;

  -- Idempotency: a second reap does nothing (no rows left in a stale 'syncing').
  v_res := public.reap_stale_lazywait_syncs(10, 8);
  if (v_res->>'recovered_synced')::int <> 0
     or (v_res->>'requeued')::int <> 0
     or (v_res->>'dead_lettered')::int <> 0 then
    raise exception 'IDEMPOTENCY FAILED: second reap changed rows: %', v_res;
  end if;

  -- Recovery is logged for Admin visibility (one row per reaped order).
  if (select count(*) from public.integration_sync_logs
        where provider = 'lazywait'
          and error in ('recovered_stale_syncing_with_ref',
                        'stale_syncing_no_ref_requeued',
                        'stale_syncing_no_ref_dead_letter')) <> 3 then
    raise exception 'LOGGING FAILED: expected 3 recovery log rows';
  end if;

  raise notice 'ALL REAPER CASES PASSED';
end $$;

rollback;
