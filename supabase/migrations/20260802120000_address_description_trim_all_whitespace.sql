-- Fix: a landmark made only of tabs or newlines satisfied the "usable
-- description" rule.
--
-- THE BUG
-- `address_description_is_usable` (20260724170000) trims with the
-- single-argument form of btrim:
--
--     char_length(btrim(p_description)) >= 5
--
-- and its comment claims "btrim with the default character set removes
-- spaces/tabs/newlines". It does not. `btrim(string)` is exactly
-- `btrim(string, ' ')` — the default character set is a SPACE, and nothing
-- else. Tabs, newlines, carriage returns, form feeds and vertical tabs are
-- left in place and counted toward the five-character minimum.
--
-- So `E'\t\n  \t'` trims to itself (it neither starts nor ends with a space),
-- measures 5, and is accepted as a courier landmark.
--
-- WHY IT MATTERS
-- The whole point of 20260724170000 was that the rule "does not live only in
-- the UI and cannot be bypassed by a direct PostgREST insert". A whitespace
-- landmark bypasses it: the row satisfies the trigger, the order reaches the
-- branch, and the courier has a pin and nothing else — precisely the outcome
-- that migration was written to prevent. The mobile client is unaffected,
-- because JavaScript's String.prototype.trim() does strip tabs and newlines;
-- the server was simply the weaker of the two, while its comment asserted they
-- mirrored each other.
--
-- Found by supabase/tests/require_address_description_test.sql CASE 1, which
-- has asserted this since it was written and had never been executed until
-- the SQL suites were put into CI.
--
-- WHAT THIS CHANGES
-- One function body. `create or replace` keeps the same name, signature,
-- volatility and search_path, so the trigger created by 20260724170000 keeps
-- working untouched and no historical migration is edited (CLAUDE.md §2.3).
--
-- SAFETY
-- - No table, column, constraint, trigger or policy is altered.
-- - No existing row is modified, deleted or invalidated. The predicate is only
--   ever evaluated on INSERT, or on an UPDATE that actually changes
--   `description` — historical rows stay updatable exactly as before.
-- - Strictly NARROWING: every value accepted after this change was accepted
--   before. Only whitespace-only landmarks stop qualifying.
-- - Reversible: re-run the previous definition.
--
-- NOT APPLIED TO PRODUCTION by this change. Production schema changes go only
-- through the owner-approved apply_migration workflow (docs/MIGRATIONS.md).
-- `supabase db push` is forbidden against production (CLAUDE.md §8).

create or replace function public.address_description_is_usable(p_description text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  -- The character set is EXPLICIT. btrim's default is a space and only a
  -- space; relying on it is what let a tab-and-newline landmark through.
  --
  -- This is the ASCII whitespace set, which is what the mobile rule in
  -- apps/mobile/src/features/order/locationDescription.ts strips in practice.
  -- JavaScript's trim() additionally strips Unicode blanks such as U+00A0, so
  -- a landmark of non-breaking spaces would still qualify here. That is a far
  -- narrower gap than the one being closed and is left alone deliberately
  -- rather than guessed at.
  select p_description is not null
     and char_length(btrim(p_description, E' \t\r\n\f\v')) >= 5
     and char_length(btrim(p_description, E' \t\r\n\f\v')) <= 500;
$$;

comment on function public.address_description_is_usable(text) is
  'True when a delivery address description is a usable landmark (5..500 chars after trimming ASCII whitespace). Mirrors the mobile client rule. The trim character set is explicit: btrim''s default strips spaces only, which previously let a tab/newline-only landmark qualify.';

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- create or replace function public.address_description_is_usable(p_description text)
-- returns boolean language sql immutable set search_path = public, pg_temp as $$
--   select p_description is not null
--      and char_length(btrim(p_description)) >= 5
--      and char_length(btrim(p_description)) <= 500;
-- $$;
