-- ============================================================================
-- Spicy Meal — per-branch VARIANT (price tier) availability
--
-- WHY THIS LEVEL EXISTS AT ALL
-- Availability is already enforced at two levels: the product
-- (`branch_product_availability`, 2026-08-19) and the modifier
-- (`branch_modifier_availability`, 2026-08-20). Neither can express "we are out
-- of the Large". Measured against the live catalog on 2026-09-16 that is the
-- gap that matters: 59 of the 61 active products carry price tiers and there
-- are 144 `product_variants` rows, against exactly ONE product with a modifier
-- group and 13 modifiers in total. A cashier who runs out of one size today has
-- to close the whole item.
--
-- The 2026-08-20 modifier migration framed tiers as modifiers — "the old
-- operations webapp could close a single price tier (just the Large), and in
-- SMA that same act is closing a single modifier. There is no product-variant
-- model and this does not add one." That was true when it was written. Four
-- days later `20260824120000_product_variants` added exactly such a model, and
-- the Lazywait importer has been filling it ever since, so the two concepts are
-- now distinct rows in distinct tables. This closes the level that arrived
-- after that sentence was written.
--
-- SHAPE: COPIED FROM branch_modifier_availability, DELIBERATELY
--   * `is_available` stays the authoritative flag, `snoozed_until` is only the
--     scheduled restore time;
--   * absence of a row means available, so only exceptions are stored;
--   * the staff actor and the free-text note are NOT on this table — both
--     clients read it, so they live on `branch_availability_events`, which this
--     migration teaches to carry a `variant_id`.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- It does not touch the order path. `place_order` and `compute_order_snapshot`
-- still know nothing about a closed tier, so applying this changes no customer
-- behaviour whatsoever — the table is created empty and nothing reads it.
-- The order-path re-emission is `20260924120000`, kept separate for the reason
-- the modifier rollout gives in its own header:
--
--     "That re-emission is a separate migration so it can be reviewed and
--      reverted on its own."
--
-- Nor does it teach the operations health card to count closed tiers; that is
-- `20260925120000`. Until that lands, a stuck variant snooze is invisible on
-- the health board — which is survivable only because nothing can create one
-- until an operator is given the buttons.
--
-- APPLY ORDER: this file, then 20260924120000, then 20260925120000. The later
-- two assert this one's objects and refuse to land without them.
-- ============================================================================

-- ---- The table ---------------------------------------------------------------
create table if not exists public.branch_variant_availability (
  branch_id     uuid not null references public.branches(id)         on delete cascade,
  variant_id    uuid not null references public.product_variants(id) on delete cascade,
  is_available  boolean not null default true,
  snoozed_until timestamptz,
  reason_code   text,
  changed_at    timestamptz,
  source        text,
  updated_at    timestamptz not null default now(),
  primary key (branch_id, variant_id),
  constraint bva_reason_code_check check (reason_code in
    ('out_of_stock','supplier_delay','equipment_down','quality_hold','other')),
  constraint bva_source_check check (source in ('manual','lazywait'))
);

create index if not exists bva_variant_id_idx on public.branch_variant_availability (variant_id);

-- The sweeper's scan, partial so it stays proportional to what is snoozed.
create index if not exists bva_snoozed_until_idx
  on public.branch_variant_availability (snoozed_until)
  where is_available = false and snoozed_until is not null;

comment on table public.branch_variant_availability is
  'Per-branch product-variant (price tier) availability. Absence of a row means available. is_available is authoritative; snoozed_until is the scheduled restore time. Read by both clients, so it carries no staff identity and no free text — those are on branch_availability_events.';

alter table public.branch_variant_availability enable row level security;

-- REVOKE FIRST. This is the one line the 2026-08-20 modifier template does NOT
-- have, and copying that template verbatim would have re-opened a hole the
-- security audit closed on 2026-09-14.
--
-- This project carries `alter default privileges in schema public grant all on
-- tables to anon, authenticated, service_role` — from both `postgres` and
-- `supabase_admin`, verified in `pg_default_acl`. Every table created in
-- `public` therefore starts with `arwdDxtm` for `anon`: insert, update, delete,
-- truncate, references and trigger, none of which any migration in this
-- repository ever granted. `20260919120000_security_audit_db_hardening`
-- (live version 20260914104107, ledger row 94) had to strip exactly that from
-- `branch_product_availability` and `branch_modifier_availability`.
--
-- `revoke all` rather than the audit's `revoke insert, update, delete`, because
-- the narrower form is why `branch_modifier_availability` still shows
-- `anon = REFERENCES, SELECT, TRIGGER, TRUNCATE` live today — and RLS does not
-- filter TRUNCATE. The newer house pattern
-- (`20260916120000_branch_delivery_requests`, `20260910120000_loyalty_multipliers`)
-- revokes everything first and grants back precisely; both show `anon` holding
-- nothing they were not given.
revoke all on public.branch_variant_availability from public, anon, authenticated;
grant select on public.branch_variant_availability to anon, authenticated;

-- Public read, matching bpa_select_public and bma_select_public: the customer
-- app needs this to know which sizes to grey out, and it carries nothing
-- sensitive.
drop policy if exists bva_select_public on public.branch_variant_availability;
create policy bva_select_public
  on public.branch_variant_availability for select to anon, authenticated
  using (true);

-- Admin-only direct write, matching every other catalog table. Branch operators
-- go through the RPCs below.
grant insert, update, delete on public.branch_variant_availability to authenticated;
drop policy if exists bva_admin_write on public.branch_variant_availability;
create policy bva_admin_write
  on public.branch_variant_availability for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop trigger if exists set_branch_variant_availability_updated_at on public.branch_variant_availability;
create trigger set_branch_variant_availability_updated_at
  before update on public.branch_variant_availability
  for each row execute function public.set_updated_at();

-- ---- The audit table learns a third target ----------------------------------
-- `branch_availability_events` already carries product_id and modifier_id, both
-- nullable, both `on delete set null` so an audit row survives its subject. A
-- variant needs the same.
alter table public.branch_availability_events
  add column if not exists variant_id uuid references public.product_variants(id) on delete set null;

-- `bae_one_target` says an event names at most one subject. It currently reads
-- `num_nonnulls(product_id, modifier_id) <= 1`, which a variant row would pass
-- vacuously — product and modifier both null is zero non-nulls — while the
-- constraint quietly stopped meaning what its name claims. Widen it rather than
-- leave that. It cannot fail against existing rows: every row predates this
-- column, so every row has variant_id null.
alter table public.branch_availability_events drop constraint if exists bae_one_target;
alter table public.branch_availability_events
  add constraint bae_one_target check (num_nonnulls(product_id, modifier_id, variant_id) <= 1);

create index if not exists bae_variant_id_idx
  on public.branch_availability_events (variant_id)
  where variant_id is not null;

-- ---- Normalize + audit, the same pair as products and modifiers -------------
create or replace function public.normalize_variant_availability()
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

drop trigger if exists normalize_variant_availability on public.branch_variant_availability;
create trigger normalize_variant_availability
  before insert or update on public.branch_variant_availability
  for each row execute function public.normalize_variant_availability();

create or replace function public.emit_variant_availability_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_source text := case when auth.uid() is null then 'automatic' else 'manual' end;
  v_role   public.user_role;
  v_note   text := nullif(btrim(coalesce(current_setting('sma.availability_note', true), '')), '');
  v_action text;
  v_closed boolean;
  v_opened boolean;
  v_rewindow boolean;
begin
  v_closed := (not new.is_available) and (tg_op = 'INSERT' or old.is_available);
  v_opened := new.is_available and tg_op = 'UPDATE' and not old.is_available;
  v_rewindow := (not new.is_available) and tg_op = 'UPDATE' and not old.is_available
    and new.snoozed_until is distinct from old.snoozed_until;

  if v_closed or v_rewindow then
    v_action := 'closed';
  elsif v_opened then
    v_action := case when v_source = 'automatic' then 'opened_auto' else 'opened_manual' end;
  else
    return null;
  end if;

  if v_actor is not null then
    select p.role into v_role from public.profiles p where p.id = v_actor;
  end if;

  insert into public.branch_availability_events (
    branch_id, variant_id, action, duration_minutes,
    start_time, end_time, actual_open_time,
    reason_code, reason_note, changed_by, actor_role, source
  ) values (
    new.branch_id, new.variant_id, v_action,
    case when v_action = 'closed' and new.snoozed_until is not null
         then greatest(0, ceil(extract(epoch from (new.snoozed_until - now())) / 60.0))::int
    end,
    case when v_action = 'closed' then now() end,
    case when v_action = 'closed' then new.snoozed_until end,
    case when v_action <> 'closed' then now() end,
    case when v_action = 'closed' then new.reason_code end,
    case when v_action = 'closed' then v_note end,
    v_actor, v_role, v_source
  );

  return null;
end $$;

drop trigger if exists emit_variant_availability_event on public.branch_variant_availability;
create trigger emit_variant_availability_event
  after insert or update on public.branch_variant_availability
  for each row execute function public.emit_variant_availability_event();

-- The realtime signal covers tiers too, so a console refetches on one. This is
-- load-bearing rather than decorative: PR #393 removed the branch console's
-- Refresh button on the strength of `useOpsChangeFeed`, which is driven by
-- `emit_ops_change_event`. A tier closed on one till has to appear on the next.
create or replace function public.signal_variant_availability_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or new.is_available is distinct from old.is_available
     or new.snoozed_until is distinct from old.snoozed_until then
    perform public.emit_ops_change_event(new.branch_id, 'availability');
  end if;
  return null;
end $$;

drop trigger if exists signal_variant_availability_change on public.branch_variant_availability;
create trigger signal_variant_availability_change
  after insert or update on public.branch_variant_availability
  for each row execute function public.signal_variant_availability_change();

revoke all on function public.normalize_variant_availability()      from public, anon, authenticated;
revoke all on function public.emit_variant_availability_event()     from public, anon, authenticated;
revoke all on function public.signal_variant_availability_change()  from public, anon, authenticated;

-- ---- RPCs — same authorization as product and modifier snooze ----------------
-- `is_admin() or is_branch_operator(branch)`. The CALL CENTRE IS EXCLUDED from
-- what is sellable, exactly as it is for products and modifiers: the branch owns
-- what it can sell, the call centre owns where it can go (the 2026-08-20
-- delivery boundary).
create or replace function public.set_variant_snooze(
  p_branch_id   uuid,
  p_variant_id  uuid,
  p_minutes     integer,
  p_reason_code text,
  p_note        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_minutes constant integer := 1440;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_until timestamptz;
begin
  if not (public.is_admin() or public.is_branch_operator(p_branch_id)) then
    raise exception 'Not authorized to change availability for this branch'
      using errcode = '42501';
  end if;
  if p_branch_id is null or p_variant_id is null then
    raise exception 'branch id and variant id are required' using errcode = '22004';
  end if;
  if p_minutes is null then
    raise exception 'A closure duration is required' using errcode = '22004';
  end if;
  if p_minutes <= 0 or p_minutes > c_max_minutes then
    raise exception 'Closure duration must be between 1 and % minutes', c_max_minutes
      using errcode = '22023';
  end if;
  if p_reason_code is null or p_reason_code not in
     ('out_of_stock','supplier_delay','equipment_down','quality_hold','other') then
    raise exception 'A valid reason is required' using errcode = '22023';
  end if;
  -- ACTIVE, not merely present. The Lazywait importer DEACTIVATES a tier it no
  -- longer sees rather than deleting it (20260826080000, line 545), so an
  -- inactive row is a tier no customer can order and no console lists. Letting
  -- one be closed would create a row the sheet cannot show and nobody can
  -- reopen from the counter.
  if not exists (select 1 from public.product_variants where id = p_variant_id and is_active) then
    raise exception 'Size not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;

  perform set_config('sma.availability_note', coalesce(v_note, ''), true);
  v_until := now() + make_interval(mins => p_minutes);

  insert into public.branch_variant_availability
    (branch_id, variant_id, is_available, snoozed_until, reason_code, source)
  values (p_branch_id, p_variant_id, false, v_until, p_reason_code, 'manual')
  on conflict (branch_id, variant_id) do update
    set is_available  = false,
        snoozed_until = excluded.snoozed_until,
        reason_code   = excluded.reason_code,
        source        = 'manual';

  perform set_config('sma.availability_note', '', true);

  return jsonb_build_object(
    'branch_id', p_branch_id, 'variant_id', p_variant_id, 'snoozed_until', v_until);
end $$;

-- Reopen does NOT require the tier to be active. A tier deactivated by an
-- importer while it was closed leaves a row behind; refusing to clear it would
-- make that row permanent. Closing is the guarded direction, not reopening.
create or replace function public.clear_variant_snooze(
  p_branch_id  uuid,
  p_variant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_branch_operator(p_branch_id)) then
    raise exception 'Not authorized to change availability for this branch'
      using errcode = '42501';
  end if;
  if p_branch_id is null or p_variant_id is null then
    raise exception 'branch id and variant id are required' using errcode = '22004';
  end if;

  update public.branch_variant_availability
     set is_available = true, source = 'manual'
   where branch_id = p_branch_id
     and variant_id = p_variant_id
     and is_available = false;

  return jsonb_build_object(
    'branch_id', p_branch_id, 'variant_id', p_variant_id, 'is_available', true);
end $$;

revoke all on function public.set_variant_snooze(uuid, uuid, integer, text, text) from public, anon;
revoke all on function public.clear_variant_snooze(uuid, uuid) from public, anon;
grant execute on function public.set_variant_snooze(uuid, uuid, integer, text, text) to authenticated;
grant execute on function public.clear_variant_snooze(uuid, uuid) to authenticated;

comment on function public.set_variant_snooze(uuid, uuid, integer, text, text) is
  'Close one product variant (price tier) at one branch for a bounded period. Admin or the branch''s own operator only — call centre excluded, matching product and modifier snooze. Refuses an inactive tier.';

-- ---- Sweeper: one more expiry class, its own counter -------------------------
alter table public.branch_availability_runs
  add column if not exists variants_reopened integer not null default 0;

-- DERIVED FROM THE LIVE BODY, NOT FROM 20260820140000. The sweeper has moved on
-- since the modifier migration wrote it: it gained the 14-day retention prune
-- and its `rows_pruned` counter. Re-emitting the older text would silently
-- revert those. The only differences from the body running in Production today
-- are the `v_variants` declaration, the variants arm, and the one extra column
-- in the success update.
create or replace function public.branch_availability_sweep()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  c_lock_key  constant bigint := 815402977;   -- fixed advisory key for this sweeper
  c_retention constant interval := interval '14 days';
  v_run_id   bigint;
  v_start    timestamptz := clock_timestamp();
  v_reopened integer := 0;
  v_mods     integer := 0;
  v_variants integer := 0;
  v_delivery integer := 0;
  v_areas    integer := 0;
  v_pruned   integer := 0;
begin
  insert into public.branch_availability_runs (status) values ('running') returning id into v_run_id;

  if not pg_try_advisory_xact_lock(c_lock_key) then
    update public.branch_availability_runs
       set status = 'failed', completed_at = now(),
           safe_error_code = 'overlap_skipped',
           safe_error_message = 'another sweeper run holds the advisory lock',
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;
    return v_run_id;
  end if;

  -- Retention. Outer block and separately guarded — see the header. The
  -- just-inserted row (started_at = now()) and everything newer are far outside
  -- the window, so the current run can never delete itself.
  begin
    with pruned as (
      delete from public.branch_availability_runs
       where started_at < now() - c_retention
      returning 1
    )
    select count(*)::int into v_pruned from pruned;
  exception when others then
    -- Housekeeping must never stop a sweep. Left at 0, which is the signal.
    v_pruned := 0;
  end;

  begin
    -- Items. `snoozed_until is not null` excludes untimed admin closures.
    with reopened as (
      update public.branch_product_availability
         set is_available = true
       where is_available = false
         and snoozed_until is not null
         and snoozed_until <= now()
      returning 1
    )
    select count(*)::int into v_reopened from reopened;

    -- Modifiers, same rule.
    with reopened_mods as (
      update public.branch_modifier_availability
         set is_available = true
       where is_available = false
         and snoozed_until is not null
         and snoozed_until <= now()
      returning 1
    )
    select count(*)::int into v_mods from reopened_mods;

    -- Price tiers, same rule. Reopened even if the tier has since been
    -- deactivated: an inactive tier cannot be ordered anyway, and leaving the
    -- row closed would make an expired timer permanent.
    with reopened_variants as (
      update public.branch_variant_availability
         set is_available = true
       where is_available = false
         and snoozed_until is not null
         and snoozed_until <= now()
      returning 1
    )
    select count(*)::int into v_variants from reopened_variants;

    -- Branch delivery: a null delivery_closed_until is the admin's untimed pause.
    with resumed as (
      update public.branches
         set delivery_temporarily_closed = false
       where delivery_temporarily_closed
         and delivery_closed_until is not null
         and delivery_closed_until <= now()
      returning 1
    )
    select count(*)::int into v_delivery from resumed;

    with reenabled as (
      update public.branch_delivery_areas
         set is_disabled = false
       where is_disabled
         and disabled_until is not null
         and disabled_until <= now()
      returning 1
    )
    select count(*)::int into v_areas from reenabled;

    update public.branch_availability_runs
       set status = 'success', completed_at = now(),
           products_reopened  = v_reopened,
           modifiers_reopened = v_mods,
           variants_reopened  = v_variants,
           delivery_resumed   = v_delivery,
           areas_reenabled    = v_areas,
           rows_pruned        = v_pruned,
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;

  exception when others then
    -- SQLSTATE only. A message from a catalog or branch row could carry names.
    -- rows_pruned is still recorded: the prune already committed to this
    -- transaction outside the failing block, so the ledger should say so.
    update public.branch_availability_runs
       set status = 'failed', completed_at = now(),
           safe_error_code = sqlstate,
           safe_error_message = 'sweep failed; see sqlstate',
           rows_pruned = v_pruned,
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;
  end;

  return v_run_id;
end $$;

revoke all on function public.branch_availability_sweep() from public, anon, authenticated;
grant execute on function public.branch_availability_sweep() to service_role;

-- ---- Self-verification -------------------------------------------------------
-- Asserts the exact properties this file exists to establish, and the two
-- boundaries it must not move. Every assertion is a value that can be false —
-- nothing here reports through `raise notice`, because the MCP SQL tool
-- surfaces no notices and a block that cannot fail is counted as evidence.
do $$
declare
  v_missing text;
  v_count   integer;
begin
  -- 1. The table exists, is empty, and applying this closed nothing.
  select count(*) into v_count from public.branch_variant_availability;
  if v_count <> 0 then
    raise exception 'branch_variant_availability is not empty after creation: % rows', v_count;
  end if;

  -- 2. RLS is on. A permissive select policy without RLS would be nothing at all.
  if not (select relrowsecurity from pg_class where oid = 'public.branch_variant_availability'::regclass) then
    raise exception 'RLS is not enabled on branch_variant_availability';
  end if;

  -- 3. All four triggers are attached. The realtime signal is the one whose
  --    absence would be silent: the console would simply stop refreshing.
  select string_agg(t, ', ') into v_missing
  from unnest(array[
    'set_branch_variant_availability_updated_at',
    'normalize_variant_availability',
    'emit_variant_availability_event',
    'signal_variant_availability_change'
  ]) as t
  where not exists (
    select 1 from pg_trigger g
    where g.tgrelid = 'public.branch_variant_availability'::regclass
      and not g.tgisinternal and g.tgname = t
  );
  if v_missing is not null then
    raise exception 'missing trigger(s) on branch_variant_availability: %', v_missing;
  end if;

  -- 4. The audit table can carry a variant, and its one-target rule counts it.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'branch_availability_events'
      and column_name = 'variant_id'
  ) then
    raise exception 'branch_availability_events.variant_id was not added';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.branch_availability_events'::regclass
      and conname = 'bae_one_target'
      and pg_get_constraintdef(oid) like '%variant_id%'
  ) then
    raise exception 'bae_one_target does not count variant_id';
  end if;

  -- 5. The RPC gate. `anon` must not reach either, `authenticated` must reach
  --    both — the call-centre exclusion lives inside the body and is asserted
  --    by the paired SQL suite, which can create roles.
  if has_function_privilege('anon', 'public.set_variant_snooze(uuid,uuid,integer,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.clear_variant_snooze(uuid,uuid)', 'EXECUTE') then
    raise exception 'anon can execute a variant snooze RPC';
  end if;
  if not has_function_privilege('authenticated', 'public.set_variant_snooze(uuid,uuid,integer,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.clear_variant_snooze(uuid,uuid)', 'EXECUTE') then
    raise exception 'authenticated cannot execute a variant snooze RPC';
  end if;

  -- 6. `anon` holds SELECT and NOTHING ELSE. The default privileges this
  --    project carries would otherwise hand it arwdDxtm on a brand-new table,
  --    which is the exact surface the 2026-09-14 audit removed from the two
  --    sibling tables. Asserted as a set difference rather than by naming the
  --    verbs, so a privilege nobody thought of still fails this.
  select string_agg(privilege_type, ', ' order by privilege_type) into v_missing
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'branch_variant_availability'
    and grantee = 'anon' and privilege_type <> 'SELECT';
  if v_missing is not null then
    raise exception 'anon holds more than SELECT on branch_variant_availability: %', v_missing;
  end if;

  -- 7. The sweeper kept everything it had. Re-emitting a stale body would
  --    silently revert the retention prune, which no counter would reveal
  --    until branch_availability_runs had grown without bound.
  select string_agg(t, ', ') into v_missing
  from unnest(array[
    'branch_product_availability',
    'branch_modifier_availability',
    'branch_variant_availability',
    'branches',
    'branch_delivery_areas',
    'c_retention',
    'rows_pruned',
    'variants_reopened'
  ]) as t
  where position(t in (
    select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'branch_availability_sweep'
  )) = 0;
  if v_missing is not null then
    raise exception 'branch_availability_sweep lost: %', v_missing;
  end if;

  -- 8. THE ORDER PATH IS UNTOUCHED, which is the whole claim of this file.
  --    20260924120000 is what changes it; if either function already mentions
  --    this table, the files have been applied out of order.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('place_order','compute_order_snapshot')
      and p.prosrc like '%branch_variant_availability%'
  ) then
    raise exception 'a money-path function already references branch_variant_availability; 20260924120000 appears to have been applied first';
  end if;
end $$;
