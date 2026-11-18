-- ============================================================================
-- Advisor fixes (migration 20261017120000_advisor_fixes.sql).
--
-- Runs against a throwaway Postgres with the FULL migration chain applied.
-- Each case RAISES EXCEPTION on failure; a clean run prints NOTICEs and
-- commits nothing.
--
--   CASE 1  checkout_sessions_select_own is the wrapped own-or-staff policy:
--           SELECT, TO authenticated, permissive, no WITH CHECK, and both
--           auth.uid() and is_staff() behind a scalar SELECT (advisor 0003).
--   CASE 2  No policy in public calls auth.uid() per row.
--   CASE 3  Each of the 21 foreign keys the advisor reported on 2026-11-18 is
--           covered by its named single-column btree index (advisor 0001).
--   CASE 4  Who can read a checkout session did not change, by execution as
--           the real authenticated role: the owner sees their own, another
--           customer sees none of it, an administrator at aal2 sees both
--           customers' sessions, and an administrator at aal1 sees only their
--           own (none).
--   CASE 5  The money path is untouched.
--
-- On the base chain (without 20261017120000) CASE 1 fails first.
-- ============================================================================
begin;

-- ---- CASE 1: the policy --------------------------------------------------------
do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'checkout_sessions'
     and policyname = 'checkout_sessions_select_own'
     and cmd = 'SELECT' and roles = '{authenticated}'::name[]
     and permissive = 'PERMISSIVE' and with_check is null
     and qual = '((customer_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_staff() AS is_staff))';
  if v_n <> 1 then
    raise exception 'CASE 1 FAILED: checkout_sessions_select_own is not the wrapped own-or-staff SELECT policy for authenticated';
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'checkout_sessions';
  if v_n <> 1 then
    raise exception 'CASE 1 FAILED: % policies on checkout_sessions, expected 1', v_n;
  end if;
  raise notice 'CASE 1 ok: checkout_sessions_select_own evaluates auth.uid() and is_staff() once per statement';
end $$;

-- ---- CASE 2: no per-row auth.uid() anywhere in public --------------------------
do $$
declare v_bad text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public'
     and (   (length(coalesce(qual, '')) - length(replace(coalesce(qual, ''), 'auth.uid()', '')))
           <> (length(coalesce(qual, '')) - length(replace(coalesce(qual, ''), '( SELECT auth.uid() AS uid)', '')))
              * length('auth.uid()') / length('( SELECT auth.uid() AS uid)')
          or (length(coalesce(with_check, '')) - length(replace(coalesce(with_check, ''), 'auth.uid()', '')))
           <> (length(coalesce(with_check, '')) - length(replace(coalesce(with_check, ''), '( SELECT auth.uid() AS uid)', '')))
              * length('auth.uid()') / length('( SELECT auth.uid() AS uid)'));
  if v_bad is not null then
    raise exception 'CASE 2 FAILED: policies still call auth.uid() per row: %', v_bad;
  end if;
  raise notice 'CASE 2 ok: no policy in public calls auth.uid() per row';
end $$;

-- ---- CASE 3: the 21 covering indexes --------------------------------------------
do $$
declare
  v_n    integer;
  v_miss text := '';
  r      record;
begin
  for r in
    select * from (values
      ('admin_push_outbox',          'admin_push_outbox_branch_id_fkey',                 'admin_push_outbox_branch_id_idx'),
      ('app_settings',               'app_settings_payment_updated_by_fkey',             'app_settings_payment_updated_by_idx'),
      ('branch_availability_events', 'branch_availability_events_changed_by_fkey',       'branch_availability_events_changed_by_idx'),
      ('branch_availability_events', 'branch_availability_events_modifier_id_fkey',      'branch_availability_events_modifier_id_idx'),
      ('branch_delivery_events',     'branch_delivery_events_area_id_fkey',              'branch_delivery_events_area_id_idx'),
      ('branch_delivery_events',     'branch_delivery_events_changed_by_fkey',           'branch_delivery_events_changed_by_idx'),
      ('branch_delivery_requests',   'branch_delivery_requests_requested_by_fkey',       'branch_delivery_requests_requested_by_idx'),
      ('branch_delivery_requests',   'branch_delivery_requests_resolved_by_fkey',        'branch_delivery_requests_resolved_by_idx'),
      ('branch_reference_entries',   'branch_reference_entries_created_by_fkey',         'branch_reference_entries_created_by_idx'),
      ('branch_reference_reveals',   'branch_reference_reveals_revealed_by_fkey',        'branch_reference_reveals_revealed_by_idx'),
      ('checkout_sessions',          'checkout_sessions_branch_id_fkey',                 'checkout_sessions_branch_id_idx'),
      ('checkout_sessions',          'checkout_sessions_order_id_fkey',                  'checkout_sessions_order_id_idx'),
      ('comp_members',               'comp_members_added_by_fkey',                       'comp_members_added_by_idx'),
      ('integration_settings',       'integration_settings_updated_by_fkey',             'integration_settings_updated_by_idx'),
      ('loyalty_multipliers',        'loyalty_multipliers_branch_id_fkey',               'loyalty_multipliers_branch_id_idx'),
      ('loyalty_multipliers',        'loyalty_multipliers_category_id_fkey',             'loyalty_multipliers_category_id_idx'),
      ('loyalty_multipliers',        'loyalty_multipliers_updated_by_fkey',              'loyalty_multipliers_updated_by_idx'),
      ('order_integrity_incidents',  'order_integrity_incidents_payment_record_id_fkey', 'order_integrity_incidents_payment_record_id_idx'),
      ('order_integrity_incidents',  'order_integrity_incidents_session_id_fkey',        'order_integrity_incidents_session_id_idx'),
      ('order_refunds',              'order_refunds_payment_record_id_fkey',             'order_refunds_payment_record_id_idx'),
      ('staff_branch_assignments',   'staff_branch_assignments_assigned_by_fkey',        'staff_branch_assignments_assigned_by_idx')
    ) as x(tbl, fk, idx)
  loop
    select count(*) into v_n
      from pg_constraint c
      join pg_index i on i.indrelid = c.conrelid
      join pg_class ic on ic.oid = i.indexrelid
      join pg_am am on am.oid = ic.relam
     where c.contype = 'f' and c.conname = r.fk
       and c.conrelid = to_regclass('public.' || r.tbl)
       and array_length(c.conkey, 1) = 1
       and ic.relname = r.idx and ic.relnamespace = 'public'::regnamespace
       and am.amname = 'btree' and i.indisvalid and i.indisready
       and i.indpred is null and i.indexprs is null
       and i.indnkeyatts = 1 and i.indkey[0] = c.conkey[1];
    if v_n <> 1 then
      v_miss := v_miss || ' ' || r.tbl || '.' || r.fk;
    end if;
  end loop;
  if v_miss <> '' then
    raise exception 'CASE 3 FAILED: foreign keys without their covering index:%', v_miss;
  end if;
  raise notice 'CASE 3 ok: all 21 foreign keys have a covering btree index';
end $$;

-- ---- CASE 4: who can read a checkout session ------------------------------------
-- The harness replaces jwt_has_aal2() with true. Restore the production body
-- for this transaction so aal1 and aal2 differ.
create or replace function public.jwt_has_aal2()
returns boolean language sql stable set search_path = public as $$
  select public.aal_claim_satisfies_staff_mfa(auth.jwt() ->> 'aal');
$$;

create or replace function pg_temp.become(p_uid uuid, p_aal text) returns void
language plpgsql as $$
begin
  perform set_config('test.auth_uid', '', true);
  perform set_config('test.is_staff', '', true);
  perform set_config('test.is_admin', '', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  discard plans;
  set local role authenticated;
end $$;

create or replace function pg_temp.unbecome() returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- The fixture session ids visible to a caller, as a sorted text list.
create or replace function pg_temp.visible_as(p_uid uuid, p_aal text) returns text
language plpgsql as $$
declare v text;
begin
  perform pg_temp.become(p_uid, p_aal);
  select coalesce(string_agg(s.label, ',' order by s.label), '')
    into v
    from public.checkout_sessions cs
    join pg_temp.t_sessions s on s.id = cs.id;
  perform pg_temp.unbecome();
  return v;
end $$;

create temporary table t_actor (k text primary key, uid uuid not null);
create temporary table t_sessions (label text primary key, id uuid not null);
grant select on pg_temp.t_actor, pg_temp.t_sessions to authenticated;

do $$
declare
  v_branch uuid;
  v_id     uuid;
  r        record;
begin
  insert into t_actor (k, uid) values
    ('a', gen_random_uuid()), ('b', gen_random_uuid()), ('admin', gen_random_uuid());
  insert into auth.users (id, email, email_confirmed_at)
    select uid, k || '-advisorfix@example.test', now() from t_actor;
  update public.profiles set role = 'admin'
   where id = (select uid from t_actor where k = 'admin');

  select id into v_branch from public.branches order by id limit 1;
  if v_branch is null then
    raise exception 'CASE 4 setup: no branch to hang a session off';
  end if;

  for r in select * from (values ('a1', 'a'), ('a2', 'a'), ('b1', 'b')) as x(label, k) loop
    insert into public.checkout_sessions
      (customer_id, order_type, payment_method, branch_id, snapshot,
       subtotal, delivery_fee, total, status)
    values
      ((select uid from t_actor where k = r.k), 'pickup', 'online', v_branch,
       jsonb_build_object('items', jsonb_build_array(
         jsonb_build_object('product_id', gen_random_uuid(), 'quantity', 1))),
       10.00, 0.00, 10.00, 'expired')
    returning id into v_id;
    insert into t_sessions (label, id) values (r.label, v_id);
  end loop;
end $$;

do $$
declare
  v_a     uuid := (select uid from t_actor where k = 'a');
  v_b     uuid := (select uid from t_actor where k = 'b');
  v_admin uuid := (select uid from t_actor where k = 'admin');
  v       text;
begin
  v := pg_temp.visible_as(v_a, 'aal1');
  if v is distinct from 'a1,a2' then
    raise exception 'CASE 4 FAILED: customer A sees [%], expected [a1,a2]', v;
  end if;
  v := pg_temp.visible_as(v_b, 'aal1');
  if v is distinct from 'b1' then
    raise exception 'CASE 4 FAILED: customer B sees [%], expected [b1]', v;
  end if;
  v := pg_temp.visible_as(v_admin, 'aal2');
  if v is distinct from 'a1,a2,b1' then
    raise exception 'CASE 4 FAILED: an administrator at aal2 sees [%], expected [a1,a2,b1]', v;
  end if;
  v := pg_temp.visible_as(v_admin, 'aal1');
  if v is distinct from '' then
    raise exception 'CASE 4 FAILED: an administrator at aal1 sees [%], expected none', v;
  end if;
  raise notice 'CASE 4 ok: owners see their own sessions, staff at aal2 see all, aal1 staff see none';
end $$;

-- ---- CASE 5: the money path -----------------------------------------------------
do $$
declare v_txt text;
begin
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_txt is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'CASE 5 FAILED: place_order hashes %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_txt, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'CASE 5 FAILED: compute_order_snapshot hashes %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;
  raise notice 'CASE 5 ok: money path untouched';
end $$;

rollback;
