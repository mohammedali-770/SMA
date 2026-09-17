-- 20260925120000_health_card_variant_coverage.sql
--
-- OPERATIONS HEALTH GOES BLIND TO A NEW AVAILABILITY TABLE UNLESS IT IS TOLD.
--
-- `operations_health_snapshot_internal` enumerates the availability tables BY
-- NAME in three places, and `20260923120000` added a fourth table none of them
-- know about:
--
--   1. the closed-item / closed-option counters;
--   2. the `overdue` UNION, which is what detects a timer that ran out and was
--      never honoured -- the only evidence that the sweeper has died, because
--      `branch_availability_sweep` swallows its own errors and RETURNS
--      NORMALLY, so pg_cron records a failed sweep as `succeeded`;
--   3. the `idle` fail-quiet warm-up condition.
--
-- So today a variant snooze could expire, never reopen, and the card would go
-- on reporting `healthy` for as long as nobody happened to look at the tier.
-- No alert, no console signal, nothing.
--
-- THIS IS THE DEFECT CLASS `20260827130000_watchdog_delivery_coverage` EXISTS
-- TO RECORD. Two watchdog rules carried an `order_type = 'pickup'` filter and
-- went blind to failed PAID DELIVERY orders the moment delivery went live. The
-- shape is identical: a monitor that enumerates its subjects by name is correct
-- until the day a subject is added, and then silently wrong.
--
-- WHAT IT DOES
--   * a `closed_sizes` counter, reported beside `closed_products` and
--     `closed_options` -- a SEPARATE key, not folded into options (see the
--     comment at the count itself);
--   * `branch_variant_availability` added to the `overdue` UNION, which is the
--     arm that actually moves the state to `degraded`/`failing`;
--   * closed sizes added to the `idle` warm-up condition, so a database with
--     tiers closed and no sweep recorded is `healthy`, not `idle`;
--   * untimed closures accumulate sizes as they already accumulate products and
--     options;
--   * `closed_sizes` added to the alert `safe_evidence`, so a responder reading
--     a `restores_overdue` alert is not told "0 products, 0 options" while the
--     entire backlog is sizes. Adding a key does NOT change alert identity --
--     the fingerprint is still `branch_availability:health` -- and
--     `operations_alerts_sanitize_evidence` keeps integers, so the value
--     survives the sanitizer (the trap `20260914120000` hit with a jsonb array).
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * no table, column, constraint, policy, grant, cron job or money-path
--     function is touched. `place_order` and `compute_order_snapshot` are not
--     mentioned, let alone redefined;
--   * `operations_alerts_derive` -- the wrapper -- is left alone, exactly as
--     `20260820160000` and `20260914120000` left it;
--   * no new state, severity or fingerprint is introduced. A closed size raises
--     the SAME alert a closed product does, for the same reasons.
--
-- DERIVED, NOT RETYPED. Both bodies come from the only migration that currently
-- defines them, `20260820160000_branch_availability_health_card.sql`, under six
-- anchored substitutions each asserted to match EXACTLY ONCE. The resulting
-- diff is five hunks in the snapshot and one in the alert arm, **+23 and +1
-- lines, ZERO removed**.
--
-- THAT FUNCTION HAS BEEN REDEFINED FIVE TIMES, NOT ONCE, and the working note
-- for this file said once. `20260723090000`, `20260723140000`, `20260807150000`,
-- `20260820150000` and `20260820160000` all define
-- `operations_health_snapshot_internal`; the LAST is the live body and so the
-- right pre-image, which is the same practical answer arrived at for a
-- different reason. Both pre-images were hashed against the LIVE function
-- before a character was substituted and both matched exactly:
--
--   operations_health_snapshot_internal    3f2f145ca1283e5ff8040a0b2b01ce81  46 688 chars
--   operations_alerts_derive_pre_stranded  19177f263090d96500a571a4bf6a1dd4  18 002 chars
--
-- Ledger basis, `md5(pg_get_functiondef(oid))`, which WILL move on apply:
--   operations_health_snapshot_internal    aefe82538f13bc2d6fbf04d3f620506b
--   operations_alerts_derive_pre_stranded  662ee646ea4ea9e89ff64203bcb542ee
--
-- APPLYING IT CHANGES NO REPORTED NUMBER TODAY. `branch_variant_availability`
-- is created empty by `20260923120000` and nothing can write to it until the
-- operator controls ship with the customer build, so every new counter reads 0
-- and the new UNION arm contributes no rows. That is the point: the coverage
-- has to exist BEFORE the first closure, not after the first one is missed.
--
-- NO DEPLOY IMPLIED. Both signatures are unchanged, so existing callers bind to
-- the new bodies.

-- ---- Ordering guard ---------------------------------------------------------
-- Applying this before `20260923120000` would reference a table that does not
-- exist. The snapshot wraps its availability block in `exception when others`,
-- so it would not fail loudly -- it would report the card `unavailable` for
-- ever, which is the quiet failure this whole file exists to prevent.
--
-- It also requires `20260924120000`. That is a judgement rather than a
-- technical need: a card that counts closed sizes while the order path still
-- sells them would be reporting a closure the server does not enforce, which is
-- a worse lie than reporting nothing.
do $$
begin
  if to_regclass('public.branch_variant_availability') is null then
    raise exception 'branch_variant_availability does not exist; apply 20260923120000 first';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'place_order'
       and p.prosrc like '%branch_variant_availability%'
  ) or not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'compute_order_snapshot'
       and p.prosrc like '%branch_variant_availability%'
  ) then
    raise exception 'the order path does not yet refuse a closed size; apply 20260924120000 first';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The health snapshot
-- ---------------------------------------------------------------------------
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
  'Read-only Operations Health snapshot. Since 20260807 it carries an order_flow card in the critical set; since 20260820 the cron allowlist also observes branch-availability-sweep, and a NON-critical branch_availability card reports whether timed closures actually reopen — the sweeper swallows its own errors, so pg_cron cannot see a sweep that runs and fails. Since 20260925 that card also observes branch_variant_availability, so a stuck PRICE TIER counts toward closed_sizes and toward the overdue-restore backlog. Counts only: no branch identity, PII, secrets, raw provider payloads, tokens, cron commands or external provider probe results.';

-- ---------------------------------------------------------------------------
-- 2. The alert condition
-- ---------------------------------------------------------------------------
-- Re-emitted whole because `create or replace` takes no smaller unit. Its ACL
-- is untouched by `create or replace`; the grants below are byte-identical to
-- the ones 20260810113500:39-42 already set, and are repeated only so this file
-- reads correctly on its own. `operations_alerts_derive` -- the wrapper -- is
-- NOT re-emitted, exactly as 20260820160000 and 20260914120000 left it.
create or replace function public.operations_alerts_derive_pre_stranded(
  p_snapshot jsonb,
  p_settings jsonb
)
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

    elsif v_id = 'order_flow' then
      -- Added 20260807. The order-flow card (migration 20260807150000) watches
      -- the business OUTCOME rather than a subsystem, so it is the one card that
      -- can be red while every other card is green. Until this arm existed it had
      -- no fingerprint here at all: the card would read `failing` in the
      -- Operations Health Center and on the sidebar badge while the alerts inbox
      -- stayed completely silent. That is the gap this closes.
      --
      -- `idle` and `healthy` deliberately produce NOTHING. `idle` is the card's
      -- fail-quiet state — no branch open, or fewer than its minimum comparable
      -- weeks of history — and alerting on it would defeat the whole design and
      -- teach people to ignore the alert during its own warm-up.
      --
      -- ONE fingerprint across all three alertable states, matching the
      -- convention documented on this function: a shortfall that worsens into a
      -- full stop ESCALATES the same alert rather than recovering one identity
      -- and opening another.
      if v_state in ('failing', 'degraded', 'unavailable') then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'order_flow:health',
          'subsystem', 'order_flow',
          'condition_code', case v_state
            when 'failing'  then 'flow_stopped'
            when 'degraded' then 'flow_below_baseline'
            else 'unavailable' end,
          'severity', case when v_state = 'failing' then 'critical' else 'warning' end,
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state,
              'orders_in_window', public.operations_alerts_safe_int(v_details, 'orders_in_window'),
              'baseline_orders', v_details -> 'baseline_orders',
              'baseline_samples', public.operations_alerts_safe_int(v_details, 'baseline_samples'),
              'open_branches', public.operations_alerts_safe_int(v_details, 'open_branches'),
              'window_minutes', public.operations_alerts_safe_int(v_details, 'window_minutes'),
              'safe_error_code', v_details ->> 'safe_error_code'))));
      end if;

    elsif v_id = 'branch_availability' then
      -- Added 20260820. The card watches whether closures actually REOPEN, which
      -- the database_jobs card structurally cannot see: branch_availability_sweep
      -- catches its own exceptions and returns normally, so pg_cron records every
      -- failed sweep as `succeeded`.
      --
      -- `idle` and `healthy` produce NOTHING. `idle` is the card's fail-quiet
      -- warm-up — nothing closed anywhere and no sweep recorded yet.
      --
      -- ONE fingerprint across all three alertable states, per this function's
      -- contract: a backlog that grows from overdue to stalled ESCALATES the same
      -- alert instead of recovering one identity and opening another. Severity
      -- follows it up — warning while restores are merely late, critical once
      -- they have plainly stopped.
      --
      -- Not gated behind `optional_system_alerts_enabled`: that flag is for the
      -- CONFIGURATION states of optional integrations, not for a real failure of
      -- an always-on internal mechanism.
      if v_state in ('failing', 'degraded', 'unavailable') then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'fingerprint', 'branch_availability:health',
          'subsystem', 'branch_availability',
          'condition_code', case
            when v_state = 'failing' then 'restores_stalled'
            when v_state = 'unavailable' then 'unavailable'
            when public.operations_alerts_safe_int(v_details, 'overdue_restores') > 0
              then 'restores_overdue'
            else 'sweep_failing' end,
          'severity', case when v_state = 'failing' then 'critical' else 'warning' end,
          'safe_evidence', public.operations_alerts_sanitize_evidence(
            jsonb_build_object('state', v_state,
              'overdue_restores', public.operations_alerts_safe_int(v_details, 'overdue_restores'),
              'worst_overdue_minutes', public.operations_alerts_safe_int(v_details, 'worst_overdue_minutes'),
              'closed_products', public.operations_alerts_safe_int(v_details, 'closed_products'),
              'closed_options', public.operations_alerts_safe_int(v_details, 'closed_options'),
              'closed_sizes', public.operations_alerts_safe_int(v_details, 'closed_sizes'),
              'paused_branches', public.operations_alerts_safe_int(v_details, 'paused_branches'),
              'latest_run_status', v_details ->> 'latest_run_status',
              'safe_error_code', v_details ->> 'safe_error_code'))));
      end if;

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
  -- backend-decided state and its safe explanatory fields. Severity follows the
  -- job's own `critical` flag so the non-critical automation crons stay warning-
  -- level (the three critical application jobs remain critical).
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
        -- A failing CRITICAL job is critical; a failing non-critical automation
        -- cron is a warning. `critical` is a safe boolean carried on every job.
        v_sev := case when public.operations_alerts_safe_bool(v_job, 'critical')
                      then 'critical' else 'warning' end;
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

revoke all on function public.operations_alerts_derive_pre_stranded(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_derive_pre_stranded(jsonb, jsonb)
  to service_role;

comment on function public.operations_alerts_derive_pre_stranded(jsonb, jsonb) is
  'Per-card alert derivation. Holds every subsystem arm; `operations_alerts_derive` wraps this and appends the independent order_integrity:stranded_orders condition (20260810113500). Since 20260820 a branch_availability arm emits branch_availability:health on ONE fingerprint, escalating from restores_overdue/sweep_failing (warning) to restores_stalled (critical) as the restore backlog ages; idle and healthy emit nothing. Since 20260925 its evidence also carries closed_sizes.';

-- ---- Self-verification -------------------------------------------------------
-- Asserts the exact property this file exists for, and the boundaries it must
-- not move.
--
-- CARDINALITY FIRST, then the bodies. Every assertion below reads a body with
-- `select prosrc into`, which with two overloads present takes an ARBITRARY
-- one -- so a stale sibling would be graded instead of the function this file
-- wrote, and which assertion happened to fail would be luck. That ordering
-- defect was found by mutation-testing `20260924120000`'s block, and is fixed
-- here rather than repeated.
--
-- WHERE AN ASSERTION NAMES A TOKEN, IT NAMES A STATEMENT. The same mutation
-- round found that `position('earn_pending' in ...)` was satisfied by a COMMENT
-- two lines above the statement it was meant to pin. A check a comment can
-- satisfy is not a check.
do $$
declare
  v_snap text;
  v_arm  text;
  v_n    integer;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('operations_health_snapshot_internal','operations_alerts_derive_pre_stranded');
  if v_n <> 2 then
    raise exception 'expected exactly one overload of each health function, found %', v_n;
  end if;

  select p.prosrc into v_snap from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_health_snapshot_internal';
  select p.prosrc into v_arm  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_alerts_derive_pre_stranded';

  -- 1. THE OVERDUE UNION ARM. This is the one that closes the blind spot: it is
  --    what moves the card to `degraded`/`failing` when a timer is not honoured.
  --    Asserted as the STATEMENT, so a mention of the table in a comment
  --    elsewhere in the body cannot stand in for it.
  if position('select snoozed_until from public.branch_variant_availability' in v_snap) = 0 then
    raise exception 'the overdue UNION does not observe branch_variant_availability';
  end if;

  -- 2. The counting select, likewise as a statement.
  if position('from public.branch_variant_availability v' in v_snap) = 0 then
    raise exception 'the closed-size counter is missing';
  end if;

  -- 3. The counter reaches the payload AND the idle warm-up. Two distinct
  --    sites, asserted separately: a card that counts sizes but ignores them
  --    when deciding `idle` reports a fail-quiet warm-up over real closures.
  if position('''closed_sizes'',v_ba_closed_sizes' in v_snap) = 0 then
    raise exception 'closed_sizes never reaches the card payload';
  end if;
  if position('and v_ba_closed_sizes = 0' in v_snap) = 0 then
    raise exception 'the idle warm-up condition ignores closed sizes';
  end if;

  -- 4. Untimed closures accumulate sizes rather than overwriting the running
  --    total. `into v_ba_closed_sizes, v_ba_untimed` with a bare `count(*)` on
  --    the right would silently discard the product and option counts.
  if position('v_ba_untimed + count(*) filter (where v.snoozed_until is null)' in v_snap) = 0 then
    raise exception 'untimed closures do not accumulate sizes';
  end if;

  -- 5. The alert evidence carries it, so a responder is not told "0 products,
  --    0 options" while the whole backlog is sizes.
  if position('''closed_sizes'', public.operations_alerts_safe_int(v_details, ''closed_sizes'')' in v_arm) = 0 then
    raise exception 'the branch_availability alert evidence omits closed_sizes';
  end if;

  -- 6. NOTHING THE EARLIER CARDS DO WAS LOST. Re-emitting a stale body is the
  --    one way this file could silently revert somebody else's work, and no
  --    counter would show it. Each of these is a statement from a different
  --    migration's contribution to this function.
  if position('from public.branch_product_availability p' in v_snap) = 0
     or position('from public.branch_modifier_availability m' in v_snap) = 0 then
    raise exception 'the product or option counter (20260820160000) was lost';
  end if;
  if position('v_of_state' in v_snap) = 0 then
    raise exception 'the order_flow card (20260807150000) was lost';
  end if;
  if position('v_ad_due_count' in v_snap) = 0 then
    raise exception 'the automation/cron card (20260723140000) was lost';
  end if;

  -- 7. NO NEW ALERT IDENTITY. A closed size raises the alert a closed product
  --    already raises. Exactly one fingerprint literal, exactly where it was.
  if (length(v_arm) - length(replace(v_arm, 'branch_availability:health', ''))) / 26 <> 1 then
    raise exception 'the branch_availability fingerprint is not emitted exactly once';
  end if;

  -- 8. THE MONEY PATH IS NOT MENTIONED, let alone redefined. This file has no
  --    business anywhere near it, and saying so as an assertion is cheaper than
  --    saying so in a comment.
  if position('branch_variant_availability' in v_snap) = 0 then
    raise exception 'impossible: assertion 1 passed and the table is unmentioned';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('place_order','compute_order_snapshot')
       and p.prosrc like '%closed_sizes%'
  ) then
    raise exception 'a money-path function was touched by this migration';
  end if;

  -- 9. CONTAINMENT UNCHANGED. Both remain service_role-only. The snapshot is
  --    SECURITY DEFINER and reads every operational table there is; the
  --    staff-facing wrapper is the only way a client role sees any of it.
  if has_function_privilege('anon', 'public.operations_health_snapshot_internal()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.operations_health_snapshot_internal()', 'EXECUTE') then
    raise exception 'operations_health_snapshot_internal became reachable by a client role';
  end if;
  if has_function_privilege('anon', 'public.operations_alerts_derive_pre_stranded(jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.operations_alerts_derive_pre_stranded(jsonb,jsonb)', 'EXECUTE') then
    raise exception 'operations_alerts_derive_pre_stranded became reachable by a client role';
  end if;

  -- 10. IT ACTUALLY RUNS. A plpgsql body is NOT name-resolved at creation
  --     (ledger row 86), so everything above proves only that the text was
  --     stored. The snapshot is `stable` and reads nothing it may not read, so
  --     CALLING it is free -- and it resolves all four availability tables, the
  --     new one included. Its outcome is read back as a VALUE, never a notice
  --     (ledger row 90: an assertion whose result you cannot read is not
  --     evidence).
  declare
    v_card jsonb;
  begin
    v_card := (
      select s from jsonb_array_elements(public.operations_health_snapshot_internal() -> 'systems') s
       where s ->> 'id' = 'branch_availability'
    );
    if v_card is null then
      raise exception 'the branch_availability card is absent from the snapshot';
    end if;
    if v_card -> 'details' -> 'closed_sizes' is null then
      raise exception 'closed_sizes is absent from the rendered card';
    end if;
    if v_card ->> 'state' = 'unavailable' then
      raise exception 'the branch_availability card is unavailable after this migration: %',
        coalesce(v_card -> 'details' ->> 'safe_error_code', 'no error code');
    end if;
  end;
end $$;
