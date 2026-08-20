-- ============================================================================
-- Spicy Meal — narrow realtime signal for the branch-operations consoles
--
-- The call-centre board needs to learn that SOMETHING changed at a branch
-- without polling every table every few seconds. This is the same answer
-- 20260724200000 reached for orders: publish a tiny signal table, not the data.
--
-- WHY NOT PUBLISH THE DATA TABLES DIRECTLY
-- `postgres_changes` re-evaluates RLS per subscriber and delivers whole rows.
-- `branch_product_availability` is readable by `anon` (`bpa_select_public` is
-- `using (true)`), so adding it to the publication would broadcast every closure
-- at every branch to every anonymous browser session that opened a socket. The
-- signal table below carries a branch id and a kind — never an item, never a
-- reason, never an actor — and is readable only by operations roles.
--
-- The consoles treat this as a hint to refetch, never as data. A missed event
-- costs one polling interval; it cannot desynchronise anything.
-- ============================================================================

create table if not exists public.ops_change_events (
  id         bigint generated always as identity primary key,
  branch_id  uuid,
  kind       text not null check (kind in ('availability','delivery','area')),
  created_at timestamptz not null default now()
);

create index if not exists oce_created_idx on public.ops_change_events (created_at desc);

alter table public.ops_change_events enable row level security;
revoke all on public.ops_change_events from public, anon, authenticated;
grant select on public.ops_change_events to authenticated;

-- Deliberately NOT `using (true)`. A realtime subscriber receives exactly what
-- this policy lets them select.
drop policy if exists oce_select_ops on public.ops_change_events;
create policy oce_select_ops
  on public.ops_change_events for select to authenticated
  using (
    public.is_staff()
    or public.is_call_center()
    or (branch_id is not null and public.is_branch_operator(branch_id))
  );

comment on table public.ops_change_events is
  'Operations realtime signal: branch id + change kind, nothing else. Published to supabase_realtime so the operations consoles can refetch on change instead of polling. Never carries item, reason or actor detail — those live on the audit tables, which are not published.';

-- ---- Emission ----------------------------------------------------------------
-- Bounded retention without a scheduled job, copying emit_order_change_event
-- (20260724200000:389-394): every 500th row prunes anything older than a day.
-- Deterministic, so behaviour is reproducible in tests.
create or replace function public.emit_ops_change_event(p_branch_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id bigint;
begin
  insert into public.ops_change_events (branch_id, kind)
  values (p_branch_id, p_kind)
  returning id into v_id;

  if v_id % 500 = 0 then
    delete from public.ops_change_events where created_at < now() - interval '1 day';
  end if;
end $$;

revoke all on function public.emit_ops_change_event(uuid, text) from public, anon, authenticated;

-- Availability: fire only on a real transition, matching the audit trigger, so a
-- no-op write does not wake every console.
create or replace function public.signal_availability_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or new.is_available is distinct from old.is_available
     or new.snoozed_until is distinct from old.snoozed_until then
    perform public.emit_ops_change_event(new.branch_id, 'availability');
  end if;
  return null;
end $$;

drop trigger if exists signal_availability_change on public.branch_product_availability;
create trigger signal_availability_change
  after insert or update on public.branch_product_availability
  for each row execute function public.signal_availability_change();

create or replace function public.signal_delivery_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and (new.delivery_temporarily_closed is distinct from old.delivery_temporarily_closed
          or new.delivery_closed_until is distinct from old.delivery_closed_until) then
    perform public.emit_ops_change_event(new.id, 'delivery');
  end if;
  return null;
end $$;

drop trigger if exists signal_delivery_change on public.branches;
create trigger signal_delivery_change
  after update on public.branches
  for each row execute function public.signal_delivery_change();

create or replace function public.signal_area_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or new.is_disabled is distinct from old.is_disabled
     or new.disabled_until is distinct from old.disabled_until then
    perform public.emit_ops_change_event(new.branch_id, 'area');
  end if;
  return null;
end $$;

drop trigger if exists signal_area_change on public.branch_delivery_areas;
create trigger signal_area_change
  after insert or update on public.branch_delivery_areas
  for each row execute function public.signal_area_change();

revoke all on function public.signal_availability_change() from public, anon, authenticated;
revoke all on function public.signal_delivery_change()     from public, anon, authenticated;
revoke all on function public.signal_area_change()         from public, anon, authenticated;

-- ---- Publication --------------------------------------------------------------
-- Guarded exactly like 20260707121100 / 20260724200000 so a plain Postgres
-- without the publication is a no-op and the SQL CI replay stays idempotent.
--
-- OWNER APPROVAL: adding a table to supabase_realtime changes what the platform
-- broadcasts. Applying this migration to Production is a separate approval step.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ops_change_events'
    ) then
      execute 'alter publication supabase_realtime add table public.ops_change_events';
    end if;
  end if;
end $$;

-- Rollback
--   alter publication supabase_realtime drop table public.ops_change_events;
