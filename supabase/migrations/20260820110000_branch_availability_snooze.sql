-- ============================================================================
-- Spicy Meal — timed branch item availability ("snooze")
--
-- Closing an unavailable item was meant to arrive automatically from the
-- Lazywait POS. No stock/86/snooze endpoint exists in the vendor API (see
-- docs/LAZYWAIT.md), so branch staff maintain availability themselves. Today
-- `branch_product_availability` is a bare on/off flag with no timer, no reason
-- and no audit trail: an item closed during a Thursday rush stays closed until
-- somebody remembers it.
--
-- THE KEYSTONE — WHY THE ORDER PATH IS NOT TOUCHED
-- Eight copies of the guard `exists(... bpa.is_available = false)` live across
-- the place_order revisions and begin_checkout_session
-- (20260710120100:178, 20260712160000:203, plus six superseded). Rather than
-- rewrite them, `is_available` REMAINS the authoritative stored flag and
-- `snoozed_until` is only the scheduled restore time. A snooze sets
-- is_available = false; the sweeper flips it back when the timer expires.
-- Every existing guard therefore keeps its exact current meaning, and
-- begin_checkout_session — which is payment-adjacent and under the CLAUDE.md §6
-- freeze — never has to be modified.
--
-- Accepted cost: up to one sweeper tick (~60s) after expiry where an item is
-- still blocked. That is fail-SAFE (over-blocking, never over-selling), bounded
-- and self-healing.
--
-- WHAT IS DELIBERATELY NOT ON THIS TABLE
-- `branch_product_availability` is world-readable — `bpa_select_public` is
-- `for select to anon, authenticated using (true)` (20260707120200:156) — and
-- both clients request `select('*')`. Anything added here ships to every
-- anonymous customer browsing the menu. So only non-sensitive fields go on the
-- table: a fixed reason vocabulary and a timestamp, which are harmless and let
-- the customer app eventually say "out of stock, back at 18:00" instead of
-- hiding the item silently. The staff user id and the cashier's free-text note
-- live ONLY on branch_availability_events, which has no anon grant.
--
-- SAFETY: purely additive. No existing table, policy, function or grant is
-- modified. Adding columns cannot affect the eight guards — every one of them
-- is `select 1 from ... bpa`, and nothing in the chain does `select *` or
-- `%rowtype` against this table.
-- ============================================================================

-- ---- 1. Public-safe columns on the existing table ---------------------------
-- All nullable. Deliberately NOT `not null default now()`: a volatile default
-- forces a full table rewrite.
alter table public.branch_product_availability
  add column if not exists snoozed_until timestamptz,
  add column if not exists reason_code   text,
  add column if not exists changed_at    timestamptz,
  add column if not exists source        text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bpa_reason_code_check') then
    alter table public.branch_product_availability
      add constraint bpa_reason_code_check check (reason_code in
        ('out_of_stock','supplier_delay','equipment_down','quality_hold','other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bpa_source_check') then
    alter table public.branch_product_availability
      add constraint bpa_source_check check (source in ('manual','lazywait'));
  end if;
end $$;

-- The sweeper's only scan. Partial, so it stays proportional to the number of
-- currently-snoozed items rather than the whole exception table.
create index if not exists bpa_snoozed_until_idx
  on public.branch_product_availability (snoozed_until)
  where is_available = false and snoozed_until is not null;

comment on column public.branch_product_availability.snoozed_until is
  'Scheduled auto-restore time. NULL with is_available=false means an untimed closure (admin delisting) that the sweeper must never reopen.';
comment on column public.branch_product_availability.source is
  'Who set the current state: manual (staff) or lazywait (a future POS stock sync). Present from day one so a POS sync can write these rows without fighting a manual closure.';

-- ---- 2. Append-only audit -----------------------------------------------
-- modifier_id is present but unused until modifier-level snoozing lands; adding
-- it now avoids a second ALTER on an append-only table.
create table if not exists public.branch_availability_events (
  id               bigint generated always as identity primary key,
  branch_id        uuid not null references public.branches(id) on delete cascade,
  product_id       uuid references public.products(id)  on delete set null,
  modifier_id      uuid references public.modifiers(id) on delete set null,
  action           text not null check (action in ('closed','opened_manual','opened_auto')),
  duration_minutes integer,
  start_time       timestamptz,
  end_time         timestamptz,
  actual_open_time timestamptz,
  reason_code      text,
  reason_note      text check (reason_note is null or length(reason_note) <= 500),
  changed_by       uuid references auth.users(id) on delete set null,
  actor_role       public.user_role,
  source           text not null check (source in ('manual','automatic')),
  -- clock_timestamp, not now(): the sweeper writes many rows in one transaction
  -- and they must order correctly. Precedent: 20260707120900_loyalty_audit.sql.
  created_at       timestamptz not null default clock_timestamp(),
  constraint bae_one_target check (num_nonnulls(product_id, modifier_id) <= 1)
);

create index if not exists bae_branch_created_idx
  on public.branch_availability_events (branch_id, created_at desc);
create index if not exists bae_product_created_idx
  on public.branch_availability_events (product_id, created_at desc);

alter table public.branch_availability_events enable row level security;
revoke all on public.branch_availability_events from public, anon, authenticated;
grant select on public.branch_availability_events to authenticated;

-- Read-only to clients, and scoped: admin/accountant see everything, call
-- centre sees everything (that is its job), a branch operator sees only their
-- own branch. There is no client write path — the trigger below is the only
-- writer.
drop policy if exists bae_select_ops on public.branch_availability_events;
create policy bae_select_ops
  on public.branch_availability_events
  for select to authenticated
  using (
    public.is_staff()
    or public.is_call_center()
    or public.is_branch_operator(branch_id)
  );

comment on table public.branch_availability_events is
  'Append-only audit of every branch item availability transition. Written exclusively by the trigger on branch_product_availability, so no write path can escape it. Carries the actor and the free-text note that are deliberately kept off the world-readable availability table.';

-- ---- 3. Invariant normalization (BEFORE) ------------------------------------
-- The existing admin control writes this table directly with a PostgREST upsert
-- that sends only (branch_id, product_id, is_available) — src/lib/api.ts. An
-- upsert sets only the columns it sends, so flipping a previously-snoozed row
-- back on would leave a stale snoozed_until behind, and the next close would
-- inherit a timer nobody asked for. Normalizing here makes the invariant hold
-- for EVERY writer, including ones added later, instead of trusting each call
-- site to remember.
create or replace function public.normalize_branch_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_available then
    new.snoozed_until := null;
    new.reason_code   := null;
  end if;

  if tg_op = 'INSERT'
     or new.is_available is distinct from old.is_available
     or new.snoozed_until is distinct from old.snoozed_until then
    new.changed_at := now();
    new.source := coalesce(new.source, 'manual');
  end if;

  return new;
end $$;

drop trigger if exists normalize_branch_availability on public.branch_product_availability;
create trigger normalize_branch_availability
  before insert or update on public.branch_product_availability
  for each row execute function public.normalize_branch_availability();

-- ---- 4. Audit emission (AFTER) ----------------------------------------------
-- Modelled on emit_orders_change_event (20260724200000:389-402).
--
-- ACTOR ATTRIBUTION WITHOUT A FLAG: auth.uid() is non-null for an operator's
-- RPC call and null under pg_cron. The codebase already reflects that split —
-- in order_integrity_watchdog.sql, auth.uid() appears only in the manual
-- acknowledge/suppress RPCs, never in the cron scanner. So the discriminator is
-- free and needs no session variable.
create or replace function public.emit_branch_availability_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid    := auth.uid();
  v_source   text    := case when auth.uid() is null then 'automatic' else 'manual' end;
  v_role     public.user_role;
  v_note     text    := nullif(btrim(coalesce(current_setting('sma.availability_note', true), '')), '');
  v_action   text;
  v_became_unavailable boolean;
  v_became_available   boolean;
  v_window_changed     boolean;
begin
  v_became_unavailable := (not new.is_available)
    and (tg_op = 'INSERT' or old.is_available);
  v_became_available   := new.is_available
    and (tg_op = 'UPDATE' and not old.is_available);
  -- A re-snooze that only moves the timer (extend / shorten) is a real
  -- operational act and is logged as another 'closed'.
  v_window_changed := (not new.is_available)
    and tg_op = 'UPDATE' and not old.is_available
    and new.snoozed_until is distinct from old.snoozed_until;

  if v_became_unavailable or v_window_changed then
    v_action := 'closed';
  elsif v_became_available then
    v_action := case when v_source = 'automatic' then 'opened_auto' else 'opened_manual' end;
  else
    -- No availability transition: a no-op write or an unrelated column edit.
    return null;
  end if;

  if v_actor is not null then
    select p.role into v_role from public.profiles p where p.id = v_actor;
  end if;

  insert into public.branch_availability_events (
    branch_id, product_id, action, duration_minutes,
    start_time, end_time, actual_open_time,
    reason_code, reason_note, changed_by, actor_role, source
  ) values (
    new.branch_id,
    new.product_id,
    v_action,
    case when v_action = 'closed' and new.snoozed_until is not null
         then greatest(0, ceil(extract(epoch from (new.snoozed_until - now())) / 60.0))::int
    end,
    case when v_action = 'closed' then now() end,
    case when v_action = 'closed' then new.snoozed_until end,
    case when v_action <> 'closed' then now() end,
    case when v_action = 'closed' then new.reason_code end,
    case when v_action = 'closed' then v_note end,
    v_actor,
    v_role,
    v_source
  );

  return null;
end $$;

drop trigger if exists emit_branch_availability_event on public.branch_product_availability;
create trigger emit_branch_availability_event
  after insert or update on public.branch_product_availability
  for each row execute function public.emit_branch_availability_event();

revoke all on function public.normalize_branch_availability() from public, anon, authenticated;
revoke all on function public.emit_branch_availability_event() from public, anon, authenticated;
