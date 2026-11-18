-- ============================================================================
-- ADVISOR FIXES — one RLS init-plan and 21 foreign keys without a covering index
--
-- The owner asked on 2026-11-18 for Supabase's advisors to be run and anything
-- new fixed. Read live 2026-11-18 (performance advisor):
--
--   0003 auth_rls_initplan            WARN   1   -> fixed here (section 1)
--   0001 unindexed_foreign_keys       INFO  21   -> fixed here (section 2)
--   0005 unused_index                 INFO  30   -> NOT changed, see below
--   0006 multiple_permissive_policies WARN  16   -> NOT changed, see below
--
-- Expected after apply: 0003 1 -> 0 and 0001 21 -> 0. This file changes exactly
-- what is listed below and nothing else.
--
-- 1. checkout_sessions_select_own called auth.uid() and is_staff() once per
--    row. Live and on the local chain it reads
--
--      ((customer_id = auth.uid()) OR is_staff())     TO authenticated, SELECT
--
--    It now reads
--
--      ((customer_id = (select auth.uid())) OR (select public.is_staff()))
--
--    Each scalar SELECT is an InitPlan, evaluated once per statement. auth.uid()
--    and is_staff() are STABLE and depend only on the caller's JWT and profile,
--    so neither can differ between rows of one statement: the visible rows are
--    the same for every caller. is_staff() is wrapped too, for the reason
--    20261006120000 gave for the three own-or-staff policies it fixed — a
--    SECURITY DEFINER SQL function is never inlined, so a bare call runs per
--    row. That file deliberately left this policy alone because it belonged to
--    the then-frozen payment path; the freeze no longer covers repository work
--    that keeps Moyasar the only provider (CLAUDE.md §6), and this changes no
--    payment behaviour.
--
--    ALTER POLICY ... USING, not DROP/CREATE: the policy keeps its name, its
--    command (SELECT), its role (authenticated), its permissiveness and its
--    absent WITH CHECK. All five are asserted below, before and after.
--
-- 2. 21 foreign keys get a covering btree index, named <table>_<column>_idx.
--    Eleven reference profiles(id) or auth.users(id) through a *_by column;
--    deleting a profile or an auth user (account deletion) checks every
--    referencing table, and without an index that check scans the table.
--    Plain CREATE INDEX IF NOT EXISTS, not CONCURRENTLY: a migration runs in a
--    transaction, and every one of these tables is small — read live
--    2026-11-18, the largest is branch_availability_events at 26 rows and
--    eight of the fourteen tables hold no row at all — so the brief SHARE lock
--    is not a concern.
--
-- WHAT THIS DOES NOT DO
--   - It drops no index. The 30 0005 "unused" findings are not evidence: the
--     project is in a testing phase with little traffic, so an index that has
--     not been used yet says nothing about whether it will be.
--   - It does not merge any of the 16 0006 findings. They are the deliberate
--     public/staff policy splits (active rows for everyone, inactive rows for
--     staff; see 20260930120000 for why product_variants was split), and
--     merging them would change who can read what.
--   - It touches no other policy, asserted: every policy other than
--     checkout_sessions_select_own hashes the same before and after.
--   - It redefines no function, writes no row, and changes no grant.
--   - MONEY PATH UNTOUCHED: place_order and compute_order_snapshot must still
--     hash 12b6816d256c29b76edf947ae1a7ea77 / 22e2d42935459e7bf93abb2941b56325
--     (md5(pg_get_functiondef(oid))), before and after.
--
-- NOT APPLIED TO PRODUCTION by this change. Applying it is a CLAUDE.md §5
-- action, named by version: "apply 20261017120000".
--
-- NO DEPLOY IMPLIED. No client reads a policy's text or names an index.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Preconditions. Fail before changing anything.
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_n   integer;
  v_txt text;
  r     record;
begin
  -- The policy is the shape this file was written against: the pre-image, or
  -- on a re-run the post-image.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'checkout_sessions'
     and policyname = 'checkout_sessions_select_own'
     and cmd = 'SELECT' and roles = '{authenticated}'::name[]
     and permissive = 'PERMISSIVE' and with_check is null
     and qual in (
       '((customer_id = auth.uid()) OR is_staff())',
       '((customer_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_staff() AS is_staff))');
  if v_n <> 1 then
    raise exception 'advisor fixes: checkout_sessions_select_own is not the shape this file was written against';
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'checkout_sessions';
  if v_n <> 1 then
    raise exception 'advisor fixes: expected exactly one policy on checkout_sessions, found %', v_n;
  end if;
  if not has_function_privilege('authenticated', 'public.is_staff()', 'execute') then
    raise exception 'advisor fixes: authenticated cannot execute is_staff()';
  end if;

  -- Each foreign key exists, on the one column this file indexes.
  for r in
    select * from (values
      ('admin_push_outbox',          'admin_push_outbox_branch_id_fkey',                 'branch_id'),
      ('app_settings',               'app_settings_payment_updated_by_fkey',             'payment_updated_by'),
      ('branch_availability_events', 'branch_availability_events_changed_by_fkey',       'changed_by'),
      ('branch_availability_events', 'branch_availability_events_modifier_id_fkey',      'modifier_id'),
      ('branch_delivery_events',     'branch_delivery_events_area_id_fkey',              'area_id'),
      ('branch_delivery_events',     'branch_delivery_events_changed_by_fkey',           'changed_by'),
      ('branch_delivery_requests',   'branch_delivery_requests_requested_by_fkey',       'requested_by'),
      ('branch_delivery_requests',   'branch_delivery_requests_resolved_by_fkey',        'resolved_by'),
      ('branch_reference_entries',   'branch_reference_entries_created_by_fkey',         'created_by'),
      ('branch_reference_reveals',   'branch_reference_reveals_revealed_by_fkey',        'revealed_by'),
      ('checkout_sessions',          'checkout_sessions_branch_id_fkey',                 'branch_id'),
      ('checkout_sessions',          'checkout_sessions_order_id_fkey',                  'order_id'),
      ('comp_members',               'comp_members_added_by_fkey',                       'added_by'),
      ('integration_settings',       'integration_settings_updated_by_fkey',             'updated_by'),
      ('loyalty_multipliers',        'loyalty_multipliers_branch_id_fkey',               'branch_id'),
      ('loyalty_multipliers',        'loyalty_multipliers_category_id_fkey',             'category_id'),
      ('loyalty_multipliers',        'loyalty_multipliers_updated_by_fkey',              'updated_by'),
      ('order_integrity_incidents',  'order_integrity_incidents_payment_record_id_fkey', 'payment_record_id'),
      ('order_integrity_incidents',  'order_integrity_incidents_session_id_fkey',        'session_id'),
      ('order_refunds',              'order_refunds_payment_record_id_fkey',             'payment_record_id'),
      ('staff_branch_assignments',   'staff_branch_assignments_assigned_by_fkey',        'assigned_by')
    ) as x(tbl, fk, col)
  loop
    select count(*) into v_n
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.conname = r.fk
       and c.conrelid = to_regclass('public.' || r.tbl)
       and array_length(c.conkey, 1) = 1 and a.attname = r.col;
    if v_n <> 1 then
      raise exception 'advisor fixes: foreign key %.% on (%) is missing or not single-column', r.tbl, r.fk, r.col;
    end if;
  end loop;

  -- The money path, before anything changes.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('place_order', 'compute_order_snapshot');
  if v_n <> 2 then
    raise exception 'advisor fixes: expected one place_order and one compute_order_snapshot, found % functions', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_txt is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'advisor fixes: place_order hashes %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_txt, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'advisor fixes: compute_order_snapshot hashes %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;
end
$pre$;

-- What the verification compares against: every other policy, and every
-- index that already existed. Dropped at the end of the file.
create temporary table if not exists advisor_fixes_20261017_pre (k text primary key, v text);
truncate advisor_fixes_20261017_pre;
insert into advisor_fixes_20261017_pre (k, v)
select 'other_policies',
       md5(string_agg(
             concat_ws('|', schemaname, tablename, policyname, permissive, roles::text,
                       cmd, coalesce(qual, '<null>'), coalesce(with_check, '<null>')),
             E'\n' order by schemaname, tablename, policyname))
  from pg_policies
 where (schemaname, tablename, policyname) <> ('public', 'checkout_sessions', 'checkout_sessions_select_own')
union all
select 'existing_indexes',
       md5(string_agg(schemaname || '.' || indexname || '|' || indexdef, E'\n' order by schemaname, indexname))
  from pg_indexes
 where schemaname = 'public'
   and indexname not in (
     'admin_push_outbox_branch_id_idx', 'app_settings_payment_updated_by_idx',
     'branch_availability_events_changed_by_idx', 'branch_availability_events_modifier_id_idx',
     'branch_delivery_events_area_id_idx', 'branch_delivery_events_changed_by_idx',
     'branch_delivery_requests_requested_by_idx', 'branch_delivery_requests_resolved_by_idx',
     'branch_reference_entries_created_by_idx', 'branch_reference_reveals_revealed_by_idx',
     'checkout_sessions_branch_id_idx', 'checkout_sessions_order_id_idx',
     'comp_members_added_by_idx', 'integration_settings_updated_by_idx',
     'loyalty_multipliers_branch_id_idx', 'loyalty_multipliers_category_id_idx',
     'loyalty_multipliers_updated_by_idx', 'order_integrity_incidents_payment_record_id_idx',
     'order_integrity_incidents_session_id_idx', 'order_refunds_payment_record_id_idx',
     'staff_branch_assignments_assigned_by_idx');


-- ---------------------------------------------------------------------------
-- 1. 0003 auth_rls_initplan — auth.uid() and is_staff() once per statement
-- ---------------------------------------------------------------------------
alter policy checkout_sessions_select_own on public.checkout_sessions
  using ((customer_id = (select auth.uid())) or (select public.is_staff()));


-- ---------------------------------------------------------------------------
-- 2. 0001 unindexed_foreign_keys — one covering btree index per foreign key
-- ---------------------------------------------------------------------------
create index if not exists admin_push_outbox_branch_id_idx                 on public.admin_push_outbox (branch_id);
create index if not exists app_settings_payment_updated_by_idx             on public.app_settings (payment_updated_by);
create index if not exists branch_availability_events_changed_by_idx       on public.branch_availability_events (changed_by);
create index if not exists branch_availability_events_modifier_id_idx      on public.branch_availability_events (modifier_id);
create index if not exists branch_delivery_events_area_id_idx              on public.branch_delivery_events (area_id);
create index if not exists branch_delivery_events_changed_by_idx           on public.branch_delivery_events (changed_by);
create index if not exists branch_delivery_requests_requested_by_idx       on public.branch_delivery_requests (requested_by);
create index if not exists branch_delivery_requests_resolved_by_idx        on public.branch_delivery_requests (resolved_by);
create index if not exists branch_reference_entries_created_by_idx         on public.branch_reference_entries (created_by);
create index if not exists branch_reference_reveals_revealed_by_idx        on public.branch_reference_reveals (revealed_by);
create index if not exists checkout_sessions_branch_id_idx                 on public.checkout_sessions (branch_id);
create index if not exists checkout_sessions_order_id_idx                  on public.checkout_sessions (order_id);
create index if not exists comp_members_added_by_idx                       on public.comp_members (added_by);
create index if not exists integration_settings_updated_by_idx             on public.integration_settings (updated_by);
create index if not exists loyalty_multipliers_branch_id_idx               on public.loyalty_multipliers (branch_id);
create index if not exists loyalty_multipliers_category_id_idx             on public.loyalty_multipliers (category_id);
create index if not exists loyalty_multipliers_updated_by_idx              on public.loyalty_multipliers (updated_by);
create index if not exists order_integrity_incidents_payment_record_id_idx on public.order_integrity_incidents (payment_record_id);
create index if not exists order_integrity_incidents_session_id_idx        on public.order_integrity_incidents (session_id);
create index if not exists order_refunds_payment_record_id_idx             on public.order_refunds (payment_record_id);
create index if not exists staff_branch_assignments_assigned_by_idx        on public.staff_branch_assignments (assigned_by);


-- ---------------------------------------------------------------------------
-- 3. Self-verification. Outcomes, not statements.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_n   integer;
  v_txt text;
  r     record;
begin
  -- 3.1 The policy: same name, command, role, permissiveness and absent WITH
  --     CHECK; the qual is the wrapped form. Exactly one policy on the table.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'checkout_sessions'
     and policyname = 'checkout_sessions_select_own'
     and cmd = 'SELECT' and roles = '{authenticated}'::name[]
     and permissive = 'PERMISSIVE' and with_check is null
     and qual = '((customer_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_staff() AS is_staff))';
  if v_n <> 1 then
    raise exception 'advisor fixes verification failed: checkout_sessions_select_own is not the wrapped own-or-staff SELECT policy for authenticated';
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'checkout_sessions';
  if v_n <> 1 then
    raise exception 'advisor fixes verification failed: % policies on checkout_sessions', v_n;
  end if;
  select count(*) into v_n from pg_class
   where oid = 'public.checkout_sessions'::regclass and relrowsecurity;
  if v_n <> 1 then
    raise exception 'advisor fixes verification failed: RLS is not enabled on checkout_sessions';
  end if;

  -- 3.2 The 0003 outcome across the schema: no policy in public calls
  --     auth.uid() other than through a scalar SELECT.
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and (   (length(coalesce(qual, '')) - length(replace(coalesce(qual, ''), 'auth.uid()', '')))
           <> (length(coalesce(qual, '')) - length(replace(coalesce(qual, ''), '( SELECT auth.uid() AS uid)', '')))
              * length('auth.uid()') / length('( SELECT auth.uid() AS uid)')
          or (length(coalesce(with_check, '')) - length(replace(coalesce(with_check, ''), 'auth.uid()', '')))
           <> (length(coalesce(with_check, '')) - length(replace(coalesce(with_check, ''), '( SELECT auth.uid() AS uid)', '')))
              * length('auth.uid()') / length('( SELECT auth.uid() AS uid)'));
  if v_n <> 0 then
    raise exception 'advisor fixes verification failed: % policies in public still call auth.uid() per row', v_n;
  end if;

  -- 3.3 No other policy moved.
  select md5(string_agg(
           concat_ws('|', schemaname, tablename, policyname, permissive, roles::text,
                     cmd, coalesce(qual, '<null>'), coalesce(with_check, '<null>')),
           E'\n' order by schemaname, tablename, policyname))
    into v_txt
    from pg_policies
   where (schemaname, tablename, policyname) <> ('public', 'checkout_sessions', 'checkout_sessions_select_own');
  if v_txt is distinct from (select v from advisor_fixes_20261017_pre where k = 'other_policies') then
    raise exception 'advisor fixes verification failed: a policy other than checkout_sessions_select_own changed';
  end if;

  -- 3.4 Each of the 21 foreign keys is covered by its named index: a valid,
  --     ready, non-partial, non-expression btree whose single key column is
  --     the foreign key's column.
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
       and ic.relname = r.idx and ic.relnamespace = 'public'::regnamespace
       and am.amname = 'btree' and i.indisvalid and i.indisready
       and i.indpred is null and i.indexprs is null
       and i.indnkeyatts = 1 and i.indkey[0] = c.conkey[1];
    if v_n <> 1 then
      raise exception 'advisor fixes verification failed: %.% is not covered by index %', r.tbl, r.fk, r.idx;
    end if;
  end loop;

  -- 3.5 The 0001 outcome across the schema, on the advisor's own rule: every
  --     foreign key in public has an index whose leading columns are exactly
  --     the foreign key's columns. Like the advisor, this counts a PARTIAL
  --     index as covering; nine foreign keys on the local chain are covered
  --     only that way, and this file leaves them alone.
  select count(*) into v_n
    from pg_constraint c
   where c.contype = 'f'
     and c.connamespace = 'public'::regnamespace
     and not exists (
       select 1 from pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey);
  if v_n <> 0 then
    raise exception 'advisor fixes verification failed: % foreign keys in public still have no covering index', v_n;
  end if;

  -- 3.6 Indexes only added: every index that existed before is unchanged.
  select md5(string_agg(schemaname || '.' || indexname || '|' || indexdef, E'\n' order by schemaname, indexname))
    into v_txt
    from pg_indexes
   where schemaname = 'public'
     and indexname not in (
       'admin_push_outbox_branch_id_idx', 'app_settings_payment_updated_by_idx',
       'branch_availability_events_changed_by_idx', 'branch_availability_events_modifier_id_idx',
       'branch_delivery_events_area_id_idx', 'branch_delivery_events_changed_by_idx',
       'branch_delivery_requests_requested_by_idx', 'branch_delivery_requests_resolved_by_idx',
       'branch_reference_entries_created_by_idx', 'branch_reference_reveals_revealed_by_idx',
       'checkout_sessions_branch_id_idx', 'checkout_sessions_order_id_idx',
       'comp_members_added_by_idx', 'integration_settings_updated_by_idx',
       'loyalty_multipliers_branch_id_idx', 'loyalty_multipliers_category_id_idx',
       'loyalty_multipliers_updated_by_idx', 'order_integrity_incidents_payment_record_id_idx',
       'order_integrity_incidents_session_id_idx', 'order_refunds_payment_record_id_idx',
       'staff_branch_assignments_assigned_by_idx');
  if v_txt is distinct from (select v from advisor_fixes_20261017_pre where k = 'existing_indexes') then
    raise exception 'advisor fixes verification failed: an index that existed before this file changed or disappeared';
  end if;

  -- 3.7 The money path is untouched.
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

  raise notice 'advisor fixes: checkout_sessions_select_own evaluates auth.uid() and is_staff() once per statement, and every foreign key in public has a covering index';
end
$verify$;

drop table if exists advisor_fixes_20261017_pre;
