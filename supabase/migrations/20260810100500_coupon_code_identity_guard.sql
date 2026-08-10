-- ============================================================================
-- Spicy Meal — preserve coupon identity for cancellation compensation.
--
-- Orders currently snapshot `coupon_code`, not `coupon_id`. Cancellation returns
-- one consumed usage slot by that snapshot. If an admin could rename/delete a
-- coupon after it had been used, a later cancellation could either fail to find
-- the original coupon or decrement a newly-created coupon that reused the code.
--
-- Rather than retrofitting an ID through every historical order/create-order
-- contract, make the existing snapshotted code immutable once any order refers
-- to it. Admins may still deactivate a used coupon and edit every other field;
-- only code mutation/deletion is blocked. Unused coupons remain freely
-- renameable/deletable.
-- ============================================================================

create or replace function public.guard_used_coupon_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used boolean;
begin
  select exists (
    select 1
      from public.orders o
     where o.coupon_code is not null
       and upper(btrim(o.coupon_code)) = upper(btrim(old.code))
  ) into v_used;

  if not v_used then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'A coupon referenced by an order cannot be deleted; deactivate it instead.'
      using errcode = '23503';
  end if;

  if new.code is distinct from old.code then
    raise exception 'A coupon code referenced by an order cannot be changed; deactivate it instead.'
      using errcode = '23503';
  end if;

  return new;
end $$;

revoke all on function public.guard_used_coupon_identity() from public, anon, authenticated;

drop trigger if exists guard_used_coupon_identity on public.coupons;
create trigger guard_used_coupon_identity
  before update of code or delete on public.coupons
  for each row execute function public.guard_used_coupon_identity();

comment on function public.guard_used_coupon_identity() is
  'Preserves the coupon_code snapshot used by order cancellation compensation. Once any order references a coupon code, that coupon may be deactivated/edited but its code may not be changed and the row may not be deleted/reused.';
