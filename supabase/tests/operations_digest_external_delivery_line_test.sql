-- operations_digest_external_delivery_line_test.sql
--
-- Pins the digest footer introduced by
-- `20260915120000_digest_external_delivery_line.sql`: every rendered digest
-- ends with a line describing the CURRENT value of
-- `external_dispatch_enabled`, in both languages, and the retracted
-- "in this version" sentence is unreachable in either state.
--
-- WHY THIS FILE EXISTS SEPARATELY FROM THE MIGRATION'S OWN CHECK. That check
-- runs against whatever the flag happens to be and must not write, because a
-- write would bump `operations_alert_settings.updated_at` on a migration that
-- is meant to change nothing. Here the whole file is one rolled-back
-- transaction, so both states can be exercised for real.
--
-- Single transaction, rolled back. Disposable/local database only.

begin;

do $$
declare
  v_orig     boolean;
  v_body_en  text;
  v_body_ar  text;
  v_last_en  text;
  v_last_ar  text;
  v_state    boolean;
  v_want_en  text;
  v_want_ar  text;
  v_cases    integer := 0;
begin
  select external_dispatch_enabled into v_orig
  from public.operations_alert_settings limit 1;

  foreach v_state in array array[false, true] loop
    update public.operations_alert_settings set external_dispatch_enabled = v_state;

    v_body_en := public.operations_digest_build(
      'en', now() - interval '1 day', now(), current_date, 'Asia/Riyadh', true
    ) ->> 'rendered_body';
    v_body_ar := public.operations_digest_build(
      'ar', now() - interval '1 day', now(), current_date, 'Asia/Riyadh', true
    ) ->> 'rendered_body';

    -- Guard against the vacuous pass: a wrong key returns NULL, and
    -- `NULL <> 'x'` is NULL, so every comparison below would be skipped.
    if v_body_en is null or v_body_ar is null then
      raise exception 'rendered_body is NULL for state % -- assertions would be vacuous', v_state;
    end if;

    v_last_en := split_part(v_body_en, e'\n', array_length(string_to_array(v_body_en, e'\n'), 1));
    v_last_ar := split_part(v_body_ar, e'\n', array_length(string_to_array(v_body_ar, e'\n'), 1));

    v_want_en := case when v_state then 'External delivery is enabled (email).'
                      else 'External delivery is disabled.' end;
    v_want_ar := case when v_state then 'الإرسال الخارجي مُفعّل (بريد).'
                      else 'الإرسال الخارجي معطل.' end;

    if v_last_en is distinct from v_want_en then
      raise exception 'EN footer wrong for flag=%: wanted [%] got [%]', v_state, v_want_en, v_last_en;
    end if;
    if v_last_ar is distinct from v_want_ar then
      raise exception 'AR footer wrong for flag=%: wanted [%] got [%]', v_state, v_want_ar, v_last_ar;
    end if;

    -- The retracted sentence must be unreachable in BOTH states, both languages.
    if v_body_en like '%in this version%' then
      raise exception 'EN retracted sentence reachable at flag=%', v_state;
    end if;
    if v_body_ar like '%في هذا الإصدار%' then
      raise exception 'AR retracted sentence reachable at flag=%', v_state;
    end if;

    v_cases := v_cases + 1;
  end loop;

  if v_cases <> 2 then
    raise exception 'expected 2 flag states exercised, got %', v_cases;
  end if;

  -- Restore, though the rollback below is what actually guarantees it.
  update public.operations_alert_settings set external_dispatch_enabled = v_orig;

  raise notice 'DIGEST EXTERNAL-DELIVERY FOOTER OK (2 states x 2 languages)';
end $$;

-- The footer must be the LAST line, not merely present somewhere.
do $$
declare
  v_body text;
begin
  update public.operations_alert_settings set external_dispatch_enabled = false;
  v_body := public.operations_digest_build(
    'en', now() - interval '1 day', now(), current_date, 'Asia/Riyadh', false
  ) ->> 'rendered_body';
  if v_body is null then
    raise exception 'rendered_body NULL in stored-mode render';
  end if;
  if right(v_body, length('External delivery is disabled.')) <> 'External delivery is disabled.' then
    raise exception 'footer is not the final line of a stored-mode render';
  end if;
  raise notice 'DIGEST FOOTER IS FINAL LINE OK';
end $$;

rollback;
