-- ============================================================================
-- AUDIT TRAIL: who changed an order's status, who sent a broadcast and what it
-- said, and who reset or deleted a staff account or edited the menu, prices,
-- coupons or settings.
--
-- App-hardening checklist gaps S09#1, S09#2 and S09#3. Each was measured on the
-- local chain before this file was written.
--
-- ---- PART 1 (S09#1): order_status_audit ------------------------------------
--
-- WHAT WAS MISSING. order_change_events holds id, order_id, event and
-- created_at, nothing else, and orders has no actor column.
-- admin_set_order_status writes an actor (loyalty_transactions.created_by) only
-- when loyalty moves. A POS webhook update of lazywait_status writes the same
-- 'update' event row as a human status change, so the two could not be told
-- apart.
--
-- WHAT THIS ADDS. An append-only table, written by an AFTER UPDATE OF status
-- row trigger on orders that fires only when the status really changes
-- (WHEN old.status IS DISTINCT FROM new.status). It records old and new
-- status, auth.uid() as changed_by, the actor's profiles.role, and
-- source = 'automatic' when there is no auth.uid() (service role, cron,
-- migration), 'manual' otherwise. That is the rule
-- emit_branch_availability_event already uses. auth.uid() is the JWT subject,
-- not current_user, so it is still the admin inside the SECURITY DEFINER
-- admin_set_order_status.
--
-- THE TRIGGER-FAILURE POLICY, and why there is no exception handler. A trigger
-- that can block a kitchen or POS status change is worse than an audit that
-- drops a row, and an audit that drops rows silently is weak. So the insert is
-- made unable to fail rather than wrapped:
--   * no foreign keys. order_id cannot reference a missing order (the trigger
--     runs AFTER the row is written), and a key to profiles would either block
--     a staff deletion (NO ACTION, the defect 20261002120000 fixed) or erase
--     the actor the row exists to keep (SET NULL);
--   * no unique constraint apart from an identity primary key;
--   * every NOT NULL column is filled from a value that is already NOT NULL
--     (new.id, new.status) or from a constant;
--   * the one CHECK (source) is satisfied by construction: the function writes
--     one of its two literals;
--   * actor_role is text, so a role the enum later drops cannot fail a cast;
--   * auth.uid() and the profiles read are the same calls is_admin() makes
--     earlier in the same statement, so if they could fail, the status update
--     would already have failed before this trigger ran.
-- What remains is out of disk or out of memory, under which the status update
-- itself fails anyway. An EXCEPTION block would add a subtransaction to every
-- status change, to catch errors that cannot happen.
--
-- ---- PART 2 (S09#2): notification_log.sent_by and .content ------------------
--
-- WHAT WAS MISSING. push-dispatch's broadcast arm established the verified
-- admin id and then did not use it, and its notification_log row carried only
-- kind = 'broadcast' and the delivery counts. A broadcast reaches every opted-in
-- device and cannot be recalled, and nothing recorded who sent it or what it
-- said.
--
-- WHAT THIS ADDS. Two nullable columns: sent_by uuid and content jsonb. The
-- handler writes them for a broadcast. No foreign key, for the reason in
-- part 1. Reads do not widen: notification_log keeps its one policy,
-- notification_log_admin_select (authenticated, is_admin()), and no write
-- policy, so a client write is still refused by RLS. The file asserts that.
--
-- DEPLOY ORDER: APPLY THIS FILE FIRST, THEN DEPLOY push-dispatch. A handler
-- that names these columns before they exist gets PGRST204 from PostgREST. The
-- handler falls back to the old row shape on that error, and never turns a
-- failed log write into an error response, because a broadcast the admin is
-- told failed may be sent again, and it cannot be recalled.
--
-- ---- PART 3 (S09#3): admin_action_audit ------------------------------------
--
-- WHAT WAS MISSING. staff-accounts resets a staff password and deletes a staff
-- account through the service-role Admin API and wrote no row (auth's own
-- audit_log_entries was read empty in Production). products, product_variants,
-- coupons, categories and app_settings are written directly by admins under
-- RLS, and the only trigger on products was set_updated_at.
--
-- WHAT THIS ADDS. One append-only table, written two ways:
--   (a) record_admin_action(...), a SECURITY DEFINER function that only
--       service_role can execute. staff-accounts calls it after the Admin API
--       call has succeeded, passing the caller id it has already verified. It
--       accepts two actions and refuses a detail with a password-, secret- or
--       token-like key anywhere in it. No password is ever passed.
--   (b) AFTER INSERT OR UPDATE OR DELETE row triggers on the five tables. Each
--       records auth.uid() (null = system or migration), the role, the NAMES
--       of the changed columns (OLD and NEW compared as jsonb), and VALUES only
--       for an allowlist given to that table's trigger: prices, flags, limits,
--       ordering. Every other column is recorded by name only, so a column
--       added later is name-only until somebody decides otherwise. The file
--       asserts that no allowlisted name looks like a key, secret, token or
--       password.
--   An UPDATE that changes nothing but updated_at or created_at writes no row.
--   Neither does coupons.usage_count on its own, which place_order and a
--   cancellation move on every order with a coupon, and which is order
--   bookkeeping, not an admin edit. The same goes for app_settings'
--   payment_updated_at, payment_updated_by and loyalty_expiry_next_run_on,
--   which other code sets alongside a real change or on a schedule.
-- The trigger-failure policy is part 1's: no foreign keys, no constraints the
-- function can violate.
--
-- APPEND-ONLY IS ENFORCED, not intended. Both audit tables refuse UPDATE and
-- DELETE (a BEFORE row trigger) and TRUNCATE (a BEFORE statement trigger) from
-- every role, service_role and the owner included. No other code updates or
-- deletes either table: neither has a foreign key, so no cascade reaches them.
--
-- READS. order_status_audit: staff (is_staff(), admin or accountant, the same
-- audience that reads every order). admin_action_audit: admins (is_admin()).
-- Client roles hold SELECT and nothing else. This project's pg_default_acl
-- grants new tables and functions to anon and authenticated DIRECTLY, so every
-- revoke below names public, anon and authenticated, and the file asserts the
-- outcome with has_table_privilege and has_function_privilege rather than
-- trusting the statement.
--
-- WHAT THIS FILE DOES NOT TOUCH. It redefines no existing function:
-- admin_set_order_status, place_order and compute_order_snapshot are as they
-- were, and the money-path pair is asserted below. It adds no trigger to
-- orders other than part 1's, nothing on a payment table and nothing on
-- integration_settings. It writes no row. The app_settings trigger RECORDS
-- changes to the payment flags there (online_payment_enabled and so on); it
-- does not change what they do.
--
-- DEPLOYS IT IMPLIES: push-dispatch and staff-accounts, each AFTER this apply
-- and each its own owner approval. Before they are deployed, the database half
-- works on its own: status changes and table edits are audited from the apply.
-- ============================================================================


-- ============================================================================
-- PART 1: order_status_audit
-- ============================================================================

create table if not exists public.order_status_audit (
  id         bigint generated always as identity primary key,
  order_id   uuid not null,
  old_status public.order_status,
  new_status public.order_status not null,
  changed_by uuid,
  actor_role text,
  source     text not null check (source in ('manual', 'automatic')),
  changed_at timestamptz not null default now()
);

create index if not exists order_status_audit_order_idx
  on public.order_status_audit (order_id, changed_at);

comment on table public.order_status_audit is
  'Append-only: one row per real orders.status change, with the actor (auth.uid()) and source manual/automatic. Written only by the audit_order_status_change trigger (20261007120000).';

alter table public.order_status_audit enable row level security;

revoke all on table public.order_status_audit from public, anon, authenticated;
grant select on table public.order_status_audit to authenticated;

drop policy if exists order_status_audit_staff_read on public.order_status_audit;
create policy order_status_audit_staff_read on public.order_status_audit
  for select to authenticated
  using ((select public.is_staff()));

create or replace function public.audit_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role  text;
begin
  if v_actor is not null then
    select p.role::text into v_role from public.profiles p where p.id = v_actor;
  end if;

  insert into public.order_status_audit
    (order_id, old_status, new_status, changed_by, actor_role, source)
  values
    (new.id, old.status, new.status, v_actor, v_role,
     case when v_actor is null then 'automatic' else 'manual' end);

  return null;
end $$;

revoke all on function public.audit_order_status_change() from public, anon, authenticated;

drop trigger if exists audit_order_status_change on public.orders;
create trigger audit_order_status_change
  after update of status on public.orders
  for each row
  when (old.status is distinct from new.status)
  execute function public.audit_order_status_change();


-- ============================================================================
-- PART 2: notification_log.sent_by / .content
-- ============================================================================

alter table public.notification_log add column if not exists sent_by uuid;
alter table public.notification_log add column if not exists content jsonb;

comment on column public.notification_log.sent_by is
  'Broadcast rows: the verified admin who sent it (push-dispatch). Null on rows written before 20261007120000 and on non-broadcast kinds.';
comment on column public.notification_log.content is
  'Broadcast rows: the four strings sent, {titleEn, titleAr, bodyEn, bodyAr}. Null on rows written before 20261007120000 and on non-broadcast kinds.';


-- ============================================================================
-- PART 3: admin_action_audit
-- ============================================================================

create table if not exists public.admin_action_audit (
  id              bigint generated always as identity primary key,
  actor           uuid,
  actor_role      text,
  action          text not null,
  target_table    text not null,
  target_id       text,
  changed_columns text[],
  detail          jsonb not null default '{}'::jsonb,
  at              timestamptz not null default now()
);

create index if not exists admin_action_audit_target_idx
  on public.admin_action_audit (target_table, target_id, at);
create index if not exists admin_action_audit_at_idx
  on public.admin_action_audit (at desc);

comment on table public.admin_action_audit is
  'Append-only: staff password resets and deletions (record_admin_action, from staff-accounts) and every insert, update and delete on products, product_variants, coupons, categories and app_settings. Values only for allowlisted columns; everything else by name (20261007120000).';

alter table public.admin_action_audit enable row level security;

revoke all on table public.admin_action_audit from public, anon, authenticated;
grant select on table public.admin_action_audit to authenticated;

drop policy if exists admin_action_audit_admin_read on public.admin_action_audit;
create policy admin_action_audit_admin_read on public.admin_action_audit
  for select to authenticated
  using ((select public.is_admin()));

-- (a) The staff-accounts entry point. service_role only.
create or replace function public.record_admin_action(
  p_actor        uuid,
  p_action       text,
  p_target_table text,
  p_target_id    text,
  p_detail       jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text;
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
  v_id     bigint;
begin
  if p_actor is null then
    raise exception 'record_admin_action: an actor is required' using errcode = '22023';
  end if;
  if p_action is null or p_action not in ('staff_password_reset', 'staff_account_delete') then
    raise exception 'record_admin_action: unknown action %', coalesce(p_action, 'NULL')
      using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_target_table, '')), '') is null then
    raise exception 'record_admin_action: a target table is required' using errcode = '22023';
  end if;
  if jsonb_typeof(v_detail) is distinct from 'object' then
    raise exception 'record_admin_action: detail must be a json object' using errcode = '22023';
  end if;
  -- A key that names a credential, at any depth, is refused outright. The
  -- caller is never meant to send one, so this is a loud failure, not a filter.
  if v_detail::text ~* '"[^"]*(password|secret|token)[^"]*"[[:space:]]*:' then
    raise exception 'record_admin_action: detail may not carry a credential-like key'
      using errcode = '22023';
  end if;

  select p.role::text into v_role from public.profiles p where p.id = p_actor;

  insert into public.admin_action_audit
    (actor, actor_role, action, target_table, target_id, changed_columns, detail)
  values
    (p_actor, v_role, p_action, p_target_table, p_target_id, null, v_detail)
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.record_admin_action(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_admin_action(uuid, text, text, text, jsonb)
  to service_role;

-- (b) The table triggers. TG_ARGV[0]: columns whose VALUES may be recorded,
-- comma-separated. TG_ARGV[1]: columns that do not count as a change on their
-- own. created_at and updated_at never count.
create or replace function public.audit_admin_table_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_role    text;
  v_values  text[] := string_to_array(coalesce(tg_argv[0], ''), ',');
  v_ignored text[] := array['created_at', 'updated_at']
                      || string_to_array(coalesce(tg_argv[1], ''), ',');
  v_old     jsonb;
  v_new     jsonb;
  v_changed text[];
  v_detail  jsonb;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
      from jsonb_object_keys(v_new) k
     where not (k = any (v_ignored))
       and (v_new -> k) is distinct from (v_old -> k);
    if v_changed is null then
      return null;   -- nothing an admin changed
    end if;
    v_detail := jsonb_build_object(
      'old', (select coalesce(jsonb_object_agg(k, v_old -> k), '{}'::jsonb)
                from unnest(v_changed) k where k = any (v_values)),
      'new', (select coalesce(jsonb_object_agg(k, v_new -> k), '{}'::jsonb)
                from unnest(v_changed) k where k = any (v_values)));
  elsif tg_op = 'INSERT' then
    v_detail := jsonb_build_object(
      'new', (select coalesce(jsonb_object_agg(k, v_new -> k), '{}'::jsonb)
                from unnest(v_values) k where v_new ? k));
  else
    v_detail := jsonb_build_object(
      'old', (select coalesce(jsonb_object_agg(k, v_old -> k), '{}'::jsonb)
                from unnest(v_values) k where v_old ? k));
  end if;

  if v_actor is not null then
    select p.role::text into v_role from public.profiles p where p.id = v_actor;
  end if;

  insert into public.admin_action_audit
    (actor, actor_role, action, target_table, target_id, changed_columns, detail)
  values
    (v_actor, v_role, lower(tg_op), tg_table_name,
     coalesce(v_new, v_old) ->> 'id', v_changed, v_detail);

  return null;
end $$;

revoke all on function public.audit_admin_table_change() from public, anon, authenticated;

drop trigger if exists audit_admin_action on public.products;
create trigger audit_admin_action
  after insert or update or delete on public.products
  for each row execute function public.audit_admin_table_change(
    'price,is_active,earns_loyalty_points,category_id,sort_order', '');

drop trigger if exists audit_admin_action on public.product_variants;
create trigger audit_admin_action
  after insert or update or delete on public.product_variants
  for each row execute function public.audit_admin_table_change(
    'price,is_active,product_id,sort_order', '');

drop trigger if exists audit_admin_action on public.coupons;
create trigger audit_admin_action
  after insert or update or delete on public.coupons
  for each row execute function public.audit_admin_table_change(
    'type,value,is_active,min_order_amount,max_discount_amount,starts_at,ends_at,usage_limit',
    'usage_count');

drop trigger if exists audit_admin_action on public.categories;
create trigger audit_admin_action
  after insert or update or delete on public.categories
  for each row execute function public.audit_admin_table_change(
    'is_active,sort_order', '');

drop trigger if exists audit_admin_action on public.app_settings;
create trigger audit_admin_action
  after insert or update or delete on public.app_settings
  for each row execute function public.audit_admin_table_change(
    'vat_percentage,loyalty_enabled,points_per_riyal,discount_per_point,min_points_to_redeem,'
    'online_payment_enabled,cash_payment_enabled,default_payment_method,payment_outage_mode_enabled,'
    'support_phone_enabled,support_whatsapp_enabled,support_email_enabled,loyalty_pickup_only,'
    'loyalty_expiry_enabled,loyalty_expiry_anchor_month,loyalty_expiry_anchor_day,'
    'loyalty_expiry_period_months,variant_closing_enabled,admin_push_enabled,'
    'order_limit_open,order_limit_per_hour',
    'payment_updated_at,payment_updated_by,loyalty_expiry_next_run_on');


-- ============================================================================
-- Append-only enforcement for both audit tables
-- ============================================================================

create or replace function public.audit_rows_are_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = '42501';
end $$;

revoke all on function public.audit_rows_are_append_only() from public, anon, authenticated;

drop trigger if exists append_only_rows on public.order_status_audit;
create trigger append_only_rows
  before update or delete on public.order_status_audit
  for each row execute function public.audit_rows_are_append_only();
drop trigger if exists append_only_truncate on public.order_status_audit;
create trigger append_only_truncate
  before truncate on public.order_status_audit
  for each statement execute function public.audit_rows_are_append_only();

drop trigger if exists append_only_rows on public.admin_action_audit;
create trigger append_only_rows
  before update or delete on public.admin_action_audit
  for each row execute function public.audit_rows_are_append_only();
drop trigger if exists append_only_truncate on public.admin_action_audit;
create trigger append_only_truncate
  before truncate on public.admin_action_audit
  for each statement execute function public.audit_rows_are_append_only();


-- ============================================================================
-- Self-verification. Outcomes, not statements. One transaction: if any check
-- fails, the whole file rolls back.
-- ============================================================================
do $verify$
declare
  v_n     integer;
  v_txt   text;
  v_role  text;
  v_table text;
  v_priv  text;
  v_def   text;
begin
  -- 1. Both tables exist with RLS on.
  foreach v_table in array array['order_status_audit', 'admin_action_audit'] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'audit trail: public.% is missing', v_table;
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || v_table)::regclass) then
      raise exception 'audit trail: RLS is off on public.%', v_table;
    end if;
  end loop;

  -- 2. Exactly one policy on each, SELECT only, for authenticated, with the
  --    intended predicate.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'order_status_audit';
  if v_n <> 1 then
    raise exception 'audit trail: order_status_audit has % policies, expected 1', v_n;
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'order_status_audit'
     and policyname = 'order_status_audit_staff_read' and cmd = 'SELECT'
     and roles = array['authenticated']::name[]
     and qual = '( SELECT is_staff() AS is_staff)';
  if v_n <> 1 then
    raise exception 'audit trail: order_status_audit_staff_read is not SELECT/authenticated/(select is_staff())';
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'admin_action_audit';
  if v_n <> 1 then
    raise exception 'audit trail: admin_action_audit has % policies, expected 1', v_n;
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'admin_action_audit'
     and policyname = 'admin_action_audit_admin_read' and cmd = 'SELECT'
     and roles = array['authenticated']::name[]
     and qual = '( SELECT is_admin() AS is_admin)';
  if v_n <> 1 then
    raise exception 'audit trail: admin_action_audit_admin_read is not SELECT/authenticated/(select is_admin())';
  end if;

  -- 3. Client roles hold no write privilege on either table. anon holds
  --    nothing at all; authenticated holds SELECT.
  foreach v_table in array array['order_status_audit', 'admin_action_audit'] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege(v_role, 'public.' || v_table, v_priv) then
          raise exception 'audit trail: % holds % on public.%', v_role, v_priv, v_table;
        end if;
      end loop;
    end loop;
    if has_table_privilege('anon', 'public.' || v_table, 'SELECT') then
      raise exception 'audit trail: anon can SELECT public.%', v_table;
    end if;
    if not has_table_privilege('authenticated', 'public.' || v_table, 'SELECT') then
      raise exception 'audit trail: authenticated cannot SELECT public.% (the policy would be unreachable)', v_table;
    end if;
  end loop;

  -- 4. record_admin_action: one overload, service_role only.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_admin_action';
  if v_n <> 1 then
    raise exception 'audit trail: % record_admin_action overloads, expected 1', v_n;
  end if;
  if has_function_privilege('anon', 'public.record_admin_action(uuid,text,text,text,jsonb)', 'EXECUTE') then
    raise exception 'audit trail: anon can execute record_admin_action';
  end if;
  if has_function_privilege('authenticated', 'public.record_admin_action(uuid,text,text,text,jsonb)', 'EXECUTE') then
    raise exception 'audit trail: authenticated can execute record_admin_action';
  end if;
  if not has_function_privilege('service_role', 'public.record_admin_action(uuid,text,text,text,jsonb)', 'EXECUTE') then
    raise exception 'audit trail: service_role cannot execute record_admin_action';
  end if;

  -- 5. The order trigger exists, is enabled, fires AFTER UPDATE OF status per
  --    row, and only on a real change.
  select pg_get_triggerdef(t.oid) into v_def
    from pg_trigger t
   where t.tgrelid = 'public.orders'::regclass
     and t.tgname = 'audit_order_status_change'
     and t.tgenabled = 'O';
  if v_def is null then
    raise exception 'audit trail: audit_order_status_change is missing or disabled on orders';
  end if;
  if position('AFTER UPDATE OF status ON public.orders FOR EACH ROW' in v_def) = 0
     or position('WHEN ((old.status IS DISTINCT FROM new.status))' in v_def) = 0 then
    raise exception 'audit trail: audit_order_status_change is not AFTER UPDATE OF status, per row, on a real change: %', v_def;
  end if;

  -- 6. One enabled admin-audit trigger on each of the five tables, and on no
  --    other table.
  select count(*) into v_n
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where p.proname = 'audit_admin_table_change' and not t.tgisinternal and t.tgenabled = 'O'
     and t.tgrelid in ('public.products'::regclass, 'public.product_variants'::regclass,
                       'public.coupons'::regclass, 'public.categories'::regclass,
                       'public.app_settings'::regclass)
     and (t.tgtype & 1) = 1                -- ROW
     and (t.tgtype & 2) = 0                -- AFTER
     and (t.tgtype & 28) = 28;             -- INSERT, DELETE and UPDATE
  if v_n <> 5 then
    raise exception 'audit trail: % of 5 admin-audit triggers present, enabled, AFTER INSERT/UPDATE/DELETE per row', v_n;
  end if;
  select count(*) into v_n
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where p.proname in ('audit_admin_table_change', 'audit_order_status_change') and not t.tgisinternal;
  if v_n <> 6 then
    raise exception 'audit trail: audit trigger functions are attached % times, expected 6 (5 tables + orders)', v_n;
  end if;

  -- 7. No value allowlist names anything that looks like a credential.
  select count(*) into v_n
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where p.proname = 'audit_admin_table_change'
     and encode(t.tgargs, 'escape') ~* '(key|secret|token|password|vapid)';
  if v_n <> 0 then
    raise exception 'audit trail: % admin-audit trigger(s) would record the VALUE of a credential-like column', v_n;
  end if;

  -- 8. Append-only guards present and enabled on both tables.
  select count(*) into v_n
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where p.proname = 'audit_rows_are_append_only' and t.tgenabled = 'O'
     and t.tgrelid in ('public.order_status_audit'::regclass, 'public.admin_action_audit'::regclass);
  if v_n <> 4 then
    raise exception 'audit trail: % of 4 append-only triggers present', v_n;
  end if;

  -- 9. Neither audit table carries a foreign key or a unique index besides its
  --    primary key: the inserts must not be able to fail.
  select count(*) into v_n from pg_constraint c
   where c.conrelid in ('public.order_status_audit'::regclass, 'public.admin_action_audit'::regclass)
     and c.contype in ('f', 'u', 'x');
  if v_n <> 0 then
    raise exception 'audit trail: % foreign-key/unique/exclusion constraint(s) on an audit table', v_n;
  end if;

  -- 10. notification_log: the two columns, and reads/writes unchanged — one
  --     policy, admin SELECT, so no client can write and no customer can read.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'notification_log'
     and ((column_name = 'sent_by' and data_type = 'uuid')
       or (column_name = 'content' and data_type = 'jsonb'))
     and is_nullable = 'YES';
  if v_n <> 2 then
    raise exception 'audit trail: notification_log.sent_by/content missing or not nullable (% of 2)', v_n;
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'notification_log';
  if v_n <> 1 then
    raise exception 'audit trail: notification_log has % policies, expected exactly the admin read', v_n;
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'notification_log'
     and policyname = 'notification_log_admin_select' and cmd = 'SELECT'
     and roles = array['authenticated']::name[];
  if v_n <> 1 then
    raise exception 'audit trail: notification_log_admin_select is not the authenticated SELECT policy';
  end if;
  select count(*) into v_n from pg_constraint c
   where c.conrelid = 'public.notification_log'::regclass and c.contype = 'f'
     and c.conkey && array[
       (select attnum from pg_attribute where attrelid = 'public.notification_log'::regclass and attname = 'sent_by')];
  if v_n <> 0 then
    raise exception 'audit trail: notification_log.sent_by carries a foreign key';
  end if;

  -- 11. The money path is untouched. Cardinality first: with two overloads
  --     the hash would be read off an arbitrary one.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_n <> 1 then
    raise exception 'audit trail: % place_order overloads, expected 1', v_n;
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_n <> 1 then
    raise exception 'audit trail: % compute_order_snapshot overloads, expected 1', v_n;
  end if;
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
end
$verify$;

-- ---- Behaviour probe ----------------------------------------------------------
-- A plpgsql body is not name-resolved at creation, so the checks above prove
-- the objects exist, not that they run. This block FIRES both trigger
-- functions and CALLS record_admin_action, reads each outcome back as a value,
-- and then raises a sentinel so that every probe write is rolled back. Only the
-- sentinel is an acceptable way out; any other outcome fails the apply.
--
-- It touches NO real row. The trigger functions are attached to two temporary
-- tables shaped like the columns they read, so no order, product or setting is
-- locked, written or rolled back, and no other trigger on those tables fires.
-- The only residue is a few identity values on the two audit tables, which a
-- rollback does not return. The real triggers' attachment, timing and WHEN
-- clause are asserted structurally above, and fired for real by the paired
-- suite, supabase/tests/audit_trail_test.sql.
do $probe$
declare
  v_msg    text;
  v_uid    uuid;
  v_order  uuid := gen_random_uuid();
  v_rows   integer;
  v_src    text;
  v_by     uuid;
  v_cols   text[];
  v_detail jsonb;
  v_id     bigint;
  v_target uuid := gen_random_uuid();
begin
  begin
    v_uid := auth.uid();

    -- The order-status function, behind the same WHEN clause as the real one.
    create temporary table audit_probe_orders (
      id uuid primary key, status public.order_status not null, notes text
    );
    create trigger audit_probe after update of status on audit_probe_orders
      for each row when (old.status is distinct from new.status)
      execute function public.audit_order_status_change();
    insert into audit_probe_orders values (v_order, 'received', null);
    update audit_probe_orders set status = 'received' where id = v_order;
    update audit_probe_orders set notes = 'x' where id = v_order;
    select count(*) into v_rows from public.order_status_audit where order_id = v_order;
    if v_rows <> 0 then
      raise exception 'probe: % audit row(s) for writes that changed no status', v_rows;
    end if;
    update audit_probe_orders set status = 'preparing' where id = v_order;
    select count(*), max(source), max(changed_by::text)::uuid into v_rows, v_src, v_by
      from public.order_status_audit
     where order_id = v_order and old_status = 'received' and new_status = 'preparing';
    if v_rows <> 1
       or v_src is distinct from (case when v_uid is null then 'automatic' else 'manual' end)
       or v_by is distinct from v_uid then
      raise exception 'probe: status change wrote rows=% source=% changed_by=% (auth.uid()=%)',
        v_rows, v_src, v_by, v_uid;
    end if;

    -- The table-audit function: names for every changed column, values only
    -- for the allowlist, nothing for an updated_at-only write.
    create temporary table audit_probe_rows (
      id uuid primary key, price numeric, api_secret text, updated_at timestamptz
    );
    create trigger audit_probe after insert or update or delete on audit_probe_rows
      for each row execute function public.audit_admin_table_change('price', '');
    insert into audit_probe_rows values (v_target, 10, 's1', now());
    update audit_probe_rows set updated_at = now() + interval '1 minute' where id = v_target;
    update audit_probe_rows set price = 12, api_secret = 's2' where id = v_target;
    delete from audit_probe_rows where id = v_target;

    select count(*) into v_rows from public.admin_action_audit
     where target_table = 'audit_probe_rows' and target_id = v_target::text;
    if v_rows <> 3 then
      raise exception 'probe: % table-audit rows, expected 3 (insert, update, delete; not the updated_at-only write)', v_rows;
    end if;
    select changed_columns, detail into v_cols, v_detail
      from public.admin_action_audit
     where target_table = 'audit_probe_rows' and target_id = v_target::text and action = 'update';
    if v_cols is distinct from array['api_secret', 'price']
       or v_detail is distinct from '{"old": {"price": 10}, "new": {"price": 12}}'::jsonb then
      raise exception 'probe: update recorded columns=% detail=%', v_cols, v_detail;
    end if;
    if exists (select 1 from public.admin_action_audit
                where target_table = 'audit_probe_rows' and detail::text like '%s1%') then
      raise exception 'probe: a value outside the allowlist was recorded';
    end if;

    -- record_admin_action: a real call writes a row; a credential-like key is
    -- refused.
    v_id := public.record_admin_action(gen_random_uuid(), 'staff_password_reset',
                                       'auth.users', v_target::text,
                                       jsonb_build_object('target_role', 'branch_staff'));
    if not exists (select 1 from public.admin_action_audit
                    where id = v_id and action = 'staff_password_reset'
                      and target_id = v_target::text) then
      raise exception 'probe: record_admin_action returned % but wrote no matching row', v_id;
    end if;
    begin
      perform public.record_admin_action(gen_random_uuid(), 'staff_password_reset',
                                         'auth.users', null,
                                         jsonb_build_object('new_password', 'x'));
      raise exception 'probe: a credential-like detail key was accepted';
    exception when sqlstate '22023' then
      null;
    end;

    -- Append-only holds for the owner as well.
    begin
      delete from public.admin_action_audit where id = v_id;
      raise exception 'probe: delete on admin_action_audit was allowed';
    exception when sqlstate '42501' then
      null;
    end;
    begin
      update public.order_status_audit set source = 'manual' where order_id = v_order;
      raise exception 'probe: update on order_status_audit was allowed';
    exception when sqlstate '42501' then
      null;
    end;

    raise exception 'audit-trail-probe-ok' using errcode = 'P0099';
  exception when sqlstate 'P0099' then
    get stacked diagnostics v_msg = message_text;
    if v_msg is distinct from 'audit-trail-probe-ok' then
      raise;
    end if;
  end;

  raise notice 'audit trail: order status changes, broadcasts, staff password resets and deletions, and menu/price/coupon/settings edits now leave an append-only record; money path unchanged';
end
$probe$;
