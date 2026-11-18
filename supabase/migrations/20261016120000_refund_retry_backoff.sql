-- ============================================================================
-- REFUND RETRY BACK-OFF, ATTEMPT CAP AND STUCK ALERT: a refund the worker
-- cannot finish waits longer between tries, gives up after ten, and is
-- reported while it is still being retried.
--
-- Gap PG-01 in docs/readiness/20261113-card-payments-gaps.md, the part that was
-- the owner's. The owner's decisions, 2026-11-17:
--   1. back-off: after each unsuccessful attempt the next try waits 5 minutes,
--      doubling each time, capped at 6 hours;
--   2. cap: after 10 unsuccessful attempts the refund is 'failed', carrying the
--      last reason, so the existing critical rule R14 REFUND_FAILED and the
--      admin card "Refunds and payments needing attention" report it;
--   3. stuck alert: a refund still 'pending' with at least one attempt raises a
--      warning once it has been open for more than 1 hour and a critical once
--      more than 24 hours, measured from when the refund was opened
--      (order_refunds.created_at).
--
-- WHAT WAS WRONG, read from the code at 8aac448 and the live definitions
-- (PRE-IMAGES below): payment-refund releases a refund it could not finish as
-- 'pending' through finalize_order_refund(p_status => 'pending'), and
-- claim_order_refund takes any 'pending' refund. 20261013120000 made the claim
-- fair (least recently touched first, once per run) but left the numbers to the
-- owner: a stuck refund was still tried on every run, every 5 minutes, for
-- ever (288 Moyasar calls a day through the metered proxy), and nothing
-- reported it until it reached 'failed', which a retryable failure never does.
--
-- WHAT THIS DOES. Database only: payment-refund is NOT changed and needs no
-- redeploy. The worker already calls finalize_order_refund for every release,
-- and that call is where the back-off and the cap are decided.
--
--   A. order_refunds.next_attempt_at (timestamptz, NULL = due now). Nothing
--      else writes it.
--   B. refund_retry_delay(attempt_count): 5 minutes * 2^(attempt_count - 1),
--      capped at 6 hours. After attempts 1..9 the waits are 5, 10, 20, 40, 80,
--      160, 320, 360 and 360 minutes. The seventh wait is 320 minutes (5 h 20)
--      because 160 doubled is below the 6-hour cap; the cap first binds at the
--      eighth. About 22 h 35 min of waiting in all, about 23 h 20 min with the
--      5-minute schedule, so a refund normally reaches 'failed' before the
--      critical 24-hour stuck threshold.
--   C. finalize_order_refund: a release ('pending') stamps
--      next_attempt_at = now() + refund_retry_delay(attempt_count). A release
--      of a refund already claimed 10 times is written as 'failed' instead,
--      with the release's own failure code (or 'retry_limit_reached' when it
--      gave none) and "Automatic refund stopped after 10 attempts. Last reason:
--      ..." as its safe error. The order's refund_state becomes 'failed' as for
--      any failed refund. Succeeded and failed outcomes are unchanged, apart
--      from clearing next_attempt_at. claim_order_refund counts an attempt when
--      it claims, so attempt_count at a release is the attempts made so far.
--   D. claim_order_refund takes only refunds that are due, in the scan and again
--      under the lock (a refund can be released between the two).
--   E. order_integrity_watchdog: R18 REFUND_STUCK, next to R14-R17, one
--      incident per order. Its severity follows the refund's age, so the
--      incident update now copies the detection's severity (one line; for R1-R17
--      the severity is fixed by the rule code, so it changes nothing for them),
--      and an incident whose 'opened' alert went out at warning gets one
--      'escalated' outbox row when it turns critical. The outbox is still not
--      dispatched; the console's alert inbox reads order_integrity_health_summary,
--      which counts unresolved incidents by severity, so a warning R18 reads
--      degraded on the Order Integrity card and a critical one failing.
--   F. operations_health_snapshot_internal: the payment card's incident list
--      gains REFUND_STUCK. It counts critical incidents only, so R18 moves the
--      payment card at its 24-hour tier and not before. A monitor that names
--      its subjects goes quiet when one is added (CLAUDE.md section 8).
--
-- WHAT THIS DOES NOT DO: refund anything, change when a refund is owed, refund
-- duplicate payments automatically (owner decision D2, 2026-11-17: by hand
-- from Moyasar's dashboard, listed by R15), record dashboard refunds (PG-14,
-- decided automatic 2026-11-17, its own later change), turn the refund worker
-- on, or change place_order or compute_order_snapshot (asserted below).
--
-- A REFUND THAT REACHES 'failed' BY THE CAP MAY STILL HAVE LANDED. Its last
-- reason says what the worker last saw: provider_no_answer, http_5xx,
-- reconcile_unavailable and refund_not_final are all answers that do not rule
-- out Moyasar having refunded it. Before retrying one by hand, look the payment
-- up in Moyasar's dashboard (docs/PAYMENTS.md section 6).
--
-- ORDER OF THE LIVE STEPS: one, apply THIS FILE, named by version
-- 20261016120000 (a CLAUDE.md section 5 approval). No deploy is implied: the
-- deployed payment-refund passes the same arguments to both functions, whose
-- signatures do not change. The admin console's rule filter lists
-- REFUND_STUCK from the merge; until the apply it matches nothing.
--
-- PRE-IMAGES. Each replaced body is checked before it is replaced, on the
-- basis its prior file used:
--   * claim_order_refund(text, uuid[]): content hash (comments, whitespace and
--     semicolons removed, lower-cased) e20c906d9a4d39cdb585bafe0460b0c3, the
--     20261013120000 body, equal live (read 2026-11-17: md5(prosrc)
--     999471eed604d690da4e61675b89a02e, 2 151 characters);
--   * finalize_order_refund: content hash 0d64407adc77188b7f4f2767e41df945,
--     the 20260724120000 body. The live text is condensed (md5(prosrc)
--     83088a16b6bbe06bc9768a879d9f3c9e, 1 368 characters, against the
--     repository's 522174f64e7ae073fe1a064d65718804, 1 481) and its content
--     hash is the same, read 2026-11-17;
--   * order_integrity_watchdog: md5(prosrc) fb4fc4e2bdcee6ec46ced01029269cb0,
--     the 20261013120000 body, equal live (34 998 characters);
--   * operations_health_snapshot_internal: md5(prosrc) of the 20261013120000
--     body as written (2ad226c3754ba03ff9f6f4986a99db65) or as live holds it,
--     with its \u escapes at or above U+0020 decoded by the transport
--     (3847b5f3e18713bb0b322cacf9ce46ab, read 2026-11-17).
--   A re-apply is accepted: each guard also accepts this file's own post-image.
--
-- REPLAYING THE WHOLE CHAIN (the SQL CI idempotence step) reaches a third
-- state, and it is accepted on purpose. 20260724120000 re-creates
-- claim_order_refund(text) beside the two-argument function, and
-- 20261013120000 then refuses at its own guard, which does not know this
-- file's claim body; it refuses before writing anything, so the watchdog, the
-- health snapshot and finalize are left at their 20260831120000,
-- 20261003120000 and 20260724120000 bodies. That state is recognised by the
-- one-argument claim holding its 20260724120000 body, which cannot exist on a
-- database where 20261013120000 has applied (it drops it), so Production can
-- never take this path. Only then are those two older bodies accepted as
-- well. Every function here is re-emitted whole, so applying this file from
-- that state leaves exactly its post-image; the one-argument claim is dropped
-- in section 2. Without it, the suites would run against that mixed state.
--
-- NOT APPLIED TO PRODUCTION by this change.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Pre-image guards
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_n      integer;
  v_hash   text;
  v_type   text;
  v_replay boolean := false;
begin
  if to_regclass('public.order_refunds') is null then
    raise exception 'public.order_refunds is missing';
  end if;
  select format_type(a.atttypid, a.atttypmod) into v_type
    from pg_attribute a
   where a.attrelid = 'public.order_refunds'::regclass and a.attname = 'next_attempt_at' and not a.attisdropped;
  if v_type is not null and v_type is distinct from 'timestamp with time zone' then
    raise exception 'order_refunds.next_attempt_at exists as %, not timestamptz', v_type;
  end if;

  -- The replay state (header): the one-argument claim, holding exactly its
  -- 20260724120000 body. Any other one-argument body refuses below.
  if to_regprocedure('public.claim_order_refund(text)') is not null then
    select md5(lower(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '[[:space:];]+', '', 'g')))
      into v_hash from pg_proc p where p.oid = to_regprocedure('public.claim_order_refund(text)');
    if v_hash is distinct from '727e7909eb24142d42083b583be98bc5' then
      raise exception 'claim_order_refund(text) is not the 20260724120000 body (content md5 %)', coalesce(v_hash, 'NULL');
    end if;
    v_replay := true;
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claim_order_refund'
     and p.oid is distinct from to_regprocedure('public.claim_order_refund(text)');
  if v_n <> 1 or to_regprocedure('public.claim_order_refund(text, uuid[])') is null then
    raise exception 'expected exactly claim_order_refund(text, uuid[]), found % other overload(s)', v_n;
  end if;
  select md5(lower(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '[[:space:];]+', '', 'g')))
    into v_hash from pg_proc p where p.oid = to_regprocedure('public.claim_order_refund(text, uuid[])');
  if v_hash is distinct from 'e20c906d9a4d39cdb585bafe0460b0c3'
     and v_hash is distinct from '73b8c4e3a095324840078d953cd2a5ff' then
    raise exception 'claim_order_refund is not the 20261013120000 body (content md5 %): re-derive this file',
      coalesce(v_hash, 'NULL');
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'finalize_order_refund';
  if v_n <> 1 or to_regprocedure('public.finalize_order_refund(uuid, text, text, text, text, text)') is null then
    raise exception 'expected exactly finalize_order_refund(uuid, text, text, text, text, text), found % overload(s)', v_n;
  end if;
  select md5(lower(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '[[:space:];]+', '', 'g')))
    into v_hash from pg_proc p
   where p.oid = to_regprocedure('public.finalize_order_refund(uuid, text, text, text, text, text)');
  if v_hash is distinct from '0d64407adc77188b7f4f2767e41df945'
     and v_hash is distinct from '1524d484d6781027018514dda263ad70' then
    raise exception 'finalize_order_refund is not the 20260724120000 body (content md5 %): re-derive this file',
      coalesce(v_hash, 'NULL');
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'order_integrity_watchdog';
  if v_n <> 1 then
    raise exception 'expected exactly one order_integrity_watchdog, found %', v_n;
  end if;
  select md5(p.prosrc) into v_hash from pg_proc p where p.oid = to_regprocedure('public.order_integrity_watchdog()');
  if v_hash is distinct from 'fb4fc4e2bdcee6ec46ced01029269cb0'
     and v_hash is distinct from '93de2aaacc8d94b8638ada91841bc27b'
     and not (v_replay and v_hash = 'a05add09270f96881199d4e3da0f94c8') then
    raise exception 'order_integrity_watchdog is not the 20261013120000 body (md5 %): re-derive this file',
      coalesce(v_hash, 'NULL');
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_health_snapshot_internal';
  if v_n <> 1 then
    raise exception 'expected exactly one operations_health_snapshot_internal, found %', v_n;
  end if;
  select md5(p.prosrc) into v_hash from pg_proc p
   where p.oid = to_regprocedure('public.operations_health_snapshot_internal()');
  if v_hash is distinct from '2ad226c3754ba03ff9f6f4986a99db65'
     and v_hash is distinct from '3847b5f3e18713bb0b322cacf9ce46ab'
     and v_hash is distinct from 'a7d35d65657b1d32431ce1513b7f5239'
     and v_hash is distinct from '0f8f08f9d128536b61f908f885c66d7c'
     and not (v_replay and v_hash = '1e300b3d61759729e523d7c74224ce78') then
    raise exception 'operations_health_snapshot_internal is not the 20261013120000 body (md5 %): re-derive this file',
      coalesce(v_hash, 'NULL');
  end if;

  -- The name this file adds must be free, or already this file's.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'refund_retry_delay'
     and pg_get_function_identity_arguments(p.oid) <> 'p_attempt_count integer';
  if v_n <> 0 then
    raise exception 'an unexpected overload of refund_retry_delay exists';
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------
-- 1. When a refund is next due, and how long it waits
-- ---------------------------------------------------------------------------
alter table public.order_refunds add column if not exists next_attempt_at timestamptz;

comment on column public.order_refunds.next_attempt_at is
  'When a pending refund may next be claimed (20261016120000). NULL means now. Written by finalize_order_refund when it releases a refund as pending: now() + refund_retry_delay(attempt_count). Cleared on succeeded and failed.';

-- The owner's schedule (gap PG-01, 2026-11-17): 5 minutes, doubling, capped at
-- 6 hours. The exponent is clamped so a large count cannot overflow; any count
-- below 1 is treated as 1. Pure, so the self-verification below can read the
-- whole schedule from it.
create or replace function public.refund_retry_delay(p_attempt_count integer)
returns interval
language sql
immutable
set search_path = public
as $$
  select least(interval '6 hours',
               interval '5 minutes' * (2 ^ (least(greatest(coalesce(p_attempt_count, 1), 1), 20) - 1)))
$$;

-- EXECUTE is revoked from `public` AND both client roles explicitly: this
-- project's pg_default_acl grants it on new functions to anon, authenticated
-- and service_role directly (CLAUDE.md section 8, ledger row 101).
revoke all on function public.refund_retry_delay(integer) from public, anon, authenticated;
grant execute on function public.refund_retry_delay(integer) to service_role;

comment on function public.refund_retry_delay(integer) is
  'The wait before a released refund is tried again, after attempt_count unsuccessful attempts: 5 minutes * 2^(attempt_count - 1), capped at 6 hours (owner decision, gap PG-01, 2026-11-17; 20261016120000).';

-- ---------------------------------------------------------------------------
-- 2. claim_order_refund: only refunds that are due
-- ---------------------------------------------------------------------------
-- DERIVED, NOT RETYPED: 20261013120000_payment_refund_visibility.sql, the only
-- current definition, with three anchored substitutions, each asserted to
-- match once: the due filter in the candidate scan, the same filter in the
-- per-candidate re-check under the lock, and one comment. The order, the
-- exclusion list, FOR UPDATE SKIP LOCKED, the token, the attempt counter and the
-- order's refund_state are untouched. Same signature, so the grants stand; they
-- are restated and asserted below.
--
-- The one-argument claim exists only in the replay state the guard above
-- recognised (and checked to be the 20260724120000 body); on any database where
-- 20261013120000 has applied this is a no-op.
drop function if exists public.claim_order_refund(text);

create or replace function public.claim_order_refund(
  p_claim_token        text,
  p_exclude_refund_ids uuid[] default '{}'::uuid[]
)
returns table (
  refund_id       uuid,
  order_id        uuid,
  provider        text,
  charge_ref      text,
  idempotency_key text,
  amount          numeric,
  currency        text,
  attempt_count   integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.order_refunds;
  v_id    uuid;
  v_found boolean := false;
  -- NULL elements are removed: `id <> all (array[null])` is NULL for every
  -- row, which would make one stray NULL hide the whole queue.
  v_exclude uuid[] := coalesce(array_remove(p_exclude_refund_ids, null), '{}'::uuid[]);
begin
  if p_claim_token is null or p_claim_token = '' then
    raise exception 'claim token required' using errcode = '22004';
  end if;

  -- Least-recently-touched first (20261013120000), then lock + re-validate
  -- each in turn. A candidate that is locked by another worker is SKIPped; one
  -- that is no longer 'pending' fails the re-check; either way the scan
  -- continues. updated_at, not created_at: finalize_order_refund stamps
  -- updated_at when it releases a refund as 'pending', so a refund that was
  -- just tried goes to the back of the queue instead of being first again.
  -- Refunds the caller has already claimed in this run are skipped by id.
  -- Only refunds that are DUE are taken (20261016120000): a refund released
  -- as 'pending' carries next_attempt_at, the back-off finalize_order_refund
  -- stamped (5 minutes, doubling, capped at 6 hours); NULL means due now.
  -- Checked again under the lock, because another worker can release a
  -- refund between this scan and the lock.
  for v_id in
    select id from public.order_refunds
     where status = 'pending'
       and id <> all (v_exclude)
       and (next_attempt_at is null or next_attempt_at <= now())
     order by updated_at, created_at, id
     limit 50
  loop
    select * into v_row from public.order_refunds
     where id = v_id and status = 'pending'
       and (next_attempt_at is null or next_attempt_at <= now())
     for update skip locked;
    if found then
      v_found := true;
      exit;
    end if;
  end loop;

  if not v_found then
    return;
  end if;

  -- Aliased so `r.attempt_count` resolves to the COLUMN: this function's
  -- RETURNS TABLE output names are plpgsql variables, and an unqualified
  -- `attempt_count` would be an ambiguous reference.
  update public.order_refunds r
     set status = 'processing', claim_token = p_claim_token,
         attempt_count = r.attempt_count + 1, updated_at = now()
   where r.id = v_row.id
   returning r.* into v_row;

  update public.orders set refund_state = 'processing', updated_at = now()
   where id = v_row.order_id and refund_state in ('pending','failed');

  return query select v_row.id, v_row.order_id, v_row.provider, v_row.charge_ref,
                      v_row.idempotency_key, v_row.amount, v_row.currency, v_row.attempt_count;
end $$;

revoke all on function public.claim_order_refund(text, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_order_refund(text, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 3. finalize_order_refund: the back-off and the cap
-- ---------------------------------------------------------------------------
-- DERIVED, NOT RETYPED: 20260724120000_order_confirmation_state_machine.sql, the
-- only definition, with three anchored substitutions, each asserted to match
-- once: the declarations, the refund update (preceded by the cap decision), and
-- the order update, which now reads the status and failure code that were
-- actually written. The status check, the token fence and the return values are
-- untouched. Same signature.
create or replace function public.finalize_order_refund(
  p_refund_id    uuid,
  p_claim_token  text,
  p_status       text,                     -- succeeded | failed | pending (release)
  p_provider_ref text default null,
  p_failure_code text default null,
  p_error_safe   text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.order_refunds;
  -- 20261016120000 (gap PG-01, the owner's numbers, 2026-11-17): a refund
  -- released for the tenth time is written 'failed' instead, carrying the
  -- release's own reason, so R14 and the admin attention card report it.
  c_max_attempts constant integer := 10;
  v_attempts     integer;
  v_status       text := p_status;
  v_failure_code text := p_failure_code;
  v_error_safe   text := p_error_safe;
begin
  if p_status not in ('succeeded','failed','pending') then
    raise exception 'invalid refund final status %', p_status using errcode = '22023';
  end if;

  -- The cap (20261016120000). claim_order_refund counts an attempt when it
  -- claims, so attempt_count here is the number of attempts made, this one
  -- included. Read under the same fence as the update below; a lost claim
  -- finds no row, leaves v_attempts NULL and is refused below as before.
  if p_status = 'pending' then
    select r.attempt_count into v_attempts
      from public.order_refunds r
     where r.id = p_refund_id and r.status = 'processing' and r.claim_token = p_claim_token
     for update;
    if v_attempts >= c_max_attempts then
      v_status       := 'failed';
      v_failure_code := coalesce(nullif(p_failure_code, ''), 'retry_limit_reached');
      v_error_safe   := 'Automatic refund stopped after ' || v_attempts || ' attempts. Last reason: '
                        || coalesce(nullif(p_error_safe, ''), v_failure_code);
    end if;
  end if;

  update public.order_refunds
     set status       = v_status,
         provider_ref = coalesce(p_provider_ref, provider_ref),
         failure_code = case when v_status = 'succeeded' then null else v_failure_code end,
         last_error_safe = case when v_status = 'succeeded' then null else nullif(left(coalesce(v_error_safe,''), 300), '') end,
         -- The back-off (20261016120000): a released refund is not due again
         -- until refund_retry_delay(attempt_count) has passed. attempt_count
         -- here is the column's value before this update, which is the
         -- attempts made. Cleared on a terminal outcome.
         next_attempt_at = case when v_status = 'pending' then now() + public.refund_retry_delay(attempt_count) else null end,
         -- Every outcome ends the lease: 'succeeded'/'failed' are terminal, and
         -- 'pending' releases the refund so a later run can re-claim it.
         claim_token  = null,
         completed_at = case when p_status = 'succeeded' then now() else completed_at end,
         updated_at   = now()
   where id = p_refund_id and status = 'processing' and claim_token = p_claim_token
   returning * into v_row;

  if not found then
    return false;                          -- lost claim: never touch a foreign lease
  end if;

  update public.orders
     set refund_state = case v_status
                          when 'succeeded' then 'refunded'
                          when 'failed'    then 'failed'
                          else 'pending' end,
         refund_failure_code = case when v_status = 'failed' then v_failure_code else null end,
         updated_at = now()
   where id = v_row.order_id;

  return true;
end $$;

revoke all on function public.finalize_order_refund(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finalize_order_refund(uuid, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. order_integrity_watchdog: R18 REFUND_STUCK
-- ---------------------------------------------------------------------------
-- Re-emitted whole because `create or replace` takes no smaller unit.
-- DERIVED, NOT RETYPED: 20261013120000_payment_refund_visibility.sql, the
-- latest definition, with three anchored substitutions, each asserted to match
-- once: the R18 block inserted at the confirmation_required scope note, the
-- severity line in the incident update (a), and the 'escalated' outbox insert
-- before the recovery insert. R1-R17 are byte-identical. The new code defaults
-- to ENABLED through the existing coalesce((v_rules->>'CODE'),'true') pattern,
-- so no order_integrity_config row is required. Same signature, same ACL.
create or replace function public.order_integrity_watchdog()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  c_lock_key   constant bigint := 748291035;   -- fixed advisory key for this watchdog
  v_run_id     bigint;
  v_start      timestamptz := clock_timestamp();
  v_stage      text := 'init';                  -- which phase failed (for a safe error message)
  v_rules      jsonb;
  v_since      timestamptz;
  v_since_raw  jsonb;
  v_excl_raw   jsonb;
  v_excluded   uuid[];
  v_evaluated  integer := 0;
  v_detected   integer := 0;
  v_opened     integer := 0;
  v_updated    integer := 0;
  v_resolved   integer := 0;
begin
  -- Durable run row FIRST (before any validation) so failures are always visible.
  insert into public.order_integrity_runs (status) values ('running') returning id into v_run_id;

  -- Overlap prevention: skip if another run holds the lock. Recorded as failed
  -- with a benign code so it is visible but does not count as success.
  if not pg_try_advisory_xact_lock(c_lock_key) then
    update public.order_integrity_runs
       set status='failed', completed_at=now(),
           safe_error_code='overlap_skipped',
           safe_error_message='another watchdog run holds the advisory lock',
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;
    return v_run_id;
  end if;

  begin
    -- Load + STRICTLY validate ALL required config keys (fail-CLOSED). Each key
    -- is PRIMARY KEY so at most one row can exist; a missing, null or wrong-typed
    -- value raises into the handler, marking the run failed with a safe config
    -- error — the scanner NEVER silently proceeds without the cutoff/exclusions.
    v_stage := 'config';

    -- rule_enabled: present + JSON object.
    select value into v_rules from public.order_integrity_config where key = 'rule_enabled';
    if v_rules is null then
      raise exception 'config key rule_enabled is missing' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_rules) <> 'object' then
      raise exception 'config key rule_enabled must be a JSON object' using errcode = 'P0001';
    end if;

    -- abandoned_awaiting_payment_since: present + non-null valid timestamp.
    select value into v_since_raw from public.order_integrity_config
      where key = 'abandoned_awaiting_payment_since';
    if v_since_raw is null then
      raise exception 'config key abandoned_awaiting_payment_since is missing' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_since_raw) = 'null' then
      raise exception 'config key abandoned_awaiting_payment_since is null' using errcode = 'P0001';
    end if;
    begin
      v_since := (v_since_raw #>> '{}')::timestamptz;
    exception when others then
      raise exception 'config key abandoned_awaiting_payment_since is not a valid timestamp' using errcode = 'P0001';
    end;
    if v_since is null then
      raise exception 'config key abandoned_awaiting_payment_since is null' using errcode = 'P0001';
    end if;

    -- excluded_order_ids: present + JSON array.
    select value into v_excl_raw from public.order_integrity_config where key = 'excluded_order_ids';
    if v_excl_raw is null then
      raise exception 'config key excluded_order_ids is missing' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_excl_raw) <> 'array' then
      raise exception 'config key excluded_order_ids must be a JSON array' using errcode = 'P0001';
    end if;
    -- FAIL-CLOSED, never fail-OPEN: a malformed entry (missing/blank order_id)
    -- must NOT inject a NULL into v_excluded — `o.id <> all('{null}')` evaluates
    -- to NULL, which would silently suppress EVERY detection for EVERY rule. Skip
    -- entries without a usable order_id and strip any NULL defensively.
    select coalesce(array_remove(array_agg((e->>'order_id')::uuid), null), '{}')
      into v_excluded
      from jsonb_array_elements(v_excl_raw) e
     where nullif(e->>'order_id', '') is not null
       and (e->>'until') is not null
       and (e->>'until')::timestamptz > now();
    v_excluded := coalesce(v_excluded, '{}');

    v_stage := 'scan';

    -- Detections for this run. `if not exists` + truncate so repeated calls in a
    -- single session/transaction (e.g. tests) are safe; `on commit drop` clears
    -- it between real (committed) cron invocations.
    if to_regclass('pg_temp._det') is null then
      create temporary table _det (
        fingerprint       text primary key,
        rule_code         text not null,
        severity          text not null,
        entity_type       text not null,
        order_id          uuid,
        payment_record_id uuid,
        session_id        uuid,
        branch_id         uuid,
        safe_details      jsonb not null
      ) on commit drop;
    end if;
    truncate table _det;
    if to_regclass('pg_temp._resolved') is null then
      create temporary table _resolved (id uuid primary key) on commit drop;
    end if;
    truncate table _resolved;

    -- helper macro (inline): a rule is enabled unless explicitly false.
    -- R1 PAID_ORDER_NOT_SYNCED (critical)
    if coalesce((v_rules->>'PAID_ORDER_NOT_SYNCED'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'PAID_ORDER_NOT_SYNCED:'||o.id, 'PAID_ORDER_NOT_SYNCED', 'critical', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'order_type', o.order_type,
          'lazywait_sync_state', o.lazywait_sync_state, 'sync_attempt_count', o.sync_attempt_count,
          'paid_age_seconds', floor(extract(epoch from (now() - o.paid_at)))::bigint,
          'sync_blocked_reason', o.sync_blocked_reason)
      from public.orders o
      where o.payment_status = 'paid' and o.status <> 'cancelled'
        and o.paid_at is not null and o.paid_at < now() - interval '5 minutes'
        and o.lazywait_sync_state in ('pending','failed','syncing','blocked')
        and coalesce(o.sync_blocked_reason,'') <> 'delivery_schema_unconfirmed'
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R2 PAID_ORDER_AWAITING_PAYMENT (critical)
    if coalesce((v_rules->>'PAID_ORDER_AWAITING_PAYMENT'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'PAID_ORDER_AWAITING_PAYMENT:'||o.id, 'PAID_ORDER_AWAITING_PAYMENT', 'critical', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'order_type', o.order_type,
          'lazywait_sync_state', o.lazywait_sync_state,
          'paid_age_seconds', floor(extract(epoch from (now() - o.paid_at)))::bigint)
      from public.orders o
      where o.payment_status = 'paid' and o.lazywait_sync_state = 'awaiting_payment'
        and o.status <> 'cancelled' and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R3 CAPTURED_PAYMENT_WITHOUT_ORDER (critical) — DB-invariant variant.
    if coalesce((v_rules->>'CAPTURED_PAYMENT_WITHOUT_ORDER'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'CAPTURED_PAYMENT_WITHOUT_ORDER:'||pr.id, 'CAPTURED_PAYMENT_WITHOUT_ORDER', 'critical', 'payment',
        pr.order_id, pr.id, pr.checkout_session_id, null,
        jsonb_build_object('provider', pr.provider,
          'capture_age_seconds', floor(extract(epoch from (now() - coalesce(pr.confirmed_at, pr.updated_at))))::bigint,
          'has_order_id', (pr.order_id is not null),
          'ref_fingerprint', md5(pr.provider||':'||coalesce(pr.provider_ref, pr.reference_transaction, '')))
      from public.payment_records pr
      where pr.status = 'paid'
        and coalesce(pr.confirmed_at, pr.updated_at) < now() - interval '3 minutes'
        and not exists (select 1 from public.orders o
                         where o.id = pr.order_id and o.payment_status = 'paid')
        -- honor per-order exclusions (keeps genuinely order-less captures)
        and (pr.order_id is null or pr.order_id <> all (v_excluded))
      on conflict do nothing;
    end if;

    -- R4 PAYMENT_AMOUNT_MISMATCH (critical) — currency-safe numeric compare.
    if coalesce((v_rules->>'PAYMENT_AMOUNT_MISMATCH'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'PAYMENT_AMOUNT_MISMATCH:'||pr.id, 'PAYMENT_AMOUNT_MISMATCH', 'critical', 'payment',
        o.id, pr.id, pr.checkout_session_id, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'provider', pr.provider,
          'captured_amount', round(pr.amount, 2), 'order_total', round(o.total, 2),
          'currency', pr.currency)
      from public.payment_records pr
      join public.orders o on o.id = pr.order_id
      where pr.status = 'paid' and round(pr.amount, 2) is distinct from round(o.total, 2)
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R5 DUPLICATE_PROVIDER_REFERENCE (critical) — one paid ref on >1 order.
    if coalesce((v_rules->>'DUPLICATE_PROVIDER_REFERENCE'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det
      select
        'DUPLICATE_PROVIDER_REFERENCE:'||g.ref_fp, 'DUPLICATE_PROVIDER_REFERENCE', 'critical', 'payment',
        null, null, null, null,
        jsonb_build_object('provider', g.provider, 'ref_fingerprint', g.ref_fp,
          'distinct_orders', g.n_orders)
      from (
        select pr.provider,
               md5(pr.provider||':'||coalesce(pr.reference_transaction, pr.provider_ref)) as ref_fp,
               count(distinct pr.order_id) as n_orders
        from public.payment_records pr
        where pr.status = 'paid' and coalesce(pr.reference_transaction, pr.provider_ref) is not null
          -- Honor per-order exclusions BEFORE grouping: an excluded (authorized
          -- test) order must not contribute to the distinct-order count, or it
          -- could push a clean production order's shared reference over the
          -- threshold and open a false DUPLICATE_PROVIDER_REFERENCE incident.
          and (pr.order_id is null or pr.order_id <> all (v_excluded))
        group by pr.provider, md5(pr.provider||':'||coalesce(pr.reference_transaction, pr.provider_ref))
        having count(distinct pr.order_id) > 1
      ) g
      on conflict do nothing;
    end if;

    -- R6 MULTIPLE_SUCCESSFUL_CAPTURES (critical) — >1 paid record per order.
    if coalesce((v_rules->>'MULTIPLE_SUCCESSFUL_CAPTURES'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det
      select
        'MULTIPLE_SUCCESSFUL_CAPTURES:'||g.order_id, 'MULTIPLE_SUCCESSFUL_CAPTURES', 'critical', 'order',
        g.order_id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'paid_capture_count', g.n)
      from (
        select pr.order_id, count(*) as n
        from public.payment_records pr
        where pr.status = 'paid' and pr.order_id is not null
        group by pr.order_id having count(*) > 1
      ) g
      join public.orders o on o.id = g.order_id
      where g.order_id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R7 PAID_ORDER_DEAD_LETTER (critical)
    if coalesce((v_rules->>'PAID_ORDER_DEAD_LETTER'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'PAID_ORDER_DEAD_LETTER:'||o.id, 'PAID_ORDER_DEAD_LETTER', 'critical', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'sync_attempt_count', o.sync_attempt_count,
          -- sync_last_error is set from safeErr(provider error), which only redacts
          -- Bearer tokens; a provider error body can echo our request (customer_name).
          -- Store only a boolean signal, never the raw text, to keep safe_details PII-free.
          'has_last_error', (o.sync_last_error is not null))
      from public.orders o
      where o.payment_status = 'paid'
        and o.lazywait_sync_state = 'dead_letter' and o.status <> 'cancelled'
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R8 SYNCED_WITHOUT_USABLE_REFERENCE (critical)
    if coalesce((v_rules->>'SYNCED_WITHOUT_USABLE_REFERENCE'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'SYNCED_WITHOUT_USABLE_REFERENCE:'||o.id, 'SYNCED_WITHOUT_USABLE_REFERENCE', 'critical', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'lazywait_sync_state', o.lazywait_sync_state,
          'has_ref_marker', (o.lazywait_ref is not null))
      from public.orders o
      where o.lazywait_sync_state = 'synced'
        and not public.lazywait_pos_ref_is_usable(o.lazywait_ref)
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R9 REFERENCE_WITH_NON_SYNCED_STATE (critical)
    if coalesce((v_rules->>'REFERENCE_WITH_NON_SYNCED_STATE'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'REFERENCE_WITH_NON_SYNCED_STATE:'||o.id, 'REFERENCE_WITH_NON_SYNCED_STATE', 'critical', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'lazywait_sync_state', o.lazywait_sync_state)
      from public.orders o
      where public.lazywait_pos_ref_is_usable(o.lazywait_ref)
        and o.lazywait_sync_state is distinct from 'synced'
        and o.status <> 'cancelled'
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R10 OVERDUE_SYNC_RETRY (warning) — due AND overdue >10m; never before due.
    if coalesce((v_rules->>'OVERDUE_SYNC_RETRY'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'OVERDUE_SYNC_RETRY:'||o.id, 'OVERDUE_SYNC_RETRY', 'warning', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'lazywait_sync_state', o.lazywait_sync_state,
          'overdue_seconds', floor(extract(epoch from (now() - coalesce(o.sync_next_attempt_at, o.updated_at))))::bigint,
          'sync_attempt_count', o.sync_attempt_count)
      from public.orders o
      where o.lazywait_sync_state in ('pending','failed') and o.status <> 'cancelled'
        and (o.sync_next_attempt_at is null or o.sync_next_attempt_at <= now())
        and coalesce(o.sync_next_attempt_at, o.updated_at) < now() - interval '10 minutes'
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R11 ABANDONED_AWAITING_PAYMENT (warning) — unpaid >24h, legacy excluded.
    if coalesce((v_rules->>'ABANDONED_AWAITING_PAYMENT'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'ABANDONED_AWAITING_PAYMENT:'||o.id, 'ABANDONED_AWAITING_PAYMENT', 'warning', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number,
          'age_hours', floor(extract(epoch from (now() - o.created_at))/3600)::bigint)
      from public.orders o
      where o.lazywait_sync_state = 'awaiting_payment'
        and o.payment_status is distinct from 'paid'
        and o.status <> 'cancelled'
        and o.created_at < now() - interval '24 hours'
        and (v_since is null or o.created_at >= v_since)
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R12 UNPAID_ORDER_NOT_SYNCED (critical) — the cash blind spot.
    -- R1 requires payment_status='paid' and a non-null paid_at. A cash order is
    -- 'pending' with paid_at NULL for its entire life, so R1 cannot see it —
    -- which is why SM-2026-000057 died silently and why three orders sat blocked
    -- for ~18 days raising nothing. This is R1 for the population R1 excludes.
    --
    -- SCOPED TO ('syncing','blocked') DELIBERATELY, and this is the whole design.
    -- R10 OVERDUE_SYNC_RETRY carries NO payment filter, so cash orders in
    -- 'pending'/'failed' are ALREADY covered by it, at warning severity. Adding
    -- them here would double-report every one of them under two rule codes.
    -- 'syncing' and 'blocked' are the states R10 excludes and R1 cannot reach —
    -- the actual gap. Whether a stuck 'pending' cash order deserves critical
    -- rather than warning is a severity POLICY question, not a coverage gap, and
    -- is left to the owner rather than changed quietly here.
    --
    -- The clock is created_at, not paid_at, because there is no payment moment.
    -- 15 minutes is far past the observed 5-8 SECOND happy path, so a match
    -- means the order is genuinely not arriving.
    --
    -- The delivery_schema_unconfirmed exclusion is load-bearing and is the same
    -- one R1 carries: four historical orders are deliberately parked with that
    -- reason and are not_retryable. Measured before this was written — with the
    -- exclusion the rule matches 0 rows today, without it exactly those 4.
    if coalesce((v_rules->>'UNPAID_ORDER_NOT_SYNCED'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'UNPAID_ORDER_NOT_SYNCED:'||o.id, 'UNPAID_ORDER_NOT_SYNCED', 'critical', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'order_type', o.order_type,
          'payment_method', o.payment_method,
          'lazywait_sync_state', o.lazywait_sync_state, 'sync_attempt_count', o.sync_attempt_count,
          'age_minutes', floor(extract(epoch from (now() - o.created_at))/60)::bigint,
          'sync_blocked_reason', o.sync_blocked_reason)
      from public.orders o
      where o.payment_status is distinct from 'paid' and o.status <> 'cancelled'
        and o.created_at < now() - interval '15 minutes'
        and o.lazywait_sync_state in ('syncing','blocked')
        and coalesce(o.sync_blocked_reason,'') <> 'delivery_schema_unconfirmed'
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R13 UNPAID_ORDER_DEAD_LETTER (critical) — R7 for the same population.
    -- No age threshold, matching R7: dead_letter is terminal, reached only after
    -- retries are exhausted, so it is wrong the moment it exists.
    -- sync_last_error is reduced to a boolean for the same reason R7 does it: the
    -- provider error body can echo our request, which carries customer_name.
    if coalesce((v_rules->>'UNPAID_ORDER_DEAD_LETTER'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'UNPAID_ORDER_DEAD_LETTER:'||o.id, 'UNPAID_ORDER_DEAD_LETTER', 'critical', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'order_type', o.order_type,
          'payment_method', o.payment_method,
          'sync_attempt_count', o.sync_attempt_count,
          'has_last_error', (o.sync_last_error is not null))
      from public.orders o
      where o.payment_status is distinct from 'paid'
        and o.lazywait_sync_state = 'dead_letter' and o.status <> 'cancelled'
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- ---- R14-R17: refunds and payments that need a person (20261013120000) ----
    -- Each is a DEFINITE event the payment code already records, with no age or
    -- count threshold: whether, and how soon, a person must act is not decided
    -- here. Each incident ends only when the record itself moves on, never on
    -- acknowledgement ("Acknowledge is not Fixed", docs/ORDER_INTEGRITY_WATCHDOG.md
    -- section 7). A refund made by hand in Moyasar's dashboard is recorded
    -- nowhere today (gap PG-14, an owner decision), so after one the incident
    -- stays open until that is decided.

    -- R14 REFUND_FAILED (critical) — an automatic refund gave up. A 'failed'
    -- order_refunds row is terminal for that row: the worker writes it for a
    -- definite rejection, a refund it can never send (missing_charge_reference,
    -- unsupported_provider), an answer it cannot reconcile
    -- (refund_ambiguous_needs_review), or a lease nobody finished
    -- (lease_expired). One incident per ORDER. It ends when a newer refund row
    -- for the order is pending, processing or succeeded (a deliberate retry),
    -- or when the order's refund_state reads 'refunded'. The error text is
    -- reduced to a boolean, the R7 precedent: safe_details stays PII-free.
    if coalesce((v_rules->>'REFUND_FAILED'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'REFUND_FAILED:'||o.id, 'REFUND_FAILED', 'critical', 'order',
        o.id, r.payment_record_id, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number,
          'failure_code', r.failure_code, 'attempt_count', r.attempt_count,
          'amount', round(r.amount, 2), 'currency', r.currency,
          'failed_age_seconds', floor(extract(epoch from (now() - r.updated_at)))::bigint,
          'has_last_error', (r.last_error_safe is not null))
      from (
        select distinct on (fr.order_id) fr.*
          from public.order_refunds fr
         where fr.status = 'failed'
         order by fr.order_id, fr.updated_at desc, fr.created_at desc, fr.id desc
      ) r
      join public.orders o on o.id = r.order_id
      where not exists (select 1 from public.order_refunds lr
                         where lr.order_id = r.order_id
                           and lr.status in ('pending','processing','succeeded'))
        and o.refund_state is distinct from 'refunded'
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R15 DUPLICATE_PAYMENT_RECORDED (critical) — a second payment for
    -- something already paid. moyasarVerify.ts records it as a 'failed'
    -- payment_records row with failure_code 'duplicate_payment', deliberately
    -- never 'paid', so R6 (paid rows only) cannot see it. Nothing refunds it
    -- automatically (refund draft D2 is the owner's decision); a person
    -- refunds it in Moyasar's dashboard (docs/PAYMENTS.md section 10). It ends
    -- when the row is no longer a failed duplicate, for example 'refunded'.
    if coalesce((v_rules->>'DUPLICATE_PAYMENT_RECORDED'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'DUPLICATE_PAYMENT_RECORDED:'||pr.id, 'DUPLICATE_PAYMENT_RECORDED', 'critical', 'payment',
        pr.order_id, pr.id, pr.checkout_session_id, o.branch_id,
        jsonb_build_object('provider', pr.provider, 'order_number', o.order_number,
          'has_order_id', (pr.order_id is not null),
          'amount', round(pr.amount, 2), 'currency', pr.currency,
          'age_seconds', floor(extract(epoch from (now() - pr.created_at)))::bigint,
          'ref_fingerprint', md5(pr.provider||':'||coalesce(pr.provider_ref, '')))
      from public.payment_records pr
      left join public.orders o on o.id = pr.order_id
      where pr.status = 'failed' and pr.failure_code = 'duplicate_payment'
        and (pr.order_id is null or pr.order_id <> all (v_excluded))
      on conflict do nothing;
    end if;

    -- R16 PAYMENT_VERIFICATION_MISMATCH (critical) — Moyasar reports the
    -- payment settled, but its invoice, amount, currency or mode does not
    -- match the attempt, so it confirmed nothing. moyasarVerify.ts marks the
    -- attempt 'failed' with failure_code 'verification_mismatch' and never
    -- stamps the payment id on it; the sanitized payment's id is in raw. It
    -- ends when the row is no longer a failed mismatch.
    if coalesce((v_rules->>'PAYMENT_VERIFICATION_MISMATCH'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'PAYMENT_VERIFICATION_MISMATCH:'||pr.id, 'PAYMENT_VERIFICATION_MISMATCH', 'critical', 'payment',
        pr.order_id, pr.id, pr.checkout_session_id, o.branch_id,
        jsonb_build_object('provider', pr.provider, 'order_number', o.order_number,
          'has_order_id', (pr.order_id is not null),
          'amount', round(pr.amount, 2), 'currency', pr.currency,
          'age_seconds', floor(extract(epoch from (now() - pr.created_at)))::bigint,
          'ref_fingerprint', md5(pr.provider||':'||coalesce(pr.provider_ref, pr.raw->>'id', '')))
      from public.payment_records pr
      left join public.orders o on o.id = pr.order_id
      where pr.status = 'failed' and pr.failure_code = 'verification_mismatch'
        and (pr.order_id is null or pr.order_id <> all (v_excluded))
      on conflict do nothing;
    end if;

    -- R17 PAYMENT_CONFIRMATION_FAILED (critical) — Moyasar took the money and
    -- our confirmation failed. moyasarVerify.ts logs error 'finalize_failed'
    -- when finalize_checkout_session errors on the session path (no order is
    -- created) and 'confirm_failed' when confirm_order_payment errors on the
    -- order path (the order is not marked paid). Each writes only an
    -- integration_sync_logs row and leaves the attempt 'initiated', so R3
    -- (paid rows only) cannot see it. One incident per PAYMENT, fingerprinted
    -- like R5, so the payment id itself never enters watchdog tables: a
    -- webhook and two verifies can log the same payment three times. It ends
    -- when a payment_records row carrying the payment id is 'paid' (a later
    -- verify confirmed it) or 'refunded', or has become a duplicate or
    -- mismatch record, which R15/R16 then report.
    if coalesce((v_rules->>'PAYMENT_CONFIRMATION_FAILED'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'PAYMENT_CONFIRMATION_FAILED:'||md5('moyasar:'||g.payment_ref),
        'PAYMENT_CONFIRMATION_FAILED', 'critical', 'payment',
        o.id, att.id, att.checkout_session_id, o.branch_id,
        jsonb_build_object('provider', 'moyasar', 'error', g.error,
          'order_number', o.order_number, 'has_order_id', (o.id is not null),
          'log_count', g.log_count,
          'first_logged_age_seconds', floor(extract(epoch from (now() - g.first_logged_at)))::bigint,
          'ref_fingerprint', md5('moyasar:'||g.payment_ref))
      from (
        select l.request->>'payment_id' as payment_ref,
               (array_agg(l.error order by l.created_at desc))[1] as error,
               (array_agg(l.order_id order by l.created_at desc)
                  filter (where l.order_id is not null))[1] as order_id,
               count(*)::integer as log_count,
               min(l.created_at) as first_logged_at
          from public.integration_sync_logs l
         where l.provider = 'moyasar' and l.status = 'failed'
           and l.error in ('finalize_failed', 'confirm_failed')
           and coalesce(l.request->>'payment_id', '') <> ''
         group by l.request->>'payment_id'
      ) g
      left join public.orders o on o.id = g.order_id
      left join lateral (
        select pr.id, pr.checkout_session_id
          from public.payment_records pr
         where pr.provider = 'moyasar' and pr.provider_ref = g.payment_ref
         limit 1
      ) att on true
      where not exists (
              select 1 from public.payment_records pr
               where pr.provider = 'moyasar' and pr.provider_ref = g.payment_ref
                 and (pr.status in ('paid','refunded')
                      or pr.failure_code in ('duplicate_payment','verification_mismatch')))
        and (g.order_id is null or g.order_id <> all (v_excluded))
      on conflict do nothing;
    end if;

    -- R18 REFUND_STUCK (warning, then critical; 20261016120000) — a refund the
    -- worker has tried and released, still 'pending'. The owner's thresholds
    -- (gap PG-01, 2026-11-17): a warning once the refund has been open for
    -- more than 1 hour, a critical once more than 24 hours, measured from
    -- order_refunds.created_at, the moment it was opened. A refund never tried
    -- (attempt_count 0) is waiting for its first run and raises nothing here.
    -- The back-off stops a refund at 10 attempts, after about 23 hours of
    -- waiting on the 5-minute schedule, and R14 reports it from then on, so the
    -- critical tier mostly means the worker has not been running. One incident
    -- per ORDER (order_refunds_one_active_uq allows one live refund per order);
    -- its severity follows the age, which the update in (a) carries over.
    -- The error text is reduced to a boolean, the R7 precedent.
    if coalesce((v_rules->>'REFUND_STUCK'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'REFUND_STUCK:'||o.id, 'REFUND_STUCK',
        case when r.created_at < now() - interval '24 hours' then 'critical' else 'warning' end,
        'order', o.id, r.payment_record_id, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number,
          'failure_code', r.failure_code, 'attempt_count', r.attempt_count,
          'amount', round(r.amount, 2), 'currency', r.currency,
          'refund_age_seconds', floor(extract(epoch from (now() - r.created_at)))::bigint,
          'next_attempt_in_seconds',
            greatest(0, floor(extract(epoch from (coalesce(r.next_attempt_at, now()) - now()))))::bigint,
          'has_last_error', (r.last_error_safe is not null))
      from public.order_refunds r
      join public.orders o on o.id = r.order_id
      where r.status = 'pending' and r.attempt_count >= 1
        and r.created_at < now() - interval '1 hour'
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- DELIBERATE SCOPE NOTE — lazywait_sync_state='confirmation_required' is NOT a
    -- watchdog rule. It is the DESIGNED human-verification resting place for
    -- ambiguous POS create outcomes (auto-retry intentionally disabled), and it
    -- already has a purpose-built operational surface: list_pos_confirmation_required()
    -- and the admin "Orders Requiring Verification" feed (migration 20260721120000).
    -- Unlike dead_letter (a "gave up" state with no other surface → safety-net R7),
    -- confirmation_required is actively surfaced elsewhere, so it is intentionally
    -- not duplicated here. A warning-level rule for paid orders stuck in it past the
    -- POS deadline is a documented v2 candidate (see docs/ORDER_INTEGRITY_WATCHDOG.md),
    -- pending owner approval. (That sentence read "this v1 stays at the approved
    -- 11-rule scope" when copied from 20260827130000; this file adds R12/R13, so
    -- the scope is now 13. The confirmation_required exclusion above is unchanged.)

    select count(*) into v_detected from _det;

    -- (a) Update existing ACTIVE incidents that re-detected this run.
    with upd as (
      update public.order_integrity_incidents i
         set last_detected_at = now(),
             occurrence_count = i.occurrence_count + 1,
             consecutive_detection_count = i.consecutive_detection_count + 1,
             consecutive_clean_count = 0,
             status = case when i.status = 'suppressed'
                            and (i.suppression_until is null or i.suppression_until <= now())
                           then 'open' else i.status end,
             -- 20261016120000: the severity is the detection's. For R1-R17 it is
             -- fixed by the rule code, so this changes nothing for them; R18
             -- rises from warning to critical as its refund ages, and the
             -- incident must say so, because order_integrity_health_summary
             -- counts unresolved incidents by severity.
             severity = d.severity,
             safe_details = d.safe_details,
             updated_at = now()
        from _det d
       where i.fingerprint = d.fingerprint and i.status <> 'resolved'
      returning i.id )
    select count(*) into v_updated from upd;

    -- (b) Open NEW incidents for detections without an active incident.
    with ins as (
      insert into public.order_integrity_incidents
        (fingerprint, rule_code, severity, entity_type, order_id, payment_record_id, session_id, branch_id, status, safe_details)
      select d.fingerprint, d.rule_code, d.severity, d.entity_type, d.order_id, d.payment_record_id, d.session_id, d.branch_id, 'open', d.safe_details
        from _det d
       where not exists (select 1 from public.order_integrity_incidents i
                          where i.fingerprint = d.fingerprint and i.status <> 'resolved')
      returning id )
    select count(*) into v_opened from ins;

    -- (c) Clean/resolve ACTIVE incidents NOT detected this run (enabled rules
    --     only). Resolve ONLY after two consecutive clean scans.
    with cleaned as (
      update public.order_integrity_incidents i
         set consecutive_clean_count = i.consecutive_clean_count + 1,
             consecutive_detection_count = 0,
             status = case when i.consecutive_clean_count + 1 >= 2 then 'resolved' else i.status end,
             resolved_at = case when i.consecutive_clean_count + 1 >= 2 then now() else i.resolved_at end,
             resolution_reason = case when i.consecutive_clean_count + 1 >= 2
                                      then 'auto_two_consecutive_clean_scans' else i.resolution_reason end,
             updated_at = now()
       where i.status <> 'resolved'
         and not exists (select 1 from _det d where d.fingerprint = i.fingerprint)
         and coalesce((v_rules->>i.rule_code), 'true') <> 'false'
      returning i.id, (i.status = 'resolved') as just_resolved ),
    r as ( insert into _resolved (id) select id from cleaned where just_resolved returning id )
    select count(*) into v_resolved from r;

    -- (d) Alert eligibility -> outbox (POPULATED ONLY; never dispatched in v1).
    --     'opened' once per incident (until it resolves), for non-suppressed
    --     active incidents: critical after >=2 consecutive detections; warning
    --     after persisting >=15 minutes. Dedup: not exists any opened row for
    --     the incident (cooldown for the incident's lifetime).
    insert into public.order_integrity_alert_outbox (incident_id, alert_type, severity, payload_safe)
    select i.id, 'opened', i.severity,
           jsonb_build_object('rule_code', i.rule_code, 'fingerprint', i.fingerprint,
             'severity', i.severity, 'first_detected_at', i.first_detected_at,
             -- strip admin-entered free text (ack_note): it is potential PII and is
             -- already redacted from non-admin staff, so it must never enter the
             -- (future-dispatchable) alert outbox.
             'occurrence_count', i.occurrence_count, 'safe_details', (i.safe_details - 'ack_note'))
      from public.order_integrity_incidents i
     where i.status in ('open','acknowledged')
       and (i.suppression_until is null or i.suppression_until <= now())
       and (
         (i.severity = 'critical' and i.consecutive_detection_count >= 2)
         or (i.severity = 'warning' and now() - i.first_detected_at >= interval '15 minutes')
       )
       and not exists (select 1 from public.order_integrity_alert_outbox a
                        where a.incident_id = i.id and a.alert_type = 'opened')
    on conflict do nothing;

    --     'escalated' (20261016120000) once, when an incident whose 'opened'
    --     alert was written at warning has turned critical. R18 is the only rule
    --     whose severity rises (see (a)).
    insert into public.order_integrity_alert_outbox (incident_id, alert_type, severity, payload_safe)
    select i.id, 'escalated', i.severity,
           jsonb_build_object('rule_code', i.rule_code, 'fingerprint', i.fingerprint,
             'severity', i.severity, 'first_detected_at', i.first_detected_at,
             'occurrence_count', i.occurrence_count, 'safe_details', (i.safe_details - 'ack_note'))
      from public.order_integrity_incidents i
     where i.status in ('open','acknowledged')
       and (i.suppression_until is null or i.suppression_until <= now())
       and i.severity = 'critical'
       and exists (select 1 from public.order_integrity_alert_outbox a
                    where a.incident_id = i.id and a.alert_type = 'opened' and a.severity = 'warning')
       and not exists (select 1 from public.order_integrity_alert_outbox a
                        where a.incident_id = i.id and a.alert_type = 'escalated')
    on conflict do nothing;

    --     'recovery' when a previously alert-eligible incident resolves THIS run
    --     (identified by id via _resolved, not a timestamp compare).
    insert into public.order_integrity_alert_outbox (incident_id, alert_type, severity, payload_safe)
    select i.id, 'recovery', i.severity,
           jsonb_build_object('rule_code', i.rule_code, 'fingerprint', i.fingerprint,
             'resolved_at', i.resolved_at, 'resolution_reason', i.resolution_reason)
      from public.order_integrity_incidents i
      join _resolved rr on rr.id = i.id
     where exists (select 1 from public.order_integrity_alert_outbox a
                    where a.incident_id = i.id and a.alert_type in ('opened','escalated'))
       and not exists (select 1 from public.order_integrity_alert_outbox a
                    where a.incident_id = i.id and a.alert_type = 'recovery')
    on conflict do nothing;

    -- Success.
    update public.order_integrity_runs
       set status='success', completed_at=now(),
           rules_evaluated=v_evaluated, incidents_detected=v_detected,
           incidents_opened=v_opened, incidents_updated=v_updated, incidents_resolved=v_resolved,
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;
    return v_run_id;

  exception when others then
    -- Fail-closed: mark the run failed with a SQLSTATE-only safe code and a
    -- stage-scoped (never PII-bearing) message. The inner block's changes
    -- (incident upserts/resolutions) roll back to the implicit savepoint, so NO
    -- incident is resolved on a failed run. A config-stage failure surfaces as a
    -- configuration error (safe_error_code = SQLSTATE, never 'overlap_skipped'),
    -- which the health summary classifies as configuration_error.
    update public.order_integrity_runs
       set status='failed', completed_at=now(),
           safe_error_code = sqlstate,
           safe_error_message = left(
             case when v_stage = 'config' then 'watchdog configuration invalid'
                  else 'watchdog rule evaluation failed' end, 200),
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;
    return v_run_id;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 5. operations_health_snapshot_internal: the payment card counts R18
-- ---------------------------------------------------------------------------
-- Re-emitted whole because `create or replace` takes no smaller unit.
-- DERIVED, NOT RETYPED: 20261013120000_payment_refund_visibility.sql, the
-- latest definition, with one anchored substitution, asserted to match once:
-- REFUND_STUCK added to the payment card's incident list. Everything else,
-- the \u escapes in the payment card's configuration read included, is
-- byte-identical; the transport has decoded those escapes at or above U+0020
-- before (ledger rows 111 and 115), which changes the stored text and not its
-- value, and the guard above accepts both forms.
create or replace function public.operations_health_snapshot_internal()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_generated_at timestamptz := now();

  v_lazywait jsonb;
  v_order_integrity jsonb;
  v_lazywait_state text := 'unavailable';
  v_integrity_state text := 'unavailable';

  v_jobs jsonb := '[]'::jsonb;
  v_database_jobs_state text := 'unavailable';
  -- Rollup over the NON-critical automation crons only (evaluator + digest).
  -- Kept separate from v_database_jobs_state so it never affects overall state.
  v_automation_jobs_state text := 'unavailable';
  v_jobs_error_code text;

  v_ad_active boolean := false;
  v_ad_latest_status text;
  v_ad_latest_run_at timestamptz;
  v_ad_latest_success_at timestamptz;
  v_ad_latest_terminal_status text;
  v_ad_latest_terminal_at timestamptz;
  v_ad_due_count integer := 0;
  v_ad_manual_review integer := 0;
  v_ad_oldest_due timestamptz;
  v_ad_counts jsonb := '{}'::jsonb;
  v_ad_state text := 'unavailable';
  v_ad_error_code text;

  v_payment_exists boolean := false;
  v_payment_enabled boolean := false;
  v_payment_configured boolean := false;
  v_payment_provider text;
  v_payment_mode text;
  v_payment_currency text;
  v_payment_updated_at timestamptz;
  v_payment_counts_24h jsonb := '{}'::jsonb;
  v_payment_stale_initiated integer := 0;
  v_payment_oldest_stale timestamptz;
  v_payment_open_unverified integer := 0;
  v_payment_oldest_initiated timestamptz;
  v_payment_latest_paid timestamptz;
  v_payment_integrity_critical integer := 0;
  v_payment_state text := 'unavailable';
  v_payment_error_code text;

  v_push_exists boolean := false;
  v_push_enabled boolean := false;
  v_push_configured boolean := false;
  v_push_provider text;
  v_push_updated_at timestamptz;
  v_push_active_devices integer := 0;
  v_push_promos_opt_in integer := 0;
  v_push_log_counts jsonb := '{}'::jsonb;
  v_push_failed_deliveries_24h integer := 0;
  v_push_failed_events_24h integer := 0;
  v_push_latest_log timestamptz;
  v_push_state text := 'unavailable';
  v_push_error_code text;

  v_email_exists boolean := false;
  v_email_enabled boolean := false;
  v_email_configured boolean := false;
  v_email_provider text;
  v_email_updated_at timestamptz;
  v_email_state text := 'unavailable';
  v_email_error_code text;

  v_otp_exists boolean := false;
  v_otp_enabled boolean := false;
  v_otp_configured boolean := false;
  v_otp_provider text;
  v_otp_updated_at timestamptz;
  v_otp_state text := 'unavailable';
  v_otp_error_code text;

  v_systems jsonb := '[]'::jsonb;
  v_attention jsonb := '[]'::jsonb;
  v_overall_state text := 'healthy';
  v_critical_attention integer := 0;

  -- Order flow (added 20260807). Deliberately declared with the other rollup
  -- state so it is obvious this participates in overall_state.
  v_of_state           text := 'unavailable';
  v_of_window_minutes  integer := 60;
  v_of_recent          integer := 0;
  v_of_open_branches   integer := 0;
  v_of_total_branches  integer := 0;
  v_of_baseline        numeric;
  v_of_samples         integer := 0;
  v_of_min_samples     constant integer := 3;
  v_of_error_code      text;
  v_warning_attention integer := 0;
  v_unavailable integer := 0;
  v_disabled integer := 0;
  v_not_configured integer := 0;
  v_not_monitored integer := 0;
  -- Branch availability (20260820160000). NON-critical: a stalled sweeper
  -- over-blocks and never over-sells, so it must be loud without being able to
  -- turn the platform red. Deliberately absent from `critical_systems` and from
  -- the operations_health_overall_state() call below.
  v_ba_state           text := 'unavailable';
  v_ba_closed_products integer := 0;
  v_ba_closed_options  integer := 0;
  v_ba_closed_sizes    integer := 0;
  v_ba_paused_branches integer := 0;
  v_ba_disabled_areas  integer := 0;
  v_ba_untimed         integer := 0;
  v_ba_overdue         integer := 0;
  v_ba_worst_minutes   integer := 0;
  v_ba_latest_run_at   timestamptz;
  v_ba_latest_status   text;
  v_ba_latest_success  timestamptz;
  v_ba_ledger_failing  boolean := false;
  v_ba_runs_seen       boolean := false;
  v_ba_error_code      text;
  c_ba_overdue_grace   constant interval := interval '5 minutes';
  c_ba_stalled_after   constant interval := interval '30 minutes';
begin
  -- Existing authoritative health functions remain the source of truth. Dynamic
  -- invocation allows a missing/temporarily unavailable source to fail only its
  -- own card rather than the entire Operations Health Center.
  begin
    execute 'select public.lazywait_sync_health_summary()' into v_lazywait;
    v_lazywait_state := coalesce(v_lazywait->>'overall_state', 'unavailable');
  exception when others then
    v_lazywait := jsonb_build_object(
      'overall_state', 'unavailable',
      'safe_error_code', sqlstate
    );
    v_lazywait_state := 'unavailable';
  end;

  begin
    execute 'select public.order_integrity_health_summary()' into v_order_integrity;
    v_integrity_state := coalesce(v_order_integrity->>'overall_state', 'unavailable');
  exception when others then
    v_order_integrity := jsonb_build_object(
      'overall_state', 'unavailable',
      'safe_error_code', sqlstate
    );
    v_integrity_state := 'unavailable';
  end;

  -- Allowlisted pg_cron jobs only. Commands, usernames, databases and return
  -- messages are deliberately excluded from the safe projection. Each expected
  -- job carries its own staleness tolerance (`stale_after`) sized to its cadence:
  -- the every-1–2-minute critical jobs keep the original 6-minute window, while
  -- the sparser automation crons get windows that survive one full missed tick
  -- (evaluator */5 -> 15m; hourly digest -> 130m) so a healthy-but-idle job
  -- between ticks is never mislabelled failing. `is_critical` marks the three
  -- application jobs whose health feeds the overall platform state; the three
  -- automation crons are non-critical (optional) observability.
  --
  -- `branch-availability-sweep` (20260820111000) is deliberately NON-critical.
  -- It reopens expired item/option snoozes and delivery pauses; if it stops,
  -- things stay closed longer than intended, which is fail-safe. That is worth
  -- a warning, not a platform-red.
  begin
    with expected(jobname, subsystem, expected_schedule, is_critical, stale_after) as (
      values
        ('account-deletion-processor'::text, 'account_deletion'::text, '* * * * *'::text, true,  interval '6 minutes'),
        ('lazywait-sync'::text,              'lazywait'::text,         '* * * * *'::text, true,  interval '6 minutes'),
        ('order-integrity-watchdog'::text,   'order_integrity'::text,  '*/2 * * * *'::text, true, interval '6 minutes'),
        ('operations-alerts-evaluator'::text,'operations_alerts'::text,'*/5 * * * *'::text, false, interval '15 minutes'),
        ('operations-digest-generator'::text,'operations_digest'::text,'0 * * * *'::text,   false, interval '130 minutes'),
        ('branch-availability-sweep'::text,  'branch_availability'::text,'* * * * *'::text, false, interval '6 minutes')
    ),
    snap as (
      select
        e.jobname, e.subsystem, e.expected_schedule, e.is_critical,
        j.jobid, j.schedule, coalesce(j.active, false) as active,
        -- latest-any: the newest run of any kind (may be an in-flight `running`
        -- row with a null end_time). Used ONLY for safe display.
        lr.status as latest_status, lr.start_time as latest_run_at,
        lr.end_time as latest_completed_at,
        -- latest-terminal: the most recently COMPLETED run (end_time not null).
        -- Used to decide whether a recent execution actually failed. pg_cron marks
        -- an in-flight run `running` with a null end_time; such a row is never a
        -- failure and never hides an earlier terminal failure.
        lt.status as latest_terminal_status, lt.end_time as latest_terminal_at,
        ls.end_time as latest_success_at,
        case
          when j.jobid is null or not coalesce(j.active, false) then 'failing'
          -- A recent TERMINAL non-success (e.g. `failed`) is a real failure and is
          -- checked BEFORE the no-success fallback, so a first completed run that
          -- fails (before any success ever exists) reads `failing`, not `degraded`.
          -- A newer terminal success clears an older terminal failure because lt is
          -- the most recently completed run; a `running` row has no end_time and is
          -- excluded from lt, so it never fails the job. The recency window is the
          -- job's own per-cadence tolerance, so a sparse job's older-but-cleared
          -- failure is not held against it forever.
          when lt.status is not null and lt.status <> 'succeeded'
               and lt.end_time >= now() - e.stale_after then 'failing'
          -- No completed successful run yet (and no recent terminal failure above):
          -- conservative first-run / retained-history-gap state.
          when ls.end_time is null then 'degraded'
          when now() - ls.end_time > e.stale_after then 'failing'
          when j.schedule is distinct from e.expected_schedule then 'degraded'
          else 'healthy'
        end as state
      from expected e
      left join cron.job j on j.jobname = e.jobname
      left join lateral (
        select r.status, r.start_time, r.end_time
        from cron.job_run_details r
        where r.jobid = j.jobid
        order by r.start_time desc
        limit 1
      ) lr on true
      left join lateral (
        select r.status, r.start_time, r.end_time
        from cron.job_run_details r
        where r.jobid = j.jobid and r.end_time is not null
        order by r.end_time desc
        limit 1
      ) lt on true
      left join lateral (
        select r.end_time
        from cron.job_run_details r
        where r.jobid = j.jobid and r.status = 'succeeded' and r.end_time is not null
        order by r.end_time desc nulls last
        limit 1
      ) ls on true
    )
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'job_name', jobname,
        'subsystem', subsystem,
        'critical', is_critical,
        'job_id', jobid,
        'schedule', schedule,
        'expected_schedule', expected_schedule,
        'active', active,
        'state', state,
        'latest_status', latest_status,
        'latest_run_at', latest_run_at,
        'latest_completed_at', latest_completed_at,
        'latest_terminal_status', latest_terminal_status,
        'latest_terminal_at', latest_terminal_at,
        'latest_success_at', latest_success_at,
        'latest_success_age_seconds', case when latest_success_at is null then null
          else floor(extract(epoch from (now() - latest_success_at)))::bigint end
      ) order by jobname), '[]'::jsonb),
      -- Platform-critical rollup: CRITICAL jobs only. The non-critical automation
      -- crons deliberately do NOT influence this value, so overall Operations
      -- Health state behaves exactly as before this migration.
      case
        when bool_or(state = 'failing') filter (where is_critical) then 'failing'
        when bool_or(state = 'degraded') filter (where is_critical) then 'degraded'
        else 'healthy'
      end,
      -- Separate rollup for the non-critical automation crons (surfaced as a
      -- warning-level attention item; never affects overall state).
      case
        when bool_or(state = 'failing') filter (where not is_critical) then 'failing'
        when bool_or(state = 'degraded') filter (where not is_critical) then 'degraded'
        else 'healthy'
      end
    into v_jobs, v_database_jobs_state, v_automation_jobs_state
    from snap;
  exception when others then
    v_jobs_error_code := sqlstate;
    v_database_jobs_state := 'unavailable';
    v_automation_jobs_state := 'unavailable';
    v_jobs := jsonb_build_array(
      jsonb_build_object('job_name','account-deletion-processor','subsystem','account_deletion',
        'critical',true,'job_id',null,'schedule',null,'expected_schedule','* * * * *',
        'active',false,'state','unavailable','latest_status',null,'latest_run_at',null,
        'latest_completed_at',null,'latest_terminal_status',null,'latest_terminal_at',null,
        'latest_success_at',null,'latest_success_age_seconds',null),
      jsonb_build_object('job_name','lazywait-sync','subsystem','lazywait',
        'critical',true,'job_id',null,'schedule',null,'expected_schedule','* * * * *',
        'active',false,'state','unavailable','latest_status',null,'latest_run_at',null,
        'latest_completed_at',null,'latest_terminal_status',null,'latest_terminal_at',null,
        'latest_success_at',null,'latest_success_age_seconds',null),
      jsonb_build_object('job_name','order-integrity-watchdog','subsystem','order_integrity',
        'critical',true,'job_id',null,'schedule',null,'expected_schedule','*/2 * * * *',
        'active',false,'state','unavailable','latest_status',null,'latest_run_at',null,
        'latest_completed_at',null,'latest_terminal_status',null,'latest_terminal_at',null,
        'latest_success_at',null,'latest_success_age_seconds',null),
      jsonb_build_object('job_name','operations-alerts-evaluator','subsystem','operations_alerts',
        'critical',false,'job_id',null,'schedule',null,'expected_schedule','*/5 * * * *',
        'active',false,'state','unavailable','latest_status',null,'latest_run_at',null,
        'latest_completed_at',null,'latest_terminal_status',null,'latest_terminal_at',null,
        'latest_success_at',null,'latest_success_age_seconds',null),
      jsonb_build_object('job_name','operations-digest-generator','subsystem','operations_digest',
        'critical',false,'job_id',null,'schedule',null,'expected_schedule','0 * * * *',
        'active',false,'state','unavailable','latest_status',null,'latest_run_at',null,
        'latest_completed_at',null,'latest_terminal_status',null,'latest_terminal_at',null,
        'latest_success_at',null,'latest_success_age_seconds',null),
      jsonb_build_object('job_name','branch-availability-sweep','subsystem','branch_availability',
        'critical',false,'job_id',null,'schedule',null,'expected_schedule','* * * * *',
        'active',false,'state','unavailable','latest_status',null,'latest_run_at',null,
        'latest_completed_at',null,'latest_terminal_status',null,'latest_terminal_at',null,
        'latest_success_at',null,'latest_success_age_seconds',null)
    );
  end;

  -- Account deletion: cron execution evidence + safe queue aggregates only.
  begin
    select
      coalesce((j->>'active')::boolean, false),
      j->>'latest_status',
      (j->>'latest_run_at')::timestamptz,
      (j->>'latest_success_at')::timestamptz,
      j->>'latest_terminal_status',
      (j->>'latest_terminal_at')::timestamptz
    into v_ad_active, v_ad_latest_status, v_ad_latest_run_at, v_ad_latest_success_at,
      v_ad_latest_terminal_status, v_ad_latest_terminal_at
    from jsonb_array_elements(v_jobs) j
    where j->>'job_name' = 'account-deletion-processor'
    limit 1;

    select
      count(*) filter (
        where status in ('queued','retry_scheduled','processing','waiting_for_active_order','waiting_for_financial_process')
        and (next_attempt_at is null or next_attempt_at <= now())
        and (locked_until is null or locked_until <= now())
      )::integer,
      count(*) filter (where status = 'manual_review')::integer,
      min(coalesce(next_attempt_at, requested_at)) filter (
        where status in ('queued','retry_scheduled','processing','waiting_for_active_order','waiting_for_financial_process')
        and (next_attempt_at is null or next_attempt_at <= now())
        and (locked_until is null or locked_until <= now())
      )
    into v_ad_due_count, v_ad_manual_review, v_ad_oldest_due
    from public.account_deletion_requests;

    select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
      into v_ad_counts
    from (
      select status, count(*)::integer as cnt
      from public.account_deletion_requests
      group by status
    ) s;

    v_ad_state := case
      when v_database_jobs_state = 'unavailable' then 'unavailable'
      when not v_ad_active then 'failing'
      -- A recent TERMINAL non-success is a real failure and takes precedence. An
      -- in-flight `running` row has no terminal outcome and never fails here.
      when v_ad_latest_terminal_status is not null and v_ad_latest_terminal_status <> 'succeeded'
        and v_ad_latest_terminal_at >= now() - interval '6 minutes' then 'failing'
      -- No completed successful run yet (fresh deploy / retained-history gap).
      -- Kept SEPARATE from the stale-success case and, consistent with the
      -- scheduled-job snapshot's no-success rule, is `degraded` — not `failing` —
      -- so the platform does not report failing before any terminal failure.
      when v_ad_latest_success_at is null then 'degraded'
      -- A successful run exists but is stale beyond the freshness threshold.
      when now() - v_ad_latest_success_at > interval '6 minutes' then 'failing'
      when v_ad_manual_review > 0 then 'degraded'
      when v_ad_due_count > 0
        and v_ad_oldest_due < now() - interval '10 minutes' then 'degraded'
      when v_ad_due_count = 0 then 'idle'
      else 'healthy'
    end;
  exception when others then
    v_ad_error_code := sqlstate;
    v_ad_state := 'unavailable';
  end;

  -- Payment/Moyasar: database evidence only. enabled/configured never implies
  -- provider health; without a provider availability probe the normal state is
  -- not_monitored. Recent stale attempts and Order Integrity incidents are shown.
  begin
    -- "configured" mirrors the runtime resolver (_shared/moyasar.ts
    -- resolveMoyasarConfig), check for check:
    --   * provider_name must be 'moyasar';
    --   * the secret key for the SELECTED mode must be present and carry that
    --     mode's prefix, sk_test_ or sk_live_. A live key filed under test is
    --     refused at runtime (key_mode_mismatch), so it is not ready here;
    --   * a webhook secret token must exist for that mode, or the shared
    --     moyasar_webhook_secret_token. coalesce() is JavaScript's `??`: an
    --     EMPTY mode-specific token does not fall through to the shared one,
    --     at runtime or here;
    --   * no merchant id is required: Moyasar has none.
    -- Both values are trimmed of exactly the characters String.prototype.trim()
    -- removes, so a value the resolver reads as blank is blank here too. They
    -- are written as \u escapes because PostgreSQL has no \v escape: E'\v' is
    -- the letter v. Only booleans leave this statement; no key or token is
    -- selected into a returned column.
    select
      true,
      enabled,
      (lower(coalesce(provider_name, '')) = 'moyasar'
        and starts_with(
              btrim(
                coalesce(secret_config->>(
                  case when lower(coalesce(public_config->>'mode', 'test')) = 'live'
                       then 'moyasar_live_secret_key' else 'moyasar_test_secret_key' end
                ), ''),
                js_ws.chars),
              case when lower(coalesce(public_config->>'mode', 'test')) = 'live'
                   then 'sk_live_' else 'sk_test_' end)
        and btrim(
              coalesce(
                secret_config->>(
                  case when lower(coalesce(public_config->>'mode', 'test')) = 'live'
                       then 'moyasar_live_webhook_secret_token'
                       else 'moyasar_test_webhook_secret_token' end),
                secret_config->>'moyasar_webhook_secret_token',
                ''),
              js_ws.chars) <> ''),
      provider_name,
      nullif(public_config->>'mode',''),
      nullif(public_config->>'currency',''),
      updated_at
    into v_payment_exists, v_payment_enabled, v_payment_configured,
      v_payment_provider, v_payment_mode, v_payment_currency, v_payment_updated_at
    from public.integration_settings
    cross join (
      select E'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002'
          || E'\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f'
          || E'\u205f\u3000\ufeff' as chars
    ) js_ws
    where provider_type = 'payment'
    order by updated_at desc
    limit 1;

    v_payment_exists := coalesce(v_payment_exists, false);
    v_payment_enabled := coalesce(v_payment_enabled, false);
    v_payment_configured := coalesce(v_payment_configured, false);

    select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
      into v_payment_counts_24h
    from (
      select status, count(*)::integer cnt
      from public.payment_records
      where created_at >= now() - interval '24 hours'
      group by status
    ) s;

    select
      count(*)::integer,
      min(coalesce(initiated_at, created_at))
    into v_payment_stale_initiated, v_payment_oldest_stale
    from public.payment_records
    where status = 'initiated'
      -- 20261013120000 (gap PG-25): only an attempt a payment SETTLED on.
      -- provider_ref is written on an attempt only by stampPaymentRef
      -- (moyasarVerify.ts), for a paid payment that binds to it, just
      -- before the order is confirmed; a confirmation moves the row on.
      -- An abandoned checkout never gets one, so it no longer counts.
      and provider_ref is not null
      and created_at >= now() - interval '24 hours'
      and coalesce(initiated_at, created_at) < now() - interval '30 minutes';

    -- 20261013120000 (gap PG-25): what the count above no longer covers,
    -- kept readable. The same window, on attempts NO payment was verified
    -- on. Nearly all are abandoned checkouts, so it does not move the
    -- state. But a payment Moyasar captured whose webhook never arrived,
    -- and whose customer never came back, looks exactly like this too:
    -- nothing verified it, so nothing stamped it. Nothing else counts it.
    select count(*)::integer
      into v_payment_open_unverified
    from public.payment_records
    where status = 'initiated'
      and provider_ref is null
      and created_at >= now() - interval '24 hours'
      and coalesce(initiated_at, created_at) < now() - interval '30 minutes';

    select min(coalesce(initiated_at, created_at))
      into v_payment_oldest_initiated
    from public.payment_records
    where status = 'initiated';

    select max(coalesce(confirmed_at, updated_at))
      into v_payment_latest_paid
    from public.payment_records
    where status = 'paid';

    select count(*)::integer
      into v_payment_integrity_critical
    from public.order_integrity_incidents
    where status <> 'resolved'
      and severity = 'critical'
      and rule_code in (
        'PAID_ORDER_AWAITING_PAYMENT',
        'CAPTURED_PAYMENT_WITHOUT_ORDER',
        'PAYMENT_AMOUNT_MISMATCH',
        'DUPLICATE_PROVIDER_REFERENCE',
        'MULTIPLE_SUCCESSFUL_CAPTURES',
        -- 20261013120000: the four refund and payment rules R14-R17.
        'REFUND_FAILED',
        'DUPLICATE_PAYMENT_RECORDED',
        'PAYMENT_VERIFICATION_MISMATCH',
        'PAYMENT_CONFIRMATION_FAILED',
        -- 20261016120000: R18, which is critical only for a refund still
        -- pending more than 24 hours after it was opened.
        'REFUND_STUCK'
      );

    v_payment_state := case
      when not v_payment_exists then 'not_configured'
      when not v_payment_enabled then 'disabled'
      when not v_payment_configured then 'not_configured'
      when v_payment_integrity_critical > 0 then 'failing'
      when v_payment_stale_initiated > 0 then 'degraded'
      else 'not_monitored'
    end;
  exception when others then
    v_payment_error_code := sqlstate;
    v_payment_state := 'unavailable';
  end;

  -- Push: configuration, device counts and safe send-ledger aggregates. No send
  -- or test-message endpoint is invoked.
  begin
    -- "configured" mirrors the runtime push-dispatch gate exactly:
    --   provider = String(public_config.provider ?? provider_name ?? '')
    --   and that provider must equal 'expo' (case-sensitive; an empty-string
    --   provider does NOT fall through to provider_name, matching JS `??`).
    -- Expo push carries no integration_settings.secret_config (EAS credentials
    -- live outside the DB), so a DB secret is deliberately NOT required here.
    select
      true,
      enabled,
      (coalesce(public_config->>'provider', provider_name, '') = 'expo'),
      provider_name,
      updated_at
    into v_push_exists, v_push_enabled, v_push_configured,
      v_push_provider, v_push_updated_at
    from public.integration_settings
    where provider_type = 'push'
    order by updated_at desc
    limit 1;

    v_push_exists := coalesce(v_push_exists, false);
    v_push_enabled := coalesce(v_push_enabled, false);
    v_push_configured := coalesce(v_push_configured, false);

    select
      count(*) filter (where is_active)::integer,
      count(*) filter (where is_active and promos_enabled)::integer
    into v_push_active_devices, v_push_promos_opt_in
    from public.push_devices;

    -- Grouped lifecycle counts (unchanged safe projection).
    select coalesce(jsonb_object_agg(send_status, cnt), '{}'::jsonb)
      into v_push_log_counts
    from (
      select send_status, count(*)::integer cnt
      from public.notification_log
      where created_at >= now() - interval '24 hours'
      group by send_status
    ) s;

    -- Two DISTINCT units, never summed together:
    --   * failed_deliveries = sum of the per-row `failed` device counter. Push
    --     records PARTIAL sends as send_status='sent' with failed>0, and
    --     test/broadcast rows as send_status='processing' with failed>0, so a
    --     lifecycle-status filter alone misses real delivery failures.
    --   * failed_events = rows whose lifecycle status is 'failed' (total send
    --     failure OR a pre-send/device-lookup failure that reached zero devices,
    --     so failed=0). Counting events separately avoids mixing device counts
    --     with event counts. `failed` is NOT NULL default 0; guarded anyway.
    select
      coalesce(sum(greatest(coalesce(failed, 0), 0)), 0)::integer,
      count(*) filter (where send_status = 'failed')::integer
    into v_push_failed_deliveries_24h, v_push_failed_events_24h
    from public.notification_log
    where created_at >= now() - interval '24 hours';

    select max(created_at)
      into v_push_latest_log
    from public.notification_log;

    v_push_state := case
      when not v_push_exists then 'not_configured'
      when not v_push_enabled then 'disabled'
      when not v_push_configured then 'not_configured'
      when v_push_failed_deliveries_24h > 0 or v_push_failed_events_24h > 0 then 'degraded'
      else 'not_monitored'
    end;
  exception when others then
    v_push_error_code := sqlstate;
    v_push_state := 'unavailable';
  end;

  -- Email/SMTP: configuration status only. Host/from-address presence is checked
  -- without returning either value, and no email is sent.
  --
  -- "configured" mirrors the runtime SMTP readiness (email-test-config): it needs
  -- host and from_email (both trimmed there), and SMTP auth is OPTIONAL
  -- (auth = username ? {...} : undefined), so a password/secret is NOT required.
  -- Requiring provider_name or a non-empty secret_config here would over-report
  -- not_configured for a valid no-auth SMTP relay.
  begin
    select
      true,
      enabled,
      (nullif(btrim(public_config->>'host', E' \t\n\r\f\v'),'') is not null
        and nullif(btrim(public_config->>'from_email', E' \t\n\r\f\v'),'') is not null),
      provider_name,
      updated_at
    into v_email_exists, v_email_enabled, v_email_configured,
      v_email_provider, v_email_updated_at
    from public.integration_settings
    where provider_type = 'email'
    order by updated_at desc
    limit 1;

    v_email_exists := coalesce(v_email_exists, false);
    v_email_enabled := coalesce(v_email_enabled, false);
    v_email_configured := coalesce(v_email_configured, false);

    v_email_state := case
      when not v_email_exists then 'not_configured'
      when not v_email_enabled then 'disabled'
      when not v_email_configured then 'not_configured'
      else 'not_monitored'
    end;
  exception when others then
    v_email_error_code := sqlstate;
    v_email_state := 'unavailable';
  end;

  -- OTP: the WhatsApp integration row ONLY. Configuration only; no OTP or
  -- provider test message is sent.
  --
  -- The runtime OTP send path reads exactly the 'whatsapp' row —
  -- resolveWhatsAppConfig / getOtpPepper call getProviderConfig(admin, 'whatsapp')
  -- (_shared/whatsappSend.ts:71,62), a single .eq('provider_type','whatsapp')
  -- .maybeSingle() lookup. The separate 'sms' integration slot is never consulted
  -- for WhatsApp OTP, so it must not influence this card's exists/enabled/provider/
  -- configured state. provider_type is UNIQUE, so this selects one deterministic row.
  --
  -- "configured" mirrors resolveWhatsAppConfig, which fails closed unless
  -- phone_number_id (public), access_token (secret) and an OTP template name are
  -- present. The resolver uses a non-trimming str(), so presence (not
  -- whitespace-trim) is the correct mirror. A template for at least one language
  -- makes the send path succeed for that language; with none, OTP cannot send in
  -- any language -> not_configured.
  begin
    select
      true,
      enabled,
      (nullif(public_config->>'phone_number_id','') is not null
        and nullif(secret_config->>'access_token','') is not null
        and (nullif(public_config->>'otp_template_name_ar','') is not null
             or nullif(public_config->>'otp_template_name_en','') is not null)),
      provider_name,
      updated_at
    into v_otp_exists, v_otp_enabled, v_otp_configured,
      v_otp_provider, v_otp_updated_at
    from public.integration_settings
    where provider_type = 'whatsapp'
    limit 1;

    v_otp_exists := coalesce(v_otp_exists, false);
    v_otp_enabled := coalesce(v_otp_enabled, false);
    v_otp_configured := coalesce(v_otp_configured, false);

    v_otp_state := case
      when not v_otp_exists then 'not_configured'
      when not v_otp_enabled then 'disabled'
      when not v_otp_configured then 'not_configured'
      else 'not_monitored'
    end;
  exception when others then
    v_otp_error_code := sqlstate;
    v_otp_state := 'unavailable';
  end;

  -- --------------------------------------------------------------------
  -- Order flow: are orders still arriving while branches are open?
  -- --------------------------------------------------------------------
  -- Every other card watches a SUBSYSTEM. This one watches the business
  -- outcome those subsystems exist to produce, which is the failure the
  -- console could not previously see: checkout silently broken, orders at
  -- zero, every subsystem reporting healthy because none of them is broken.
  --
  -- Baselined against the SAME ROLLING WINDOW shifted back whole weeks, because
  -- order volume is strongly weekly-periodic — Friday 21:00 and Tuesday 04:00
  -- are not comparable, and a flat threshold would either scream all night or
  -- never fire at all. This is the first statistical baseline in this schema;
  -- everything else here is a fixed interval against now().
  --
  -- It FAILS QUIET. With fewer than v_of_min_samples comparable weeks it
  -- reports 'idle', never 'failing' — mirroring the alert engine's existing
  -- first-run baseline suppression. A monitor that cries wolf during its own
  -- warm-up teaches people to ignore it.
  begin
    select count(*) filter (where is_active),
           count(*)
      into v_of_open_branches, v_of_total_branches
      from public.branches;

    select count(*)
      into v_of_recent
      from public.orders
     where created_at >= v_generated_at - make_interval(mins => v_of_window_minutes);

    -- Trailing baseline: THE SAME ROLLING WINDOW, shifted back whole weeks.
    --
    -- The obvious version of this compares the rolling last-60-minutes against
    -- historical `date_trunc('hour')` buckets. That is wrong, and wrong in a way
    -- that fires: at 21:05 it measures 20:05-21:05 and compares it against full
    -- 21:00-22:00 hours, so at any demand boundary — lunch, dinner, closing —
    -- the two sides cover materially different trade and the card degrades or
    -- goes quiet for no real reason.
    --
    -- Using the CURRENT clock hour instead is worse still: at 21:05 it would
    -- compare 5 minutes of orders against a full hour and read as a ~92%
    -- collapse, every hour, at five past.
    --
    -- So each historical sample is the identical construct: the same
    -- v_of_window_minutes span ending at the same wall-clock instant, k whole
    -- weeks ago. Whole weeks preserve both weekday and time of day for free,
    -- and Saudi Arabia has no daylight saving, so there is no offset to correct
    -- and no timezone conversion is needed here at all.
    --
    -- A week with zero orders in that window is NOT a sample. Counting it would
    -- drag the mean toward zero and quietly disarm the card — the opposite of
    -- what a baseline is for. `v_of_samples` therefore counts weeks that
    -- actually traded at this time.
    select avg(c)::numeric, count(*)::integer
      into v_of_baseline, v_of_samples
    from (
      select (
        select count(*)
          from public.orders o
         where o.created_at >  v_generated_at
                              - make_interval(weeks => w)
                              - make_interval(mins => v_of_window_minutes)
           and o.created_at <= v_generated_at - make_interval(weeks => w)
      ) as c
      from generate_series(1, 8) as w
    ) s
    where c > 0;

    v_of_state := case
      -- Nothing open: zero orders is the CORRECT reading, not an incident.
      when v_of_open_branches = 0                  then 'idle'
      -- Not enough comparable history yet.
      when coalesce(v_of_samples,0) < v_of_min_samples then 'idle'
      -- History says this hour is normally quiet anyway.
      when coalesce(v_of_baseline,0) < 1           then 'idle'
      -- Branches open, history says orders are expected, none arrived.
      when v_of_recent = 0                         then 'failing'
      when v_of_recent::numeric < v_of_baseline * 0.4 then 'degraded'
      else 'healthy'
    end;
  exception when others then
    v_of_error_code := sqlstate;
    v_of_state := 'unavailable';
  end;

  -- Branch availability: does what staff closed actually reopen?
  --
  -- This is NOT the `branch-availability-sweep` cron entry above, and the
  -- difference is the whole reason this card exists. `branch_availability_sweep`
  -- catches its own exceptions, writes status='failed' to its ledger and then
  -- RETURNS NORMALLY, so pg_cron records the run as `succeeded`. The
  -- database_jobs card would read the sweeper healthy while every single sweep
  -- failed. Only the ledger plus the availability state can see that.
  --
  -- Counts only. No branch id or name ever reaches this payload — the
  -- call-centre console answers "which branch?"; Operations Health is read-only
  -- by definition and must not become an operations surface.
  begin
    select
      count(*) filter (where p.snoozed_until is not null),
      count(*) filter (where p.snoozed_until is null)
    into v_ba_closed_products, v_ba_untimed
    from public.branch_product_availability p
    where p.is_available = false;

    select
      v_ba_closed_options + count(*) filter (where m.snoozed_until is not null),
      v_ba_untimed        + count(*) filter (where m.snoozed_until is null)
    into v_ba_closed_options, v_ba_untimed
    from public.branch_modifier_availability m
    where m.is_available = false;

    -- A SIZE IS A THIRD LEVEL, NOT A KIND OF OPTION. Folding closed tiers into
    -- `closed_options` would have needed no new key and no console change, and
    -- would have made the card say "options" for something that is not one --
    -- on a menu where 59 of 61 products carry tiers and exactly ONE carries a
    -- modifier group, so almost every number under that label would have been
    -- a size.
    select
      count(*) filter (where v.snoozed_until is not null),
      v_ba_untimed + count(*) filter (where v.snoozed_until is null)
    into v_ba_closed_sizes, v_ba_untimed
    from public.branch_variant_availability v
    where v.is_available = false;

    select count(*)::int into v_ba_paused_branches
    from public.branches b where b.delivery_temporarily_closed;

    select count(*)::int into v_ba_disabled_areas
    from public.branch_delivery_areas a where a.is_disabled;

    -- Overdue restores: a timer that ran out and was never honoured. The grace
    -- window is five ticks of a one-minute sweep, so a single unlucky run is
    -- never reported as a backlog.
    select
      count(*)::int,
      coalesce(max(floor(extract(epoch from (now() - due)) / 60))::int, 0)
    into v_ba_overdue, v_ba_worst_minutes
    from (
      select snoozed_until as due from public.branch_product_availability
       where is_available = false and snoozed_until is not null
      union all
      select snoozed_until from public.branch_modifier_availability
       where is_available = false and snoozed_until is not null
      union all
      -- THIS ARM IS THE WHOLE POINT OF THE FILE. Without it a variant snooze
      -- whose timer ran out and was never honoured is overdue in the data and
      -- invisible to every state, so the sweeper could die with tiers stuck
      -- closed and the card would keep reporting `healthy`.
      select snoozed_until from public.branch_variant_availability
       where is_available = false and snoozed_until is not null
      union all
      select delivery_closed_until from public.branches
       where delivery_temporarily_closed and delivery_closed_until is not null
      union all
      select disabled_until from public.branch_delivery_areas
       where is_disabled and disabled_until is not null
    ) overdue(due)
    where due <= now() - c_ba_overdue_grace;

    select r.started_at, r.status into v_ba_latest_run_at, v_ba_latest_status
    from public.branch_availability_runs r
    order by r.id desc limit 1;

    select max(r.started_at) into v_ba_latest_success
    from public.branch_availability_runs r where r.status = 'success';

    v_ba_runs_seen := v_ba_latest_run_at is not null;
    -- "The most recent run failed" — and that is the whole test. A failure a
    -- later success has already cleared cannot reach here, because that success
    -- would itself be the most recent row. Ordering is by the ledger's identity
    -- column, never by timestamp: two runs inside one transaction share a
    -- `now()` and a timestamp comparison silently ties.
    v_ba_ledger_failing := v_ba_latest_status = 'failed';

    v_ba_state := case
      when v_ba_worst_minutes > extract(epoch from c_ba_stalled_after) / 60 then 'failing'
      when v_ba_overdue > 0 then 'degraded'
      when v_ba_ledger_failing then 'degraded'
      -- Fail-quiet warm-up, exactly as the order_flow card does it: a freshly
      -- applied database with nothing closed and no tick yet is not a problem.
      when not v_ba_runs_seen
           and v_ba_closed_products = 0 and v_ba_closed_options = 0
           and v_ba_closed_sizes = 0
           and v_ba_paused_branches = 0 and v_ba_disabled_areas = 0 then 'idle'
      else 'healthy'
    end;
  exception when others then
    v_ba_error_code := sqlstate;
    v_ba_state := 'unavailable';
  end;

  v_systems := jsonb_build_array(
    jsonb_build_object(
      'id','lazywait',
      'critical',true,
      'state',v_lazywait_state,
      'source','lazywait_sync_health_summary',
      'details',v_lazywait
    ),
    jsonb_build_object(
      'id','order_integrity',
      'critical',true,
      'state',v_integrity_state,
      'source','order_integrity_health_summary',
      'details',v_order_integrity
    ),
    jsonb_build_object(
      'id','account_deletion',
      'critical',true,
      'state',v_ad_state,
      'source','cron_and_queue',
      'details',jsonb_build_object(
        'cron_active',v_ad_active,
        'latest_run_status',v_ad_latest_status,
        'latest_run_at',v_ad_latest_run_at,
        'latest_success_at',v_ad_latest_success_at,
        'due_count',v_ad_due_count,
        'manual_review_count',v_ad_manual_review,
        'oldest_due_at',v_ad_oldest_due,
        'counts_by_status',v_ad_counts,
        'safe_error_code',v_ad_error_code
      )
    ),
    jsonb_build_object(
      'id','payment',
      'critical',false,
      'state',v_payment_state,
      'source','database_aggregates',
      'details',jsonb_build_object(
        'provider',v_payment_provider,
        'enabled',v_payment_enabled,
        'configured',v_payment_configured,
        'mode',v_payment_mode,
        'currency',v_payment_currency,
        'settings_updated_at',v_payment_updated_at,
        'counts_24h',v_payment_counts_24h,
        'stale_initiated_24h',v_payment_stale_initiated,
        'oldest_stale_initiated_at',v_payment_oldest_stale,
        'open_unverified_24h',v_payment_open_unverified,
        'oldest_initiated_at',v_payment_oldest_initiated,
        'latest_paid_at',v_payment_latest_paid,
        'integrity_critical_count',v_payment_integrity_critical,
        'provider_probe',false,
        'safe_error_code',v_payment_error_code
      )
    ),
    jsonb_build_object(
      'id','push',
      'critical',false,
      'state',v_push_state,
      'source','configuration_and_send_ledger',
      'details',jsonb_build_object(
        'provider',v_push_provider,
        'enabled',v_push_enabled,
        'configured',v_push_configured,
        'settings_updated_at',v_push_updated_at,
        'active_devices',v_push_active_devices,
        'promotions_opt_in',v_push_promos_opt_in,
        'send_status_counts_24h',v_push_log_counts,
        'failed_deliveries_24h',v_push_failed_deliveries_24h,
        'failed_send_events_24h',v_push_failed_events_24h,
        -- Backward-compatible alias for the existing UI field; now reports actual
        -- failed device deliveries (the more truthful metric).
        'failed_sends_24h',v_push_failed_deliveries_24h,
        'latest_log_at',v_push_latest_log,
        'provider_probe',false,
        'safe_error_code',v_push_error_code
      )
    ),
    jsonb_build_object(
      'id','email',
      'critical',false,
      'state',v_email_state,
      'source','configuration_only',
      'details',jsonb_build_object(
        'provider',v_email_provider,
        'enabled',v_email_enabled,
        'configured',v_email_configured,
        'settings_updated_at',v_email_updated_at,
        'provider_probe',false,
        'safe_error_code',v_email_error_code
      )
    ),
    jsonb_build_object(
      'id','otp',
      'critical',false,
      'state',v_otp_state,
      'source','configuration_only',
      'details',jsonb_build_object(
        'provider',v_otp_provider,
        'enabled',v_otp_enabled,
        'configured',v_otp_configured,
        'settings_updated_at',v_otp_updated_at,
        'provider_probe',false,
        'safe_error_code',v_otp_error_code
      )
    ),
    jsonb_build_object(
      'id','order_flow',
      'critical',true,
      'state',v_of_state,
      'source','orders_vs_trailing_weekly_window_baseline',
      'details',jsonb_build_object(
        'window_minutes',v_of_window_minutes,
        'orders_in_window',v_of_recent,
        'open_branches',v_of_open_branches,
        'total_branches',v_of_total_branches,
        'baseline_orders',round(coalesce(v_of_baseline,0),2),
        'baseline_samples',coalesce(v_of_samples,0),
        'baseline_min_samples',v_of_min_samples,
        'baseline_ready',(coalesce(v_of_samples,0) >= v_of_min_samples),
        'safe_error_code',v_of_error_code
      )
    ),
    jsonb_build_object(
      'id','branch_availability',
      'critical',false,
      'state',v_ba_state,
      'source','branch_availability_runs',
      'details',jsonb_build_object(
        'closed_products',v_ba_closed_products,
        'closed_options',v_ba_closed_options,
        'closed_sizes',v_ba_closed_sizes,
        'paused_branches',v_ba_paused_branches,
        'disabled_areas',v_ba_disabled_areas,
        -- Reported, never a state driver: an admin delisting is a decision.
        'untimed_closures',v_ba_untimed,
        'overdue_restores',v_ba_overdue,
        'worst_overdue_minutes',v_ba_worst_minutes,
        'overdue_grace_minutes',(extract(epoch from c_ba_overdue_grace) / 60)::int,
        'stalled_after_minutes',(extract(epoch from c_ba_stalled_after) / 60)::int,
        'latest_run_at',v_ba_latest_run_at,
        'latest_run_status',v_ba_latest_status,
        'latest_success_at',v_ba_latest_success,
        'safe_error_code',v_ba_error_code
      )
    ),
    jsonb_build_object(
      'id','database_jobs',
      'critical',true,
      'state',v_database_jobs_state,
      'source','pg_cron',
      'details',jsonb_build_object(
        -- Total allowlisted jobs now = 3 critical application crons + 3 optional
        -- internal automation crons. `automation_state` is the non-critical
        -- rollup; it never affects `state` or the overall platform health.
        'expected_jobs',6,
        'critical_jobs',3,
        'automation_jobs',3,
        'automation_state',v_automation_jobs_state,
        'jobs',v_jobs,
        'safe_error_code',v_jobs_error_code
      )
    )
  );

  select coalesce(jsonb_agg(item), '[]'::jsonb)
    into v_attention
  from (values
    (case when v_lazywait_state not in ('healthy','idle') then jsonb_build_object(
      'code','LAZYWAIT_HEALTH_'||upper(v_lazywait_state),
      'subsystem','lazywait',
      'severity',case when v_lazywait_state in ('failing','configuration_error') then 'critical' else 'warning' end,
      'count',1
    ) end),
    (case when v_integrity_state not in ('healthy','idle') then jsonb_build_object(
      'code','ORDER_INTEGRITY_'||upper(v_integrity_state),
      'subsystem','order_integrity',
      'severity',case when v_integrity_state in ('failing','configuration_error') then 'critical' else 'warning' end,
      'count',greatest(
        coalesce((v_order_integrity->>'open_critical_count')::integer,0),
        coalesce((v_order_integrity->>'open_warning_count')::integer,0),
        1
      )
    ) end),
    (case when v_ad_state not in ('healthy','idle') then jsonb_build_object(
      'code','ACCOUNT_DELETION_'||upper(v_ad_state),
      'subsystem','account_deletion',
      'severity',case when v_ad_state in ('failing','configuration_error') then 'critical' else 'warning' end,
      'count',greatest(v_ad_due_count+v_ad_manual_review,1),
      'oldest_at',v_ad_oldest_due
    ) end),
    (case when v_payment_integrity_critical > 0 then jsonb_build_object(
      'code','PAYMENT_INTEGRITY_INCIDENTS',
      'subsystem','payment',
      'severity','critical',
      'count',v_payment_integrity_critical
    ) end),
    (case when v_payment_stale_initiated > 0 then jsonb_build_object(
      'code','STALE_PAYMENT_INITIATIONS',
      'subsystem','payment',
      'severity','warning',
      'count',v_payment_stale_initiated,
      'oldest_at',v_payment_oldest_stale
    ) end),
    (case when v_push_enabled and (v_push_failed_deliveries_24h > 0 or v_push_failed_events_24h > 0)
      then jsonb_build_object(
      'code','PUSH_SEND_FAILURES_24H',
      'subsystem','push',
      'severity','warning',
      -- Single unit only (never delivery + event added together): prefer the
      -- actual failed-delivery count; fall back to the failed-event count when the
      -- only evidence is a zero-delivery lifecycle failure.
      'count',case when v_push_failed_deliveries_24h > 0
                   then v_push_failed_deliveries_24h
                   else v_push_failed_events_24h end
    ) end),
    (case when v_database_jobs_state <> 'healthy' then jsonb_build_object(
      'code','SCHEDULED_JOBS_'||upper(v_database_jobs_state),
      'subsystem','database_jobs',
      'severity',case when v_database_jobs_state='failing' then 'critical' else 'warning' end,
      'count',1
    ) end),
    -- Non-critical automation crons (evaluator + digest). Always WARNING — a
    -- stuck internal automation is worth surfacing but must never read as a
    -- platform-critical incident. `unavailable` is intentionally omitted: that
    -- path is the snapshot query error already covered by SCHEDULED_JOBS_*.
    (case when v_automation_jobs_state in ('failing','degraded') then jsonb_build_object(
      'code','OPERATIONS_AUTOMATION_JOBS_'||upper(v_automation_jobs_state),
      'subsystem','operations_automation',
      'severity','warning',
      'count',1
    ) end),
    (case when v_of_state in ('failing','degraded') then jsonb_build_object(
      'code','ORDER_FLOW_'||upper(v_of_state),
      'subsystem','order_flow',
      'severity',case when v_of_state = 'failing' then 'critical' else 'warning' end,
      'count',greatest(v_of_open_branches,1)
    ) end)
    ,
    (case when v_ba_state in ('failing','degraded') then jsonb_build_object(
      'code','BRANCH_AVAILABILITY_'||upper(v_ba_state),
      'subsystem','branch_availability',
      'severity',case when v_ba_state = 'failing' then 'critical' else 'warning' end,
      'count',greatest(v_ba_overdue,1)
    ) end)
  ) a(item)
  where item is not null;

  select
    count(*) filter (where e->>'severity'='critical')::integer,
    count(*) filter (where e->>'severity'='warning')::integer
  into v_critical_attention, v_warning_attention
  from jsonb_array_elements(v_attention) e;

  select
    count(*) filter (where s->>'state'='unavailable')::integer,
    count(*) filter (where s->>'state'='disabled')::integer,
    count(*) filter (where s->>'state'='not_configured')::integer,
    count(*) filter (where s->>'state'='not_monitored')::integer
  into v_unavailable, v_disabled, v_not_configured, v_not_monitored
  from jsonb_array_elements(v_systems) s;

  v_overall_state := public.operations_health_overall_state(
    v_lazywait_state,
    v_integrity_state,
    v_ad_state,
    v_database_jobs_state,
    v_of_state
  );

  return jsonb_build_object(
    'generated_at',v_generated_at,
    'overall_state',v_overall_state,
    'critical_attention_count',coalesce(v_critical_attention,0),
    'warning_attention_count',coalesce(v_warning_attention,0),
    'systems_unavailable_count',coalesce(v_unavailable,0),
    'systems_disabled_count',coalesce(v_disabled,0),
    'systems_not_configured_count',coalesce(v_not_configured,0),
    'systems_not_monitored_count',coalesce(v_not_monitored,0),
    'critical_systems',jsonb_build_array(
      'lazywait','order_integrity','account_deletion','database_jobs','order_flow'
    ),
    'systems',v_systems,
    'jobs',v_jobs,
    'attention',v_attention
  );
end;
$$;

revoke all on function public.operations_health_snapshot_internal()
  from public, anon, authenticated;
grant execute on function public.operations_health_snapshot_internal()
  to service_role;

comment on function public.operations_health_snapshot_internal() is
  'Read-only Operations Health snapshot. Since 20260807 it carries an order_flow card in the critical set; since 20260820 the cron allowlist also observes branch-availability-sweep, and a NON-critical branch_availability card reports whether timed closures actually reopen — the sweeper swallows its own errors, so pg_cron cannot see a sweep that runs and fails. Since 20260925 that card also observes branch_variant_availability, so a stuck PRICE TIER counts toward closed_sizes and toward the overdue-restore backlog. Since 20261003 the payment card''s configured flag mirrors resolveMoyasarConfig: provider moyasar, a secret key with the selected mode''s prefix, and a webhook token. Since 20261013 its stale-attempt count reads only attempts a payment settled on (provider_ref set), so an abandoned checkout no longer reads degraded; open_unverified_24h keeps the attempts it no longer counts readable without moving the state (it is also the only place a captured payment whose webhook never arrived, and whose customer never returned, still shows), and its payment incident count includes the refund and payment rules REFUND_FAILED, DUPLICATE_PAYMENT_RECORDED, PAYMENT_VERIFICATION_MISMATCH and PAYMENT_CONFIRMATION_FAILED, and since 20261016 REFUND_STUCK, which is critical only for a refund still pending a day after it was opened. Counts only: no branch identity, PII, secrets, raw provider payloads, tokens, cron commands or external provider probe results.';

-- ---------------------------------------------------------------------------
-- 6. Self-verification, part 1: structure, grants, the money path
-- ---------------------------------------------------------------------------
-- CARDINALITY FIRST, then the bodies: `select prosrc into` takes an arbitrary
-- row when there are two overloads. Where an assertion names a token it is
-- matched against the body with its `--` comments stripped, so a comment
-- cannot satisfy it. Outcomes are read back as values, never as notices.
do $verify$
declare
  v_n     integer;
  v_oid   oid;
  v_src   text;
  v_txt   text;
  v_got   text;
begin
  -- the column -----------------------------------------------------------------
  select format_type(a.atttypid, a.atttypmod) into v_txt
    from pg_attribute a
   where a.attrelid = 'public.order_refunds'::regclass and a.attname = 'next_attempt_at' and not a.attisdropped;
  if v_txt is distinct from 'timestamp with time zone' then
    raise exception 'VERIFY: order_refunds.next_attempt_at is %, expected timestamptz', coalesce(v_txt, 'missing');
  end if;

  -- refund_retry_delay: the whole schedule, as values -------------------------
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'refund_retry_delay';
  if v_n <> 1 then
    raise exception 'VERIFY: expected 1 refund_retry_delay, found %', v_n;
  end if;
  v_oid := to_regprocedure('public.refund_retry_delay(integer)');
  if v_oid is null then
    raise exception 'VERIFY: refund_retry_delay(integer) is missing';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') or has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'VERIFY: a client role can execute refund_retry_delay';
  end if;
  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'VERIFY: service_role cannot execute refund_retry_delay';
  end if;
  select string_agg((extract(epoch from public.refund_retry_delay(k)) / 60)::integer::text, ',' order by k)
    into v_got from generate_series(1, 12) k;
  if v_got is distinct from '5,10,20,40,80,160,320,360,360,360,360,360' then
    raise exception 'VERIFY: the back-off schedule in minutes is %, expected 5,10,20,40,80,160,320,360,... (owner, PG-01)',
      coalesce(v_got, 'NULL');
  end if;
  if public.refund_retry_delay(0) is distinct from interval '5 minutes'
     or public.refund_retry_delay(null) is distinct from interval '5 minutes'
     or public.refund_retry_delay(100000) is distinct from interval '6 hours' then
    raise exception 'VERIFY: refund_retry_delay is not clamped at both ends';
  end if;

  -- claim_order_refund ----------------------------------------------------------
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claim_order_refund';
  if v_n <> 1 then
    raise exception 'VERIFY: expected 1 claim_order_refund, found %', v_n;
  end if;
  v_oid := to_regprocedure('public.claim_order_refund(text, uuid[])');
  if v_oid is null then
    raise exception 'VERIFY: claim_order_refund(text, uuid[]) is missing';
  end if;
  if (select p.pronargdefaults from pg_proc p where p.oid = v_oid) is distinct from 1::smallint then
    raise exception 'VERIFY: p_exclude_refund_ids lost its default';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = v_oid) is distinct from true
     or not coalesce((select 'search_path=public' = any (p.proconfig) from pg_proc p where p.oid = v_oid), false) then
    raise exception 'VERIFY: claim_order_refund is not SECURITY DEFINER with search_path pinned';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') or has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'VERIFY: claim_order_refund must be executable by service_role only';
  end if;
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src from pg_proc p where p.oid = v_oid;
  select count(*) into v_n
    from regexp_matches(v_src, 'and \(next_attempt_at is null or next_attempt_at <= now\(\)\)', 'g');
  if v_n <> 2 then
    raise exception 'VERIFY: the due filter appears % time(s) in claim_order_refund, expected 2 (scan and re-check)', v_n;
  end if;

  -- finalize_order_refund -------------------------------------------------------
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'finalize_order_refund';
  if v_n <> 1 then
    raise exception 'VERIFY: expected 1 finalize_order_refund, found %', v_n;
  end if;
  v_oid := to_regprocedure('public.finalize_order_refund(uuid, text, text, text, text, text)');
  if v_oid is null then
    raise exception 'VERIFY: finalize_order_refund(uuid, text, text, text, text, text) is missing';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = v_oid) is distinct from true
     or not coalesce((select 'search_path=public' = any (p.proconfig) from pg_proc p where p.oid = v_oid), false) then
    raise exception 'VERIFY: finalize_order_refund is not SECURITY DEFINER with search_path pinned';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') or has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'VERIFY: finalize_order_refund must be executable by service_role only';
  end if;
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src from pg_proc p where p.oid = v_oid;
  if position('c_max_attempts constant integer := 10;' in v_src) = 0
     or position('if v_attempts >= c_max_attempts then' in v_src) = 0 then
    raise exception 'VERIFY: finalize_order_refund does not stop a refund at 10 attempts';
  end if;
  if position('next_attempt_at = case when v_status = ''pending'' then now() + public.refund_retry_delay(attempt_count) else null end' in v_src) = 0 then
    raise exception 'VERIFY: finalize_order_refund does not back off a released refund';
  end if;

  -- order_integrity_watchdog ----------------------------------------------------
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'order_integrity_watchdog';
  if v_n <> 1 then
    raise exception 'VERIFY: expected 1 order_integrity_watchdog, found %', v_n;
  end if;
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p where p.oid = to_regprocedure('public.order_integrity_watchdog()');
  select count(distinct m[1]) into v_n from regexp_matches(v_src, 'v_rules->>''([A-Z_]+)''', 'g') m;
  if v_n <> 18 then
    raise exception 'VERIFY: the watchdog guards % rules, expected 18 (17 + R18)', v_n;
  end if;
  if position('if coalesce((v_rules->>''REFUND_STUCK''), ''true'') <> ''false'' then' in v_src) = 0 then
    raise exception 'VERIFY: REFUND_STUCK has no enable guard';
  end if;
  if position('severity = d.severity,' in v_src) = 0 then
    raise exception 'VERIFY: the incident update does not follow the detection''s severity, so R18 could never turn critical';
  end if;
  if position('select i.id, ''escalated'', i.severity,' in v_src) = 0 then
    raise exception 'VERIFY: the watchdog writes no escalated alert';
  end if;

  -- operations_health_snapshot_internal -----------------------------------------
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_health_snapshot_internal';
  if v_n <> 1 then
    raise exception 'VERIFY: expected 1 operations_health_snapshot_internal, found %', v_n;
  end if;
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p where p.oid = to_regprocedure('public.operations_health_snapshot_internal()');
  if v_src !~ '''PAYMENT_CONFIRMATION_FAILED'',\s+''REFUND_STUCK''\s+\);' then
    raise exception 'VERIFY: the payment card does not count REFUND_STUCK';
  end if;

  -- The money path is untouched. One overload each first, then the hash.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_n <> 1 then
    raise exception 'VERIFY: expected 1 place_order, found %', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_txt is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'place_order moved to %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_txt, 'NULL');
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_n <> 1 then
    raise exception 'VERIFY: expected 1 compute_order_snapshot, found %', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;
end
$verify$;

-- ---------------------------------------------------------------------------
-- 7. Self-verification, part 2: OUTCOMES, on fixtures that are thrown away
-- ---------------------------------------------------------------------------
-- Fixtures are written inside a sub-transaction that a sentinel raise aborts,
-- and the rollback is proven afterwards rather than assumed (the
-- 20261013120000 pattern). Every order carries an explicit order number, so no
-- SM- number is burnt; the order_change_events and order_integrity_runs id
-- sequences advance, which nothing reads as a count. Nothing is committed, so
-- no worker, POS sync or alert sender can ever see a fixture. Real pending
-- refunds are passed to every claim as exclusions, so none is claimed.
--
-- It proves, against the functions as stored:
--   * a release backs the refund off by refund_retry_delay(attempt_count), and
--     a refund not yet due is not claimed, while one that is due is;
--   * the tenth release writes 'failed' with the last reason, marks the order
--     refund_state 'failed', and R14 then reports it;
--   * R18 is silent at or under 1 hour, with no attempt and while processing,
--     a warning over 1 hour and at exactly 24 hours, a critical over 24 hours,
--     and its incident turns critical in place with one escalated alert;
--   * the payment card counts the critical R18 incident.
do $probe$
declare
  c_tag     constant text := 'zzprobe-20261016120000';
  v_branch  uuid := gen_random_uuid();
  v_oc      uuid := gen_random_uuid();   -- the refund driven to the cap
  v_ow      uuid := gen_random_uuid();   -- R18 warning
  v_ok      uuid := gen_random_uuid();   -- R18 critical
  v_oy      uuid := gen_random_uuid();   -- under 1 hour
  v_oz      uuid := gen_random_uuid();   -- never tried
  v_o1h     uuid := gen_random_uuid();   -- exactly 1 hour: not yet
  v_o23     uuid := gen_random_uuid();   -- 23 h 59: still a warning
  v_o24     uuid := gen_random_uuid();   -- exactly 24 hours: still a warning
  v_opr     uuid := gen_random_uuid();   -- being processed
  v_rc      uuid := gen_random_uuid();
  v_rw      uuid := gen_random_uuid();
  v_foreign uuid[];
  v_claim   uuid;
  v_row     public.order_refunds;
  v_run     bigint;
  v_status  text;
  v_inc     uuid;
  v_card    jsonb;
  v_n       integer;
  i         integer;
begin
  begin
    insert into public.branches (id, name_en, name_ar) values (v_branch, c_tag, c_tag);
    -- refund_state 'none', so open_order_refund_record opens nothing beside the
    -- probe's own refund rows; the first release moves it to 'pending'.
    insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
                               payment_method, payment_status, refund_state)
    values (v_oc, 'ZZPROBE-RB-C', v_branch, 'pickup', 50, 50, 'cash', 'pending', 'none'),
           (v_ow, 'ZZPROBE-RB-W', v_branch, 'pickup', 40, 40, 'cash', 'pending', 'none'),
           (v_ok, 'ZZPROBE-RB-K', v_branch, 'pickup', 30, 30, 'cash', 'pending', 'none'),
           (v_oy, 'ZZPROBE-RB-Y', v_branch, 'pickup', 20, 20, 'cash', 'pending', 'none'),
           (v_oz, 'ZZPROBE-RB-Z', v_branch, 'pickup', 10, 10, 'cash', 'pending', 'none'),
           (v_o1h, 'ZZPROBE-RB-1H', v_branch, 'pickup', 11, 11, 'cash', 'pending', 'none'),
           (v_o23, 'ZZPROBE-RB-23', v_branch, 'pickup', 12, 12, 'cash', 'pending', 'none'),
           (v_o24, 'ZZPROBE-RB-24', v_branch, 'pickup', 13, 13, 'cash', 'pending', 'none'),
           (v_opr, 'ZZPROBE-RB-PR', v_branch, 'pickup', 14, 14, 'cash', 'pending', 'none');
    v_foreign := array(select r.id from public.order_refunds r where r.status = 'pending');

    -- ---- The back-off and the due filter ----------------------------------------
    insert into public.order_refunds (id, order_id, provider, charge_ref, idempotency_key,
                                      amount, currency, status, attempt_count)
    values (v_rc, v_oc, 'moyasar', 'zzprobe_pay_c', c_tag || '-c', 50, 'SAR', 'pending', 0);
    for i in 1 .. 10 loop
      select refund_id into v_claim from public.claim_order_refund(c_tag || '-' || i, v_foreign);
      if v_claim is distinct from v_rc then
        raise exception 'VERIFY: a due refund was not claimed at attempt % (got %)', i, v_claim;
      end if;
      if not public.finalize_order_refund(v_rc, c_tag || '-' || i, 'pending', null,
                                          'provider_no_answer', 'probe no answer ' || i) then
        raise exception 'VERIFY: the probe could not release its own claim at attempt %', i;
      end if;
      select * into v_row from public.order_refunds where id = v_rc;
      if i < 10 then
        if v_row.status is distinct from 'pending'
           or v_row.next_attempt_at is distinct from now() + public.refund_retry_delay(i) then
          raise exception 'VERIFY: release % left status % and next_attempt_at %, expected pending at now() + %',
            i, v_row.status, v_row.next_attempt_at, public.refund_retry_delay(i);
        end if;
        -- Not due yet: not claimed.
        select refund_id into v_claim from public.claim_order_refund(c_tag || '-early-' || i, v_foreign);
        if v_claim is not null then
          raise exception 'VERIFY: a refund not yet due was claimed after release %', i;
        end if;
        -- Due now: the next iteration claims it.
        update public.order_refunds set next_attempt_at = now() where id = v_rc;
      end if;
    end loop;

    -- ---- The cap ------------------------------------------------------------------
    if v_row.status is distinct from 'failed' or v_row.attempt_count is distinct from 10
       or v_row.failure_code is distinct from 'provider_no_answer'
       or v_row.last_error_safe is distinct from 'Automatic refund stopped after 10 attempts. Last reason: probe no answer 10'
       or v_row.next_attempt_at is not null or v_row.claim_token is not null then
      raise exception 'VERIFY cap: the tenth release left status %, attempts %, code %, error %, next %',
        v_row.status, v_row.attempt_count, v_row.failure_code, v_row.last_error_safe, v_row.next_attempt_at;
    end if;
    if (select o.refund_state || '/' || coalesce(o.refund_failure_code, 'NULL') from public.orders o where o.id = v_oc)
       is distinct from 'failed/provider_no_answer' then
      raise exception 'VERIFY cap: the order does not read refund_state failed with the last reason';
    end if;

    -- ---- R18 fixtures -------------------------------------------------------------
    insert into public.order_refunds (id, order_id, provider, charge_ref, idempotency_key, amount, currency,
                                      status, attempt_count, failure_code, created_at)
    values (v_rw, v_ow, 'moyasar', 'zzprobe_pay_w', c_tag || '-w', 40, 'SAR', 'pending', 2, 'http_503',
            now() - interval '61 minutes');
    insert into public.order_refunds (order_id, provider, charge_ref, idempotency_key, amount, currency,
                                      status, attempt_count, failure_code, created_at)
    values (v_ok, 'moyasar', 'zzprobe_pay_k', c_tag || '-k', 30, 'SAR', 'pending', 9, 'http_503',
            now() - interval '24 hours 1 minute'),
           (v_oy, 'moyasar', 'zzprobe_pay_y', c_tag || '-y', 20, 'SAR', 'pending', 3, 'http_503',
            now() - interval '59 minutes'),
           (v_oz, 'moyasar', 'zzprobe_pay_z', c_tag || '-z', 10, 'SAR', 'pending', 0, null,
            now() - interval '30 hours'),
           (v_o1h, 'moyasar', 'zzprobe_pay_1h', c_tag || '-1h', 11, 'SAR', 'pending', 1, 'http_503',
            now() - interval '1 hour'),
           (v_o23, 'moyasar', 'zzprobe_pay_23', c_tag || '-23', 12, 'SAR', 'pending', 6, 'http_503',
            now() - interval '23 hours 59 minutes'),
           (v_o24, 'moyasar', 'zzprobe_pay_24', c_tag || '-24', 13, 'SAR', 'pending', 9, 'http_503',
            now() - interval '24 hours'),
           (v_opr, 'moyasar', 'zzprobe_pay_pr', c_tag || '-pr', 14, 'SAR', 'processing', 3, null,
            now() - interval '30 hours');

    perform pg_advisory_xact_lock(748291035);
    v_run := public.order_integrity_watchdog();
    select r.status into v_status from public.order_integrity_runs r where r.id = v_run;
    if v_status is distinct from 'success' then
      raise exception 'VERIFY: the probe watchdog run did not succeed (%)', coalesce(v_status, 'NULL');
    end if;

    if not exists (select 1 from public.order_integrity_incidents
                    where fingerprint = 'REFUND_FAILED:' || v_oc and status = 'open' and severity = 'critical') then
      raise exception 'VERIFY R14: the refund stopped by the cap raised no REFUND_FAILED incident';
    end if;
    if exists (select 1 from public.order_integrity_incidents where fingerprint = 'REFUND_STUCK:' || v_oc) then
      raise exception 'VERIFY R18: a failed refund was reported as stuck';
    end if;
    select id into v_inc from public.order_integrity_incidents
     where fingerprint = 'REFUND_STUCK:' || v_ow and status = 'open' and severity = 'warning';
    if v_inc is null then
      raise exception 'VERIFY R18: a refund pending 61 minutes after 2 attempts raised no warning';
    end if;
    if not exists (select 1 from public.order_integrity_incidents
                    where fingerprint = 'REFUND_STUCK:' || v_ok and status = 'open' and severity = 'critical') then
      raise exception 'VERIFY R18: a refund pending over 24 hours raised no critical';
    end if;
    select count(*) into v_n from public.order_integrity_incidents
     where fingerprint in ('REFUND_STUCK:' || v_oy, 'REFUND_STUCK:' || v_oz,
                           'REFUND_STUCK:' || v_o1h, 'REFUND_STUCK:' || v_opr);
    if v_n <> 0 then
      raise exception 'VERIFY R18: % incident(s) for a refund at or under 1 hour, never tried, or being processed', v_n;
    end if;
    select count(*) into v_n from public.order_integrity_incidents
     where fingerprint in ('REFUND_STUCK:' || v_o23, 'REFUND_STUCK:' || v_o24)
       and status = 'open' and severity = 'warning';
    if v_n <> 2 then
      raise exception 'VERIFY R18: refunds 23 h 59 and exactly 24 h old are not both warnings (critical is OVER 24 hours)';
    end if;

    -- The same incident turns critical once its refund is over 24 hours old,
    -- and, having alerted at warning, writes one escalated alert.
    update public.order_integrity_incidents set first_detected_at = now() - interval '20 minutes' where id = v_inc;
    v_run := public.order_integrity_watchdog();
    if not exists (select 1 from public.order_integrity_alert_outbox
                    where incident_id = v_inc and alert_type = 'opened' and severity = 'warning') then
      raise exception 'VERIFY R18: the warning incident wrote no opened alert after 15 minutes';
    end if;
    update public.order_refunds set created_at = now() - interval '25 hours' where id = v_rw;
    v_run := public.order_integrity_watchdog();
    if not exists (select 1 from public.order_integrity_incidents
                    where id = v_inc and status = 'open' and severity = 'critical') then
      raise exception 'VERIFY R18: the warning incident did not turn critical in place';
    end if;
    if (select count(*) from public.order_integrity_alert_outbox
         where incident_id = v_inc and alert_type = 'escalated' and severity = 'critical') <> 1 then
      raise exception 'VERIFY R18: turning critical did not write exactly one escalated alert';
    end if;

    -- The payment card counts critical R18 incidents.
    select x into v_card from jsonb_array_elements(public.operations_health_snapshot_internal() -> 'systems') x
     where x ->> 'id' = 'payment';
    select count(*) into v_n from public.order_integrity_incidents
     where status <> 'resolved' and severity = 'critical'
       and rule_code in ('PAID_ORDER_AWAITING_PAYMENT', 'CAPTURED_PAYMENT_WITHOUT_ORDER',
                         'PAYMENT_AMOUNT_MISMATCH', 'DUPLICATE_PROVIDER_REFERENCE',
                         'MULTIPLE_SUCCESSFUL_CAPTURES', 'REFUND_FAILED', 'DUPLICATE_PAYMENT_RECORDED',
                         'PAYMENT_VERIFICATION_MISMATCH', 'PAYMENT_CONFIRMATION_FAILED', 'REFUND_STUCK');
    if v_n < 3 or (v_card -> 'details' ->> 'integrity_critical_count')::integer is distinct from v_n then
      raise exception 'VERIFY: the payment card counts % payment incidents, expected % (R18 included)',
        coalesce(v_card -> 'details' ->> 'integrity_critical_count', 'NULL'), v_n;
    end if;

    raise exception 'ROLLBACK_PROBE';
  exception
    when others then
      if sqlerrm is distinct from 'ROLLBACK_PROBE' then raise; end if;
  end;

  -- The probe is only honest if the rollback is proven, not assumed.
  if exists (select 1 from public.orders where order_number like 'ZZPROBE-RB-%')
     or exists (select 1 from public.branches where id = v_branch)
     or exists (select 1 from public.order_refunds where idempotency_key like c_tag || '%')
     or exists (select 1 from public.order_integrity_incidents
                 where fingerprint in ('REFUND_FAILED:' || v_oc, 'REFUND_STUCK:' || v_ow, 'REFUND_STUCK:' || v_ok)) then
    raise exception 'VERIFY: a probe row survived the sub-transaction';
  end if;
end
$probe$;

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- Re-apply the previous definitions from their own files:
--   claim_order_refund                    20261013120000 (its function block
--                                         and grants);
--   order_integrity_watchdog              20261013120000 (its function block);
--   operations_health_snapshot_internal   20261013120000 (its function block,
--                                         grants and comment);
--   finalize_order_refund                 20260724120000 (its function block
--                                         and grants);
-- then:
--   drop function if exists public.refund_retry_delay(integer);
--   alter table public.order_refunds drop column if exists next_attempt_at;
-- Refunds already written 'failed' by the cap stay failed: that is a record of
-- what happened, and R14 keeps reporting them until a person acts. Watchdog
-- incidents opened by R18 stay as history; with the rule gone nothing detects
-- them, so they resolve after two scans.
