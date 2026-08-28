-- ============================================================================
-- Customer order-confirmation state machine + automatic refunds
-- (migration 20260724120000_order_confirmation_state_machine).
--
-- Runs against a throwaway Postgres with all migrations applied. Transactional
-- (begin; … rollback;); each case RAISES on failure. is_admin()/auth.uid() are
-- stubbed via the test.* GUCs in the throwaway bootstrap.
--
-- Invariants under test:
--   A. "Order placed" is impossible while the branch has not confirmed —
--      confirmed_by_branch requires 'synced' AND a USABLE reference.
--   B. An AMBIGUOUS outcome is never confirmed, never failed, never resendable
--      and never refunded (Create Order has no idempotency key).
--   C. A channel with no branch step (delivery today) is never marked unconfirmed
--      and never auto-refunded.
--   D. The manual resend is server-counted, proven-not-sent only, owner-scoped,
--      and discloses neither the reason nor the budget.
--   E. A refund is opened at most ONCE per order, only from a proven non-delivery
--      of a PAID order, and only advances through legal transitions.
--
-- PARITY: the derivation cases below mirror
-- apps/mobile/src/features/orders/orderConfirmation.test.ts. Change both together.
--
-- "Change both together" is a request, not a control, and on its own it failed
-- twice in silence — these two suites run in different jobs against different
-- artifacts, so neither can contradict the other into a red build, and a
-- TypeScript-only diff does not run this file at all. Since 2026-08-28 the
-- actual control is apps/mobile/src/features/orders/orderConfirmationSqlParity.test.ts,
-- which reads the migration's CASE body from the always-run vitest suite. Add
-- cases here for coverage; rely on that file for enforcement.
-- ============================================================================
begin;


-- A branch to hang test orders on: orders.branch_id is a real FK. These cases
-- are about confirmation / refund state, not about which branch.
insert into public.branches (id, name_en, name_ar)
values ('b0000000-0000-0000-0000-0000000000ff', 'Suite Branch', 'فرع الاختبار')
on conflict (id) do nothing;

select set_config('test.is_admin', 'true', true);
select set_config('test.auth_uid', '', true);

-- ---- A/B/C. customer_order_state(): the pure derivation ---------------------
-- Argument order: order_type, payment_method, payment_status, sync_state, ref,
-- blocked_reason, next_attempt_at, marker_at, retry_count, refund_state.
create function pg_temp.st(
  p_method text, p_pay text, p_state text, p_ref text,
  p_blocked text default null, p_next timestamptz default null,
  p_marker timestamptz default null, p_retries integer default 0,
  p_refund text default 'none', p_type text default 'pickup'
) returns text language sql as $$
  select public.customer_order_state(
    p_type, p_method, p_pay, p_state, p_ref, p_blocked, p_next, p_marker, p_retries, p_refund);
$$;

create function pg_temp.expect_state(p_actual text, p_expected text, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'STATE FAILED (%): expected %, got %', p_label, p_expected, p_actual;
  end if;
end $$;

do $$
begin
  -- (A) Confirmation requires 'synced' AND a usable reference.
  perform pg_temp.expect_state(pg_temp.st('online','paid','synced','#42'),
    'confirmed_by_branch', 'synced with usable ref');
  perform pg_temp.expect_state(pg_temp.st('online','paid','synced',null),
    'verifying_with_branch', 'synced without ref is NOT confirmed');
  perform pg_temp.expect_state(pg_temp.st('online','paid','synced','   '),
    'verifying_with_branch', 'synced with blank ref is NOT confirmed');
  -- Unicode whitespace / BOM are trimmed identically to JS .trim().
  perform pg_temp.expect_state(pg_temp.st('online','paid','synced',chr(160)),
    'verifying_with_branch', 'synced with nbsp ref is NOT confirmed');
  perform pg_temp.expect_state(pg_temp.st('online','paid','synced',chr(65279)),
    'verifying_with_branch', 'synced with BOM ref is NOT confirmed');

  -- Payment gate: an unverified online payment never shows an order state.
  perform pg_temp.expect_state(pg_temp.st('online','pending','pending',null),
    'payment_pending', 'unpaid online');
  perform pg_temp.expect_state(pg_temp.st('online','pending','synced','#42'),
    'payment_pending', 'payment gate precedes branch confirmation');

  -- An in-flight send is "sending", not a failure. NOTHING is auto-retrying
  -- any more — see the legacy-retry-time case below, which asserts the opposite
  -- of what this heading said until 2026-08-28.
  perform pg_temp.expect_state(pg_temp.st('cash','pending','pending',null),
    'sending_to_branch', 'cash pending');
  perform pg_temp.expect_state(pg_temp.st('online','paid','syncing',null),
    'sending_to_branch', 'syncing');
  -- The IN-FLIGHT case, and the one that was missing. pos_create_attempted_at is
  -- stamped immediately BEFORE the POST leaves, so `syncing` + marker is the
  -- normal window of every order, not an anomaly. The only `syncing` case here
  -- used to leave p_marker at its NULL default, so the shape that actually
  -- reaches a customer went untested and the SQL disagreed with the TypeScript
  -- mirror for it — showing "we could not verify whether the branch received
  -- this order" on a healthy order (SM-2026-000070, ticket #2 in 7.30 s).
  perform pg_temp.expect_state(
    pg_temp.st('online','paid','syncing',null,null,null,now()-interval '5s'),
    'sending_to_branch', 'in-flight send is not ambiguous');
  -- A FAILED row with a future sync_next_attempt_at is NOT "still trying". The
  -- manual-resend-only policy (20260813143000) removed automatic retries and the
  -- column is legacy data. This asserted 'sending_to_branch' until 2026-08-28
  -- while the TypeScript mirror asserted 'branch_failed_retry_available' for the
  -- same input — both suites green, because nothing compared them.
  perform pg_temp.expect_state(
    pg_temp.st('online','paid','failed',null,null,now()+interval '1m'),
    'branch_failed_retry_available', 'legacy future retry time is ignored');

  -- (B) Every ambiguous shape routes to verification.
  perform pg_temp.expect_state(pg_temp.st('online','paid','confirmation_required',null),
    'verifying_with_branch', 'confirmation_required');
  perform pg_temp.expect_state(pg_temp.st('online','paid','dead_letter','  '),
    'verifying_with_branch', 'unusable ref marker on a failed row');
  perform pg_temp.expect_state(
    pg_temp.st('online','paid','dead_letter',null,null,null,now()-interval '1m'),
    'verifying_with_branch', 'may-have-been-sent marker');
  -- A marker that OUTLIVED its send stays ambiguous on every non-syncing state:
  -- the POST left and we never learned its fate. Only the in-flight case moved.
  perform pg_temp.expect_state(
    pg_temp.st('online','paid','pending',null,null,null,now()-interval '1m'),
    'verifying_with_branch', 'marker outlived the send (pending)');
  perform pg_temp.expect_state(
    pg_temp.st('online','paid','failed',null,null,null,now()-interval '1m'),
    'verifying_with_branch', 'marker outlived the send (failed)');
  -- A syncing row that ALREADY holds a ref is ambiguous: the ref test must stay
  -- ahead of the in-flight test.
  perform pg_temp.expect_state(
    pg_temp.st('online','paid','syncing','#5',null,null,now()-interval '5s'),
    'verifying_with_branch', 'syncing with a ref is still ambiguous');
  -- Ambiguity outranks the retry budget: an ambiguous order must NEVER fall
  -- through to a final failure, because that would auto-refund an order the
  -- branch may have accepted.
  perform pg_temp.expect_state(
    pg_temp.st('online','paid','confirmation_required',null,null,null,null,9),
    'verifying_with_branch', 'ambiguous with budget spent');

  -- (D) Proven-not-sent: resend offered while the budget lasts.
  perform pg_temp.expect_state(
    pg_temp.st('online','paid','failed',null,null,now()-interval '1m'),
    'branch_failed_retry_available', 'paid, overdue retry');
  perform pg_temp.expect_state(pg_temp.st('online','paid','dead_letter',null),
    'branch_failed_retry_available', 'paid, dead_letter');
  perform pg_temp.expect_state(pg_temp.st('cash','pending','dead_letter',null),
    'unpaid_branch_failed_retry_available', 'cash, dead_letter');
  perform pg_temp.expect_state(
    pg_temp.st('online','paid','dead_letter',null,null,null,null,2),
    'branch_failed_retry_available', 'paid, 2 of 3 used');

  -- Budget spent: paid -> refund story, unpaid -> apology with no refund language.
  perform pg_temp.expect_state(
    pg_temp.st('online','paid','dead_letter',null,null,null,null,3),
    'final_failure_refund_pending', 'paid, budget spent');
  perform pg_temp.expect_state(
    pg_temp.st('cash','pending','dead_letter',null,null,null,null,3),
    'unpaid_final_failure', 'cash, budget spent');

  -- Refund lifecycle is reported honestly and never prematurely.
  perform pg_temp.expect_state(
    pg_temp.st('online','paid','dead_letter',null,null,null,null,3,'processing'),
    'final_failure_refund_pending', 'refund processing');
  perform pg_temp.expect_state(
    pg_temp.st('online','paid','dead_letter',null,null,null,null,3,'refunded'),
    'final_failure_refunded', 'refund confirmed');
  perform pg_temp.expect_state(
    pg_temp.st('online','paid','dead_letter',null,null,null,null,3,'failed'),
    'final_failure_refund_failed', 'refund failed');

  -- (C) A channel with no branch step is settled, never unconfirmed. Split by
  --     payment so the copy can state payment success without implying branch
  --     acceptance; a cash-on-delivery order must make NO payment claim.
  perform pg_temp.expect_state(
    pg_temp.st('online','paid','blocked',null,'delivery_schema_unconfirmed',null,null,9,'none','delivery'),
    'accepted_no_pos_channel', 'PAID delivery is not gated on Lazywait');
  perform pg_temp.expect_state(
    pg_temp.st('cash','pending','blocked',null,'delivery_schema_unconfirmed',null,null,0,'none','delivery'),
    'accepted_no_pos_channel_unpaid', 'CASH delivery makes no payment claim');
  perform pg_temp.expect_state(pg_temp.st('cash','pending','skipped',null),
    'accepted_no_pos_channel_unpaid', 'pre-integration unpaid row');
  perform pg_temp.expect_state(pg_temp.st('online','paid','skipped',null),
    'accepted_no_pos_channel', 'pre-integration paid row');
  -- ...but a 'blocked' order whose reason is a REAL POS rejection stays gated.
  perform pg_temp.expect_state(pg_temp.st('online','paid','blocked',null,'invalid_license'),
    'branch_failed_retry_available', 'blocked by a real POS rejection');

  raise notice 'DERIVATION OK';
end $$;

-- ---- D. customer_pos_resend_eligibility(): proven-not-sent only -------------
do $$
declare
  function_result text;
begin
  -- Signature: sync_state, ref, blocked_reason, next_attempt_at, marker_at,
  --            retry_count, payment_method, payment_status, refund_state.
  if public.customer_pos_resend_eligibility('dead_letter',null,null,null,null,0,'online','paid','none') <> 'eligible' then
    raise exception 'ELIG FAILED: proven-not-sent paid order should be eligible'; end if;
  if public.customer_pos_resend_eligibility('failed',null,null,now()-interval '1m',null,0,'cash','pending','none') <> 'eligible' then
    raise exception 'ELIG FAILED: overdue cash failure should be eligible'; end if;

  -- Unsafe shapes are rejected for the UNSAFE reason, ahead of the budget check,
  -- so an ambiguous order is never mistaken for a merely exhausted one.
  if public.customer_pos_resend_eligibility('dead_letter','REF',null,null,null,0,'online','paid','none') <> 'ref_present' then
    raise exception 'ELIG FAILED: usable ref must block resend'; end if;
  if public.customer_pos_resend_eligibility('dead_letter','   ',null,null,null,0,'online','paid','none') <> 'ref_present' then
    raise exception 'ELIG FAILED: ANY ref marker must block resend'; end if;
  if public.customer_pos_resend_eligibility('synced',null,null,null,null,0,'online','paid','none') <> 'ref_present' then
    raise exception 'ELIG FAILED: synced must block resend'; end if;
  if public.customer_pos_resend_eligibility('confirmation_required',null,null,null,null,0,'online','paid','none') <> 'verification_required' then
    raise exception 'ELIG FAILED: ambiguous must block resend'; end if;
  if public.customer_pos_resend_eligibility('dead_letter',null,null,null,now(),0,'online','paid','none') <> 'may_have_sent' then
    raise exception 'ELIG FAILED: phase marker must block resend'; end if;
  if public.customer_pos_resend_eligibility('confirmation_required',null,null,null,null,9,'online','paid','none') <> 'verification_required' then
    raise exception 'ELIG FAILED: ambiguity must outrank the budget'; end if;

  -- Not-yet-actionable and not-applicable shapes.
  if public.customer_pos_resend_eligibility('pending',null,null,null,null,0,'online','paid','none') <> 'not_failed' then
    raise exception 'ELIG FAILED: in-flight order is not resendable'; end if;
  if public.customer_pos_resend_eligibility('failed',null,null,now()+interval '1m',null,0,'online','paid','none') <> 'auto_retry_pending' then
    raise exception 'ELIG FAILED: queued auto-retry is not resendable'; end if;
  if public.customer_pos_resend_eligibility('blocked',null,'delivery_schema_unconfirmed',null,null,0,'online','paid','none') <> 'not_applicable' then
    raise exception 'ELIG FAILED: no-POS-channel order is not resendable'; end if;
  if public.customer_pos_resend_eligibility('dead_letter',null,null,null,null,0,'online','pending','none') <> 'not_paid' then
    raise exception 'ELIG FAILED: unpaid online order must not be pushed'; end if;
  if public.customer_pos_resend_eligibility('dead_letter',null,null,null,null,0,'online','paid','pending') <> 'refund_in_progress' then
    raise exception 'ELIG FAILED: refunding order is closed to resends'; end if;

  -- The budget, checked LAST.
  if public.customer_pos_resend_eligibility('dead_letter',null,null,null,null,3,'online','paid','none') <> 'attempt_limit_reached' then
    raise exception 'ELIG FAILED: budget ceiling'; end if;

  raise notice 'ELIGIBILITY OK';
end $$;

-- ---- D. request_customer_pos_resend(): the customer action ------------------
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_ok    uuid := gen_random_uuid();   -- proven-not-sent, resendable
  v_amb   uuid := gen_random_uuid();   -- ambiguous, never resendable
  v_notmine uuid := gen_random_uuid(); -- owned by someone else
  v_res   jsonb;
  v_count integer;
  v_deadline_before timestamptz;
  v_deadline_after  timestamptz;
  v_state text;
  i integer;
begin
  -- orders.customer_id references profiles(id), which references
  -- auth.users(id). Create the auth user; handle_new_user() makes the profile.
  insert into auth.users (id) values (v_owner) on conflict (id) do nothing;
  -- FK checks are disabled for the fixture inserts (throwaway DB), so the orders
  -- can carry synthetic customer/branch ids without seeding profiles or branches.
  set local session_replication_role = replica;
  insert into public.orders (id, customer_id, order_number, branch_id, order_type,
    subtotal, total, payment_method, payment_status, lazywait_sync_state,
    lazywait_ref, pos_create_attempted_at, pos_sync_started_at, pos_sync_deadline_at,
    pos_customer_retry_count) values
    (v_ok,      v_owner, 'CS-1', 'b0000000-0000-0000-0000-0000000000ff', 'pickup', 50, 50, 'online', 'paid',
     'dead_letter', null, null, now()-interval '11m', now()-interval '1m', 0),
    (v_amb,     v_owner, 'CS-2', 'b0000000-0000-0000-0000-0000000000ff', 'pickup', 50, 50, 'online', 'paid',
     'confirmation_required', null, now()-interval '5m', now()-interval '11m', now()-interval '1m', 0),
    (v_notmine, v_other, 'CS-3', 'b0000000-0000-0000-0000-0000000000ff', 'pickup', 50, 50, 'online', 'paid',
     'dead_letter', null, null, now()-interval '11m', now()-interval '1m', 0);
  set local session_replication_role = origin;

  perform set_config('test.auth_uid', v_owner::text, true);

  -- Another customer's order is indistinguishable from a missing one.
  begin
    perform public.request_customer_pos_resend(v_notmine);
    raise exception 'RESEND FAILED: another customer''s order was accepted';
  exception when sqlstate 'P0002' then null;
  end;

  -- Ambiguous order: rejected, and the response leaks NOTHING — no reason code,
  -- no counter, no mention of a limit.
  v_res := public.request_customer_pos_resend(v_amb);
  if v_res->>'outcome' <> 'unavailable' then
    raise exception 'RESEND FAILED: ambiguous order was accepted (%)', v_res; end if;
  if v_res->>'state' <> 'verifying_with_branch' then
    raise exception 'RESEND FAILED: ambiguous state wrong (%)', v_res; end if;
  if v_res ? 'reason' or v_res ? 'attempt' or v_res ? 'remaining' or v_res ? 'limit' then
    raise exception 'RESEND FAILED: response discloses internals (%)', v_res; end if;
  select pos_customer_retry_count into v_count from public.orders where id = v_amb;
  if v_count <> 0 then
    raise exception 'RESEND FAILED: rejected resend still consumed the budget'; end if;

  -- A valid resend re-queues the order AND extends the deadline, so the
  -- deadline-bounded claim RPC will actually pick it up (no false success).
  select pos_sync_deadline_at into v_deadline_before from public.orders where id = v_ok;
  v_res := public.request_customer_pos_resend(v_ok);
  if v_res->>'outcome' <> 'accepted' then
    raise exception 'RESEND FAILED: eligible order rejected (%)', v_res; end if;
  select lazywait_sync_state, pos_customer_retry_count, pos_sync_deadline_at
    into v_state, v_count, v_deadline_after from public.orders where id = v_ok;
  if v_state <> 'pending' then
    raise exception 'RESEND FAILED: not requeued (state=%)', v_state; end if;
  if v_count <> 1 then
    raise exception 'RESEND FAILED: counter not incremented (%)', v_count; end if;
  if v_deadline_after <= greatest(v_deadline_before, now()) then
    raise exception 'RESEND FAILED: deadline not extended (% -> %)', v_deadline_before, v_deadline_after; end if;

  -- A second press while the order is back in flight is rejected (single-flight).
  v_res := public.request_customer_pos_resend(v_ok);
  if v_res->>'outcome' <> 'unavailable' then
    raise exception 'RESEND FAILED: double press was accepted'; end if;
  select pos_customer_retry_count into v_count from public.orders where id = v_ok;
  if v_count <> 1 then
    raise exception 'RESEND FAILED: double press double-counted (%)', v_count; end if;

  -- The requeued order must be genuinely CLAIMABLE by the worker. A resend the
  -- deadline-bounded claim RPC then refuses is the false-success bug this check
  -- exists to prevent (the reason the RPC extends pos_sync_deadline_at at all).
  perform public.claim_lazywait_sync_one(v_ok);
  select lazywait_sync_state into v_state from public.orders where id = v_ok;
  if v_state <> 'syncing' then
    raise exception 'RESEND FAILED: requeued order was not claimable (state=%)', v_state; end if;

  -- Exhaust the budget: three accepted resends, the fourth refused.
  for i in 2..3 loop
    update public.orders set lazywait_sync_state = 'dead_letter',
      sync_next_attempt_at = null, pos_create_attempted_at = null where id = v_ok;
    v_res := public.request_customer_pos_resend(v_ok);
    if v_res->>'outcome' <> 'accepted' then
      raise exception 'RESEND FAILED: attempt % rejected (%)', i, v_res; end if;
  end loop;
  select pos_customer_retry_count into v_count from public.orders where id = v_ok;
  if v_count <> 3 then
    raise exception 'RESEND FAILED: expected 3 attempts, got %', v_count; end if;

  raise notice 'RESEND OK';
end $$;

-- ---- E. Automatic refund enrollment ----------------------------------------
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_paid  uuid := gen_random_uuid();   -- paid, proven not sent, budget spent -> refund
  v_amb   uuid := gen_random_uuid();   -- ambiguous, budget spent -> NEVER refunded
  v_marked uuid := gen_random_uuid();  -- may-have-sent marker -> NEVER refunded
  v_ref   uuid := gen_random_uuid();   -- has a POS ref -> NEVER refunded
  v_cash  uuid := gen_random_uuid();   -- unpaid -> NEVER refunded
  v_deliv uuid := gen_random_uuid();   -- no POS channel -> NEVER refunded
  v_state text; n integer;
begin
  -- orders.customer_id references profiles(id), which references
  -- auth.users(id). Create the auth user; handle_new_user() makes the profile.
  insert into auth.users (id) values (v_owner) on conflict (id) do nothing;
  set local session_replication_role = replica;
  insert into public.orders (id, customer_id, order_number, branch_id, order_type,
    subtotal, total, payment_method, payment_status, lazywait_sync_state,
    lazywait_ref, sync_blocked_reason, pos_create_attempted_at, pos_customer_retry_count) values
    (v_paid,  v_owner,'RF-1','b0000000-0000-0000-0000-0000000000ff','pickup',50,50,'online','paid','failed',null,null,null,3),
    (v_amb,   v_owner,'RF-2','b0000000-0000-0000-0000-0000000000ff','pickup',50,50,'online','paid','failed',null,null,null,3),
    (v_marked,v_owner,'RF-3','b0000000-0000-0000-0000-0000000000ff','pickup',50,50,'online','paid','failed',null,null,null,3),
    (v_ref,   v_owner,'RF-4','b0000000-0000-0000-0000-0000000000ff','pickup',50,50,'online','paid','failed',null,null,null,3),
    (v_cash,  v_owner,'RF-5','b0000000-0000-0000-0000-0000000000ff','pickup',50,50,'cash','pending','failed',null,null,null,3),
    (v_deliv, v_owner,'RF-6','b0000000-0000-0000-0000-0000000000ff','delivery',50,50,'online','paid','failed',null,null,null,3);
  set local session_replication_role = origin;

  -- Drive each row to its terminal shape through a NORMAL update, so the
  -- enrollment trigger is exercised exactly as production would.
  update public.orders set lazywait_sync_state = 'dead_letter' where id = v_paid;
  update public.orders set lazywait_sync_state = 'confirmation_required' where id = v_amb;
  update public.orders set lazywait_sync_state = 'dead_letter',
         pos_create_attempted_at = now() - interval '5m' where id = v_marked;
  update public.orders set lazywait_sync_state = 'dead_letter', lazywait_ref = 'REF9' where id = v_ref;
  update public.orders set lazywait_sync_state = 'dead_letter' where id = v_cash;
  update public.orders set lazywait_sync_state = 'blocked',
         sync_blocked_reason = 'delivery_schema_unconfirmed' where id = v_deliv;

  -- ONLY the proven non-delivery of a PAID order enrolls.
  select refund_state into v_state from public.orders where id = v_paid;
  if v_state <> 'pending' then
    raise exception 'REFUND FAILED: proven non-delivery did not enroll (%)', v_state; end if;
  select count(*) into n from public.order_refunds where order_id = v_paid;
  if n <> 1 then raise exception 'REFUND FAILED: expected 1 ledger row, got %', n; end if;

  -- Everything ambiguous or ineligible must stay OUT of the refund lifecycle.
  select count(*) into n from public.orders
   where id in (v_amb, v_marked, v_ref, v_cash, v_deliv) and refund_state <> 'none';
  if n <> 0 then
    raise exception 'REFUND FAILED: % ineligible orders were enrolled', n; end if;
  select count(*) into n from public.order_refunds
   where order_id in (v_amb, v_marked, v_ref, v_cash, v_deliv);
  if n <> 0 then
    raise exception 'REFUND FAILED: % ledger rows opened for ineligible orders', n; end if;

  -- Enrollment is idempotent: further updates never open a second refund.
  update public.orders set updated_at = now() where id = v_paid;
  update public.orders set sync_last_error = 'noise' where id = v_paid;
  select count(*) into n from public.order_refunds where order_id = v_paid;
  if n <> 1 then raise exception 'REFUND FAILED: duplicate refund opened (%)', n; end if;

  raise notice 'ENROLLMENT OK';
end $$;

-- ---- E. Refund worker lifecycle + transition guard --------------------------
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_o1 uuid := gen_random_uuid();
  v_o2 uuid := gen_random_uuid();
  v_token text := gen_random_uuid()::text;
  v_other text := gen_random_uuid()::text;
  v_claim record;
  v_state text; n integer; okflag boolean;
begin
  -- orders.customer_id references profiles(id), which references
  -- auth.users(id). Create the auth user; handle_new_user() makes the profile.
  insert into auth.users (id) values (v_owner) on conflict (id) do nothing;
  set local session_replication_role = replica;
  insert into public.orders (id, customer_id, order_number, branch_id, order_type,
    subtotal, total, payment_method, payment_status, lazywait_sync_state,
    pos_customer_retry_count) values
    (v_o1, v_owner,'RW-1','b0000000-0000-0000-0000-0000000000ff','pickup',50,50,'online','paid','failed',3),
    -- v_o2 starts BELOW the budget so it does not enroll yet: exactly one refund
    -- is queued at a time, making every claim in this block deterministic.
    (v_o2, v_owner,'RW-2','b0000000-0000-0000-0000-0000000000ff','pickup',80,80,'online','paid','failed',0);
  set local session_replication_role = origin;
  update public.orders set lazywait_sync_state = 'dead_letter' where id in (v_o1, v_o2);

  -- Claim leases exactly one refund and advances the customer-visible state with it.
  select * into v_claim from public.claim_order_refund(v_token);
  if v_claim.order_id is null then raise exception 'WORKER FAILED: nothing claimed'; end if;
  select refund_state into v_state from public.orders where id = v_claim.order_id;
  if v_state <> 'processing' then
    raise exception 'WORKER FAILED: order not moved to processing (%)', v_state; end if;

  -- A foreign token can never finalize someone else's lease.
  if public.finalize_order_refund(v_claim.refund_id, v_other, 'succeeded', 're_x', null, null) then
    raise exception 'WORKER FAILED: foreign token finalized a refund'; end if;
  select refund_state into v_state from public.orders where id = v_claim.order_id;
  if v_state <> 'processing' then
    raise exception 'WORKER FAILED: foreign finalize mutated state (%)', v_state; end if;

  -- A 'pending' outcome RELEASES the lease for a later attempt — an unknown
  -- provider result is never resolved as success or failure.
  if not public.finalize_order_refund(v_claim.refund_id, v_token, 'pending', null, null, null) then
    raise exception 'WORKER FAILED: release rejected'; end if;
  select refund_state into v_state from public.orders where id = v_claim.order_id;
  if v_state <> 'pending' then
    raise exception 'WORKER FAILED: release did not return to pending (%)', v_state; end if;

  -- Re-claim and confirm. Only now may the customer be told "Refunded".
  v_token := gen_random_uuid()::text;
  select * into v_claim from public.claim_order_refund(v_token);
  if not public.finalize_order_refund(v_claim.refund_id, v_token, 'succeeded', 're_1', null, null) then
    raise exception 'WORKER FAILED: confirm rejected'; end if;
  select refund_state into v_state from public.orders where id = v_claim.order_id;
  if v_state <> 'refunded' then
    raise exception 'WORKER FAILED: not marked refunded (%)', v_state; end if;
  if (select refund_completed_at from public.orders where id = v_claim.order_id) is null then
    raise exception 'WORKER FAILED: completion timestamp not stamped'; end if;

  -- 'refunded' is TERMINAL: no transition may walk it back and refund again.
  begin
    update public.orders set refund_state = 'pending' where id = v_claim.order_id;
    raise exception 'GUARD FAILED: refunded -> pending was allowed';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    update public.orders set refund_state = 'none' where id = v_claim.order_id;
    raise exception 'GUARD FAILED: refunded -> none was allowed';
  exception when sqlstate 'P0001' then null;
  end;

  -- An illegal jump is rejected outright. v_o2 is enrolled only now, so the
  -- claims above could never have raced it.
  update public.orders set pos_customer_retry_count = 3 where id = v_o2;
  select refund_state into v_state from public.orders where id = v_o2;
  if v_state <> 'pending' then
    raise exception 'GUARD SETUP FAILED: v_o2 did not enroll (%)', v_state; end if;
  begin
    update public.orders set refund_state = 'refunded' where id = v_o2;
    raise exception 'GUARD FAILED: pending -> refunded skipped processing';
  exception when sqlstate 'P0001' then null;
  end;

  -- At most one live-or-succeeded refund per order, forever.
  begin
    insert into public.order_refunds (order_id, provider, idempotency_key, amount, currency, status)
      values (v_claim.order_id, 'tap', 'refund_manual_dupe', 50, 'SAR', 'pending');
    raise exception 'GUARD FAILED: a second live refund was opened';
  exception when unique_violation then null;
  end;

  raise notice 'WORKER OK';
end $$;

-- ---- Security contract ------------------------------------------------------
do $$
declare n integer;
begin
  -- The customer action is authenticated-only; the worker RPCs are service-role
  -- only; the refund ledger is never readable by a plain customer.
  if has_function_privilege('anon', 'public.request_customer_pos_resend(uuid)', 'execute') then
    raise exception 'SECURITY FAILED: anon may request a resend'; end if;
  if has_function_privilege('authenticated', 'public.claim_order_refund(text)', 'execute') then
    raise exception 'SECURITY FAILED: authenticated may claim refunds'; end if;
  if has_function_privilege('authenticated',
       'public.finalize_order_refund(uuid,text,text,text,text,text)', 'execute') then
    raise exception 'SECURITY FAILED: authenticated may finalize refunds'; end if;
  if has_table_privilege('anon', 'public.order_refunds', 'select') then
    raise exception 'SECURITY FAILED: anon may read the refund ledger'; end if;
  if has_table_privilege('authenticated', 'public.order_refunds', 'insert')
     or has_table_privilege('authenticated', 'public.order_refunds', 'update') then
    raise exception 'SECURITY FAILED: authenticated may write the refund ledger'; end if;

  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'order_refunds';
  if n < 1 then raise exception 'SECURITY FAILED: order_refunds has no RLS policy'; end if;

  raise notice 'SECURITY OK';
end $$;

rollback;
