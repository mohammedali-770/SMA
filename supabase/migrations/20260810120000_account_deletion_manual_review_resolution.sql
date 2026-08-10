-- ============================================================================
-- Spicy Meal — administrative exit from account-deletion manual_review
--
-- Before this migration a request escalated to manual_review was permanently
-- outside claim_due_account_deletions(), while the account lock continued to
-- treat manual_review as active. There was no supported state transition back
-- to processing or to a terminal state: the only remedy was ad-hoc production
-- SQL. This adds one narrowly-scoped, audited admin RPC.
--
-- NO request is resolved automatically. This migration only adds the controlled
-- path an administrator can invoke after investigating the blocking condition.
-- ============================================================================

create table if not exists public.account_deletion_resolution_audit (
  id                    bigint generated always as identity primary key,
  request_id            uuid not null references public.account_deletion_requests(id) on delete restrict,
  action                text not null check (action in ('retry', 'fail')),
  previous_reason       text,
  resolution_note       text,
  resolved_by           uuid references auth.users(id) on delete set null,
  resolved_at           timestamptz not null default now()
);

create index if not exists account_deletion_resolution_audit_request_idx
  on public.account_deletion_resolution_audit(request_id, resolved_at desc);

alter table public.account_deletion_resolution_audit enable row level security;
revoke all on public.account_deletion_resolution_audit from anon, authenticated;
grant select on public.account_deletion_resolution_audit to authenticated;

drop policy if exists account_deletion_resolution_audit_admin_read
  on public.account_deletion_resolution_audit;
create policy account_deletion_resolution_audit_admin_read
  on public.account_deletion_resolution_audit
  for select to authenticated
  using (public.is_admin());

create or replace function public.resolve_account_deletion_request(
  p_request_id uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.account_deletion_requests;
  v_previous_reason text;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins may resolve account deletion reviews'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'request id required' using errcode = '22004';
  end if;

  if v_action not in ('retry', 'fail') then
    raise exception 'action must be retry or fail' using errcode = '22023';
  end if;

  select * into v_row
    from public.account_deletion_requests
   where id = p_request_id
   for update;

  if not found then
    raise exception 'account deletion request not found' using errcode = 'P0002';
  end if;

  if v_row.status <> 'manual_review' then
    raise exception 'only manual_review requests may be resolved by this RPC'
      using errcode = '22023';
  end if;

  v_previous_reason := v_row.manual_review_reason;

  if v_action = 'retry' then
    -- A retry is allowed only while the identity still exists and the original
    -- request was genuinely re-verified. The ordinary processor will re-check
    -- active orders / financial blockers again; this RPC never bypasses them.
    if v_row.user_id is null or v_row.identity_verified_at is null then
      raise exception 'manual-review request is not eligible for retry'
        using errcode = '22023';
    end if;

    update public.account_deletion_requests
       set status                = 'queued',
           next_attempt_at       = now(),
           attempt_count         = 0,
           failure_code          = null,
           failure_stage         = null,
           manual_review_reason  = null,
           locked_until          = null,
           lock_token            = null,
           processing_started_at = null,
           updated_at            = now()
     where id = p_request_id
     returning * into v_row;
  else
    -- Terminal failure deliberately releases the account-deletion lock because
    -- `failed` is not an active status. The customer can make a fresh request
    -- later, but must pass identity re-verification again.
    update public.account_deletion_requests
       set status               = 'failed',
           next_attempt_at      = null,
           failure_code         = 'manual_review_resolved_failed',
           failure_stage        = 'manual_review',
           manual_review_reason = coalesce(v_note, manual_review_reason),
           locked_until         = null,
           lock_token           = null,
           updated_at           = now()
     where id = p_request_id
     returning * into v_row;
  end if;

  -- Previous reason comes only from the locked server row; the client cannot
  -- forge the audit history. Free-text note is length-bounded and admin-only.
  insert into public.account_deletion_resolution_audit
    (request_id, action, previous_reason, resolution_note, resolved_by)
  values
    (p_request_id, v_action, v_previous_reason,
     case when v_note is null then null else left(v_note, 500) end,
     auth.uid());

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'next_attempt_at', v_row.next_attempt_at,
    'attempt_count', v_row.attempt_count,
    'resolved_action', v_action
  );
end $$;

revoke all on function public.resolve_account_deletion_request(uuid, text, text)
  from public, anon;
grant execute on function public.resolve_account_deletion_request(uuid, text, text)
  to authenticated;

comment on table public.account_deletion_resolution_audit is
  'Append-only audit of admin decisions that move an account-deletion request out of manual_review. Client writes are denied; only resolve_account_deletion_request inserts rows. Deleting a referenced request is restricted so the audit cannot be silently orphaned.';
comment on function public.resolve_account_deletion_request(uuid, text, text) is
  'Admin-only exit from manual_review. retry requeues through the normal processor and resets the failure budget; fail makes the request terminal so the account lock is released and any future request must re-verify identity. Every decision is audited.';
