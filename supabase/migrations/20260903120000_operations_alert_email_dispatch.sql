-- ============================================================================
-- Operations alerts v2 — EMAIL DISPATCH.
--
-- WHAT THIS EXISTS FOR
-- The alert engine has worked since 2026-07-23 and has never once reached a
-- human. Every row it has produced is ('in_app','recorded') and stops in this
-- database. Measured live 2026-09-03: 6 alert states, all `recovered`; the only
-- critical incident (2026-08-10, stranded orders + platform health) was seen by
-- nobody until somebody opened the console. If the POS fails during Friday
-- dinner, no person is told. That is X3 in docs/GO_LIVE_READINESS.md.
--
-- WHAT v1 DID ON PURPOSE, AND WHY THIS IS NOT A "FIX"
-- v1 did not forget to dispatch. It refused to, in three independent places:
--
--   1. `operations_alert_outbox_v1_dormancy` — a CHECK making an external-channel
--      row unable to leave 'blocked'/'cancelled';
--   2. both producers hard-coded channel 'in_app', including in the idempotency
--      key, so no external row was ever CREATED;
--   3. `operations_alert_settings_update` refused in TWO places, not one: the
--      `case` branch raised outright, AND the persistence step at the end of the
--      function wrote `external_dispatch_enabled = false` unconditionally.
--      Patching only the branch left the flag unsettable and looked correct.
--      `operations_alerts_digest_test.sql` caught it on the first CI run, which
--      is the whole argument for writing the suite before trusting the change.
--
-- A fifth guard was a TEST: two suites pinned v1's refusal by name. Each of
-- those assertions is replaced by the v2 property it became, not deleted.
--
-- KNOWN LIMITATION, stated rather than discovered later:
-- `operations_alert_settings_safe()` is NOT redefined here, so `dispatch_language`
-- and `dispatch_min_severity` are settable through the RPC but not returned by it.
-- The admin console can therefore set them but cannot yet display them. Widening
-- the safe projection is a separate, smaller change.
--
-- The constraint's own comment anticipated this migration: external delivery is
-- "structurally impossible until a future approved migration drops THIS named
-- constraint". This is that migration, and it removes those three deliberately
-- — not as an oversight being corrected.
--
-- (A fourth guard, the cron activation block in 20260723120000, checks the v1
-- constraint by name. It lives in `do $$ ... end $$;` anonymous blocks that ran
-- once at apply time and are not stored, so replacing the constraint cannot
-- break it. Verified before writing this file rather than assumed.)
--
-- WHAT STAYS DORMANT
-- `external_dispatch_enabled` is NOT changed here. It is false, this migration
-- leaves it false, and every producer gate below is `and external_dispatch_enabled`.
-- Applying this file therefore changes NO behaviour: not one additional row is
-- written until somebody turns the flag on, and nothing is sent until
-- `operations-alert-dispatch` is also deployed.
--
-- EMAIL ONLY. 'whatsapp' and 'push' remain structurally blocked by the v2
-- constraint, exactly as they were. This migration widens one channel.
--
-- NO RECIPIENT ADDRESSES ARE STORED, which was v1's stated property and is kept.
-- `operations_alerts_dispatch_recipients()` derives them from admin profiles at
-- send time, so the list cannot drift from who is actually an administrator and
-- no new copy of anybody's address is created.
-- ============================================================================

-- ---- 1. Settings: how mail is addressed, and how much of it ----------------
alter table public.operations_alert_settings
  add column if not exists dispatch_language text not null default 'en',
  add column if not exists dispatch_min_severity text not null default 'critical';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'operations_alert_settings_dispatch_language'
                    and conrelid = 'public.operations_alert_settings'::regclass) then
    alter table public.operations_alert_settings
      add constraint operations_alert_settings_dispatch_language
        check (dispatch_language in ('en','ar'));
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'operations_alert_settings_dispatch_min_severity'
                    and conrelid = 'public.operations_alert_settings'::regclass) then
    alter table public.operations_alert_settings
      add constraint operations_alert_settings_dispatch_min_severity
        check (dispatch_min_severity in ('warning','critical'));
  end if;
end $$;

comment on column public.operations_alert_settings.dispatch_language is
  'Language of dispatched mail. The in_app outbox stays bilingual; a responder reads one mailbox, so exactly one language is sent.';
comment on column public.operations_alert_settings.dispatch_min_severity is
  'Lowest severity that produces an email. Defaults to critical: lazywait:sync_degraded has historically opened and self-recovered inside the evaluator''s own 5-minute interval, so mailing warnings would page a human for a non-event.';

-- ---- 2. Outbox: a dispatch lifecycle, and the v2 dormancy rule -------------
alter table public.operations_alert_outbox
  add column if not exists claim_token     uuid,
  add column if not exists claimed_at      timestamptz,
  add column if not exists last_error_safe text;

comment on column public.operations_alert_outbox.last_error_safe is
  'Operator-safe reason the last send attempt failed. Deliberately a separate column from blocked_reason, whose own CHECK ties it to status = ''blocked''.';

comment on column public.operations_alert_outbox.claim_token is
  'Fencing token for one dispatch attempt. Every completion write is guarded by it, so a zombie dispatcher that outlives its lease matches zero rows.';

-- 'processing' joins the vocabulary: it is the claimed-but-not-yet-finalised
-- state the fencing token protects. Postgres named the original column check
-- `<table>_<column>_check`; assert that before dropping it so a rename upstream
-- fails here loudly instead of silently leaving the old vocabulary in force.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'operations_alert_outbox_status_check'
                    and conrelid = 'public.operations_alert_outbox'::regclass) then
    raise exception 'expected constraint operations_alert_outbox_status_check on the outbox; found none';
  end if;
end $$;

alter table public.operations_alert_outbox
  drop constraint operations_alert_outbox_status_check;
alter table public.operations_alert_outbox
  add constraint operations_alert_outbox_status_check
    check (status in ('recorded','pending','processing','sent','failed','cancelled','blocked'));

-- The v1 rule, replaced rather than merely dropped. `in_app` is untouched; only
-- `email` gains a lifecycle; `whatsapp` and `push` keep the v1 prohibition.
alter table public.operations_alert_outbox
  drop constraint operations_alert_outbox_v1_dormancy;
alter table public.operations_alert_outbox
  add constraint operations_alert_outbox_v2_dispatch check (
    (channel = 'in_app' and status in ('recorded','cancelled') and blocked_reason is null)
    or (channel = 'email'
        and status in ('pending','processing','sent','failed','cancelled','blocked'))
    or (channel not in ('in_app','email') and status in ('blocked','cancelled'))
  );

-- Claim-path index: the dispatcher's only query shape.
create index if not exists operations_alert_outbox_email_pending_idx
  on public.operations_alert_outbox (created_at)
  where channel = 'email' and status in ('pending','processing');

-- ---- 3. Producers: emit an email sibling when the flag is on ---------------
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
  v_s public.operations_alert_settings%rowtype;
  v_email boolean;
begin
  -- Settings decide whether an EMAIL sibling row is emitted beside the in_app
  -- one. Read once, outside the loop: the language and severity floor are
  -- per-call constants, and a missing singleton must not silently enable mail.
  select * into v_s from public.operations_alert_settings where id;
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

    -- EMAIL sibling. ONE row per event, not one per language: the in_app pair
    -- is a bilingual record, but a responder reads one mailbox. `v_lang` is
    -- matched against the configured dispatch language so exactly one of the
    -- two loop passes emits.
    --
    -- The severity gate is what makes this safe to switch on. Measured live
    -- 2026-09-03: `lazywait:sync_degraded` has opened and self-recovered within
    -- the evaluator's own 5-minute interval on all four occasions it fired.
    -- Mailing every warning would have sent eight emails for four non-events.
    -- The floor therefore defaults to 'critical'; widening it is a settings
    -- change, not a migration.
    --
    -- `recovered` events carry severity 'info', so they are admitted by their
    -- own switch rather than by the severity comparison.
    v_email := coalesce(v_s.external_dispatch_enabled, false)
      and v_lang = coalesce(v_s.dispatch_language, 'en')
      and (
        (p_event_type = 'recovered' and coalesce(v_s.recovery_notifications_enabled, true))
        or p_severity = 'critical'
        or (p_severity = 'warning' and coalesce(v_s.dispatch_min_severity, 'critical') = 'warning')
      );

    if v_email then
      insert into public.operations_alert_outbox
        (idempotency_key, alert_event_id, channel, language,
         subject_safe, body_safe, template_data, status, blocked_reason)
      values
        ('alert_event:' || p_event_id::text || ':email:' || v_lang,
         p_event_id, 'email', v_lang,
         v_rendered ->> 'subject', v_rendered ->> 'body',
         jsonb_build_object(
           'event_type', p_event_type, 'subsystem', p_subsystem,
           'condition_code', p_condition_code, 'severity', p_severity),
         'pending', null)
      on conflict (idempotency_key) do nothing;
      get diagnostics v_ct = row_count;
      v_inserted := v_inserted + v_ct;
    end if;
  end loop;
  return v_inserted;
end;
$$;

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

        -- EMAIL sibling for the daily digest: at most one message per day, in
        -- the configured language only. Unlike event mail this has no severity
        -- gate -- a digest is a summary, and its volume is bounded by the
        -- one-per-day/language idempotency above.
        if coalesce(v_settings.external_dispatch_enabled, false)
           and v_lang = coalesce(v_settings.dispatch_language, 'en') then
          insert into public.operations_alert_outbox
            (idempotency_key, digest_run_id, channel, language,
             subject_safe, body_safe, template_data, status, blocked_reason)
          values
            ('digest:daily:' || v_digest_date::text || ':' || v_lang || ':email',
             v_digest_id, 'email', v_lang,
             coalesce(v_built ->> 'rendered_subject', ''),
             coalesce(v_built ->> 'rendered_body', ''),
             jsonb_build_object('digest_date', v_digest_date, 'language', v_lang),
             'pending', null)
          on conflict (idempotency_key) do nothing;
        end if;

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

-- ---- 4. Settings RPC: the refusal is lifted --------------------------------
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
        -- v2: this branch used to refuse outright ('external dispatch cannot be
        -- enabled in this version'). Email dispatch now exists, so the flag is
        -- settable. It stays FALSE on apply; turning it on is a deliberate
        -- operational act that starts mailing administrators.
        v_s.external_dispatch_enabled := (v_val #>> '{}')::boolean;
      when 'dispatch_language' then
        if jsonb_typeof(v_val) <> 'string' then
          raise exception 'dispatch_language must be a string' using errcode = 'P0001';
        end if;
        v_txt := v_val #>> '{}';
        if v_txt not in ('en', 'ar') then
          raise exception 'dispatch_language must be en or ar' using errcode = 'P0001';
        end if;
        v_s.dispatch_language := v_txt;
      when 'dispatch_min_severity' then
        if jsonb_typeof(v_val) <> 'string' then
          raise exception 'dispatch_min_severity must be a string' using errcode = 'P0001';
        end if;
        v_txt := v_val #>> '{}';
        if v_txt not in ('warning', 'critical') then
          raise exception 'dispatch_min_severity must be warning or critical' using errcode = 'P0001';
        end if;
        v_s.dispatch_min_severity := v_txt;
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
         -- v2: this line WROTE FALSE UNCONDITIONALLY. Patching the `case` branch
         -- above was not enough -- the settings RPC refused in TWO places, and
         -- the persistence step was the second. Caught by
         -- operations_alerts_digest_test.sql on the first CI run.
         external_dispatch_enabled = v_s.external_dispatch_enabled,
         dispatch_language = v_s.dispatch_language,
         dispatch_min_severity = v_s.dispatch_min_severity,
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

-- ---- 5. Recipients, derived and never stored -------------------------------
-- v1's stated property was that no recipient addresses live in this schema.
-- Deriving from admin profiles keeps that true, and has a second benefit: the
-- list cannot drift from who is actually an administrator. Revoking somebody's
-- admin role stops their alert mail in the same act.
create or replace function public.operations_alerts_dispatch_recipients()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select p.email
    from public.profiles p
   where p.role = 'admin'
     and p.email is not null
     and btrim(p.email) <> ''
   order by p.email
$$;

comment on function public.operations_alerts_dispatch_recipients() is
  'Alert mail recipients, derived from admin profiles at send time. No address is stored in the alerts schema.';

-- ---- 6. Claim / finalize / release, token-fenced ----------------------------
-- The shape follows the pos_sync precedent already running in push-dispatch:
-- exactly one dispatcher may own a row, completion writes are fenced by the
-- token, and a terminal row is never reclaimed.
create or replace function public.claim_operations_alert_emails(
  p_claim_token uuid,
  p_limit integer default 20,
  p_lease_minutes integer default 10,
  p_max_attempts integer default 5
)
returns table (id uuid, language text, subject_safe text, body_safe text, attempt_count integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_claim_token is null then
    raise exception 'claim token is required' using errcode = 'P0001';
  end if;

  -- Every returned name is aliased away from the OUT parameters. `id`,
  -- `language`, `subject_safe`, `body_safe` and `attempt_count` are all both a
  -- column here and an OUT parameter, and an unqualified reference to one of
  -- them is an ambiguity error at runtime rather than at create time. The final
  -- statement is also a plain SELECT over a CTE rather than `RETURN QUERY UPDATE`.
  return query
  with candidate as (
    select o.id as cid
      from public.operations_alert_outbox o
     where o.channel = 'email'
       and o.attempt_count < greatest(p_max_attempts, 1)
       and (
         o.status = 'pending'
         -- An EXPIRED lease is provably a dead owner. The lease must exceed the
         -- platform's maximum invocation wall-clock, or a live owner still
         -- waiting on SMTP could be reclaimed and the mail delivered twice.
         or (o.status = 'processing'
             and o.claimed_at < now() - make_interval(mins => greatest(p_lease_minutes, 1)))
       )
     order by o.created_at
     limit greatest(p_limit, 1)
       for update skip locked
  ),
  claimed as (
    update public.operations_alert_outbox o
       set status = 'processing',
           claim_token = p_claim_token,
           claimed_at = now(),
           attempt_count = o.attempt_count + 1,
           updated_at = now()
      from candidate c
     where o.id = c.cid
    returning o.id            as c_id,
              o.language      as c_language,
              o.subject_safe  as c_subject,
              o.body_safe     as c_body,
              o.attempt_count as c_attempts
  )
  select c_id, c_language, c_subject, c_body, c_attempts from claimed;
end;
$$;

create or replace function public.finalize_operations_alert_email(
  p_id uuid,
  p_claim_token uuid,
  p_status text,
  p_error_safe text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hit integer;
begin
  if p_status not in ('sent','failed') then
    raise exception 'finalize status must be sent or failed' using errcode = 'P0001';
  end if;
  -- Fenced: a dispatcher whose lease was reclaimed matches zero rows and its
  -- late write is a no-op rather than an overwrite of the new owner's outcome.
  update public.operations_alert_outbox
     set status = p_status,
         blocked_reason = null,
         last_error_safe = case when p_status = 'failed' then p_error_safe else null end,
         claim_token = null,
         claimed_at = null,
         updated_at = now()
   where id = p_id
     and channel = 'email'
     and status = 'processing'
     and claim_token = p_claim_token;
  get diagnostics v_hit = row_count;
  return case when v_hit = 1 then 'finalized' else 'lost_claim' end;
end;
$$;

-- Release is for a PROVEN pre-send failure only — nothing left for SMTP, so a
-- later attempt cannot double-deliver. Never call it once send has begun.
create or replace function public.release_operations_alert_email(
  p_id uuid,
  p_claim_token uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hit integer;
begin
  update public.operations_alert_outbox
     set status = 'pending',
         claim_token = null,
         claimed_at = null,
         updated_at = now()
   where id = p_id
     and channel = 'email'
     and status = 'processing'
     and claim_token = p_claim_token;
  get diagnostics v_hit = row_count;
  return case when v_hit = 1 then 'released' else 'lost_claim' end;
end;
$$;

-- ---- 7. Grants: the dispatcher is service-role only -------------------------
revoke all on function public.operations_alerts_dispatch_recipients() from public, anon, authenticated;
revoke all on function public.claim_operations_alert_emails(uuid, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.finalize_operations_alert_email(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.release_operations_alert_email(uuid, uuid) from public, anon, authenticated;
grant execute on function public.operations_alerts_dispatch_recipients() to service_role;
grant execute on function public.claim_operations_alert_emails(uuid, integer, integer, integer) to service_role;
grant execute on function public.finalize_operations_alert_email(uuid, uuid, text, text) to service_role;
grant execute on function public.release_operations_alert_email(uuid, uuid) to service_role;

-- ---- 8. Self-verification: the whole file is one transaction ----------------
do $$
declare
  v_enabled boolean;
  v_email_rows bigint;
begin
  if exists (select 1 from pg_constraint
              where conname = 'operations_alert_outbox_v1_dormancy'
                and conrelid = 'public.operations_alert_outbox'::regclass) then
    raise exception 'v1 dormancy constraint still present after replacement';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'operations_alert_outbox_v2_dispatch'
                    and conrelid = 'public.operations_alert_outbox'::regclass) then
    raise exception 'v2 dispatch constraint missing';
  end if;

  -- The flag must be untouched, and nothing may have been written. If either
  -- fails, this migration changed behaviour on apply, which it must not.
  select external_dispatch_enabled into v_enabled
    from public.operations_alert_settings where id;
  if v_enabled is distinct from false then
    raise exception 'external_dispatch_enabled must remain false on apply (found %)', v_enabled;
  end if;

  select count(*) into v_email_rows
    from public.operations_alert_outbox where channel = 'email';
  if v_email_rows <> 0 then
    raise exception 'expected zero email outbox rows on apply, found %', v_email_rows;
  end if;
end $$;
