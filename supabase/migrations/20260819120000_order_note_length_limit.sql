-- Bound the free-text order note.
--
-- WHY
-- `orders.notes` has been unbounded since it was created (20260707120500:32):
-- no limit in the mobile UI, none in `place_order`, and no constraint on the
-- column. `place_customer_order` is granted to `authenticated`, so any signed-in
-- customer can call it directly with the publishable key and a valid JWT and
-- store a note of arbitrary size — the UI is not a control. That note is then
-- read by a cashier, printed on a receipt and (once the POS contract is
-- settled) forwarded to Lazywait.
--
-- The client now enforces this (apps/mobile/src/features/order/orderNote.ts).
-- This migration is the server-side half, so the rule does not live only in the
-- UI and cannot be bypassed by a direct PostgREST call.
--
-- WHY 280
-- A kitchen note is an instruction ("no onions, ring the bell twice"), not a
-- message. 280 characters is long enough for several instructions and short
-- enough to stay readable on a printed ticket. It is NOT justified by any POS
-- capability: whether Lazywait accepts an order note at all is still open
-- question Q5 (docs/integrations/Lazywait_API_Reference.md), and
-- `lazywait-sync` does not forward notes today. If Lazywait later confirms a
-- shorter maximum, this number narrows — it should never silently widen.
--
-- WHY A TRIGGER AND NOT A CHECK CONSTRAINT
-- The same reason 20260724170000 gave for `addresses.description`: a CHECK is
-- re-evaluated on EVERY subsequent UPDATE of a row, not only when the guarded
-- column changes. `public.orders` is updated constantly on unrelated columns —
-- POS sync state, confirmation lifecycle, cancellation integrity, manual
-- resend. One historical row with an over-long note would then fail a status
-- transition that never touched `notes`. A trigger enforces the rule exactly
-- where it belongs: on INSERT, and on an UPDATE that actually changes `notes`.
--
-- WHY `checkout_sessions` IS GUARDED TOO
-- There are two independent writers of `orders.notes`:
--   1. place_order            (20260710120100:251,260)  — cash / direct
--   2. insert_order_from_snapshot (20260712170000:59,72) — online, via
--      finalize_checkout_session reading `checkout_sessions.notes`.
-- Guarding only `orders` would move the failure to the worst possible moment:
-- `finalize_checkout_session` runs AFTER the provider has captured, and a
-- failure there is caught by _shared/tapVerify.ts, logged, and retried forever
-- against a session that can never succeed. Rejecting an over-long note when
-- the session is CREATED means it is refused before any money moves. This is a
-- uniform input rule applied to a column, not a change to payment behaviour:
-- no provider logic, no pricing, no session lifecycle is touched.
--
-- NULL STAYS LEGAL
-- The note is optional, and two jobs deliberately erase it —
-- 20260715120000_account_deletion.sql:250 and
-- 20260806120000_erasure_phone_normalization.sql:143 both `set notes = null`.
-- The predicate accepts NULL so account deletion and erasure keep working.
--
-- SAFETY
-- - No existing row is modified, deleted or invalidated.
-- - No column type changes; `notes` stays nullable text.
-- - Read-only production inspection on 2026-08-19 (32 orders, 6 checkout
--   sessions): longest existing note is 2 characters, zero rows exceed 280 and
--   no unconsumed session carries a note at all. Nothing in production becomes
--   unupdatable by this rule.
-- - Strictly NARROWING: every value accepted after this change was accepted
--   before.
-- - Reversible: drop the two triggers and the two functions.
--
-- NOT APPLIED TO PRODUCTION by this change. Production schema changes go only
-- through the owner-approved apply_migration workflow (docs/MIGRATIONS.md).
-- `supabase db push` is forbidden against production (CLAUDE.md §8).

-- ONE definition of "trimmed", used by the predicate, the error detail and the
-- stored value, so the three can never disagree.
--
-- The character set is built with chr() rather than an E'' escape string ON
-- PURPOSE. PostgreSQL's C-style escape table has NO \v: an unrecognised escape
-- yields the character literally, so E'\v' is the LETTER v (ascii 118), not the
-- vertical tab (11). Written the obvious way, `btrim(notes, E' \t\r\n\f\v')`
-- stores "eg only" for "veg only" and turns a bare "v" into no note at all —
-- and, because trimming happens before the length is measured, it also lets a
-- 281-character note beginning with "v" through the limit this migration
-- exists to impose. That is the same class of bug as 20260802120000, where
-- single-argument btrim() turned out to strip spaces only.
--
-- The set is space, tab, LF, VT, FF, CR and U+00A0. JavaScript's trim() strips
-- all of these, so the two halves agree on every input a customer can type.
-- (JS also strips the rarer Unicode space separators; those are not reachable
-- from the keyboard and are still bounded by the length rule.)
create or replace function public.order_note_normalized(p_notes text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(
    btrim(
      p_notes,
      ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(160)
    ),
    ''
  );
$$;

comment on function public.order_note_normalized(text) is
  'The stored form of an order note: trimmed of ASCII/NBSP whitespace, and NULL rather than an empty string. Mirrors String.prototype.trim() in the mobile client.';

revoke all on function public.order_note_normalized(text) from public, anon, authenticated;

-- Maximum stored length of an order note, after trimming. Mirrors
-- ORDER_NOTE_MAX_LENGTH in apps/mobile/src/features/order/orderNote.ts —
-- change both together.
create or replace function public.order_note_is_acceptable(p_notes text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  -- The note is optional, so NULL is acceptable: it normalizes to NULL, and
  -- coalesce measures that as an empty note rather than yielding NULL (which
  -- would make the whole predicate NULL, and `if not null` never fires).
  select char_length(coalesce(public.order_note_normalized(p_notes), '')) <= 280;
$$;

comment on function public.order_note_is_acceptable(text) is
  'True when an order note is within the 280-character limit after trimming. NULL is acceptable — the note is optional. Mirrors the mobile client rule.';

revoke all on function public.order_note_is_acceptable(text) from public, anon, authenticated;

create or replace function public.enforce_order_note()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Only guard rows being created, or whose note is actually being changed;
  -- untouched historical rows stay updatable on every other column.
  if tg_op = 'UPDATE'
     and new.notes is not distinct from old.notes then
    return new;
  end if;

  if not public.order_note_is_acceptable(new.notes) then
    raise exception
      using
        errcode = 'check_violation',
        message = 'The order note is too long. Keep it under 280 characters.',
        detail  = format(
          '%I.notes must be at most 280 characters after trimming; got %s.',
          tg_table_name,
          char_length(coalesce(public.order_note_normalized(new.notes), ''))),
        hint    = 'Shorten the note and place the order again.';
  end if;

  -- Store the trimmed value, and store nothing rather than an empty string, so
  -- no row carries padding a cashier would see as a blank instruction line.
  -- This matches what the client already sends (CheckoutScreen: normalizeOrderNote).
  new.notes := public.order_note_normalized(new.notes);
  return new;
end;
$$;

comment on function public.enforce_order_note() is
  'Rejects inserts/note-updates carrying an over-long order note, and trims the stored value. Attached to public.orders and public.checkout_sessions.';

revoke all on function public.enforce_order_note() from public, anon, authenticated;

drop trigger if exists trg_orders_note_length on public.orders;

create trigger trg_orders_note_length
  before insert or update of notes on public.orders
  for each row
  execute function public.enforce_order_note();

drop trigger if exists trg_checkout_sessions_note_length on public.checkout_sessions;

create trigger trg_checkout_sessions_note_length
  before insert or update of notes on public.checkout_sessions
  for each row
  execute function public.enforce_order_note();

-- Rollback
-- drop trigger if exists trg_checkout_sessions_note_length on public.checkout_sessions;
-- drop trigger if exists trg_orders_note_length on public.orders;
-- drop function if exists public.enforce_order_note();
-- drop function if exists public.order_note_is_acceptable(text);
-- drop function if exists public.order_note_normalized(text);
