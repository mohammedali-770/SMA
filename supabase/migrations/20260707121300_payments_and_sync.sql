-- ============================================================================
-- Spicy Meal — payment records + integration sync logs, and the SECURE
-- server-side hooks that write them. No real payment gateway or Lazywait API is
-- implemented here — this is the safe architecture the Edge Functions plug into.
--
-- Key rule: an order is marked paid / synced ONLY by server-side code
-- (Edge Functions using the service role) through the two RPCs below. Clients
-- (anon/authenticated) cannot execute them — they are granted to service_role
-- only — so payment/sync status can never be faked from the app.
-- ============================================================================

-- ---- payment_records: one row per gateway transaction attempt --------------
create table if not exists public.payment_records (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  provider     text not null,                       -- e.g. 'moyasar' (from integration_settings)
  provider_ref text,                                -- gateway transaction id
  status       text not null default 'initiated'
                 check (status in ('initiated', 'authorized', 'paid', 'failed', 'refunded')),
  amount       numeric(10,2) not null check (amount >= 0),
  currency     text not null default 'SAR',
  raw          jsonb,                               -- webhook payload snapshot
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists payment_records_order_idx  on public.payment_records(order_id);
create index if not exists payment_records_status_idx on public.payment_records(status);
-- Webhook idempotency: a (provider, provider_ref) pair is recorded at most once.
create unique index if not exists payment_records_provider_ref_idx
  on public.payment_records(provider, provider_ref) where provider_ref is not null;

drop trigger if exists set_payment_records_updated_at on public.payment_records;
create trigger set_payment_records_updated_at
  before update on public.payment_records
  for each row execute function public.set_updated_at();

alter table public.payment_records enable row level security;
revoke all on public.payment_records from anon, authenticated;
-- Staff (finance) can READ payment history; writes happen only via the RPC /
-- service role (which bypasses RLS).
grant select on public.payment_records to authenticated;
drop policy if exists payment_records_staff_read on public.payment_records;
create policy payment_records_staff_read on public.payment_records
  for select to authenticated using (public.is_staff());

-- ---- integration_sync_logs: audit trail for Lazywait (and future) syncs ----
create table if not exists public.integration_sync_logs (
  id         uuid primary key default gen_random_uuid(),
  provider   text not null default 'lazywait',
  order_id   uuid references public.orders(id) on delete set null,
  direction  text check (direction in ('push', 'pull', 'webhook')),
  status     text not null check (status in ('success', 'failed', 'skipped')),
  request    jsonb,
  response   jsonb,
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists integration_sync_logs_order_idx   on public.integration_sync_logs(order_id);
create index if not exists integration_sync_logs_created_idx on public.integration_sync_logs(created_at desc);
create index if not exists integration_sync_logs_status_idx  on public.integration_sync_logs(status);

alter table public.integration_sync_logs enable row level security;
revoke all on public.integration_sync_logs from anon, authenticated;
grant select on public.integration_sync_logs to authenticated;
drop policy if exists integration_sync_logs_staff_read on public.integration_sync_logs;
create policy integration_sync_logs_staff_read on public.integration_sync_logs
  for select to authenticated using (public.is_staff());

-- ---------------------------------------------------------------------------
-- confirm_order_payment(): the ONLY path that marks an order paid. Called from
-- the payment-webhook Edge Function AFTER it has verified the gateway signature.
-- Service-role only. Idempotent, and the amount must match the server-trusted
-- order total (clients never supply the amount that matters).
-- ---------------------------------------------------------------------------
create or replace function public.confirm_order_payment(
  p_order_id     uuid,
  p_provider     text,
  p_provider_ref text,
  p_amount       numeric,
  p_raw          jsonb default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  -- Idempotent: already recorded this gateway ref as paid -> no-op.
  if p_provider_ref is not null and exists (
    select 1 from public.payment_records
    where provider = p_provider and provider_ref = p_provider_ref and status = 'paid'
  ) then
    return v_order;
  end if;

  -- The paid amount must equal the server-computed order total.
  if p_amount is distinct from v_order.total then
    insert into public.payment_records (order_id, provider, provider_ref, status, amount, raw)
      values (p_order_id, p_provider, p_provider_ref, 'failed', coalesce(p_amount, 0), p_raw);
    raise exception 'Payment amount % does not match order total %', p_amount, v_order.total;
  end if;

  insert into public.payment_records (order_id, provider, provider_ref, status, amount, raw)
    values (p_order_id, p_provider, p_provider_ref, 'paid', p_amount, p_raw)
  on conflict (provider, provider_ref) where provider_ref is not null
    do update set status = 'paid', amount = excluded.amount, raw = excluded.raw, updated_at = now();

  update public.orders
    set payment_status = 'paid', payment_method = p_provider, updated_at = now()
    where id = p_order_id
    returning * into v_order;

  return v_order;
end $$;

revoke all on function public.confirm_order_payment(uuid, text, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_order_payment(uuid, text, text, numeric, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- record_order_sync(): update an order's Lazywait sync state + write a log row.
-- Called from the lazywait-sync Edge Function (service role). Service-role only.
-- ---------------------------------------------------------------------------
create or replace function public.record_order_sync(
  p_order_id          uuid,
  p_sync_status       public.sync_status,
  p_lazywait_order_id text default null,
  p_lazywait_ref      text default null,
  p_direction         text default 'push',
  p_status            text default 'success',
  p_request           jsonb default null,
  p_response          jsonb default null,
  p_error             text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders set
    sync_status       = p_sync_status,
    lazywait_order_id = coalesce(p_lazywait_order_id, lazywait_order_id),
    lazywait_ref      = coalesce(p_lazywait_ref, lazywait_ref),
    updated_at        = now()
  where id = p_order_id;

  insert into public.integration_sync_logs (provider, order_id, direction, status, request, response, error)
    values ('lazywait', p_order_id, p_direction, p_status, p_request, p_response, p_error);
end $$;

revoke all on function public.record_order_sync(uuid, public.sync_status, text, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_order_sync(uuid, public.sync_status, text, text, text, text, jsonb, jsonb, text) to service_role;
