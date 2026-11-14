-- ============================================================================
-- PAYMENT AND REFUND VISIBILITY: refund and payment problems reach staff, and
-- one stuck refund no longer takes every refund claim.
--
-- Gaps PG-01 (the visibility and fairness parts), PG-02 (the alert and list
-- parts) and PG-25 in docs/readiness/20261113-card-payments-gaps.md.
--
-- WHAT WAS WRONG, read from the code at 52a3976 (the live definitions are the
-- repository's; see PRE-IMAGES below for what was and was not proven):
--
--   1. ONE STUCK REFUND TOOK EVERY CLAIM. claim_order_refund() took the OLDEST
--      pending refund by created_at. A refund the worker cannot finish (Moyasar
--      refusing our address, a proxy or network error, a 5xx or 429, a missing
--      key) is released as 'pending' and stays the oldest, so payment-refund's
--      next claim, in the same run, took it again. One stuck refund therefore
--      used all 5 claims of every run (every 5 minutes: up to 1,440 claims a
--      day, nearly each one a Moyasar call through the metered proxy), and every
--      newer refund waited behind it.
--   2. NOBODY SAW A FAILED REFUND. No watchdog rule, health card, alert or
--      console screen read order_refunds. list_failed_order_refunds() existed
--      and nothing called it.
--   3. NOBODY SAW A DOUBLE CHARGE OR A PAYMENT WITH NO ORDER. A duplicate
--      payment is a 'failed' payment_records row with failure_code
--      'duplicate_payment'; a payment that settled but did not match its
--      checkout is 'failed' with 'verification_mismatch'; a payment whose order
--      could not be created or marked paid leaves only an integration_sync_logs
--      row ('finalize_failed' / 'confirm_failed'). The watchdog's capture rules
--      read 'paid' rows only, so none of the three raised anything.
--   4. ORDINARY ABANDONED CHECKOUTS READ AS "PAYMENT DEGRADED". The payment
--      health card counted every attempt still 'initiated' 30 minutes after it
--      opened. A customer who closes the card page leaves exactly that.
--
-- WHAT THIS DOES
--
--   A. claim_order_refund(p_claim_token, p_exclude_refund_ids uuid[] default
--      '{}') takes the LEAST RECENTLY TOUCHED pending refund (updated_at, then
--      created_at, then id) and skips the ids the caller passes. finalize
--      stamps updated_at when it releases a refund, so a refund that was just
--      tried goes to the back of the queue. payment-refund passes the ids it has
--      already claimed in the run, so a refund is tried at most once per run.
--      No attempt cap, no back-off and no "stuck after" age are added: those
--      numbers are the owner's (PG-01).
--   B. Four watchdog rules, each for a definite event with no threshold, in the
--      existing style and severity scheme (all critical, like R3-R6):
--        R14 REFUND_FAILED                  an automatic refund gave up
--        R15 DUPLICATE_PAYMENT_RECORDED     a second payment for one checkout
--        R16 PAYMENT_VERIFICATION_MISMATCH  a settled payment that matched nothing
--        R17 PAYMENT_CONFIRMATION_FAILED    money taken, order not confirmed
--      Every watchdog incident already reaches the alert inbox through the
--      order-integrity card (fingerprint 'order_integrity:incidents'); these
--      four are also added to the payment card's incident count, so the
--      payment card reads 'failing' for them like it does for R2-R6.
--   C. list_payments_needing_attention(p_limit): admin-only (is_admin(): role
--      AND AAL2), the console card's feed. Four lists: failed refunds nobody
--      has replaced, pending refunds already tried at least once, duplicate and
--      mismatch payment records, and payments whose confirmation failed. Safe
--      columns only: no secret, no raw provider payload, no customer field. It
--      returns the Moyasar payment id, because that is what staff type into
--      Moyasar's dashboard to refund by hand (docs/PAYMENTS.md section 10); the
--      receipt already shows the same id to staff.
--   D. PG-25: the payment card's stale-attempt count reads only attempts a
--      payment SETTLED on (provider_ref is set). See the comment at the
--      predicate for the evidence and why the other option, ignoring attempts
--      past their invoice expiry, was not taken.
--
-- WHAT THIS DOES NOT DO: refund anything, change when a refund is owed, retry
-- or cap a refund, decide who receives alerts, or change place_order or
-- compute_order_snapshot (asserted below).
--
-- ORDER OF THE LIVE STEPS (each its own CLAUDE.md section 5 approval):
--   1. apply THIS FILE, named by version 20261013120000;
--   2. THEN deploy payment-refund. The new worker passes
--      p_exclude_refund_ids, which only this file defines; deployed first it
--      would claim nothing until the apply. The old worker keeps working after
--      the apply (the parameter defaults to an empty list), and gets the
--      back-of-the-queue ordering at once.
--   The console card is safe on merge: until step 1 it hides itself.
--
-- PRE-IMAGES. Each replaced body is checked before it is replaced:
--   * order_integrity_watchdog: md5(prosrc) a05add09270f96881199d4e3da0f94c8,
--     equal to the live value read 2026-11-14;
--   * operations_health_snapshot_internal: the repository body as written
--     (1e300b3d61759729e523d7c74224ce78) or as live holds it, with its
--     \u escapes at or above U+0020 decoded by the transport
--     (2545639fcf3421dbaf35ae023d6ed68d, ledger row 115);
--   * claim_order_refund: the live body is NOT byte-equal to the repository
--     (live md5(prosrc) 13d67fdd..., 1 279 characters; repository a2c334b2...,
--     1 586). Ledger row 51 records the 2026-07-29 apply as content-equivalent
--     (skel "=") with the stored text condensed. That was not re-proven for
--     this file, so the guard compares the CONTENT: comments, whitespace and
--     semicolons removed, lower-cased, the ledger's skel rule. A live body
--     whose content differs refuses the apply instead of being overwritten.
--   A re-apply is accepted: each guard also accepts its own post-image.
--
-- NOT APPLIED TO PRODUCTION by this change.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Pre-image guards
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_n    integer;
  v_hash text;
begin
  -- claim_order_refund: the old one-argument function (first apply), this
  -- file's two-argument one (re-apply), or both, which is what replaying the
  -- whole chain onto itself leaves (20260724120000 re-creates the old one
  -- beside this one). Every overload present must be one of the two known
  -- bodies; the section below then leaves exactly the new one.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claim_order_refund'
     and p.oid is distinct from to_regprocedure('public.claim_order_refund(text)')
     and p.oid is distinct from to_regprocedure('public.claim_order_refund(text, uuid[])');
  if v_n <> 0 then
    raise exception 'claim_order_refund has % unexpected overload(s)', v_n;
  end if;
  if to_regprocedure('public.claim_order_refund(text)') is null
     and to_regprocedure('public.claim_order_refund(text, uuid[])') is null then
    raise exception 'claim_order_refund is missing';
  end if;
  if to_regprocedure('public.claim_order_refund(text)') is not null then
    select md5(lower(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '[[:space:];]+', '', 'g')))
      into v_hash from pg_proc p where p.oid = to_regprocedure('public.claim_order_refund(text)');
    if v_hash is distinct from '727e7909eb24142d42083b583be98bc5' then
      raise exception 'claim_order_refund(text) is not the 20260724120000 body (content md5 %): read the live body before re-deriving',
        coalesce(v_hash, 'NULL');
    end if;
  end if;
  if to_regprocedure('public.claim_order_refund(text, uuid[])') is not null then
    select md5(lower(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '[[:space:];]+', '', 'g')))
      into v_hash from pg_proc p where p.oid = to_regprocedure('public.claim_order_refund(text, uuid[])');
    if v_hash is distinct from 'e20c906d9a4d39cdb585bafe0460b0c3' then
      raise exception 'claim_order_refund(text, uuid[]) is not this file''s body (content md5 %)', coalesce(v_hash, 'NULL');
    end if;
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'order_integrity_watchdog';
  if v_n <> 1 then
    raise exception 'expected exactly one order_integrity_watchdog, found %', v_n;
  end if;
  select md5(p.prosrc) into v_hash from pg_proc p where p.oid = to_regprocedure('public.order_integrity_watchdog()');
  if v_hash is distinct from 'a05add09270f96881199d4e3da0f94c8'
     and v_hash is distinct from 'fb4fc4e2bdcee6ec46ced01029269cb0' then
    raise exception 'order_integrity_watchdog is not the 20260831120000 body (md5 %): re-derive this file', coalesce(v_hash, 'NULL');
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_health_snapshot_internal';
  if v_n <> 1 then
    raise exception 'expected exactly one operations_health_snapshot_internal, found %', v_n;
  end if;
  select md5(p.prosrc) into v_hash from pg_proc p
   where p.oid = to_regprocedure('public.operations_health_snapshot_internal()');
  if v_hash is distinct from '1e300b3d61759729e523d7c74224ce78'
     and v_hash is distinct from '2545639fcf3421dbaf35ae023d6ed68d'
     and v_hash is distinct from 'ccf08e21718864e8462e65852dea670a'
     and v_hash is distinct from 'c13838a669d5edcdb3ffa6f3d24455c1' then
    raise exception 'operations_health_snapshot_internal is not the 20261003120000 body (md5 %): re-derive this file',
      coalesce(v_hash, 'NULL');
  end if;

  -- The names this file adds must be free, or already this file's.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('list_payments_needing_attention', 'payments_needing_attention_internal')
     and pg_get_function_identity_arguments(p.oid) <> 'p_limit integer';
  if v_n <> 0 then
    raise exception 'an unexpected overload of list_payments_needing_attention or payments_needing_attention_internal exists';
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------
-- 1. claim_order_refund: the back of the queue, and once per run
-- ---------------------------------------------------------------------------
-- The signature gains a parameter, which `create or replace` cannot do, so the
-- one-argument function is dropped first. Nothing depends on it (it is called
-- through PostgREST only), and one transaction covers the drop and the create.
-- With the new parameter defaulted, the payment-refund build deployed today,
-- which passes only p_claim_token, resolves to the new function unchanged.
--
-- DERIVED, NOT RETYPED: 20260724120000_order_confirmation_state_machine.sql,
-- the only definition, with four anchored substitutions (the signature, one
-- declaration, the candidate scan, and the grants' signature). FOR UPDATE SKIP
-- LOCKED, the per-candidate re-check, the token, the attempt counter and the
-- order's refund_state are untouched.
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
  for v_id in
    select id from public.order_refunds
     where status = 'pending'
       and id <> all (v_exclude)
     order by updated_at, created_at, id
     limit 50
  loop
    select * into v_row from public.order_refunds
     where id = v_id and status = 'pending'
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
-- 2. The log rows R17 and the console read, through a partial index
-- ---------------------------------------------------------------------------
-- integration_sync_logs is written on every POS sync and is never pruned
-- (20261001120000 does not touch it). R17 runs every two minutes and reads only
-- failed Moyasar confirmation rows, which this index holds and nothing else, so
-- the rule's cost does not grow with the log.
create index if not exists integration_sync_logs_moyasar_unconfirmed_idx
  on public.integration_sync_logs (created_at)
  where provider = 'moyasar' and status = 'failed' and error in ('finalize_failed', 'confirm_failed');

-- ---------------------------------------------------------------------------
-- 3. order_integrity_watchdog: R14-R17
-- ---------------------------------------------------------------------------
-- Re-emitted whole because `create or replace` takes no smaller unit.
-- DERIVED, NOT RETYPED: 20260831120000_watchdog_cash_order_coverage.sql, the
-- latest definition, with the four rule blocks inserted at one anchor (the
-- confirmation_required scope note), asserted to match once. R1-R13, the
-- incident lifecycle and the outbox are byte-identical. The new codes default
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
-- 4. operations_health_snapshot_internal: PG-25 and the payment rule list
-- ---------------------------------------------------------------------------
-- Re-emitted whole because `create or replace` takes no smaller unit.
-- DERIVED, NOT RETYPED: 20261003120000_moyasar_only_payments.sql, the latest
-- definition, with two anchored substitutions, each asserted to match once:
--
--   (a) PG-25. The stale-attempt count keeps its window (created in the last
--       24 hours, open for more than 30 minutes) and now also requires
--       provider_ref. WHY THIS OPTION, from the code:
--         * provider_ref is written on an attempt in one place only,
--           stampPaymentRef in supabase/functions/_shared/moyasarVerify.ts,
--           and only for a payment Moyasar reports paid that binds to the
--           attempt, immediately before finalize_checkout_session /
--           confirm_order_payment. begin_payment_attempt and
--           begin_session_attempt open attempts without it; payment-initiate
--           writes only the invoice id (provider_checkout_ref).
--         * a confirmation moves the row to 'paid', and a duplicate to
--           'failed'. So an attempt still 'initiated' WITH provider_ref is
--           money Moyasar took whose confirmation did not finish: the case
--           worth a warning. An abandoned or declined checkout never has it.
--         * the other option, ignoring attempts past their invoice expiry,
--           would make the count blind. The invoice expiry is 30 minutes live
--           (settable 5-60), so an attempt open past 30 minutes is almost
--           always past its expiry already, and the money-taken case above is
--           past expiry too. It would have hidden the one case that matters.
--   (b) The payment card's incident count names its rule codes, so the four
--       new rules are added to it. A monitor that enumerates its subjects by
--       name goes quiet when one is added (CLAUDE.md section 8).
--
-- The other nine cards, the cron allowlist and the overall state are
-- byte-identical. The \u escapes in the payment card's configuration read are
-- kept as written; the transport has decoded those at or above U+0020 before
-- (ledger rows 111 and 115), which changes the stored text and not its value.
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
        'PAYMENT_CONFIRMATION_FAILED'
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
  'Read-only Operations Health snapshot. Since 20260807 it carries an order_flow card in the critical set; since 20260820 the cron allowlist also observes branch-availability-sweep, and a NON-critical branch_availability card reports whether timed closures actually reopen — the sweeper swallows its own errors, so pg_cron cannot see a sweep that runs and fails. Since 20260925 that card also observes branch_variant_availability, so a stuck PRICE TIER counts toward closed_sizes and toward the overdue-restore backlog. Since 20261003 the payment card''s configured flag mirrors resolveMoyasarConfig: provider moyasar, a secret key with the selected mode''s prefix, and a webhook token. Since 20261013 its stale-attempt count reads only attempts a payment settled on (provider_ref set), so an abandoned checkout no longer reads degraded, and its payment incident count includes the refund and payment rules REFUND_FAILED, DUPLICATE_PAYMENT_RECORDED, PAYMENT_VERIFICATION_MISMATCH and PAYMENT_CONFIRMATION_FAILED. Counts only: no branch identity, PII, secrets, raw provider payloads, tokens, cron commands or external provider probe results.';

-- ---------------------------------------------------------------------------
-- 5. list_payments_needing_attention: the console card's feed
-- ---------------------------------------------------------------------------
-- Two functions, the operations_health_summary pattern: an admin-gated wrapper
-- the console calls, and an ungated internal one that only the service role
-- and the wrapper can reach. The split is what lets this file CALL the real
-- queries in its self-verification below, which a plpgsql body needs: it is
-- not name-resolved until it runs.
--
-- Each list uses the same predicate as its watchdog rule, so the card and the
-- alert can never disagree about what needs a person:
--   failed_refunds        R14: the newest failed refund of each order that no
--                         live or succeeded refund replaced and that is not
--                         recorded refunded. list_failed_order_refunds() is
--                         not reused as it is: it lists EVERY failed row, a
--                         retried-and-succeeded one included, which would
--                         keep a settled refund on the card. Its column names
--                         are kept for the fields both share.
--   retrying_refunds      pending refunds tried at least once. Listed with
--                         the attempt count, the last error and both times,
--                         and NOT alerted: the age after which a pending
--                         refund counts as stuck is the owner's decision.
--   payments_to_refund    R15 and R16: failed duplicate and mismatch records.
--   unconfirmed_payments  R17: Moyasar took the money and the order was not
--                         created or not marked paid.
--
-- Oldest first in each list. At most p_limit items each (default 50, clamped
-- to 1..100); each total counts every row. No raw payload, secret, card number
-- or customer field: payment_ref is the Moyasar payment id, read from
-- provider_ref (or, for a mismatch, which is never stamped, from the id field of
-- the sanitized payment the attempt stores).
create or replace function public.payments_needing_attention_internal(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_failed jsonb;
  v_retrying jsonb;
  v_payments jsonb;
  v_unconfirmed jsonb;
begin
  with f as (
    select distinct on (fr.order_id) fr.*
      from public.order_refunds fr
     where fr.status = 'failed'
     order by fr.order_id, fr.updated_at desc, fr.created_at desc, fr.id desc
  ), s as (
    select f.id, f.order_id, o.order_number, f.amount, f.currency, f.attempt_count,
           f.failure_code, f.last_error_safe, f.created_at, f.updated_at,
           f.charge_ref as payment_ref
      from f
      join public.orders o on o.id = f.order_id
     where not exists (select 1 from public.order_refunds lr
                        where lr.order_id = f.order_id
                          and lr.status in ('pending','processing','succeeded'))
       and o.refund_state is distinct from 'refunded'
  )
  select jsonb_build_object(
           'total', (select count(*)::integer from s),
           'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at, x.id)
                                from (select * from s order by updated_at, id limit v_limit) x),
                             '[]'::jsonb))
    into v_failed;

  with s as (
    select r.id, r.order_id, o.order_number, r.amount, r.currency, r.attempt_count,
           r.failure_code, r.last_error_safe, r.created_at, r.updated_at,
           r.charge_ref as payment_ref
      from public.order_refunds r
      join public.orders o on o.id = r.order_id
     where r.status = 'pending' and r.attempt_count >= 1
  )
  select jsonb_build_object(
           'total', (select count(*)::integer from s),
           'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id)
                                from (select * from s order by created_at, id limit v_limit) x),
                             '[]'::jsonb))
    into v_retrying;

  with s as (
    select pr.id, pr.failure_code as kind, pr.order_id, o.order_number,
           pr.amount, pr.currency, pr.mode, pr.failure_message_safe,
           coalesce(pr.provider_ref, pr.raw->>'id') as payment_ref,
           pr.created_at, pr.last_verified_at
      from public.payment_records pr
      left join public.orders o on o.id = pr.order_id
     where pr.status = 'failed'
       and pr.failure_code in ('duplicate_payment', 'verification_mismatch')
  )
  select jsonb_build_object(
           'total', (select count(*)::integer from s),
           'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at, x.id)
                                from (select * from s order by created_at, id limit v_limit) x),
                             '[]'::jsonb))
    into v_payments;

  with g as (
    select l.request->>'payment_id' as payment_ref,
           (array_agg(l.error order by l.created_at desc))[1] as error,
           (array_agg(l.order_id order by l.created_at desc)
              filter (where l.order_id is not null))[1] as order_id,
           count(*)::integer as log_count,
           min(l.created_at) as first_logged_at,
           max(l.created_at) as last_logged_at
      from public.integration_sync_logs l
     where l.provider = 'moyasar' and l.status = 'failed'
       and l.error in ('finalize_failed', 'confirm_failed')
       and coalesce(l.request->>'payment_id', '') <> ''
     group by l.request->>'payment_id'
  ), s as (
    select g.payment_ref, g.error, g.order_id, o.order_number,
           att.id as payment_record_id, att.amount, att.currency, att.mode,
           g.log_count, g.first_logged_at, g.last_logged_at
      from g
      left join public.orders o on o.id = g.order_id
      left join lateral (
        select pr.id, pr.amount, pr.currency, pr.mode
          from public.payment_records pr
         where pr.provider = 'moyasar' and pr.provider_ref = g.payment_ref
         limit 1
      ) att on true
     where not exists (
             select 1 from public.payment_records pr
              where pr.provider = 'moyasar' and pr.provider_ref = g.payment_ref
                and (pr.status in ('paid','refunded')
                     or pr.failure_code in ('duplicate_payment','verification_mismatch')))
  )
  select jsonb_build_object(
           'total', (select count(*)::integer from s),
           'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.first_logged_at, x.payment_ref)
                                from (select * from s order by first_logged_at, payment_ref limit v_limit) x),
                             '[]'::jsonb))
    into v_unconfirmed;

  return jsonb_build_object(
    'failed_refunds', v_failed,
    'retrying_refunds', v_retrying,
    'payments_to_refund', v_payments,
    'unconfirmed_payments', v_unconfirmed);
end $$;

-- GRANTS. EXECUTE is revoked from `public` AND `anon` explicitly: this
-- project's pg_default_acl grants EXECUTE on new functions to `anon`,
-- `authenticated` and `service_role` directly (CLAUDE.md section 8, ledger row
-- 101). The internal function is closed to both client roles.
revoke all on function public.payments_needing_attention_internal(integer) from public, anon, authenticated;
grant execute on function public.payments_needing_attention_internal(integer) to service_role;

comment on function public.payments_needing_attention_internal(integer) is
  'Ungated core of list_payments_needing_attention (service role and the wrapper only): failed refunds no retry replaced, pending refunds tried at least once, duplicate and mismatch payment records, and payments whose confirmation failed. Safe columns only, the Moyasar payment id included; no raw payload, secret or customer field (20261013120000).';

create or replace function public.list_payments_needing_attention(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins may view refunds and payments needing attention' using errcode = '42501';
  end if;
  return public.payments_needing_attention_internal(p_limit);
end $$;

revoke all on function public.list_payments_needing_attention(integer) from public, anon;
grant execute on function public.list_payments_needing_attention(integer) to authenticated;

comment on function public.list_payments_needing_attention(integer) is
  'Console feed "Refunds and payments needing attention" (is_admin enforced internally: role and AAL2). Four lists, oldest first, each {total, items}: failed_refunds, retrying_refunds, payments_to_refund, unconfirmed_payments. p_limit default 50, clamped to 1..100 (20261013120000).';

-- ---------------------------------------------------------------------------
-- 6. Self-verification, part 1: structure, grants, the gate, the money path
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
  v_state text;
  v_code  text;
  v_txt   text;
begin
  -- claim_order_refund ------------------------------------------------------
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claim_order_refund';
  if v_n <> 1 then
    raise exception 'VERIFY: expected 1 claim_order_refund, found %', v_n;
  end if;
  v_oid := to_regprocedure('public.claim_order_refund(text, uuid[])');
  if v_oid is null then
    raise exception 'VERIFY: claim_order_refund(text, uuid[]) is missing';
  end if;
  -- The default is what keeps today's payment-refund build working.
  if (select p.pronargdefaults from pg_proc p where p.oid = v_oid) is distinct from 1::smallint then
    raise exception 'VERIFY: p_exclude_refund_ids has no default, so the deployed worker could not call claim_order_refund';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = v_oid) is distinct from true then
    raise exception 'VERIFY: claim_order_refund is not SECURITY DEFINER';
  end if;
  if not coalesce((select 'search_path=public' = any (p.proconfig) from pg_proc p where p.oid = v_oid), false) then
    raise exception 'VERIFY: claim_order_refund search_path is not pinned to public';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') or has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'VERIFY: a client role can execute claim_order_refund, which moves refunds';
  end if;
  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'VERIFY: service_role cannot execute claim_order_refund, so the worker could not';
  end if;
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src from pg_proc p where p.oid = v_oid;
  if position('order by updated_at, created_at, id' in v_src) = 0 then
    raise exception 'VERIFY: the claim does not take the least recently touched refund first';
  end if;
  if position('order by created_at' in v_src) > 0 then
    raise exception 'VERIFY: the claim still orders by created_at';
  end if;
  if position('and id <> all (v_exclude)' in v_src) = 0 then
    raise exception 'VERIFY: the claim does not skip the refunds this run already claimed';
  end if;
  if position('array_remove(p_exclude_refund_ids, null)' in v_src) = 0 then
    raise exception 'VERIFY: a NULL in p_exclude_refund_ids could hide the whole queue';
  end if;
  if position('for update skip locked' in v_src) = 0 then
    raise exception 'VERIFY: the claim lost FOR UPDATE SKIP LOCKED';
  end if;

  -- order_integrity_watchdog ------------------------------------------------
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'order_integrity_watchdog';
  if v_n <> 1 then
    raise exception 'VERIFY: expected 1 order_integrity_watchdog, found %', v_n;
  end if;
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p where p.oid = to_regprocedure('public.order_integrity_watchdog()');
  select count(distinct m[1]) into v_n from regexp_matches(v_src, 'v_rules->>''([A-Z_]+)''', 'g') m;
  if v_n <> 17 then
    raise exception 'VERIFY: the watchdog guards % rules, expected 17 (13 + R14-R17)', v_n;
  end if;
  foreach v_code in array array['REFUND_FAILED', 'DUPLICATE_PAYMENT_RECORDED',
                                'PAYMENT_VERIFICATION_MISMATCH', 'PAYMENT_CONFIRMATION_FAILED'] loop
    if position(format('if coalesce((v_rules->>%L), ''true'') <> ''false'' then', v_code) in v_src) = 0 then
      raise exception 'VERIFY: rule % has no enable guard', v_code;
    end if;
    if position(format('%L, ''critical''', v_code) in v_src) = 0 then
      raise exception 'VERIFY: rule % is not inserted at critical severity', v_code;
    end if;
  end loop;

  -- operations_health_snapshot_internal -------------------------------------
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_health_snapshot_internal';
  if v_n <> 1 then
    raise exception 'VERIFY: expected 1 operations_health_snapshot_internal, found %', v_n;
  end if;
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p where p.oid = to_regprocedure('public.operations_health_snapshot_internal()');
  if v_src !~ 'where status = ''initiated''\s+and provider_ref is not null\s+and created_at >= now\(\) - interval ''24 hours''\s+and coalesce\(initiated_at, created_at\) < now\(\) - interval ''30 minutes'';' then
    raise exception 'VERIFY: the stale-attempt count does not require a settled payment (PG-25)';
  end if;
  if v_src !~ '''MULTIPLE_SUCCESSFUL_CAPTURES'',\s+''REFUND_FAILED'',\s+''DUPLICATE_PAYMENT_RECORDED'',\s+''PAYMENT_VERIFICATION_MISMATCH'',\s+''PAYMENT_CONFIRMATION_FAILED''\s+\);' then
    raise exception 'VERIFY: the payment card does not count the four new rules';
  end if;

  -- list_payments_needing_attention and its internal core -------------------
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('list_payments_needing_attention', 'payments_needing_attention_internal');
  if v_n <> 2 then
    raise exception 'VERIFY: expected one overload each of the two attention functions, found % in all', v_n;
  end if;
  v_oid := to_regprocedure('public.list_payments_needing_attention(integer)');
  if v_oid is null then
    raise exception 'VERIFY: list_payments_needing_attention(integer) is missing';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = v_oid) is distinct from true then
    raise exception 'VERIFY: list_payments_needing_attention is not SECURITY DEFINER';
  end if;
  if not coalesce((select 'search_path=public' = any (p.proconfig) from pg_proc p where p.oid = v_oid), false) then
    raise exception 'VERIFY: list_payments_needing_attention search_path is not pinned to public';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'VERIFY: anon can execute list_payments_needing_attention, which must never be true';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'VERIFY: authenticated cannot execute list_payments_needing_attention, so the console cannot';
  end if;
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src from pg_proc p where p.oid = v_oid;
  if position('if not public.is_admin() then' in v_src) = 0
     or position('if not public.is_admin() then' in v_src) > position('payments_needing_attention_internal' in v_src) then
    raise exception 'VERIFY: list_payments_needing_attention does not check is_admin() before it reads anything';
  end if;

  v_oid := to_regprocedure('public.payments_needing_attention_internal(integer)');
  if v_oid is null then
    raise exception 'VERIFY: payments_needing_attention_internal(integer) is missing';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') or has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'VERIFY: a client role can execute the ungated payments_needing_attention_internal';
  end if;
  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'VERIFY: service_role cannot execute payments_needing_attention_internal';
  end if;

  -- The gate, as an OUTCOME: called as `authenticated` with no identity (not
  -- an admin), it must refuse with 42501.
  begin
    set local role authenticated;
    perform public.list_payments_needing_attention(5);
    reset role;
    v_state := 'no error';
  exception when others then
    v_state := sqlstate;
    reset role;
  end;
  if v_state is distinct from '42501' then
    raise exception 'VERIFY: a non-admin caller got %, expected 42501', coalesce(v_state, 'NULL');
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
-- 20260920120000 pattern). Every order carries an explicit order number, so
-- set_order_number never calls nextval and no SM- number is burnt. What does
-- survive an abort: the order_change_events and order_integrity_runs id
-- sequences each advance, which nothing reads as a count. The fixtures are
-- uncommitted, so no worker, POS sync or alert sender can ever see them.
--
-- It proves, against the functions as stored:
--   * fairness: the least recently touched pending refund is claimed first, a
--     refund just released goes behind one that waited, excluded ids are never
--     claimed, and a NULL in the exclusion list hides nothing;
--   * each of R14-R17 fires on its event and stays silent on its nearest
--     healthy row;
--   * the alert inbox: the order-integrity card raises the critical
--     'order_integrity:incidents' condition, and the payment card counts
--     exactly the open critical incidents of its nine rule codes;
--   * PG-25: the stale count equals the settled-attempt predicate, and the
--     probe's abandoned attempt, which the old predicate counted, is outside it;
--   * the console feed: every list returns the right rows with exactly its
--     columns.
-- Real rows are never asserted on: real pending refunds are passed as
-- exclusions, and every count is compared against the same predicate run here.
do $probe$
declare
  c_tag     constant text := 'zzprobe-20261013120000';
  v_branch  uuid := gen_random_uuid();
  v_oa      uuid := gen_random_uuid();
  v_ob      uuid := gen_random_uuid();
  v_of      uuid := gen_random_uuid();
  v_os      uuid := gen_random_uuid();
  v_or      uuid := gen_random_uuid();
  v_ot      uuid := gen_random_uuid();
  v_op      uuid := gen_random_uuid();
  v_ra      uuid := gen_random_uuid();
  v_rb      uuid := gen_random_uuid();
  v_rf      uuid := gen_random_uuid();
  v_pdup    uuid := gen_random_uuid();
  v_pdupr   uuid := gen_random_uuid();
  v_pmm     uuid := gen_random_uuid();
  v_pexp    uuid := gen_random_uuid();
  v_foreign uuid[];
  v_claim   uuid;
  v_run     bigint;
  v_status  text;
  v_snap    jsonb;
  v_card    jsonb;
  v_att     jsonb;
  v_keys    text;
  v_n       integer;
  v_m       integer;
begin
  begin
    insert into public.branches (id, name_en, name_ar) values (v_branch, c_tag, c_tag);
    insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
                               payment_method, payment_status, refund_state)
    values (v_oa, 'ZZPROBE-RV-A', v_branch, 'pickup', 50, 50, 'cash', 'pending', 'none'),
           (v_ob, 'ZZPROBE-RV-B', v_branch, 'pickup', 40, 40, 'cash', 'pending', 'none'),
           (v_of, 'ZZPROBE-RV-F', v_branch, 'pickup', 30, 30, 'cash', 'pending', 'failed'),
           (v_os, 'ZZPROBE-RV-S', v_branch, 'pickup', 20, 20, 'cash', 'pending', 'refunded'),
           (v_or, 'ZZPROBE-RV-R', v_branch, 'pickup', 10, 10, 'cash', 'pending', 'refunded'),
           (v_ot, 'ZZPROBE-RV-T', v_branch, 'pickup', 15, 15, 'cash', 'pending', 'none');
    insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
                               payment_method, payment_status, paid_at)
    values (v_op, 'ZZPROBE-RV-P', v_branch, 'pickup', 25, 25, 'online', 'paid', now());

    -- ---- Fairness ----------------------------------------------------------
    -- A was created LATER than B but touched EARLIER: ordering by created_at
    -- takes B, ordering by updated_at takes A.
    insert into public.order_refunds (id, order_id, provider, charge_ref, idempotency_key,
                                      amount, currency, status, attempt_count, created_at, updated_at)
    values (v_ra, v_oa, 'moyasar', 'zzprobe_pay_a', c_tag || '-a', 50, 'SAR', 'pending', 0,
            now() - interval '10 minutes', now() - interval '9 minutes'),
           (v_rb, v_ob, 'moyasar', 'zzprobe_pay_b', c_tag || '-b', 40, 'SAR', 'pending', 1,
            now() - interval '20 minutes', now() - interval '2 minutes');
    v_foreign := array(select r.id from public.order_refunds r
                        where r.status = 'pending' and r.id not in (v_ra, v_rb));

    select refund_id into v_claim from public.claim_order_refund(c_tag || '-1', v_foreign);
    if v_claim is distinct from v_ra then
      raise exception 'VERIFY fairness: the least recently touched refund was not claimed first (got %)', v_claim;
    end if;
    if not public.finalize_order_refund(v_ra, c_tag || '-1', 'pending', null, null, null) then
      raise exception 'VERIFY fairness: the probe could not release its own claim';
    end if;
    -- A was just released, so B, untouched since, comes first now.
    select refund_id into v_claim from public.claim_order_refund(c_tag || '-2', v_foreign);
    if v_claim is distinct from v_rb then
      raise exception 'VERIFY fairness: a refund just released was claimed ahead of one that waited (got %)', v_claim;
    end if;
    perform public.finalize_order_refund(v_rb, c_tag || '-2', 'pending', null, null, null);
    -- Excluded ids are never claimed.
    select refund_id into v_claim from public.claim_order_refund(c_tag || '-3', v_foreign || array[v_ra, v_rb]);
    if v_claim is not null then
      raise exception 'VERIFY fairness: an excluded refund was claimed (%)', v_claim;
    end if;
    -- A NULL element must not hide the rest of the queue.
    select refund_id into v_claim from public.claim_order_refund(c_tag || '-4', v_foreign || array[v_rb, null::uuid]);
    if v_claim is distinct from v_ra then
      raise exception 'VERIFY fairness: a NULL in the exclusion list hid the queue (got %)', v_claim;
    end if;
    perform public.finalize_order_refund(v_ra, c_tag || '-4', 'pending', null, 'provider_no_answer', 'probe');

    -- ---- Fixtures for R14-R17, each beside its nearest healthy row -----------
    insert into public.order_refunds (id, order_id, provider, charge_ref, idempotency_key,
                                      amount, currency, status, attempt_count, failure_code, last_error_safe)
    values (v_rf, v_of, 'moyasar', 'zzprobe_pay_f', c_tag || '-f', 30, 'SAR', 'failed', 3, 'http_400', 'probe');
    insert into public.order_refunds (order_id, provider, charge_ref, idempotency_key,
                                      amount, currency, status, attempt_count, failure_code, created_at)
    values (v_os, 'moyasar', 'zzprobe_pay_s', c_tag || '-s1', 20, 'SAR', 'failed', 1, 'http_400', now() - interval '2 hours'),
           (v_or, 'moyasar', 'zzprobe_pay_r', c_tag || '-r', 10, 'SAR', 'failed', 1, 'http_400', now() - interval '2 hours');
    insert into public.order_refunds (order_id, provider, charge_ref, idempotency_key,
                                      amount, currency, status, attempt_count)
    values (v_os, 'moyasar', 'zzprobe_pay_s', c_tag || '-s2', 20, 'SAR', 'succeeded', 1);
    -- A failed refund that a newer one replaced while the order is NOT yet
    -- refunded: only R14's "a newer refund exists" clause keeps it quiet.
    insert into public.order_refunds (order_id, provider, charge_ref, idempotency_key,
                                      amount, currency, status, attempt_count, failure_code, created_at, updated_at)
    values (v_ot, 'moyasar', 'zzprobe_pay_t', c_tag || '-t1', 15, 'SAR', 'failed', 1, 'http_400',
            now() - interval '2 hours', now() - interval '2 hours'),
           (v_ot, 'moyasar', 'zzprobe_pay_t', c_tag || '-t2', 15, 'SAR', 'pending', 0, null, now(), now());

    insert into public.payment_records (id, order_id, provider, provider_ref, status, amount, currency,
                                        mode, failure_code, failure_message_safe, raw)
    values (v_pdup,  v_oa, 'moyasar', 'zzprobe_pay_dup', 'failed', 50, 'SAR', 'live', 'duplicate_payment', 'probe', null),
           (v_pdupr, v_oa, 'moyasar', 'zzprobe_pay_dup_refunded', 'refunded', 50, 'SAR', 'live', 'duplicate_payment', 'probe', null),
           (v_pmm,   v_oa, 'moyasar', null, 'failed', 50, 'SAR', 'live', 'verification_mismatch', 'probe',
            jsonb_build_object('id', 'zzprobe_pay_mm', 'status', 'paid')),
           (v_pexp,  v_oa, 'moyasar', null, 'failed', 50, 'SAR', 'live', 'expired', 'probe', null);
    -- PG-25: two attempts open for 40 minutes, both past a 30-minute invoice
    -- expiry as every such attempt is; only the settled one may count.
    insert into public.payment_records (order_id, provider, provider_ref, status, amount, currency, mode,
                                        created_at, initiated_at, expires_at)
    values (v_oa, 'moyasar', null, 'initiated', 50, 'SAR', 'live',
            now() - interval '40 minutes', now() - interval '40 minutes', now() - interval '10 minutes'),
           (v_ob, 'moyasar', 'zzprobe_pay_settled', 'initiated', 40, 'SAR', 'live',
            now() - interval '40 minutes', now() - interval '40 minutes', now() - interval '10 minutes');
    -- R17's healthy row: a failure logged for a payment that later confirmed.
    insert into public.payment_records (order_id, provider, provider_ref, status, amount, currency, mode)
    values (v_op, 'moyasar', 'zzprobe_pay_conf', 'paid', 25, 'SAR', 'live');
    insert into public.integration_sync_logs (provider, order_id, direction, status, request, error)
    values ('moyasar', null, 'webhook', 'failed', jsonb_build_object('payment_id', 'zzprobe_pay_unconf', 'session', c_tag), 'finalize_failed'),
           ('moyasar', null, 'webhook', 'failed', jsonb_build_object('payment_id', 'zzprobe_pay_unconf'), 'finalize_failed'),
           ('moyasar', null, 'webhook', 'failed', jsonb_build_object('payment_id', 'zzprobe_pay_conf'), 'finalize_failed'),
           ('moyasar', v_oa, 'webhook', 'failed', jsonb_build_object('payment_id', 'zzprobe_pay_dup'), 'confirm_failed');

    -- ---- The watchdog, under its own lock -----------------------------------
    -- Taken with a WAIT, so a cron run in progress is waited for rather than
    -- overlapped. The watchdog's own try-lock is re-entrant in this session.
    perform pg_advisory_xact_lock(748291035);
    v_run := public.order_integrity_watchdog();
    select r.status into v_status from public.order_integrity_runs r where r.id = v_run;
    if v_status is distinct from 'success' then
      raise exception 'VERIFY: the probe watchdog run did not succeed (%)', coalesce(v_status, 'NULL');
    end if;

    -- Each rule fires on its event ...
    if not exists (select 1 from public.order_integrity_incidents
                    where fingerprint = 'REFUND_FAILED:' || v_of and status = 'open' and severity = 'critical') then
      raise exception 'VERIFY R14: a failed refund raised no incident';
    end if;
    if not exists (select 1 from public.order_integrity_incidents
                    where fingerprint = 'DUPLICATE_PAYMENT_RECORDED:' || v_pdup and status = 'open' and severity = 'critical') then
      raise exception 'VERIFY R15: a duplicate payment raised no incident';
    end if;
    if not exists (select 1 from public.order_integrity_incidents
                    where fingerprint = 'PAYMENT_VERIFICATION_MISMATCH:' || v_pmm and status = 'open' and severity = 'critical') then
      raise exception 'VERIFY R16: a mismatched payment raised no incident';
    end if;
    if not exists (select 1 from public.order_integrity_incidents
                    where fingerprint = 'PAYMENT_CONFIRMATION_FAILED:' || md5('moyasar:zzprobe_pay_unconf')
                      and status = 'open' and severity = 'critical') then
      raise exception 'VERIFY R17: a logged confirmation failure raised no incident';
    end if;
    -- ... and on nothing healthy beside it.
    select count(*) into v_n from public.order_integrity_incidents
     where fingerprint in ('REFUND_FAILED:' || v_os, 'REFUND_FAILED:' || v_or, 'REFUND_FAILED:' || v_ot,
                           'REFUND_FAILED:' || v_oa, 'REFUND_FAILED:' || v_ob,
                           'DUPLICATE_PAYMENT_RECORDED:' || v_pdupr,
                           'DUPLICATE_PAYMENT_RECORDED:' || v_pexp,
                           'PAYMENT_VERIFICATION_MISMATCH:' || v_pexp,
                           'PAYMENT_CONFIRMATION_FAILED:' || md5('moyasar:zzprobe_pay_conf'),
                           'PAYMENT_CONFIRMATION_FAILED:' || md5('moyasar:zzprobe_pay_dup'));
    if v_n <> 0 then
      raise exception 'VERIFY R14-R17: % incident(s) raised on a healthy row', v_n;
    end if;
    -- Payment ids reach the watchdog's tables only as fingerprints.
    if exists (select 1 from public.order_integrity_incidents
                where fingerprint like '%zzprobe_pay_%' or safe_details::text like '%zzprobe_pay_%') then
      raise exception 'VERIFY: a raw payment id reached order_integrity_incidents';
    end if;

    -- ---- The alert inbox and the payment card -------------------------------
    v_snap := public.operations_health_snapshot_internal();
    select x into v_card from jsonb_array_elements(v_snap -> 'systems') x where x ->> 'id' = 'payment';
    select count(*) into v_n from public.order_integrity_incidents
     where status <> 'resolved' and severity = 'critical'
       and rule_code in ('PAID_ORDER_AWAITING_PAYMENT', 'CAPTURED_PAYMENT_WITHOUT_ORDER',
                         'PAYMENT_AMOUNT_MISMATCH', 'DUPLICATE_PROVIDER_REFERENCE',
                         'MULTIPLE_SUCCESSFUL_CAPTURES', 'REFUND_FAILED', 'DUPLICATE_PAYMENT_RECORDED',
                         'PAYMENT_VERIFICATION_MISMATCH', 'PAYMENT_CONFIRMATION_FAILED');
    if v_n < 4 or (v_card -> 'details' ->> 'integrity_critical_count')::integer is distinct from v_n then
      raise exception 'VERIFY: the payment card counts % payment incidents, expected % (the four new rules included)',
        coalesce(v_card -> 'details' ->> 'integrity_critical_count', 'NULL'), v_n;
    end if;
    if not exists (
         select 1 from jsonb_array_elements(public.operations_alerts_derive(
                         v_snap, (select to_jsonb(s) from public.operations_alert_settings s))) c
          where c ->> 'fingerprint' = 'order_integrity:incidents' and c ->> 'severity' = 'critical') then
      raise exception 'VERIFY: the new incidents did not reach the alert inbox as a critical order_integrity:incidents alert';
    end if;

    -- ---- PG-25 ---------------------------------------------------------------
    select count(*) into v_n from public.payment_records
     where status = 'initiated' and provider_ref is not null
       and created_at >= now() - interval '24 hours'
       and coalesce(initiated_at, created_at) < now() - interval '30 minutes';
    select count(*) into v_m from public.payment_records
     where status = 'initiated'
       and created_at >= now() - interval '24 hours'
       and coalesce(initiated_at, created_at) < now() - interval '30 minutes';
    if (v_card -> 'details' ->> 'stale_initiated_24h')::integer is distinct from v_n then
      raise exception 'VERIFY PG-25: the payment card counts % stale attempts, expected % settled ones',
        coalesce(v_card -> 'details' ->> 'stale_initiated_24h', 'NULL'), v_n;
    end if;
    if v_m <= v_n or v_n < 1 then
      raise exception 'VERIFY PG-25: the probe could not tell an abandoned attempt (% open) from a settled one (%)', v_m, v_n;
    end if;

    -- ---- The console feed ------------------------------------------------------
    v_att := public.payments_needing_attention_internal(100);
    if not exists (select 1 from jsonb_array_elements(v_att -> 'failed_refunds' -> 'items') e
                    where (e ->> 'id')::uuid = v_rf and e ->> 'payment_ref' = 'zzprobe_pay_f') then
      raise exception 'VERIFY feed: the failed refund is missing from failed_refunds';
    end if;
    if exists (select 1 from jsonb_array_elements(v_att -> 'failed_refunds' -> 'items') e
                where (e ->> 'order_id')::uuid in (v_os, v_or, v_ot)) then
      raise exception 'VERIFY feed: failed_refunds lists a refund that was replaced or recorded refunded';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_att -> 'retrying_refunds' -> 'items') e
                    where (e ->> 'id')::uuid = v_ra and (e ->> 'attempt_count')::integer = 2
                      and e ->> 'failure_code' = 'provider_no_answer')
       or not exists (select 1 from jsonb_array_elements(v_att -> 'retrying_refunds' -> 'items') e
                       where (e ->> 'id')::uuid = v_rb and (e ->> 'attempt_count')::integer = 2) then
      raise exception 'VERIFY feed: retrying_refunds does not show both retried refunds with their attempts and last error';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_att -> 'payments_to_refund' -> 'items') e
                    where (e ->> 'id')::uuid = v_pdup and e ->> 'kind' = 'duplicate_payment'
                      and e ->> 'payment_ref' = 'zzprobe_pay_dup')
       or not exists (select 1 from jsonb_array_elements(v_att -> 'payments_to_refund' -> 'items') e
                       where (e ->> 'id')::uuid = v_pmm and e ->> 'kind' = 'verification_mismatch'
                         and e ->> 'payment_ref' = 'zzprobe_pay_mm') then
      raise exception 'VERIFY feed: payments_to_refund misses the duplicate or the mismatch, or its payment id';
    end if;
    if exists (select 1 from jsonb_array_elements(v_att -> 'payments_to_refund' -> 'items') e
                where (e ->> 'id')::uuid in (v_pdupr, v_pexp)) then
      raise exception 'VERIFY feed: payments_to_refund lists a refunded duplicate or an ordinary expired attempt';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_att -> 'unconfirmed_payments' -> 'items') e
                    where e ->> 'payment_ref' = 'zzprobe_pay_unconf' and (e ->> 'log_count')::integer = 2
                      and e ->> 'error' = 'finalize_failed') then
      raise exception 'VERIFY feed: unconfirmed_payments misses the payment whose order was never created';
    end if;
    if exists (select 1 from jsonb_array_elements(v_att -> 'unconfirmed_payments' -> 'items') e
                where e ->> 'payment_ref' in ('zzprobe_pay_conf', 'zzprobe_pay_dup')) then
      raise exception 'VERIFY feed: unconfirmed_payments lists a payment that confirmed or became a duplicate';
    end if;
    -- Exactly these columns, and never a raw payload.
    select string_agg(distinct k, ',' order by k) into v_keys
      from jsonb_array_elements((v_att -> 'failed_refunds' -> 'items') || (v_att -> 'retrying_refunds' -> 'items')) e,
           jsonb_object_keys(e) k;
    if v_keys is distinct from 'amount,attempt_count,created_at,currency,failure_code,id,last_error_safe,order_id,order_number,payment_ref,updated_at' then
      raise exception 'VERIFY feed: refund columns are %', coalesce(v_keys, 'NULL');
    end if;
    select string_agg(distinct k, ',' order by k) into v_keys
      from jsonb_array_elements(v_att -> 'payments_to_refund' -> 'items') e, jsonb_object_keys(e) k;
    if v_keys is distinct from 'amount,created_at,currency,failure_message_safe,id,kind,last_verified_at,mode,order_id,order_number,payment_ref' then
      raise exception 'VERIFY feed: payment columns are %', coalesce(v_keys, 'NULL');
    end if;
    select string_agg(distinct k, ',' order by k) into v_keys
      from jsonb_array_elements(v_att -> 'unconfirmed_payments' -> 'items') e, jsonb_object_keys(e) k;
    if v_keys is distinct from 'amount,currency,error,first_logged_at,last_logged_at,log_count,mode,order_id,order_number,payment_record_id,payment_ref' then
      raise exception 'VERIFY feed: unconfirmed-payment columns are %', coalesce(v_keys, 'NULL');
    end if;

    raise exception 'ROLLBACK_PROBE';
  exception
    when others then
      if sqlerrm is distinct from 'ROLLBACK_PROBE' then raise; end if;
  end;

  -- The probe is only honest if the rollback is proven, not assumed.
  if exists (select 1 from public.orders where order_number like 'ZZPROBE-RV-%')
     or exists (select 1 from public.branches where id = v_branch)
     or exists (select 1 from public.order_refunds where idempotency_key like c_tag || '%')
     or exists (select 1 from public.payment_records where provider_ref like 'zzprobe_pay_%' or id in (v_pmm, v_pexp))
     or exists (select 1 from public.integration_sync_logs where request ->> 'payment_id' like 'zzprobe_pay_%')
     or exists (select 1 from public.order_integrity_incidents
                 where fingerprint in ('REFUND_FAILED:' || v_of, 'DUPLICATE_PAYMENT_RECORDED:' || v_pdup,
                                       'PAYMENT_VERIFICATION_MISMATCH:' || v_pmm,
                                       'PAYMENT_CONFIRMATION_FAILED:' || md5('moyasar:zzprobe_pay_unconf'))) then
    raise exception 'VERIFY: a probe row survived the sub-transaction';
  end if;
end
$probe$;

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- Re-apply the previous definitions from their own files, in this order:
--   order_integrity_watchdog              20260831120000 (its function block);
--   operations_health_snapshot_internal   20261003120000 (its function block,
--                                         grants and comment);
--   claim_order_refund                    drop function
--                                         public.claim_order_refund(text, uuid[]);
--                                         then 20260724120000's function block
--                                         and its grants. Do this only while the
--                                         deployed payment-refund does not pass
--                                         p_exclude_refund_ids.
-- then:
--   drop function if exists public.list_payments_needing_attention(integer);
--   drop function if exists public.payments_needing_attention_internal(integer);
--   drop index if exists public.integration_sync_logs_moyasar_unconfirmed_idx;
-- Watchdog incidents already opened by R14-R17 stay as history. With the rules
-- gone nothing detects them, so they resolve after two scans that no longer
-- detect them (a rule code missing from rule_enabled counts as enabled).
