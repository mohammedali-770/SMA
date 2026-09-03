-- ============================================================================
-- Operations alerts v2 — EMAIL DISPATCH lifecycle
-- (migration 20260903120000_operations_alert_email_dispatch).
--
-- WHY THIS EXISTS. v1 refused to dispatch in three independent places and the
-- suites pinned all three. v2 removes them for ONE channel, which means the
-- protections that remain are no longer structural accidents — they are choices
-- that need their own assertions. In particular:
--
--   * an alert email that arrives twice trains a responder to ignore alert
--     email, so the claim must be at-most-once under a stale owner;
--   * only EMAIL was widened. whatsapp/push must still be unable to leave
--     blocked/cancelled, and a v2 constraint written one clause too loose would
--     silently enable them;
--   * applying the migration must send nothing, so the producers must stay
--     silent while external_dispatch_enabled is false.
--
-- Runs on a disposable local DB with all migrations applied. RAISES on failure.
-- ============================================================================
begin;
set local session_replication_role = replica;  -- skip FKs/triggers for fixtures

-- ---- A. Constraint shape ----------------------------------------------------
do $$
declare
  v_raised boolean;
begin
  -- in_app is untouched by v2.
  v_raised := false;
  begin
    insert into public.operations_alert_outbox
      (idempotency_key, channel, language, subject_safe, body_safe, status, blocked_reason)
    values ('t-inapp-bad', 'in_app', 'en', 's', 'b', 'pending', null);
  exception when check_violation then v_raised := true; end;
  if not v_raised then
    raise exception 'in_app must still be limited to recorded/cancelled';
  end if;

  -- whatsapp and push are still structurally dormant.
  v_raised := false;
  begin
    insert into public.operations_alert_outbox
      (idempotency_key, channel, language, subject_safe, body_safe, status, blocked_reason)
    values ('t-wa-bad', 'whatsapp', 'en', 's', 'b', 'pending', null);
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'whatsapp must still be forbidden a pending row'; end if;

  v_raised := false;
  begin
    insert into public.operations_alert_outbox
      (idempotency_key, channel, language, subject_safe, body_safe, status, blocked_reason)
    values ('t-push-bad', 'push', 'en', 's', 'b', 'sent', null);
  exception when check_violation then v_raised := true; end;
  if not v_raised then raise exception 'push must still be forbidden a sent row'; end if;

  raise notice 'CONSTRAINT SHAPE OK (only email widened)';
end $$;

-- ---- B. Claim / finalize lifecycle, and the fence ---------------------------
do $$
declare
  v_tok   uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_id    uuid;
  v_n     integer;
  v_res   text;
  v_status text;
begin
  insert into public.operations_alert_outbox
    (idempotency_key, channel, language, subject_safe, body_safe, status, blocked_reason)
  values ('t-email-1', 'email', 'en', 'subject one', 'body one', 'pending', null)
  returning id into v_id;

  select count(*) into v_n
    from public.claim_operations_alert_emails(v_tok, 10, 10, 5);
  if v_n <> 1 then raise exception 'expected to claim exactly 1 row, got %', v_n; end if;

  select status into v_status from public.operations_alert_outbox where id = v_id;
  if v_status <> 'processing' then raise exception 'claim must move the row to processing, got %', v_status; end if;

  -- A second dispatcher must NOT get it: the lease is live.
  select count(*) into v_n
    from public.claim_operations_alert_emails(v_other, 10, 10, 5);
  if v_n <> 0 then raise exception 'a live lease must not be reclaimable, got % rows', v_n; end if;

  -- THE FENCE: a finalize under the wrong token must match nothing.
  v_res := public.finalize_operations_alert_email(v_id, v_other, 'sent', null);
  if v_res <> 'lost_claim' then raise exception 'wrong token must lose the claim, got %', v_res; end if;
  select status into v_status from public.operations_alert_outbox where id = v_id;
  if v_status <> 'processing' then raise exception 'a losing finalize must not change status, got %', v_status; end if;

  -- The real owner finalises.
  v_res := public.finalize_operations_alert_email(v_id, v_tok, 'sent', null);
  if v_res <> 'finalized' then raise exception 'owner finalize failed, got %', v_res; end if;
  select status into v_status from public.operations_alert_outbox where id = v_id;
  if v_status <> 'sent' then raise exception 'expected sent, got %', v_status; end if;

  -- Terminal rows are never re-claimed.
  select count(*) into v_n from public.claim_operations_alert_emails(gen_random_uuid(), 10, 10, 5);
  if v_n <> 0 then raise exception 'a sent row must never be reclaimed'; end if;

  raise notice 'CLAIM/FINALIZE OK (fenced, at most once)';
end $$;

-- ---- C. Attempt budget and stale-lease recovery -----------------------------
do $$
declare
  v_tok uuid := gen_random_uuid();
  v_id  uuid;
  v_n   integer;
begin
  -- A row that has already burned its budget is not claimable: a dead provider
  -- must not be retried for ever.
  insert into public.operations_alert_outbox
    (idempotency_key, channel, language, subject_safe, body_safe, status, blocked_reason, attempt_count)
  values ('t-email-exhausted', 'email', 'en', 's', 'b', 'pending', null, 5);
  select count(*) into v_n from public.claim_operations_alert_emails(v_tok, 10, 10, 5);
  if v_n <> 0 then raise exception 'an exhausted row must not be claimed'; end if;

  -- A processing row whose lease EXPIRED is provably a dead owner, so it is
  -- recoverable; one whose lease is live is not (covered in B).
  insert into public.operations_alert_outbox
    (idempotency_key, channel, language, subject_safe, body_safe, status, blocked_reason,
     attempt_count, claim_token, claimed_at)
  values ('t-email-stale', 'email', 'en', 's', 'b', 'processing', null,
          1, gen_random_uuid(), now() - interval '30 minutes')
  returning id into v_id;
  select count(*) into v_n from public.claim_operations_alert_emails(v_tok, 10, 10, 5);
  if v_n <> 1 then raise exception 'an expired lease must be reclaimable, got % rows', v_n; end if;
  if (select attempt_count from public.operations_alert_outbox where id = v_id) <> 2 then
    raise exception 'reclaim must consume an attempt';
  end if;

  -- Release returns it for a PROVEN pre-send failure.
  if public.release_operations_alert_email(v_id, v_tok) <> 'released' then
    raise exception 'owner release failed';
  end if;
  if (select status from public.operations_alert_outbox where id = v_id) <> 'pending' then
    raise exception 'release must return the row to pending';
  end if;

  raise notice 'BUDGET/LEASE OK';
end $$;

-- ---- D. Producers stay silent while the flag is off -------------------------
-- operations_alert_settings_update is admin-only; the CI harness gates is_admin()
-- on this GUC (.github/sql-ci/harness.sql).
set local test.is_admin = 'true';

do $$
declare
  v_before bigint;
  v_after  bigint;
  v_event  uuid := gen_random_uuid();
begin
  if (select external_dispatch_enabled from public.operations_alert_settings) then
    raise exception 'fixture precondition: external dispatch should be off';
  end if;

  select count(*) into v_before from public.operations_alert_outbox where channel = 'email';
  perform public.operations_alerts_outbox_for_event(
    v_event, 'opened', 'order_integrity', 'stranded_orders', 'critical');
  select count(*) into v_after from public.operations_alert_outbox where channel = 'email';
  if v_after <> v_before then
    raise exception 'a critical event must produce NO email while dispatch is disabled';
  end if;

  -- With the flag on, a critical produces exactly ONE email row -- one per
  -- event, not one per language, because a responder reads one mailbox.
  perform public.operations_alert_settings_update('{"external_dispatch_enabled": true}'::jsonb);
  v_event := gen_random_uuid();
  perform public.operations_alerts_outbox_for_event(
    v_event, 'opened', 'order_integrity', 'stranded_orders', 'critical');
  select count(*) into v_after from public.operations_alert_outbox
   where channel = 'email' and alert_event_id = v_event;
  if v_after <> 1 then
    raise exception 'expected exactly 1 email row for a critical event, got %', v_after;
  end if;

  -- A WARNING must not mail at the default floor. This is the assertion that
  -- protects the measured baseline: lazywait:sync_degraded has opened and
  -- self-recovered inside the evaluator's own 5-minute interval every time it
  -- fired, and mailing those would page a human for a non-event.
  v_event := gen_random_uuid();
  perform public.operations_alerts_outbox_for_event(
    v_event, 'opened', 'lazywait', 'sync_degraded', 'warning');
  if (select count(*) from public.operations_alert_outbox
       where channel = 'email' and alert_event_id = v_event) <> 0 then
    raise exception 'a warning must not mail while dispatch_min_severity is critical';
  end if;

  -- Lowering the floor admits it.
  perform public.operations_alert_settings_update('{"dispatch_min_severity": "warning"}'::jsonb);
  v_event := gen_random_uuid();
  perform public.operations_alerts_outbox_for_event(
    v_event, 'opened', 'lazywait', 'sync_degraded', 'warning');
  if (select count(*) from public.operations_alert_outbox
       where channel = 'email' and alert_event_id = v_event) <> 1 then
    raise exception 'a warning must mail once the floor is lowered';
  end if;

  raise notice 'PRODUCER GATES OK';
end $$;

-- ---- E. Recipients are derived, and admin-only -------------------------------
do $$
declare
  v_admin uuid := gen_random_uuid();
  v_cust  uuid := gen_random_uuid();
  v_n     integer;
begin
  insert into public.profiles (id, full_name, email, role)
  values (v_admin, 'Ops Admin', 'ops-admin@example.test', 'admin'),
         (v_cust,  'A Customer', 'customer@example.test', 'customer');

  select count(*) into v_n
    from public.operations_alerts_dispatch_recipients() r
   where r = 'customer@example.test';
  if v_n <> 0 then raise exception 'a customer address must never be an alert recipient'; end if;

  select count(*) into v_n
    from public.operations_alerts_dispatch_recipients() r
   where r = 'ops-admin@example.test';
  if v_n <> 1 then raise exception 'an admin address must be an alert recipient'; end if;

  raise notice 'RECIPIENTS OK (derived from admin profiles, none stored)';
end $$;

rollback;
