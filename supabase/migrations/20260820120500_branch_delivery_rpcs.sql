-- ============================================================================
-- Spicy Meal — branch delivery control RPCs
--
-- AUTHORIZATION IS `is_admin() or is_call_center()`, NOT `is_ops_operator()`.
-- Owner decision 2026-08-20: pausing delivery and disabling named areas are
-- call-centre acts, not counter acts. `is_ops_operator()` would additionally
-- admit the branch operator assigned to that branch, so it is deliberately not
-- used here — the mirror image of the item RPCs (20260820110500), which are
-- `is_admin() or is_branch_operator()` and deliberately exclude the call centre.
--
-- Between them the two files express the whole split: the branch owns what is
-- sellable, the call centre owns where it can go, and an admin can do both.
--
-- As with items, the audit row is NOT written here. The triggers on `branches`
-- and `branch_delivery_areas` are the single audit writers, so the admin's
-- existing plain toggle is audited too. The reason code and note reach them
-- through transaction-local settings.
-- ============================================================================

create or replace function public.set_branch_delivery_pause(
  p_branch_id   uuid,
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
  if not (public.is_admin() or public.is_call_center()) then
    raise exception 'Not authorized to change delivery for this branch'
      using errcode = '42501';
  end if;
  if p_branch_id is null then
    raise exception 'branch id is required' using errcode = '22004';
  end if;
  if p_minutes is null then
    raise exception 'A pause duration is required' using errcode = '22004';
  end if;
  if p_minutes <= 0 or p_minutes > c_max_minutes then
    raise exception 'Pause duration must be between 1 and % minutes', c_max_minutes
      using errcode = '22023';
  end if;
  if p_reason_code is null or p_reason_code not in
     ('no_driver','weather','kitchen_overload','area_incident','other') then
    raise exception 'A valid reason is required' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'The note must be 500 characters or fewer' using errcode = '22023';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;

  perform set_config('sma.delivery_reason', p_reason_code, true);
  perform set_config('sma.delivery_note', coalesce(v_note, ''), true);

  v_until := now() + make_interval(mins => p_minutes);

  update public.branches
     set delivery_temporarily_closed = true,
         delivery_closed_until = v_until
   where id = p_branch_id;

  perform set_config('sma.delivery_reason', '', true);
  perform set_config('sma.delivery_note', '', true);

  return jsonb_build_object('branch_id', p_branch_id, 'delivery_closed_until', v_until);
end $$;

create or replace function public.clear_branch_delivery_pause(p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_call_center()) then
    raise exception 'Not authorized to change delivery for this branch'
      using errcode = '42501';
  end if;
  if p_branch_id is null then
    raise exception 'branch id is required' using errcode = '22004';
  end if;

  -- Idempotent: resuming delivery that is already running is not an error.
  update public.branches
     set delivery_temporarily_closed = false
   where id = p_branch_id
     and delivery_temporarily_closed;

  return jsonb_build_object('branch_id', p_branch_id, 'delivery_temporarily_closed', false);
end $$;

-- ---- Areas: advisory state, same authorization -------------------------------
create or replace function public.set_delivery_area_disabled(
  p_area_id     uuid,
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
  if not (public.is_admin() or public.is_call_center()) then
    raise exception 'Not authorized to change delivery areas' using errcode = '42501';
  end if;
  if p_area_id is null then
    raise exception 'area id is required' using errcode = '22004';
  end if;
  if p_minutes is null then
    raise exception 'A duration is required' using errcode = '22004';
  end if;
  if p_minutes <= 0 or p_minutes > c_max_minutes then
    raise exception 'Duration must be between 1 and % minutes', c_max_minutes
      using errcode = '22023';
  end if;
  if p_reason_code is null or p_reason_code not in
     ('no_driver','weather','kitchen_overload','area_incident','other') then
    raise exception 'A valid reason is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.branch_delivery_areas where id = p_area_id) then
    raise exception 'Delivery area not found' using errcode = 'P0002';
  end if;

  perform set_config('sma.delivery_reason', p_reason_code, true);
  perform set_config('sma.delivery_note', coalesce(v_note, ''), true);

  v_until := now() + make_interval(mins => p_minutes);

  update public.branch_delivery_areas
     set is_disabled = true, disabled_until = v_until
   where id = p_area_id;

  perform set_config('sma.delivery_reason', '', true);
  perform set_config('sma.delivery_note', '', true);

  return jsonb_build_object('area_id', p_area_id, 'disabled_until', v_until);
end $$;

create or replace function public.clear_delivery_area_disabled(p_area_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_call_center()) then
    raise exception 'Not authorized to change delivery areas' using errcode = '42501';
  end if;
  if p_area_id is null then
    raise exception 'area id is required' using errcode = '22004';
  end if;

  update public.branch_delivery_areas
     set is_disabled = false
   where id = p_area_id and is_disabled;

  return jsonb_build_object('area_id', p_area_id, 'is_disabled', false);
end $$;

-- ---- Admin-only configuration ------------------------------------------------
-- Creating/removing an area and setting trading hours are configuration, not
-- operations, so they stay with admins rather than the call centre.
create or replace function public.admin_upsert_branch_working_hours(
  p_branch_id uuid,
  p_days      jsonb           -- [{day_of_week, is_closed, opens_at, closes_at}, ...]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day    jsonb;
  v_dow    smallint;
  v_closed boolean;
  v_open   time;
  v_close  time;
  v_count  integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins may set branch working hours' using errcode = '42501';
  end if;
  if p_branch_id is null or p_days is null or jsonb_typeof(p_days) <> 'array' then
    raise exception 'branch id and a days array are required' using errcode = '22004';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;

  for v_day in select * from jsonb_array_elements(p_days) loop
    v_dow    := (v_day ->> 'day_of_week')::smallint;
    v_closed := coalesce((v_day ->> 'is_closed')::boolean, false);
    v_open   := nullif(v_day ->> 'opens_at', '')::time;
    v_close  := nullif(v_day ->> 'closes_at', '')::time;

    if v_dow is null or v_dow < 0 or v_dow > 6 then
      raise exception 'day_of_week must be 0..6' using errcode = '22023';
    end if;
    -- An open day needs both bounds. closes_at <= opens_at is VALID and means the
    -- window crosses midnight; do not reject it.
    if not v_closed and (v_open is null or v_close is null) then
      raise exception 'An open day needs both an opening and a closing time'
        using errcode = '22023';
    end if;

    insert into public.branch_working_hours (branch_id, day_of_week, is_closed, opens_at, closes_at)
    values (p_branch_id, v_dow, v_closed,
            case when v_closed then null else v_open end,
            case when v_closed then null else v_close end)
    on conflict (branch_id, day_of_week) do update
      set is_closed = excluded.is_closed,
          opens_at  = excluded.opens_at,
          closes_at = excluded.closes_at,
          updated_at = now();
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('branch_id', p_branch_id, 'days_written', v_count);
end $$;

create or replace function public.admin_add_delivery_area(
  p_branch_id uuid,
  p_name_ar   text,
  p_name_en   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_next integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins may add a delivery area' using errcode = '42501';
  end if;
  if p_branch_id is null or nullif(btrim(coalesce(p_name_ar, '')), '') is null then
    raise exception 'branch id and an Arabic area name are required' using errcode = '22004';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;

  select coalesce(max(sort_order), 0) + 1 into v_next
    from public.branch_delivery_areas where branch_id = p_branch_id;

  insert into public.branch_delivery_areas (branch_id, name_ar, name_en, sort_order)
  values (p_branch_id, btrim(p_name_ar), nullif(btrim(coalesce(p_name_en, '')), ''), v_next)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'branch_id', p_branch_id, 'sort_order', v_next);
end $$;

create or replace function public.admin_update_delivery_area(
  p_area_id    uuid,
  p_name_ar    text default null,
  p_name_en    text default null,
  p_sort_order integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins may edit a delivery area' using errcode = '42501';
  end if;
  if p_area_id is null then
    raise exception 'area id is required' using errcode = '22004';
  end if;

  update public.branch_delivery_areas
     set name_ar    = coalesce(nullif(btrim(coalesce(p_name_ar, '')), ''), name_ar),
         name_en    = case when p_name_en is null then name_en
                           else nullif(btrim(p_name_en), '') end,
         sort_order = coalesce(p_sort_order, sort_order)
   where id = p_area_id;
  if not found then
    raise exception 'Delivery area not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('id', p_area_id);
end $$;

create or replace function public.admin_delete_delivery_area(p_area_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins may delete a delivery area' using errcode = '42501';
  end if;
  if p_area_id is null then
    raise exception 'area id is required' using errcode = '22004';
  end if;

  delete from public.branch_delivery_areas where id = p_area_id;
  return jsonb_build_object('id', p_area_id, 'deleted', true);
end $$;

revoke all on function public.set_branch_delivery_pause(uuid, integer, text, text)   from public, anon;
revoke all on function public.clear_branch_delivery_pause(uuid)                      from public, anon;
revoke all on function public.set_delivery_area_disabled(uuid, integer, text, text)  from public, anon;
revoke all on function public.clear_delivery_area_disabled(uuid)                     from public, anon;
revoke all on function public.admin_upsert_branch_working_hours(uuid, jsonb)         from public, anon;
revoke all on function public.admin_add_delivery_area(uuid, text, text)              from public, anon;
revoke all on function public.admin_update_delivery_area(uuid, text, text, integer)  from public, anon;
revoke all on function public.admin_delete_delivery_area(uuid)                       from public, anon;

grant execute on function public.set_branch_delivery_pause(uuid, integer, text, text)   to authenticated;
grant execute on function public.clear_branch_delivery_pause(uuid)                      to authenticated;
grant execute on function public.set_delivery_area_disabled(uuid, integer, text, text)  to authenticated;
grant execute on function public.clear_delivery_area_disabled(uuid)                     to authenticated;
grant execute on function public.admin_upsert_branch_working_hours(uuid, jsonb)         to authenticated;
grant execute on function public.admin_add_delivery_area(uuid, text, text)              to authenticated;
grant execute on function public.admin_update_delivery_area(uuid, text, text, integer)  to authenticated;
grant execute on function public.admin_delete_delivery_area(uuid)                       to authenticated;

comment on function public.set_branch_delivery_pause(uuid, integer, text, text) is
  'Pause a branch''s delivery for a bounded period. Admin or call centre only — branch staff are deliberately excluded (owner decision 2026-08-20). Duration is mandatory; the untimed pause remains the admin Branch Management toggle.';
comment on function public.set_delivery_area_disabled(uuid, integer, text, text) is
  'Disable one ADVISORY named delivery area. This does not affect order acceptance — place_order decides delivery eligibility solely from the branch polygon.';
