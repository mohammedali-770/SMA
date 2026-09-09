-- ============================================================================
-- Operations alerts — a recovery EMAIL requires that the episode was mailed
-- (migration 20260913120000_alert_recovery_email_pairing).
--
-- WHY THIS EXISTS. Before the fix, a `warning` opening was correctly suppressed
-- by the critical severity floor while its `info` recovery was admitted by the
-- `recovered` switch, so the responder was mailed the END of an incident whose
-- START this channel never mentioned. Measured on live data: 4 of the 12 emails
-- a week would have produced were exactly that.
--
-- The cases are weighted toward what must NOT happen, because every failure mode
-- here is silent: a wrong answer produces mail nobody can act on, or -- far worse
-- -- swallows a recovery for a critical incident that WAS announced, leaving a
-- responder believing an outage is still open.
--
-- MUTATION-TESTED, and one result is recorded because it is a limit rather than
-- a pass. Killed: the guard computed-but-not-applied (case 1c), the guard
-- inverted (1c), the episode scoped by fingerprint instead of alert_id (case 4),
-- and `recovery_notifications_enabled` dropped (case 6). SURVIVED: removing
-- `o.alert_event_id <> p_event_id` from the producer -- that exclusion is
-- insurance against a caller that pre-inserts an email row for the event it is
-- about to produce, which no current caller does, so no honest test can
-- distinguish it. It is documented in the migration rather than covered here.
--
-- Runs on a disposable local DB with all migrations applied. RAISES on failure.
-- ============================================================================
begin;
set local session_replication_role = replica;  -- skip FKs/triggers for fixtures

-- Dispatch ON for the duration, so the gate is actually exercised. The
-- transaction is rolled back at the end; nothing here can outlive it.
update public.operations_alert_settings
   set external_dispatch_enabled = true,
       dispatch_language = 'en',
       dispatch_min_severity = 'critical',
       recovery_notifications_enabled = true;

-- Two independent episodes, each with its own alert_id, plus a third used to
-- prove episodes do not leak into one another.
create temporary table _ep (label text primary key, alert_id uuid, fp text) on commit drop;
insert into _ep values
  ('warn',  gen_random_uuid(), 'lazywait:sync_degraded'),
  ('crit',  gen_random_uuid(), 'order_flow:flow_stopped'),
  ('next',  gen_random_uuid(), 'lazywait:sync_degraded');

create temporary table _ev (label text primary key, id uuid) on commit drop;

-- Helper: insert an event row for an episode and return its id.
create or replace function pg_temp.mk_event(p_ep text, p_label text, p_type text, p_sev text)
returns uuid language plpgsql as $f$
declare v_id uuid; v_alert uuid; v_fp text;
begin
  select alert_id, fp into v_alert, v_fp from _ep where label = p_ep;
  insert into public.operations_alert_events
    (alert_id, fingerprint, event_type, severity, notification_suppressed, safe_evidence)
  values (v_alert, v_fp, p_type, p_sev, false, '{}'::jsonb)
  returning id into v_id;
  insert into _ev values (p_label, v_id);
  return v_id;
end $f$;

create or replace function pg_temp.email_rows(p_event uuid)
returns integer language sql as $f$
  select count(*)::int from public.operations_alert_outbox
   where alert_event_id = p_event and channel = 'email';
$f$;

create or replace function pg_temp.inapp_rows(p_event uuid)
returns integer language sql as $f$
  select count(*)::int from public.operations_alert_outbox
   where alert_event_id = p_event and channel = 'in_app';
$f$;

do $$
declare
  v_open_warn uuid; v_rec_warn uuid;
  v_open_crit uuid; v_rec_crit uuid;
  v_esc uuid; v_rec_esc uuid;
  v_next_rec uuid;
  v_n integer;
begin
  -- ---- 1. THE BUG. A warning opening is not mailed; its recovery must not be.
  v_open_warn := pg_temp.mk_event('warn', 'open_warn', 'opened', 'warning');
  perform public.operations_alerts_outbox_for_event(
    v_open_warn, 'opened', 'lazywait', 'sync_degraded', 'warning');
  if pg_temp.email_rows(v_open_warn) <> 0 then
    raise exception 'case 1a: a warning opening was mailed under a critical floor';
  end if;
  if pg_temp.inapp_rows(v_open_warn) <> 2 then
    raise exception 'case 1b: the in_app pair is not 2 rows (got %)', pg_temp.inapp_rows(v_open_warn);
  end if;

  v_rec_warn := pg_temp.mk_event('warn', 'rec_warn', 'recovered', 'info');
  perform public.operations_alerts_outbox_for_event(
    v_rec_warn, 'recovered', 'lazywait', 'sync_degraded', 'info');
  if pg_temp.email_rows(v_rec_warn) <> 0 then
    raise exception 'case 1c: THE REGRESSION -- a recovery was mailed for an episode this channel never announced';
  end if;
  -- The in-app history must still be complete. Suppressing the email must not
  -- suppress the record: an inbox with openings and no closings is worse noise.
  if pg_temp.inapp_rows(v_rec_warn) <> 2 then
    raise exception 'case 1d: the recovery lost its in_app pair (got %)', pg_temp.inapp_rows(v_rec_warn);
  end if;

  -- ---- 2. THE OPPOSITE FAILURE, which is the dangerous one. A critical
  -- opening IS mailed, so its recovery MUST be -- otherwise a responder is left
  -- believing an outage is still open.
  v_open_crit := pg_temp.mk_event('crit', 'open_crit', 'opened', 'critical');
  perform public.operations_alerts_outbox_for_event(
    v_open_crit, 'opened', 'order_flow', 'flow_stopped', 'critical');
  if pg_temp.email_rows(v_open_crit) <> 1 then
    raise exception 'case 2a: a critical opening did not mail exactly once (got %)', pg_temp.email_rows(v_open_crit);
  end if;

  v_rec_crit := pg_temp.mk_event('crit', 'rec_crit', 'recovered', 'info');
  perform public.operations_alerts_outbox_for_event(
    v_rec_crit, 'recovered', 'order_flow', 'flow_stopped', 'info');
  if pg_temp.email_rows(v_rec_crit) <> 1 then
    raise exception 'case 2b: a mailed critical incident was never reported as recovered -- a responder is left believing it is still open';
  end if;

  -- ---- 3. ESCALATION COUNTS. An episode that opened as a warning (unmailed)
  -- and escalated to critical (mailed) HAS been announced, so its recovery must
  -- be mailed. The rule is "did this EPISODE mail", not "did the OPENING mail".
  --
  -- This runs BEFORE the episode-leak case on purpose: it is what puts an email
  -- row on the `lazywait:sync_degraded` fingerprint, without which case 4 cannot
  -- discriminate. See the note on case 4.
  v_esc := pg_temp.mk_event('warn', 'esc', 'escalated', 'critical');
  perform public.operations_alerts_outbox_for_event(
    v_esc, 'escalated', 'lazywait', 'sync_degraded', 'critical');
  if pg_temp.email_rows(v_esc) <> 1 then
    raise exception 'case 3a: an escalation to critical was not mailed (got %)', pg_temp.email_rows(v_esc);
  end if;
  v_rec_esc := pg_temp.mk_event('warn', 'rec_esc', 'recovered', 'info');
  perform public.operations_alerts_outbox_for_event(
    v_rec_esc, 'recovered', 'lazywait', 'sync_degraded', 'info');
  if pg_temp.email_rows(v_rec_esc) <> 1 then
    raise exception 'case 3b: an episode that mailed an escalation did not mail its recovery';
  end if;

  -- ---- 4. EPISODES DO NOT LEAK — the case that makes `alert_id` the answer
  -- rather than the fingerprint.
  --
  -- ORDERING IS LOAD-BEARING HERE, and this case did not work when it was
  -- written earlier in the file. Episode 'next' shares the fingerprint
  -- `lazywait:sync_degraded` with episode 'warn'. A fingerprint-scoped
  -- implementation and an alert_id-scoped one give the SAME answer unless an
  -- email already exists on that fingerprint from the OTHER episode — so until
  -- case 3 mails an escalation, both implementations return false and this
  -- assertion passes either way. Mutation testing caught that: the
  -- fingerprint-scoped mutant survived the first version of this suite.
  --
  -- An assertion that cannot fail is not a test. It must run AFTER case 3.
  if pg_temp.email_rows(v_esc) <> 1 then
    raise exception 'case 4 precondition: no email exists on this fingerprint, so the leak check cannot discriminate';
  end if;
  v_next_rec := pg_temp.mk_event('next', 'next_rec', 'recovered', 'info');
  perform public.operations_alerts_outbox_for_event(
    v_next_rec, 'recovered', 'lazywait', 'sync_degraded', 'info');
  if pg_temp.email_rows(v_next_rec) <> 0 then
    raise exception 'case 4: a LATER episode inherited an earlier episode''s email (same fingerprint, different alert_id) and mailed its recovery';
  end if;

  -- ---- 5. THE MASTER FLAG STILL WINS. With dispatch off, nothing mails --
  -- including a recovery whose episode had mailed while it was on.
  update public.operations_alert_settings set external_dispatch_enabled = false;
  declare v_off uuid;
  begin
    v_off := pg_temp.mk_event('crit', 'rec_off', 'recovered', 'info');
    perform public.operations_alerts_outbox_for_event(
      v_off, 'recovered', 'order_flow', 'flow_stopped', 'info');
    if pg_temp.email_rows(v_off) <> 0 then
      raise exception 'case 5: an email row was written while external dispatch is off';
    end if;
  end;
  update public.operations_alert_settings set external_dispatch_enabled = true;

  -- ---- 6. recovery_notifications_enabled STILL WINS INDEPENDENTLY. Turning
  -- recoveries off must suppress even a properly paired one, or the new guard
  -- has quietly become the only control.
  update public.operations_alert_settings set recovery_notifications_enabled = false;
  declare v_norec uuid;
  begin
    v_norec := pg_temp.mk_event('crit', 'rec_norec', 'recovered', 'info');
    perform public.operations_alerts_outbox_for_event(
      v_norec, 'recovered', 'order_flow', 'flow_stopped', 'info');
    if pg_temp.email_rows(v_norec) <> 0 then
      raise exception 'case 6: recovery_notifications_enabled=false did not suppress a paired recovery';
    end if;
  end;
  update public.operations_alert_settings set recovery_notifications_enabled = true;

  -- ---- 7. THE SEVERITY FLOOR IS UNTOUCHED. Widening it to 'warning' must
  -- still mail a warning opening -- the fix must not have narrowed anything.
  update public.operations_alert_settings set dispatch_min_severity = 'warning';
  declare v_w uuid;
  begin
    v_w := pg_temp.mk_event('next', 'open_warn2', 'opened', 'warning');
    perform public.operations_alerts_outbox_for_event(
      v_w, 'opened', 'lazywait', 'sync_degraded', 'warning');
    if pg_temp.email_rows(v_w) <> 1 then
      raise exception 'case 7: widening the floor to warning no longer mails a warning opening';
    end if;
  end;
  update public.operations_alert_settings set dispatch_min_severity = 'critical';

  -- ---- 8. ONE EMAIL PER EVENT, not one per language.
  select count(*) into v_n from public.operations_alert_outbox
   where channel = 'email' and language <> 'en';
  if v_n <> 0 then
    raise exception 'case 8: % email row(s) were written in a non-dispatch language', v_n;
  end if;

  -- ---- 9. IDEMPOTENCE. Re-running the producer for the same event adds
  -- nothing -- the evaluator can retry a run.
  perform public.operations_alerts_outbox_for_event(
    v_rec_crit, 'recovered', 'order_flow', 'flow_stopped', 'info');
  if pg_temp.email_rows(v_rec_crit) <> 1 then
    raise exception 'case 9: re-running the producer duplicated an email row (got %)', pg_temp.email_rows(v_rec_crit);
  end if;

  raise notice 'alert_recovery_email_pairing: all cases passed';
end $$;

rollback;
