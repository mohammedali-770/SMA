-- ============================================================================
-- Spicy Meal — branch delivery control: timed pause, named areas, working hours
--
-- `branches.delivery_temporarily_closed` is a bare boolean today. "Temporary"
-- means only that a human is expected to remember to untick it — there is no
-- expiry, no reason, no actor and no history. This is the branch-level version
-- of the gap 20260820110000 closed for items.
--
-- THE KEYSTONE, AGAIN
-- `delivery_temporarily_closed` REMAINS the authoritative flag and
-- `delivery_closed_until` is only the scheduled resume time, so the two
-- byte-identical delivery guards keep their exact current meaning and neither
-- order-path function is touched:
--   * place_order              20260710120100_place_order_delivery_zone.sql:131-134
--   * compute_order_snapshot   20260712160000_checkout_sessions.sql:158-162
-- The second one is the online-payment twin — note it is `compute_order_snapshot`
-- that reads the branch row, NOT `begin_checkout_session`, whose current body
-- (20260712170000) declares no branches rowtype at all.
--
-- ADDING COLUMNS TO `branches` IS SAFE, WITH PRECEDENT
-- 20260708130000_lazywait_integration.sql:21 added `lazywait_branch_id` and did
-- not re-emit place_order, which already declared `v_branch public.branches`.
-- Every consumer reads NAMED fields; nothing accesses the row positionally and
-- nothing serializes it whole (no to_jsonb(v_branch) anywhere in the chain), so
-- no output shape changes.
--
-- WHAT IS DELIBERATELY NOT ON `branches`
-- `branches_select_active_public` (20260810143000:20-28) lets `anon` read every
-- column of every active branch, and BOTH clients request `select('*')`
-- (src/lib/api.ts, apps/mobile/src/services/api.ts). So the staff actor and the
-- free-text note stay on the events table, exactly as
-- branch_availability_snooze_test.sql already asserts for items.
--
-- A reason CODE is kept off `branches` too, unlike the product equivalent. The
-- asymmetry is deliberate: a product's reason has a future customer-facing use
-- ("out of stock, back at 18:00"), whereas a paused branch simply drops out of
-- the delivery list and the customer never sees a reason. No customer use, no
-- exposure.
-- ============================================================================

-- ---- 1. Branch columns -------------------------------------------------------
alter table public.branches
  add column if not exists email                 text,
  add column if not exists delivery_closed_until timestamptz,
  add column if not exists delivery_closed_at    timestamptz;

comment on column public.branches.email is
  'Public branch contact address, alongside the already-public phone/address. NOT an internal ops distribution list — this column is readable by anonymous customers.';
comment on column public.branches.delivery_closed_until is
  'Scheduled auto-resume time for a delivery pause. NULL while delivery_temporarily_closed is true means an untimed pause (the admin toggle) that the sweeper must never resume.';

create index if not exists branches_delivery_closed_until_idx
  on public.branches (delivery_closed_until)
  where delivery_temporarily_closed and delivery_closed_until is not null;

-- ---- 2. Named delivery areas — ADVISORY, call-centre reference only ----------
-- The owner was explicit: area names exist for call-centre staff taking phone
-- orders, and the app depends solely on the PostGIS polygon. These rows are
-- therefore NOT readable by anon — keeping them out of the public set stops a
-- future change from rendering them to customers as if they meant something.
create table if not exists public.branch_delivery_areas (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches(id) on delete cascade,
  name_ar     text not null,
  name_en     text,
  sort_order  integer not null default 0,
  is_disabled boolean not null default false,
  disabled_until timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists bda_branch_sort_idx
  on public.branch_delivery_areas (branch_id, sort_order);

comment on table public.branch_delivery_areas is
  'ADVISORY ONLY. A named list of delivery areas per branch, for call-centre staff taking phone orders. place_order and compute_order_snapshot DO NOT read this table — delivery eligibility is decided solely by point_in_active_delivery_zone against the branch polygon. Disabling an area does not stop the app accepting orders from it.';

-- ---- 3. Working hours — ADVISORY, publicly readable --------------------------
-- One window per weekday. A closes_at at or before opens_at means the window
-- CROSSES MIDNIGHT (12:00 -> 02:00), which is normal for a late-night branch and
-- is the reason the primary key is one row per day rather than per shift. Do not
-- "fix" such a row as inverted data.
create table if not exists public.branch_working_hours (
  branch_id   uuid not null references public.branches(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  is_closed   boolean not null default false,
  opens_at    time,
  closes_at   time,
  updated_at  timestamptz not null default now(),
  primary key (branch_id, day_of_week),
  constraint bwh_window_present check (is_closed or (opens_at is not null and closes_at is not null))
);

comment on table public.branch_working_hours is
  'ADVISORY ONLY. Per-branch trading hours, day_of_week 0=Sunday. A closes_at <= opens_at means the window crosses midnight. NOTHING enforces these: branch open/closed for ordering remains branches.is_active, and no order path reads this table. Distinct from app_settings.support_hours_*, which is one global free-text SUPPORT-hours string shown on the customer Legal screen.';

-- ---- 4. Append-only audit ----------------------------------------------------
create table if not exists public.branch_delivery_events (
  id               bigint generated always as identity primary key,
  branch_id        uuid not null references public.branches(id) on delete cascade,
  area_id          uuid references public.branch_delivery_areas(id) on delete set null,
  action           text not null check (action in (
                     'delivery_paused','delivery_resumed_manual','delivery_resumed_auto',
                     'area_disabled','area_enabled_manual','area_enabled_auto')),
  duration_minutes integer,
  start_time       timestamptz,
  end_time         timestamptz,
  actual_open_time timestamptz,
  reason_code      text,
  reason_note      text check (reason_note is null or length(reason_note) <= 500),
  changed_by       uuid references auth.users(id) on delete set null,
  actor_role       public.user_role,
  source           text not null check (source in ('manual','automatic')),
  -- clock_timestamp, not now(): the sweeper writes many rows per transaction and
  -- they must order correctly. Precedent: 20260707120900_loyalty_audit.sql.
  created_at       timestamptz not null default clock_timestamp()
);

create index if not exists bde_branch_created_idx
  on public.branch_delivery_events (branch_id, created_at desc);

comment on table public.branch_delivery_events is
  'Append-only audit of every branch delivery-pause and area transition. Written exclusively by the triggers below, so no write path can escape it. Carries the actor and the free-text note that are deliberately kept off the world-readable branches table.';

-- ---- 5. RLS ------------------------------------------------------------------
-- Areas and events: ops-only read, no client write path at all.
-- Working hours: publicly readable business information.
alter table public.branch_delivery_areas  enable row level security;
alter table public.branch_delivery_events enable row level security;
alter table public.branch_working_hours   enable row level security;

revoke all on public.branch_delivery_areas  from public, anon, authenticated;
revoke all on public.branch_delivery_events from public, anon, authenticated;
revoke all on public.branch_working_hours   from public, anon, authenticated;

grant select on public.branch_delivery_areas  to authenticated;
grant select on public.branch_delivery_events to authenticated;
grant select on public.branch_working_hours   to anon, authenticated;

drop policy if exists bda_select_ops on public.branch_delivery_areas;
create policy bda_select_ops
  on public.branch_delivery_areas for select to authenticated
  using (public.is_staff() or public.is_call_center() or public.is_branch_operator(branch_id));

drop policy if exists bde_select_ops on public.branch_delivery_events;
create policy bde_select_ops
  on public.branch_delivery_events for select to authenticated
  using (public.is_staff() or public.is_call_center() or public.is_branch_operator(branch_id));

drop policy if exists bwh_select_public on public.branch_working_hours;
create policy bwh_select_public
  on public.branch_working_hours for select to anon, authenticated
  using (true);

drop trigger if exists set_branch_delivery_areas_updated_at on public.branch_delivery_areas;
create trigger set_branch_delivery_areas_updated_at
  before update on public.branch_delivery_areas
  for each row execute function public.set_updated_at();

drop trigger if exists set_branch_working_hours_updated_at on public.branch_working_hours;
create trigger set_branch_working_hours_updated_at
  before update on public.branch_working_hours
  for each row execute function public.set_updated_at();

-- ---- 6. Invariant normalization + audit, mirroring the item snooze -----------
-- The admin's existing plain toggle writes `delivery_temporarily_closed` through
-- branchPatchToDb (src/lib/mappers.ts) without touching the timer, so resuming
-- delivery that way would strand a delivery_closed_until and the next pause would
-- silently inherit it. Normalizing here makes the invariant hold for EVERY writer.
create or replace function public.normalize_branch_delivery_pause()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.delivery_temporarily_closed then
    new.delivery_closed_until := null;
  end if;

  if tg_op = 'INSERT'
     or new.delivery_temporarily_closed is distinct from old.delivery_temporarily_closed
     or new.delivery_closed_until is distinct from old.delivery_closed_until then
    new.delivery_closed_at := now();
  end if;

  return new;
end $$;

drop trigger if exists normalize_branch_delivery_pause on public.branches;
create trigger normalize_branch_delivery_pause
  before insert or update on public.branches
  for each row execute function public.normalize_branch_delivery_pause();

-- Actor attribution needs no session flag: auth.uid() is non-null for an
-- operator's RPC and null under pg_cron. Same discriminator as the item audit.
create or replace function public.emit_branch_delivery_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_source text := case when auth.uid() is null then 'automatic' else 'manual' end;
  v_role   public.user_role;
  v_note   text := nullif(btrim(coalesce(current_setting('sma.delivery_note', true), '')), '');
  v_code   text := nullif(btrim(coalesce(current_setting('sma.delivery_reason', true), '')), '');
  v_action text;
  v_paused   boolean;
  v_resumed  boolean;
  v_rewindow boolean;
begin
  v_paused := new.delivery_temporarily_closed
    and (tg_op = 'INSERT' or not old.delivery_temporarily_closed);
  v_resumed := (not new.delivery_temporarily_closed)
    and tg_op = 'UPDATE' and old.delivery_temporarily_closed;
  -- Re-pausing that only moves the timer is a real operational act.
  v_rewindow := new.delivery_temporarily_closed
    and tg_op = 'UPDATE' and old.delivery_temporarily_closed
    and new.delivery_closed_until is distinct from old.delivery_closed_until;

  if v_paused or v_rewindow then
    v_action := 'delivery_paused';
  elsif v_resumed then
    v_action := case when v_source = 'automatic'
                     then 'delivery_resumed_auto' else 'delivery_resumed_manual' end;
  else
    -- No delivery-pause transition: an unrelated branch edit.
    return null;
  end if;

  if v_actor is not null then
    select p.role into v_role from public.profiles p where p.id = v_actor;
  end if;

  insert into public.branch_delivery_events (
    branch_id, action, duration_minutes, start_time, end_time, actual_open_time,
    reason_code, reason_note, changed_by, actor_role, source
  ) values (
    new.id,
    v_action,
    case when v_action = 'delivery_paused' and new.delivery_closed_until is not null
         then greatest(0, ceil(extract(epoch from (new.delivery_closed_until - now())) / 60.0))::int
    end,
    case when v_action = 'delivery_paused' then now() end,
    case when v_action = 'delivery_paused' then new.delivery_closed_until end,
    case when v_action <> 'delivery_paused' then now() end,
    case when v_action = 'delivery_paused' then v_code end,
    case when v_action = 'delivery_paused' then v_note end,
    v_actor, v_role, v_source
  );

  return null;
end $$;

drop trigger if exists emit_branch_delivery_event on public.branches;
create trigger emit_branch_delivery_event
  after insert or update on public.branches
  for each row execute function public.emit_branch_delivery_event();

-- ---- 7. The same pair for areas ---------------------------------------------
create or replace function public.normalize_delivery_area()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.is_disabled then
    new.disabled_until := null;
  end if;
  return new;
end $$;

drop trigger if exists normalize_delivery_area on public.branch_delivery_areas;
create trigger normalize_delivery_area
  before insert or update on public.branch_delivery_areas
  for each row execute function public.normalize_delivery_area();

create or replace function public.emit_delivery_area_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_source text := case when auth.uid() is null then 'automatic' else 'manual' end;
  v_role   public.user_role;
  v_note   text := nullif(btrim(coalesce(current_setting('sma.delivery_note', true), '')), '');
  v_code   text := nullif(btrim(coalesce(current_setting('sma.delivery_reason', true), '')), '');
  v_action text;
  v_off boolean;
  v_on  boolean;
  v_rewindow boolean;
begin
  v_off := new.is_disabled and (tg_op = 'INSERT' or not old.is_disabled);
  v_on  := (not new.is_disabled) and tg_op = 'UPDATE' and old.is_disabled;
  v_rewindow := new.is_disabled and tg_op = 'UPDATE' and old.is_disabled
    and new.disabled_until is distinct from old.disabled_until;

  if v_off or v_rewindow then
    v_action := 'area_disabled';
  elsif v_on then
    v_action := case when v_source = 'automatic'
                     then 'area_enabled_auto' else 'area_enabled_manual' end;
  else
    return null;
  end if;

  if v_actor is not null then
    select p.role into v_role from public.profiles p where p.id = v_actor;
  end if;

  insert into public.branch_delivery_events (
    branch_id, area_id, action, duration_minutes, start_time, end_time, actual_open_time,
    reason_code, reason_note, changed_by, actor_role, source
  ) values (
    new.branch_id, new.id, v_action,
    case when v_action = 'area_disabled' and new.disabled_until is not null
         then greatest(0, ceil(extract(epoch from (new.disabled_until - now())) / 60.0))::int
    end,
    case when v_action = 'area_disabled' then now() end,
    case when v_action = 'area_disabled' then new.disabled_until end,
    case when v_action <> 'area_disabled' then now() end,
    case when v_action = 'area_disabled' then v_code end,
    case when v_action = 'area_disabled' then v_note end,
    v_actor, v_role, v_source
  );

  return null;
end $$;

drop trigger if exists emit_delivery_area_event on public.branch_delivery_areas;
create trigger emit_delivery_area_event
  after insert or update on public.branch_delivery_areas
  for each row execute function public.emit_delivery_area_event();

revoke all on function public.normalize_branch_delivery_pause() from public, anon, authenticated;
revoke all on function public.emit_branch_delivery_event()      from public, anon, authenticated;
revoke all on function public.normalize_delivery_area()         from public, anon, authenticated;
revoke all on function public.emit_delivery_area_event()        from public, anon, authenticated;
