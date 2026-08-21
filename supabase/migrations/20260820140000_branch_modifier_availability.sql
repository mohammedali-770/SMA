-- ============================================================================
-- Spicy Meal — per-branch modifier availability
--
-- The owner's framing: "modifiers are prices — our system calls it modifiers but
-- Lazywait calls them Prices." The old operations webapp could close a single
-- price tier (just the Large), and in SMA that same act is closing a single
-- modifier. There is no product-variant model and this does not add one.
--
-- Same shape as branch_product_availability, deliberately:
--   * `is_available` stays the authoritative flag, `snoozed_until` is only the
--     scheduled restore time;
--   * absence of a row means available, so only exceptions are stored;
--   * the staff actor and the free-text note are NOT on this table — both
--     clients read it, so they live on branch_availability_events, which
--     already carries a `modifier_id` column for exactly this.
--
-- Unlike products, this table DOES change the order path: place_order has to
-- reject a snoozed modifier, because nothing else would. That re-emission is a
-- separate migration so it can be reviewed and reverted on its own.
-- ============================================================================

create table if not exists public.branch_modifier_availability (
  branch_id     uuid not null references public.branches(id)  on delete cascade,
  modifier_id   uuid not null references public.modifiers(id) on delete cascade,
  is_available  boolean not null default true,
  snoozed_until timestamptz,
  reason_code   text,
  changed_at    timestamptz,
  source        text,
  updated_at    timestamptz not null default now(),
  primary key (branch_id, modifier_id),
  constraint bma_reason_code_check check (reason_code in
    ('out_of_stock','supplier_delay','equipment_down','quality_hold','other')),
  constraint bma_source_check check (source in ('manual','lazywait'))
);

create index if not exists bma_modifier_id_idx on public.branch_modifier_availability (modifier_id);

-- The sweeper's scan, partial so it stays proportional to what is snoozed.
create index if not exists bma_snoozed_until_idx
  on public.branch_modifier_availability (snoozed_until)
  where is_available = false and snoozed_until is not null;

comment on table public.branch_modifier_availability is
  'Per-branch modifier (Lazywait "price") availability. Absence of a row means available. is_available is authoritative; snoozed_until is the scheduled restore time. Read by both clients, so it carries no staff identity and no free text — those are on branch_availability_events.';

alter table public.branch_modifier_availability enable row level security;
grant select on public.branch_modifier_availability to anon, authenticated;

-- Public read, matching bpa_select_public: the customer app needs this to know
-- which options to grey out, and it carries nothing sensitive.
drop policy if exists bma_select_public on public.branch_modifier_availability;
create policy bma_select_public
  on public.branch_modifier_availability for select to anon, authenticated
  using (true);

-- Admin-only direct write, matching every other catalog table. Branch operators
-- go through the RPCs below.
grant insert, update, delete on public.branch_modifier_availability to authenticated;
drop policy if exists bma_admin_write on public.branch_modifier_availability;
create policy bma_admin_write
  on public.branch_modifier_availability for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop trigger if exists set_branch_modifier_availability_updated_at on public.branch_modifier_availability;
create trigger set_branch_modifier_availability_updated_at
  before update on public.branch_modifier_availability
  for each row execute function public.set_updated_at();

-- ---- Normalize + audit, the same pair as products ----------------------------
create or replace function public.normalize_modifier_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_available then
    new.snoozed_until := null;
    new.reason_code   := null;
  end if;

  if tg_op = 'INSERT'
     or new.is_available is distinct from old.is_available
     or new.snoozed_until is distinct from old.snoozed_until then
    new.changed_at := now();
    new.source := coalesce(new.source, 'manual');
  end if;

  return new;
end $$;

drop trigger if exists normalize_modifier_availability on public.branch_modifier_availability;
create trigger normalize_modifier_availability
  before insert or update on public.branch_modifier_availability
  for each row execute function public.normalize_modifier_availability();

create or replace function public.emit_modifier_availability_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_source text := case when auth.uid() is null then 'automatic' else 'manual' end;
  v_role   public.user_role;
  v_note   text := nullif(btrim(coalesce(current_setting('sma.availability_note', true), '')), '');
  v_action text;
  v_closed boolean;
  v_opened boolean;
  v_rewindow boolean;
begin
  v_closed := (not new.is_available) and (tg_op = 'INSERT' or old.is_available);
  v_opened := new.is_available and tg_op = 'UPDATE' and not old.is_available;
  v_rewindow := (not new.is_available) and tg_op = 'UPDATE' and not old.is_available
    and new.snoozed_until is distinct from old.snoozed_until;

  if v_closed or v_rewindow then
    v_action := 'closed';
  elsif v_opened then
    v_action := case when v_source = 'automatic' then 'opened_auto' else 'opened_manual' end;
  else
    return null;
  end if;

  if v_actor is not null then
    select p.role into v_role from public.profiles p where p.id = v_actor;
  end if;

  insert into public.branch_availability_events (
    branch_id, modifier_id, action, duration_minutes,
    start_time, end_time, actual_open_time,
    reason_code, reason_note, changed_by, actor_role, source
  ) values (
    new.branch_id, new.modifier_id, v_action,
    case when v_action = 'closed' and new.snoozed_until is not null
         then greatest(0, ceil(extract(epoch from (new.snoozed_until - now())) / 60.0))::int
    end,
    case when v_action = 'closed' then now() end,
    case when v_action = 'closed' then new.snoozed_until end,
    case when v_action <> 'closed' then now() end,
    case when v_action = 'closed' then new.reason_code end,
    case when v_action = 'closed' then v_note end,
    v_actor, v_role, v_source
  );

  return null;
end $$;

drop trigger if exists emit_modifier_availability_event on public.branch_modifier_availability;
create trigger emit_modifier_availability_event
  after insert or update on public.branch_modifier_availability
  for each row execute function public.emit_modifier_availability_event();

-- The realtime signal covers modifiers too, so a console refetches on one.
create or replace function public.signal_modifier_availability_change()
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

drop trigger if exists signal_modifier_availability_change on public.branch_modifier_availability;
create trigger signal_modifier_availability_change
  after insert or update on public.branch_modifier_availability
  for each row execute function public.signal_modifier_availability_change();

revoke all on function public.normalize_modifier_availability()      from public, anon, authenticated;
revoke all on function public.emit_modifier_availability_event()     from public, anon, authenticated;
revoke all on function public.signal_modifier_availability_change()  from public, anon, authenticated;

-- ---- RPCs — same authorization as product snooze ------------------------------
-- `is_admin() or is_branch_operator(branch)`. The call centre is excluded from
-- what is sellable, exactly as it is for products.
create or replace function public.set_modifier_snooze(
  p_branch_id   uuid,
  p_modifier_id uuid,
  p_minutes     integer,
  p_reason_code text,
  p_note        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_minutes constant integer := 1440;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_until timestamptz;
begin
  if not (public.is_admin() or public.is_branch_operator(p_branch_id)) then
    raise exception 'Not authorized to change availability for this branch'
      using errcode = '42501';
  end if;
  if p_branch_id is null or p_modifier_id is null then
    raise exception 'branch id and modifier id are required' using errcode = '22004';
  end if;
  if p_minutes is null then
    raise exception 'A closure duration is required' using errcode = '22004';
  end if;
  if p_minutes <= 0 or p_minutes > c_max_minutes then
    raise exception 'Closure duration must be between 1 and % minutes', c_max_minutes
      using errcode = '22023';
  end if;
  if p_reason_code is null or p_reason_code not in
     ('out_of_stock','supplier_delay','equipment_down','quality_hold','other') then
    raise exception 'A valid reason is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.modifiers where id = p_modifier_id) then
    raise exception 'Modifier not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;

  perform set_config('sma.availability_note', coalesce(v_note, ''), true);
  v_until := now() + make_interval(mins => p_minutes);

  insert into public.branch_modifier_availability
    (branch_id, modifier_id, is_available, snoozed_until, reason_code, source)
  values (p_branch_id, p_modifier_id, false, v_until, p_reason_code, 'manual')
  on conflict (branch_id, modifier_id) do update
    set is_available  = false,
        snoozed_until = excluded.snoozed_until,
        reason_code   = excluded.reason_code,
        source        = 'manual';

  perform set_config('sma.availability_note', '', true);

  return jsonb_build_object(
    'branch_id', p_branch_id, 'modifier_id', p_modifier_id, 'snoozed_until', v_until);
end $$;

create or replace function public.clear_modifier_snooze(
  p_branch_id   uuid,
  p_modifier_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_branch_operator(p_branch_id)) then
    raise exception 'Not authorized to change availability for this branch'
      using errcode = '42501';
  end if;
  if p_branch_id is null or p_modifier_id is null then
    raise exception 'branch id and modifier id are required' using errcode = '22004';
  end if;

  update public.branch_modifier_availability
     set is_available = true, source = 'manual'
   where branch_id = p_branch_id
     and modifier_id = p_modifier_id
     and is_available = false;

  return jsonb_build_object(
    'branch_id', p_branch_id, 'modifier_id', p_modifier_id, 'is_available', true);
end $$;

revoke all on function public.set_modifier_snooze(uuid, uuid, integer, text, text) from public, anon;
revoke all on function public.clear_modifier_snooze(uuid, uuid) from public, anon;
grant execute on function public.set_modifier_snooze(uuid, uuid, integer, text, text) to authenticated;
grant execute on function public.clear_modifier_snooze(uuid, uuid) to authenticated;

comment on function public.set_modifier_snooze(uuid, uuid, integer, text, text) is
  'Close one modifier ("price") at one branch for a bounded period. Admin or the branch''s own operator only — call centre excluded, matching product snooze.';

-- ---- Sweeper: one more expiry class, its own counter ---------------------------
alter table public.branch_availability_runs
  add column if not exists modifiers_reopened integer not null default 0;

create or replace function public.branch_availability_sweep()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  c_lock_key constant bigint := 815402977;   -- fixed advisory key for this sweeper
  v_run_id   bigint;
  v_start    timestamptz := clock_timestamp();
  v_reopened integer := 0;
  v_mods     integer := 0;
  v_delivery integer := 0;
  v_areas    integer := 0;
begin
  insert into public.branch_availability_runs (status) values ('running') returning id into v_run_id;

  if not pg_try_advisory_xact_lock(c_lock_key) then
    update public.branch_availability_runs
       set status = 'failed', completed_at = now(),
           safe_error_code = 'overlap_skipped',
           safe_error_message = 'another sweeper run holds the advisory lock',
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;
    return v_run_id;
  end if;

  begin
    -- Items. `snoozed_until is not null` excludes untimed admin closures.
    with reopened as (
      update public.branch_product_availability
         set is_available = true
       where is_available = false
         and snoozed_until is not null
         and snoozed_until <= now()
      returning 1
    )
    select count(*)::int into v_reopened from reopened;

    -- Modifiers, same rule.
    with reopened_mods as (
      update public.branch_modifier_availability
         set is_available = true
       where is_available = false
         and snoozed_until is not null
         and snoozed_until <= now()
      returning 1
    )
    select count(*)::int into v_mods from reopened_mods;

    -- Branch delivery: a null delivery_closed_until is the admin's untimed pause.
    with resumed as (
      update public.branches
         set delivery_temporarily_closed = false
       where delivery_temporarily_closed
         and delivery_closed_until is not null
         and delivery_closed_until <= now()
      returning 1
    )
    select count(*)::int into v_delivery from resumed;

    with reenabled as (
      update public.branch_delivery_areas
         set is_disabled = false
       where is_disabled
         and disabled_until is not null
         and disabled_until <= now()
      returning 1
    )
    select count(*)::int into v_areas from reenabled;

    update public.branch_availability_runs
       set status = 'success', completed_at = now(),
           products_reopened  = v_reopened,
           modifiers_reopened = v_mods,
           delivery_resumed   = v_delivery,
           areas_reenabled    = v_areas,
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;

  exception when others then
    update public.branch_availability_runs
       set status = 'failed', completed_at = now(),
           safe_error_code = sqlstate,
           safe_error_message = 'sweep failed; see sqlstate',
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;
  end;

  return v_run_id;
end $$;

revoke all on function public.branch_availability_sweep() from public, anon, authenticated;
grant execute on function public.branch_availability_sweep() to service_role;
