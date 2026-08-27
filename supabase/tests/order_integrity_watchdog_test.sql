-- ============================================================================
-- Tests for the Order Integrity Watchdog v1 (migration 20260721170000).
--
-- Runs against a throwaway Postgres with all migrations applied. Transactional
-- (begin … rollback); each case RAISES on failure. Fixtures are seeded directly
-- (session_replication_role=replica to skip FK/enqueue triggers); the watchdog
-- function IS invoked (it only reads orders/payment_records and writes its own
-- isolated tables). is_admin()/is_staff() honour the test.is_admin GUC (see the
-- throwaway bootstrap); auth.uid() is null here so acknowledged_by stays null.
--
-- The transaction-scoped advisory lock is re-entrant within this one session, so
-- sequential watchdog calls in a single test all proceed; the OVERLAP case uses
-- dblink (a second backend) and SKIPS cleanly when no self-conninfo is set.
-- ============================================================================
begin;


-- A branch to hang test orders on. `orders.branch_id` is a real FK to
-- public.branches, and every case below cares about sync / payment / integrity
-- state rather than about WHICH branch, so one fixed row serves all of them.
-- Self-contained on purpose: not the seed's branch, so the suite does not
-- depend on supabase/seed.sql having been loaded.
insert into public.branches (id, name_en, name_ar)
values ('b0000000-0000-0000-0000-0000000000ff', 'Suite Branch', 'فرع الاختبار')
on conflict (id) do nothing;

select set_config('test.is_admin', 'true', true);
select set_config('test.auth_uid', '', true);

-- Reset helper: clears watchdog state + seeded operational rows (throwaway only).
create function pg_temp.oiw_reset() returns void language plpgsql as $$
begin
  delete from public.order_integrity_alert_outbox;
  delete from public.order_integrity_incidents;
  delete from public.order_integrity_runs;
  delete from public.payment_records;
  delete from public.orders;
end $$;

-- Seed one order (only the columns the watchdog reads; NOT NULL others defaulted).
create function pg_temp.oiw_order(
  p_num text, p_state text, p_pay text default 'pending', p_type text default 'pickup',
  p_status text default 'received', p_ref text default null,
  p_paid_at timestamptz default null, p_next timestamptz default null,
  p_created timestamptz default null, p_total numeric default 10,
  p_blocked text default null, p_name text default 'Guest', p_phone text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
     status, payment_status, lazywait_sync_state, lazywait_ref, paid_at, sync_next_attempt_at,
     created_at, updated_at, sync_blocked_reason, customer_name, customer_phone)
  values (v_id, p_num, 'b0000000-0000-0000-0000-0000000000ff', p_type::public.order_type, p_total, p_total,
     p_status::public.order_status, p_pay::public.payment_status, p_state, p_ref, p_paid_at, p_next,
     coalesce(p_created, now()), coalesce(p_created, now()), p_blocked, p_name, p_phone);
  set local session_replication_role = origin;
  return v_id;
end $$;

create function pg_temp.oiw_pay(
  p_order uuid, p_status text, p_amount numeric, p_ref text,
  p_txn text default null, p_when timestamptz default null)
returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  insert into public.payment_records (order_id, provider, provider_ref, status, amount, currency,
     reference_transaction, updated_at, created_at)
  values (p_order, 'tap', p_ref, p_status, p_amount, 'SAR', p_txn,
     coalesce(p_when, now()), coalesce(p_when, now()));
  set local session_replication_role = origin;
end $$;

-- Assert the given run is a durable CONFIG failure and the incident survived it.
create function pg_temp.oiw_expect_cfg_fail(p_run bigint, p_inc uuid, p_label text)
returns void language plpgsql as $$
declare v_status text; v_code text; v_msg text; v_incstatus text; v_clean int;
begin
  select status, safe_error_code, safe_error_message into v_status, v_code, v_msg
    from public.order_integrity_runs where id = p_run;
  if v_status <> 'failed' then
    raise exception 'CFG[%]: run not failed (got %)', p_label, v_status; end if;
  if coalesce(v_code,'') = 'overlap_skipped' then
    raise exception 'CFG[%]: benign overlap code, not a real config failure', p_label; end if;
  if v_msg <> 'watchdog configuration invalid' then
    raise exception 'CFG[%]: wrong/leaky safe message: %', p_label, v_msg; end if;
  select status, consecutive_clean_count into v_incstatus, v_clean
    from public.order_integrity_incidents where id = p_inc;
  if v_incstatus = 'resolved' then
    raise exception 'CFG[%]: incident was resolved on a failed config run', p_label; end if;
  if v_clean <> 0 then
    raise exception 'CFG[%]: clean counter advanced on a failed config run', p_label; end if;
end $$;

-- ---- OVERLAP: a concurrent backend holding the lock -> overlap_skipped -------
-- Placed FIRST so this session does not yet hold the (re-entrant) advisory lock.
do $$
declare
  v_conn text := coalesce(nullif(current_setting('test.dblink_conninfo', true), ''), '');
  v_run bigint; v_status text; v_code text;
begin
  if not exists (select 1 from pg_extension where extname='dblink') then
    begin execute 'create extension dblink'; exception when others then null; end;
  end if;
  if not exists (select 1 from pg_extension where extname='dblink') or v_conn = '' then
    raise notice 'SKIP overlap: dblink/conninfo unavailable'; return;
  end if;
  perform dblink_connect('oiw_hold', v_conn);
  perform dblink_exec('oiw_hold', 'begin');
  perform t.x from dblink('oiw_hold', 'select 1 from (select pg_advisory_xact_lock(748291035)) s') as t(x int);

  v_run := public.order_integrity_watchdog();
  select status, safe_error_code into v_status, v_code from public.order_integrity_runs where id=v_run;
  if v_status <> 'failed' or v_code <> 'overlap_skipped' then
    raise exception 'OVERLAP FAILED: expected failed/overlap_skipped -> % / %', v_status, v_code; end if;
  -- No incidents were created while overlapped.
  if (select count(*) from public.order_integrity_incidents) <> 0 then
    raise exception 'OVERLAP FAILED: incidents created during overlap'; end if;

  perform dblink_exec('oiw_hold', 'rollback');
  perform dblink_disconnect('oiw_hold');
  perform pg_temp.oiw_reset();
  raise notice 'OVERLAP OK';
end $$;

-- ---- RULE DETECTION MATRIX: TP present, nearest-FP + exclusions absent -------
do $$
declare
  v_excluded uuid; v_r5a uuid; v_r5b uuid; v_r6 uuid; v_r4 uuid; v_run bigint;
begin
  perform pg_temp.oiw_reset();
  -- config: abandoned cutoff between the TP (-25h) and legacy (-30h); exclude one order.
  update public.order_integrity_config set value = to_jsonb(now() - interval '28 hours')
   where key = 'abandoned_awaiting_payment_since';

  -- R1 true positives + nearest false positives / exclusions
  perform pg_temp.oiw_order('W-R1-TP','failed','paid','pickup','received',null, now()-interval '6m', now()+interval '5m', null,10,null,'SECRET_NAME','+966SECRETPHONE');
  perform pg_temp.oiw_order('W-R1-MAPBLOCK','blocked','paid','pickup','received',null, now()-interval '6m', null, null,10,'missing_mapping');
  perform pg_temp.oiw_order('W-R1-AGE','failed','paid','pickup','received',null, now()-interval '4m', now()+interval '5m');            -- < 5m
  perform pg_temp.oiw_order('W-R1-CANCEL','failed','paid','pickup','cancelled',null, now()-interval '6m', now()+interval '5m');        -- cancelled
  perform pg_temp.oiw_order('W-R1-DELVBLOCK','blocked','paid','pickup','received',null, now()-interval '6m', null, null,10,'delivery_schema_unconfirmed'); -- intentional
  perform pg_temp.oiw_order('W-SYNCED-OK','synced','paid','pickup','received','REFOK', now()-interval '6m');                            -- clean
  v_excluded := pg_temp.oiw_order('W-EXCLUDED','failed','paid','pickup','received',null, now()-interval '6m', now()+interval '5m');    -- config-excluded
  update public.order_integrity_config
     set value = jsonb_build_array(jsonb_build_object('order_id', v_excluded, 'until', (now()+interval '1h')::text, 'reason','authorized test'))
   where key = 'excluded_order_ids';

  perform pg_temp.oiw_order('W-R2-TP','awaiting_payment','paid');                                                                      -- R2
  perform pg_temp.oiw_order('W-R7-TP','dead_letter','paid','pickup','received',null, now()-interval '6m');                             -- R7
  -- sync_last_error can carry a provider error body echoing PII; the watchdog must
  -- NOT copy it verbatim (only a has_last_error boolean). Seed a PII-bearing value
  -- so the '%SECRET%' assertion below is a real regression guard for R7.
  update public.orders set sync_last_error = 'LazyWait 400: {"customer_name":"SECRET_NAME","phone":"+966SECRETPHONE"}' where order_number='W-R7-TP';
  perform pg_temp.oiw_order('W-R8-TP','synced','pending','pickup','received','   ');                                                   -- R8 whitespace ref
  perform pg_temp.oiw_order('W-R9-TP','failed','pending','pickup','received','REFX', null, now()+interval '5m');                       -- R9 usable ref, non-synced
  perform pg_temp.oiw_order('W-R10-TP','pending','pending','pickup','received',null, null, now()-interval '11m');                      -- R10 overdue
  perform pg_temp.oiw_order('W-R10-FUTURE','failed','pending','pickup','received',null, null, now()+interval '5m');                    -- future retry
  perform pg_temp.oiw_order('W-R10-RECENT','pending','pending','pickup','received',null, null, now()-interval '5m');                   -- overdue < 10m
  perform pg_temp.oiw_order('W-R11-TP','awaiting_payment','pending','pickup','received',null,null,null, now()-interval '25h');         -- R11 (after cutoff)
  perform pg_temp.oiw_order('W-R11-LEGACY','awaiting_payment','pending','pickup','received',null,null,null, now()-interval '30h');     -- legacy (before cutoff)
  -- confirmation_required is intentionally NOT a rule (handled by the verification
  -- feed); seed one to prove the watchdog leaves it alone.
  perform pg_temp.oiw_order('W-CONF-REQ','confirmation_required','paid','pickup','received',null, now()-interval '20m');               -- must NOT be flagged

  -- R3: paid payment record whose order is NOT paid (>3m); nearest-FP at 2m; and
  -- a linked PAID order (clean). payment_records requires an owner, so each row
  -- carries an order_id (the realistic anomaly: capture recorded, order not paid).
  perform pg_temp.oiw_order('W-R3-BAD','synced','pending','pickup','received','REFR3BAD');
  perform pg_temp.oiw_pay((select id from public.orders where order_number='W-R3-BAD'),'paid',10,'W-R3-REF','W-R3-TXN', now()-interval '4m');
  perform pg_temp.oiw_order('W-R3-BAD2','synced','pending','pickup','received','REFR3BAD2');
  perform pg_temp.oiw_pay((select id from public.orders where order_number='W-R3-BAD2'),'paid',10,'W-R3-AGE-REF','W-R3-AGE-TXN', now()-interval '2m');  -- < 3m
  perform pg_temp.oiw_order('W-R3-OKORD','synced','paid','pickup','received','REFR3');                                                 -- has paid order
  perform pg_temp.oiw_pay((select id from public.orders where order_number='W-R3-OKORD'),'paid',10,'W-R3-OK-REF','W-R3-OK-TXN');

  -- R4: mismatch (amount 90 vs total 100) and a match (100 vs 100).
  v_r4 := pg_temp.oiw_order('W-R4-ORD','synced','paid','pickup','received','REFR4', null,null,null,100);
  perform pg_temp.oiw_pay(v_r4,'paid',90,'W-R4-REF','W-R4-TXN');
  perform pg_temp.oiw_order('W-R4-OKORD','synced','paid','pickup','received','REFR4B', null,null,null,100);
  perform pg_temp.oiw_pay((select id from public.orders where order_number='W-R4-OKORD'),'paid',100,'W-R4-OK-REF','W-R4-OK-TXN');

  -- R5: one reference_transaction on two distinct orders (different provider_ref).
  v_r5a := pg_temp.oiw_order('W-R5-A','synced','paid','pickup','received','REFR5A', null,null,null,10);
  v_r5b := pg_temp.oiw_order('W-R5-B','synced','paid','pickup','received','REFR5B', null,null,null,10);
  perform pg_temp.oiw_pay(v_r5a,'paid',10,'W-R5-REFA','W-R5-DUP-TXN');
  perform pg_temp.oiw_pay(v_r5b,'paid',10,'W-R5-REFB','W-R5-DUP-TXN');

  -- R6: two paid captures on one order (different provider_ref AND reference_transaction).
  v_r6 := pg_temp.oiw_order('W-R6-ORD','synced','paid','pickup','received','REFR6', null,null,null,10);
  perform pg_temp.oiw_pay(v_r6,'paid',10,'W-R6-REF1','W-R6-TXN1');
  perform pg_temp.oiw_pay(v_r6,'paid',10,'W-R6-REF2','W-R6-TXN2');

  v_run := public.order_integrity_watchdog();

  -- run bookkeeping
  if (select status from public.order_integrity_runs where id=v_run) <> 'success' then
    raise exception 'MATRIX FAILED: run not success'; end if;
  if (select rules_evaluated from public.order_integrity_runs where id=v_run) <> 11 then
    raise exception 'MATRIX FAILED: rules_evaluated <> 11'; end if;

  -- per-rule detection counts
  if (select count(*) from public.order_integrity_incidents where rule_code='PAID_ORDER_NOT_SYNCED') <> 2 then
    raise exception 'MATRIX FAILED: R1 count %', (select count(*) from public.order_integrity_incidents where rule_code='PAID_ORDER_NOT_SYNCED'); end if;
  -- exactly one incident per single-TP rule
  if exists (select rc from (values
      ('PAID_ORDER_AWAITING_PAYMENT'),('CAPTURED_PAYMENT_WITHOUT_ORDER'),('PAYMENT_AMOUNT_MISMATCH'),
      ('DUPLICATE_PROVIDER_REFERENCE'),('MULTIPLE_SUCCESSFUL_CAPTURES'),('PAID_ORDER_DEAD_LETTER'),
      ('SYNCED_WITHOUT_USABLE_REFERENCE'),('REFERENCE_WITH_NON_SYNCED_STATE'),('OVERDUE_SYNC_RETRY'),
      ('ABANDONED_AWAITING_PAYMENT')) v(rc)
    where (select count(*) from public.order_integrity_incidents i where i.rule_code=v.rc) <> 1) then
    raise exception 'MATRIX FAILED: a single-TP rule did not produce exactly one incident'; end if;

  -- total detected / opened (R1 gives 2, the other 10 rules give 1 each = 12)
  if (select incidents_detected from public.order_integrity_runs where id=v_run) <> 12 then
    raise exception 'MATRIX FAILED: incidents_detected <> 12 -> %', (select incidents_detected from public.order_integrity_runs where id=v_run); end if;
  if (select incidents_opened from public.order_integrity_runs where id=v_run) <> 12 then
    raise exception 'MATRIX FAILED: incidents_opened <> 12'; end if;

  -- excluded / clean / intentionally-uncovered orders produced NO incident.
  if exists (select 1 from public.order_integrity_incidents i join public.orders o on o.id=i.order_id
              where o.order_number in ('W-R1-AGE','W-R1-CANCEL','W-R1-DELVBLOCK','W-SYNCED-OK','W-EXCLUDED',
                                       'W-R10-FUTURE','W-R10-RECENT','W-R11-LEGACY','W-R4-OKORD','W-R3-OKORD','W-R3-BAD2',
                                       'W-CONF-REQ')) then
    raise exception 'MATRIX FAILED: an excluded/clean/uncovered order produced an incident'; end if;
  -- confirmation_required is deliberately uncovered (handled by the verification feed).
  if exists (select 1 from public.order_integrity_incidents i join public.orders o on o.id=i.order_id
              where o.order_number='W-CONF-REQ') then
    raise exception 'MATRIX FAILED: confirmation_required was flagged (should be out of scope)'; end if;

  -- severity mapping: warning rules 10-11, everything else critical
  if exists (select 1 from public.order_integrity_incidents
             where rule_code in ('OVERDUE_SYNC_RETRY','ABANDONED_AWAITING_PAYMENT') and severity<>'warning') then
    raise exception 'MATRIX FAILED: warning rule not warning'; end if;
  if exists (select 1 from public.order_integrity_incidents
             where rule_code not in ('OVERDUE_SYNC_RETRY','ABANDONED_AWAITING_PAYMENT') and severity<>'critical') then
    raise exception 'MATRIX FAILED: critical rule not critical'; end if;

  -- NO PII leakage: the SECRET_NAME/phone on W-R1-TP (customer_name/phone) and the
  -- PII-bearing sync_last_error on W-R7-TP must not appear anywhere safe.
  if exists (select 1 from public.order_integrity_incidents where safe_details::text ilike '%SECRET%') then
    raise exception 'PII FAILED: secret in incident safe_details'; end if;
  if (public.order_integrity_list_incidents())::text ilike '%SECRET%' then
    raise exception 'PII FAILED: secret in list output'; end if;
  -- R7 surfaces only a boolean signal for the (redacted) error.
  if (select safe_details->>'has_last_error' from public.order_integrity_incidents
        where rule_code='PAID_ORDER_DEAD_LETTER') <> 'true' then
    raise exception 'MATRIX FAILED: R7 has_last_error not surfaced'; end if;

  -- After a single scan (critical detection_count=1) NO 'opened' alert is eligible yet.
  if (select count(*) from public.order_integrity_alert_outbox) <> 0 then
    raise exception 'MATRIX FAILED: outbox not empty after one scan'; end if;

  raise notice 'RULE MATRIX OK';
end $$;

-- ---- EXCLUSION ROBUSTNESS: a malformed config entry must not blind the scanner
do $$
declare v_run bigint;
begin
  perform pg_temp.oiw_reset();
  perform pg_temp.oiw_order('W-EXC-ROBUST','dead_letter','paid','pickup','received',null, now()-interval '6m');  -- R7 TP
  -- Malformed exclusion: NO order_id key but a valid future 'until'. A naive
  -- array_agg would inject NULL into v_excluded and `o.id <> all('{null}')` would
  -- evaluate to NULL, silently suppressing EVERY detection (fail-OPEN).
  update public.order_integrity_config
     set value = jsonb_build_array(jsonb_build_object('until', (now()+interval '1h')::text, 'reason','malformed - no order_id'))
   where key = 'excluded_order_ids';
  v_run := public.order_integrity_watchdog();
  if (select status from public.order_integrity_runs where id=v_run) <> 'success' then
    raise exception 'EXC-ROBUST FAILED: run not success'; end if;
  if (select count(*) from public.order_integrity_incidents where rule_code='PAID_ORDER_DEAD_LETTER') <> 1 then
    raise exception 'EXC-ROBUST FAILED: malformed exclusion blinded the scanner (fail-open)'; end if;
  update public.order_integrity_config set value = '[]'::jsonb where key = 'excluded_order_ids';
  raise notice 'EXCLUSION ROBUSTNESS OK';
end $$;

-- ---- GROUPED-RULE EXCLUSIONS: R5 honors excluded_order_ids BEFORE grouping ----
do $$
declare v_exc uuid; v_clean uuid; v_run bigint;
begin
  perform pg_temp.oiw_reset();
  perform set_config('test.is_admin','true', true);
  -- An EXCLUDED (authorized test) order shares a paid reference with a clean order.
  v_exc   := pg_temp.oiw_order('W-EXC-DUP','synced','paid','pickup','received','REFX',null,null,null,10);
  v_clean := pg_temp.oiw_order('W-CLEAN-DUP','synced','paid','pickup','received','REFY',null,null,null,10);
  perform pg_temp.oiw_pay(v_exc,'paid',10,'W-EXC-PR','SHARED-TXN');
  perform pg_temp.oiw_pay(v_clean,'paid',10,'W-CLEAN-PR','SHARED-TXN');   -- same reference_transaction
  update public.order_integrity_config
     set value = jsonb_build_array(jsonb_build_object('order_id', v_exc, 'until', (now()+interval '1h')::text, 'reason','authorized test'))
   where key = 'excluded_order_ids';
  v_run := public.order_integrity_watchdog();
  if (select status from public.order_integrity_runs where id=v_run) <> 'success' then
    raise exception 'GRP-EXC: run not success'; end if;
  -- Excluded order removed before grouping -> only 1 distinct order -> NO R5 incident.
  if exists (select 1 from public.order_integrity_incidents where rule_code='DUPLICATE_PROVIDER_REFERENCE') then
    raise exception 'GRP-EXC FAILED: R5 fired despite the sharing order being excluded'; end if;

  -- Sanity: WITHOUT the exclusion, the same shared reference DOES open R5.
  perform pg_temp.oiw_reset();
  update public.order_integrity_config set value='[]'::jsonb where key='excluded_order_ids';
  v_exc   := pg_temp.oiw_order('W-D1','synced','paid','pickup','received','REFA',null,null,null,10);
  v_clean := pg_temp.oiw_order('W-D2','synced','paid','pickup','received','REFB',null,null,null,10);
  perform pg_temp.oiw_pay(v_exc,'paid',10,'W-D1-PR','SHARED2');
  perform pg_temp.oiw_pay(v_clean,'paid',10,'W-D2-PR','SHARED2');
  perform public.order_integrity_watchdog();
  if (select count(*) from public.order_integrity_incidents where rule_code='DUPLICATE_PROVIDER_REFERENCE') <> 1 then
    raise exception 'GRP-EXC FAILED: R5 did not fire without the exclusion'; end if;
  raise notice 'GROUPED-RULE EXCLUSIONS OK';
end $$;

-- ---- LIFECYCLE: dedup, alert-after-2, cooldown, 2-clean resolution, recovery -
do $$
declare v_id uuid; v_run bigint; v_inc uuid;
begin
  perform pg_temp.oiw_reset();
  v_id := pg_temp.oiw_order('W-LC','failed','paid','pickup','received',null, now()-interval '6m', now()+interval '9m');

  perform public.order_integrity_watchdog();            -- scan 1: open, detection=1
  select id into v_inc from public.order_integrity_incidents where rule_code='PAID_ORDER_NOT_SYNCED';
  if (select consecutive_detection_count from public.order_integrity_incidents where id=v_inc) <> 1
     or (select status from public.order_integrity_incidents where id=v_inc) <> 'open' then
    raise exception 'LC FAILED: scan1 state'; end if;
  if (select count(*) from public.order_integrity_alert_outbox where incident_id=v_inc) <> 0 then
    raise exception 'LC FAILED: alert before 2 detections'; end if;

  perform public.order_integrity_watchdog();            -- scan 2: detection=2 -> eligible -> 1 opened alert
  if (select consecutive_detection_count from public.order_integrity_incidents where id=v_inc) <> 2 then
    raise exception 'LC FAILED: scan2 detection'; end if;
  if (select count(*) from public.order_integrity_alert_outbox where incident_id=v_inc and alert_type='opened') <> 1 then
    raise exception 'LC FAILED: opened alert not created'; end if;

  perform public.order_integrity_watchdog();            -- scan 3: dedup (still 1 incident, 1 opened)
  if (select count(*) from public.order_integrity_incidents where rule_code='PAID_ORDER_NOT_SYNCED') <> 1 then
    raise exception 'LC FAILED: duplicate incident'; end if;
  if (select count(*) from public.order_integrity_alert_outbox where incident_id=v_inc and alert_type='opened') <> 1 then
    raise exception 'LC FAILED: duplicate opened alert (cooldown)'; end if;
  if (select occurrence_count from public.order_integrity_incidents where id=v_inc) <> 3 then
    raise exception 'LC FAILED: occurrence_count'; end if;

  -- Clear the condition; two clean scans resolve (not one).
  update public.orders set lazywait_sync_state='synced', lazywait_ref='REFDONE' where id=v_id;
  perform public.order_integrity_watchdog();            -- clean scan 1 -> still open
  if (select status from public.order_integrity_incidents where id=v_inc) <> 'open'
     or (select consecutive_clean_count from public.order_integrity_incidents where id=v_inc) <> 1 then
    raise exception 'LC FAILED: resolved after ONE clean scan'; end if;

  perform public.order_integrity_watchdog();            -- clean scan 2 -> resolved + recovery alert
  if (select status from public.order_integrity_incidents where id=v_inc) <> 'resolved' then
    raise exception 'LC FAILED: not resolved after two clean scans'; end if;
  if (select count(*) from public.order_integrity_alert_outbox where incident_id=v_inc and alert_type='recovery') <> 1 then
    raise exception 'LC FAILED: recovery alert missing'; end if;

  -- A later re-detection opens a NEW incident (history preserved).
  update public.orders set lazywait_sync_state='failed', lazywait_ref=null where id=v_id;
  perform public.order_integrity_watchdog();
  if (select count(*) from public.order_integrity_incidents where rule_code='PAID_ORDER_NOT_SYNCED') <> 2 then
    raise exception 'LC FAILED: re-detection did not open a new incident'; end if;

  raise notice 'LIFECYCLE OK';
end $$;

-- ---- FAILED SCAN must not resolve, and is visible -------------------------
do $$
declare v_id uuid; v_inc uuid; v_run bigint; v_save jsonb;
begin
  perform pg_temp.oiw_reset();
  v_id := pg_temp.oiw_order('W-FAIL','failed','paid','pickup','received',null, now()-interval '6m', now()+interval '9m');
  perform public.order_integrity_watchdog();                     -- open
  update public.orders set lazywait_sync_state='synced', lazywait_ref='REFX2' where id=v_id;
  perform public.order_integrity_watchdog();                     -- clean 1
  select id into v_inc from public.order_integrity_incidents where rule_code='PAID_ORDER_NOT_SYNCED';
  if (select consecutive_clean_count from public.order_integrity_incidents where id=v_inc) <> 1 then
    raise exception 'FAILSCAN setup'; end if;

  -- Force a failed scan by removing a required config key; the sub-block raises.
  v_save := (select value from public.order_integrity_config where key='rule_enabled');
  delete from public.order_integrity_config where key='rule_enabled';
  v_run := public.order_integrity_watchdog();
  if (select status from public.order_integrity_runs where id=v_run) <> 'failed'
     or (select safe_error_code from public.order_integrity_runs where id=v_run) = 'overlap_skipped' then
    raise exception 'FAILSCAN FAILED: run not a real failed run'; end if;
  -- The incident was NOT resolved and its clean counter did NOT advance.
  if (select status from public.order_integrity_incidents where id=v_inc) <> 'open'
     or (select consecutive_clean_count from public.order_integrity_incidents where id=v_inc) <> 1 then
    raise exception 'FAILSCAN FAILED: incident changed on a failed scan'; end if;
  insert into public.order_integrity_config (key, value) values ('rule_enabled', v_save);

  raise notice 'FAILED-SCAN OK';
end $$;

-- ---- CONFIG VALIDATION: every required key fails CLOSED ----------------------
do $$
declare v_inc uuid; v_run bigint; v_re jsonb; v_ab jsonb; v_ex jsonb;
begin
  perform pg_temp.oiw_reset();
  perform pg_temp.oiw_order('W-CFG','dead_letter','paid','pickup','received',null, now()-interval '6m');  -- R7 TP
  perform public.order_integrity_watchdog();                 -- opens an incident
  select id into v_inc from public.order_integrity_incidents where rule_code='PAID_ORDER_DEAD_LETTER';
  if v_inc is null then raise exception 'CFG setup: no incident'; end if;

  select value into v_re from public.order_integrity_config where key='rule_enabled';
  select value into v_ab from public.order_integrity_config where key='abandoned_awaiting_payment_since';
  select value into v_ex from public.order_integrity_config where key='excluded_order_ids';

  -- rule_enabled: missing, then wrong type (array).
  delete from public.order_integrity_config where key='rule_enabled';
  perform pg_temp.oiw_expect_cfg_fail(public.order_integrity_watchdog(), v_inc, 'rule_enabled missing');
  insert into public.order_integrity_config(key,value) values ('rule_enabled', v_re);
  update public.order_integrity_config set value='[]'::jsonb where key='rule_enabled';
  perform pg_temp.oiw_expect_cfg_fail(public.order_integrity_watchdog(), v_inc, 'rule_enabled not object');
  update public.order_integrity_config set value=v_re where key='rule_enabled';

  -- abandoned_awaiting_payment_since: missing, null, malformed.
  delete from public.order_integrity_config where key='abandoned_awaiting_payment_since';
  perform pg_temp.oiw_expect_cfg_fail(public.order_integrity_watchdog(), v_inc, 'abandoned missing');
  insert into public.order_integrity_config(key,value) values ('abandoned_awaiting_payment_since', v_ab);
  update public.order_integrity_config set value='null'::jsonb where key='abandoned_awaiting_payment_since';
  perform pg_temp.oiw_expect_cfg_fail(public.order_integrity_watchdog(), v_inc, 'abandoned null');
  update public.order_integrity_config set value='"not-a-timestamp"'::jsonb where key='abandoned_awaiting_payment_since';
  perform pg_temp.oiw_expect_cfg_fail(public.order_integrity_watchdog(), v_inc, 'abandoned malformed');
  update public.order_integrity_config set value=v_ab where key='abandoned_awaiting_payment_since';

  -- excluded_order_ids: missing, then wrong type (object).
  delete from public.order_integrity_config where key='excluded_order_ids';
  perform pg_temp.oiw_expect_cfg_fail(public.order_integrity_watchdog(), v_inc, 'excluded missing');
  insert into public.order_integrity_config(key,value) values ('excluded_order_ids', v_ex);
  update public.order_integrity_config set value='{}'::jsonb where key='excluded_order_ids';
  perform pg_temp.oiw_expect_cfg_fail(public.order_integrity_watchdog(), v_inc, 'excluded not array');
  update public.order_integrity_config set value=v_ex where key='excluded_order_ids';

  -- After restoring valid config, a normal scan succeeds again (re-detects, still open).
  v_run := public.order_integrity_watchdog();
  if (select status from public.order_integrity_runs where id=v_run) <> 'success' then
    raise exception 'CFG FAILED: valid config did not restore a successful scan'; end if;
  if (select status from public.order_integrity_incidents where id=v_inc) = 'resolved' then
    raise exception 'CFG FAILED: incident resolved unexpectedly'; end if;

  raise notice 'CONFIG VALIDATION OK';
end $$;

-- ---- ACKNOWLEDGE + SUPPRESS (+ expiry) + auth --------------------------------
do $$
declare v_id uuid; v_inc uuid;
begin
  perform pg_temp.oiw_reset();
  v_id := pg_temp.oiw_order('W-ACK','failed','paid','pickup','received',null, now()-interval '6m', now()+interval '9m');
  perform public.order_integrity_watchdog();
  select id into v_inc from public.order_integrity_incidents where rule_code='PAID_ORDER_NOT_SYNCED';

  -- non-admin denied
  perform set_config('test.is_admin','false', true);
  begin perform public.order_integrity_acknowledge_incident(v_inc); raise exception 'ACK FAILED: non-admin allowed';
  exception when sqlstate '42501' then null; end;
  perform set_config('test.is_admin','true', true);

  -- admin ack -> acknowledged
  perform public.order_integrity_acknowledge_incident(v_inc, 'looking into it');
  if (select status from public.order_integrity_incidents where id=v_inc) <> 'acknowledged'
     or (select acknowledged_at from public.order_integrity_incidents where id=v_inc) is null then
    raise exception 'ACK FAILED'; end if;
  -- re-detection keeps it acknowledged (not reverted to open)
  perform public.order_integrity_watchdog();
  if (select status from public.order_integrity_incidents where id=v_inc) <> 'acknowledged' then
    raise exception 'ACK FAILED: reverted on re-detection'; end if;

  -- suppress requires future + reason
  begin perform public.order_integrity_suppress_incident(v_inc, now()-interval '1m', 'x'); raise exception 'SUPP FAILED: past allowed';
  exception when sqlstate 'P0001' then null; end;
  begin perform public.order_integrity_suppress_incident(v_inc, now()+interval '1h', '   '); raise exception 'SUPP FAILED: empty reason allowed';
  exception when sqlstate 'P0001' then null; end;

  -- admin suppress -> suppressed; a suppressed incident is NOT alert-eligible
  perform public.order_integrity_suppress_incident(v_inc, now()+interval '1h', 'known/verified');
  if (select status from public.order_integrity_incidents where id=v_inc) <> 'suppressed'
     or (select suppression_until from public.order_integrity_incidents where id=v_inc) is null then
    raise exception 'SUPP FAILED'; end if;
  delete from public.order_integrity_alert_outbox;      -- clear any pre-existing
  perform public.order_integrity_watchdog();            -- detection continues (occurrence up) but no alert
  if (select count(*) from public.order_integrity_alert_outbox where incident_id=v_inc and alert_type='opened') <> 0 then
    raise exception 'SUPP FAILED: suppressed incident alerted'; end if;
  if (select status from public.order_integrity_incidents where id=v_inc) <> 'suppressed' then
    raise exception 'SUPP FAILED: suppression not honoured on detection'; end if;

  -- suppression EXPIRY -> re-detection reverts to open
  update public.order_integrity_incidents set suppression_until = now()-interval '1s' where id=v_inc;
  perform public.order_integrity_watchdog();
  if (select status from public.order_integrity_incidents where id=v_inc) <> 'open' then
    raise exception 'SUPP FAILED: expired suppression not reverted -> %', (select status from public.order_integrity_incidents where id=v_inc); end if;

  raise notice 'ACK/SUPPRESS OK';
end $$;

-- ---- ADMIN-NOTE REDACTION: admin free text hidden from non-admin staff --------
do $$
declare v_id uuid; v_inc uuid; v_row jsonb; v_tl jsonb;
begin
  perform pg_temp.oiw_reset();
  v_id := pg_temp.oiw_order('W-REDACT','failed','paid','pickup','received',null, now()-interval '6m', now()+interval '9m');
  perform public.order_integrity_watchdog();
  select id into v_inc from public.order_integrity_incidents where rule_code='PAID_ORDER_NOT_SYNCED';

  -- admin acks (writes ack_note into safe_details) then suppresses (writes reason)
  perform set_config('test.is_admin','true', true);
  perform public.order_integrity_acknowledge_incident(v_inc, 'NOTE_SECRET_TEXT');
  perform public.order_integrity_suppress_incident(v_inc, now()+interval '2h', 'SUPP_SECRET_TEXT');

  -- admin reads DO see the free text (writer tier)
  v_row := (public.order_integrity_list_incidents())->0;
  if (v_row->>'suppression_reason') <> 'SUPP_SECRET_TEXT' or not ((v_row->'safe_details') ? 'ack_note') then
    raise exception 'REDACT FAILED: admin cannot see own notes in list'; end if;
  v_tl := public.order_integrity_incident_timeline(v_inc);
  if (v_tl->>'suppression_reason') <> 'SUPP_SECRET_TEXT' or not ((v_tl->'safe_details') ? 'ack_note') then
    raise exception 'REDACT FAILED: admin timeline missing notes'; end if;

  -- staff-but-not-admin reads are redacted (lower tier)
  perform set_config('test.is_admin','false', true);
  perform set_config('test.is_staff','true', true);
  v_row := (public.order_integrity_list_incidents())->0;
  if (v_row->>'suppression_reason') is not null or ((v_row->'safe_details') ? 'ack_note') then
    raise exception 'REDACT FAILED: non-admin staff saw admin free text in list -> %', v_row; end if;
  v_tl := public.order_integrity_incident_timeline(v_inc);
  if (v_tl->>'suppression_reason') is not null or ((v_tl->'safe_details') ? 'ack_note') then
    raise exception 'REDACT FAILED: non-admin staff saw admin free text in timeline'; end if;
  -- but the SAFE operational fields remain visible to staff
  if (v_row->>'order_number') <> 'W-REDACT' or (v_row->'safe_details'->>'order_number') <> 'W-REDACT' then
    raise exception 'REDACT FAILED: staff lost safe fields'; end if;

  perform set_config('test.is_staff','', true);
  perform set_config('test.is_admin','true', true);
  raise notice 'NOTE REDACTION OK';
end $$;

-- ---- LIST 'unresolved' filter matches the health counts ----------------------
do $$
declare v jsonb; v_n int;
begin
  perform pg_temp.oiw_reset();
  perform set_config('test.is_admin','true', true);
  insert into public.order_integrity_incidents (fingerprint, rule_code, severity, entity_type, status) values
    ('U:o','PAID_ORDER_NOT_SYNCED','critical','order','open'),
    ('U:a','PAID_ORDER_NOT_SYNCED','critical','order','acknowledged'),
    ('U:s','OVERDUE_SYNC_RETRY','warning','order','suppressed'),
    ('U:r','PAID_ORDER_DEAD_LETTER','critical','order','resolved');
  -- 'unresolved' = open+acknowledged+suppressed (never resolved).
  v := public.order_integrity_list_incidents('unresolved');
  select count(*) into v_n from jsonb_array_elements(v);
  if v_n <> 3 then raise exception 'LIST unresolved: expected 3 got %', v_n; end if;
  if exists (select 1 from jsonb_array_elements(v) e where e->>'status'='resolved') then
    raise exception 'LIST unresolved: a resolved incident leaked in'; end if;
  -- an explicit status still exact-matches
  v := public.order_integrity_list_incidents('open');
  select count(*) into v_n from jsonb_array_elements(v);
  if v_n <> 1 then raise exception 'LIST open: expected 1 got %', v_n; end if;
  -- null returns everything
  v := public.order_integrity_list_incidents();
  select count(*) into v_n from jsonb_array_elements(v);
  if v_n <> 4 then raise exception 'LIST all: expected 4 got %', v_n; end if;
  raise notice 'LIST UNRESOLVED FILTER OK';
end $$;

-- ---- ALERT PAYLOAD: admin ack_note is stripped from the outbox ----------------
-- The leak path: a WARNING acknowledged WITH a note, then the condition clears so
-- the incident is NOT re-detected (safe_details keeps ack_note), yet it crosses the
-- 15-min threshold and an 'opened' alert is generated. ack_note must not reach it.
do $$
declare v_id uuid; v_inc uuid; v_payload jsonb;
begin
  perform pg_temp.oiw_reset();
  v_id := pg_temp.oiw_order('W-ALERT-PII','pending','pending','pickup','received',null, null, now()-interval '11m'); -- R10 warning
  perform public.order_integrity_watchdog();
  select id into v_inc from public.order_integrity_incidents where rule_code='OVERDUE_SYNC_RETRY';
  perform set_config('test.is_admin','true', true);
  perform public.order_integrity_acknowledge_incident(v_inc, 'ACK_PII_NOTE_JohnDoe');
  if not ((select safe_details from public.order_integrity_incidents where id=v_inc) ? 'ack_note') then
    raise exception 'ALERT-PII setup: ack_note not stored'; end if;
  update public.orders set lazywait_sync_state='synced', lazywait_ref='REFDONE' where id=v_id;  -- clear condition
  update public.order_integrity_incidents set first_detected_at = now()-interval '16m' where id=v_inc;
  perform public.order_integrity_watchdog();                    -- not re-detected; warning becomes alert-eligible
  select payload_safe into v_payload from public.order_integrity_alert_outbox
    where incident_id=v_inc and alert_type='opened';
  if v_payload is null then raise exception 'ALERT-PII FAILED: no opened alert created (setup)'; end if;
  if (v_payload->'safe_details') ? 'ack_note' or (v_payload::text ilike '%ACK_PII_NOTE%') then
    raise exception 'ALERT-PII FAILED: admin ack_note leaked into alert payload_safe -> %', v_payload; end if;
  raise notice 'ALERT PAYLOAD PII OK';
end $$;

-- ---- WARNING alert eligibility (persist >= 15 minutes) -----------------------
do $$
declare v_id uuid; v_inc uuid;
begin
  perform pg_temp.oiw_reset();
  v_id := pg_temp.oiw_order('W-WARN','pending','pending','pickup','received',null, null, now()-interval '11m');  -- R10 warning
  perform public.order_integrity_watchdog();
  select id into v_inc from public.order_integrity_incidents where rule_code='OVERDUE_SYNC_RETRY';
  -- fresh warning (< 15 min) -> not eligible
  if (select count(*) from public.order_integrity_alert_outbox where incident_id=v_inc) <> 0 then
    raise exception 'WARN FAILED: warning alerted before 15 minutes'; end if;
  -- backdate first_detected_at past the 15-minute threshold -> eligible on next scan
  update public.order_integrity_incidents set first_detected_at = now()-interval '16m' where id=v_inc;
  perform public.order_integrity_watchdog();
  if (select count(*) from public.order_integrity_alert_outbox where incident_id=v_inc and alert_type='opened') <> 1 then
    raise exception 'WARN FAILED: warning not eligible after 15 minutes'; end if;
  raise notice 'WARNING ELIGIBILITY OK';
end $$;

-- ---- RLS / GRANTS / no client table access -----------------------------------
do $$
begin
  -- functions
  if has_function_privilege('anon','public.order_integrity_watchdog()','execute')
     or has_function_privilege('authenticated','public.order_integrity_watchdog()','execute')
     or not has_function_privilege('service_role','public.order_integrity_watchdog()','execute') then
    raise exception 'GRANTS FAILED: watchdog exec'; end if;
  if has_function_privilege('anon','public.order_integrity_health_summary()','execute')
     or has_function_privilege('authenticated','public.order_integrity_health_summary()','execute')
     or not has_function_privilege('service_role','public.order_integrity_health_summary()','execute') then
    raise exception 'GRANTS FAILED: health exec'; end if;
  if not has_function_privilege('authenticated','public.order_integrity_acknowledge_incident(uuid,text)','execute')
     or has_function_privilege('anon','public.order_integrity_acknowledge_incident(uuid,text)','execute') then
    raise exception 'GRANTS FAILED: ack exec'; end if;
  -- tables: no anon/authenticated privileges
  if has_table_privilege('authenticated','public.order_integrity_incidents','select')
     or has_table_privilege('anon','public.order_integrity_incidents','select')
     or has_table_privilege('authenticated','public.order_integrity_runs','select')
     or has_table_privilege('authenticated','public.order_integrity_alert_outbox','select')
     or has_table_privilege('authenticated','public.order_integrity_config','select') then
    raise exception 'GRANTS FAILED: table exposed to client role'; end if;
  -- RLS enabled on all four tables
  if (select count(*) from pg_class where relnamespace='public'::regnamespace
        and relname in ('order_integrity_config','order_integrity_runs','order_integrity_incidents','order_integrity_alert_outbox')
        and relrowsecurity) <> 4 then
    raise exception 'GRANTS FAILED: RLS not enabled on all tables'; end if;
  -- staff gate on list
  perform set_config('test.is_admin','false', true);
  begin perform public.order_integrity_list_incidents(); raise exception 'GRANTS FAILED: non-staff listed';
  exception when sqlstate '42501' then null; end;
  perform set_config('test.is_admin','true', true);
  raise notice 'GRANTS/RLS OK';
end $$;

-- ---- HEALTH-STATE MATRIX -----------------------------------------------------
do $$
declare s jsonb;
begin
  -- healthy: cron active, recent success, no open incidents
  perform pg_temp.oiw_reset();
  insert into public.order_integrity_runs (started_at, completed_at, status)
    values (now()-interval '1m', now()-interval '1m', 'success');
  s := public.order_integrity_health_summary();
  if (s->>'watchdog_cron_active')::boolean is not true then raise exception 'HEALTH: cron not active in throwaway (job should exist)'; end if;
  if s->>'overall_state' <> 'healthy' then raise exception 'HEALTH(healthy) -> %', s->>'overall_state'; end if;

  -- degraded: an open WARNING incident
  insert into public.order_integrity_incidents (fingerprint, rule_code, severity, entity_type, status)
    values ('OVERDUE_SYNC_RETRY:h1','OVERDUE_SYNC_RETRY','warning','order','open');
  s := public.order_integrity_health_summary();
  if s->>'overall_state' <> 'degraded' or (s->>'open_warning_count')::int <> 1 then
    raise exception 'HEALTH(degraded warning) -> %', s->>'overall_state'; end if;

  -- degraded: stale success (>4m) with no incidents
  delete from public.order_integrity_incidents;
  delete from public.order_integrity_runs;
  insert into public.order_integrity_runs (started_at, completed_at, status)
    values (now()-interval '5m', now()-interval '5m', 'success');
  s := public.order_integrity_health_summary();
  if s->>'overall_state' <> 'degraded' then raise exception 'HEALTH(degraded stale) -> %', s->>'overall_state'; end if;

  -- failing: open CRITICAL incident (even with a recent success)
  delete from public.order_integrity_runs;
  insert into public.order_integrity_runs (started_at, completed_at, status)
    values (now()-interval '1m', now()-interval '1m', 'success');
  insert into public.order_integrity_incidents (fingerprint, rule_code, severity, entity_type, status)
    values ('PAID_ORDER_NOT_SYNCED:h2','PAID_ORDER_NOT_SYNCED','critical','order','open');
  s := public.order_integrity_health_summary();
  if s->>'overall_state' <> 'failing' or (s->>'open_critical_count')::int <> 1 then
    raise exception 'HEALTH(failing critical) -> %', s->>'overall_state'; end if;

  -- failing: no successful run within 6 minutes
  delete from public.order_integrity_incidents;
  delete from public.order_integrity_runs;
  insert into public.order_integrity_runs (started_at, completed_at, status)
    values (now()-interval '7m', now()-interval '7m', 'success');
  s := public.order_integrity_health_summary();
  if s->>'overall_state' <> 'failing' then raise exception 'HEALTH(failing stale6) -> %', s->>'overall_state'; end if;

  -- configuration_error: latest run failed non-benign
  delete from public.order_integrity_runs;
  insert into public.order_integrity_runs (started_at, completed_at, status, safe_error_code)
    values (now()-interval '2m', now()-interval '2m', 'success', null);
  insert into public.order_integrity_runs (started_at, completed_at, status, safe_error_code)
    values (now()-interval '30s', now()-interval '30s', 'failed', 'XX000');
  s := public.order_integrity_health_summary();
  if s->>'overall_state' <> 'configuration_error' then raise exception 'HEALTH(config_error) -> %', s->>'overall_state'; end if;

  -- a benign overlap_skipped latest failure is NOT configuration_error
  delete from public.order_integrity_runs;
  insert into public.order_integrity_runs (started_at, completed_at, status)
    values (now()-interval '1m', now()-interval '1m', 'success');
  insert into public.order_integrity_runs (started_at, completed_at, status, safe_error_code)
    values (now()-interval '20s', now()-interval '20s', 'failed', 'overlap_skipped');
  s := public.order_integrity_health_summary();
  if s->>'overall_state' <> 'healthy' then raise exception 'HEALTH(overlap benign) -> %', s->>'overall_state'; end if;

  -- Finding 3: acknowledging/suppressing an UNRESOLVED incident must NOT hide it.
  -- critical: acknowledged -> still failing; suppressed -> still failing; resolved -> recovers.
  delete from public.order_integrity_incidents;
  delete from public.order_integrity_runs;
  insert into public.order_integrity_runs (started_at, completed_at, status)
    values (now()-interval '1m', now()-interval '1m', 'success');
  insert into public.order_integrity_incidents (fingerprint, rule_code, severity, entity_type, status)
    values ('PAID_ORDER_NOT_SYNCED:h3','PAID_ORDER_NOT_SYNCED','critical','order','acknowledged');
  s := public.order_integrity_health_summary();
  if s->>'overall_state' <> 'failing' or (s->>'open_critical_count')::int <> 1
     or (s->>'acknowledged_count')::int <> 1 then
    raise exception 'HEALTH(ack critical still failing) -> % crit=% ack=%',
      s->>'overall_state', s->>'open_critical_count', s->>'acknowledged_count'; end if;
  update public.order_integrity_incidents set status='suppressed', suppression_until=now()+interval '1h'
    where fingerprint='PAID_ORDER_NOT_SYNCED:h3';
  s := public.order_integrity_health_summary();
  if s->>'overall_state' <> 'failing' or (s->>'open_critical_count')::int <> 1
     or (s->>'oldest_open_critical_at') is null then
    raise exception 'HEALTH(suppress critical still failing) -> % crit=% oldest=%',
      s->>'overall_state', s->>'open_critical_count', s->>'oldest_open_critical_at'; end if;
  update public.order_integrity_incidents set status='resolved', resolved_at=now()
    where fingerprint='PAID_ORDER_NOT_SYNCED:h3';
  s := public.order_integrity_health_summary();
  if s->>'overall_state' = 'failing' or (s->>'open_critical_count')::int <> 0
     or (s->>'oldest_open_critical_at') is not null then
    raise exception 'HEALTH(resolve critical recovers) -> % crit=%', s->>'overall_state', s->>'open_critical_count'; end if;

  -- warning: acknowledged -> degraded; suppressed -> degraded; resolved -> recovers.
  delete from public.order_integrity_incidents;
  insert into public.order_integrity_incidents (fingerprint, rule_code, severity, entity_type, status)
    values ('OVERDUE_SYNC_RETRY:h4','OVERDUE_SYNC_RETRY','warning','order','acknowledged');
  s := public.order_integrity_health_summary();
  if s->>'overall_state' <> 'degraded' or (s->>'open_warning_count')::int <> 1 then
    raise exception 'HEALTH(ack warning degraded) -> %', s->>'overall_state'; end if;
  update public.order_integrity_incidents set status='suppressed', suppression_until=now()+interval '1h'
    where fingerprint='OVERDUE_SYNC_RETRY:h4';
  s := public.order_integrity_health_summary();
  if s->>'overall_state' <> 'degraded' or (s->>'open_warning_count')::int <> 1 then
    raise exception 'HEALTH(suppress warning degraded) -> %', s->>'overall_state'; end if;
  update public.order_integrity_incidents set status='resolved', resolved_at=now()
    where fingerprint='OVERDUE_SYNC_RETRY:h4';
  s := public.order_integrity_health_summary();
  if s->>'overall_state' <> 'healthy' then
    raise exception 'HEALTH(resolve warning recovers) -> %', s->>'overall_state'; end if;

  -- Finding 5: benign newer runs cannot mask a config failure; a later success clears it.
  delete from public.order_integrity_incidents;
  delete from public.order_integrity_runs;
  insert into public.order_integrity_runs (started_at, completed_at, status, safe_error_code)
    values (now()-interval '3m', now()-interval '3m', 'success', null);
  insert into public.order_integrity_runs (started_at, completed_at, status, safe_error_code)
    values (now()-interval '2m', now()-interval '2m', 'failed', 'P0001');            -- decisive config failure
  insert into public.order_integrity_runs (started_at, completed_at, status, safe_error_code)
    values (now()-interval '30s', now()-interval '30s', 'failed', 'overlap_skipped'); -- benign, newer
  s := public.order_integrity_health_summary();
  if s->>'overall_state' <> 'configuration_error' then
    raise exception 'HEALTH(config not masked by newer overlap_skipped) -> %', s->>'overall_state'; end if;
  insert into public.order_integrity_runs (started_at, status) values (now()-interval '10s', 'running');
  s := public.order_integrity_health_summary();
  if s->>'overall_state' <> 'configuration_error' then
    raise exception 'HEALTH(config not masked by newer running) -> %', s->>'overall_state'; end if;
  insert into public.order_integrity_runs (started_at, completed_at, status, safe_error_code)
    values (now()-interval '5s', now()-interval '5s', 'success', null);              -- later decisive success
  s := public.order_integrity_health_summary();
  if s->>'overall_state' = 'configuration_error' then
    raise exception 'HEALTH(later success clears config_error) -> %', s->>'overall_state'; end if;

  -- reset to a clean healthy baseline for the final cron-inactive case
  delete from public.order_integrity_incidents;
  delete from public.order_integrity_runs;
  insert into public.order_integrity_runs (started_at, completed_at, status)
    values (now()-interval '1m', now()-interval '1m', 'success');

  -- failing: cron inactive
  update cron.job set active=false where jobname='order-integrity-watchdog';
  s := public.order_integrity_health_summary();
  if (s->>'watchdog_cron_active')::boolean is not false or s->>'overall_state' <> 'failing' then
    raise exception 'HEALTH(cron inactive) -> % / %', s->>'watchdog_cron_active', s->>'overall_state'; end if;
  update cron.job set active=true where jobname='order-integrity-watchdog';

  raise notice 'HEALTH MATRIX OK';
end $$;

-- ---- DELIVERY COVERAGE (20260827130000) -------------------------------------
-- Until 2026-08-27 delivery never entered the POS sync queue, so R1 and R7 both
-- filtered `order_type = 'pickup'`. With delivery live, a paid delivery order
-- fails exactly as a pickup one does and must raise the same critical incident.
-- Cases 1 and 2 FAIL against the pre-20260827130000 watchdog.
do $$
declare v_run bigint;
begin
  perform pg_temp.oiw_reset();
  -- R1: paid, unsynced, older than the 5-minute grace.
  perform pg_temp.oiw_order('W-DEL-R1','failed','paid','delivery','received',null, now()-interval '6m');
  v_run := public.order_integrity_watchdog();
  if (select status from public.order_integrity_runs where id=v_run) <> 'success' then
    raise exception 'DELIVERY R1 FAILED: run not success'; end if;
  if (select count(*) from public.order_integrity_incidents
        where rule_code='PAID_ORDER_NOT_SYNCED') <> 1 then
    raise exception 'DELIVERY R1 FAILED: a paid DELIVERY order stuck unsynced raised no incident';
  end if;
  if (select safe_details->>'order_type' from public.order_integrity_incidents
        where rule_code='PAID_ORDER_NOT_SYNCED') <> 'delivery' then
    raise exception 'DELIVERY R1 FAILED: incident did not record order_type=delivery'; end if;
  raise notice 'DELIVERY R1 ok - a failed paid delivery order is now a critical incident';
end $$;

do $$
declare v_run bigint;
begin
  perform pg_temp.oiw_reset();
  -- R7: paid delivery order that exhausted its retry budget.
  perform pg_temp.oiw_order('W-DEL-R7','dead_letter','paid','delivery','received',null, now()-interval '6m');
  v_run := public.order_integrity_watchdog();
  if (select count(*) from public.order_integrity_incidents
        where rule_code='PAID_ORDER_DEAD_LETTER') <> 1 then
    raise exception 'DELIVERY R7 FAILED: a dead-lettered paid DELIVERY order raised no incident';
  end if;
  raise notice 'DELIVERY R7 ok - a dead-lettered paid delivery order is now a critical incident';
end $$;

do $$
declare v_run bigint;
begin
  perform pg_temp.oiw_reset();
  -- Regression guard: pickup coverage is unchanged by the filter removal.
  perform pg_temp.oiw_order('W-PU-R1','failed','paid','pickup','received',null, now()-interval '6m');
  perform pg_temp.oiw_order('W-PU-R7','dead_letter','paid','pickup','received',null, now()-interval '6m');
  v_run := public.order_integrity_watchdog();
  if (select count(*) from public.order_integrity_incidents
        where rule_code='PAID_ORDER_NOT_SYNCED') <> 1
     or (select count(*) from public.order_integrity_incidents
        where rule_code='PAID_ORDER_DEAD_LETTER') <> 1 then
    raise exception 'DELIVERY COVERAGE FAILED: pickup detection regressed'; end if;
  raise notice 'PICKUP REGRESSION ok - pickup still detected by R1 and R7';
end $$;

do $$
declare v_run bigint;
begin
  perform pg_temp.oiw_reset();
  -- DELIBERATELY still excluded: `delivery_schema_unconfirmed` is a RETIRED
  -- reason that neither the insert trigger nor worker v6 can produce. It marks
  -- exactly four legacy rows that are parked and un-retryable by design, so it
  -- must NOT become a permanent failing incident. Pinning the decision.
  perform pg_temp.oiw_order('W-DEL-RETIRED','blocked','paid','delivery','received',null,
                            now()-interval '6m', null, null, 10, 'delivery_schema_unconfirmed');
  v_run := public.order_integrity_watchdog();
  if (select count(*) from public.order_integrity_incidents
        where rule_code='PAID_ORDER_NOT_SYNCED') <> 0 then
    raise exception 'RETIRED-REASON FAILED: a parked legacy row raised a critical incident';
  end if;
  raise notice 'RETIRED REASON ok - parked delivery_schema_unconfirmed rows stay quiet';
end $$;

do $$ begin raise notice 'ALL ORDER INTEGRITY WATCHDOG CASES PASSED'; end $$;
rollback;
