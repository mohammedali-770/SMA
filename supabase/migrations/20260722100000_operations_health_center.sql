-- ============================================================================
-- Spicy Meal — Operations Health Center v1 (read-only observability).
--
-- Adds a single staff-gated aggregate RPC for the Admin Dashboard. It composes
-- existing authoritative Lazywait and Order Integrity health summaries with safe
-- database/cron aggregates for account deletion, payments, push, email and OTP.
--
-- OBSERVABILITY ONLY:
--   * reads operational metadata and aggregate counts
--   * never calls an external provider
--   * never creates/updates/cancels/refunds/resends an order or payment
--   * never enables an integration or sends a notification
--   * never returns secret_config, raw provider payloads, tokens or customer PII
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
  v_database_jobs_state text := 'healthy';

  v_ad_jobid bigint;
  v_ad_active boolean := false;
  v_ad_latest_status text;
  v_ad_latest_run_at timestamptz;
  v_ad_latest_success_at timestamptz;
  v_ad_due_count integer := 0;
  v_ad_manual_review integer := 0;
  v_ad_oldest_due timestamptz;
  v_ad_counts jsonb := '{}'::jsonb;
  v_ad_state text := 'idle';

  v_payment_enabled boolean := false;
  v_payment_configured boolean := false;
  v_payment_provider text;
  v_payment_mode text;
  v_payment_currency text;
  v_payment_updated_at timestamptz;
  v_payment_counts_24h jsonb := '{}'::jsonb;
  v_payment_stale_initiated integer := 0;
  v_payment_oldest_stale timestamptz;
  v_payment_latest_paid timestamptz;
  v_payment_integrity_critical integer := 0;
  v_payment_state text := 'disabled';

  v_push_enabled boolean := false;
  v_push_configured boolean := false;
  v_push_provider text;
  v_push_updated_at timestamptz;
  v_push_active_devices integer := 0;
  v_push_promos_opt_in integer := 0;
  v_push_log_counts jsonb := '{}'::jsonb;
  v_push_failed_24h integer := 0;
  v_push_latest_log timestamptz;
  v_push_state text := 'disabled';

  v_email_enabled boolean := false;
  v_email_configured boolean := false;
  v_email_provider text;
  v_email_updated_at timestamptz;
  v_email_state text := 'disabled';

  v_otp_enabled boolean := false;
  v_otp_configured boolean := false;
  v_otp_provider text;
  v_otp_updated_at timestamptz;
  v_otp_state text := 'disabled';

  v_systems jsonb := '[]'::jsonb;
  v_attention jsonb := '[]'::jsonb;
  v_overall_state text := 'healthy';
  v_critical_attention integer := 0;
  v_warning_attention integer := 0;
  v_unavailable integer := 0;
  v_disabled integer := 0;
  v_not_configured integer := 0;
begin
  if not public.is_staff() then
    raise exception 'Only staff may view operations health'
      using errcode = '42501';
  end if;

  begin
    execute 'select public.lazywait_sync_health_summary()' into v_lazywait;
    v_lazywait_state := coalesce(v_lazywait->>'overall_state', 'unavailable');
  exception when others then
    v_lazywait := jsonb_build_object('overall_state', 'unavailable', 'safe_error_code', sqlstate);
    v_lazywait_state := 'unavailable';
  end;

  begin
    execute 'select public.order_integrity_health_summary()' into v_order_integrity;
    v_integrity_state := coalesce(v_order_integrity->>'overall_state', 'unavailable');
  exception when others then
    v_order_integrity := jsonb_build_object('overall_state', 'unavailable', 'safe_error_code', sqlstate);
    v_integrity_state := 'unavailable';
  end;

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
      lr.status as latest_status, lr.start_time as latest_run_at,
      lr.end_time as latest_completed_at, ls.end_time as latest_success_at,
      case
        when j.jobid is null or not coalesce(j.active, false) then 'failing'
        when ls.end_time is null then 'degraded'
        when now() - ls.end_time > interval '6 minutes' then 'failing'
        when lr.status is not null and lr.status <> 'succeeded'
             and lr.start_time >= now() - interval '6 minutes' then 'failing'
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
      select r.end_time
      from cron.job_run_details r
      where r.jobid = j.jobid and r.status = 'succeeded'
      order by r.end_time desc nulls last
      limit 1
    ) ls on true
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'job_name', jobname, 'subsystem', subsystem, 'critical', is_critical,
      'job_id', jobid, 'schedule', schedule, 'expected_schedule', expected_schedule,
      'active', active, 'state', state, 'latest_status', latest_status,
      'latest_run_at', latest_run_at, 'latest_completed_at', latest_completed_at,
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

  select j.jobid, coalesce(j.active, false)
    into v_ad_jobid, v_ad_active
  from cron.job j
  where j.jobname = 'account-deletion-processor'
  limit 1;

  if v_ad_jobid is not null then
    select r.status, r.start_time
      into v_ad_latest_status, v_ad_latest_run_at
    from cron.job_run_details r
    where r.jobid = v_ad_jobid
    order by r.start_time desc
    limit 1;

    select r.end_time
      into v_ad_latest_success_at
    from cron.job_run_details r
    where r.jobid = v_ad_jobid and r.status = 'succeeded'
    order by r.end_time desc nulls last
    limit 1;
  end if;

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
  from (select status, count(*)::integer as cnt from public.account_deletion_requests group by status) s;

  v_ad_state := case
    when v_ad_jobid is null or not v_ad_active then 'failing'
    when v_ad_latest_success_at is null or now() - v_ad_latest_success_at > interval '6 minutes' then 'failing'
    when v_ad_latest_status is not null and v_ad_latest_status <> 'succeeded'
      and v_ad_latest_run_at >= now() - interval '6 minutes' then 'failing'
    when v_ad_manual_review > 0 then 'degraded'
    when v_ad_due_count > 0 and v_ad_oldest_due < now() - interval '10 minutes' then 'degraded'
    when v_ad_due_count = 0 then 'idle'
    else 'healthy'
  end;

  select enabled,
    (provider_name is not null and secret_config is not null and secret_config <> '{}'::jsonb),
    provider_name, nullif(public_config->>'mode',''), nullif(public_config->>'currency',''), updated_at
  into v_payment_enabled, v_payment_configured, v_payment_provider,
    v_payment_mode, v_payment_currency, v_payment_updated_at
  from public.integration_settings where provider_type = 'payment'
  order by updated_at desc limit 1;

  v_payment_enabled := coalesce(v_payment_enabled, false);
  v_payment_configured := coalesce(v_payment_configured, false);

  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
    into v_payment_counts_24h
  from (select status, count(*)::integer cnt from public.payment_records
    where created_at >= now() - interval '24 hours' group by status) s;

  select count(*)::integer, min(coalesce(initiated_at, created_at))
    into v_payment_stale_initiated, v_payment_oldest_stale
  from public.payment_records
  where status = 'initiated' and created_at >= now() - interval '24 hours'
    and coalesce(initiated_at, created_at) < now() - interval '30 minutes';

  select max(coalesce(confirmed_at, updated_at)) into v_payment_latest_paid
  from public.payment_records where status = 'paid';

  select count(*)::integer into v_payment_integrity_critical
  from public.order_integrity_incidents
  where status <> 'resolved' and severity = 'critical'
    and rule_code in ('PAID_ORDER_AWAITING_PAYMENT','CAPTURED_PAYMENT_WITHOUT_ORDER',
      'PAYMENT_AMOUNT_MISMATCH','DUPLICATE_PROVIDER_REFERENCE','MULTIPLE_SUCCESSFUL_CAPTURES');

  v_payment_state := case
    when not v_payment_enabled then 'disabled'
    when not v_payment_configured then 'not_configured'
    when v_payment_integrity_critical > 0 then 'failing'
    when v_payment_stale_initiated > 0 then 'degraded'
    else 'not_monitored'
  end;

  select enabled,
    (provider_name is not null and secret_config is not null and secret_config <> '{}'::jsonb),
    provider_name, updated_at
  into v_push_enabled, v_push_configured, v_push_provider, v_push_updated_at
  from public.integration_settings where provider_type = 'push'
  order by updated_at desc limit 1;

  v_push_enabled := coalesce(v_push_enabled, false);
  v_push_configured := coalesce(v_push_configured, false);

  select count(*) filter (where is_active)::integer,
    count(*) filter (where is_active and promos_enabled)::integer
  into v_push_active_devices, v_push_promos_opt_in from public.push_devices;

  select coalesce(jsonb_object_agg(send_status, cnt), '{}'::jsonb),
    coalesce(sum(cnt) filter (where send_status = 'failed'), 0)::integer
  into v_push_log_counts, v_push_failed_24h
  from (select send_status, count(*)::integer cnt from public.notification_log
    where created_at >= now() - interval '24 hours' group by send_status) s;

  select max(created_at) into v_push_latest_log from public.notification_log;

  v_push_state := case
    when not v_push_enabled then 'disabled'
    when not v_push_configured then 'not_configured'
    when v_push_failed_24h > 0 then 'degraded'
    else 'not_monitored'
  end;

  select enabled,
    (provider_name is not null and secret_config is not null and secret_config <> '{}'::jsonb),
    provider_name, updated_at
  into v_email_enabled, v_email_configured, v_email_provider, v_email_updated_at
  from public.integration_settings where provider_type = 'email'
  order by updated_at desc limit 1;

  v_email_enabled := coalesce(v_email_enabled, false);
  v_email_configured := coalesce(v_email_configured, false);
  v_email_state := case when not v_email_enabled then 'disabled'
    when not v_email_configured then 'not_configured' else 'not_monitored' end;

  select enabled,
    (provider_name is not null and secret_config is not null and secret_config <> '{}'::jsonb),
    provider_name, updated_at
  into v_otp_enabled, v_otp_configured, v_otp_provider, v_otp_updated_at
  from public.integration_settings where provider_type in ('whatsapp','sms')
  order by case when provider_type = 'whatsapp' then 0 else 1 end, updated_at desc limit 1;

  v_otp_enabled := coalesce(v_otp_enabled, false);
  v_otp_configured := coalesce(v_otp_configured, false);
  v_otp_state := case when not v_otp_enabled then 'disabled'
    when not v_otp_configured then 'not_configured' else 'not_monitored' end;

  v_systems := jsonb_build_array(
    jsonb_build_object('id','lazywait','critical',true,'state',v_lazywait_state,
      'source','lazywait_sync_health_summary','details',v_lazywait),
    jsonb_build_object('id','order_integrity','critical',true,'state',v_integrity_state,
      'source','order_integrity_health_summary','details',v_order_integrity),
    jsonb_build_object('id','account_deletion','critical',true,'state',v_ad_state,
      'source','cron_and_queue','details',jsonb_build_object(
        'cron_active',v_ad_active,'latest_run_status',v_ad_latest_status,
        'latest_run_at',v_ad_latest_run_at,'latest_success_at',v_ad_latest_success_at,
        'due_count',v_ad_due_count,'manual_review_count',v_ad_manual_review,
        'oldest_due_at',v_ad_oldest_due,'counts_by_status',v_ad_counts)),
    jsonb_build_object('id','payment','critical',false,'state',v_payment_state,
      'source','database_aggregates','details',jsonb_build_object(
        'provider',v_payment_provider,'enabled',v_payment_enabled,'configured',v_payment_configured,
        'mode',v_payment_mode,'currency',v_payment_currency,'settings_updated_at',v_payment_updated_at,
        'counts_24h',v_payment_counts_24h,'stale_initiated_24h',v_payment_stale_initiated,
        'oldest_stale_initiated_at',v_payment_oldest_stale,'latest_paid_at',v_payment_latest_paid,
        'integrity_critical_count',v_payment_integrity_critical,'provider_probe',false)),
    jsonb_build_object('id','push','critical',false,'state',v_push_state,
      'source','configuration_and_send_ledger','details',jsonb_build_object(
        'provider',v_push_provider,'enabled',v_push_enabled,'configured',v_push_configured,
        'settings_updated_at',v_push_updated_at,'active_devices',v_push_active_devices,
        'promotions_opt_in',v_push_promos_opt_in,'send_status_counts_24h',v_push_log_counts,
        'failed_sends_24h',v_push_failed_24h,'latest_log_at',v_push_latest_log,'provider_probe',false)),
    jsonb_build_object('id','email','critical',false,'state',v_email_state,
      'source','configuration_only','details',jsonb_build_object(
        'provider',v_email_provider,'enabled',v_email_enabled,'configured',v_email_configured,
        'settings_updated_at',v_email_updated_at,'provider_probe',false)),
    jsonb_build_object('id','otp','critical',false,'state',v_otp_state,
      'source','configuration_only','details',jsonb_build_object(
        'provider',v_otp_provider,'enabled',v_otp_enabled,'configured',v_otp_configured,
        'settings_updated_at',v_otp_updated_at,'provider_probe',false)),
    jsonb_build_object('id','database_jobs','critical',true,'state',v_database_jobs_state,
      'source','pg_cron','details',jsonb_build_object('expected_jobs',3,'jobs',v_jobs))
  );

  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_attention
  from (values
    (case when v_lazywait_state not in ('healthy','idle') then jsonb_build_object(
      'code','LAZYWAIT_HEALTH_'||upper(v_lazywait_state),'subsystem','lazywait',
      'severity',case when v_lazywait_state in ('failing','configuration_error') then 'critical' else 'warning' end,'count',1) end),
    (case when v_integrity_state not in ('healthy','idle') then jsonb_build_object(
      'code','ORDER_INTEGRITY_'||upper(v_integrity_state),'subsystem','order_integrity',
      'severity',case when v_integrity_state in ('failing','configuration_error') then 'critical' else 'warning' end,
      'count',greatest(coalesce((v_order_integrity->>'open_critical_count')::integer,0),
        coalesce((v_order_integrity->>'open_warning_count')::integer,0),1)) end),
    (case when v_ad_state in ('failing','degraded') then jsonb_build_object(
      'code','ACCOUNT_DELETION_'||upper(v_ad_state),'subsystem','account_deletion',
      'severity',case when v_ad_state='failing' then 'critical' else 'warning' end,
      'count',greatest(v_ad_due_count+v_ad_manual_review,1),'oldest_at',v_ad_oldest_due) end),
    (case when v_payment_integrity_critical > 0 then jsonb_build_object(
      'code','PAYMENT_INTEGRITY_INCIDENTS','subsystem','payment','severity','critical','count',v_payment_integrity_critical) end),
    (case when v_payment_stale_initiated > 0 then jsonb_build_object(
      'code','STALE_PAYMENT_INITIATIONS','subsystem','payment','severity','warning',
      'count',v_payment_stale_initiated,'oldest_at',v_payment_oldest_stale) end),
    (case when v_push_enabled and v_push_failed_24h > 0 then jsonb_build_object(
      'code','PUSH_SEND_FAILURES_24H','subsystem','push','severity','warning','count',v_push_failed_24h) end),
    (case when v_database_jobs_state <> 'healthy' then jsonb_build_object(
      'code','SCHEDULED_JOBS_'||upper(v_database_jobs_state),'subsystem','database_jobs',
      'severity',case when v_database_jobs_state='failing' then 'critical' else 'warning' end,'count',1) end)
  ) a(item) where item is not null;

  select count(*) filter (where e->>'severity'='critical')::integer,
    count(*) filter (where e->>'severity'='warning')::integer
  into v_critical_attention, v_warning_attention from jsonb_array_elements(v_attention) e;

  select count(*) filter (where s->>'state'='unavailable')::integer,
    count(*) filter (where s->>'state'='disabled')::integer,
    count(*) filter (where s->>'state'='not_configured')::integer
  into v_unavailable, v_disabled, v_not_configured from jsonb_array_elements(v_systems) s;

  v_overall_state := public.operations_health_overall_state(
    v_lazywait_state, v_integrity_state, v_ad_state, v_database_jobs_state);

  return jsonb_build_object(
    'generated_at',v_generated_at,'overall_state',v_overall_state,
    'critical_attention_count',coalesce(v_critical_attention,0),
    'warning_attention_count',coalesce(v_warning_attention,0),
    'systems_unavailable_count',coalesce(v_unavailable,0),
    'systems_disabled_count',coalesce(v_disabled,0),
    'systems_not_configured_count',coalesce(v_not_configured,0),
    'critical_systems',jsonb_build_array('lazywait','order_integrity','account_deletion','database_jobs'),
    'systems',v_systems,'jobs',v_jobs,'attention',v_attention
  );
end;
$$;

revoke all on function public.operations_health_summary() from public, anon;
grant execute on function public.operations_health_summary() to authenticated;

comment on function public.operations_health_summary() is
  'Staff-gated, read-only Operations Health Center aggregate. Composes authoritative health RPCs and safe operational counts; returns no PII, secrets, raw provider payloads, tokens, cron commands or external provider probe results.';
