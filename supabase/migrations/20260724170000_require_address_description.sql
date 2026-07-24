-- Require a location description on customer delivery addresses.
--
-- WHY
-- A Saudi address is not findable from coordinates alone; the courier needs a
-- landmark ("near Al Salam grocery, beside the mosque"). The mobile app asked
-- for one but never required it, and the Checkout path did not send the column
-- at all — it created the address row with `description` omitted — so orders
-- reached the branch with a pin and nothing else.
--
-- The client now enforces this (apps/mobile/src/features/order/locationDescription.ts).
-- This migration is the server-side half, so the rule does not live only in the
-- UI and cannot be bypassed by a direct PostgREST insert.
--
-- WHY A TRIGGER AND NOT A CHECK CONSTRAINT
-- `ALTER TABLE ... ADD CONSTRAINT ... NOT VALID` would skip existing rows at
-- creation time, but it is still evaluated on EVERY subsequent UPDATE of those
-- rows. Flipping `is_default` on an address saved before this rule would then
-- fail with a constraint violation on a column the update never touched. A
-- trigger lets us enforce the rule exactly where it belongs: on INSERT, and on
-- an UPDATE that actually changes `description`. Historical rows keep working
-- until the customer next edits them.
--
-- SAFETY
-- - No existing row is modified, deleted or invalidated.
-- - No column type changes; `description` stays nullable at the type level so
--   the historical rows remain legal.
-- - Reversible: drop the trigger and the function.
--
-- NOT APPLIED TO PRODUCTION by this change. Production schema changes go only
-- through the owner-approved apply_migration workflow (docs/MIGRATIONS.md).
-- `supabase db push` is forbidden against production (CLAUDE.md §8).

-- Minimum useful landmark length. Mirrors DESCRIPTION_MIN_LENGTH in
-- apps/mobile/src/features/order/locationDescription.ts — change both together.
create or replace function public.address_description_is_usable(p_description text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  -- btrim with the default character set removes spaces/tabs/newlines. A value
  -- of only whitespace is treated as absent, exactly as the client does.
  select p_description is not null
     and char_length(btrim(p_description)) >= 5
     and char_length(btrim(p_description)) <= 500;
$$;

comment on function public.address_description_is_usable(text) is
  'True when a delivery address description is a usable landmark (trimmed, 5..500 chars). Mirrors the mobile client rule.';

create or replace function public.enforce_address_description()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Only guard rows the customer is actually creating or whose description they
  -- are actually changing; untouched historical rows stay updatable.
  if tg_op = 'UPDATE'
     and new.description is not distinct from old.description then
    return new;
  end if;

  if not public.address_description_is_usable(new.description) then
    raise exception
      using
        errcode = 'check_violation',
        message = 'A location description (nearest landmark) is required.',
        detail  = 'addresses.description must be 5..500 characters after trimming.',
        hint    = 'Ask the customer for a nearby landmark, e.g. "near Al Salam grocery".';
  end if;

  -- Store the trimmed value so no row carries padding the client would show.
  new.description := btrim(new.description);
  return new;
end;
$$;

comment on function public.enforce_address_description() is
  'Rejects inserts/description-updates on public.addresses without a usable landmark, and trims the stored value.';

drop trigger if exists trg_addresses_require_description on public.addresses;

create trigger trg_addresses_require_description
  before insert or update of description on public.addresses
  for each row
  execute function public.enforce_address_description();

-- Rollback
-- drop trigger if exists trg_addresses_require_description on public.addresses;
-- drop function if exists public.enforce_address_description();
-- drop function if exists public.address_description_is_usable(text);
