-- Refuse a hard delete of a product, size or option while a customer is paying
-- for an order that contains it. Audit finding F-X03-001 (verdict: confirmed,
-- high).
--
-- WHY
-- A card checkout freezes the cart into `checkout_sessions.snapshot` and writes
-- the order only AFTER the provider has captured the money:
-- finalize_checkout_session -> insert_order_from_snapshot copies
--   items[].product_id                -> order_items.product_id
--   items[].variant_id                -> order_items.variant_id
--   items[].modifiers[].modifier_id   -> order_item_modifiers.modifier_id
-- and each of those is a live FK (order_items_product_id_fkey,
-- order_items_variant_id_fkey, order_item_modifiers_modifier_id_fkey). They are
-- ON DELETE SET NULL, which lets an administrator delete a row that historical
-- orders name, but SET NULL governs deleting the PARENT; it does not let a later
-- INSERT name a row that is already gone. So deleting a product, one of its
-- sizes or one option in that window makes the captured payment's finalize fail
-- with 23503. finalize has no exception handler and accepts an 'expired'
-- session on purpose, so every retry and every duplicate webhook fails the same
-- way: money captured, no order, and no refund path (order_refunds.order_id is
-- NOT NULL). Reproduced on the local chain before this file: product, size-only
-- and option-only deletes each fail finalize; `is_active = false` does not.
--
-- This is the same class 20260801120100 closed for addresses
-- (trg_addresses_guard_live_checkout), applied to the catalogue.
--
-- WHAT THIS FILE DOES
-- New objects only. It redefines NO existing function — in particular not
-- finalize_checkout_session, insert_order_from_snapshot or
-- compute_order_snapshot — and the closing block proves those, and
-- place_order, hash identically before and after.
--
--   1. checkout_snapshot_references_catalog(snapshot, table, id): does this
--      frozen cart name this catalogue row, in the exact key
--      insert_order_from_snapshot reads? Pure, immutable.
--   2. checkout_session_may_still_capture(session): can money still be taken
--      for this session and turned into an order? (predicate below)
--   3. guard_catalog_delete_open_checkout(): BEFORE DELETE OR UPDATE OF id,
--      FOR EACH ROW, on products, product_variants and modifiers. Raises 55006
--      while (1) and (2) hold for any session.
--
-- THE PREDICATE, DERIVED FROM THE REAL COLUMNS
-- A session can still become an order exactly when finalize accepts it:
--   order_id IS NULL AND status IN ('pending_payment', 'expired').
-- Money can still be captured for it when EITHER
--   (a) status = 'pending_payment' AND expires_at > now() — the customer can
--       still open a payment attempt (begin_session_attempt refuses anything
--       else), OR
--   (b) it has a payment attempt that is not settled — payment_records.status
--       IN ('initiated', 'authorized', 'failed') — whose invoice window closed
--       less than 24 hours ago (coalesce(expires_at, created_at + 60 min)).
--
-- Why (b) is wider than "a non-terminal attempt that has not expired":
-- payment-verify says so in as many words — "an expired attempt keeps its
-- invoice, and a payment made on it in time can settle late". An attempt is
-- marked 'failed'/'expired' LOCALLY by begin_session_attempt and
-- payment-verify without asking the provider, so a 'failed' row does not prove
-- the invoice was never paid; and a captured payment is finalized only when a
-- webhook or the customer's verify call arrives, which can be after the window.
-- The 24-hour grace bounds that: a delete is delayed by at most a day after an
-- abandoned checkout, which is the cheap side of the trade. 'paid' and
-- 'refunded' are excluded: a paid attempt on an unconsumed session cannot exist
-- (finalize is one transaction), and a refunded one has returned the money.
--
-- CASCADES ARE COVERED, AND WHY EACH ONE IS
--   * products -> product_variants is ON DELETE CASCADE. A snapshot line that
--     names a size also names its product, so the products trigger refuses
--     first; the product_variants trigger also fires on the cascaded delete.
--   * modifier_groups -> modifiers is ON DELETE CASCADE. Row triggers fire on
--     cascaded deletes, so deleting a whole option group is refused through the
--     modifiers trigger. This is why the guard is NOT exempted by role, unlike
--     the address guard: a cascaded delete runs as the table owner, so a
--     `current_user <> 'authenticated'` exemption would let a group delete
--     through. No server-side path deletes these rows today (no function body in
--     `public` does, and no Edge Function does), so nothing legitimate is
--     refused; a support delete waits for the checkout like the console does.
--   * categories -> products is ON DELETE RESTRICT (products_category_id_fkey),
--     so a category delete never removes a product and needs no guard.
--   * product_modifier_groups, branch_*_availability, loyalty_multipliers and
--     branch_availability_events carry no FK that an order line inserts, so
--     deleting them cannot break finalize.
--   * UPDATE OF id is guarded as well: it would strand the snapshot exactly as a
--     delete does. Any other UPDATE — `is_active = false` included — is not
--     affected; the paired suite proves deactivation still deletes nothing and
--     still finalizes.
--
-- NOT COVERED, STATED ON PURPOSE
--   * TRUNCATE fires no row trigger. TRUNCATE without CASCADE fails on the
--     order-line FKs whatever the grants, and TRUNCATE ... CASCADE would empty
--     order history itself, which is a different and much larger accident.
--   * The window between the trigger's read and the delete's commit is not
--     locked against a session opened concurrently by another transaction.
--     begin_checkout_session prices from the committed catalogue, so a cart can
--     only name a product that existed when it was priced; the remaining race
--     is a session priced in the same instant as the delete. It is narrower
--     than the 30-to-60 minute window this closes by several orders of
--     magnitude, and closing it needs a lock inside begin_checkout_session,
--     which this file is not allowed to redefine.
--
-- THE MESSAGE IS THE INSTRUCTION
-- The console shows only `error.message` (src/lib/api.ts wrapDelete ->
-- WriteErrorBanner), so the message itself tells the administrator what to do:
-- deactivate instead. 55006 object_in_use, not 23503, so the app can tell this
-- live, self-resolving condition from an unexpected constraint. English only,
-- like every other server error the staff console shows.
--
-- LIVE STEP IMPLIED: applying this file, named by version (20261021120000).
-- No function deploy, no build. Applying it changes no row.

-- ============================================================================
-- 0. Pre-images of the functions this file must not move
-- ============================================================================
do $pre$
declare
  v_name text;
  v_hash text;
begin
  foreach v_name in array array['finalize_checkout_session', 'insert_order_from_snapshot',
                                'compute_order_snapshot', 'place_order'] loop
    select string_agg(md5(pg_get_functiondef(p.oid)), ',' order by p.oid) into v_hash
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;
    if v_hash is null then
      raise exception 'PRE: public.% does not exist', v_name;
    end if;
    perform set_config('sma_20261021120000.' || v_name, v_hash, false);
  end loop;
end
$pre$;

-- ============================================================================
-- 1. Does a frozen cart name this catalogue row?
-- ============================================================================
create function public.checkout_snapshot_references_catalog(
  p_snapshot jsonb, p_table text, p_id uuid
) returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_vars jsonb := jsonb_build_object('id', p_id::text);
begin
  if p_snapshot is null or p_id is null then
    return false;
  end if;
  -- The keys are exactly the ones insert_order_from_snapshot casts into the
  -- order-line FKs. Lax jsonpath: a missing or non-array `items` is no match,
  -- never an error, so a malformed snapshot cannot make a delete raise 22xxx.
  case p_table
    when 'products' then
      return jsonb_path_exists(p_snapshot, '$.items[*] ? (@.product_id == $id)', v_vars);
    when 'product_variants' then
      return jsonb_path_exists(p_snapshot, '$.items[*] ? (@.variant_id == $id)', v_vars);
    when 'modifiers' then
      return jsonb_path_exists(p_snapshot, '$.items[*].modifiers[*] ? (@.modifier_id == $id)', v_vars);
    else
      raise exception 'checkout_snapshot_references_catalog: unsupported table %', p_table
        using errcode = '22023';
  end case;
end;
$$;

comment on function public.checkout_snapshot_references_catalog(jsonb, text, uuid) is
  'F-X03-001: true when a checkout snapshot names this product / size / option in the key insert_order_from_snapshot inserts as an order-line FK.';

-- ============================================================================
-- 2. Can money still be captured for this session and become an order?
-- ============================================================================
create function public.checkout_session_may_still_capture(p_session public.checkout_sessions)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_session.order_id is null
     and p_session.status in ('pending_payment', 'expired')
     and (
          (p_session.status = 'pending_payment' and p_session.expires_at > now())
       or exists (
            select 1
              from public.payment_records pr
             where pr.checkout_session_id = p_session.id
               and pr.status in ('initiated', 'authorized', 'failed')
               -- Late-settlement grace: see the header. 60 minutes is the
               -- longest invoice begin_session_attempt opens.
               and coalesce(pr.expires_at, pr.created_at + interval '60 minutes')
                     > now() - interval '24 hours'
          )
     );
$$;

comment on function public.checkout_session_may_still_capture(public.checkout_sessions) is
  'F-X03-001: true while finalize_checkout_session could still be called for a captured payment on this session (open window, or an unsettled attempt within 24 h of its invoice closing).';

-- ============================================================================
-- 3. The guard
-- ============================================================================
create function public.guard_catalog_delete_open_checkout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n     integer;
  v_what  text;
  v_how   text;
begin
  -- UPDATE OF id fires this too; an update that leaves the id alone is not a
  -- removal. (`UPDATE OF id` already limits it to statements naming the column.)
  if tg_op = 'UPDATE' and new.id is not distinct from old.id then
    return new;
  end if;

  -- SECURITY DEFINER: the caller is an administrator under RLS, and the
  -- sessions and attempts that matter belong to other people.
  select count(*) into v_n
    from public.checkout_sessions cs
   where cs.order_id is null
     and cs.status in ('pending_payment', 'expired')
     and public.checkout_snapshot_references_catalog(cs.snapshot, tg_table_name, old.id)
     and public.checkout_session_may_still_capture(cs);

  if v_n > 0 then
    v_what := case tg_table_name
                when 'products'         then 'This product'
                when 'product_variants' then 'This size'
                else                         'This option'
              end;
    v_how  := case tg_table_name
                when 'products'         then 'Deactivate the product instead (set it inactive, or switch it off in branch availability)'
                when 'product_variants' then 'Deactivate the size instead (set it inactive)'
                else                         'Deactivate the option instead (set it inactive)'
              end;
    raise exception
      using
        errcode = '55006',
        message = format(
          '%s cannot be deleted while a customer is paying for an order that contains it. %s: it leaves the menu straight away and the payment still becomes an order. It can be deleted once that checkout has finished.',
          v_what, v_how),
        detail  = format(
          '%s checkout session(s) whose payment can still be captured name %s %s. Deleting it now would capture a payment that cannot be turned into an order.',
          v_n, tg_table_name, old.id),
        hint    = 'A checkout stops blocking once it becomes an order, or its payment window has been closed for 24 hours. Deleting an option group or a product removes its options and sizes too, so the same guard applies.';
  end if;

  if tg_op = 'UPDATE' then
    return new;
  end if;
  return old;
end;
$$;

comment on function public.guard_catalog_delete_open_checkout() is
  'F-X03-001: refuses removing a product / size / option that a checkout whose payment can still be captured would insert as an order line.';

create trigger trg_products_guard_open_checkout
  before delete or update of id on public.products
  for each row execute function public.guard_catalog_delete_open_checkout();

create trigger trg_product_variants_guard_open_checkout
  before delete or update of id on public.product_variants
  for each row execute function public.guard_catalog_delete_open_checkout();

create trigger trg_modifiers_guard_open_checkout
  before delete or update of id on public.modifiers
  for each row execute function public.guard_catalog_delete_open_checkout();

-- ============================================================================
-- 4. Grants. This project's pg_default_acl grants EXECUTE on new functions in
--    `public` to anon and authenticated DIRECTLY, so `from public` alone would
--    leave them callable (CLAUDE.md §8). A trigger function needs no EXECUTE
--    grant to fire, and the helpers are called from inside a SECURITY DEFINER
--    body, i.e. as the owner.
-- ============================================================================
revoke all on function public.checkout_snapshot_references_catalog(jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.checkout_session_may_still_capture(public.checkout_sessions) from public, anon, authenticated;
revoke all on function public.guard_catalog_delete_open_checkout() from public, anon, authenticated;

-- ============================================================================
-- 5. Self-verification
-- ============================================================================
do $verify$
declare
  v_n     integer;
  v_name  text;
  v_hash  text;
  v_fn    text;
  v_snap  jsonb;
  v_p     uuid := gen_random_uuid();
  v_v     uuid := gen_random_uuid();
  v_m     uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_sess  public.checkout_sessions;
begin
  -- ---- Cardinality first: exactly one of each new function ----------------
  foreach v_name in array array['checkout_snapshot_references_catalog',
                                'checkout_session_may_still_capture',
                                'guard_catalog_delete_open_checkout'] loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;
    if v_n is distinct from 1 then
      raise exception 'VERIFY: expected exactly one public.%, found %', v_name, coalesce(v_n, -1);
    end if;
  end loop;

  -- ---- The three triggers: bound, enabled, BEFORE, ROW, DELETE + UPDATE OF id
  select count(*) into v_n from pg_trigger t
   where not t.tgisinternal and t.tgenabled <> 'D'
     and t.tgfoid = 'public.guard_catalog_delete_open_checkout()'::regprocedure
     and (   (t.tgname = 'trg_products_guard_open_checkout'         and t.tgrelid = 'public.products'::regclass)
          or (t.tgname = 'trg_product_variants_guard_open_checkout' and t.tgrelid = 'public.product_variants'::regclass)
          or (t.tgname = 'trg_modifiers_guard_open_checkout'        and t.tgrelid = 'public.modifiers'::regclass))
     and pg_get_triggerdef(t.oid) like '%BEFORE DELETE OR UPDATE OF id ON public.% FOR EACH ROW EXECUTE FUNCTION %guard_catalog_delete_open_checkout()';
  if v_n is distinct from 3 then
    raise exception 'VERIFY: expected the guard bound on products, product_variants and modifiers, found %', coalesce(v_n, -1);
  end if;

  -- ---- Every FK an order line inserts points at a guarded table ----------
  -- If a future migration adds an order-line FK to another catalogue table,
  -- this fails rather than leaving a new hole.
  select count(*) into v_n from pg_constraint c
   where c.contype = 'f'
     and c.conrelid in ('public.order_items'::regclass, 'public.order_item_modifiers'::regclass)
     and c.confrelid not in ('public.orders'::regclass, 'public.order_items'::regclass,
                             'public.products'::regclass, 'public.product_variants'::regclass,
                             'public.modifiers'::regclass);
  if v_n is distinct from 0 then
    raise exception 'VERIFY: % order-line FK(s) reference a catalogue table this guard does not cover', v_n;
  end if;
  -- ...and the one cascade INTO products that could bypass the products
  -- trigger is still RESTRICT.
  if (select c.confdeltype from pg_constraint c where c.conname = 'products_category_id_fkey'
        and c.conrelid = 'public.products'::regclass) is distinct from 'r' then
    raise exception 'VERIFY: products_category_id_fkey is no longer ON DELETE RESTRICT; a category delete would cascade past the guard';
  end if;

  -- ---- Security: definer, pinned search_path, no client EXECUTE ----------
  foreach v_fn in array array['public.checkout_session_may_still_capture(public.checkout_sessions)',
                              'public.guard_catalog_delete_open_checkout()'] loop
    if not (select p.prosecdef from pg_proc p where p.oid = v_fn::regprocedure) then
      raise exception 'VERIFY: % is not SECURITY DEFINER', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['public.checkout_snapshot_references_catalog(jsonb, text, uuid)',
                              'public.checkout_session_may_still_capture(public.checkout_sessions)',
                              'public.guard_catalog_delete_open_checkout()'] loop
    if not coalesce((select 'search_path=public, pg_temp' = any(p.proconfig) from pg_proc p where p.oid = v_fn::regprocedure), false) then
      raise exception 'VERIFY: % has no pinned search_path', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'VERIFY: anon can execute %', v_fn;
    end if;
    if has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'VERIFY: authenticated can execute %', v_fn;
    end if;
  end loop;

  -- ---- The matcher, called on synthetic snapshots (no write) -------------
  v_snap := jsonb_build_object('items', jsonb_build_array(
              jsonb_build_object('product_id', v_p, 'variant_id', v_v, 'quantity', 1,
                'modifiers', jsonb_build_array(jsonb_build_object('modifier_id', v_m)))));
  if public.checkout_snapshot_references_catalog(v_snap, 'products', v_p) is distinct from true
     or public.checkout_snapshot_references_catalog(v_snap, 'product_variants', v_v) is distinct from true
     or public.checkout_snapshot_references_catalog(v_snap, 'modifiers', v_m) is distinct from true then
    raise exception 'VERIFY: the matcher misses a product, size or option the snapshot names';
  end if;
  if public.checkout_snapshot_references_catalog(v_snap, 'products', v_other) is distinct from false
     or public.checkout_snapshot_references_catalog(v_snap, 'product_variants', v_p) is distinct from false
     or public.checkout_snapshot_references_catalog(v_snap, 'modifiers', v_p) is distinct from false
     or public.checkout_snapshot_references_catalog('{"items": "not-an-array"}'::jsonb, 'products', v_p) is distinct from false then
    raise exception 'VERIFY: the matcher reports a row the snapshot does not name';
  end if;

  -- ---- The window, called on in-memory session rows (no write) -----------
  -- A random id has no payment_records, so only arm (a) can answer true.
  v_sess := jsonb_populate_record(null::public.checkout_sessions, jsonb_build_object(
              'id', gen_random_uuid(), 'status', 'pending_payment',
              'expires_at', now() + interval '10 minutes'));
  if public.checkout_session_may_still_capture(v_sess) is distinct from true then
    raise exception 'VERIFY: an open pending_payment session is not treated as capturable';
  end if;
  v_sess.expires_at := now() - interval '1 minute';
  if public.checkout_session_may_still_capture(v_sess) is distinct from false then
    raise exception 'VERIFY: a lapsed session with no attempt is treated as capturable';
  end if;
  v_sess.expires_at := now() + interval '10 minutes';
  v_sess.order_id := gen_random_uuid();
  if public.checkout_session_may_still_capture(v_sess) is distinct from false then
    raise exception 'VERIFY: a session that already has an order is treated as capturable';
  end if;
  v_sess.order_id := null;
  v_sess.status := 'consumed';
  if public.checkout_session_may_still_capture(v_sess) is distinct from false then
    raise exception 'VERIFY: a consumed session is treated as capturable';
  end if;

  -- ---- Nothing this file must not touch moved ----------------------------
  foreach v_name in array array['finalize_checkout_session', 'insert_order_from_snapshot',
                                'compute_order_snapshot', 'place_order'] loop
    v_hash := nullif(current_setting('sma_20261021120000.' || v_name, true), '');
    if v_hash is null then
      raise exception 'VERIFY: the % pre-image was not recorded', v_name;
    end if;
    if (select string_agg(md5(pg_get_functiondef(p.oid)), ',' order by p.oid)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_name) is distinct from v_hash then
      raise exception 'VERIFY: public.% moved', v_name;
    end if;
  end loop;
end
$verify$;
