-- ============================================================================
-- Spicy Meal — branch item snooze RPCs
--
-- The only write path branch operators get. They hold no direct grant on
-- branch_product_availability: the catalog RLS loop gives write access to
-- `is_admin()` alone (20260707120200:114-126), so these SECURITY DEFINER
-- functions are what a cashier's console actually calls.
--
-- AUTHORIZATION IS DELIBERATELY NARROWER THAN is_ops_operator().
-- Owner decision 2026-08-20: the call centre monitors items but does not close
-- them — one owner for what is sellable, namely the branch holding the stock.
-- So the predicate here is `is_admin() or is_branch_operator(branch)`, NOT
-- `is_ops_operator(branch)`, which would admit call centre. Delivery control
-- (a later phase) does use is_ops_operator, because the call centre IS
-- authorized for that.
--
-- CASHIERS GET TIMED CLOSES ONLY. p_minutes is required and must be positive,
-- so everything a cashier closes reopens by itself. The untimed close — an
-- item genuinely delisted until someone says otherwise — stays with admins
-- through the existing Branch Management toggle. Different control, different
-- audience, different blast radius.
--
-- The audit row is NOT written here. The trigger on branch_product_availability
-- is the single audit writer, so the existing admin toggle is audited too and
-- no write path can escape the trail. The free-text note reaches it through a
-- transaction-local setting rather than a second insert.
-- ============================================================================

-- 24h ceiling on a single snooze. The console offers at most 12h; this is the
-- guard against a fat-fingered 99999 quietly removing an item for ten weeks.
-- Re-snoozing is one tap, so the ceiling costs nothing operationally.
create or replace function public.set_product_snooze(
  p_branch_id   uuid,
  p_product_id  uuid,
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
  if p_branch_id is null or p_product_id is null then
    raise exception 'branch id and product id are required' using errcode = '22004';
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
  if v_note is not null and length(v_note) > 500 then
    raise exception 'The note must be 500 characters or fewer' using errcode = '22023';
  end if;

  if not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  -- Hand the note to the audit trigger. Transaction-local, so it cannot leak
  -- into an unrelated statement later in the session.
  perform set_config('sma.availability_note', coalesce(v_note, ''), true);

  v_until := now() + make_interval(mins => p_minutes);

  insert into public.branch_product_availability
    (branch_id, product_id, is_available, snoozed_until, reason_code, source)
  values
    (p_branch_id, p_product_id, false, v_until, p_reason_code, 'manual')
  on conflict (branch_id, product_id) do update
    set is_available  = false,
        snoozed_until = excluded.snoozed_until,
        reason_code   = excluded.reason_code,
        source        = 'manual';

  perform set_config('sma.availability_note', '', true);

  return jsonb_build_object(
    'branch_id', p_branch_id,
    'product_id', p_product_id,
    'snoozed_until', v_until,
    'reason_code', p_reason_code
  );
end $$;

create or replace function public.clear_product_snooze(
  p_branch_id  uuid,
  p_product_id uuid
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
  if p_branch_id is null or p_product_id is null then
    raise exception 'branch id and product id are required' using errcode = '22004';
  end if;

  -- Idempotent: an item that is already available is not an error. A cashier
  -- tapping "available" twice, or racing the sweeper, should not see a failure.
  update public.branch_product_availability
     set is_available = true,
         source = 'manual'
   where branch_id = p_branch_id
     and product_id = p_product_id
     and is_available = false;

  return jsonb_build_object(
    'branch_id', p_branch_id,
    'product_id', p_product_id,
    'is_available', true
  );
end $$;

revoke all on function public.set_product_snooze(uuid, uuid, integer, text, text)
  from public, anon;
revoke all on function public.clear_product_snooze(uuid, uuid) from public, anon;
grant execute on function public.set_product_snooze(uuid, uuid, integer, text, text)
  to authenticated;
grant execute on function public.clear_product_snooze(uuid, uuid) to authenticated;

comment on function public.set_product_snooze(uuid, uuid, integer, text, text) is
  'Close a product at one branch for a bounded period. Admin or the branch''s own operator only — call centre is intentionally excluded (owner decision 2026-08-20). Duration is mandatory: cashiers cannot create an untimed closure.';
comment on function public.clear_product_snooze(uuid, uuid) is
  'Reopen a product at one branch immediately. Idempotent. Admin or the branch''s own operator only.';
