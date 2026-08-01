-- Let a customer delete a saved address that has backed an online checkout.
--
-- WHY
-- `public.checkout_sessions.address_id` was declared inline as
--     address_id uuid references public.addresses(id)
-- with no ON DELETE action, i.e. NO ACTION — the delete is refused. Session rows
-- are never removed: finalize_checkout_session only sets status='consumed' and
-- the stale sweep only sets status='expired'; the sole DELETE FROM
-- public.checkout_sessions in the whole schema is account anonymisation
-- (20260715120000). So the reference is permanent, and an address that has ever
-- backed ONE online checkout could never be deleted again — the customer got a
-- foreign-key violation for the rest of the account's life.
--
-- `public.orders.address_id` already models this correctly
-- (20260707120500_orders.sql: `on delete set null`), which is why deleting an
-- address that has been DELIVERED to has always worked. This brings the session
-- table in line with the order table.
--
-- WHY THIS IS SAFE FOR PAYMENTS
-- The column is bookkeeping, not an input to anything that prices or charges:
--
--   * begin_checkout_session prices the cart into `snapshot` (jsonb) and writes
--     `snapshot->'address_snapshot'` plus `snapshot->>'address_id'`. That JSONB
--     is the server-trusted quote and is NOT touched here.
--   * insert_order_from_snapshot reads the address from the SNAPSHOT, not from
--     this column — `nullif(p_snapshot->>'address_id','')::uuid`
--     (20260712160000:340, 20260712170000:73). Nulling the column therefore
--     cannot change which address an order is created against, nor any amount.
--   * finalize_checkout_session, tap_begin_session_attempt, payment-verify and
--     payment-webhook never read `checkout_sessions.address_id` at all.
--
-- So after this change a deleted address leaves the session row intact, its
-- snapshot intact, its totals intact and its order linkage intact; only the
-- convenience pointer to the (now absent) address row becomes NULL — exactly
-- what `orders.address_id` already does.
--
-- SCOPE
-- ONE constraint, delete-behaviour only. The referenced table
-- (public.addresses) and column (id) are preserved, as are MATCH type, ON
-- UPDATE behaviour, deferrability and the constraint name. No session row is
-- read, written, deleted or re-priced. No function, policy, grant, trigger or
-- payment provider setting is touched.
--
-- IDEMPOTENT AND SAFE ON BOTH A CLEAN AND AN EXISTING DATABASE
--   * absent table            -> skipped with a notice (nothing to alter);
--   * already ON DELETE SET NULL -> no-op;
--   * constraint missing entirely -> created with the correct behaviour;
--   * NOT NULL on address_id  -> dropped ONLY if actually present, because
--     SET NULL is impossible against a NOT NULL column. It is nullable in the
--     repository schema, so on a clean database this branch does not run.
--
-- NOT APPLIED TO PRODUCTION by this change. Production schema changes go only
-- through the owner-approved apply_migration workflow (docs/MIGRATIONS.md).
-- `supabase db push` is forbidden against production (CLAUDE.md §8).

do $$
declare
  v_conname   name;
  v_confdel   "char";
  v_confupd   "char";
  v_confmatch "char";
  v_deferrable boolean;
  v_deferred   boolean;
  v_notnull   boolean;
  v_refcol    name;
  -- Catalog code -> SQL clause, so the recreated constraint reproduces the
  -- original exactly apart from ON DELETE.
  v_upd_clause text;
  v_match_clause text;
  v_defer_clause text;
begin
  if to_regclass('public.checkout_sessions') is null then
    raise notice 'checkout_sessions does not exist; nothing to alter';
    return;
  end if;

  -- Find the FK on checkout_sessions(address_id) -> addresses BY CATALOG rather
  -- than by hardcoded name: the constraint was created inline by CREATE TABLE,
  -- so its name is server-generated and a differently-built database may not
  -- match the name this repository happens to produce.
  select c.conname, c.confdeltype, c.confupdtype, c.confmatchtype,
         c.condeferrable, c.condeferred,
         (select a.attname
            from pg_attribute a
           where a.attrelid = c.confrelid and a.attnum = c.confkey[1])
    into v_conname, v_confdel, v_confupd, v_confmatch,
         v_deferrable, v_deferred, v_refcol
    from pg_constraint c
   where c.conrelid = 'public.checkout_sessions'::regclass
     and c.contype = 'f'
     and c.confrelid = 'public.addresses'::regclass
     and array_length(c.conkey, 1) = 1
     and c.conkey[1] = (
       select a.attnum from pg_attribute a
        where a.attrelid = 'public.checkout_sessions'::regclass
          and a.attname = 'address_id' and not a.attisdropped
     );

  -- Already correct: nothing to do. This is what makes a re-run a no-op.
  if v_conname is not null and v_confdel = 'n' then
    raise notice 'checkout_sessions.address_id already ON DELETE SET NULL; no change';
    return;
  end if;

  -- SET NULL cannot be honoured against a NOT NULL column. Only relax it when
  -- it is actually set, so a database that already matches the repository
  -- schema is left untouched.
  select a.attnotnull into v_notnull
    from pg_attribute a
   where a.attrelid = 'public.checkout_sessions'::regclass
     and a.attname = 'address_id' and not a.attisdropped;

  if v_notnull then
    raise notice 'dropping NOT NULL on checkout_sessions.address_id (required for ON DELETE SET NULL)';
    alter table public.checkout_sessions alter column address_id drop not null;
  end if;

  if v_conname is null then
    -- No FK at all (a database where it was dropped). Create it correctly
    -- rather than leaving the column unreferenced.
    raise notice 'no FK on checkout_sessions.address_id; creating it with ON DELETE SET NULL';
    alter table public.checkout_sessions
      add constraint checkout_sessions_address_id_fkey
      foreign key (address_id) references public.addresses(id) on delete set null;
    return;
  end if;

  -- Reproduce every other property of the existing constraint verbatim.
  v_upd_clause := case v_confupd
                    when 'a' then ''                      -- NO ACTION (default)
                    when 'r' then ' on update restrict'
                    when 'c' then ' on update cascade'
                    when 'n' then ' on update set null'
                    when 'd' then ' on update set default'
                    else ''
                  end;
  v_match_clause := case v_confmatch
                      when 'f' then ' match full'
                      when 'p' then ' match partial'
                      else ''                             -- MATCH SIMPLE (default)
                    end;
  v_defer_clause := case
                      when v_deferrable and v_deferred then ' deferrable initially deferred'
                      when v_deferrable then ' deferrable'
                      else ''
                    end;

  -- Drop + recreate under the SAME name, in one transaction: the DDL holds
  -- ACCESS EXCLUSIVE until commit, so there is no window in which a delete
  -- could slip past an absent constraint.
  execute format('alter table public.checkout_sessions drop constraint %I', v_conname);
  execute format(
    'alter table public.checkout_sessions add constraint %I'
    || ' foreign key (address_id) references public.addresses(%I)%s on delete set null%s%s',
    v_conname, coalesce(v_refcol, 'id'), v_match_clause, v_upd_clause, v_defer_clause
  );

  raise notice 'checkout_sessions.% is now ON DELETE SET NULL', v_conname;
end $$;

comment on column public.checkout_sessions.address_id is
  'Convenience pointer to the address this session was priced for. NULLed if the customer later deletes that address; the authoritative copy lives in snapshot->address_snapshot, which insert_order_from_snapshot reads.';

-- Rollback (restores the original blocking behaviour)
-- alter table public.checkout_sessions drop constraint checkout_sessions_address_id_fkey;
-- alter table public.checkout_sessions
--   add constraint checkout_sessions_address_id_fkey
--   foreign key (address_id) references public.addresses(id);
