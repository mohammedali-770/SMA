-- ============================================================================
-- Spicy Meal — audited staff role administration
--
-- Before this migration, role is intentionally not customer-writable but there
-- is also no supported admin path to grant/revoke admin/accountant access. Staff
-- offboarding therefore requires ad-hoc production SQL. This adds one narrow,
-- concurrency-safe admin RPC plus an append-only audit/read contract.
-- ============================================================================

create table if not exists public.role_change_audit (
  id             bigint generated always as identity primary key,
  -- SET NULL is deliberate: account deletion must still be able to remove the
  -- Auth user/profile after a historic role change. old/new role, reason, actor
  -- and timestamp retain the operational audit without pinning the erased user.
  target_user_id uuid references auth.users(id) on delete set null,
  old_role       public.user_role not null,
  new_role       public.user_role not null,
  reason         text not null,
  changed_by     uuid references auth.users(id) on delete set null,
  changed_at     timestamptz not null default now(),
  check (old_role <> new_role),
  check (length(btrim(reason)) between 3 and 500)
);

create index if not exists role_change_audit_target_idx
  on public.role_change_audit(target_user_id, changed_at desc);
create index if not exists role_change_audit_actor_idx
  on public.role_change_audit(changed_by, changed_at desc);

alter table public.role_change_audit enable row level security;
revoke all on public.role_change_audit from public, anon, authenticated;
grant select on public.role_change_audit to authenticated;

drop policy if exists role_change_audit_admin_read on public.role_change_audit;
create policy role_change_audit_admin_read
  on public.role_change_audit
  for select to authenticated
  using (public.is_admin());

create or replace function public.admin_set_user_role(
  p_user_id uuid,
  p_role public.user_role,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_admin_count integer;
begin
  -- Fast reject before waiting on the serialization lock.
  if not public.is_admin() then
    raise exception 'Only admins may change staff roles' using errcode = '42501';
  end if;
  if p_user_id is null or p_role is null then
    raise exception 'user id and role are required' using errcode = '22004';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'A role-change reason between 3 and 500 characters is required'
      using errcode = '22023';
  end if;

  -- Serialize every staff role mutation. This protects both the last-admin
  -- invariant and offboarding authorization itself. A caller may have been an
  -- admin when it queued behind this lock but demoted by the transaction ahead
  -- of it, so authorization MUST be re-read after acquiring the lock.
  perform pg_advisory_xact_lock(hashtext('spicymeal:staff-role-admin-count'));

  if not public.is_admin() then
    raise exception 'Administrator access was revoked before this change executed'
      using errcode = '42501';
  end if;

  select * into v_target
    from public.profiles
   where id = p_user_id
   for update;
  if not found then
    raise exception 'User profile not found' using errcode = 'P0002';
  end if;

  if v_target.role = p_role then
    return jsonb_build_object(
      'id', v_target.id,
      'role', v_target.role,
      'changed', false
    );
  end if;

  if v_target.role = 'admin' and p_role <> 'admin' then
    select count(*)::integer into v_admin_count
      from public.profiles
     where role = 'admin';
    if v_admin_count <= 1 then
      raise exception 'The last administrator cannot be demoted'
        using errcode = '23514';
    end if;
  end if;

  update public.profiles
     set role = p_role,
         updated_at = now()
   where id = p_user_id;

  insert into public.role_change_audit
    (target_user_id, old_role, new_role, reason, changed_by)
  values
    (p_user_id, v_target.role, p_role, v_reason, auth.uid());

  return jsonb_build_object(
    'id', p_user_id,
    'role', p_role,
    'changed', true
  );
end $$;

revoke all on function public.admin_set_user_role(uuid, public.user_role, text)
  from public, anon;
grant execute on function public.admin_set_user_role(uuid, public.user_role, text)
  to authenticated;

create or replace function public.admin_list_staff()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins may list staff accounts' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.role, t.full_name nulls last, t.id), '[]'::jsonb)
    into v_rows
    from (
      select id, full_name, email, phone_number, role, created_at, updated_at
        from public.profiles
       where role in ('admin', 'accountant')
    ) t;
  return v_rows;
end $$;

revoke all on function public.admin_list_staff() from public, anon;
grant execute on function public.admin_list_staff() to authenticated;

comment on table public.role_change_audit is
  'Append-only operational audit of staff role changes. Target/actor Auth FKs use SET NULL so account erasure remains possible; role transition, reason and timestamp remain. Client writes are denied.';
comment on function public.admin_set_user_role(uuid, public.user_role, text) is
  'Admin-only audited role grant/revoke with serialization, post-lock reauthorization, and a last-admin guard. Same-role calls are idempotent.';
comment on function public.admin_list_staff() is
  'Admin-only explicit staff directory projection for management UI; returns admin/accountant profiles only.';
