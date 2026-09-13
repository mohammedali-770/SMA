-- 20260915120000_digest_external_delivery_line.sql
--
-- WHAT: `operations_digest_build` ends every digest with a footer stating that
-- external delivery is disabled "in this version". That sentence is
-- unconditional. It was true while v1 had no dispatcher; since 2026-09-07 the
-- dispatcher is deployed, the scheduler runs every five minutes, and the only
-- thing holding mail back is `external_dispatch_enabled`. The moment that flag
-- is turned on, EVERY digest -- English and Arabic alike -- will assert
-- something false, in an artifact that is stored and read after the fact.
--
-- This replaces the fixed sentence with one derived from the live flag, in both
-- languages. It cannot go stale again: there is no version claim left in it.
--
-- BOTH LANGUAGES WERE AFFECTED. An earlier note in this repository said the
-- Arabic digest carried no equivalent line. That was wrong -- it came from
-- searching the function body for a GUESSED Arabic phrase and reading the empty
-- result as absence. The Arabic line exists and has always existed
-- (`الإرسال الخارجي معطل في هذا الإصدار.`). A negative search proves nothing
-- until the search term is shown to match the positive case.
--
-- NO NEW ARABIC COPY IS DRAFTED HERE. Both replacement phrasings are lifted
-- from copy already shipping in the admin console
-- (`OperationsAlertsPanel.tsx:256-257`), so this introduces no
-- engineering-drafted Arabic into a stored artifact.
--
-- DERIVED, NOT RETYPED. The body is extracted from
-- `20260723090000_smart_operations_alerts_digest.sql` lines 1889-2141 -- the
-- only migration that has ever defined this function -- and four anchored
-- substitutions are applied, each asserted to match exactly once.
--
-- MONEY PATH: untouched. `place_order` and `compute_order_snapshot` are not
-- referenced. NO DEPLOY IMPLIED: the signature is unchanged, so every existing
-- caller binds to the new body.
--
-- APPLYING IT CHANGES NO STORED DIGEST. Digests already written are rows; this
-- only affects what future renders say. With `external_dispatch_enabled` false
-- the new footer reads "External delivery is disabled." -- the same claim as
-- before, minus the false "in this version".

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
  v_external_on boolean := false;
begin
  if p_language not in ('en', 'ar') then
    raise exception 'unsupported digest language' using errcode = 'P0001';
  end if;

  -- The external-delivery footer must describe the CURRENT flag, not "this
  -- version". Guarded like the health read below: if the settings row cannot
  -- be read, the footer falls back to "disabled", which is the conservative
  -- claim -- it under-promises delivery rather than over-promising it.
  begin
    select coalesce(external_dispatch_enabled, false)
      into v_external_on
    from public.operations_alert_settings
    limit 1;
  exception when others then
    v_external_on := false;
  end;

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
    v_lines := v_lines || (case when v_external_on
      then 'الإرسال الخارجي مُفعّل (بريد).'
      else 'الإرسال الخارجي معطل.' end)::text;
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
    v_lines := v_lines || (case when v_external_on
      then 'External delivery is enabled (email).'
      else 'External delivery is disabled.' end)::text;
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

-- ---------------------------------------------------------------------------
-- Self-verification. A plpgsql body is not name-resolved at creation, so a
-- clean apply proves only that the text was stored. This asserts the shape,
-- then CALLS the function in both languages and checks the rendered footer
-- against the live flag -- which resolves every name at execution.
-- `operations_digest_build` is `stable`, so it cannot write anything.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_src      text;
  v_flag     boolean;
  v_body_en  text;
  v_body_ar  text;
  v_last_en  text;
  v_last_ar  text;
  v_want_en  text;
  v_want_ar  text;
  v_overloads integer;
begin
  select count(*) into v_overloads
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'operations_digest_build';
  if v_overloads <> 1 then
    raise exception 'expected exactly 1 operations_digest_build overload, found %', v_overloads;
  end if;

  select prosrc into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'operations_digest_build';

  -- The retracted sentence must be gone in BOTH languages.
  if v_src like '%External delivery is disabled in this version.%' then
    raise exception 'english "in this version" footer survived';
  end if;
  if v_src like '%الإرسال الخارجي معطل في هذا الإصدار.%' then
    raise exception 'arabic "in this version" footer survived';
  end if;

  -- Exactly five references, enumerated so the number is checkable rather
  -- than remembered: (1) the declare, (2) the `into`, (3) the exception-handler
  -- fallback, (4) the Arabic branch, (5) the English branch. The first draft of
  -- this block asserted 4 and the apply failed on it -- the exception handler
  -- was forgotten. Left at 5 with the list, not loosened.
  if (length(v_src) - length(replace(v_src, 'v_external_on', ''))) / length('v_external_on') <> 5 then
    raise exception 'expected 5 v_external_on references (declare, into, exception fallback, ar branch, en branch), got %',
      (length(v_src) - length(replace(v_src, 'v_external_on', ''))) / length('v_external_on');
  end if;

  -- BOTH BRANCHES, asserted at source level. The functional call below can
  -- only exercise whichever branch the CURRENT flag selects, so on its own it
  -- lets the other branch say anything at all -- a mutant that corrupted the
  -- 'enabled' text survived until this check existed. No write is performed to
  -- flip the flag: that would bump operations_alert_settings.updated_at and
  -- leave a visible trace of a migration that is supposed to change nothing.
  -- Both states are exercised for real in
  -- supabase/tests/operations_digest_external_delivery_line_test.sql.
  if v_src not like '%External delivery is enabled (email).%' then
    raise exception 'english enabled-branch literal missing';
  end if;
  if v_src not like '%External delivery is disabled.%' then
    raise exception 'english disabled-branch literal missing';
  end if;
  if v_src not like '%الإرسال الخارجي مُفعّل (بريد).%' then
    raise exception 'arabic enabled-branch literal missing';
  end if;
  if v_src not like '%الإرسال الخارجي معطل.%' then
    raise exception 'arabic disabled-branch literal missing';
  end if;

  select coalesce(external_dispatch_enabled, false) into v_flag
  from public.operations_alert_settings limit 1;

  v_want_en := case when v_flag then 'External delivery is enabled (email).'
                    else 'External delivery is disabled.' end;
  v_want_ar := case when v_flag then 'الإرسال الخارجي مُفعّل (بريد).'
                    else 'الإرسال الخارجي معطل.' end;

  -- CALL it. p_preview => true so nothing could be mistaken for a stored run.
  v_body_en := public.operations_digest_build(
    'en', now() - interval '1 day', now(), (now() at time zone 'UTC')::date, 'Asia/Riyadh', true
  ) ->> 'rendered_body';
  v_body_ar := public.operations_digest_build(
    'ar', now() - interval '1 day', now(), (now() at time zone 'UTC')::date, 'Asia/Riyadh', true
  ) ->> 'rendered_body';

  -- The key is `rendered_body`, NOT `body`. The first draft read ->> 'body',
  -- got NULL, and PASSED -- because `NULL <> 'x'` is NULL rather than true, so
  -- every assertion below was skipped. Both faults are fixed: the right key,
  -- and `is distinct from` throughout, so a NULL fails loudly instead of
  -- silently satisfying the check.
  if v_body_en is null or v_body_ar is null then
    raise exception 'rendered_body came back NULL -- assertions would be vacuous';
  end if;

  v_last_en := split_part(v_body_en, e'\n', array_length(string_to_array(v_body_en, e'\n'), 1));
  v_last_ar := split_part(v_body_ar, e'\n', array_length(string_to_array(v_body_ar, e'\n'), 1));

  if v_last_en is distinct from v_want_en then
    raise exception 'EN footer mismatch: flag=% wanted % got %', v_flag, v_want_en, v_last_en;
  end if;
  if v_last_ar is distinct from v_want_ar then
    raise exception 'AR footer mismatch: flag=% wanted % got %', v_flag, v_want_ar, v_last_ar;
  end if;

  -- Unreachable in the RENDERED output, not merely absent from source text.
  if v_body_en like '%in this version%' or v_body_ar like '%في هذا الإصدار%' then
    raise exception 'retracted sentence still reachable in rendered output';
  end if;

  raise notice 'digest footer now tracks external_dispatch_enabled=% in both languages', v_flag;
end
$verify$;
