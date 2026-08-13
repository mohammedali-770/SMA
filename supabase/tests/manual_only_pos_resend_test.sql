-- Manual-only POS resend regression suite.
begin;
insert into public.branches(id,name_en,name_ar) values('b0000000-0000-0000-0000-0000000000fe','Manual Suite','اختبار الإرسال اليدوي') on conflict(id) do nothing;

-- A failed row must never be claimed by the scheduled worker, even if an old
-- automatic retry timestamp says it is due. Pending remains claimable.
do $$
declare v_pending uuid:=gen_random_uuid();v_failed uuid:=gen_random_uuid();n int;
begin
  set local session_replication_role=replica;
  insert into public.orders(id,order_number,branch_id,order_type,subtotal,total,lazywait_sync_state,sync_next_attempt_at,pos_sync_started_at,pos_sync_deadline_at) values
    (v_pending,'MR-1','b0000000-0000-0000-0000-0000000000fe','pickup',10,10,'pending',now()-interval '1m',now()-interval '1m',now()+interval '9m'),
    (v_failed,'MR-2','b0000000-0000-0000-0000-0000000000fe','pickup',10,10,'failed',now()-interval '1m',now()-interval '1m',now()+interval '9m');
  set local session_replication_role=origin;
  select count(*) into n from public.claim_lazywait_sync_batch(20) where id in(v_pending,v_failed);
  if n<>1 then raise exception 'MANUAL CLAIM FAILED: expected one pending claim, got %',n;end if;
  if (select lazywait_sync_state from public.orders where id=v_failed)<>'failed' then raise exception 'MANUAL CLAIM FAILED: failed row was auto-claimed';end if;
end $$;

-- A legacy future retry timestamp must not block the explicit customer action.
do $$
declare v_owner uuid:=gen_random_uuid();v_id uuid:=gen_random_uuid();v_res jsonb;
begin
  insert into auth.users(id) values(v_owner) on conflict(id) do nothing;
  set local session_replication_role=replica;
  insert into public.orders(id,customer_id,order_number,branch_id,order_type,subtotal,total,payment_method,payment_status,lazywait_sync_state,sync_next_attempt_at,pos_customer_retry_count,lazywait_ref,pos_create_attempted_at,pos_sync_started_at,pos_sync_deadline_at)
    values(v_id,v_owner,'MR-3','b0000000-0000-0000-0000-0000000000fe','pickup',10,10,'cash','pending','failed',now()+interval '10m',0,null,null,now()-interval '1m',now()+interval '9m');
  set local session_replication_role=origin;
  perform set_config('test.auth_uid',v_owner::text,true);
  v_res:=public.request_customer_pos_resend(v_id);
  if v_res->>'outcome'<>'accepted' then raise exception 'MANUAL RESEND FAILED: explicit resend rejected (%)',v_res;end if;
  if (select lazywait_sync_state from public.orders where id=v_id)<>'pending' then raise exception 'MANUAL RESEND FAILED: explicit action did not queue one send';end if;
  if (select pos_customer_retry_count from public.orders where id=v_id)<>1 then raise exception 'MANUAL RESEND FAILED: counter not incremented once';end if;
end $$;

-- The final manual attempt becomes terminal when a proven send failure is stored.
do $$
declare v_id uuid:=gen_random_uuid();
begin
  set local session_replication_role=replica;
  insert into public.orders(id,order_number,branch_id,order_type,subtotal,total,payment_method,payment_status,lazywait_sync_state,pos_customer_retry_count,lazywait_ref,pos_create_attempted_at)
    values(v_id,'MR-4','b0000000-0000-0000-0000-0000000000fe','pickup',10,10,'cash','pending','syncing',3,null,null);
  set local session_replication_role=origin;
  update public.orders set lazywait_sync_state='failed',sync_next_attempt_at=now()+interval '1m' where id=v_id;
  if (select lazywait_sync_state from public.orders where id=v_id)<>'dead_letter' then raise exception 'MANUAL LIMIT FAILED: exhausted proven failure not terminal';end if;
  if (select sync_next_attempt_at from public.orders where id=v_id) is not null then raise exception 'MANUAL LIMIT FAILED: terminal order still scheduled';end if;
end $$;
rollback;
