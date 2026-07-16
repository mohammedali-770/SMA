-- ============================================================================
-- Account-deletion LOCK — trusted database-layer enforcement.
--
-- While a customer has an ACTIVE deletion request (queued / waiting_* /
-- processing / retry_scheduled / manual_review) the account must not be usable
-- for NEW activity, regardless of which device/session initiates it or whether
-- the mobile UI is bypassed. This installs BEFORE INSERT triggers that refuse
-- new customer-owned records for such accounts.
--
-- Scope + frozen-area safety:
--   * orders: blocks NEW customer orders (place_order always inserts
--     payment_status='pending'). It EXEMPTS payment_status='paid' inserts, which
--     come only from insert_order_from_snapshot finalizing an in-flight checkout
--     the customer began BEFORE requesting deletion — blocking those would alter
--     the FROZEN payment flow. The deletion processor already WAITS for such an
--     order to reach a terminal state before deleting.
--   * checkout_sessions: blocks STARTING a new online checkout (does not touch
--     payment completion, which never inserts a session).
--   * addresses / push_devices: blocks new saved addresses and device/notification
--     registrations.
-- This is an access gate only — it changes no calculation, amount, tax, payment,
-- Lazywait, POS, or order-state-transition logic. The processor (DELETE/anonymize
-- only) is unaffected (BEFORE INSERT triggers do not fire on DELETE/UPDATE).
-- ============================================================================

-- True when the user has any in-flight deletion request. SECURITY DEFINER so the
-- trigger reads the queue regardless of the caller's RLS. Locked down to the
-- service role (the trigger runs as its postgres owner and needs no grant).
create or replace function public.has_active_account_deletion(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.account_deletion_requests
    where user_id = p_user_id
      and status in (
        'queued', 'waiting_for_active_order', 'waiting_for_financial_process',
        'processing', 'retry_scheduled', 'manual_review'
      )
  );
$$;
revoke all on function public.has_active_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.has_active_account_deletion(uuid) to service_role;

-- Shared BEFORE INSERT guard. Table-aware so the orders payment-completion
-- exemption is applied only where the column exists.
create or replace function public.enforce_account_deletion_lock()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.customer_id is null then
    return NEW;
  end if;
  -- Exempt payment-completion order inserts (insert_order_from_snapshot → 'paid').
  if TG_TABLE_NAME = 'orders' then
    if NEW.payment_status = 'paid' then
      return NEW;
    end if;
  end if;
  if public.has_active_account_deletion(NEW.customer_id) then
    -- Safe, generic message — no status, id, or backend detail leaked.
    raise exception 'Account deletion in progress.'
      using errcode = 'P0001', hint = 'account_deletion_active';
  end if;
  return NEW;
end $$;
revoke all on function public.enforce_account_deletion_lock() from public, anon, authenticated;

drop trigger if exists enforce_deletion_lock_orders on public.orders;
create trigger enforce_deletion_lock_orders
  before insert on public.orders
  for each row execute function public.enforce_account_deletion_lock();

drop trigger if exists enforce_deletion_lock_checkout_sessions on public.checkout_sessions;
create trigger enforce_deletion_lock_checkout_sessions
  before insert on public.checkout_sessions
  for each row execute function public.enforce_account_deletion_lock();

drop trigger if exists enforce_deletion_lock_addresses on public.addresses;
create trigger enforce_deletion_lock_addresses
  before insert on public.addresses
  for each row execute function public.enforce_account_deletion_lock();

drop trigger if exists enforce_deletion_lock_push_devices on public.push_devices;
create trigger enforce_deletion_lock_push_devices
  before insert on public.push_devices
  for each row execute function public.enforce_account_deletion_lock();

comment on function public.enforce_account_deletion_lock() is
  'BEFORE INSERT guard: refuses new customer records while an active account-deletion request exists. Exempts payment-completion (paid) order inserts so the frozen payment flow is unaffected.';
