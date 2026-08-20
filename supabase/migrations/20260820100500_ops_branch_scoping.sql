-- ============================================================================
-- Spicy Meal — branch scoping for operations roles
--
-- Until now there has been ZERO branch scoping anywhere in the schema: no
-- branch column on profiles, no user-to-branch link table, and no RLS policy
-- that filters by branch. Staff access is all-or-nothing
-- (orders_select_own_or_staff = "customer_id = auth.uid() or is_staff()").
-- The Staff Access UI says so in its own copy: "Roles here are global;
-- branch-scoped permissions are not enabled yet."
--
-- This migration adds the missing link plus the authorization predicates that
-- later operations migrations build on.
--
-- DELIBERATE MFA CARVE-OUT
-- `is_admin()` / `is_staff()` require JWT aal=aal2 since
-- 20260810142000_staff_mfa_aal2.sql. The owner's decision (2026-08-20) is that
-- only administrators carry that burden: branch and call-centre operators work
-- from shared shop-floor hardware and sign in with email + password.
-- `is_branch_operator()` and `is_call_center()` therefore do NOT call
-- `jwt_has_aal2()`.
--
-- That is only safe because these predicates are narrow by construction. They
-- are never a substitute for `is_admin()`/`is_staff()`, which are left
-- untouched here, and they must never be used to gate orders, customers,
-- profiles, pricing, payments, reports or integration settings. Their intended
-- blast radius is branch availability and branch delivery state — nothing else.
--
-- SAFETY: purely additive. No existing table, policy, function or grant is
-- modified. Until a profile actually holds one of the new roles AND has an
-- assignment row, every predicate below returns false and nothing changes.
-- ============================================================================

-- ---- user -> branch assignment ---------------------------------------------
-- One branch per operator, matching how a cashier actually works a shift. The
-- primary key on user_id (rather than a composite) is what enforces that; if
-- multi-branch operators are ever needed, that is a deliberate future change
-- and not something a stray insert can do by accident.
create table if not exists public.staff_branch_assignments (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists sba_branch_id_idx
  on public.staff_branch_assignments(branch_id);

drop trigger if exists set_staff_branch_assignments_updated_at
  on public.staff_branch_assignments;
create trigger set_staff_branch_assignments_updated_at
  before update on public.staff_branch_assignments
  for each row execute function public.set_updated_at();

alter table public.staff_branch_assignments enable row level security;
revoke all on public.staff_branch_assignments from public, anon, authenticated;
grant select on public.staff_branch_assignments to authenticated;

-- Read-only to clients, and only your own row unless you are an admin. There is
-- deliberately NO client write grant: assignments are written by the admin RPCs
-- below or by the service role, so an operator can never move themselves to a
-- different branch.
drop policy if exists sba_select_own_or_admin on public.staff_branch_assignments;
create policy sba_select_own_or_admin
  on public.staff_branch_assignments
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

comment on table public.staff_branch_assignments is
  'Pins a branch_staff operator to exactly one branch. Read-only to clients; written only by admin RPCs or the service role.';

-- ---- authorization predicates ----------------------------------------------

create or replace function public.current_staff_branch_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select branch_id
    from public.staff_branch_assignments
   where user_id = auth.uid();
$$;

create or replace function public.is_branch_operator(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_app_role() = 'branch_staff'
    and p_branch_id is not null
    and exists (
      select 1
        from public.staff_branch_assignments
       where user_id = auth.uid()
         and branch_id = p_branch_id
    ),
    false
  );
$$;

create or replace function public.is_call_center()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = 'call_center', false);
$$;

-- The single predicate later operations policies should use. Admin keeps its
-- aal2 requirement because it routes through is_admin().
create or replace function public.is_ops_operator(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
      or public.is_call_center()
      or public.is_branch_operator(p_branch_id);
$$;

revoke all on function public.current_staff_branch_id() from public, anon;
revoke all on function public.is_branch_operator(uuid) from public, anon;
revoke all on function public.is_call_center() from public, anon;
revoke all on function public.is_ops_operator(uuid) from public, anon;

grant execute on function public.current_staff_branch_id() to authenticated;
grant execute on function public.is_branch_operator(uuid) to authenticated;
grant execute on function public.is_call_center() to authenticated;
grant execute on function public.is_ops_operator(uuid) to authenticated;

comment on function public.current_staff_branch_id() is
  'The calling operator''s assigned branch, or null. Used to pin the branch console to one branch.';
comment on function public.is_branch_operator(uuid) is
  'True only when the caller is branch_staff AND assigned to the given branch. Intentionally does not require aal2 (owner decision 2026-08-20); scope is branch availability/delivery only.';
comment on function public.is_call_center() is
  'True only when the caller is call_center. Intentionally does not require aal2 (owner decision 2026-08-20); grants no catalog, order or customer access on its own.';
comment on function public.is_ops_operator(uuid) is
  'Branch-operations authorization: admin (aal2) OR call centre OR the branch operator assigned to this branch.';

-- ---- admin assignment RPCs --------------------------------------------------
-- Assignment is a privileged act, so it mirrors admin_set_user_role: admin-only,
-- explicit, and it refuses to attach a branch to a role that has no use for one.
create or replace function public.admin_set_staff_branch(
  p_user_id uuid,
  p_branch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
begin
  if not public.is_admin() then
    raise exception 'Only admins may assign a staff branch' using errcode = '42501';
  end if;
  if p_user_id is null or p_branch_id is null then
    raise exception 'user id and branch id are required' using errcode = '22004';
  end if;

  select role into v_role from public.profiles where id = p_user_id;
  if not found then
    raise exception 'User profile not found' using errcode = 'P0002';
  end if;
  if v_role <> 'branch_staff' then
    raise exception 'Only branch_staff accounts can be pinned to a branch'
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;

  insert into public.staff_branch_assignments (user_id, branch_id, assigned_by)
  values (p_user_id, p_branch_id, auth.uid())
  on conflict (user_id) do update
    set branch_id = excluded.branch_id,
        assigned_by = excluded.assigned_by,
        assigned_at = now();

  return jsonb_build_object('user_id', p_user_id, 'branch_id', p_branch_id);
end $$;

create or replace function public.admin_clear_staff_branch(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins may clear a staff branch' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'user id is required' using errcode = '22004';
  end if;

  delete from public.staff_branch_assignments where user_id = p_user_id;
  return jsonb_build_object('user_id', p_user_id, 'branch_id', null);
end $$;

revoke all on function public.admin_set_staff_branch(uuid, uuid) from public, anon;
revoke all on function public.admin_clear_staff_branch(uuid) from public, anon;
grant execute on function public.admin_set_staff_branch(uuid, uuid) to authenticated;
grant execute on function public.admin_clear_staff_branch(uuid) to authenticated;
