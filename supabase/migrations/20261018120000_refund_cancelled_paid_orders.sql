-- Spicy Meal — a cancelled paid card order is refunded automatically, in full
-- (card-payment gap PG-13; docs/OWNER_ACTIONS.md §47.20).
--
-- THE OWNER'S DECISION, 2026-11-19, in conversation: "do the auto refund". A
-- paid card order that is cancelled is refunded automatically, in full, by the
-- existing refund machinery. The hand procedure (refund it in Moyasar's
-- dashboard) is retired from the moment this file is applied. Duplicate
-- payments stay by hand (owner decision D2, 2026-11-17): this file does not
-- touch them.
--
-- WHAT WAS THERE, read on the default branch at db6aa8f:
--
--   * set_order_refund_enrollment (BEFORE INSERT OR UPDATE on orders) enrolled
--     a refund in one case only: order_refund_due(), "paid and provably never
--     reached the branch after the customer's three resends", and since
--     20261012120000 never for a cancelled order, because staff refunded those
--     by hand and an automatic refund on top would have been a second one.
--   * open_order_refund_record (AFTER INSERT OR UPDATE) opens one order_refunds
--     row when refund_state becomes 'pending', with reason
--     'pos_delivery_failed_after_customer_retries'.
--
-- WHAT CHANGES. Two function bodies. No signature, table, trigger, grant or
-- row:
--
--   1. set_order_refund_enrollment keeps its first branch exactly (asserted
--      below by content hash: with the new branch cut out, the body hashes as
--      the 20261012120000 body), and gains an ELSIF that enrols a refund when
--      ALL of these hold:
--        - the write is an UPDATE (an order INSERTED already cancelled is
--          never enrolled);
--        - the new row is cancelled and paid, and the old row was not both
--          (the write that MAKES it a cancelled paid order: the cancellation
--          of a paid order, or a captured payment confirmed onto an order
--          already cancelled; confirm_order_payment records any captured
--          payment, and writes its 'paid' payment_records row before the
--          order update, so the check below sees it). Any later write to a
--          cancelled paid order enrols nothing, so an order cancelled before
--          this file was applied is never enrolled: there is NO backfill;
--        - payment_method = 'online' (a cash order is never sent to Moyasar);
--        - total > 0 (a comped order paid nothing);
--        - refund_state = 'none' (an order already refunding, refunded or
--          failed is never enrolled again; refund_state is NOT NULL, default
--          'none', since 20260724120000);
--        - a payment_records row for the order has status 'paid' (an order
--          marked paid with no captured payment, or whose payment was already
--          recorded 'refunded', is never sent to Moyasar).
--      The trigger runs with the writer's rights. Every writer of orders is a
--      SECURITY DEFINER function (as owner) or service_role, both of which
--      read payment_records; anon and authenticated hold no UPDATE on orders,
--      and the block below asserts that, so the EXISTS cannot be blinded by
--      RLS.
--   2. open_order_refund_record records reason 'order_cancelled' when the
--      enrolled order is cancelled, and the existing reason otherwise.
--      Nothing else moves: the payment row chosen, the amount (the captured
--      payment's amount, so the refund is in full), the deterministic
--      idempotency key refund_<order id hex>, SECURITY DEFINER, search_path
--      and grants (asserted below by content hash, the reason expression put
--      back). order_refunds.reason has no CHECK and no enum.
--
--   enforce_refund_state_transition needs nothing: none -> pending is a
--   permitted transition, and it is a column-list trigger that the caller's
--   SET list (status) does not fire anyway.
--
-- AN ORDER ALREADY ENROLLED (the POS-failure path) and then cancelled keeps
-- its one refund and its original reason: its refund_state is no longer
-- 'none', so the new branch does not fire, and open_order_refund_record
-- returns early on pending -> pending. Two refunds for one order are excluded
-- three times over: refund_state, the deterministic idempotency key
-- (order_refunds_idem_uq) and order_refunds_one_active_uq.
--
-- WHAT THIS DOES NOT CHANGE, deliberately:
--
--   * order_refund_due: unchanged, and asserted unchanged (md5(prosrc) and
--     md5(pg_get_functiondef) read before and compared after). Its clause
--     sequence is pinned by
--     apps/mobile/src/features/orders/orderConfirmationSqlParity.test.ts.
--   * payment-refund (the worker), claim_order_refund, finalize_order_refund,
--     the back-off and cap, R14 REFUND_FAILED and R18 REFUND_STUCK: a refund
--     enrolled here is an ordinary order_refunds row to all of them.
--   * Duplicate payments (D2) and dashboard refund recording (PG-14).
--   * The customer app's copy. An order with refund_state 'pending' shows the
--     refund story ('final_failure_refund_pending'); see docs/PAYMENTS.md §6.
--   * MONEY PATH UNTOUCHED, and asserted before and after: place_order
--     12b6816d256c29b76edf947ae1a7ea77, compute_order_snapshot
--     22e2d42935459e7bf93abb2941b56325 (md5(pg_get_functiondef)).
--
-- PRE-IMAGES, md5(prosrc), with a content-hash fallback (comments and all
-- whitespace removed) for a live body trimmed of comments in transport:
--
--   set_order_refund_enrollment  9a4933ea83d69149b7f823ea6f412f66 (615 chars),
--                                content ad171355ac20a33fbf1e8823f36c51ec;
--                                the 20261012120000 body, live byte-identical
--                                (docs/MIGRATIONS.md §64 records the apply)
--   open_order_refund_record     140778650aaea14bd32d4e087ae68ad9 (1 139 chars),
--                                content f360a345632a726828394619365ae2f4;
--                                the 20261003120000 body
--
-- A re-apply is accepted: each guard also accepts this file's own body.
--
-- The new bodies carry NO comment line between their dollar quotes, so an
-- apply that trims comments for transport stores exactly this text, and the
-- post-apply hash is one value either way. Their explanation is here.
--
-- SELF-VERIFICATION, at the foot. Outcomes first: inside a sub-transaction
-- that is then aborted, it writes a probe branch, probe orders (explicit order
-- numbers, so no SM- number is drawn) and probe payment records, drives every
-- case above through the real triggers, and proves the rollback. Then the
-- stored text (comment-stripped, so a comment cannot satisfy it), the grants,
-- order_refund_due and the money path.
--
-- No deploy implied: payment-refund already executes any pending
-- order_refunds row. The refund job (payment-refund-worker) was switched on
-- 2026-11-19 04:47 UTC on the owner's approval, so once this file is applied
-- the next cancellation of a paid card order is refunded within about five
-- minutes. Apply by version, never as "the outstanding migrations" (CLAUDE.md
-- §8): an instruction that names no file is not an instruction to apply
-- anything.
--
-- NOT APPLIED TO PRODUCTION by this change.

-- ---------------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_n    integer;
  v_hash text;
  v_src  text;
  r      record;
begin
  -- The money-path pair, cardinality first: with two overloads the hash below
  -- would read an arbitrary one.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_n <> 1 then raise exception 'PRECONDITION: expected 1 place_order overload, found %', v_n; end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_n <> 1 then raise exception 'PRECONDITION: expected 1 compute_order_snapshot overload, found %', v_n; end if;

  select md5(pg_get_functiondef(p.oid)) into v_hash from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_hash is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'PRECONDITION: place_order hashes %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_hash, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_hash from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_hash is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'PRECONDITION: compute_order_snapshot hashes %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_hash, 'NULL');
  end if;

  -- order_refund_due is not replaced; remember exactly what it is, so the
  -- block at the foot can prove it did not move.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'order_refund_due';
  if v_n <> 1 then raise exception 'PRECONDITION: expected 1 order_refund_due overload, found %', v_n; end if;
  select md5(p.prosrc) || ':' || md5(pg_get_functiondef(p.oid)) into v_hash
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'order_refund_due';
  if v_hash is null then raise exception 'PRECONDITION: could not read order_refund_due'; end if;
  perform set_config('sma_20261018120000.order_refund_due', v_hash, false);

  -- Each replaced function: exactly one overload, and the pre-image this file
  -- was derived from (exact, or by content with comments and whitespace
  -- removed), or this file's own body (a statement only this file writes).
  for r in
    select * from (values
      ('set_order_refund_enrollment', '9a4933ea83d69149b7f823ea6f412f66', 'ad171355ac20a33fbf1e8823f36c51ec',
       'elsif tg_op = ''UPDATE'''),
      ('open_order_refund_record',    '140778650aaea14bd32d4e087ae68ad9', 'f360a345632a726828394619365ae2f4',
       'then ''order_cancelled''')
    ) as t(fn, pre, pre_content, marker)
  loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if v_n <> 1 then raise exception 'PRECONDITION: expected 1 % overload, found %', r.fn, v_n; end if;
    select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if md5(v_src) is distinct from r.pre
       and md5(regexp_replace(regexp_replace(coalesce(v_src, ''), '--[^\n]*', '', 'g'), '\s+', '', 'g')) is distinct from r.pre_content
       and position(r.marker in coalesce(v_src, '')) = 0 then
      raise exception 'PRECONDITION: % hashes % (md5(prosrc)); this file was derived from %. Re-derive it from the live body.',
        r.fn, md5(v_src), r.pre;
    end if;
  end loop;
end
$pre$;

-- ---------------------------------------------------------------------------
-- 1. set_order_refund_enrollment: a cancelled paid card order is enrolled
-- ---------------------------------------------------------------------------
-- The first branch is the 20261012120000 body, unchanged. The ELSIF is the
-- owner's 2026-11-19 decision; every clause is explained in the header.
create or replace function public.set_order_refund_enrollment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'cancelled'
     and public.order_refund_due(
       new.payment_status::text, new.lazywait_sync_state, new.lazywait_ref,
       new.sync_blocked_reason, new.pos_create_attempted_at,
       new.pos_customer_retry_count, new.refund_state, new.total) then
    new.refund_state       := 'pending';
    new.refund_required_at := coalesce(new.refund_required_at, now());
  elsif tg_op = 'UPDATE'
     and new.status = 'cancelled'
     and new.payment_status::text = 'paid'
     and not (old.status = 'cancelled' and old.payment_status::text = 'paid')
     and new.payment_method = 'online'
     and coalesce(new.total, 0) > 0
     and coalesce(new.refund_state, 'none') = 'none'
     and exists (select 1 from public.payment_records pr
                  where pr.order_id = new.id and pr.status = 'paid') then
    new.refund_state       := 'pending';
    new.refund_required_at := coalesce(new.refund_required_at, now());
  end if;
  return new;
end $$;
-- A trigger function cannot be called directly, and a trigger fires whether or
-- not the writing role holds EXECUTE, so no client role needs this grant.
-- `from public` alone is not enough here: this project's default ACL grants
-- EXECUTE to anon and authenticated directly.
revoke all on function public.set_order_refund_enrollment() from public, anon, authenticated;
comment on function public.set_order_refund_enrollment() is
  'BEFORE trigger on orders: enrols the automatic refund when order_refund_due() holds for an order that is not cancelled (20260724120000, 20261012120000), and, since 20261018120000, when an UPDATE makes an online order cancelled and paid with a paid payment_records row, a total above zero and no refund yet (the owner''s 2026-11-19 decision). Never on INSERT of a cancelled order, never again for an order already cancelled and paid. Fires whatever role writes the row.';

-- ---------------------------------------------------------------------------
-- 2. open_order_refund_record: a distinct reason for a cancellation refund
-- ---------------------------------------------------------------------------
-- The 20261003120000 body with the reason literal replaced by a CASE, and its
-- comment lines moved out (see the header). The AFTER trigger
-- open_orders_refund_record keeps binding to this function; `create or
-- replace` does not detach it.
create or replace function public.open_order_refund_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payment_records;
begin
  if new.refund_state <> 'pending' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.refund_state = 'pending' then
    return null;
  end if;

  select * into v_pay from public.payment_records
   where order_id = new.id and status = 'paid'
   order by confirmed_at nulls last, created_at desc
   limit 1;

  insert into public.order_refunds (
    order_id, payment_record_id, provider, charge_ref, idempotency_key,
    amount, currency, status, reason
  ) values (
    new.id, v_pay.id, coalesce(v_pay.provider, new.payment_provider, 'moyasar'),
    v_pay.provider_ref,
    'refund_' || replace(new.id::text, '-', ''),
    coalesce(v_pay.amount, new.total), coalesce(v_pay.currency, 'SAR'),
    'pending', case when new.status = 'cancelled' then 'order_cancelled' else 'pos_delivery_failed_after_customer_retries' end
  )
  on conflict do nothing;

  return null;
end $$;

revoke execute on function public.open_order_refund_record() from public, anon, authenticated;
grant execute on function public.open_order_refund_record() to service_role;
comment on function public.open_order_refund_record() is
  'AFTER trigger on orders: opens the one order_refunds row for a freshly enrolled refund (refund_state none/failed -> pending), choosing the paid payment_records row, its amount, and the deterministic idempotency key refund_<order id hex>. Reason order_cancelled for a cancelled order (since 20261018120000), otherwise pos_delivery_failed_after_customer_retries. Service role only.';

-- ---------------------------------------------------------------------------
-- 3. Self-verification: outcomes first, then the stored text, grants,
--    order_refund_due and the money path. Every outcome is read back as a
--    value, never a notice.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_tag     constant text := 'VERIFY-20261018120000-';
  v_branch  uuid := gen_random_uuid();
  v_card    uuid := gen_random_uuid();   -- paid card order, cancelled: enrolled
  v_cash    uuid := gen_random_uuid();   -- cash, paid, cancelled: not
  v_unpaid  uuid := gen_random_uuid();   -- online, unpaid, cancelled: not
  v_comp    uuid := gen_random_uuid();   -- online, paid, total 0, cancelled: not
  v_norec   uuid := gen_random_uuid();   -- online, paid, no paid payment row: not
  v_done    uuid := gen_random_uuid();   -- online, paid, already refunded: not
  v_old     uuid := gen_random_uuid();   -- inserted cancelled and paid: never
  v_late    uuid := gen_random_uuid();   -- cancelled, then a captured payment: enrolled
  v_pos     uuid := gen_random_uuid();   -- POS-failure refund, then cancelled
  v_id      uuid;
  v_n       integer;
  v_state   text;
  v_hash    text;
  v_src     text;
  v_norm    text;
  o         public.orders;
  rf        public.order_refunds;
  r         record;
begin
  -- ---- Behaviour, in a sub-transaction that the final raise aborts --------
  begin
    insert into public.branches (id, name_en, name_ar) values (v_branch, v_tag || 'branch', v_tag || 'branch');

    -- Explicit order numbers, so set_order_number draws nothing from the
    -- SM- sequence.
    insert into public.orders (id, order_number, branch_id, order_type, status, subtotal, total,
                               payment_method, payment_status, refund_state)
    values
      (v_card,   v_tag || 'card',   v_branch, 'pickup',   'received',  10, 10, 'online', 'paid',    'none'),
      (v_cash,   v_tag || 'cash',   v_branch, 'pickup',   'received',  10, 10, 'cash',   'paid',    'none'),
      (v_unpaid, v_tag || 'unpaid', v_branch, 'pickup',   'received',  10, 10, 'online', 'pending', 'none'),
      (v_comp,   v_tag || 'comp',   v_branch, 'pickup',   'received',   0,  0, 'online', 'paid',    'none'),
      (v_norec,  v_tag || 'norec',  v_branch, 'delivery', 'preparing', 10, 10, 'online', 'paid',    'none'),
      (v_done,   v_tag || 'done',   v_branch, 'pickup',   'ready',     10, 10, 'online', 'paid',    'refunded'),
      (v_old,    v_tag || 'old',    v_branch, 'pickup',   'cancelled', 10, 10, 'online', 'paid',    'none'),
      (v_late,   v_tag || 'late',   v_branch, 'pickup',   'received',  10, 10, 'online', 'pending', 'none'),
      (v_pos,    v_tag || 'pos',    v_branch, 'pickup',   'received',  10, 10, 'online', 'paid',    'none');

    insert into public.payment_records (order_id, provider, provider_ref, status, amount, currency, mode, confirmed_at)
    values
      (v_card, 'moyasar', v_tag || 'pay-card', 'paid',    10, 'SAR', 'test', now()),
      (v_cash, 'moyasar', v_tag || 'pay-cash', 'paid',    10, 'SAR', 'test', now()),
      (v_comp, 'moyasar', v_tag || 'pay-comp', 'paid',     0, 'SAR', 'test', now()),
      (v_norec,'moyasar', v_tag || 'pay-norec','failed',  10, 'SAR', 'test', null),
      (v_done, 'moyasar', v_tag || 'pay-done', 'paid',    10, 'SAR', 'test', now()),
      (v_old,  'moyasar', v_tag || 'pay-old',  'paid',    10, 'SAR', 'test', now()),
      (v_pos,  'moyasar', v_tag || 'pay-pos',  'paid',    10, 'SAR', 'test', now());

    if exists (select 1 from public.order_refunds where order_id in
                 (v_card, v_cash, v_unpaid, v_comp, v_norec, v_done, v_old, v_late, v_pos)) then
      raise exception 'VERIFY: a probe order was enrolled before anything was cancelled';
    end if;
    if (select refund_state from public.orders where id = v_old) is distinct from 'none' then
      raise exception 'VERIFY: an order inserted already cancelled and paid was enrolled';
    end if;

    -- (a) The POS-failure path first, so it is enrolled with its own reason.
    update public.orders set lazywait_sync_state = 'dead_letter', pos_customer_retry_count = 3,
                             lazywait_ref = null, pos_create_attempted_at = null
     where id = v_pos;
    select * into o from public.orders where id = v_pos;
    if o.refund_state is distinct from 'pending' then
      raise exception 'VERIFY: the POS-failure path no longer enrols a paid order (% / %)', o.lazywait_sync_state, o.refund_state;
    end if;

    -- (b) Cancel all of them, the way admin_set_order_status does.
    update public.orders set status = 'cancelled', updated_at = now()
     where id in (v_card, v_cash, v_unpaid, v_comp, v_norec, v_done, v_late, v_pos);
    -- A later write to each, and to the order inserted cancelled.
    update public.orders set notes = 'later edit'
     where id in (v_card, v_cash, v_unpaid, v_comp, v_norec, v_done, v_old, v_late, v_pos);

    select * into o from public.orders where id = v_card;
    select count(*) into v_n from public.order_refunds where order_id = v_card;
    select * into rf from public.order_refunds where order_id = v_card;
    if o.refund_state is distinct from 'pending' or o.refund_required_at is null then
      raise exception 'VERIFY: a cancelled paid card order was not enrolled (%)', coalesce(o.refund_state, '<null>');
    end if;
    if v_n <> 1 or rf.reason is distinct from 'order_cancelled' or rf.amount is distinct from 10.00::numeric
       or rf.status is distinct from 'pending' or rf.provider is distinct from 'moyasar'
       or rf.charge_ref is distinct from v_tag || 'pay-card'
       or rf.idempotency_key is distinct from 'refund_' || replace(v_card::text, '-', '') then
      raise exception 'VERIFY: the cancellation refund row is wrong (rows %, reason %, amount %, status %)',
        v_n, rf.reason, rf.amount, rf.status;
    end if;

    foreach v_id in array array[v_cash, v_unpaid, v_comp, v_norec, v_old] loop
      select refund_state into v_state from public.orders where id = v_id;
      if v_state is distinct from 'none'
         or exists (select 1 from public.order_refunds where order_id = v_id) then
        raise exception 'VERIFY: order % was enrolled for a refund it must not get (%)',
          (select order_number from public.orders where id = v_id), coalesce(v_state, '<null>');
      end if;
    end loop;

    if (select refund_state from public.orders where id = v_done) is distinct from 'refunded'
       or exists (select 1 from public.order_refunds where order_id = v_done) then
      raise exception 'VERIFY: an order already refunded was enrolled again';
    end if;

    select count(*) into v_n from public.order_refunds where order_id = v_pos;
    select * into rf from public.order_refunds where order_id = v_pos;
    if v_n <> 1 or rf.reason is distinct from 'pos_delivery_failed_after_customer_retries' then
      raise exception 'VERIFY: cancelling an order already refunding changed its refund (rows %, reason %)', v_n, rf.reason;
    end if;

    -- (c) A captured payment confirmed onto an order already cancelled.
    if (select refund_state from public.orders where id = v_late) is distinct from 'none' then
      raise exception 'VERIFY: an unpaid cancelled order was enrolled';
    end if;
    insert into public.payment_records (order_id, provider, provider_ref, status, amount, currency, mode, confirmed_at)
    values (v_late, 'moyasar', v_tag || 'pay-late', 'paid', 10, 'SAR', 'test', now());
    update public.orders set payment_status = 'paid', payment_provider = 'moyasar', paid_at = now(), updated_at = now()
     where id = v_late;
    select count(*) into v_n from public.order_refunds where order_id = v_late and reason = 'order_cancelled';
    if (select refund_state from public.orders where id = v_late) is distinct from 'pending' or v_n <> 1 then
      raise exception 'VERIFY: a payment captured after the cancellation was not refunded (rows %)', v_n;
    end if;

    raise exception 'ROLLBACK_PROBE_20261018120000';
  exception when others then
    if sqlerrm is distinct from 'ROLLBACK_PROBE_20261018120000' then raise; end if;
  end;

  -- The probe is evidence only if the rollback is proven, not assumed.
  if exists (select 1 from public.orders where order_number like v_tag || '%')
     or exists (select 1 from public.branches where id = v_branch)
     or exists (select 1 from public.payment_records where provider_ref like v_tag || '%')
     or exists (select 1 from public.order_refunds where order_id in
                  (v_card, v_cash, v_unpaid, v_comp, v_norec, v_done, v_old, v_late, v_pos)) then
    raise exception 'VERIFY: a probe row survived the sub-transaction';
  end if;

  -- ---- The stored text, comment-stripped so a comment cannot satisfy it ----
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_order_refund_enrollment', 'open_order_refund_record');
  if v_n <> 2 then raise exception 'VERIFY: expected one overload of each trigger function, found %', v_n; end if;

  select regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', '', 'g') into v_norm
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_order_refund_enrollment';
  for r in
    select * from (values
      ('elsiftg_op=''UPDATE'''),
      ('andnew.status=''cancelled'''),
      ('andnew.payment_status::text=''paid'''),
      ('andnot(old.status=''cancelled''andold.payment_status::text=''paid'')'),
      ('andnew.payment_method=''online'''),
      ('andcoalesce(new.total,0)>0'),
      ('andcoalesce(new.refund_state,''none'')=''none'''),
      ('andexists(select1frompublic.payment_recordsprwherepr.order_id=new.idandpr.status=''paid'')then')
    ) as t(clause)
  loop
    if position(r.clause in coalesce(v_norm, '')) = 0 then
      raise exception 'VERIFY: set_order_refund_enrollment lost the clause %', r.clause;
    end if;
  end loop;
  -- With the new branch cut out, the body is the 20261012120000 body.
  if md5(regexp_replace(v_norm, 'elsiftg_op=.*?(endif;returnnew;)', '\1')) is distinct from 'ad171355ac20a33fbf1e8823f36c51ec' then
    raise exception 'VERIFY: set_order_refund_enrollment changed outside its cancellation branch';
  end if;

  select regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', '', 'g') into v_norm
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'open_order_refund_record';
  if position('''pending'',casewhennew.status=''cancelled''then''order_cancelled''else''pos_delivery_failed_after_customer_retries''end' in coalesce(v_norm, '')) = 0 then
    raise exception 'VERIFY: open_order_refund_record does not record order_cancelled for a cancelled order';
  end if;
  -- With the old literal put back, the body is the 20261003120000 body.
  if md5(replace(v_norm,
                 'casewhennew.status=''cancelled''then''order_cancelled''else''pos_delivery_failed_after_customer_retries''end',
                 '''pos_delivery_failed_after_customer_retries''')) is distinct from 'f360a345632a726828394619365ae2f4' then
    raise exception 'VERIFY: open_order_refund_record changed outside its reason';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'open_order_refund_record'
                    and p.prosecdef and p.proconfig = array['search_path=public']) then
    raise exception 'VERIFY: open_order_refund_record is no longer SECURITY DEFINER with search_path=public';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'set_order_refund_enrollment' and p.prosecdef) then
    raise exception 'VERIFY: set_order_refund_enrollment became SECURITY DEFINER';
  end if;

  -- ---- Both triggers still bound as before --------------------------------
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'public.orders'::regclass and not t.tgisinternal and t.tgenabled <> 'D'
         and ((t.tgname = 'set_orders_refund_enrollment'
               and t.tgfoid = 'public.set_order_refund_enrollment()'::regprocedure
               and pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW%')
           or (t.tgname = 'open_orders_refund_record'
               and t.tgfoid = 'public.open_order_refund_record()'::regprocedure
               and pg_get_triggerdef(t.oid) like '%AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW%'))) <> 2 then
    raise exception 'VERIFY: the two refund triggers on orders are not bound as before';
  end if;

  -- ---- Grants -------------------------------------------------------------
  foreach v_src in array array['public.set_order_refund_enrollment()', 'public.open_order_refund_record()'] loop
    if has_function_privilege('anon', v_src, 'execute') then
      raise exception 'VERIFY: anon can execute %', v_src;
    end if;
    if has_function_privilege('authenticated', v_src, 'execute') then
      raise exception 'VERIFY: authenticated can execute %', v_src;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.open_order_refund_record()', 'execute') then
    raise exception 'VERIFY: service_role lost EXECUTE on open_order_refund_record()';
  end if;
  -- The enrolment trigger runs with the writer's rights and reads
  -- payment_records. No client role may write orders directly, so every
  -- writer is the owner or service_role.
  if has_table_privilege('anon', 'public.orders', 'update')
     or has_table_privilege('authenticated', 'public.orders', 'update')
     or has_any_column_privilege('anon', 'public.orders', 'update')
     or has_any_column_privilege('authenticated', 'public.orders', 'update') then
    raise exception 'VERIFY: a client role can UPDATE orders directly';
  end if;

  -- ---- order_refund_due did not move ---------------------------------------
  v_hash := nullif(current_setting('sma_20261018120000.order_refund_due', true), '');
  if v_hash is null then
    raise exception 'VERIFY: the order_refund_due pre-image was not recorded';
  end if;
  if (select md5(p.prosrc) || ':' || md5(pg_get_functiondef(p.oid))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'order_refund_due') is distinct from v_hash then
    raise exception 'VERIFY: order_refund_due moved';
  end if;

  -- ---- The money path, one overload each first ----------------------------
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('place_order', 'compute_order_snapshot');
  if v_n <> 2 then raise exception 'VERIFY: expected one place_order and one compute_order_snapshot, found % functions', v_n; end if;
  select md5(pg_get_functiondef(p.oid)) into v_hash from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_hash is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'VERIFY: place_order moved to %', coalesce(v_hash, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_hash from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_hash is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'VERIFY: compute_order_snapshot moved to %', coalesce(v_hash, 'NULL');
  end if;
end
$verify$;
