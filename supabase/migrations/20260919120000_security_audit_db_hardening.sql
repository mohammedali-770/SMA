-- 20260919120000_security_audit_db_hardening.sql
--
-- WHAT: five independent hardening items from the 2026-09-13 security audit.
-- They share a migration because each is small and none interacts with another;
-- every one is listed with the finding it closes.
--
-- MONEY PATH: untouched. `place_order` and `compute_order_snapshot` are neither
-- read nor redefined here.
--
-- NO DEPLOY IMPLIED: two function bodies change under unchanged signatures, so
-- existing callers bind to the new bodies.

-- ---------------------------------------------------------------------------
-- 1. Finding 2.5 — per-item order notes survive account deletion
-- ---------------------------------------------------------------------------
-- `anonymize_account_data` nulls orders.customer_name / customer_phone / notes /
-- address_snapshot, but never touched `order_items.note`. That column holds free
-- text the CUSTOMER typed per line -- in practice things like "villa 12, ring
-- twice, ask for Sara, call 05… if closed". So a customer exercised their PDPL
-- erasure right, the processor reported success, and their address and phone
-- stayed readable indefinitely by every admin and accountant through
-- `admin_list_orders_with_items`, and by anyone holding a database backup.
--
-- The operator had told the data subject in writing that this was removed.
--
-- Derived from `20260827110000_comp_erasure.sql` by anchored substitution.
create or replace function public.anonymize_account_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw_phone        text;
  v_phone            text;
  v_orders_anon      integer := 0;
  v_addresses        integer := 0;
  v_devices          integer := 0;
  v_sessions         integer := 0;
  v_loyalty          integer := 0;
  v_otp              integer := 0;
  v_logs             integer := 0;
  v_comp             integer := 0;
  v_comp_unclaimed   integer := 0;
  v_comp_audit       integer := 0;
begin
  if p_user_id is null then
    raise exception 'user id required' using errcode = '22004';
  end if;

  -- auth.users.phone FIRST: it is set by verified OTP and is not writable by the
  -- customer, whereas profiles.phone_number was in the `authenticated` update
  -- grant until this migration. Fall back to the profile so an account whose
  -- Auth row has already lost its phone still purges.
  select u.phone into v_raw_phone from auth.users u where u.id = p_user_id;
  if v_raw_phone is null or btrim(v_raw_phone) = '' then
    select p.phone_number into v_raw_phone from public.profiles p where p.id = p_user_id;
  end if;

  v_phone := public.normalize_ksa_e164(v_raw_phone);

  update public.orders
     set customer_name    = null,
         customer_phone   = null,
         notes            = null,
         address_snapshot = null
   where customer_id = p_user_id
     and (customer_name is not null
       or customer_phone is not null
       or notes is not null
       or address_snapshot is not null);
  get diagnostics v_orders_anon = row_count;

  -- THE PER-ITEM NOTE. Added 2026-09-14 (audit finding 2.5). Same class of data
  -- as orders.notes -- customer free text, in practice often an address or a
  -- phone number -- and it was the one copy erasure left behind.
  update public.order_items oi
     set note = null
   where oi.note is not null
     and oi.order_id in (select o.id from public.orders o where o.customer_id = p_user_id);

  delete from public.addresses where customer_id = p_user_id;
  get diagnostics v_addresses = row_count;

  delete from public.push_devices where customer_id = p_user_id;
  get diagnostics v_devices = row_count;

  delete from public.checkout_sessions where customer_id = p_user_id;
  get diagnostics v_sessions = row_count;

  delete from public.loyalty_transactions where profile_id = p_user_id;
  get diagnostics v_loyalty = row_count;

  -- The claimed membership, by FK. Deleting it here rather than relying on the
  -- cascade matters for the anonymize-without-delete path: a comp that outlived
  -- its account would silently re-apply if the number were ever re-registered.
  delete from public.comp_members where profile_id = p_user_id;
  get diagnostics v_comp = row_count;

  -- Phone-keyed rows carry no FK to the user, so they are matched by value.
  -- BOTH sides are normalized: the stored column may predate the normalizer, and
  -- the source may or may not carry a '+' depending on which trigger wrote it.
  if v_phone is not null then
    delete from public.otp_challenges
     where public.normalize_ksa_e164(phone_e164) = v_phone;
    get diagnostics v_otp = row_count;

    delete from public.whatsapp_message_logs
     where public.normalize_ksa_e164(phone_e164) = v_phone;
    get diagnostics v_logs = row_count;

    -- An unclaimed comp for this number: no FK, so no cascade would reach it.
    delete from public.comp_members
     where profile_id is null
       and public.normalize_ksa_e164(phone_e164) = v_phone;
    get diagnostics v_comp_unclaimed = row_count;

    -- Keep the audit row, drop the number from it.
    update public.comp_member_audit
       set target_phone = null
     where public.normalize_ksa_e164(target_phone) = v_phone;
    get diagnostics v_comp_audit = row_count;
  end if;

  return jsonb_build_object(
    'orders_anonymized', v_orders_anon,
    'addresses_deleted', v_addresses,
    'push_devices_deleted', v_devices,
    'checkout_sessions_deleted', v_sessions,
    'loyalty_transactions_deleted', v_loyalty,
    'otp_challenges_purged', v_otp,
    'whatsapp_logs_purged', v_logs,
    'comp_memberships_deleted', v_comp + v_comp_unclaimed,
    'comp_audit_phones_cleared', v_comp_audit,
    -- Was `phone_purged`, which reported true whenever a phone STRING existed
    -- rather than when anything was deleted — a purge the summary claimed but
    -- had not performed. The two counts above are the honest record; this flag
    -- now says only whether a usable Saudi mobile was resolved to purge BY.
    'phone_purge_attempted', (v_phone is not null)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 2. Finding 2.8 — deactivate_push_device silences ANY device by token alone
-- ---------------------------------------------------------------------------
-- It authorized on `auth.uid() is not null` and then updated by token with no
-- ownership test, so any signed-in customer holding another customer's Expo
-- token could switch that person's notifications off. They would simply stop
-- receiving order updates, with nothing to see and nothing to undo.
--
-- WHY THIS ONE AND NOT register_push_device. The reassignment in
-- `register_push_device` exists for a documented, real case: a shared handset
-- changing hands, where the new signed-in customer must take over targeting.
-- Removing it would break that. Silencing, by contrast, has no equivalent
-- justification -- there is no legitimate flow in which customer A needs to
-- deactivate a row owned by customer B. So the ownership requirement lands here,
-- where it costs nothing, and `register_push_device` keeps its documented
-- behaviour. That asymmetry is deliberate, not an oversight.
--
-- The shared-handset sign-out still works: `usePushDeviceSync` calls this while
-- the caller still owns the row.
create or replace function public.deactivate_push_device(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- Scoped to the caller's own row. A token belonging to somebody else simply
  -- matches nothing: no error, because telling the caller whether a token exists
  -- would make this an oracle for which tokens are registered.
  update public.push_devices
     set is_active = false
   where expo_push_token = trim(p_token)
     and customer_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Finding 2 (hardening) — redundant anon write grants
-- ---------------------------------------------------------------------------
-- Eleven tables carried table-level INSERT/UPDATE/DELETE for `anon`. RLS denies
-- every one of those writes today, because no policy on any of these tables
-- matches the anon role and RLS default-denies when nothing matches -- so this
-- was never exploitable. It is removed anyway: the grants are pure surplus, and
-- they mean a single carelessly written future policy turns into an anonymous
-- write. Defence in depth is worth more than the zero lines of code it costs.
--
-- SELECT for anon is deliberately KEPT: the public menu, branch list and
-- availability are read by signed-out customers browsing the app.
revoke insert, update, delete on public.branches                     from anon;
revoke insert, update, delete on public.categories                   from anon;
revoke insert, update, delete on public.products                     from anon;
revoke insert, update, delete on public.product_variants             from anon;
revoke insert, update, delete on public.modifiers                    from anon;
revoke insert, update, delete on public.modifier_groups              from anon;
revoke insert, update, delete on public.product_modifier_groups      from anon;
revoke insert, update, delete on public.branch_product_availability  from anon;
revoke insert, update, delete on public.branch_modifier_availability from anon;
revoke insert, update, delete on public.notification_log             from anon;
revoke insert, update, delete on public.push_devices                 from anon;

-- ---------------------------------------------------------------------------
-- 4. Platform advisor — two functions with a mutable search_path
-- ---------------------------------------------------------------------------
-- Supabase's linter flags these generically. NEITHER is SECURITY DEFINER -- one
-- is a pure date helper and the other a trigger function -- so neither is an
-- escalation primitive and this is hygiene rather than a vulnerability. Pinning
-- the path costs nothing and clears the advisor, so the real finding is not
-- buried under a known-benign warning.
alter function public.loyalty_next_expiry_on(date, integer, integer, integer) set search_path = public;
alter function public.set_loyalty_expiry_next_run() set search_path = public;

-- ---------------------------------------------------------------------------
-- 5. Finding 2.7 — the Promo Codes panel cannot load against Production
-- ---------------------------------------------------------------------------
-- `couponsApi.usageByCode()` does `from('orders').select('coupon_code')`, and
-- `authenticated` holds no SELECT grant on that column, so the admin screen
-- errors out entirely against Production.
--
-- THE FIRST ATTEMPT AT THIS WAS WRONG AND THE TEST SUITE CAUGHT IT. It granted
-- `select (coupon_code) on orders to authenticated`, which fixed the panel and
-- simultaneously widened what every CUSTOMER can read.
-- `order_read_contracts_test` CASE 1 pins the exact column set a customer may
-- see and failed immediately: "customer may read UNEXPECTED columns:
-- {coupon_code}". That test is doing precisely its job — `orders` exposes a
-- deliberate column allowlist, with customer_id / customer_name /
-- customer_phone held outside it, and an admin convenience is no reason to
-- widen a customer-facing contract.
--
-- So the read moves behind an admin gate instead. Same data, no new column
-- exposure, and the aggregate is computed in the database rather than by
-- shipping every order's coupon code to the browser to be counted there.
create or replace function public.admin_coupon_usage_counts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins may read coupon usage' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(code, n), '{}'::jsonb)
    into v_out
    from (
      select upper(btrim(o.coupon_code)) as code, count(*) as n
        from public.orders o
       where o.coupon_code is not null
         and btrim(o.coupon_code) <> ''
       group by 1
    ) t;

  return v_out;
end;
$$;

revoke all on function public.admin_coupon_usage_counts() from public, anon;
grant execute on function public.admin_coupon_usage_counts() to authenticated;

comment on function public.admin_coupon_usage_counts() is
  'Per-code order counts for the Promo Codes panel. Admin-gated (role AND AAL2) so the orders.coupon_code column need not be exposed to every authenticated client.';

-- ---------------------------------------------------------------------------
-- 6. Self-verification
-- ---------------------------------------------------------------------------
-- A plpgsql body is not name-resolved at creation, so a clean apply proves only
-- that the text was stored. Each assertion below names a specific way one of the
-- five items could have gone wrong, and is written to be able to fail.
do $verify$
declare
  v_src text;
  v_n   integer;
begin
  -- (1) Erasure must clear the per-item note, and must not have lost anything.
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'anonymize_account_data';
  if v_src is null then
    raise exception 'anonymize_account_data is missing';
  end if;
  if v_src not like '%update public.order_items%' or v_src not like '%set note = null%' then
    raise exception 'erasure does not clear order_items.note';
  end if;
  if v_src not like '%delete from public.addresses%'
     or v_src not like '%delete from public.push_devices%'
     or v_src not like '%delete from public.loyalty_transactions%'
     or v_src not like '%delete from public.otp_challenges%'
     or v_src not like '%delete from public.whatsapp_message_logs%'
     or v_src not like '%comp_member_audit%' then
    raise exception 'erasure lost one of its existing cleanups';
  end if;

  -- (2) Silencing must be owner-scoped; reassignment must still be possible.
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'deactivate_push_device';
  if v_src not like '%customer_id = auth.uid()%' then
    raise exception 'deactivate_push_device is still unscoped';
  end if;
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'register_push_device';
  if v_src not like '%on conflict (expo_push_token) do update%' then
    raise exception 'register_push_device lost the shared-handset reassignment';
  end if;

  -- (3) No anon write grant may survive on any of the eleven tables, and anon
  --     must KEEP select on the public catalog.
  select count(*) into v_n
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee = 'anon'
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
     and table_name in ('branches','categories','products','product_variants','modifiers',
                        'modifier_groups','product_modifier_groups','branch_product_availability',
                        'branch_modifier_availability','notification_log','push_devices');
  if v_n <> 0 then
    raise exception 'anon still holds % write grant(s)', v_n;
  end if;
  if not has_table_privilege('anon', 'public.products', 'SELECT') then
    raise exception 'anon lost SELECT on products -- the signed-out menu would break';
  end if;

  -- (4) Both flagged functions must now pin search_path.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('loyalty_next_expiry_on', 'set_loyalty_expiry_next_run')
     and p.proconfig is not null
     and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
  if v_n <> 2 then
    raise exception 'expected 2 functions with a pinned search_path, found %', v_n;
  end if;

  -- (5) The RPC exists and is admin-gated, and the customer column contract is
  --     UNCHANGED -- including coupon_code, which the first version of this
  --     migration wrongly granted.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_coupon_usage_counts';
  if v_n <> 1 then
    raise exception 'admin_coupon_usage_counts is missing or overloaded (%)', v_n;
  end if;
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_coupon_usage_counts';
  if v_src not like '%is_admin()%' then
    raise exception 'admin_coupon_usage_counts is not admin-gated';
  end if;
  if has_function_privilege('anon', 'public.admin_coupon_usage_counts()', 'EXECUTE') then
    raise exception 'admin_coupon_usage_counts is reachable by anon';
  end if;
  if has_column_privilege('authenticated', 'public.orders', 'coupon_code', 'SELECT')
     or has_column_privilege('authenticated', 'public.orders', 'customer_phone', 'SELECT')
     or has_column_privilege('authenticated', 'public.orders', 'customer_name', 'SELECT')
     or has_column_privilege('authenticated', 'public.orders', 'customer_id', 'SELECT') then
    raise exception 'the orders column allowlist for authenticated was widened';
  end if;

  raise notice 'security hardening applied: erasure, push scoping, anon grants, search_path, coupon_code';
end
$verify$;
