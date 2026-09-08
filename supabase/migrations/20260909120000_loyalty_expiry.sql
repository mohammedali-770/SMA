-- ============================================================================
-- Loyalty v2, step 3 — POINTS EXPIRY, on a fixed calendar reset.
--
-- WHAT THE OWNER ASKED FOR
-- "expiry date for points", and when asked how: "let me decide the validity
-- period from portal, but fixed calendar reset". So: everybody's points expire
-- together, on a date the administrator chooses, rather than each batch ageing
-- out on its own anniversary.
--
-- THIS IS THE FIRST MIGRATION IN THE SERIES THAT DESTROYS CUSTOMER VALUE.
-- Steps 1 and 2 changed how points are EARNED. This one takes points that a
-- customer already holds and sets them to zero. Every design decision below is
-- shaped by that, and they are worth reading before changing anything here.
--
--   1. IT DEFAULTS OFF, and applying this file expires nothing. `loyalty_expiry_
--      enabled` is false, and while it is false the driver returns before it
--      reads a single profile row.
--
--   2. IT CAN NEVER RUN RETROACTIVELY. The driver only acts on a date IT
--      scheduled -- `loyalty_expiry_next_run_on`, always computed STRICTLY in
--      the future. Turning expiry on in March with a January anchor waits until
--      next January; it does not wipe everybody on the spot. A trigger
--      recomputes that date whenever expiry is enabled or the anchor changes,
--      so a stale date left over from an earlier configuration cannot fire.
--
--   3. IT IS IDEMPOTENT. The settings singleton is locked FOR UPDATE and the
--      next date advances inside the same transaction, so a second tick on the
--      same day sees nothing due. A cron job that fires twice cannot double-
--      write ledger rows.
--
--   4. IT IS AUDITABLE, AND TO THE CUSTOMER. Every expiry writes one ledger row
--      -- type `expire`, `points` negative, `balance_after` 0 -- and
--      `loyalty_tx_select_own_or_staff` lets the customer read their own. The
--      balance does not simply vanish with nothing to point at.
--
--   5. IT SURVIVES A MISSED DAY. The test is `current_date >= next_run_on`, not
--      equality, so if the job does not fire on the day it catches up on the
--      next one instead of skipping a whole cycle.
--
-- WHY THE PERIOD IS RESTRICTED TO DIVISORS OF 12
-- `loyalty_expiry_period_months` accepts 1, 2, 3, 4, 6 or 12. Any other value
-- makes the reset dates depend on an arbitrary epoch year -- "every 24 months
-- from the 1st of January" is not a fixed calendar date, it is a fixed date in
-- alternating years, and which years depends on when somebody first switched it
-- on. A divisor of 12 repeats identically every year, which is what "fixed
-- calendar reset" means.
--
-- WHY THE ANCHOR DAY STOPS AT 28
-- There is no 31st of February. A reset that silently slides to the 28th in one
-- month and the 31st in another, or that throws once a year, is worse than a
-- range that cannot express the problem.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   * NO PUSH NOTIFICATION. An "your points expire soon" reminder is a change to
--     live customer messaging and is its own owner approval under CLAUDE.md
--     section 5. The customer-facing date added here (the Profile screen reads
--     `loyalty_expiry_next_run_on`) is the notice this step ships.
--   * NO EXPIRY OF THE EXISTING BALANCES. The owner said the current 5 409
--     points are test data and may be kept or dropped. They are KEPT: they ride
--     to the first configured reset like any others. Dropping them would be a
--     live data write needing its own approval, and it buys nothing.
--   * NO T&C TEXT. Expiry cannot be switched on lawfully without updated terms
--     and an acceptance moment (docs/LOYALTY.md section 5). This file makes the
--     mechanism exist; it does not make it lawful to enable.
--
-- MONEY PATH: `place_order` and `compute_order_snapshot` are NOT redefined here,
-- so their hashes are unchanged by this file -- unlike steps 1 and 2.
--
-- EVIDENCE AND OPERATION: docs/LOYALTY.md section 4.
-- Coverage: supabase/tests/loyalty_expiry_test.sql.
-- ============================================================================

-- ---- 1. The ledger learns a fourth kind of row ------------------------------
-- Widened rather than replaced, so existing rows are revalidated in place and a
-- typo in the new list would fail loudly here instead of silently admitting
-- anything.
alter table public.loyalty_transactions
  drop constraint if exists loyalty_transactions_type_check;
alter table public.loyalty_transactions
  add constraint loyalty_transactions_type_check
  check (type in ('earn', 'redeem', 'adjustment', 'expire'));

-- ---- 2. The settings an administrator controls ------------------------------
alter table public.app_settings
  add column if not exists loyalty_expiry_enabled boolean not null default false;
alter table public.app_settings
  add column if not exists loyalty_expiry_anchor_month smallint not null default 1;
alter table public.app_settings
  add column if not exists loyalty_expiry_anchor_day smallint not null default 1;
alter table public.app_settings
  add column if not exists loyalty_expiry_period_months smallint not null default 12;
-- Operational state rather than configuration, and deliberately on the settings
-- row: it is publicly readable, which is how the customer's Profile screen shows
-- "your points expire on ..." without a second query or a client-side copy of
-- the schedule. It is a business date, not personal data.
alter table public.app_settings
  add column if not exists loyalty_expiry_next_run_on date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_loyalty_expiry_anchor_ck') then
    alter table public.app_settings add constraint app_settings_loyalty_expiry_anchor_ck
      check (loyalty_expiry_anchor_month between 1 and 12
         and loyalty_expiry_anchor_day between 1 and 28
         and loyalty_expiry_period_months in (1, 2, 3, 4, 6, 12));
  end if;
end $$;

comment on column public.app_settings.loyalty_expiry_next_run_on is
  'The next reset date. Written by the system, not by hand: a trigger recomputes '
  'it whenever expiry is enabled or the anchor changes, and run_loyalty_expiry() '
  'advances it. Always strictly in the future when set, which is what stops a '
  'newly enabled schedule from expiring everybody immediately.';

-- ---- 3. When is the next reset? --------------------------------------------
-- Pure and immutable-ish: the same inputs always give the same answer, so it can
-- be reasoned about and tested without touching a balance.
create or replace function public.loyalty_next_expiry_on(
  p_after  date,
  p_month  integer,
  p_day    integer,
  p_period integer
)
returns date
language plpgsql
immutable
as $$
declare
  v_candidate date;
  v_guard     integer := 0;
begin
  if p_month is null or p_day is null or p_period is null then
    return null;
  end if;
  if p_period not in (1, 2, 3, 4, 6, 12) then
    raise exception 'loyalty expiry period must divide 12 evenly, got %', p_period;
  end if;

  -- Start a full year behind and step forward, so the answer does not depend on
  -- which year the caller happens to be in.
  v_candidate := make_date(extract(year from p_after)::int - 1, p_month, p_day);
  while v_candidate <= p_after loop
    v_candidate := (v_candidate + make_interval(months => p_period))::date;
    v_guard := v_guard + 1;
    -- 12 months back, stepping by at least one month, cannot need more than a
    -- couple of dozen iterations. A runaway means the inputs are not what this
    -- function was built for.
    if v_guard > 40 then
      raise exception 'could not resolve a loyalty expiry date after % (month %, day %, period %)',
        p_after, p_month, p_day, p_period;
    end if;
  end loop;
  return v_candidate;
end $$;

-- ---- 4. Changing the schedule always reschedules -----------------------------
-- Without this, disabling expiry and re-enabling it a year later would leave a
-- date in the PAST and the very next tick would wipe every balance. The whole
-- retroactivity guarantee rests on this trigger.
--
-- `loyalty_expiry_next_run_on` is SYSTEM-OWNED. It is an ordinary column on a
-- table administrators may update, so nothing at the grant level stops one
-- writing to it directly -- by hand, by SQL, or by a request that names the
-- column. The trigger is therefore the only thing that can own it, and it does
-- so by recomputing whenever the caller's value differs from the stored one:
-- whatever was supplied is discarded and the date is re-derived from the anchor
-- settings, which ARE the administrator's knobs.
--
-- Review found this on #337. The first version recomputed on the false->true
-- transition and on anchor changes, which left the steady state open: while
-- expiry was ALREADY enabled, `update app_settings set
-- loyalty_expiry_next_run_on = <a past date>` made every condition false, the
-- value survived, and the next nightly tick zeroed every positive balance.
-- Reproduced before it was fixed, and case 3d pins it.
--
-- Note what is deliberately NOT done here: the recompute is conditional on the
-- value having CHANGED, not unconditional on every update. An unconditional
-- recompute would push the reset a whole cycle into the future if an
-- administrator happened to save an unrelated setting on the due date itself,
-- because `loyalty_next_expiry_on` always returns a date strictly after the one
-- it is given. That silently skips a reset instead of running it.
create or replace function public.set_loyalty_expiry_next_run()
returns trigger
language plpgsql
as $$
begin
  if not coalesce(new.loyalty_expiry_enabled, false) then
    -- Disabled: no schedule. Re-enabling recomputes, so nothing stale survives.
    new.loyalty_expiry_next_run_on := null;
    return new;
  end if;

  if tg_op = 'INSERT'
     or not coalesce(old.loyalty_expiry_enabled, false)          -- just switched on
     or old.loyalty_expiry_anchor_month  is distinct from new.loyalty_expiry_anchor_month
     or old.loyalty_expiry_anchor_day    is distinct from new.loyalty_expiry_anchor_day
     or old.loyalty_expiry_period_months is distinct from new.loyalty_expiry_period_months
     -- The caller tried to set the date itself. Discard it and re-derive.
     -- `run_loyalty_expiry()` advances this column too, and converges rather
     -- than fights: it advances with the SAME `loyalty_next_expiry_on(
     -- current_date, ...)` expression this branch recomputes with, so the
     -- trigger lands on the identical value.
     or new.loyalty_expiry_next_run_on   is distinct from old.loyalty_expiry_next_run_on
     or new.loyalty_expiry_next_run_on   is null then
    new.loyalty_expiry_next_run_on := public.loyalty_next_expiry_on(
      current_date,
      new.loyalty_expiry_anchor_month,
      new.loyalty_expiry_anchor_day,
      new.loyalty_expiry_period_months);
  end if;
  return new;
end $$;

drop trigger if exists set_app_settings_loyalty_expiry_next_run on public.app_settings;
create trigger set_app_settings_loyalty_expiry_next_run
  before insert or update on public.app_settings
  for each row execute function public.set_loyalty_expiry_next_run();

-- ---- 5. The driver -----------------------------------------------------------
create or replace function public.run_loyalty_expiry()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_settings public.app_settings;
  v_due      date;
  v_expired  integer := 0;
  v_points   bigint  := 0;
  r          record;
begin
  -- Lock the singleton FIRST. Two overlapping ticks then serialise, and the
  -- second finds the date already advanced. Note the ordering against
  -- place_order, which locks `profiles` and only READS app_settings: a reader is
  -- not blocked by FOR UPDATE, so the two cannot deadlock.
  select * into v_settings from public.app_settings where id = true for update;
  if not found then
    return jsonb_build_object('ran', false, 'reason', 'no settings row');
  end if;

  -- Disabled is the common case and costs one row read. No profile is touched,
  -- no ledger row is written, nothing is scheduled.
  if not coalesce(v_settings.loyalty_expiry_enabled, false) then
    return jsonb_build_object('ran', false, 'reason', 'disabled');
  end if;

  v_due := v_settings.loyalty_expiry_next_run_on;
  if v_due is null then
    -- Enabled but unscheduled should be impossible (the trigger fills it), so
    -- schedule and STOP rather than guessing that today is the day.
    update public.app_settings
       set loyalty_expiry_next_run_on = public.loyalty_next_expiry_on(
             current_date, loyalty_expiry_anchor_month,
             loyalty_expiry_anchor_day, loyalty_expiry_period_months)
     where id = true;
    return jsonb_build_object('ran', false, 'reason', 'scheduled', 'next_run_on',
                              (select loyalty_expiry_next_run_on from public.app_settings where id = true));
  end if;

  -- `>=` not `=`: a tick missed on the day itself catches up the next day rather
  -- than skipping an entire cycle.
  if current_date < v_due then
    return jsonb_build_object('ran', false, 'reason', 'not due', 'next_run_on', v_due);
  end if;

  -- Only balances worth expiring. A customer at zero gets no row: an audit trail
  -- of "0 points expired" is noise that makes the real rows harder to find.
  for r in
    select id, loyalty_points from public.profiles
     where loyalty_points > 0
     order by id
     for update
  loop
    insert into public.loyalty_transactions
      (profile_id, order_id, type, points, balance_after, reason, created_by)
    values (r.id, null, 'expire', -r.loyalty_points, 0,
            'Points expired on the scheduled reset', null);
    update public.profiles set loyalty_points = 0 where id = r.id;
    v_expired := v_expired + 1;
    v_points  := v_points + r.loyalty_points;
  end loop;

  -- Advance INSIDE the same transaction as the writes above, which is what makes
  -- the whole thing idempotent and all-or-nothing.
  update public.app_settings
     set loyalty_expiry_next_run_on = public.loyalty_next_expiry_on(
           current_date, loyalty_expiry_anchor_month,
           loyalty_expiry_anchor_day, loyalty_expiry_period_months)
   where id = true;

  return jsonb_build_object(
    'ran', true, 'expired_on', v_due,
    'customers_expired', v_expired, 'points_expired', v_points,
    'next_run_on', (select loyalty_expiry_next_run_on from public.app_settings where id = true));
end $$;

revoke all on function public.run_loyalty_expiry() from public, anon, authenticated;

-- ---- 6. Schedule -------------------------------------------------------------
-- Daily, not more often: the job is a date comparison, and a reset is an event
-- of the day rather than of the minute. 00:20 UTC is 03:20 in Riyadh -- after
-- the kitchen has closed, so a customer is not mid-checkout when their balance
-- changes. cron.schedule upserts by name, so re-applying updates rather than
-- duplicates the job.
select cron.schedule(
  'loyalty-expiry',
  '20 0 * * *',
  'select public.run_loyalty_expiry();'
);

-- ---- 7. Self-verification ----------------------------------------------------
do $$
declare
  v_ck        text;
  v_cols      integer;
  v_enabled   boolean;
  v_next      date;
  v_jobs      integer;
  v_auth_can  boolean;
begin
  -- (a) The ledger admits `expire` and still refuses anything else.
  select pg_get_constraintdef(oid) into v_ck from pg_constraint
   where conname = 'loyalty_transactions_type_check';
  if v_ck is null or v_ck !~ 'expire' then
    raise exception 'the ledger type constraint does not admit expire (%)', coalesce(v_ck, '<absent>');
  end if;
  if v_ck ~ 'earn' is not true or v_ck !~ 'redeem' or v_ck !~ 'adjustment' then
    raise exception 'the widened constraint dropped an existing type: %', v_ck;
  end if;

  -- (b) Every settings column landed.
  select count(*) into v_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'app_settings'
     and column_name in ('loyalty_expiry_enabled', 'loyalty_expiry_anchor_month',
                         'loyalty_expiry_anchor_day', 'loyalty_expiry_period_months',
                         'loyalty_expiry_next_run_on');
  if v_cols <> 5 then
    raise exception 'expected 5 loyalty-expiry settings columns, found %', v_cols;
  end if;

  -- (c) APPLYING THIS FILE MUST CHANGE NOTHING. Expiry is off and nothing is
  --     scheduled -- checked rather than asserted, because "defaults false" in a
  --     DDL statement is not the same as "false on the live row".
  select loyalty_expiry_enabled, loyalty_expiry_next_run_on
    into v_enabled, v_next from public.app_settings where id = true;
  if coalesce(v_enabled, false) then
    raise exception 'loyalty expiry is ENABLED on the live settings row after apply';
  end if;
  if v_next is not null then
    raise exception 'a reset is scheduled for % even though expiry is disabled', v_next;
  end if;

  -- (d) The driver exists, is scheduled once, and no client can call it.
  if to_regprocedure('public.run_loyalty_expiry()') is null then
    raise exception 'run_loyalty_expiry() was not created';
  end if;
  select count(*) into v_jobs from cron.job where jobname = 'loyalty-expiry';
  if v_jobs <> 1 then
    raise exception 'expected exactly one loyalty-expiry cron job, found %', v_jobs;
  end if;
  select has_function_privilege('authenticated', 'public.run_loyalty_expiry()', 'execute')
    into v_auth_can;
  if v_auth_can then
    raise exception 'run_loyalty_expiry() must not be callable by a client';
  end if;

  -- (e) The date maths, on the one case that matters most: the answer is always
  --     STRICTLY in the future, which is the retroactivity guarantee.
  if public.loyalty_next_expiry_on(current_date, 1, 1, 12) <= current_date then
    raise exception 'loyalty_next_expiry_on returned a date that is not in the future';
  end if;
  if public.loyalty_next_expiry_on(date '2026-06-15', 1, 1, 12) <> date '2027-01-01' then
    raise exception 'annual anchor resolved wrongly: %',
      public.loyalty_next_expiry_on(date '2026-06-15', 1, 1, 12);
  end if;
  if public.loyalty_next_expiry_on(date '2026-06-15', 1, 1, 6) <> date '2026-07-01' then
    raise exception 'six-month anchor resolved wrongly: %',
      public.loyalty_next_expiry_on(date '2026-06-15', 1, 1, 6);
  end if;

  raise notice 'LOYALTY EXPIRY OK (disabled, unscheduled, driver present and client-unreachable)';
end $$;
