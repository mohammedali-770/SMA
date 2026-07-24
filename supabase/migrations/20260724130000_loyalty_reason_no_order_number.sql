-- ============================================================================
-- Spicy Meal — remove the internal SM-… order number from loyalty reasons.
--
-- EXPOSURE BEING CLOSED. `place_order` and `insert_order_from_snapshot` write
--   'Earned on order '   || orders.order_number
--   'Redeemed on order ' || orders.order_number
-- into public.loyalty_transactions.reason. That table is CUSTOMER-READABLE:
--   grant select on public.loyalty_transactions to authenticated;   -- 20260707120900
--   policy loyalty_tx_select_own_or_staff using (profile_id = auth.uid() or is_staff())
-- so any signed-in customer can read their own SM-… id straight from PostgREST
-- (`GET /rest/v1/loyalty_transactions?select=reason`) with only the anon key and
-- their JWT. The mobile app never reads this table, which is exactly why a
-- code-path search missed it — the exposure is PostgREST auto-exposure.
--
-- This violates the Issue #94 requirement that the internal identifier stay out
-- of every customer-facing payload and surface.
--
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER AND NOT A REDEFINITION OF place_order
--
-- The reason strings are built inline inside `place_order` (latest definition:
-- 20260710120100_place_order_delivery_zone.sql) and `insert_order_from_snapshot`
-- (latest: 20260712170000_checkout_sessions_hardening.sql). Both are ~200-line
-- PRICING AUTHORITIES: they compute subtotal, modifiers, delivery fee, coupon,
-- VAT and loyalty, and they own award timing and idempotency. Re-emitting either
-- one verbatim to change two string literals is a large, transcription-error-prone
-- diff across pricing-sensitive code for a text-only fix.
--
-- A BEFORE trigger on the DESTINATION column is the smallest possible change
-- that fully closes the exposure:
--   * it touches ZERO pricing, award-timing or idempotency logic;
--   * it is writer-independent, so it also covers any future writer, the admin
--     adjustment path, and any backfill;
--   * it is auditable in one screen.
--
-- Nothing about loyalty amounts, balances, ordering or idempotency changes: only
-- the free-text `reason` column is normalized.
--
-- ---------------------------------------------------------------------------
-- HISTORICAL ROWS ARE NOT TOUCHED BY THIS MIGRATION.
-- Existing rows keep their original text. Rewriting them is a Production DATA
-- change and is deliberately left to a separate, explicitly owner-approved
-- action — see docs/ORDER_CONFIRMATION_FLOW.md §11 for the exact statement and
-- its verification query. The CHECK constraint below is therefore added NOT
-- VALID: it binds every future write without validating (or rejecting) history.
--
-- FORWARD-ONLY and, at authoring time, REPOSITORY-ONLY / UNAPPLIED.
-- No cron, Vault, credential, payment or push behaviour is changed.
-- ============================================================================

-- ---- 1. The canonical "does this text leak an internal order number?" test --
-- The value is generated as 'SM-' || to_char(now(),'YYYY') || '-' ||
-- lpad(nextval(...),6,'0') (20260707120500_orders.sql), i.e. SM-<4 digits>-<6+
-- digits>. Matching by VALUE SHAPE — not by column name — is what makes this
-- robust against any writer that concatenates the number into free text.
create or replace function public.text_has_internal_order_number(p_text text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_text, '') ~ 'SM-[0-9]{4}-[0-9]{4,}';
$$;

revoke all on function public.text_has_internal_order_number(text) from public, anon;
grant execute on function public.text_has_internal_order_number(text) to authenticated, service_role;

-- ---- 2. Neutral, customer-safe reason text ---------------------------------
-- Stored as plain English rather than an opaque code on purpose:
--   * the CUSTOMER app never reads this table at all, so there is nothing to
--     localize on the client for it;
--   * the STAFF dashboard does read it, and readable text keeps that view
--     useful. Staff keep full traceability through loyalty_transactions.order_id
--     (a UUID FK to the order), which is the internal linkage the order number
--     was informally standing in for.
-- Any other free text (e.g. an admin adjustment note someone pasted an order
-- number into) has the identifier REDACTED rather than replaced, so the rest of
-- the operator's note survives.
create or replace function public.loyalty_safe_reason(
  p_type     text,
  p_order_id uuid,
  p_reason   text
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    -- Order-linked automatic rows: fixed, neutral wording.
    when p_order_id is not null and p_type = 'earn'   then 'Points earned from an order'
    when p_order_id is not null and p_type = 'redeem' then 'Points redeemed on an order'
    -- Anything else (admin adjustments, manual notes): keep the text but strip
    -- any internal order number that was typed or pasted into it.
    when public.text_has_internal_order_number(p_reason)
      then regexp_replace(coalesce(p_reason, ''), 'SM-[0-9]{4}-[0-9]{4,}', '[order]', 'g')
    else p_reason
  end;
$$;

revoke all on function public.loyalty_safe_reason(text, uuid, text) from public, anon;
grant execute on function public.loyalty_safe_reason(text, uuid, text) to authenticated, service_role;

-- ---- 3. Normalize on write --------------------------------------------------
-- BEFORE INSERT OR UPDATE so the value is corrected before it is ever stored,
-- and therefore before any customer can read it. Writer-independent by design.
create or replace function public.set_loyalty_safe_reason()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.reason := public.loyalty_safe_reason(new.type::text, new.order_id, new.reason);
  return new;
end $$;

drop trigger if exists set_loyalty_transactions_safe_reason on public.loyalty_transactions;
create trigger set_loyalty_transactions_safe_reason
  before insert or update on public.loyalty_transactions
  for each row execute function public.set_loyalty_safe_reason();

-- ---- 4. Belt-and-braces constraint (NOT VALID) ------------------------------
-- Guarantees no FUTURE row can carry the identifier even if the trigger were
-- dropped or bypassed. NOT VALID so historical rows are neither validated nor
-- rewritten by this migration (see the header).
do $$
begin
  alter table public.loyalty_transactions
    drop constraint if exists loyalty_transactions_reason_no_order_number;
  alter table public.loyalty_transactions
    add constraint loyalty_transactions_reason_no_order_number
    check (not public.text_has_internal_order_number(reason)) not valid;
end $$;
