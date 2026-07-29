-- Stop 20260724130000 from silently remediating historical loyalty reasons.
--
-- WHAT WAS WRONG
-- 20260724130000 added:
--   (a) BEFORE INSERT OR UPDATE trigger set_loyalty_transactions_safe_reason,
--       whose function rewrote `new.reason` UNCONDITIONALLY; and
--   (b) a NOT VALID CHECK constraint loyalty_transactions_reason_no_order_number.
--
-- Its header states "HISTORICAL ROWS ARE NOT REWRITTEN". That holds at apply
-- time, but not afterwards. Consider a pre-migration row whose reason is
-- 'Earned on order SM-2026-000032' and any later unrelated write, e.g.
--   update public.loyalty_transactions set balance_after = 100 where id = …;
--
--   * The trigger fires (it is not scoped to `reason`), recomputes
--     new.reason from the row's still-historical value, and REWRITES it.
--     That is exactly the silent remediation of Production history the
--     migration promised not to do, performed as a side effect of an
--     unrelated update.
--
--   * Remove that rewrite and the NOT VALID CHECK surfaces the second half of
--     the problem: PostgreSQL evaluates a NOT VALID constraint on every
--     subsequent INSERT **and UPDATE** of a row, so the same unrelated update
--     would then be REJECTED purely because the row's reason predates the rule.
--
-- Either way a historical row becomes un-updatable-without-consequence. Both
-- halves are fixed here.
--
-- THE RULE THIS RESTORES
--   * new inserts            → always normalized;
--   * a genuine reason change → always normalized;
--   * any other update        → history is left exactly as it is, and permitted.
--
-- Historical remediation, if it is ever wanted, stays a separate explicitly
-- approved operation (see docs/MIGRATIONS.md) — never a side effect.
--
-- NOT APPLIED TO PRODUCTION by this change (docs/MIGRATIONS.md; CLAUDE.md §8).

-- ---- 1. Scope the normalization to writes that actually set a reason --------
create or replace function public.set_loyalty_safe_reason()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- An UPDATE that does not touch `reason` must not launder history. `is not
  -- distinct from` so a NULL→NULL update is also treated as "unchanged".
  if tg_op = 'UPDATE' and new.reason is not distinct from old.reason then
    return new;
  end if;

  new.reason := public.loyalty_safe_reason(new.type::text, new.order_id, new.reason);
  return new;
end $$;

comment on function public.set_loyalty_safe_reason() is
  'Normalizes loyalty_transactions.reason on INSERT and on a genuine reason change only. Unrelated updates leave historical reasons untouched (20260724190000).';

-- Trigger binding is unchanged; re-created so the timing is unambiguous after a
-- partial apply.
drop trigger if exists set_loyalty_transactions_safe_reason on public.loyalty_transactions;
create trigger set_loyalty_transactions_safe_reason
  before insert or update on public.loyalty_transactions
  for each row execute function public.set_loyalty_safe_reason();

-- ---- 2. Remove the constraint that makes history un-updatable ---------------
-- A table CHECK cannot distinguish "a new bad write" from "an old row being
-- touched for an unrelated reason" — it sees only the resulting row. Keeping it
-- would reject legitimate updates to historical rows, which is a worse failure
-- than the case it was guarding (the trigger being dropped).
--
-- Enforcement now rests on the BEFORE trigger, which is writer-independent and
-- covers every DML path: PostgREST, RPC, Edge Function and psql alike. The
-- accompanying SQL suite asserts the trigger is present and bound.
alter table public.loyalty_transactions
  drop constraint if exists loyalty_transactions_reason_no_order_number;

-- Rollback
-- 1. restore the unconditional function body from 20260724130000; and
-- 2. re-add the NOT VALID constraint from that migration.
-- Note that doing so reintroduces both defects described above.
