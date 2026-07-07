-- ============================================================================
-- Spicy Meal — orders, order_items, order_item_modifiers.
-- Orders are created ONLY through public.place_order() (next migration), which
-- recomputes every amount server-side. Direct client INSERT is not granted.
--   * customers: read their own orders
--   * staff (admin/accountant): read all orders
--   * admin: update order status
-- ============================================================================

create sequence if not exists public.order_number_seq;

create table if not exists public.orders (
  id                      uuid primary key default gen_random_uuid(),
  order_number            text not null unique,
  customer_id             uuid references public.profiles(id) on delete set null,
  customer_name           text,   -- snapshot at order time
  customer_phone          text,   -- snapshot
  branch_id               uuid not null references public.branches(id) on delete restrict,
  branch_name_en          text,   -- snapshot
  branch_name_ar          text,   -- snapshot
  status                  public.order_status not null default 'received',
  order_type              public.order_type not null,
  subtotal                numeric(10,2) not null check (subtotal >= 0),
  delivery_fee            numeric(10,2) not null default 0 check (delivery_fee >= 0),
  discount_amount         numeric(10,2) not null default 0 check (discount_amount >= 0),
  loyalty_discount_amount numeric(10,2) not null default 0 check (loyalty_discount_amount >= 0),
  vat_amount              numeric(10,2) not null default 0 check (vat_amount >= 0),
  total                   numeric(10,2) not null check (total >= 0),
  payment_status          public.payment_status not null default 'pending',
  payment_method          text,
  coupon_code             text,
  notes                   text,
  address_id              uuid references public.addresses(id) on delete set null,
  address_snapshot        jsonb,  -- delivery address captured at order time
  -- Reserved for a future Lazywait sync worker (not implemented here):
  sync_status             public.sync_status not null default 'not_synced',
  lazywait_order_id       text,
  lazywait_ref            text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists orders_customer_id_idx on public.orders(customer_id);
create index if not exists orders_branch_id_idx   on public.orders(branch_id);
create index if not exists orders_status_idx      on public.orders(status);
create index if not exists orders_created_at_idx  on public.orders(created_at desc);

create table if not exists public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name_en    text not null,   -- snapshot
  name_ar    text not null,   -- snapshot
  unit_price numeric(10,2) not null check (unit_price >= 0),
  quantity   integer not null check (quantity > 0),
  line_total numeric(10,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);
create index if not exists order_items_order_id_idx on public.order_items(order_id);

create table if not exists public.order_item_modifiers (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  modifier_id   uuid references public.modifiers(id) on delete set null,
  name_en       text not null,  -- snapshot
  name_ar       text not null,  -- snapshot
  price         numeric(10,2) not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists order_item_modifiers_item_idx
  on public.order_item_modifiers(order_item_id);

-- ---- Auto-generate order_number: SM-<year>-<6-digit sequence> --------------
create or replace function public.set_order_number()
returns trigger
language plpgsql
as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number :=
      'SM-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.order_number_seq')::text, 6, '0');
  end if;
  return new;
end $$;

drop trigger if exists set_orders_number on public.orders;
create trigger set_orders_number
  before insert on public.orders
  for each row execute function public.set_order_number();

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---- RLS ------------------------------------------------------------------
alter table public.orders                enable row level security;
alter table public.order_items           enable row level security;
alter table public.order_item_modifiers  enable row level security;

revoke all on public.orders               from anon, authenticated;
revoke all on public.order_items          from anon, authenticated;
revoke all on public.order_item_modifiers from anon, authenticated;

-- No INSERT grant → clients cannot insert orders directly. Only status is
-- client-updatable (and RLS restricts that to admins).
grant select on public.orders to authenticated;
grant update (status) on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select on public.order_item_modifiers to authenticated;

drop policy if exists orders_select_own_or_staff on public.orders;
create policy orders_select_own_or_staff on public.orders
  for select to authenticated
  using (customer_id = auth.uid() or public.is_staff());

-- Only admins may advance/cancel an order (accountant is read-only;
-- customers cannot cancel).
drop policy if exists orders_admin_update on public.orders;
create policy orders_admin_update on public.orders
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and (o.customer_id = auth.uid() or public.is_staff())
  ));

drop policy if exists order_item_modifiers_select on public.order_item_modifiers;
create policy order_item_modifiers_select on public.order_item_modifiers
  for select to authenticated
  using (exists (
    select 1 from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.id = order_item_modifiers.order_item_id
      and (o.customer_id = auth.uid() or public.is_staff())
  ));
