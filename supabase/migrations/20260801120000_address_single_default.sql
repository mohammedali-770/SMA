-- One default delivery address per customer.
--
-- WHY
-- `public.addresses.is_default` has existed since 20260707120300_addresses.sql
-- with nothing enforcing it. Until now only one path ever set it — the
-- order-type gate, which passed `is_default: savedAddresses.length === 0` — so a
-- customer could only ever end up with zero or one, by luck rather than by rule.
--
-- Profile now lets a customer promote any saved address, which makes the
-- invariant load-bearing. Doing it in the client means two round-trips (clear
-- the old default, set the new one) with a window in between where the customer
-- has two defaults or none, and a partial failure leaves them there permanently.
-- Checkout preselects `isDefault` before falling back to the first row, so two
-- defaults is not a cosmetic problem: it makes the preselected delivery address
-- depend on row order.
--
-- This is the smallest server-side rule that makes the client's single write
-- correct: setting a default clears the previous one, atomically, in the same
-- statement.
--
-- WHY A TRIGGER AND NOT ONLY A UNIQUE INDEX
-- A partial unique index alone would REJECT the promotion ("there is already a
-- default") rather than perform it, forcing the client back to two round-trips.
-- The BEFORE trigger demotes the previous default first; the index is then the
-- backstop that guarantees no other path (a direct PostgREST call, a future
-- migration, a bulk fix) can reintroduce a second one.
--
-- SAFETY
-- - Additive. No column is added, dropped or retyped.
-- - The one-time normalization touches ONLY customers who already hold more than
--   one default, and only to clear the extras; it keeps the OLDEST default,
--   which is the one Checkout was already preselecting.
-- - `description` is never written, so the mandatory-landmark trigger
--   (20260724170000) is not fired for historical rows.
-- - Reversible: drop the trigger, the function and the index.
--
-- NOT APPLIED TO PRODUCTION by this change. Production schema changes go only
-- through the owner-approved apply_migration workflow (docs/MIGRATIONS.md).
-- `supabase db push` is forbidden against production (CLAUDE.md §8).

-- ---------------------------------------------------------------------------
-- 1. Normalize any customer who already holds more than one default.
--    Required before the unique index below can be created.
-- ---------------------------------------------------------------------------
with ranked as (
  select id,
         row_number() over (partition by customer_id order by created_at, id) as rn
    from public.addresses
   where is_default
)
update public.addresses a
   set is_default = false
  from ranked r
 where a.id = r.id
   and r.rn > 1;

-- ---------------------------------------------------------------------------
-- 2. Promoting an address demotes the customer's previous default.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_single_default_address()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Only a row that IS becoming/staying the default can demote anything. An
  -- update that leaves is_default false (or unchanged) does no extra work, so
  -- editing a landmark never rewrites a sibling row.
  if not new.is_default then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.is_default and new.is_default then
    return new;
  end if;

  -- Demote siblings only. `customer_id` is the owner column and is never
  -- writable by the customer API, so this cannot reach another customer's book.
  update public.addresses
     set is_default = false
   where customer_id = new.customer_id
     and id <> new.id
     and is_default;

  return new;
end;
$$;

comment on function public.enforce_single_default_address() is
  'Demotes a customer''s previous default address when another is promoted, so "set default" is one atomic write.';

drop trigger if exists trg_addresses_single_default on public.addresses;

create trigger trg_addresses_single_default
  before insert or update of is_default on public.addresses
  for each row
  execute function public.enforce_single_default_address();

-- ---------------------------------------------------------------------------
-- 3. Backstop: the invariant itself, independent of the trigger.
-- ---------------------------------------------------------------------------
create unique index if not exists addresses_one_default_per_customer
  on public.addresses (customer_id)
  where is_default;

comment on index public.addresses_one_default_per_customer is
  'At most one default address per customer. Enforced independently of the demotion trigger.';

-- Rollback
-- drop index if exists public.addresses_one_default_per_customer;
-- drop trigger if exists trg_addresses_single_default on public.addresses;
-- drop function if exists public.enforce_single_default_address();
