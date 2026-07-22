-- ============================================================================
-- Spicy Meal — Operations Health Center v1 (read-only observability).
--
-- Adds a staff-gated aggregate RPC for the Admin Dashboard. It composes the
-- existing authoritative Lazywait and Order Integrity health summaries with
-- safe database/cron aggregates for account deletion, payments, push, email
-- and OTP.
--
-- OBSERVABILITY ONLY:
--   * reads operational metadata and aggregate counts
--   * never calls an external provider
--   * never creates/updates/cancels/refunds/resends an order or payment
--   * never enables an integration or sends a notification
--   * never returns secret_config, raw provider payloads, tokens or customer PII
--   * isolates subsystem failures so one unavailable source cannot crash the page
-- ============================================================================

create or replace function public.operations_health_overall_state(
  p_lazywait text,
  p_order_integrity text,
  p_account_deletion text,
  p_database_jobs text
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when 'configuration_error' = any(array[
      p_lazywait, p_order_integrity, p_account_deletion, p_database_jobs
    ]) then 'configuration_error'
    when 'failing' = any(array[
      p_lazywait, p_order_integrity, p_account_deletion, p_database_jobs
    ]) then 'failing'
    when exists (
      select 1
      from unnest(array[
        p_lazywait, p_order_integrity, p_account_deletion, p_database_jobs
      ]) s(state)
      where state in ('degraded', 'unavailable')
    ) then 'degraded'
    else 'healthy'
  end;
$$;

revoke all on function public.operations_health_overall_state(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.operations_health_overall_state(text, text, text, text)
  to service_role;

comment on function public.operations_health_overall_state(text, text, text, text) is
  'Deterministic Operations Health Center state precedence for the four critical monitored subsystems.';

create or replace function public.operations_health_summary()
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
  if not public.is_staff() then
    raise exception 'Only staff may view operations health'
      using errcode = '42501';
  end if;

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
          when ls.end_time is null then 'degraded'
          when now() - ls.end_time > interval '6 minutes' then 'failing'
          -- Only a recent TERMINAL non-success (e.g. `failed`) fails the job. A
          -- newer terminal success clears an older terminal failure because lt is
          -- the most recently completed run.
          when lt.status is not null and lt.status <> 'succeeded'
               and lt.end_time >= now() - interval '6 minutes' then 'failing'
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

revoke all on function public.operations_health_summary() from public, anon;
grant execute on function public.operations_health_summary() to authenticated;

comment on function public.operations_health_summary() is
  'Staff-gated, read-only Operations Health Center aggregate. Composes authoritative health RPCs and safe operational counts; returns no PII, secrets, raw provider payloads, tokens, cron commands or external provider probe results.';
