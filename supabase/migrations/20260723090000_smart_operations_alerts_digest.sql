-- ============================================================================
-- Spicy Meal — Smart Operations Alerts & Daily Digest v1 (repository-only).
--
-- Deterministic, explainable alerting + Arabic/English daily digest layered on
-- the Operations Health Center. The Health Center remains the single source of
-- truth for health computation; this migration:
--
--   1. Moves the health computation into an internal, service-role-only core
--      (`operations_health_snapshot_internal`) and redefines the staff-facing
--      `operations_health_summary()` as a thin staff-gated wrapper around the
--      SAME core, preserving its public RPC contract exactly (name, zero args,
--      returns jsonb, SECURITY DEFINER, STABLE, search_path=public, anon
--      revoked, authenticated granted, 42501 for non-staff). The service-role
--      evaluator consumes the core directly — the staff gate is never bypassed,
--      no JWT claims are faked, and no health logic is duplicated.
--   2. Adds the alert domain: settings (dormant defaults), current alert state,
--      append-only lifecycle events, a provider-neutral DORMANT outbox, and
--      daily digest runs.
--   3. Adds the service-role evaluator + digest generator and staff-gated
--      read/preview RPCs.
--
-- OBSERVABILITY ONLY / DORMANT DELIVERY:
--   * writes ONLY to its own operations_alert_* / operations_digest_* tables
--   * never writes to operational source tables (orders, payments, cron, ...)
--   * never calls an external provider and never sends any message
--   * external dispatch is disabled by default and the v1 settings RPC refuses
--     to enable it; no dispatcher/cron/Edge Function exists or is created here
--   * no automatic remediation of any kind
--   * stores no customer PII, secrets, raw provider payloads or cron internals
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Internal health snapshot core (service-role only).
--    Body is the verbatim health computation from migration
--    20260722100000_operations_health_center (minus the staff gate). The
--    staff-facing wrapper below delegates here, so there is exactly ONE
--    authoritative health-calculation path.
-- ----------------------------------------------------------------------------

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
  v_warning_attention integer := 0;
  v_unavailable integer := 0;
  v_disabled integer := 0;
  v_not_configured integer := 0;
  v_not_monitored integer := 0;
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

  -- Allowlisted critical pg_cron jobs only. Commands, usernames, databases and
  -- return messages are deliberately excluded from the safe projection.
  begin
    with expected(jobname, subsystem, expected_schedule, is_critical) as (
      values
        ('account-deletion-processor'::text, 'account_deletion'::text, '* * * * *'::text, true),
        ('lazywait-sync'::text, 'lazywait'::text, '* * * * *'::text, true),
        ('order-integrity-watchdog'::text, 'order_integrity'::text, '*/2 * * * *'::text, true)
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
          -- excluded from lt, so it never fails the job.
          when lt.status is not null and lt.status <> 'succeeded'
               and lt.end_time >= now() - interval '6 minutes' then 'failing'
          -- No completed successful run yet (and no recent terminal failure above):
          -- conservative first-run / retained-history-gap state.
          when ls.end_time is null then 'degraded'
          when now() - ls.end_time > interval '6 minutes' then 'failing'
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
      case
        when bool_or(state = 'failing') then 'failing'
        when bool_or(state = 'degraded') then 'degraded'
        else 'healthy'
      end
    into v_jobs, v_database_jobs_state
    from snap;
  exception when others then
    v_jobs_error_code := sqlstate;
    v_database_jobs_state := 'unavailable';
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

  -- Payment/Tap: database evidence only. enabled/configured never implies
  -- provider health; without a provider availability probe the normal state is
  -- not_monitored. Recent stale attempts and Order Integrity incidents are shown.
  begin
    -- "configured" mirrors the runtime resolver (_shared/tap.ts resolveTapConfig):
    -- provider must be 'tap', the key for the SELECTED mode must be present, and
    -- merchant_id must be set. The resolver trims merchant_id and the key before
    -- the emptiness gate, so a whitespace-only value is NOT ready — trim here too.
    -- The mode-specific key is only tested for presence; its value is never
    -- selected into a returned column.
    select
      true,
      enabled,
      (lower(coalesce(provider_name,'')) = 'tap'
        and nullif(btrim(public_config->>'merchant_id', E' \t\n\r\f\v'),'') is not null
        and nullif(
              btrim(
                secret_config->>(
                  case when lower(coalesce(public_config->>'mode','test')) = 'live'
                       then 'live_secret_key' else 'test_secret_key' end
                ), E' \t\n\r\f\v'),'') is not null),
      provider_name,
      nullif(public_config->>'mode',''),
      nullif(public_config->>'currency',''),
      updated_at
    into v_payment_exists, v_payment_enabled, v_payment_configured,
      v_payment_provider, v_payment_mode, v_payment_currency, v_payment_updated_at
    from public.integration_settings
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
        'MULTIPLE_SUCCESSFUL_CAPTURES'
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
      'id','database_jobs',
      'critical',true,
      'state',v_database_jobs_state,
      'source','pg_cron',
      'details',jsonb_build_object(
        'expected_jobs',3,
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
    v_database_jobs_state
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
      'lazywait','order_integrity','account_deletion','database_jobs'
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
  'Internal Operations Health computation core (service-role only). The staff-facing operations_health_summary() wrapper and the alert evaluator both delegate here so health is computed by exactly one authoritative path. Returns the same safe jsonb as operations_health_summary(); no PII, secrets, raw payloads, tokens or cron internals.';

-- ----------------------------------------------------------------------------
-- 2. Staff-facing wrapper (public RPC contract preserved exactly).
-- ----------------------------------------------------------------------------

create or replace function public.operations_health_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Only staff may view operations health'
      using errcode = '42501';
  end if;
  return public.operations_health_snapshot_internal();
end;
$$;

revoke all on function public.operations_health_summary() from public, anon;
grant execute on function public.operations_health_summary() to authenticated;

comment on function public.operations_health_summary() is
  'Staff-gated, read-only Operations Health Center aggregate. Thin wrapper over operations_health_snapshot_internal() (the single authoritative health core); returns no PII, secrets, raw provider payloads, tokens, cron commands or external provider probe results.';

-- ----------------------------------------------------------------------------
-- 3. Alert domain tables.
--    All tables: RLS enabled, no anon/authenticated/customer access (definer-
--    only, like the order_integrity_* tables). No PII, no secrets, no raw
--    provider payloads; safe_evidence carries only sanitized aggregate fields.
-- ----------------------------------------------------------------------------

-- 3a. Settings — singleton (app_settings `id boolean` pattern), DORMANT defaults.
--     Applying this migration must not start evaluating, digesting or sending:
--     every switch below defaults to OFF and external dispatch cannot be
--     enabled by the v1 settings RPC at all.
create table if not exists public.operations_alert_settings (
  id                             boolean primary key default true check (id),
  alert_evaluation_enabled       boolean not null default false,
  digest_generation_enabled      boolean not null default false,
  external_dispatch_enabled      boolean not null default false,
  timezone                       text    not null default 'Asia/Riyadh',
  digest_local_time              time    not null default '08:00',
  warning_reminder_minutes       integer not null default 1440
                                   check (warning_reminder_minutes between 5 and 10080),
  critical_reminder_minutes      integer not null default 240
                                   check (critical_reminder_minutes between 5 and 10080),
  recovery_notifications_enabled boolean not null default true,
  optional_system_alerts_enabled boolean not null default false,
  system_rule_overrides          jsonb   not null default '{}'::jsonb,
  -- Set by the evaluator after its FIRST successful enabled run, even when
  -- that run observed zero conditions. Baseline mode is decided by this
  -- marker, not by whether alert rows exist: an all-clear first run must
  -- still complete the baseline, otherwise a later first incident would be
  -- silently suppressed as "baseline". Engine-internal (not patchable via
  -- the settings RPC).
  baseline_completed_at          timestamptz,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  updated_by                     uuid references public.profiles(id) on delete set null
);

drop trigger if exists set_operations_alert_settings_updated_at on public.operations_alert_settings;
create trigger set_operations_alert_settings_updated_at
  before update on public.operations_alert_settings
  for each row execute function public.set_updated_at();

insert into public.operations_alert_settings (id) values (true)
on conflict (id) do nothing;

alter table public.operations_alert_settings enable row level security;
revoke all on public.operations_alert_settings from public, anon, authenticated;

-- 3b. Evaluation run ledger (order_integrity_runs precedent): every evaluator
--     invocation is durably visible, including safe skip/failure reasons.
create table if not exists public.operations_alert_runs (
  id               bigint generated always as identity primary key,
  kind             text not null check (kind in ('evaluate','digest')),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null default 'running'
                     check (status in ('running','success','skipped','failed')),
  skip_reason      text,
  safe_error_code  text,
  counts           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists operations_alert_runs_recent_idx
  on public.operations_alert_runs (kind, started_at desc);

alter table public.operations_alert_runs enable row level security;
revoke all on public.operations_alert_runs from public, anon, authenticated;

-- 3c. Current alert state. One OPEN row per fingerprint (partial unique, the
--     order_integrity_incidents dedup pattern); a reopened condition gets a
--     NEW row with generation + 1.
create table if not exists public.operations_alert_state (
  id               uuid primary key default gen_random_uuid(),
  fingerprint      text not null check (fingerprint ~ '^[a-z0-9_:-]{3,200}$'),
  subsystem        text not null,
  condition_code   text not null,
  severity         text not null check (severity in ('warning','critical')),
  status           text not null default 'open' check (status in ('open','recovered')),
  generation       integer not null default 1 check (generation >= 1),
  baseline         boolean not null default false,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  occurrence_count integer not null default 1 check (occurrence_count >= 1),
  last_notified_at timestamptz,
  last_reminder_at timestamptz,
  recovered_at     timestamptz,
  safe_evidence    jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint operations_alert_state_recovered_ts
    check (status <> 'recovered' or recovered_at is not null)
);

create unique index if not exists operations_alert_state_open_fp
  on public.operations_alert_state (fingerprint) where status = 'open';
create index if not exists operations_alert_state_status_sev_idx
  on public.operations_alert_state (status, severity, last_seen_at desc);
create index if not exists operations_alert_state_subsystem_idx
  on public.operations_alert_state (subsystem, last_seen_at desc);
create index if not exists operations_alert_state_recovered_idx
  on public.operations_alert_state (recovered_at desc) where status = 'recovered';

drop trigger if exists set_operations_alert_state_updated_at on public.operations_alert_state;
create trigger set_operations_alert_state_updated_at
  before update on public.operations_alert_state
  for each row execute function public.set_updated_at();

alter table public.operations_alert_state enable row level security;
revoke all on public.operations_alert_state from public, anon, authenticated;

-- 3d. Append-only lifecycle events (the in-app alert history).
create table if not exists public.operations_alert_events (
  id                      uuid primary key default gen_random_uuid(),
  alert_id                uuid not null references public.operations_alert_state(id) on delete cascade,
  fingerprint             text not null,
  event_type              text not null check (event_type in
                            ('baseline_observed','opened','escalated','downgraded','reminder','recovered')),
  severity                text not null check (severity in ('info','warning','critical')),
  notification_suppressed boolean not null default false,
  safe_evidence           jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now()
);

create index if not exists operations_alert_events_alert_idx
  on public.operations_alert_events (alert_id, created_at);
create index if not exists operations_alert_events_recent_idx
  on public.operations_alert_events (created_at desc);

alter table public.operations_alert_events enable row level security;
revoke all on public.operations_alert_events from public, anon, authenticated;

-- 3e. Daily digest runs. At most one digest per (scope, local day, language).
create table if not exists public.operations_digest_runs (
  id                  uuid primary key default gen_random_uuid(),
  scope               text not null default 'daily' check (scope = 'daily'),
  digest_date         date not null,
  language            text not null check (language in ('en','ar')),
  timezone            text not null,
  period_start_utc    timestamptz not null,
  period_end_utc      timestamptz not null,
  overall_state       text not null,
  opened_count        integer not null default 0 check (opened_count >= 0),
  recovered_count     integer not null default 0 check (recovered_count >= 0),
  unresolved_count    integer not null default 0 check (unresolved_count >= 0),
  critical_open_count integer not null default 0 check (critical_open_count >= 0),
  warning_open_count  integer not null default 0 check (warning_open_count >= 0),
  content             jsonb not null default '{}'::jsonb,
  rendered_subject    text not null,
  rendered_body       text not null,
  generated_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  constraint operations_digest_runs_period check (period_end_utc > period_start_utc),
  constraint operations_digest_runs_one_per_day unique (scope, digest_date, language)
);

create index if not exists operations_digest_runs_recent_idx
  on public.operations_digest_runs (digest_date desc, language);

alter table public.operations_digest_runs enable row level security;
revoke all on public.operations_digest_runs from public, anon, authenticated;

-- 3f. Provider-neutral DORMANT outbox. No dispatcher exists; external channels
--     are structurally forced to stay blocked in v1 (check constraint), and no
--     recipient addresses, phone numbers, tokens or credentials are stored.
create table if not exists public.operations_alert_outbox (
  id              uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  alert_event_id  uuid references public.operations_alert_events(id) on delete cascade,
  digest_run_id   uuid references public.operations_digest_runs(id) on delete cascade,
  channel         text not null check (channel in ('in_app','email','whatsapp','push')),
  language        text not null check (language in ('en','ar')),
  subject_safe    text not null,
  body_safe       text not null,
  template_data   jsonb not null default '{}'::jsonb,
  -- Full lifecycle vocabulary is declared for the FUTURE dispatcher, but the
  -- v1 dormancy constraint below makes 'pending'/'sent'/'failed' unreachable.
  status          text not null default 'blocked'
                    check (status in ('recorded','pending','sent','failed','cancelled','blocked')),
  blocked_reason  text default 'external_dispatch_disabled',
  attempt_count   integer not null default 0 check (attempt_count >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint operations_alert_outbox_ref
    check (num_nonnulls(alert_event_id, digest_run_id) = 1),
  -- v1 hard dormancy: in_app rows are only ever 'recorded' history (no reason),
  -- and an external-channel row can never leave blocked/cancelled — external
  -- delivery is structurally impossible until a future approved migration
  -- drops THIS named constraint.
  constraint operations_alert_outbox_v1_dormancy check (
    (channel = 'in_app'  and status in ('recorded','cancelled') and blocked_reason is null)
    or (channel <> 'in_app' and status in ('blocked','cancelled'))
  ),
  constraint operations_alert_outbox_blocked_reason
    check (status <> 'blocked' or blocked_reason is not null),
  constraint operations_alert_outbox_idem unique (idempotency_key)
);

create index if not exists operations_alert_outbox_event_idx
  on public.operations_alert_outbox (alert_event_id);
create index if not exists operations_alert_outbox_digest_idx
  on public.operations_alert_outbox (digest_run_id);

drop trigger if exists set_operations_alert_outbox_updated_at on public.operations_alert_outbox;
create trigger set_operations_alert_outbox_updated_at
  before update on public.operations_alert_outbox
  for each row execute function public.set_updated_at();

alter table public.operations_alert_outbox enable row level security;
revoke all on public.operations_alert_outbox from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Alert engine helpers + evaluator (service-role only).
-- ----------------------------------------------------------------------------

-- 4a. Defensive evidence sanitizer: keeps only scalar values from an object,
--     truncates strings, caps key count/length. Guarantees safe_evidence can
--     never smuggle nested payloads, PII blobs or oversized raw text.
create or replace function public.operations_alerts_sanitize_evidence(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_kept integer := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return '{}'::jsonb;
  end if;
  for v_key, v_val in select key, value from jsonb_each(p) loop
    exit when v_kept >= 20;
    if jsonb_typeof(v_val) = 'string' then
      v_out := v_out || jsonb_build_object(left(v_key, 64), left(v_val #>> '{}', 200));
      v_kept := v_kept + 1;
    elsif jsonb_typeof(v_val) in ('number', 'boolean') then
      v_out := v_out || jsonb_build_object(left(v_key, 64), v_val);
      v_kept := v_kept + 1;
    end if;
    -- objects/arrays/null are dropped by design
  end loop;
  return v_out;
end;
$$;

revoke all on function public.operations_alerts_sanitize_evidence(jsonb)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_sanitize_evidence(jsonb) to service_role;

-- 4b. Safe scalar readers (never raise on malformed input).
create or replace function public.operations_alerts_safe_int(p jsonb, p_key text)
returns integer
language plpgsql
immutable
set search_path = public
as $$
begin
  return greatest(coalesce((p ->> p_key)::integer, 0), 0);
exception when others then
  return 0;
end;
$$;

revoke all on function public.operations_alerts_safe_int(jsonb, text)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_safe_int(jsonb, text) to service_role;

create or replace function public.operations_alerts_safe_bool(p jsonb, p_key text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
begin
  return coalesce((p ->> p_key)::boolean, false);
exception when others then
  return false;
end;
$$;

revoke all on function public.operations_alerts_safe_bool(jsonb, text)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_safe_bool(jsonb, text) to service_role;

-- 4c. Deterministic condition derivation. Pure over its two inputs: the health
--     snapshot (backend-authoritative states — NEVER recomputed here) and the
--     settings row as jsonb. Returns a jsonb ARRAY of
--     {fingerprint, subsystem, condition_code, severity, safe_evidence}.
--
--     FINGERPRINT = STABLE CONDITION IDENTITY (subsystem + identity class +
--     safe entity key). The current classification lives in condition_code and
--     the severity field, NOT in the fingerprint — so a condition that worsens
--     (degraded -> failing) ESCALATES the same alert instead of falsely
--     recovering one fingerprint and opening another. Fingerprints contain
--     machine codes only: no PII, order ids, raw errors or translated text.
create or replace function public.operations_alerts_derive(p_snapshot jsonb, p_settings jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_overall text;
  v_optional_alerts boolean;
  v_overrides jsonb;
  v_sys jsonb;
  v_id text;
  v_state text;
  v_details jsonb;
  v_job jsonb;
  v_jobname text;
  v_jstate text;
  v_code text;
  v_sev text;
  v_crit_ct integer;
  v_warn_ct integer;
  v_manual integer;
  v_due integer;
  v_deliv integer;
  v_events integer;
begin
  if p_snapshot is null
     or jsonb_typeof(p_snapshot) is distinct from 'object'
     or jsonb_typeof(p_snapshot -> 'systems') is distinct from 'array' then
    return '[]'::jsonb;
  end if;

  v_optional_alerts := public.operations_alerts_safe_bool(p_settings, 'optional_system_alerts_enabled');
  v_overrides := case when jsonb_typeof(p_settings -> 'system_rule_overrides') = 'object'
                      then p_settings -> 'system_rule_overrides' else '{}'::jsonb end;
  v_overall := p_snapshot ->> 'overall_state';

  -- Platform-level condition (spec: overall failing / configuration_error).
  if v_overall in ('failing', 'configuration_error')
     and not public.operations_alerts_safe_bool(v_overrides -> 'platform', 'muted') then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'fingerprint', 'platform:health',
      'subsystem', 'platform',
      'condition_code', v_overall,
      'severity', 'critical',
      'safe_evidence', public.operations_alerts_sanitize_evidence(
        jsonb_build_object('overall_state', v_overall))));
  end if;

  for v_sys in select * from jsonb_array_elements(p_snapshot -> 'systems') loop
    v_id := coalesce(v_sys ->> 'id', 'unknown');
    if v_id !~ '^[a-z0-9_]{2,40}$' then
      continue; -- refuse to fingerprint an unexpected subsystem id
    end if;
    if public.operations_alerts_safe_bool(v_overrides -> v_id, 'muted') then
      continue;
    end if;
    v_state := coalesce(v_sys ->> 'state', 'unavailable');
    v_details := case when jsonb_typeof(v_sys -> 'details') = 'object'
                      then v_sys -> 'details' else '{}'::jsonb end;

    if v_id = 'lazywait' then
      v_code := case v_state
        when 'failing' then 'sync_failing'
        when 'configuration_error' then 'configuration_error'
        when 'degraded' then 'sync_degraded'
        when 'unavailable' then 'unavailable'
        else null end;
      if v_code is not null then
        v_sev := case when v_state in ('failing', 'configuration_error')
                      then 'critical' else 'warning' end;
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'lazywait:sync_health',
          'subsystem', 'lazywait', 'condition_code', v_code, 'severity', v_sev,
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state,
              'safe_error_code', v_details ->> 'safe_error_code'))));
      end if;

    elsif v_id = 'order_integrity' then
      v_crit_ct := public.operations_alerts_safe_int(v_details, 'open_critical_count');
      v_warn_ct := public.operations_alerts_safe_int(v_details, 'open_warning_count');
      if v_crit_ct > 0 or v_warn_ct > 0 then
        -- Correlated: all unresolved incident evidence groups under ONE alert
        -- whose severity follows the worst open incident.
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'order_integrity:incidents',
          'subsystem', 'order_integrity',
          'condition_code', case when v_crit_ct > 0
                                 then 'critical_incidents' else 'warning_incidents' end,
          'severity', case when v_crit_ct > 0 then 'critical' else 'warning' end,
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('open_critical_count', v_crit_ct,
              'open_warning_count', v_warn_ct, 'state', v_state))));
      elsif v_state in ('failing', 'configuration_error', 'degraded', 'unavailable') then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'order_integrity:health',
          'subsystem', 'order_integrity', 'condition_code', v_state,
          'severity', case when v_state in ('failing', 'configuration_error')
                           then 'critical' else 'warning' end,
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state,
              'safe_error_code', v_details ->> 'safe_error_code'))));
      end if;

    elsif v_id = 'account_deletion' then
      v_manual := public.operations_alerts_safe_int(v_details, 'manual_review_count');
      v_due := public.operations_alerts_safe_int(v_details, 'due_count');
      if v_state in ('failing', 'configuration_error') then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'account_deletion:health',
          'subsystem', 'account_deletion', 'condition_code', v_state,
          'severity', 'critical',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state, 'due_count', v_due,
              'manual_review_count', v_manual))));
      elsif v_state = 'degraded' then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'account_deletion:health',
          'subsystem', 'account_deletion',
          'condition_code', case when v_due > 0 then 'due_backlog' else 'degraded' end,
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state, 'due_count', v_due,
              'oldest_due_at', v_details ->> 'oldest_due_at'))));
      elsif v_state = 'unavailable' then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'account_deletion:health',
          'subsystem', 'account_deletion', 'condition_code', 'unavailable',
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state,
              'safe_error_code', v_details ->> 'safe_error_code'))));
      end if;
      -- Manual-review backlog is a DISTINCT ongoing condition with its own
      -- identity (it can persist while the processor itself is healthy).
      if v_manual > 0 then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'account_deletion:manual_review_backlog',
          'subsystem', 'account_deletion', 'condition_code', 'manual_review_backlog',
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('manual_review_count', v_manual))));
      end if;

    elsif v_id = 'database_jobs' then
      if v_state = 'unavailable' then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'database_jobs:unavailable',
          'subsystem', 'database_jobs', 'condition_code', 'unavailable',
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state,
              'safe_error_code', v_details ->> 'safe_error_code'))));
      end if;
      -- per-job conditions are derived from the jobs[] array below

    elsif v_id = 'payment' then
      if v_state = 'failing' then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'payment:health',
          'subsystem', 'payment', 'condition_code', 'integrity_incidents',
          'severity', 'critical',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('integrity_critical_count',
              public.operations_alerts_safe_int(v_details, 'integrity_critical_count')))));
      elsif v_state = 'degraded' then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'payment:health',
          'subsystem', 'payment', 'condition_code', 'stale_initiations',
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('stale_initiated_24h',
              public.operations_alerts_safe_int(v_details, 'stale_initiated_24h')))));
      end if;
      if v_optional_alerts and v_state in ('disabled', 'not_configured', 'unavailable') then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'payment:configuration',
          'subsystem', 'payment', 'condition_code', v_state,
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state))));
      end if;

    elsif v_id = 'push' then
      v_deliv := public.operations_alerts_safe_int(v_details, 'failed_deliveries_24h');
      v_events := public.operations_alerts_safe_int(v_details, 'failed_send_events_24h');
      if v_state = 'degraded' and v_deliv > 0 then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'push:failed_deliveries',
          'subsystem', 'push', 'condition_code', 'failed_deliveries',
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('failed_deliveries_24h', v_deliv))));
      end if;
      if v_state = 'degraded' and v_events > 0 then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'push:failed_send_events',
          'subsystem', 'push', 'condition_code', 'failed_send_events',
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('failed_send_events_24h', v_events))));
      end if;
      if v_optional_alerts and v_state in ('disabled', 'not_configured', 'unavailable') then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'push:configuration',
          'subsystem', 'push', 'condition_code', v_state,
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state))));
      end if;

    elsif v_id in ('email', 'otp') then
      if v_optional_alerts and v_state in ('disabled', 'not_configured', 'unavailable') then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', v_id || ':configuration',
          'subsystem', v_id, 'condition_code', v_state,
          'severity', 'warning',
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state))));
      end if;
    end if;
  end loop;

  -- Per-job conditions: one stable identity per allowlisted job. The job name
  -- is a safe entity key (strict charset); the classification code follows the
  -- backend-decided state and its safe explanatory fields.
  if jsonb_typeof(p_snapshot -> 'jobs') = 'array'
     and not public.operations_alerts_safe_bool(v_overrides -> 'database_jobs', 'muted') then
    for v_job in select * from jsonb_array_elements(p_snapshot -> 'jobs') loop
      v_jobname := coalesce(v_job ->> 'job_name', '');
      if v_jobname !~ '^[a-z0-9-]{1,60}$' then
        continue;
      end if;
      v_jstate := coalesce(v_job ->> 'state', 'unavailable');
      if v_jstate = 'failing' then
        if v_job ->> 'job_id' is null then
          v_code := 'job_missing';
        elsif not public.operations_alerts_safe_bool(v_job, 'active') then
          v_code := 'job_inactive';
        elsif v_job ->> 'latest_terminal_status' is not null
              and v_job ->> 'latest_terminal_status' <> 'succeeded' then
          v_code := 'terminal_failure';
        else
          v_code := 'stale_success';
        end if;
        v_sev := 'critical';
      elsif v_jstate = 'degraded' then
        if v_job ->> 'latest_success_at' is null then
          v_code := 'no_success_yet';
        elsif (v_job ->> 'schedule') is distinct from (v_job ->> 'expected_schedule') then
          v_code := 'schedule_mismatch';
        else
          v_code := 'job_degraded';
        end if;
        v_sev := 'warning';
      else
        continue;
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'fingerprint', 'database_jobs:job_health:' || v_jobname,
        'subsystem', 'database_jobs', 'condition_code', v_code, 'severity', v_sev,
        'safe_evidence', public.operations_alerts_sanitize_evidence(jsonb_build_object(
          'job_name', v_jobname, 'state', v_jstate,
          'latest_terminal_status', v_job ->> 'latest_terminal_status',
          'latest_success_at', v_job ->> 'latest_success_at',
          'schedule', v_job ->> 'schedule',
          'expected_schedule', v_job ->> 'expected_schedule'))));
    end loop;
  end if;

  return v_out;
end;
$$;

revoke all on function public.operations_alerts_derive(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_derive(jsonb, jsonb) to service_role;

comment on function public.operations_alerts_derive(jsonb, jsonb) is
  'Deterministic mapping from the authoritative Operations Health snapshot to alertable conditions. Fingerprints are stable condition identities (classification changes escalate/downgrade the same alert instead of churning open/recover); never recomputes health; machine codes and safe aggregates only.';

-- 4d. Deterministic bilingual event rendering (no generative AI; machine codes
--     and localized fixed phrases only — no PII, no raw errors).
create or replace function public.operations_alerts_render_event(
  p_event_type text,
  p_language text,
  p_subsystem text,
  p_condition_code text,
  p_severity text
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_sys text;
  v_event text;
  v_sev text;
begin
  if p_language = 'ar' then
    v_sys := case p_subsystem
      when 'platform' then 'المنصة'
      when 'lazywait' then 'مزامنة Lazywait'
      when 'order_integrity' then 'سلامة الطلبات'
      when 'account_deletion' then 'حذف الحسابات'
      when 'database_jobs' then 'المهام المجدولة'
      when 'payment' then 'الدفع / Tap'
      when 'push' then 'الإشعارات الفورية'
      when 'email' then 'البريد / SMTP'
      when 'otp' then 'واتساب / رمز التحقق'
      else left(coalesce(p_subsystem, '?'), 40) end;
    v_event := case p_event_type
      when 'opened' then 'تنبيه جديد'
      when 'escalated' then 'تصعيد تنبيه'
      when 'downgraded' then 'خفض درجة تنبيه'
      when 'reminder' then 'تذكير بتنبيه قائم'
      when 'recovered' then 'تعافي تنبيه'
      when 'baseline_observed' then 'حالة قائمة عند خط الأساس'
      else left(coalesce(p_event_type, '?'), 40) end;
    v_sev := case p_severity
      when 'critical' then 'حرج' when 'warning' then 'تحذير' else 'معلومة' end;
    return jsonb_build_object(
      'subject', '[' || v_sev || '] ' || v_sys || ' — ' || v_event,
      'body', v_event || ': ' || v_sys || ' — الحالة ' ||
              left(coalesce(p_condition_code, '?'), 80) || ' (الخطورة: ' || v_sev || ').');
  end if;

  v_sys := case p_subsystem
    when 'platform' then 'Platform'
    when 'lazywait' then 'Lazywait Sync'
    when 'order_integrity' then 'Order Integrity'
    when 'account_deletion' then 'Account Deletion'
    when 'database_jobs' then 'Scheduled Jobs'
    when 'payment' then 'Payment / Tap'
    when 'push' then 'Push Notifications'
    when 'email' then 'Email / SMTP'
    when 'otp' then 'WhatsApp / OTP'
    else left(coalesce(p_subsystem, '?'), 40) end;
  v_event := case p_event_type
    when 'opened' then 'Alert opened'
    when 'escalated' then 'Alert escalated'
    when 'downgraded' then 'Alert downgraded'
    when 'reminder' then 'Alert reminder'
    when 'recovered' then 'Alert recovered'
    when 'baseline_observed' then 'Baseline condition observed'
    else left(coalesce(p_event_type, '?'), 40) end;
  v_sev := coalesce(p_severity, 'info');
  return jsonb_build_object(
    'subject', '[' || upper(v_sev) || '] ' || v_sys || ' — ' || v_event,
    'body', v_event || ': ' || v_sys || ' condition ' ||
            left(coalesce(p_condition_code, '?'), 80) || ' (severity: ' || v_sev || ').');
end;
$$;

revoke all on function public.operations_alerts_render_event(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_render_event(text, text, text, text, text)
  to service_role;

-- 4e. In-app outbox enqueue for one lifecycle event (both languages).
--     Deterministic idempotency keys; NO external-channel rows are ever
--     enqueued in v1 (and the table constraint would force them to 'blocked'
--     even if something tried).
create or replace function public.operations_alerts_outbox_for_event(
  p_event_id uuid,
  p_event_type text,
  p_subsystem text,
  p_condition_code text,
  p_severity text
)
returns integer
language plpgsql
volatile
set search_path = public
as $$
declare
  v_lang text;
  v_rendered jsonb;
  v_inserted integer := 0;
  v_ct integer;
begin
  foreach v_lang in array array['en', 'ar'] loop
    v_rendered := public.operations_alerts_render_event(
      p_event_type, v_lang, p_subsystem, p_condition_code, p_severity);
    insert into public.operations_alert_outbox
      (idempotency_key, alert_event_id, channel, language,
       subject_safe, body_safe, template_data, status, blocked_reason)
    values
      ('alert_event:' || p_event_id::text || ':in_app:' || v_lang,
       p_event_id, 'in_app', v_lang,
       v_rendered ->> 'subject', v_rendered ->> 'body',
       jsonb_build_object(
         'event_type', p_event_type, 'subsystem', p_subsystem,
         'condition_code', p_condition_code, 'severity', p_severity),
       'recorded', null)
    on conflict (idempotency_key) do nothing;
    get diagnostics v_ct = row_count;
    v_inserted := v_inserted + v_ct;
  end loop;
  return v_inserted;
end;
$$;

revoke all on function public.operations_alerts_outbox_for_event(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_outbox_for_event(uuid, text, text, text, text)
  to service_role;

-- 4f. The evaluator. Service-role only, VOLATILE, concurrency-safe
--     (advisory xact lock + partial unique + on-conflict), exception-isolated
--     (a failure rolls back every alert write and is recorded on the durable
--     run ledger with a safe error code only). Writes ONLY to the
--     operations_alert_* tables.
create or replace function public.operations_alerts_evaluate()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c_lock_key constant bigint := 829134602;
  v_run_id bigint;
  v_settings public.operations_alert_settings%rowtype;
  v_snapshot jsonb;
  v_conds jsonb;
  v_baseline boolean;
  v_alert public.operations_alert_state%rowtype;
  v_alert_id uuid;
  v_event_id uuid;
  v_gen integer;
  v_interval interval;
  v_anchor timestamptz;
  v_suppress boolean;
  c record;
  n_observed integer := 0;
  n_opened integer := 0;
  n_unchanged integer := 0;
  n_escalated integer := 0;
  n_downgraded integer := 0;
  n_reminders integer := 0;
  n_recovered integer := 0;
  n_outbox integer := 0;
  v_counts jsonb;
begin
  insert into public.operations_alert_runs (kind, status)
  values ('evaluate', 'running')
  returning id into v_run_id;

  if not pg_try_advisory_xact_lock(c_lock_key) then
    update public.operations_alert_runs
       set status = 'skipped', skip_reason = 'overlap_skipped', finished_at = now()
     where id = v_run_id;
    return jsonb_build_object('status', 'skipped', 'reason', 'overlap_skipped');
  end if;

  select * into v_settings
  from public.operations_alert_settings
  where id
  for update;
  if not found then
    update public.operations_alert_runs
       set status = 'skipped', skip_reason = 'settings_missing', finished_at = now()
     where id = v_run_id;
    return jsonb_build_object('status', 'skipped', 'reason', 'settings_missing');
  end if;

  if not v_settings.alert_evaluation_enabled then
    update public.operations_alert_runs
       set status = 'skipped', skip_reason = 'evaluation_disabled', finished_at = now()
     where id = v_run_id;
    return jsonb_build_object('status', 'disabled', 'reason', 'evaluation_disabled');
  end if;

  begin  -- exception isolation: any failure below rolls back ALL alert writes
    v_snapshot := public.operations_health_snapshot_internal();
    if v_snapshot is null
       or jsonb_typeof(v_snapshot) is distinct from 'object'
       or v_snapshot ->> 'overall_state' is null
       or jsonb_typeof(v_snapshot -> 'systems') is distinct from 'array' then
      raise exception 'health snapshot malformed' using errcode = 'P0001';
    end if;

    v_conds := public.operations_alerts_derive(v_snapshot, to_jsonb(v_settings));

    create temp table if not exists _oa_conds (
      fingerprint text primary key,
      subsystem text not null,
      condition_code text not null,
      severity text not null,
      safe_evidence jsonb not null
    ) on commit drop;
    truncate _oa_conds;

    insert into _oa_conds (fingerprint, subsystem, condition_code, severity, safe_evidence)
    select distinct on (x.fingerprint)
           x.fingerprint, x.subsystem, x.condition_code, x.severity,
           coalesce(x.safe_evidence, '{}'::jsonb)
    from jsonb_to_recordset(v_conds)
           as x(fingerprint text, subsystem text, condition_code text,
                severity text, safe_evidence jsonb)
    where x.fingerprint is not null
      and x.fingerprint ~ '^[a-z0-9_:-]{3,200}$'
      and x.severity in ('warning', 'critical');

    -- Baseline mode is decided by the durable settings marker, NOT by whether
    -- alert rows exist: a healthy (zero-condition) first run leaves the state
    -- table empty, and the first real incident afterwards must open normally.
    v_baseline := v_settings.baseline_completed_at is null;

    -- Open / update pass -----------------------------------------------------
    for c in select * from _oa_conds loop
      select * into v_alert
      from public.operations_alert_state
      where fingerprint = c.fingerprint and status = 'open'
      for update;

      if not found then
        v_alert_id := null;
        select coalesce(max(generation), 0) + 1 into v_gen
        from public.operations_alert_state
        where fingerprint = c.fingerprint;

        insert into public.operations_alert_state
          (fingerprint, subsystem, condition_code, severity, status,
           generation, baseline, safe_evidence)
        values
          (c.fingerprint, c.subsystem, c.condition_code, c.severity, 'open',
           v_gen, v_baseline, c.safe_evidence)
        on conflict (fingerprint) where status = 'open' do nothing
        returning id into v_alert_id;

        if v_alert_id is not null then
          if v_baseline then
            -- Baseline: visible in the inbox, but notification-suppressed and
            -- NO outbox rows — the first observation must not create a storm.
            insert into public.operations_alert_events
              (alert_id, fingerprint, event_type, severity,
               notification_suppressed, safe_evidence)
            values
              (v_alert_id, c.fingerprint, 'baseline_observed', c.severity,
               true, c.safe_evidence);
            n_observed := n_observed + 1;
          else
            insert into public.operations_alert_events
              (alert_id, fingerprint, event_type, severity,
               notification_suppressed, safe_evidence)
            values
              (v_alert_id, c.fingerprint, 'opened', c.severity,
               false, c.safe_evidence)
            returning id into v_event_id;
            n_outbox := n_outbox + public.operations_alerts_outbox_for_event(
              v_event_id, 'opened', c.subsystem, c.condition_code, c.severity);
            update public.operations_alert_state
               set last_notified_at = now()
             where id = v_alert_id;
            n_opened := n_opened + 1;
          end if;
        end if;

      elsif v_alert.severity = c.severity then
        -- Same severity: refresh the classification/evidence silently
        -- (transition-only events; no duplicate notifications).
        update public.operations_alert_state
           set last_seen_at = now(),
               occurrence_count = occurrence_count + 1,
               condition_code = c.condition_code,
               safe_evidence = c.safe_evidence
         where id = v_alert.id;
        n_unchanged := n_unchanged + 1;

      elsif c.severity = 'critical' and v_alert.severity = 'warning' then
        update public.operations_alert_state
           set severity = 'critical',
               last_seen_at = now(),
               occurrence_count = occurrence_count + 1,
               condition_code = c.condition_code,
               safe_evidence = c.safe_evidence,
               last_notified_at = now()
         where id = v_alert.id;
        insert into public.operations_alert_events
          (alert_id, fingerprint, event_type, severity,
           notification_suppressed, safe_evidence)
        values
          (v_alert.id, c.fingerprint, 'escalated', 'critical', false, c.safe_evidence)
        returning id into v_event_id;
        n_outbox := n_outbox + public.operations_alerts_outbox_for_event(
          v_event_id, 'escalated', c.subsystem, c.condition_code, 'critical');
        n_escalated := n_escalated + 1;

      else
        -- Severity downgrade (critical -> warning): still alertable, so this
        -- must NOT look like a recovery and does not notify.
        update public.operations_alert_state
           set severity = 'warning',
               last_seen_at = now(),
               occurrence_count = occurrence_count + 1,
               condition_code = c.condition_code,
               safe_evidence = c.safe_evidence
         where id = v_alert.id;
        insert into public.operations_alert_events
          (alert_id, fingerprint, event_type, severity,
           notification_suppressed, safe_evidence)
        values
          (v_alert.id, c.fingerprint, 'downgraded', 'warning', true, c.safe_evidence);
        n_downgraded := n_downgraded + 1;
      end if;
    end loop;

    -- Reminder pass (idempotent cooldown) ------------------------------------
    for v_alert in
      select s.* from public.operations_alert_state s
      where s.status = 'open'
        and s.last_notified_at is not null
        and exists (select 1 from _oa_conds c2 where c2.fingerprint = s.fingerprint)
      for update
    loop
      v_interval := make_interval(mins => case
        when v_alert.severity = 'critical' then v_settings.critical_reminder_minutes
        else v_settings.warning_reminder_minutes end);
      v_anchor := greatest(v_alert.last_notified_at,
                           coalesce(v_alert.last_reminder_at, v_alert.last_notified_at));
      if now() - v_anchor >= v_interval then
        insert into public.operations_alert_events
          (alert_id, fingerprint, event_type, severity,
           notification_suppressed, safe_evidence)
        values
          (v_alert.id, v_alert.fingerprint, 'reminder', v_alert.severity,
           false, v_alert.safe_evidence)
        returning id into v_event_id;
        n_outbox := n_outbox + public.operations_alerts_outbox_for_event(
          v_event_id, 'reminder', v_alert.subsystem, v_alert.condition_code,
          v_alert.severity);
        update public.operations_alert_state
           set last_reminder_at = now()
         where id = v_alert.id;
        n_reminders := n_reminders + 1;
      end if;
    end loop;

    -- Recovery pass (exactly once per open alert) ----------------------------
    for v_alert in
      select s.* from public.operations_alert_state s
      where s.status = 'open'
        and not exists (select 1 from _oa_conds c2 where c2.fingerprint = s.fingerprint)
      for update
    loop
      update public.operations_alert_state
         set status = 'recovered', recovered_at = now()
       where id = v_alert.id;
      -- Recovery of a never-notified (baseline-suppressed) alert stays silent;
      -- otherwise honour the recovery_notifications_enabled setting.
      v_suppress := (not v_settings.recovery_notifications_enabled)
                    or (v_alert.last_notified_at is null);
      insert into public.operations_alert_events
        (alert_id, fingerprint, event_type, severity,
         notification_suppressed, safe_evidence)
      values
        (v_alert.id, v_alert.fingerprint, 'recovered', 'info',
         v_suppress, v_alert.safe_evidence)
      returning id into v_event_id;
      if not v_suppress then
        n_outbox := n_outbox + public.operations_alerts_outbox_for_event(
          v_event_id, 'recovered', v_alert.subsystem, v_alert.condition_code, 'info');
      end if;
      n_recovered := n_recovered + 1;
    end loop;

    -- Persist baseline completion on ANY successful enabled run — including an
    -- all-clear run that inserted no rows. (Rolls back with the inner block on
    -- failure, so a failed first run correctly retries as baseline.)
    if v_baseline then
      update public.operations_alert_settings
         set baseline_completed_at = now()
       where id;
    end if;

    v_counts := jsonb_build_object(
      'baseline', v_baseline,
      'conditions_active', (select count(*) from _oa_conds),
      'baseline_observed', n_observed,
      'opened', n_opened,
      'unchanged', n_unchanged,
      'escalated', n_escalated,
      'downgraded', n_downgraded,
      'reminders', n_reminders,
      'recovered', n_recovered,
      'outbox_recorded', n_outbox);

    update public.operations_alert_runs
       set status = 'success', finished_at = now(), counts = v_counts
     where id = v_run_id;

    return jsonb_build_object('status', 'ok', 'evaluated_at', now()) || v_counts;

  exception when others then
    -- All alert writes above rolled back to this block's savepoint; only the
    -- durable run row survives, carrying a safe error code (no raw message).
    update public.operations_alert_runs
       set status = 'failed', safe_error_code = sqlstate, finished_at = now()
     where id = v_run_id;
    return jsonb_build_object('status', 'failed', 'safe_error_code', sqlstate);
  end;
end;
$$;

revoke all on function public.operations_alerts_evaluate()
  from public, anon, authenticated;
grant execute on function public.operations_alerts_evaluate() to service_role;

comment on function public.operations_alerts_evaluate() is
  'Service-role alert evaluator: derives alertable conditions from the authoritative health snapshot and applies transition-only lifecycle updates (baseline/open/escalate/downgrade/remind/recover) with dedup, cooldowns and concurrency safety. Writes only to operations_alert_* tables; never remediates, never sends externally.';

-- ----------------------------------------------------------------------------
-- 5. Daily digest (deterministic bilingual templates; no generative AI).
-- ----------------------------------------------------------------------------

-- 5a. Localized state labels (mirrors the Admin UI vocabulary).
create or replace function public.operations_alerts_state_label(p_state text, p_language text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_language = 'ar' then
    case p_state
      when 'healthy' then 'سليم'
      when 'idle' then 'لا توجد أعمال معلّقة'
      when 'degraded' then 'متدهور جزئيًا'
      when 'failing' then 'متعطل'
      when 'configuration_error' then 'خطأ في الإعدادات'
      when 'disabled' then 'معطل'
      when 'not_configured' then 'غير مهيأ'
      when 'not_monitored' then 'غير مراقب خارجيًا'
      when 'unavailable' then 'غير متاح'
      else left(coalesce(p_state, '؟'), 40) end
  else
    case p_state
      when 'healthy' then 'healthy'
      when 'idle' then 'idle'
      when 'degraded' then 'degraded'
      when 'failing' then 'failing'
      when 'configuration_error' then 'configuration error'
      when 'disabled' then 'disabled'
      when 'not_configured' then 'not configured'
      when 'not_monitored' then 'not monitored'
      when 'unavailable' then 'unavailable'
      else left(coalesce(p_state, '?'), 40) end
  end;
$$;

revoke all on function public.operations_alerts_state_label(text, text)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_state_label(text, text) to service_role;

-- 5b. Digest builder — shared by generate (previous full local day) and the
--     staff preview (current local day so far). STABLE: structurally incapable
--     of writing. Reads only alert tables + the authoritative snapshot.
create or replace function public.operations_digest_build(
  p_language text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_digest_date date,
  p_timezone text,
  p_preview boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ar boolean := (p_language = 'ar');
  v_snapshot jsonb;
  v_overall text := 'unavailable';
  v_critical_systems jsonb := '[]'::jsonb;
  v_optional_systems jsonb := '[]'::jsonb;
  v_opened jsonb;
  v_recovered jsonb;
  v_still_open jsonb;
  v_top jsonb;
  n_opened integer;
  n_baseline integer;
  n_recovered integer;
  n_open integer;
  n_open_critical integer;
  n_open_warning integer;
  v_lines text[] := array[]::text[];
  v_subject text;
  v_body text;
  r record;
begin
  if p_language not in ('en', 'ar') then
    raise exception 'unsupported digest language' using errcode = 'P0001';
  end if;

  -- Authoritative current health (guarded: a missing source must not break the
  -- digest — it renders as unavailable, never as falsely healthy).
  begin
    v_snapshot := public.operations_health_snapshot_internal();
    v_overall := coalesce(v_snapshot ->> 'overall_state', 'unavailable');
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s ->> 'id', 'state', s ->> 'state') order by s ->> 'id'), '[]'::jsonb)
      into v_critical_systems
    from jsonb_array_elements(v_snapshot -> 'systems') s
    where public.operations_alerts_safe_bool(s, 'critical');
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s ->> 'id', 'state', s ->> 'state') order by s ->> 'id'), '[]'::jsonb)
      into v_optional_systems
    from jsonb_array_elements(v_snapshot -> 'systems') s
    where not public.operations_alerts_safe_bool(s, 'critical');
  exception when others then
    v_overall := 'unavailable';
    v_critical_systems := '[]'::jsonb;
    v_optional_systems := '[]'::jsonb;
  end;

  -- Alert activity inside the period (events are the source of truth).
  select count(*) filter (where e.event_type = 'opened'),
         count(*) filter (where e.event_type = 'baseline_observed')
    into n_opened, n_baseline
  from public.operations_alert_events e
  where e.created_at >= p_period_start and e.created_at < p_period_end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'fingerprint', e.fingerprint, 'severity', e.severity,
           'event_type', e.event_type, 'at', e.created_at) order by e.created_at), '[]'::jsonb)
    into v_opened
  from public.operations_alert_events e
  where e.created_at >= p_period_start and e.created_at < p_period_end
    and e.event_type in ('opened', 'baseline_observed', 'escalated');

  select count(*),
         coalesce(jsonb_agg(jsonb_build_object(
           'fingerprint', e.fingerprint, 'at', e.created_at) order by e.created_at), '[]'::jsonb)
    into n_recovered, v_recovered
  from public.operations_alert_events e
  where e.created_at >= p_period_start and e.created_at < p_period_end
    and e.event_type = 'recovered';

  select count(*),
         count(*) filter (where s.severity = 'critical'),
         count(*) filter (where s.severity = 'warning'),
         coalesce(jsonb_agg(jsonb_build_object(
           'fingerprint', s.fingerprint, 'subsystem', s.subsystem,
           'condition_code', s.condition_code, 'severity', s.severity,
           'baseline', s.baseline, 'first_seen_at', s.first_seen_at,
           'occurrence_count', s.occurrence_count)
           order by s.severity desc, s.first_seen_at), '[]'::jsonb)
    into n_open, n_open_critical, n_open_warning, v_still_open
  from public.operations_alert_state s
  where s.status = 'open' and s.first_seen_at < p_period_end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'subsystem', t.subsystem, 'condition_code', t.condition_code,
           'occurrences', t.occ) order by t.occ desc), '[]'::jsonb)
    into v_top
  from (
    select s.subsystem, s.condition_code, sum(s.occurrence_count)::integer as occ
    from public.operations_alert_state s
    where s.last_seen_at >= p_period_start and s.first_seen_at < p_period_end
    group by s.subsystem, s.condition_code
    order by occ desc
    limit 5
  ) t;

  -- Deterministic rendering ---------------------------------------------------
  if v_ar then
    v_subject := 'ملخص عمليات Spicy Meal اليومي — ' || to_char(p_digest_date, 'YYYY-MM-DD')
                 || case when p_preview then ' (معاينة)' else '' end;
    v_lines := v_lines || (
      'ملخص العمليات اليومي — ' || to_char(p_digest_date, 'YYYY-MM-DD')
      || ' (' || p_timezone || ')');
    v_lines := v_lines || ('الفترة (UTC): ' || to_char(p_period_start at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
      || ' ← ' || to_char(p_period_end at time zone 'UTC', 'YYYY-MM-DD HH24:MI'));
    v_lines := v_lines || ('الحالة العامة الحالية: '
      || public.operations_alerts_state_label(v_overall, 'ar'));
    v_lines := v_lines || ''::text;
    v_lines := v_lines || 'الأنظمة الحرجة:'::text;
    if jsonb_array_length(v_critical_systems) = 0 then
      v_lines := v_lines || '- مصدر الحالة غير متاح حاليًا.'::text;
    else
      for r in select * from jsonb_array_elements(v_critical_systems) as x(sys) loop
        v_lines := v_lines || ('- ' || (r.sys ->> 'id') || ': '
          || public.operations_alerts_state_label(r.sys ->> 'state', 'ar'));
      end loop;
    end if;
    v_lines := v_lines || ''::text;
    v_lines := v_lines || 'التنبيهات:'::text;
    v_lines := v_lines || ('- تنبيهات جديدة خلال الفترة: ' || n_opened::text);
    v_lines := v_lines || ('- تنبيهات تعافت خلال الفترة: ' || n_recovered::text);
    v_lines := v_lines || ('- تنبيهات ما تزال قائمة: ' || n_open::text
      || ' (حرج: ' || n_open_critical::text || '، تحذير: ' || n_open_warning::text || ')');
    if n_baseline > 0 then
      v_lines := v_lines || ('- حالات خط الأساس المرصودة: ' || n_baseline::text);
    end if;
    if n_opened = 0 and n_recovered = 0 and n_open = 0 then
      v_lines := v_lines || '- لا توجد حوادث خلال هذه الفترة.'::text;
    end if;
    v_lines := v_lines || ''::text;
    v_lines := v_lines || 'أكثر الحالات تكرارًا:'::text;
    if jsonb_array_length(v_top) = 0 then
      v_lines := v_lines || '- لا يوجد.'::text;
    else
      for r in select * from jsonb_array_elements(v_top) as x(item) loop
        v_lines := v_lines || ('- ' || (r.item ->> 'subsystem') || ' / '
          || (r.item ->> 'condition_code') || ' × ' || (r.item ->> 'occurrences'));
      end loop;
    end if;
    v_lines := v_lines || ''::text;
    v_lines := v_lines || 'التكاملات الاختيارية (حالات معلوماتية):'::text;
    if jsonb_array_length(v_optional_systems) = 0 then
      v_lines := v_lines || '- مصدر الحالة غير متاح حاليًا.'::text;
    else
      for r in select * from jsonb_array_elements(v_optional_systems) as x(sys) loop
        v_lines := v_lines || ('- ' || (r.sys ->> 'id') || ': '
          || public.operations_alerts_state_label(r.sys ->> 'state', 'ar'));
      end loop;
    end if;
    v_lines := v_lines || ''::text;
    v_lines := v_lines || ('تم الإنشاء: ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
      || case when p_preview then ' — معاينة حية، لم يتم الحفظ' else '' end);
    v_lines := v_lines || 'الإرسال الخارجي معطل في هذا الإصدار.'::text;
  else
    v_subject := 'Spicy Meal Daily Operations Digest — ' || to_char(p_digest_date, 'YYYY-MM-DD')
                 || case when p_preview then ' (preview)' else '' end;
    v_lines := v_lines || (
      'Daily Operations Digest — ' || to_char(p_digest_date, 'YYYY-MM-DD')
      || ' (' || p_timezone || ')');
    v_lines := v_lines || ('Period (UTC): ' || to_char(p_period_start at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
      || ' -> ' || to_char(p_period_end at time zone 'UTC', 'YYYY-MM-DD HH24:MI'));
    v_lines := v_lines || ('Current overall state: '
      || public.operations_alerts_state_label(v_overall, 'en'));
    v_lines := v_lines || ''::text;
    v_lines := v_lines || 'Critical systems:'::text;
    if jsonb_array_length(v_critical_systems) = 0 then
      v_lines := v_lines || '- health source currently unavailable.'::text;
    else
      for r in select * from jsonb_array_elements(v_critical_systems) as x(sys) loop
        v_lines := v_lines || ('- ' || (r.sys ->> 'id') || ': '
          || public.operations_alerts_state_label(r.sys ->> 'state', 'en'));
      end loop;
    end if;
    v_lines := v_lines || ''::text;
    v_lines := v_lines || 'Alerts:'::text;
    v_lines := v_lines || ('- Opened during the period: ' || n_opened::text);
    v_lines := v_lines || ('- Recovered during the period: ' || n_recovered::text);
    v_lines := v_lines || ('- Still open: ' || n_open::text
      || ' (critical: ' || n_open_critical::text || ', warning: ' || n_open_warning::text || ')');
    if n_baseline > 0 then
      v_lines := v_lines || ('- Baseline conditions observed: ' || n_baseline::text);
    end if;
    if n_opened = 0 and n_recovered = 0 and n_open = 0 then
      v_lines := v_lines || '- No incidents in this period.'::text;
    end if;
    v_lines := v_lines || ''::text;
    v_lines := v_lines || 'Top recurring conditions:'::text;
    if jsonb_array_length(v_top) = 0 then
      v_lines := v_lines || '- none.'::text;
    else
      for r in select * from jsonb_array_elements(v_top) as x(item) loop
        v_lines := v_lines || ('- ' || (r.item ->> 'subsystem') || ' / '
          || (r.item ->> 'condition_code') || ' x ' || (r.item ->> 'occurrences'));
      end loop;
    end if;
    v_lines := v_lines || ''::text;
    v_lines := v_lines || 'Optional integrations (informational states):'::text;
    if jsonb_array_length(v_optional_systems) = 0 then
      v_lines := v_lines || '- health source currently unavailable.'::text;
    else
      for r in select * from jsonb_array_elements(v_optional_systems) as x(sys) loop
        v_lines := v_lines || ('- ' || (r.sys ->> 'id') || ': '
          || public.operations_alerts_state_label(r.sys ->> 'state', 'en'));
      end loop;
    end if;
    v_lines := v_lines || ''::text;
    v_lines := v_lines || ('Generated at ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
      || case when p_preview then ' — live preview, not stored' else '' end);
    v_lines := v_lines || 'External delivery is disabled in this version.'::text;
  end if;

  v_body := array_to_string(v_lines, e'\n');

  return jsonb_build_object(
    'digest_date', p_digest_date,
    'language', p_language,
    'timezone', p_timezone,
    'scope', 'daily',
    'preview', p_preview,
    'period_start_utc', p_period_start,
    'period_end_utc', p_period_end,
    'overall_state', v_overall,
    'opened_count', n_opened,
    'baseline_observed_count', n_baseline,
    'recovered_count', n_recovered,
    'unresolved_count', n_open,
    'critical_open_count', n_open_critical,
    'warning_open_count', n_open_warning,
    'content', jsonb_build_object(
      'critical_systems', v_critical_systems,
      'optional_systems', v_optional_systems,
      'opened', v_opened,
      'recovered', v_recovered,
      'still_open', v_still_open,
      'top_recurring', v_top,
      'no_incidents', (n_opened = 0 and n_recovered = 0 and n_open = 0)),
    'rendered_subject', v_subject,
    'rendered_body', v_body);
end;
$$;

revoke all on function public.operations_digest_build(text, timestamptz, timestamptz, date, text, boolean)
  from public, anon, authenticated;
grant execute on function public.operations_digest_build(text, timestamptz, timestamptz, date, text, boolean)
  to service_role;

-- 5c. Digest generator — service-role only. Covers the PREVIOUS full local day
--     in the configured timezone; at most one stored digest per
--     (scope, local day, language). p_as_of is a service-role test/backfill
--     hook only (defaults to now()).
create or replace function public.operations_digest_generate(p_as_of timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c_lock_key constant bigint := 829134603;
  v_run_id bigint;
  v_settings public.operations_alert_settings%rowtype;
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_local_now timestamp;
  v_digest_date date;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_lang text;
  v_built jsonb;
  v_digest_id uuid;
  v_generated text[] := array[]::text[];
  v_skipped text[] := array[]::text[];
begin
  insert into public.operations_alert_runs (kind, status)
  values ('digest', 'running')
  returning id into v_run_id;

  if not pg_try_advisory_xact_lock(c_lock_key) then
    update public.operations_alert_runs
       set status = 'skipped', skip_reason = 'overlap_skipped', finished_at = now()
     where id = v_run_id;
    return jsonb_build_object('status', 'skipped', 'reason', 'overlap_skipped');
  end if;

  select * into v_settings
  from public.operations_alert_settings
  where id
  for update;
  if not found then
    update public.operations_alert_runs
       set status = 'skipped', skip_reason = 'settings_missing', finished_at = now()
     where id = v_run_id;
    return jsonb_build_object('status', 'skipped', 'reason', 'settings_missing');
  end if;

  if not v_settings.digest_generation_enabled then
    update public.operations_alert_runs
       set status = 'skipped', skip_reason = 'digest_disabled', finished_at = now()
     where id = v_run_id;
    return jsonb_build_object('status', 'disabled', 'reason', 'digest_disabled');
  end if;

  begin
    -- Local-calendar boundary math, fail-closed on an invalid timezone.
    begin
      v_local_now := v_as_of at time zone v_settings.timezone;
      v_digest_date := v_local_now::date - 1;
      v_period_start := v_digest_date::timestamp at time zone v_settings.timezone;
      v_period_end := (v_digest_date + 1)::timestamp at time zone v_settings.timezone;
    exception when others then
      update public.operations_alert_runs
         set status = 'failed', safe_error_code = 'invalid_timezone', finished_at = now()
       where id = v_run_id;
      return jsonb_build_object('status', 'failed', 'safe_error_code', 'invalid_timezone');
    end;

    -- Honor the configured local send time: the future activation cron is
    -- hourly, so a firing earlier in the local day than digest_local_time
    -- must wait — otherwise the day's digest would be permanently generated
    -- (and, once delivery exists, sent) hours early.
    if v_local_now::time < v_settings.digest_local_time then
      update public.operations_alert_runs
         set status = 'skipped', skip_reason = 'before_digest_time', finished_at = now()
       where id = v_run_id;
      return jsonb_build_object('status', 'skipped', 'reason', 'before_digest_time');
    end if;

    foreach v_lang in array array['en', 'ar'] loop
      if exists (
        select 1 from public.operations_digest_runs d
        where d.scope = 'daily' and d.digest_date = v_digest_date and d.language = v_lang
      ) then
        v_skipped := v_skipped || v_lang;
        continue;
      end if;

      v_built := public.operations_digest_build(
        v_lang, v_period_start, v_period_end, v_digest_date,
        v_settings.timezone, false);

      v_digest_id := null;
      insert into public.operations_digest_runs
        (scope, digest_date, language, timezone,
         period_start_utc, period_end_utc, overall_state,
         opened_count, recovered_count, unresolved_count,
         critical_open_count, warning_open_count,
         content, rendered_subject, rendered_body)
      values
        ('daily', v_digest_date, v_lang, v_settings.timezone,
         v_period_start, v_period_end, v_built ->> 'overall_state',
         coalesce((v_built ->> 'opened_count')::integer, 0),
         coalesce((v_built ->> 'recovered_count')::integer, 0),
         coalesce((v_built ->> 'unresolved_count')::integer, 0),
         coalesce((v_built ->> 'critical_open_count')::integer, 0),
         coalesce((v_built ->> 'warning_open_count')::integer, 0),
         coalesce(v_built -> 'content', '{}'::jsonb),
         coalesce(v_built ->> 'rendered_subject', ''),
         coalesce(v_built ->> 'rendered_body', ''))
      on conflict on constraint operations_digest_runs_one_per_day do nothing
      returning id into v_digest_id;

      if v_digest_id is not null then
        insert into public.operations_alert_outbox
          (idempotency_key, digest_run_id, channel, language,
           subject_safe, body_safe, template_data, status, blocked_reason)
        values
          ('digest:daily:' || v_digest_date::text || ':' || v_lang || ':in_app',
           v_digest_id, 'in_app', v_lang,
           coalesce(v_built ->> 'rendered_subject', ''),
           coalesce(v_built ->> 'rendered_body', ''),
           jsonb_build_object('digest_date', v_digest_date, 'language', v_lang),
           'recorded', null)
        on conflict (idempotency_key) do nothing;
        v_generated := v_generated || v_lang;
      else
        v_skipped := v_skipped || v_lang;
      end if;
    end loop;

    update public.operations_alert_runs
       set status = 'success', finished_at = now(),
           counts = jsonb_build_object(
             'digest_date', v_digest_date,
             'generated', to_jsonb(v_generated),
             'skipped', to_jsonb(v_skipped))
     where id = v_run_id;

    return jsonb_build_object(
      'status', 'ok',
      'digest_date', v_digest_date,
      'period_start_utc', v_period_start,
      'period_end_utc', v_period_end,
      'generated', to_jsonb(v_generated),
      'skipped', to_jsonb(v_skipped));

  exception when others then
    update public.operations_alert_runs
       set status = 'failed', safe_error_code = sqlstate, finished_at = now()
     where id = v_run_id;
    return jsonb_build_object('status', 'failed', 'safe_error_code', sqlstate);
  end;
end;
$$;

revoke all on function public.operations_digest_generate(timestamptz)
  from public, anon, authenticated;
grant execute on function public.operations_digest_generate(timestamptz) to service_role;

comment on function public.operations_digest_generate(timestamptz) is
  'Service-role daily digest generator (previous full local day in the configured timezone; at most one stored digest per scope/day/language). Dormant by default (digest_generation_enabled=false); records an in-app outbox row only — no external delivery exists in this version.';

-- 5d. Staff-safe read-only digest preview (current local day so far).
--     STABLE: the function is structurally incapable of inserting rows,
--     enqueueing outbox messages, mutating settings or alert state.
create or replace function public.operations_digest_preview(p_language text default 'en')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings public.operations_alert_settings%rowtype;
  v_tz text := 'Asia/Riyadh';
  v_digest_date date;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  if not public.is_staff() then
    raise exception 'Only staff may preview the operations digest'
      using errcode = '42501';
  end if;
  if p_language not in ('en', 'ar') then
    raise exception 'unsupported digest language' using errcode = 'P0001';
  end if;

  select * into v_settings from public.operations_alert_settings where id;
  if found then
    v_tz := v_settings.timezone;
  end if;

  begin
    v_digest_date := (now() at time zone v_tz)::date;
    v_period_start := v_digest_date::timestamp at time zone v_tz;
    v_period_end := greatest(now(), v_period_start + interval '1 second');
  exception when others then
    raise exception 'invalid digest timezone' using errcode = 'P0001';
  end;

  return public.operations_digest_build(
    p_language, v_period_start, v_period_end, v_digest_date, v_tz, true);
end;
$$;

revoke all on function public.operations_digest_preview(text) from public, anon;
grant execute on function public.operations_digest_preview(text) to authenticated;

comment on function public.operations_digest_preview(text) is
  'Staff-gated, read-only digest preview for the current local day so far. Inserts nothing, enqueues nothing, mutates nothing and sends nothing.';

-- ----------------------------------------------------------------------------
-- 6. Staff read RPCs + admin settings RPCs.
-- ----------------------------------------------------------------------------

-- 6a. Safe settings projection (no secrets exist in this table; updated_by is
--     stripped from the client payload anyway).
create or replace function public.operations_alert_settings_safe(p public.operations_alert_settings)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select to_jsonb(p) - 'updated_by';
$$;

revoke all on function public.operations_alert_settings_safe(public.operations_alert_settings)
  from public, anon, authenticated;
grant execute on function public.operations_alert_settings_safe(public.operations_alert_settings)
  to service_role;

-- 6b. Alerts summary (capability-probe target for the Admin UI).
create or replace function public.operations_alerts_admin_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings public.operations_alert_settings%rowtype;
  v_last_eval jsonb;
  v_last_digest jsonb;
begin
  if not public.is_staff() then
    raise exception 'Only staff may view operations alerts'
      using errcode = '42501';
  end if;

  select * into v_settings from public.operations_alert_settings where id;

  select to_jsonb(r) - 'id' into v_last_eval
  from (
    select kind, started_at, finished_at, status, skip_reason, safe_error_code, counts
    from public.operations_alert_runs
    where kind = 'evaluate'
    order by started_at desc
    limit 1
  ) r;

  select jsonb_build_object(
           'digest_date', d.digest_date,
           'generated_at', max(d.generated_at),
           'languages', jsonb_agg(d.language order by d.language))
    into v_last_digest
  from public.operations_digest_runs d
  where d.digest_date = (select max(digest_date) from public.operations_digest_runs)
  group by d.digest_date;

  return jsonb_build_object(
    'generated_at', now(),
    'open_critical_count',
      (select count(*) from public.operations_alert_state
        where status = 'open' and severity = 'critical'),
    'open_warning_count',
      (select count(*) from public.operations_alert_state
        where status = 'open' and severity = 'warning'),
    'open_total',
      (select count(*) from public.operations_alert_state where status = 'open'),
    'open_baseline_count',
      (select count(*) from public.operations_alert_state
        where status = 'open' and baseline),
    'recovered_last_24h',
      (select count(*) from public.operations_alert_state
        where status = 'recovered' and recovered_at >= now() - interval '24 hours'),
    'last_evaluation', v_last_eval,
    'last_digest', v_last_digest,
    'alert_evaluation_enabled', coalesce(v_settings.alert_evaluation_enabled, false),
    'digest_generation_enabled', coalesce(v_settings.digest_generation_enabled, false),
    'external_dispatch_enabled', coalesce(v_settings.external_dispatch_enabled, false));
end;
$$;

revoke all on function public.operations_alerts_admin_summary() from public, anon;
grant execute on function public.operations_alerts_admin_summary() to authenticated;

comment on function public.operations_alerts_admin_summary() is
  'Staff-gated alerts overview for the Admin Dashboard (safe counters + latest run/digest metadata only). Also the capability-probe target for the Operations Alerts tab.';

-- 6c. Filterable alert inbox.
create or replace function public.operations_alerts_list(
  p_status text default 'open',
  p_severity text default null,
  p_subsystem text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text := coalesce(nullif(p_status, ''), 'open');
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  if not public.is_staff() then
    raise exception 'Only staff may view operations alerts'
      using errcode = '42501';
  end if;
  if v_status not in ('open', 'recovered', 'all') then
    raise exception 'invalid status filter' using errcode = 'P0001';
  end if;
  if p_severity is not null and p_severity not in ('warning', 'critical') then
    raise exception 'invalid severity filter' using errcode = 'P0001';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(s) order by
             case when s.status = 'open' then 0 else 1 end,
             case when s.severity = 'critical' then 0 else 1 end,
             s.last_seen_at desc)
    from (
      select id, fingerprint, subsystem, condition_code, severity, status,
             generation, baseline, first_seen_at, last_seen_at,
             occurrence_count, last_notified_at, last_reminder_at,
             recovered_at, safe_evidence
      from public.operations_alert_state
      where (v_status = 'all' or status = v_status)
        and (p_severity is null or severity = p_severity)
        and (p_subsystem is null or subsystem = p_subsystem)
      order by
        case when status = 'open' then 0 else 1 end,
        case when severity = 'critical' then 0 else 1 end,
        last_seen_at desc
      limit v_limit
    ) s
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.operations_alerts_list(text, text, text, integer)
  from public, anon;
grant execute on function public.operations_alerts_list(text, text, text, integer)
  to authenticated;

-- 6d. Alert detail timeline.
create or replace function public.operations_alert_timeline(p_alert_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_alert jsonb;
begin
  if not public.is_staff() then
    raise exception 'Only staff may view operations alerts'
      using errcode = '42501';
  end if;

  select to_jsonb(s) into v_alert
  from (
    select id, fingerprint, subsystem, condition_code, severity, status,
           generation, baseline, first_seen_at, last_seen_at,
           occurrence_count, last_notified_at, last_reminder_at,
           recovered_at, safe_evidence, created_at
    from public.operations_alert_state
    where id = p_alert_id
  ) s;
  if v_alert is null then
    raise exception 'alert not found' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'alert', v_alert,
    'events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at)
      from (
        select id, event_type, severity, notification_suppressed,
               safe_evidence, created_at
        from public.operations_alert_events
        where alert_id = p_alert_id
        order by created_at
        limit 200
      ) e
    ), '[]'::jsonb));
end;
$$;

revoke all on function public.operations_alert_timeline(uuid) from public, anon;
grant execute on function public.operations_alert_timeline(uuid) to authenticated;

-- 6e. Generated digest history.
create or replace function public.operations_digest_list(p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 90));
begin
  if not public.is_staff() then
    raise exception 'Only staff may view operations digests'
      using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(d) order by d.digest_date desc, d.language)
    from (
      select id, scope, digest_date, language, timezone,
             period_start_utc, period_end_utc, overall_state,
             opened_count, recovered_count, unresolved_count,
             critical_open_count, warning_open_count,
             content, rendered_subject, rendered_body, generated_at
      from public.operations_digest_runs
      order by digest_date desc, language
      limit v_limit
    ) d
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.operations_digest_list(integer) from public, anon;
grant execute on function public.operations_digest_list(integer) to authenticated;

-- 6f. Settings: staff view.
create or replace function public.operations_alert_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings public.operations_alert_settings%rowtype;
  v_last_eval jsonb;
  v_last_digest_run jsonb;
begin
  if not public.is_staff() then
    raise exception 'Only staff may view alert settings'
      using errcode = '42501';
  end if;

  select * into v_settings from public.operations_alert_settings where id;
  if not found then
    raise exception 'alert settings row missing' using errcode = 'P0001';
  end if;

  select to_jsonb(r) into v_last_eval
  from (
    select started_at, finished_at, status, skip_reason, safe_error_code, counts
    from public.operations_alert_runs where kind = 'evaluate'
    order by started_at desc limit 1
  ) r;
  select to_jsonb(r) into v_last_digest_run
  from (
    select started_at, finished_at, status, skip_reason, safe_error_code, counts
    from public.operations_alert_runs where kind = 'digest'
    order by started_at desc limit 1
  ) r;

  return jsonb_build_object(
    'settings', public.operations_alert_settings_safe(v_settings),
    'last_evaluation_run', v_last_eval,
    'last_digest_run', v_last_digest_run);
end;
$$;

revoke all on function public.operations_alert_settings_get() from public, anon;
grant execute on function public.operations_alert_settings_get() to authenticated;

-- 6g. Settings: admin-only update via a strict whitelist patch.
--     external_dispatch_enabled=true is HARD-REJECTED in this version: no
--     admin toggle, no API path, no dispatcher — enabling external delivery
--     requires a future separately approved feature.
create or replace function public.operations_alert_settings_update(p_patch jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_s public.operations_alert_settings%rowtype;
  v_key text;
  v_val jsonb;
  v_int integer;
  v_txt text;
begin
  if not public.is_admin() then
    raise exception 'Only admins may change alert settings'
      using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'settings patch must be a JSON object' using errcode = 'P0001';
  end if;

  select * into v_s from public.operations_alert_settings where id for update;
  if not found then
    raise exception 'alert settings row missing' using errcode = 'P0001';
  end if;

  for v_key, v_val in select key, value from jsonb_each(p_patch) loop
    case v_key
      when 'alert_evaluation_enabled' then
        if jsonb_typeof(v_val) <> 'boolean' then
          raise exception 'alert_evaluation_enabled must be a boolean' using errcode = 'P0001';
        end if;
        v_s.alert_evaluation_enabled := (v_val #>> '{}')::boolean;
      when 'digest_generation_enabled' then
        if jsonb_typeof(v_val) <> 'boolean' then
          raise exception 'digest_generation_enabled must be a boolean' using errcode = 'P0001';
        end if;
        v_s.digest_generation_enabled := (v_val #>> '{}')::boolean;
      when 'external_dispatch_enabled' then
        if jsonb_typeof(v_val) <> 'boolean' then
          raise exception 'external_dispatch_enabled must be a boolean' using errcode = 'P0001';
        end if;
        if (v_val #>> '{}')::boolean then
          raise exception 'external dispatch cannot be enabled in this version'
            using errcode = 'P0001';
        end if;
        v_s.external_dispatch_enabled := false;
      when 'timezone' then
        if jsonb_typeof(v_val) <> 'string' then
          raise exception 'timezone must be a string' using errcode = 'P0001';
        end if;
        v_txt := v_val #>> '{}';
        begin
          perform now() at time zone v_txt;
        exception when others then
          raise exception 'invalid timezone' using errcode = 'P0001';
        end;
        v_s.timezone := v_txt;
      when 'digest_local_time' then
        if jsonb_typeof(v_val) <> 'string' then
          raise exception 'digest_local_time must be a string (HH:MM)' using errcode = 'P0001';
        end if;
        begin
          v_s.digest_local_time := (v_val #>> '{}')::time;
        exception when others then
          raise exception 'invalid digest_local_time' using errcode = 'P0001';
        end;
      when 'warning_reminder_minutes' then
        if jsonb_typeof(v_val) <> 'number' then
          raise exception 'warning_reminder_minutes must be a number' using errcode = 'P0001';
        end if;
        v_int := (v_val #>> '{}')::numeric::integer;
        if v_int < 5 or v_int > 10080 then
          raise exception 'warning_reminder_minutes out of range (5..10080)' using errcode = 'P0001';
        end if;
        v_s.warning_reminder_minutes := v_int;
      when 'critical_reminder_minutes' then
        if jsonb_typeof(v_val) <> 'number' then
          raise exception 'critical_reminder_minutes must be a number' using errcode = 'P0001';
        end if;
        v_int := (v_val #>> '{}')::numeric::integer;
        if v_int < 5 or v_int > 10080 then
          raise exception 'critical_reminder_minutes out of range (5..10080)' using errcode = 'P0001';
        end if;
        v_s.critical_reminder_minutes := v_int;
      when 'recovery_notifications_enabled' then
        if jsonb_typeof(v_val) <> 'boolean' then
          raise exception 'recovery_notifications_enabled must be a boolean' using errcode = 'P0001';
        end if;
        v_s.recovery_notifications_enabled := (v_val #>> '{}')::boolean;
      when 'optional_system_alerts_enabled' then
        if jsonb_typeof(v_val) <> 'boolean' then
          raise exception 'optional_system_alerts_enabled must be a boolean' using errcode = 'P0001';
        end if;
        v_s.optional_system_alerts_enabled := (v_val #>> '{}')::boolean;
      when 'system_rule_overrides' then
        if jsonb_typeof(v_val) <> 'object' then
          raise exception 'system_rule_overrides must be an object' using errcode = 'P0001';
        end if;
        if length(v_val::text) > 4000 then
          raise exception 'system_rule_overrides too large' using errcode = 'P0001';
        end if;
        v_s.system_rule_overrides := v_val;
      else
        raise exception 'unknown settings key: %', left(v_key, 64) using errcode = 'P0001';
    end case;
  end loop;

  update public.operations_alert_settings
     set alert_evaluation_enabled = v_s.alert_evaluation_enabled,
         digest_generation_enabled = v_s.digest_generation_enabled,
         external_dispatch_enabled = false,  -- structurally dormant in v1
         timezone = v_s.timezone,
         digest_local_time = v_s.digest_local_time,
         warning_reminder_minutes = v_s.warning_reminder_minutes,
         critical_reminder_minutes = v_s.critical_reminder_minutes,
         recovery_notifications_enabled = v_s.recovery_notifications_enabled,
         optional_system_alerts_enabled = v_s.optional_system_alerts_enabled,
         system_rule_overrides = v_s.system_rule_overrides,
         updated_by = (select id from public.profiles where id = auth.uid())
   where id;

  select * into v_s from public.operations_alert_settings where id;
  return public.operations_alert_settings_safe(v_s);
end;
$$;

revoke all on function public.operations_alert_settings_update(jsonb) from public, anon;
grant execute on function public.operations_alert_settings_update(jsonb) to authenticated;

comment on function public.operations_alert_settings_update(jsonb) is
  'Admin-only, whitelist-validated update of the dormant alert/digest settings. Hard-rejects enabling external dispatch in this version.';
