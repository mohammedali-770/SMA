-- Spicy Meal — manual-only POS resend after a proven failed send.
--
-- Fresh orders and customer-triggered resends enter `pending` and get one send
-- attempt. A failed order is inert: the scheduled worker cannot claim it again.
-- It returns to `pending` only through an explicit customer/admin resend action.
-- Ambiguous may-have-sent states remain confirmation_required and are never
-- resendable because Lazywait Create Order has no idempotency key.

-- 1) Scheduled claims consume only explicit queue entries (`pending`).
create or replace function public.claim_lazywait_sync_batch(p_limit integer default 10)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.orders o
     set lazywait_sync_state = 'syncing',
         pos_create_attempted_at = null,
         pos_create_attempt_token = null,
         updated_at = now()
   where o.id in (
     select id from public.orders
      where lazywait_sync_state = 'pending'
        and (sync_next_attempt_at is null or sync_next_attempt_at <= now())
        and (pos_sync_deadline_at is null or now() < pos_sync_deadline_at)
      order by sync_next_attempt_at nulls first, created_at
      limit greatest(1, least(coalesce(p_limit, 10), 100))
      for update skip locked
   )
   returning o.*;
end $$;
revoke all on function public.claim_lazywait_sync_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_lazywait_sync_batch(integer) to service_role;

create or replace function public.claim_lazywait_sync_one(p_order_id uuid)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.orders o
     set lazywait_sync_state = 'syncing',
         pos_create_attempted_at = null,
         pos_create_attempt_token = null,
         updated_at = now()
   where o.id in (
     select id from public.orders
      where id = p_order_id
        and lazywait_sync_state = 'pending'
        and (sync_next_attempt_at is null or sync_next_attempt_at <= now())
        and (pos_sync_deadline_at is null or now() < pos_sync_deadline_at)
      for update skip locked
   )
   returning o.*;
end $$;
revoke all on function public.claim_lazywait_sync_one(uuid) from public, anon, authenticated;
grant execute on function public.claim_lazywait_sync_one(uuid) to service_role;

-- 2) A PROVEN failure must not retain an automatic schedule. For a NEW state
-- transition produced by the worker, sync_last_error is also evidence that the
-- worker classified the outcome; then the pre-send phase marker can be cleared.
-- Existing historical rows keep any marker unless a fresh classified transition
-- occurs, preserving the conservative may-have-sent rule during rollout.
create or replace function public.normalize_known_pos_failure_for_manual_resend()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.lazywait_sync_state in ('failed','dead_letter','blocked') then
    new.sync_next_attempt_at := null;

    if tg_op = 'UPDATE'
       and new.lazywait_sync_state is distinct from old.lazywait_sync_state
       and new.sync_last_error is not null then
      new.pos_create_attempted_at := null;
      new.pos_create_attempt_token := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists normalize_known_pos_failure_for_manual_resend on public.orders;
drop trigger if exists aa_normalize_known_pos_failure_for_manual_resend on public.orders;
create trigger aa_normalize_known_pos_failure_for_manual_resend
  before insert or update of lazywait_sync_state, sync_next_attempt_at, sync_last_error on public.orders
  for each row execute function public.normalize_known_pos_failure_for_manual_resend();

-- Existing failed rows may carry an old automatic schedule. Clear the schedule
-- but deliberately preserve any historical may-have-sent marker.
update public.orders
   set sync_next_attempt_at = null,
       updated_at = now()
 where lazywait_sync_state = 'failed'
   and sync_next_attempt_at is not null;

-- 3) Customer resend eligibility intentionally ignores sync_next_attempt_at.
-- A failed row cannot be auto-claimed anymore, so a future legacy timestamp must
-- never make the customer wait for work that will not happen.
create or replace function public.customer_manual_pos_resend_eligibility(
  p_sync_state text,
  p_ref text,
  p_blocked_reason text,
  p_marker_at timestamptz,
  p_retry_count integer,
  p_payment_method text,
  p_payment_status text,
  p_refund_state text
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when coalesce(p_refund_state,'none') <> 'none' then 'refund_in_progress'
    when not public.pos_confirmation_channel_active(p_sync_state,p_blocked_reason) then 'not_applicable'
    when p_payment_method='online' and coalesce(p_payment_status,'pending') <> 'paid' then 'not_paid'
    when p_ref is not null then 'ref_present'
    when p_sync_state='synced' then 'ref_present'
    when p_sync_state='confirmation_required' then 'verification_required'
    when p_marker_at is not null then 'may_have_sent'
    when p_sync_state not in ('failed','dead_letter','blocked') then 'not_failed'
    when coalesce(p_retry_count,0) >= public.customer_pos_resend_limit() then 'attempt_limit_reached'
    else 'eligible'
  end;
$$;
revoke all on function public.customer_manual_pos_resend_eligibility(text,text,text,timestamptz,integer,text,text,text) from public, anon;
grant execute on function public.customer_manual_pos_resend_eligibility(text,text,text,timestamptz,integer,text,text,text) to authenticated, service_role;

-- 4) Rebind the customer action to the manual-only predicate.
create or replace function public.request_customer_pos_resend(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_elig text;
  v_state text;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode='28000'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.customer_id <> auth.uid() then raise exception 'Order not found' using errcode='P0002'; end if;

  v_elig := public.customer_manual_pos_resend_eligibility(
    v_order.lazywait_sync_state,v_order.lazywait_ref,v_order.sync_blocked_reason,
    v_order.pos_create_attempted_at,v_order.pos_customer_retry_count,
    v_order.payment_method,v_order.payment_status::text,v_order.refund_state);

  if v_elig <> 'eligible' then
    insert into public.integration_sync_logs(provider,order_id,direction,status,request,error)
      values('lazywait',p_order_id,'push','skipped',jsonb_build_object('action','customer_resend'),'resend_rejected_'||v_elig);
    v_state := public.customer_order_state(v_order.order_type::text,v_order.payment_method,v_order.payment_status::text,v_order.lazywait_sync_state,v_order.lazywait_ref,v_order.sync_blocked_reason,v_order.sync_next_attempt_at,v_order.pos_create_attempted_at,v_order.pos_customer_retry_count,v_order.refund_state);
    return jsonb_build_object('outcome','unavailable','state',v_state);
  end if;

  -- This explicit action is the ONLY customer path from failure back into the
  -- scheduled queue. The worker then owns exactly this newly queued attempt.
  update public.orders set
    pos_customer_retry_count=pos_customer_retry_count+1,
    pos_customer_retry_last_at=now(),
    lazywait_sync_state='pending',
    sync_next_attempt_at=now(),
    pos_sync_deadline_at=greatest(coalesce(pos_sync_deadline_at,now()),now())+public.customer_pos_resend_window(),
    sync_last_error=null,
    sync_blocked_reason=null,
    pos_create_attempted_at=null,
    pos_create_attempt_token=null,
    sync_status='not_synced'::public.sync_status,
    updated_at=now()
  where id=p_order_id returning * into v_order;

  insert into public.integration_sync_logs(provider,order_id,direction,status,request,error)
    values('lazywait',p_order_id,'push','success',jsonb_build_object('action','customer_resend','attempt',v_order.pos_customer_retry_count),null);
  v_state := public.customer_order_state(v_order.order_type::text,v_order.payment_method,v_order.payment_status::text,v_order.lazywait_sync_state,v_order.lazywait_ref,v_order.sync_blocked_reason,v_order.sync_next_attempt_at,v_order.pos_create_attempted_at,v_order.pos_customer_retry_count,v_order.refund_state);
  return jsonb_build_object('outcome','accepted','state',v_state);
end $$;
revoke all on function public.request_customer_pos_resend(uuid) from public, anon;
grant execute on function public.request_customer_pos_resend(uuid) to authenticated;

-- 5) After the last customer-triggered attempt, a proven failed state is terminal.
-- The aa_* normalizer runs before this trigger, so a freshly classified known
-- failure has its marker cleared first. Existing ambiguous markers remain and
-- therefore cannot be converted/refunded accidentally.
create or replace function public.enforce_customer_manual_resend_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.lazywait_sync_state='failed'
     and coalesce(new.pos_customer_retry_count,0) >= public.customer_pos_resend_limit()
     and new.lazywait_ref is null
     and new.pos_create_attempted_at is null
     and public.pos_confirmation_channel_active(new.lazywait_sync_state,new.sync_blocked_reason) then
    new.lazywait_sync_state := 'dead_letter';
    new.sync_next_attempt_at := null;
  end if;
  return new;
end $$;
drop trigger if exists enforce_customer_manual_resend_limit on public.orders;
create trigger enforce_customer_manual_resend_limit
  before insert or update of lazywait_sync_state, pos_customer_retry_count, pos_create_attempted_at on public.orders
  for each row execute function public.enforce_customer_manual_resend_limit();

-- Backfill already-exhausted PROVEN failures only. Historical marked rows remain
-- untouched and continue to require verification rather than refund/resend.
update public.orders
   set lazywait_sync_state='failed', updated_at=now()
 where lazywait_sync_state='failed'
   and coalesce(pos_customer_retry_count,0) >= public.customer_pos_resend_limit()
   and lazywait_ref is null
   and pos_create_attempted_at is null;

-- 6) Legacy `pos_retrying` producers can still exist inside the worker, but a
-- persisted failed row now has no automatic schedule. Rewrite that notification
-- only when the stored order proves it is in this new manual-only shape. This
-- intentionally leaves legacy/fencing fixtures with a real future schedule
-- untouched, preserving the notification fencing contract.
create or replace function public.normalize_manual_pos_sync_notification()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind='pos_sync'
     and new.status='pos_retrying'
     and exists (
       select 1 from public.orders o
        where o.id=new.order_id
          and o.lazywait_sync_state in ('failed','dead_letter','blocked')
          and o.sync_next_attempt_at is null
     ) then
    new.status := 'pos_failed';
  end if;
  return new;
end $$;
drop trigger if exists normalize_manual_pos_sync_notification on public.notification_log;
create trigger normalize_manual_pos_sync_notification
  before insert on public.notification_log
  for each row execute function public.normalize_manual_pos_sync_notification();
