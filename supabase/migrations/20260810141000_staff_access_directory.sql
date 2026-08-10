-- ============================================================================
-- Spicy Meal — Staff Access read contracts
--
-- Completes the audited role-management backend with explicit, bounded admin
-- reads for the UI. These functions create NO Auth users and grant NO roles;
-- admin_set_user_role() remains the sole mutation path.
-- ============================================================================

create or replace function public.admin_search_role_candidates(
  p_query text,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins may search role candidates' using errcode = '42501';
  end if;

  if length(v_query) < 2 then
    raise exception 'Search requires at least 2 characters' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.full_name nulls last, t.id), '[]'::jsonb)
    into v_rows
    from (
      select p.id, p.full_name, p.email, p.phone_number, p.role, p.created_at, p.updated_at
        from public.profiles p
       where coalesce(p.full_name, '') ilike '%' || v_query || '%'
          or coalesce(p.email, '') ilike '%' || v_query || '%'
          or coalesce(p.phone_number, '') ilike '%' || v_query || '%'
       order by p.full_name nulls last, p.id
       limit v_limit
    ) t;

  return v_rows;
end $$;

revoke all on function public.admin_search_role_candidates(text, integer)
  from public, anon;
grant execute on function public.admin_search_role_candidates(text, integer)
  to authenticated;

create or replace function public.admin_list_role_change_audit(
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins may read role-change audit' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.changed_at desc, t.id desc), '[]'::jsonb)
    into v_rows
    from (
      select
        a.id,
        a.target_user_id,
        target.full_name as target_name,
        target.email as target_email,
        target.phone_number as target_phone,
        a.old_role,
        a.new_role,
        a.reason,
        a.changed_by,
        actor.full_name as changed_by_name,
        actor.email as changed_by_email,
        a.changed_at
      from public.role_change_audit a
      left join public.profiles target on target.id = a.target_user_id
      left join public.profiles actor on actor.id = a.changed_by
      order by a.changed_at desc, a.id desc
      limit v_limit
    ) t;

  return v_rows;
end $$;

revoke all on function public.admin_list_role_change_audit(integer)
  from public, anon;
grant execute on function public.admin_list_role_change_audit(integer)
  to authenticated;

comment on function public.admin_search_role_candidates(text, integer) is
  'Admin-only bounded search over existing profiles for role administration. Requires >=2 characters, caps result count at 50, creates no account and changes no role.';
comment on function public.admin_list_role_change_audit(integer) is
  'Admin-only bounded audit projection for Staff Access UI. Preserves anonymized audit rows after account erasure by returning nullable target/actor identities.';
