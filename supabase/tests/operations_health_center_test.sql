-- ============================================================================
-- Operations Health Center v1 tests (migration 20260722100000).
-- Transactional, deterministic, no external provider calls.
-- ============================================================================
begin;

select set_config('test.is_admin', 'true', true);
select set_config('test.auth_uid', '', true);

-- ---- OBJECT / SECURITY CONTRACT --------------------------------------------
do $$
declare
  v_secdef boolean;
  v_config text[];
begin
  if to_regprocedure('public.operations_health_summary()') is null then
    raise exception 'operations_health_summary() missing';
  end if;
  if to_regprocedure('public.operations_health_overall_state(text,text,text,text)') is null then
    raise exception 'operations_health_overall_state() missing';
  end if;

  select p.prosecdef, p.proconfig into v_secdef, v_config
  from pg_proc p
  where p.oid = 'public.operations_health_summary()'::regprocedure;

  if not v_secdef then raise exception 'summary must be SECURITY DEFINER'; end if;
  if not ('search_path=public' = any(coalesce(v_config, '{}'))) then
    raise exception 'summary search_path not pinned: %', v_config;
  end if;

  if has_function_privilege('anon', 'public.operations_health_summary()', 'execute') then
    raise exception 'anon must not execute operations health summary';
  end if;
  if not has_function_privilege('authenticated', 'public.operations_health_summary()', 'execute') then
    raise exception 'authenticated staff-wrapper grant missing';
  end if;
  if has_function_privilege(
      'authenticated',
      'public.operations_health_overall_state(text,text,text,text)',
      'execute') then
    raise exception 'state helper must not be client-executable';
  end if;

  raise notice 'OBJECT / SECURITY CONTRACT OK';
end $$;

-- ---- OVERALL STATE MATRIX ---------------------------------------------------
do $$
begin
  if public.operations_health_overall_state('healthy','healthy','idle','healthy') <> 'healthy' then
    raise exception 'healthy matrix failed';
  end if;
  if public.operations_health_overall_state('degraded','healthy','idle','healthy') <> 'degraded' then
    raise exception 'degraded matrix failed';
  end if;
  if public.operations_health_overall_state('unavailable','healthy','idle','healthy') <> 'degraded' then
    raise exception 'unavailable critical source must degrade';
  end if;
  if public.operations_health_overall_state('healthy','failing','idle','healthy') <> 'failing' then
    raise exception 'failing matrix failed';
  end if;
  if public.operations_health_overall_state(
      'healthy','healthy','configuration_error','failing') <> 'configuration_error' then
    raise exception 'configuration_error precedence failed';
  end if;
  if public.operations_health_overall_state(
      'healthy','healthy','idle','healthy') = 'failing' then
    raise exception 'idle account deletion must not fail the platform';
  end if;

  raise notice 'OVERALL STATE MATRIX OK';
end $$;

-- ---- STAFF GATE -------------------------------------------------------------
do $$
declare denied boolean := false;
begin
  perform set_config('test.is_admin', 'false', true);
  begin
    perform public.operations_health_summary();
  exception when sqlstate '42501' then
    denied := true;
  end;
  if not denied then raise exception 'non-staff caller was not denied'; end if;

  perform set_config('test.is_admin', 'true', true);
  perform public.operations_health_summary();
  raise notice 'STAFF GATE OK';
end $$;

-- ---- SAFE SHAPE / NO PII OR SECRET FIELDS ----------------------------------
do $$
declare
  s jsonb;
  txt text;
  systems jsonb;
  jobs jsonb;
begin
  s := public.operations_health_summary();
  txt := lower(s::text);
  systems := s->'systems';
  jobs := s->'jobs';

  if jsonb_typeof(systems) <> 'array' or jsonb_array_length(systems) <> 8 then
    raise exception 'expected 8 subsystem cards, got %', systems;
  end if;
  if jsonb_typeof(jobs) <> 'array' or jsonb_array_length(jobs) <> 3 then
    raise exception 'expected 3 allowlisted jobs, got %', jobs;
  end if;
  if s ?& array[
    'generated_at','overall_state','critical_attention_count',
    'warning_attention_count','systems_unavailable_count',
    'systems_disabled_count','systems_not_configured_count',
    'systems_not_monitored_count','systems','jobs','attention'
  ] is not true then
    raise exception 'summary missing required top-level keys: %', s;
  end if;

  -- Match exact JSON key names, not broad substrings in harmless prose.
  if txt like '%"secret_config"%'
     or txt like '%"client_id"%'
     or txt like '%"merchant_id"%'
     or txt like '%"phone_number_id"%'
     or txt like '%"business_account_id"%'
     or txt like '%"expo_push_token"%'
     or txt like '%"customer_name"%'
     or txt like '%"customer_phone"%'
     or txt like '%"address_snapshot"%'
     or txt like '%"return_message"%'
     or txt like '%"command"%'
     or txt like '%"username"%'
     or txt like '%"raw"%'
     or txt like '%"provider_ref"%'
     or txt like '%"reference_transaction"%' then
    raise exception 'unsafe field leaked in summary: %', s;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(jobs) j
    where not (j ?& array[
      'job_name','subsystem','active','state','expected_schedule'
    ])
  ) then
    raise exception 'job projection missing safe required fields: %', jobs;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(jobs) j
    where j ?| array['command','username','database','return_message']
  ) then
    raise exception 'unsafe cron fields leaked: %', jobs;
  end if;

  if not exists (
    select 1 from jsonb_array_elements(systems) x where x->>'id'='payment'
  ) then
    raise exception 'payment card missing';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(systems) x where x->>'id'='order_integrity'
  ) then
    raise exception 'order integrity card missing';
  end if;

  raise notice 'SAFE SHAPE / NO PII OK';
end $$;

-- ---- TRUTHFUL OPTIONAL-INTEGRATION STATES ----------------------------------
do $$
declare
  payment_state text;
  email_state text;
  otp_state text;
  push_state text;
begin
  -- Enabled and configured optional integrations still cannot be called healthy
  -- without provider availability telemetry.
  update public.integration_settings
     set enabled = true,
         provider_name = coalesce(provider_name, 'configured-provider'),
         secret_config = case when secret_config is null or secret_config='{}'::jsonb
                              then '{"configured":true}'::jsonb else secret_config end,
         public_config = case provider_type
           when 'payment' then coalesce(public_config,'{}'::jsonb)
             || '{"mode":"test","currency":"SAR"}'::jsonb
           when 'email' then coalesce(public_config,'{}'::jsonb)
             || '{"host":"configured","from_email":"configured@example.invalid"}'::jsonb
           else coalesce(public_config,'{}'::jsonb)
         end
   where provider_type in ('payment','email','whatsapp','push');

  select x->>'state' into payment_state
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='payment';

  select x->>'state' into email_state
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='email';

  select x->>'state' into otp_state
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='otp';

  select x->>'state' into push_state
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='push';

  if payment_state = 'healthy' then
    raise exception 'payment must never be healthy without provider telemetry';
  end if;
  if email_state = 'healthy' then
    raise exception 'email must never be healthy from enabled/configured alone';
  end if;
  if otp_state = 'healthy' then
    raise exception 'OTP must never be healthy from enabled/configured alone';
  end if;
  if push_state = 'healthy' then
    raise exception 'push must never be healthy from enabled/configured alone';
  end if;

  raise notice 'TRUTHFUL OPTIONAL-INTEGRATION STATES OK';
end $$;

-- ---- CONFIGURED MIRRORS RUNTIME READINESS (payment/push) --------------------
-- The "configured" boolean must track the real runtime gates, not a looser
-- proxy: a broken local Tap setup must read not_configured (never the softer
-- not_monitored), and a correctly enabled Expo push (which carries no DB secret)
-- must never be mislabelled not_configured.
do $$
declare
  st text;
  prov text;
  txt text;
begin
  -- Tap: enabled, provider 'tap', merchant set, but only the WRONG-mode key is
  -- stored (mode=test, only live key) => resolveTapConfig fails => not_configured.
  update public.integration_settings
     set enabled = true,
         provider_name = 'tap',
         public_config = '{"mode":"test","currency":"SAR","merchant_id":"m_123"}'::jsonb,
         secret_config = '{"live_secret_key":"sk_live_only"}'::jsonb
   where provider_type = 'payment';
  select x->>'state' into st
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='payment';
  if st <> 'not_configured' then
    raise exception 'Tap with only the wrong-mode key must be not_configured, got %', st;
  end if;

  -- Add the correct selected-mode key => fully configured => not the unconfigured
  -- or disabled states (no external probe exists, so normally not_monitored).
  update public.integration_settings
     set secret_config = '{"test_secret_key":"sk_test_ok","live_secret_key":"sk_live_only"}'::jsonb
   where provider_type = 'payment';
  select x->>'state' into st
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='payment';
  if st in ('not_configured','disabled') then
    raise exception 'fully configured Tap must not be %; expected a configured state', st;
  end if;

  -- Missing merchant_id => not_configured even with a valid selected-mode key.
  update public.integration_settings
     set public_config = '{"mode":"test","currency":"SAR"}'::jsonb
   where provider_type = 'payment';
  select x->>'state' into st
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='payment';
  if st <> 'not_configured' then
    raise exception 'Tap missing merchant_id must be not_configured, got %', st;
  end if;

  -- Provider not 'tap' => not_configured.
  update public.integration_settings
     set provider_name = 'geidea',
         public_config = '{"mode":"test","currency":"SAR","merchant_id":"m_123"}'::jsonb,
         secret_config = '{"test_secret_key":"sk_test_ok"}'::jsonb
   where provider_type = 'payment';
  select x->>'state' into st
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='payment';
  if st <> 'not_configured' then
    raise exception 'non-tap payment provider must be not_configured, got %', st;
  end if;

  -- Whitespace-only merchant_id => not_configured (resolveTapConfig trims it).
  update public.integration_settings
     set provider_name = 'tap',
         public_config = '{"mode":"test","currency":"SAR","merchant_id":"   "}'::jsonb,
         secret_config = '{"test_secret_key":"sk_test_ok"}'::jsonb
   where provider_type = 'payment';
  select x->>'state' into st
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='payment';
  if st <> 'not_configured' then
    raise exception 'whitespace-only merchant_id must be not_configured, got %', st;
  end if;

  -- Whitespace-only selected-mode key => not_configured (resolver trims the key).
  update public.integration_settings
     set public_config = '{"mode":"test","currency":"SAR","merchant_id":"m_123"}'::jsonb,
         secret_config = '{"test_secret_key":"  \t "}'::jsonb
   where provider_type = 'payment';
  select x->>'state' into st
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='payment';
  if st <> 'not_configured' then
    raise exception 'whitespace-only Tap key must be not_configured, got %', st;
  end if;

  -- Push: enabled + provider 'expo' + EMPTY secret_config must be treated as
  -- configured (Expo credentials live outside integration_settings.secret_config).
  update public.integration_settings
     set enabled = true,
         provider_name = null,
         public_config = '{"provider":"expo"}'::jsonb,
         secret_config = '{}'::jsonb
   where provider_type = 'push';
  select x->>'state' into st
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='push';
  if st in ('not_configured','disabled') then
    raise exception 'enabled Expo push with no DB secret must be configured, got %', st;
  end if;

  -- Case-sensitive provider gate: 'Expo' (capitalized) is unsupported at runtime
  -- (push-dispatch compares exactly to 'expo'), so it must read not_configured.
  update public.integration_settings
     set public_config = '{"provider":"Expo"}'::jsonb
   where provider_type = 'push';
  select x->>'state' into st
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='push';
  if st <> 'not_configured' then
    raise exception 'case-mismatched push provider (Expo) must be not_configured, got %', st;
  end if;

  -- Push provider not 'expo' => not_configured.
  update public.integration_settings
     set provider_name = 'other',
         public_config = '{"provider":"other"}'::jsonb
   where provider_type = 'push';
  select x->>'state' into st
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='push';
  if st <> 'not_configured' then
    raise exception 'non-expo push provider must be not_configured, got %', st;
  end if;

  -- OTP (WhatsApp): a token alone is not enough. resolveWhatsAppConfig needs
  -- phone_number_id (public), access_token (secret) and an OTP template name.
  -- Missing phone_number_id + template => not_configured despite a saved token.
  update public.integration_settings
     set enabled = true,
         provider_name = 'whatsapp',
         public_config = '{}'::jsonb,
         secret_config = '{"access_token":"tok_abc"}'::jsonb
   where provider_type = 'whatsapp';
  select x->>'state' into st
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='otp';
  if st <> 'not_configured' then
    raise exception 'incomplete WhatsApp OTP setup must be not_configured, got %', st;
  end if;

  -- phone_number_id + access_token + one template => configured (not the
  -- unconfigured/disabled states; normally not_monitored with no send probe).
  update public.integration_settings
     set public_config = '{"phone_number_id":"pnid_1","otp_template_name_en":"otp_en"}'::jsonb,
         secret_config = '{"access_token":"tok_abc"}'::jsonb
   where provider_type = 'whatsapp';
  select x->>'state' into st
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='otp';
  if st in ('not_configured','disabled') then
    raise exception 'fully configured WhatsApp OTP must not be %; expected configured', st;
  end if;

  -- Email/SMTP: host + from_email with EMPTY secret_config must be configured
  -- (email-test-config makes SMTP auth optional, so no password is required).
  update public.integration_settings
     set enabled = true,
         provider_name = 'smtp',
         public_config = '{"host":"smtp.example.invalid","from_email":"noreply@example.invalid"}'::jsonb,
         secret_config = '{}'::jsonb
   where provider_type = 'email';
  select x->>'state' into st
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='email';
  if st in ('not_configured','disabled') then
    raise exception 'no-auth SMTP with host + from_email must be configured, got %', st;
  end if;

  -- Whitespace-only host => not_configured (runtime trims host).
  update public.integration_settings
     set public_config = '{"host":"   ","from_email":"noreply@example.invalid"}'::jsonb
   where provider_type = 'email';
  select x->>'state' into st
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='email';
  if st <> 'not_configured' then
    raise exception 'whitespace-only SMTP host must be not_configured, got %', st;
  end if;

  -- Missing from_email => not_configured.
  update public.integration_settings
     set public_config = '{"host":"smtp.example.invalid"}'::jsonb
   where provider_type = 'email';
  select x->>'state' into st
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='email';
  if st <> 'not_configured' then
    raise exception 'SMTP without from_email must be not_configured, got %', st;
  end if;

  -- OTP CARD READS THE WHATSAPP ROW ONLY (never the separate SMS slot).
  -- The runtime OTP path calls getProviderConfig(admin,'whatsapp'); an enabled SMS
  -- row — even one carrying WhatsApp-shaped keys — must not influence the card.
  -- Give the SMS slot a fully "ready" WhatsApp-shaped config for every case so any
  -- leakage would flip the assertion.
  update public.integration_settings
     set enabled = true,
         provider_name = 'sms-provider',
         public_config = '{"phone_number_id":"sms_pnid","otp_template_name_en":"sms_tpl"}'::jsonb,
         secret_config = '{"access_token":"sms_tok"}'::jsonb
   where provider_type = 'sms';

  -- Case 1: enabled complete SMS + enabled complete WhatsApp => use WhatsApp,
  -- configured, and the reported provider is the WhatsApp row's.
  update public.integration_settings
     set enabled = true,
         provider_name = 'whatsapp',
         public_config = '{"phone_number_id":"wa_pnid","otp_template_name_ar":"wa_ar"}'::jsonb,
         secret_config = '{"access_token":"wa_tok"}'::jsonb
   where provider_type = 'whatsapp';
  select x->>'state', x->'details'->>'provider' into st, prov
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='otp';
  if st in ('not_configured','disabled') then
    raise exception 'enabled+configured WhatsApp OTP must be configured, got %', st;
  end if;
  if prov is distinct from 'whatsapp' then
    raise exception 'OTP provider must come from the WhatsApp row, got %', prov;
  end if;

  -- Case 2: enabled complete SMS + enabled INCOMPLETE WhatsApp (no phone_number_id/
  -- template) => SMS must not mask it; OTP stays not_configured per the WhatsApp row.
  update public.integration_settings
     set enabled = true,
         provider_name = 'whatsapp',
         public_config = '{}'::jsonb,
         secret_config = '{"access_token":"wa_tok"}'::jsonb
   where provider_type = 'whatsapp';
  select x->>'state', x->'details'->>'provider' into st, prov
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='otp';
  if st <> 'not_configured' then
    raise exception 'incomplete WhatsApp OTP must be not_configured despite enabled SMS, got %', st;
  end if;
  if prov is distinct from 'whatsapp' then
    raise exception 'OTP must read WhatsApp even when incomplete, got provider %', prov;
  end if;

  -- Case 3: enabled complete SMS + DISABLED complete WhatsApp => OTP disabled from
  -- the WhatsApp row; the enabled SMS slot must not make OTP look enabled.
  update public.integration_settings
     set enabled = false,
         provider_name = 'whatsapp',
         public_config = '{"phone_number_id":"wa_pnid","otp_template_name_ar":"wa_ar"}'::jsonb,
         secret_config = '{"access_token":"wa_tok"}'::jsonb
   where provider_type = 'whatsapp';
  select x->>'state' into st
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='otp';
  if st <> 'disabled' then
    raise exception 'disabled WhatsApp OTP must read disabled despite enabled SMS, got %', st;
  end if;

  -- Safe shape while WhatsApp carries real-looking secret/config: the summary must
  -- expose no access_token/phone_number_id key or their values.
  update public.integration_settings
     set enabled = true,
         public_config = '{"phone_number_id":"wa_secret_pnid","otp_template_name_ar":"wa_ar"}'::jsonb,
         secret_config = '{"access_token":"wa_secret_tok"}'::jsonb
   where provider_type = 'whatsapp';
  txt := lower(public.operations_health_summary()::text);
  if txt like '%"access_token"%' or txt like '%wa_secret_tok%'
     or txt like '%"phone_number_id"%' or txt like '%wa_secret_pnid%' then
    raise exception 'OTP card leaked a secret/PII field';
  end if;

  -- Case 4: enabled complete SMS + NO WhatsApp row => OTP reflects the MISSING
  -- WhatsApp config (not_configured), never the SMS slot.
  delete from public.integration_settings where provider_type = 'whatsapp';
  select x->>'state', x->'details'->>'provider' into st, prov
  from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id'='otp';
  if st <> 'not_configured' then
    raise exception 'missing WhatsApp row must yield not_configured OTP, got %', st;
  end if;
  if prov is not null then
    raise exception 'OTP provider must be null with no WhatsApp row, got %', prov;
  end if;

  raise notice 'CONFIGURED MIRRORS RUNTIME READINESS OK';
end $$;

-- ---- MISSING OPTIONAL CONFIG DOES NOT CRASH THE PAGE ------------------------
do $$
declare
  s jsonb;
  state text;
begin
  delete from public.integration_settings where provider_type = 'email';
  s := public.operations_health_summary();

  select x->>'state' into state
  from jsonb_array_elements(s->'systems') x
  where x->>'id'='email';

  if state <> 'not_configured' then
    raise exception 'missing email row should be not_configured, got %', state;
  end if;
  if jsonb_array_length(s->'systems') <> 8 then
    raise exception 'one missing optional config removed other subsystem cards';
  end if;

  raise notice 'MISSING OPTIONAL CONFIG ISOLATED OK';
end $$;

-- ---- READ-ONLY GUARANTEE ----------------------------------------------------
do $$
declare
  orders_before bigint; orders_after bigint;
  payments_before bigint; payments_after bigint;
  deletion_before bigint; deletion_after bigint;
  devices_before bigint; devices_after bigint;
  logs_before bigint; logs_after bigint;
begin
  select count(*) into orders_before from public.orders;
  select count(*) into payments_before from public.payment_records;
  select count(*) into deletion_before from public.account_deletion_requests;
  select count(*) into devices_before from public.push_devices;
  select count(*) into logs_before from public.notification_log;

  perform public.operations_health_summary();
  perform public.operations_health_summary();

  select count(*) into orders_after from public.orders;
  select count(*) into payments_after from public.payment_records;
  select count(*) into deletion_after from public.account_deletion_requests;
  select count(*) into devices_after from public.push_devices;
  select count(*) into logs_after from public.notification_log;

  if (orders_before,payments_before,deletion_before,devices_before,logs_before)
     is distinct from
     (orders_after,payments_after,deletion_after,devices_after,logs_after) then
    raise exception 'summary changed operational row counts';
  end if;

  raise notice 'READ-ONLY GUARANTEE OK';
end $$;

do $$ begin raise notice 'ALL OPERATIONS HEALTH CENTER CASES PASSED'; end $$;
rollback;
