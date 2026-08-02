-- ============================================================================
-- Historical-row semantics for loyalty reasons (migrations 20260724130000 +
-- 20260724190000).
--
-- Runs against a throwaway Postgres with the FULL migration chain applied. Each
-- case RAISES EXCEPTION on failure; a clean run prints NOTICEs and commits
-- nothing (wrapped in a rollback).
--
-- The question this suite answers, from the review: create a historical row whose
-- reason contains SM-…, then update an UNRELATED mutable column. That update must
--   (a) remain permitted,
--   (b) not silently rewrite `reason`, and
--   (c) not be rejected merely because the reason predates the rule.
-- while new inserts and genuine reason changes are still protected.
-- ============================================================================
begin;


-- A branch to hang test orders on: orders.branch_id is a real FK.
insert into public.branches (id, name_en, name_ar)
values ('b0000000-0000-0000-0000-0000000000ff', 'Suite Branch', 'فرع الاختبار')
on conflict (id) do nothing;

create or replace function pg_temp.has_sm_number(p text)
returns boolean language sql immutable as $$
  select p is not null and p ~ 'SM-[0-9]{4}-[0-9]{4,}';
$$;

-- A profile to own the rows.
create or replace function pg_temp.mk_profile() returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  -- profiles.id references auth.users(id), so the auth user must exist first;
  -- handle_new_user() then creates the profile row, which is why the insert
  -- below upserts rather than plain-inserts.
  insert into auth.users (id) values (v_id) on conflict (id) do nothing;
  insert into public.profiles (id) values (v_id) on conflict (id) do nothing;
  return v_id;
end $$;

-- Case 1: a HISTORICAL row (written before the rule) survives an unrelated update
--         unchanged, permitted, and un-laundered.
do $$
declare
  v_p uuid := pg_temp.mk_profile();
  v_id uuid := gen_random_uuid();
  v_reason text;
begin
  -- Simulate a pre-rule row by writing it with the trigger disabled.
  alter table public.loyalty_transactions disable trigger set_loyalty_transactions_safe_reason;
  insert into public.loyalty_transactions (id, profile_id, type, points, balance_after, reason)
    values (v_id, v_p, 'earn', 10, 10, 'Earned on order SM-2026-000032');
  alter table public.loyalty_transactions enable trigger set_loyalty_transactions_safe_reason;

  select reason into v_reason from public.loyalty_transactions where id = v_id;
  if v_reason <> 'Earned on order SM-2026-000032' then
    raise exception 'CASE 1 PRECONDITION FAILED: fixture not stored verbatim (%)', v_reason;
  end if;

  -- (a) PERMITTED and (c) NOT REJECTED: an unrelated mutable column.
  begin
    update public.loyalty_transactions set balance_after = 999 where id = v_id;
  exception when others then
    raise exception 'CASE 1 FAILED (a/c): unrelated update rejected: % / %', sqlstate, sqlerrm;
  end;

  -- (b) NOT SILENTLY REWRITTEN.
  select reason into v_reason from public.loyalty_transactions where id = v_id;
  if v_reason <> 'Earned on order SM-2026-000032' then
    raise exception 'CASE 1 FAILED (b): historical reason was silently rewritten to %', v_reason;
  end if;

  if (select balance_after from public.loyalty_transactions where id = v_id) <> 999 then
    raise exception 'CASE 1 FAILED: the unrelated column did not actually change';
  end if;

  raise notice 'CASE 1 ok: historical row updatable, untouched, not rejected';
end $$;

-- Case 2: several unrelated updates in a row still do not launder history.
do $$
declare
  v_p uuid := pg_temp.mk_profile();
  v_id uuid := gen_random_uuid();
  v_reason text;
begin
  alter table public.loyalty_transactions disable trigger set_loyalty_transactions_safe_reason;
  insert into public.loyalty_transactions (id, profile_id, type, points, balance_after, reason)
    values (v_id, v_p, 'redeem', -5, 5, 'Redeemed on order SM-2026-000077');
  alter table public.loyalty_transactions enable trigger set_loyalty_transactions_safe_reason;

  update public.loyalty_transactions set balance_after = 1 where id = v_id;
  update public.loyalty_transactions set points = -6 where id = v_id;
  update public.loyalty_transactions set balance_after = 2 where id = v_id;

  select reason into v_reason from public.loyalty_transactions where id = v_id;
  if not pg_temp.has_sm_number(v_reason) then
    raise exception 'CASE 2 FAILED: history was laundered after repeated updates (%)', v_reason;
  end if;
  raise notice 'CASE 2 ok: repeated unrelated updates leave history intact';
end $$;

-- Case 3: a GENUINE reason change IS normalized, even on a historical row — the
--         caller is writing a new reason, so the rule applies to it.
do $$
declare
  v_p uuid := pg_temp.mk_profile();
  v_id uuid := gen_random_uuid();
  v_reason text;
begin
  alter table public.loyalty_transactions disable trigger set_loyalty_transactions_safe_reason;
  insert into public.loyalty_transactions (id, profile_id, type, points, balance_after, reason)
    values (v_id, v_p, 'earn', 10, 10, 'Earned on order SM-2026-000088');
  alter table public.loyalty_transactions enable trigger set_loyalty_transactions_safe_reason;

  update public.loyalty_transactions
     set reason = 'Manual fix for order SM-2026-000088' where id = v_id;

  select reason into v_reason from public.loyalty_transactions where id = v_id;
  if pg_temp.has_sm_number(v_reason) then
    raise exception 'CASE 3 FAILED: a NEW reason kept the internal number (%)', v_reason;
  end if;
  raise notice 'CASE 3 ok: a genuine reason change is still normalized';
end $$;

-- Case 4: NEW inserts are still protected (the original guarantee).
do $$
declare
  v_p uuid := pg_temp.mk_profile();
  v_id uuid := gen_random_uuid();
  v_reason text;
begin
  insert into public.loyalty_transactions (id, profile_id, type, points, balance_after, reason)
    values (v_id, v_p, 'earn', 10, 10, 'Earned on order SM-2026-000099');
  select reason into v_reason from public.loyalty_transactions where id = v_id;
  if pg_temp.has_sm_number(v_reason) then
    raise exception 'CASE 4 FAILED: a new insert stored the internal number (%)', v_reason;
  end if;
  raise notice 'CASE 4 ok: new inserts are normalized';
end $$;

-- Case 5: a NULL→NULL update is treated as unchanged (no spurious normalization).
do $$
declare
  v_p uuid := pg_temp.mk_profile();
  v_id uuid := gen_random_uuid();
begin
  alter table public.loyalty_transactions disable trigger set_loyalty_transactions_safe_reason;
  insert into public.loyalty_transactions (id, profile_id, type, points, balance_after, reason)
    values (v_id, v_p, 'adjustment', 3, 3, null);
  alter table public.loyalty_transactions enable trigger set_loyalty_transactions_safe_reason;

  update public.loyalty_transactions set balance_after = 4 where id = v_id;
  if (select reason from public.loyalty_transactions where id = v_id) is not null then
    raise exception 'CASE 5 FAILED: a NULL reason was rewritten by an unrelated update';
  end if;
  raise notice 'CASE 5 ok: NULL reason is left alone on unrelated updates';
end $$;

-- Case 6: the enforcement objects are as designed — trigger present and bound,
--         and the history-hostile CHECK constraint is gone.
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_trigger
   where tgname = 'set_loyalty_transactions_safe_reason'
     and tgrelid = 'public.loyalty_transactions'::regclass
     and not tgisinternal;
  if v_n <> 1 then raise exception 'CASE 6 FAILED: normalization trigger missing'; end if;

  select count(*) into v_n from pg_constraint
   where conname = 'loyalty_transactions_reason_no_order_number'
     and conrelid = 'public.loyalty_transactions'::regclass;
  if v_n <> 0 then
    raise exception 'CASE 6 FAILED: the NOT VALID CHECK still exists and will reject historical updates';
  end if;

  raise notice 'CASE 6 ok: trigger enforces, history-hostile constraint removed';
end $$;

-- Case 7: points are still awarded exactly once — the normalization must not
--         duplicate, drop or re-fire loyalty rows.
do $$
declare
  v_p uuid := pg_temp.mk_profile();
  v_order uuid := gen_random_uuid();
  v_n int;
  v_sum int;
begin
  -- loyalty_transactions.order_id is a real FK. Create the order it points
  -- at; replication_role=replica turns the FK triggers off for the insert
  -- itself, exactly as the other fixtures in this suite do.
  set local session_replication_role = replica;
  insert into public.orders (id, customer_id, branch_id, order_type, subtotal, total)
    values (v_order, v_p, 'b0000000-0000-0000-0000-0000000000ff', 'pickup', 12, 12);
  set local session_replication_role = origin;

  insert into public.loyalty_transactions (profile_id, order_id, type, points, balance_after, reason)
    values (v_p, v_order, 'earn', 12, 12, 'Earned on order SM-2026-000111');

  select count(*), coalesce(sum(points), 0) into v_n, v_sum
    from public.loyalty_transactions where profile_id = v_p and order_id = v_order and type = 'earn';

  if v_n <> 1 then raise exception 'CASE 7 FAILED: % earn rows for one order, expected 1', v_n; end if;
  if v_sum <> 12 then raise exception 'CASE 7 FAILED: points total is %, expected 12', v_sum; end if;
  raise notice 'CASE 7 ok: points awarded exactly once, amount unchanged';
end $$;

rollback;
