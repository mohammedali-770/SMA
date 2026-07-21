-- ============================================================================
-- Lazywait POS — final producer-side synced/ref invariant guard.
--
-- Production was already running the reviewed confirmation lifecycle when a
-- post-deploy verification found one legacy worker path that can request
-- `lazywait_sync_state = 'synced'` for a truthy but unusable stored ref marker
-- (for example whitespace-only text). The Create Order resend remains blocked,
-- and the earlier producer guard suppresses `pos_confirmed`, but accepting the
-- requested state would leave an operational orphan: technically `synced`, no
-- proven POS confirmation, and absent from the manual-verification feed.
--
-- This defense-in-depth guard makes record_lazywait_sync authoritative:
-- any requested `synced` transition without a canonical USABLE ref is coerced
-- atomically to `confirmation_required`, retry scheduling is cleared, the
-- suspicious marker is preserved, and a deduped `pos_confirmation_required`
-- event is produced. A usable-ref synced transition is unchanged.
--
-- Live apply-time version: 20260721084330 (`lazywait_synced_ref_guard`).
-- No payment, cron, Vault, credential, or external-request behavior is changed.
-- ============================================================================

create or replace function public.record_lazywait_sync(
  p_order_id      uuid,
  p_patch         jsonb,
  p_log_status    text default 'success',
  p_direction     text default 'push',
  p_request       jsonb default null,
  p_response      jsonb default null,
  p_error         text default null,
  p_notify_status text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_state  text := p_patch->>'lazywait_sync_state';
  v_new_state        text;
  v_new_ref          text;
  v_coerced          boolean := false;
  v_effective_notify text := p_notify_status;
begin
  update public.orders set
    lazywait_sync_state = case
      when v_requested_state = 'synced'
       and not public.lazywait_pos_ref_is_usable(
         coalesce(p_patch->>'lazywait_ref', lazywait_ref))
        then 'confirmation_required'
      else coalesce(v_requested_state, lazywait_sync_state)
    end,
    lazywait_ref          = coalesce(p_patch->>'lazywait_ref', lazywait_ref),
    lazywait_order_id     = coalesce(p_patch->>'lazywait_order_id', lazywait_order_id),
    lazywait_order_number = coalesce(p_patch->>'lazywait_order_number', lazywait_order_number),
    lazywait_status       = coalesce(p_patch->>'lazywait_status', lazywait_status),
    sync_attempt_count    = coalesce((p_patch->>'sync_attempt_count')::int, sync_attempt_count),
    sync_next_attempt_at  = case
      when v_requested_state = 'synced'
       and not public.lazywait_pos_ref_is_usable(
         coalesce(p_patch->>'lazywait_ref', lazywait_ref))
        then null
      when p_patch ? 'sync_next_attempt_at'
        then nullif(p_patch->>'sync_next_attempt_at','')::timestamptz
      else sync_next_attempt_at
    end,
    sync_last_error = case
      when v_requested_state = 'synced'
       and not public.lazywait_pos_ref_is_usable(
         coalesce(p_patch->>'lazywait_ref', lazywait_ref))
        then 'ref_present_unverified_no_usable_ref'
      when p_patch ? 'sync_last_error' then p_patch->>'sync_last_error'
      else sync_last_error
    end,
    sync_blocked_reason = case
      when p_patch ? 'sync_blocked_reason' then p_patch->>'sync_blocked_reason'
      else sync_blocked_reason
    end,
    synced_at = case
      when v_requested_state = 'synced'
       and not public.lazywait_pos_ref_is_usable(
         coalesce(p_patch->>'lazywait_ref', lazywait_ref))
        then synced_at
      when p_patch ? 'synced_at'
        then nullif(p_patch->>'synced_at','')::timestamptz
      else synced_at
    end,
    first_pos_sync_failure_at = case
      when v_requested_state = 'synced'
       and not public.lazywait_pos_ref_is_usable(
         coalesce(p_patch->>'lazywait_ref', lazywait_ref))
        then coalesce(first_pos_sync_failure_at, now())
      when p_patch ? 'first_pos_sync_failure_at'
        then nullif(p_patch->>'first_pos_sync_failure_at','')::timestamptz
      else first_pos_sync_failure_at
    end,
    pos_create_attempted_at = case
      when p_patch ? 'pos_create_attempted_at'
        then nullif(p_patch->>'pos_create_attempted_at','')::timestamptz
      else pos_create_attempted_at
    end,
    pos_confirmation_reason = case
      when v_requested_state = 'synced'
       and not public.lazywait_pos_ref_is_usable(
         coalesce(p_patch->>'lazywait_ref', lazywait_ref))
        then coalesce(pos_confirmation_reason, 'missing_ref')
      when p_patch ? 'pos_confirmation_reason'
        then p_patch->>'pos_confirmation_reason'
      else pos_confirmation_reason
    end,
    sync_status = case
      when v_requested_state = 'synced'
       and not public.lazywait_pos_ref_is_usable(
         coalesce(p_patch->>'lazywait_ref', lazywait_ref))
        then 'failed'::public.sync_status
      when v_requested_state = 'synced'  then 'synced'::public.sync_status
      when v_requested_state = 'syncing' then 'syncing'::public.sync_status
      when v_requested_state in ('failed','dead_letter','blocked','confirmation_required')
        then 'failed'::public.sync_status
      when v_requested_state in ('pending','skipped')
        then 'not_synced'::public.sync_status
      else sync_status
    end,
    updated_at = now()
  where id = p_order_id
  returning lazywait_sync_state, lazywait_ref into v_new_state, v_new_ref;

  v_coerced := v_requested_state = 'synced'
    and v_new_state = 'confirmation_required'
    and not public.lazywait_pos_ref_is_usable(v_new_ref);

  if v_coerced then
    v_effective_notify := 'pos_confirmation_required';
  end if;

  insert into public.integration_sync_logs
    (provider, order_id, direction, status, request, response, error)
  values (
    'lazywait', p_order_id, p_direction,
    case when v_coerced then 'failed' else p_log_status end,
    p_request, p_response,
    case when v_coerced
      then coalesce(p_error, 'ref_present_unverified')
      else p_error
    end
  );

  if v_effective_notify is not null
     and (v_effective_notify <> 'pos_confirmed'
          or (v_new_state = 'synced'
              and public.lazywait_pos_ref_is_usable(v_new_ref))) then
    insert into public.notification_log (kind, order_id, status, send_status)
      values ('pos_sync', p_order_id, v_effective_notify, 'pending')
      on conflict do nothing;
  end if;
end $$;

revoke all on function public.record_lazywait_sync(
  uuid, jsonb, text, text, jsonb, jsonb, text, text)
  from public, anon, authenticated;

grant execute on function public.record_lazywait_sync(
  uuid, jsonb, text, text, jsonb, jsonb, text, text)
  to service_role;
