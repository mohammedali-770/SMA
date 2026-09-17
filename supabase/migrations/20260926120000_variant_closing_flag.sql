-- 20260926120000_variant_closing_flag.sql
--
-- THE SWITCH THAT LETS THE OPERATOR CONTROLS SHIP BEFORE THE CUSTOMER BUILD.
--
-- `20260923120000` … `20260925120000` gave the server per-tier availability and
-- shipped it inert, because of one sequencing problem stated in #394:
--
--   The customer app reads exactly two availability tables. A closed TIER passes
--   `isOrderable`, `validateCartForBranch` AND the pre-submit re-read in
--   `CheckoutScreen.placeOrder` — the check that exists precisely so a customer
--   never meets a raw server refusal. `place_order` then raises, and
--   `failureMessage` returns `t(messageKey)`: a TRANSLATED KEY, never the
--   server's sentence. An app build that does not know this refusal therefore
--   shows a generic error at the payment step.
--
-- That was verified rather than assumed before writing this file
-- (`apps/mobile/src/lib/errors/reportFailure.ts:65-71`).
--
-- THE WEB CONSOLE AND THE CUSTOMER APP SHIP ON DIFFERENT CLOCKS, and that is the
-- whole difficulty. The ops console deploys on merge; the customer app reaches a
-- customer only in the next EAS build, and then only once they update. So
-- "merge both halves together" does NOT close the window — it just makes the
-- window start at deploy instead of at merge.
--
-- So the window is closed by a SWITCH rather than by timing. The operator
-- controls are hidden while this flag is false, which means no closed-tier row
-- can be written, which means the refusal is unreachable, which means no
-- customer on any build can meet it. Turning it on is a deliberate act performed
-- once the build carrying the customer half is live.
--
-- WHY A SETTING RATHER THAN A CLIENT CONSTANT. A constant would need a code
-- change and a deploy to flip, which is the thing being avoided. `app_settings`
-- is already read in full by both clients, so this costs no new query. It is the
-- same shape as `loyalty_pickup_only` (`20260907120000`), which exists for the
-- same reason: a behaviour that must be switchable without shipping software.
--
-- DEFAULTS FALSE, so applying this changes nothing. Contrast `loyalty_pickup_only`,
-- which defaults TRUE and where applying the migration WAS the behaviour change
-- (ledger row 82). This one cannot be: false is "carry on exactly as before".
--
-- NO COLUMN-GRANT TRAP HERE, AND THAT WAS CHECKED RATHER THAN ASSUMED. A column
-- added to a table whose grants are COLUMN-scoped is invisible to the client that
-- selects it — which is precisely how `orders.is_comped` broke My Orders for
-- three weeks until `20260922120000`. `app_settings` appears in
-- `information_schema.table_privileges` for `anon` and `authenticated`, so its
-- SELECT is TABLE-level and a new column is covered automatically. Verified live
-- on 2026-09-17, before this file was written.

alter table public.app_settings
  add column if not exists variant_closing_enabled boolean not null default false;

comment on column public.app_settings.variant_closing_enabled is
  'Operator controls for closing a single PRICE TIER are hidden while this is false. It exists because the branch console deploys on merge while the customer app reaches customers only in the next EAS build: until a build that understands a closed tier is live, closing one would show a customer a generic error at the payment step. Turn it on once that build is live. Server-side enforcement (20260924120000) is unconditional and does not read this flag — this hides the control, it does not weaken the rule.';

-- ---- Self-verification -------------------------------------------------------
-- Every assertion is a value that can be false.
do $$
declare
  v_default text;
  v_notnull boolean;
  v_live    boolean;
  v_n       integer;
begin
  -- 1. The column exists, is NOT NULL, and defaults FALSE. The default is the
  --    safety property: a project that applies this and reads no further must
  --    end up with the controls HIDDEN, never shown.
  select column_default, (is_nullable = 'NO')
    into v_default, v_notnull
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'app_settings'
     and column_name  = 'variant_closing_enabled';

  if v_default is null then
    raise exception 'variant_closing_enabled was not added to app_settings';
  end if;
  if v_default not like 'false%' then
    raise exception 'variant_closing_enabled must default FALSE, found %', v_default;
  end if;
  if not v_notnull then
    raise exception 'variant_closing_enabled must be NOT NULL — a null would be read as "unset" by one client and "off" by another';
  end if;

  -- 2. THE LIVE ROW IS OFF. `add column ... default false` backfills existing
  --    rows, but asserting it is the point: this migration must not be capable
  --    of switching the feature on, and the singleton row is where that would
  --    show.
  select variant_closing_enabled into v_live from public.app_settings where id is true;
  if v_live is null then
    raise exception 'the app_settings singleton row is missing';
  end if;
  if v_live then
    raise exception 'applying this migration turned per-size closing ON; it must default OFF';
  end if;

  -- 3. BOTH CLIENT ROLES CAN READ IT. This is the `orders.is_comped` lesson:
  --    a column the client selects but cannot read fails the WHOLE select, and
  --    both clients read `app_settings` with `select *`. A table-level grant
  --    covers a new column; a column-scoped one would not, so assert the
  --    outcome rather than the mechanism.
  --
  --    MEASURED, because a check that cannot fail is worse than no check:
  --    revoking SELECT on the TABLE from `anon` does make this raise. Revoking
  --    the COLUMN alone does not — `has_column_privilege` is satisfied by
  --    either grant, and the table-level one survives. That is the correct
  --    answer to the question actually being asked ("can the client read this
  --    column"), not a hole: it is the reason this table is safe to extend
  --    where `orders` was not.
  if not has_column_privilege('anon', 'public.app_settings', 'variant_closing_enabled', 'SELECT') then
    raise exception 'anon cannot read variant_closing_enabled — every anon app_settings select would now fail';
  end if;
  if not has_column_privilege('authenticated', 'public.app_settings', 'variant_closing_enabled', 'SELECT') then
    raise exception 'authenticated cannot read variant_closing_enabled';
  end if;

  -- 4. An administrator can turn it on. `authenticated` holds UPDATE on this
  --    table and RLS decides who; without the column privilege the toggle would
  --    be unreachable and the feature could never be enabled.
  if not has_column_privilege('authenticated', 'public.app_settings', 'variant_closing_enabled', 'UPDATE') then
    raise exception 'authenticated cannot update variant_closing_enabled — the admin toggle would be dead';
  end if;

  -- 5. THE MONEY PATH DOES NOT READ THIS FLAG, and must not. Server-side refusal
  --    of a closed tier is unconditional: the flag hides a control, it does not
  --    soften the rule. If a money-path function ever mentions it, the guarantee
  --    that the server is the authority has been quietly traded away.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('place_order', 'compute_order_snapshot')
     and p.prosrc like '%variant_closing_enabled%';
  if v_n <> 0 then
    raise exception 'a money-path function reads variant_closing_enabled; enforcement must be unconditional';
  end if;
end $$;
