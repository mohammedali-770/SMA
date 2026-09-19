-- 20260927120000_admin_push_subscriptions.sql
--
-- WHERE AN ADMIN'S WEB-PUSH SUBSCRIPTION LIVES — step 2 of 4 toward notifying
-- the admin when a branch closes something.
--
-- APPLYING THIS SENDS NOTHING AND SUBSCRIBES NOBODY. It creates one empty
-- table, two columns' worth of configuration, and three RPCs. The sender
-- (step 3) and the trigger (step 4) do not exist yet, so after this applies the
-- only thing that can happen is an admin choosing to subscribe — which stores a
-- row and still delivers nothing.
--
-- THIS IS A DIFFERENT CHANNEL FROM `push_devices`, AND THE SEPARATION IS THE
-- SAFETY PROPERTY. `push_devices` is keyed by `customer_id` and every row in it
-- belongs to a customer (measured 2026-09-18: 5 active devices, all customers;
-- admin, branch staff and call centre hold zero). Web push to a staff console
-- and Expo push to the customer app share no table, no function and no code
-- path, so no predicate error here can put a branch closure on a customer's
-- lock screen. Reusing `push_devices` would have made that a one-line mistake.
--
-- THE TABLE IS CLOSED TO CLIENT ROLES ENTIRELY. RLS is enabled with ZERO
-- policies, which denies `anon` and `authenticated` outright, and the grants are
-- revoked as well. Every client path goes through the three SECURITY DEFINER
-- RPCs below, each gated on `is_admin()` — role AND AAL2, the same predicate
-- every other admin surface uses. `service_role` bypasses RLS, which is how the
-- step 3 sender will read subscriptions; that is deliberate and is the same
-- shape as `operations_alert_settings`.
--
-- WHY THE SUBSCRIPTION KEYS ARE SECRET AND THE VAPID PUBLIC KEY IS NOT.
-- `endpoint`, `p256dh` and `auth` together are a capability: anyone holding all
-- three, plus our VAPID private key, can push to that device. They live in the
-- closed table. The VAPID PUBLIC key is different — it identifies the sender and
-- cannot sign anything, so it is safe in `app_settings`, which both clients
-- already read in full. That also means rotating it needs no redeploy.
--
-- NO COLUMN-GRANT TRAP, AND THAT WAS MEASURED RATHER THAN ASSUMED.
-- `app_settings` grants are TABLE-level (verified 2026-09-17 in
-- `information_schema.table_privileges`: SELECT for `anon` and `authenticated`),
-- so a new column is covered automatically. This is the same reasoning that made
-- `20260926120000_variant_closing_flag` safe, and the opposite of the
-- `orders.is_comped` defect that broke My Orders for three weeks (ledger row 96).
--
-- MONEY PATH UNTOUCHED. This migration redefines neither `place_order` nor
-- `compute_order_snapshot`; it adds new objects only. The pair must still hash
-- `12b6816d256c29b76edf947ae1a7ea77` / `22e2d42935459e7bf93abb2941b56325` after
-- it applies, and the block at the end asserts exactly that.
--
-- NO DEPLOY IMPLIED. Nothing existing changes signature or behaviour.

-- ---- 1. Where the VAPID public key lives -------------------------------------

alter table public.app_settings
  add column if not exists admin_push_vapid_public_key text;

comment on column public.app_settings.admin_push_vapid_public_key is
  'VAPID PUBLIC key (base64url) for admin web-push. Public by design: it identifies the sender and cannot sign a push, so exposing it to every client is harmless. The matching PRIVATE key is a function secret and must never appear in this table or any other. Null means admin push is not configured, and the console shows its control as unavailable rather than broken.';

-- ---- 2. The subscriptions -----------------------------------------------------

create table if not exists public.admin_push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  admin_id        uuid not null references public.profiles(id) on delete cascade,

  -- The browser's push endpoint. UNIQUE because the endpoint IS the device
  -- identity: re-subscribing the same browser must update the existing row, not
  -- accumulate a second one that we would then push to twice.
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,

  lang            text not null default 'ar' check (lang in ('en', 'ar')),

  -- Purely diagnostic: which browser this is, so a stale subscription can be
  -- recognised. Never used for targeting.
  user_agent      text,

  -- The step 3 sender maintains these. `failure_count` is what lets a dead
  -- subscription be recognised before the endpoint returns 410.
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count   integer not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.admin_push_subscriptions is
  'Web-push subscriptions for ADMIN staff on the console, entirely separate from push_devices (customers, Expo). Closed to client roles: RLS is on with no policies and grants are revoked, so the only client route in is the three is_admin()-gated RPCs below.';

create index if not exists admin_push_subscriptions_admin_idx
  on public.admin_push_subscriptions (admin_id);

drop trigger if exists set_admin_push_subscriptions_updated_at on public.admin_push_subscriptions;
create trigger set_admin_push_subscriptions_updated_at
  before update on public.admin_push_subscriptions
  for each row execute function public.set_updated_at();

-- ---- 3. Closed to every client role -------------------------------------------

alter table public.admin_push_subscriptions enable row level security;
-- Deliberately NO policies: with RLS on and none defined, anon and authenticated
-- are denied every operation. service_role bypasses RLS and is how step 3 reads.
revoke all on public.admin_push_subscriptions from anon, authenticated;

-- ---- 4. The three RPCs ---------------------------------------------------------

create or replace function public.save_admin_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_lang       text default 'ar',
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'Only admins may subscribe to closure notifications'
      using errcode = '42501';
  end if;

  if coalesce(trim(p_endpoint), '') = ''
     or coalesce(trim(p_p256dh), '') = ''
     or coalesce(trim(p_auth), '') = '' then
    raise exception 'endpoint, p256dh and auth are all required'
      using errcode = '22023';
  end if;

  -- Upsert on the endpoint. Re-subscribing the same browser REASSIGNS the row to
  -- the current admin: an endpoint belongs to whoever most recently proved they
  -- hold it, and a shared device must not keep pushing to the previous signer-in.
  -- Counters reset because a fresh subscription has no failure history.
  insert into public.admin_push_subscriptions
    (admin_id, endpoint, p256dh, auth, lang, user_agent)
  values
    (v_uid, trim(p_endpoint), trim(p_p256dh), trim(p_auth),
     case when p_lang in ('en', 'ar') then p_lang else 'ar' end,
     left(coalesce(p_user_agent, ''), 400))
  on conflict (endpoint) do update
    set admin_id        = excluded.admin_id,
        p256dh          = excluded.p256dh,
        auth            = excluded.auth,
        lang            = excluded.lang,
        user_agent      = excluded.user_agent,
        failure_count   = 0,
        last_failure_at = null,
        updated_at      = now();
end;
$$;

create or replace function public.delete_admin_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins may manage closure notifications'
      using errcode = '42501';
  end if;

  -- Scoped to the caller: an admin turns off THEIR OWN device, never another's.
  delete from public.admin_push_subscriptions
   where endpoint = p_endpoint
     and admin_id = auth.uid();
end;
$$;

create or replace function public.admin_push_state(p_endpoint text default null)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_key text;
  v_has boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins may read closure notification state'
      using errcode = '42501';
  end if;

  select admin_push_vapid_public_key into v_key
    from public.app_settings where id is true;

  -- "Is THIS browser subscribed" — matched on the endpoint the caller holds, and
  -- scoped to the caller, so it can never report another admin's device as ours.
  select exists (
    select 1 from public.admin_push_subscriptions
     where admin_id = auth.uid()
       and p_endpoint is not null
       and endpoint = p_endpoint
  ) into v_has;

  return jsonb_build_object(
    'configured', v_key is not null and length(trim(v_key)) > 0,
    'vapid_public_key', v_key,
    'subscribed', v_has,
    'device_count', (
      select count(*) from public.admin_push_subscriptions where admin_id = auth.uid()
    )
  );
end;
$$;

revoke all on function public.save_admin_push_subscription(text, text, text, text, text) from public;
revoke all on function public.delete_admin_push_subscription(text) from public;
revoke all on function public.admin_push_state(text) from public;
grant execute on function public.save_admin_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.delete_admin_push_subscription(text) to authenticated;
grant execute on function public.admin_push_state(text) to authenticated;

-- ---- 5. Self-verification ------------------------------------------------------
-- Every assertion below is a value that can be false.
do $$
declare
  v_n    integer;
  v_bool boolean;
  v_txt  text;
  v_src  text;
begin
  -- 5.1 The table exists and is EMPTY. Applying this must subscribe nobody.
  select count(*) into v_n from public.admin_push_subscriptions;
  if v_n <> 0 then
    raise exception 'admin_push_subscriptions must be created empty, found % row(s)', v_n;
  end if;

  -- 5.2 RLS is ON and there are NO policies. Both halves matter: RLS off would
  --     expose every subscription to any signed-in customer, and a policy would
  --     reopen the table this design deliberately closes.
  select relrowsecurity into v_bool
    from pg_class where oid = 'public.admin_push_subscriptions'::regclass;
  if not coalesce(v_bool, false) then
    raise exception 'RLS is not enabled on admin_push_subscriptions';
  end if;
  select count(*) into v_n
    from pg_policies where schemaname = 'public' and tablename = 'admin_push_subscriptions';
  if v_n <> 0 then
    raise exception 'admin_push_subscriptions must have zero policies, found %', v_n;
  end if;

  -- 5.3 Neither client role holds ANY privilege on the table. Asserting the
  --     outcome, not the revoke statement: a default-privilege grant elsewhere
  --     could hand one back without this file changing.
  select count(*) into v_n
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name = 'admin_push_subscriptions'
     and grantee in ('anon', 'authenticated');
  if v_n <> 0 then
    raise exception 'anon/authenticated still hold % privilege(s) on admin_push_subscriptions', v_n;
  end if;

  -- 5.4 All three RPCs exist, exactly once each, and are SECURITY DEFINER.
  --     Cardinality FIRST: a second overload would make every later catalog read
  --     pick an arbitrary one (the lesson recorded for 20260925120000).
  for v_txt in
    select unnest(array['save_admin_push_subscription',
                        'delete_admin_push_subscription',
                        'admin_push_state'])
  loop
    select count(*) into v_n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_txt;
    if v_n <> 1 then
      raise exception '% must have exactly one overload, found %', v_txt, v_n;
    end if;
    select p.prosecdef into v_bool
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_txt;
    if not v_bool then
      raise exception '% must be SECURITY DEFINER', v_txt;
    end if;
  end loop;

  -- 5.5 ANON CANNOT EXECUTE ANY OF THEM. This is the exact regression to guard:
  --     a definer function reachable by anon would be an unauthenticated write.
  for v_txt in
    select unnest(array['save_admin_push_subscription(text,text,text,text,text)',
                        'delete_admin_push_subscription(text)',
                        'admin_push_state(text)'])
  loop
    if has_function_privilege('anon', 'public.' || v_txt, 'EXECUTE') then
      raise exception 'anon can execute %, which must never be true', v_txt;
    end if;
  end loop;

  -- 5.6 Every gate really is is_admin(). Role alone is not enough anywhere on an
  --     admin surface, and a body that dropped the check would still apply
  --     cleanly, so assert the text.
  for v_txt in
    select unnest(array['save_admin_push_subscription',
                        'delete_admin_push_subscription',
                        'admin_push_state'])
  loop
    select p.prosrc into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_txt;
    if v_src is null then
      raise exception '% has no body to check', v_txt;
    end if;
    if position('is_admin()' in v_src) = 0 then
      raise exception '% does not gate on is_admin()', v_txt;
    end if;
  end loop;

  -- 5.7 The VAPID column exists and is UNSET. Applying this configures nothing;
  --     the key is a separate owner action.
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'app_settings'
     and column_name = 'admin_push_vapid_public_key';
  if v_n <> 1 then
    raise exception 'admin_push_vapid_public_key was not added to app_settings';
  end if;
  select admin_push_vapid_public_key into v_txt from public.app_settings where id is true;
  if v_txt is not null then
    raise exception 'applying this migration must not configure a VAPID key';
  end if;

  -- 5.8 Both client roles can still read app_settings END TO END. Row 96's
  --     lesson: a column the client selects but cannot read fails the WHOLE
  --     select, and both clients read this table with select *.
  if not has_column_privilege('anon', 'public.app_settings', 'admin_push_vapid_public_key', 'SELECT') then
    raise exception 'anon cannot read the new app_settings column — every anon read would now fail';
  end if;
  if not has_column_privilege('authenticated', 'public.app_settings', 'admin_push_vapid_public_key', 'SELECT') then
    raise exception 'authenticated cannot read the new app_settings column';
  end if;

  -- 5.9 THE CUSTOMER PUSH CHANNEL IS NOT TOUCHED. Nothing added here may mention
  --     push_devices; if it ever does, the separation this design rests on is
  --     gone and a closure could reach a customer.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('save_admin_push_subscription',
                       'delete_admin_push_subscription',
                       'admin_push_state')
     and p.prosrc like '%push_devices%';
  if v_n <> 0 then
    raise exception 'an admin push RPC references push_devices; the two channels must stay separate';
  end if;

  -- 5.10 MONEY PATH UNCHANGED. New objects only.
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_txt is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'place_order moved to %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_txt, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;
end $$;
