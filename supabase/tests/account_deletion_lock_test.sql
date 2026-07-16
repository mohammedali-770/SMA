-- ============================================================================
-- DB-level test for the account-deletion LOCK triggers (immediate account
-- locking). Runs on a disposable local DB with all migrations applied. NOT part
-- of the Vitest/CI suite (needs a database). Authored + executed locally.
--
-- Verifies that while an active deletion request exists, a customer cannot
-- create new orders / addresses / notification devices / checkout sessions from
-- ANY path, that the payment-completion (paid) order insert is exempted, that
-- retry_scheduled and manual_review keep the account locked, and that completion
-- releases the lock. RAISES on any failure.
-- ============================================================================
begin;

do $$
declare
  v_uid uuid := gen_random_uuid();
  v_bid uuid := gen_random_uuid();
  blocked boolean;
begin
  insert into public.branches (id, name_en, name_ar) values (v_bid, 'Lock Branch', 'فرع');
  insert into auth.users (id, email) values (v_uid, 'lock@example.com'); -- trigger seeds profile

  perform public.create_account_deletion_request(v_uid, 'reauth'); -- active (queued)

  -- 1) NEW customer order (place_order path → payment_status pending) is BLOCKED.
  blocked := false;
  begin
    insert into public.orders (order_number, customer_id, branch_id, order_type, subtotal, total, payment_status)
      values ('LOCK-PENDING', v_uid, v_bid, 'pickup', 10, 12, 'pending');
  exception when others then blocked := (SQLERRM like '%Account deletion in progress%'); end;
  if not blocked then raise exception 'FAIL: a new pending order was NOT blocked'; end if;

  -- 2) Payment-completion order (insert_order_from_snapshot → paid) is ALLOWED.
  insert into public.orders (order_number, customer_id, branch_id, order_type, subtotal, total, payment_status)
    values ('LOCK-PAID', v_uid, v_bid, 'pickup', 10, 12, 'paid');

  -- 3) New saved address is BLOCKED.
  blocked := false;
  begin insert into public.addresses (customer_id, latitude, longitude) values (v_uid, 24.7, 46.7);
  exception when others then blocked := (SQLERRM like '%Account deletion in progress%'); end;
  if not blocked then raise exception 'FAIL: a new address was NOT blocked'; end if;

  -- 4) New notification device registration is BLOCKED.
  blocked := false;
  begin insert into public.push_devices (customer_id, expo_push_token, platform) values (v_uid, 'ExponentPushToken[lock]', 'android');
  exception when others then blocked := (SQLERRM like '%Account deletion in progress%'); end;
  if not blocked then raise exception 'FAIL: a new push_device was NOT blocked'; end if;

  -- 5) Starting a new online checkout is BLOCKED.
  blocked := false;
  begin insert into public.checkout_sessions (customer_id, order_type, branch_id, snapshot, subtotal, total)
    values (v_uid, 'pickup', v_bid, '{}'::jsonb, 10, 12);
  exception when others then blocked := (SQLERRM like '%Account deletion in progress%'); end;
  if not blocked then raise exception 'FAIL: a new checkout_session was NOT blocked'; end if;

  -- 6) retry_scheduled keeps the account LOCKED (partial-failure safety).
  update public.account_deletion_requests set status='retry_scheduled' where user_id = v_uid;
  blocked := false;
  begin insert into public.orders (order_number, customer_id, branch_id, order_type, subtotal, total, payment_status)
    values ('LOCK-RETRY', v_uid, v_bid, 'pickup', 10, 12, 'pending');
  exception when others then blocked := (SQLERRM like '%Account deletion in progress%'); end;
  if not blocked then raise exception 'FAIL: retry_scheduled did not keep the account locked'; end if;

  -- 7) manual_review keeps the account LOCKED.
  update public.account_deletion_requests set status='manual_review' where user_id = v_uid;
  blocked := false;
  begin insert into public.orders (order_number, customer_id, branch_id, order_type, subtotal, total, payment_status)
    values ('LOCK-MR', v_uid, v_bid, 'pickup', 10, 12, 'pending');
  exception when others then blocked := (SQLERRM like '%Account deletion in progress%'); end;
  if not blocked then raise exception 'FAIL: manual_review did not keep the account locked'; end if;

  -- 8) Completion RELEASES the lock (no longer an active request).
  update public.account_deletion_requests set status='completed', completed_at=now() where user_id = v_uid;
  insert into public.orders (order_number, customer_id, branch_id, order_type, subtotal, total, payment_status)
    values ('LOCK-DONE', v_uid, v_bid, 'pickup', 10, 12, 'pending');

  raise notice 'account_deletion_lock_test: ALL CASES PASSED';
end $$;

rollback;
