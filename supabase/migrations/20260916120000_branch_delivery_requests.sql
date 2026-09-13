-- 20260916120000_branch_delivery_requests.sql
--
-- WHAT: lets a BRANCH ask the CALL CENTRE to close delivery, and lets the call
-- centre accept or decline. Request only — the branch never closes delivery
-- itself, and this migration does not move that boundary one inch.
--
-- WHY IT IS NEEDED. The domain split of 2026-08-20 is deliberate and holds: the
-- branch owns what is sellable, the call centre owns where it can go. But the
-- split left no channel between them. Today a branch with no driver has exactly
-- one remedy, and `docs/STAFF_MANUAL.md` §133-138 states it plainly: telephone
-- the call centre. That works until the call centre is on another line.
--
-- WHAT IT DOES NOT CHANGE, stated first because it is the thing most likely to
-- be assumed: `set_branch_delivery_pause` is UNTOUCHED, its gate is still
-- `is_admin() or is_call_center()`, and `is_branch_operator` appears nowhere in
-- any delivery-writing path. A branch that files a request has changed nothing
-- about delivery; only an accept does, and the accept runs through the existing
-- RPC rather than a second copy of it. The SQL suite asserts both.
--
-- SHAPE: one request table, three RPCs (file / cancel / resolve), one widened
-- realtime signal. No cron job — see EXPIRY below.
--
-- EXPIRY WITHOUT A SWEEPER. A request nobody answers must not sit "pending"
-- forever, but the per-minute `branch_availability_sweep()` is a working cron
-- path and this change does not need to touch it. Instead a pending request
-- past `expires_at` is dead on arrival: `resolve` refuses it, and `request`
-- retires its own branch's stale rows before inserting. That is the same
-- boolean-authoritative / timestamp-advisory shape the snooze model already
-- uses, and it keeps the blast radius of this migration inside its own table.
--
-- ONE OPEN REQUEST PER BRANCH is structural, not conventional: a partial unique
-- index on (branch_id) where status = 'pending'. A branch cannot queue five
-- requests while the call centre is busy.
--
-- MONEY PATH: untouched. NO DEPLOY IMPLIED: new objects only; no existing
-- signature changes.

-- ---------------------------------------------------------------------------
-- 1. The request table
-- ---------------------------------------------------------------------------
create table if not exists public.branch_delivery_requests (
  id                uuid primary key default gen_random_uuid(),
  branch_id         uuid not null references public.branches(id) on delete cascade,
  requested_by      uuid not null references public.profiles(id),
  requested_at      timestamptz not null default now(),
  requested_minutes integer not null check (requested_minutes > 0 and requested_minutes <= 1440),
  reason_code       text not null check (reason_code in
                      ('no_driver','weather','kitchen_overload','area_incident','other')),
  note              text check (note is null or length(note) <= 500),
  expires_at        timestamptz not null,
  status            text not null default 'pending' check (status in
                      ('pending','accepted','declined','cancelled','expired')),
  resolved_by       uuid references public.profiles(id),
  resolved_at       timestamptz,
  resolution_note   text check (resolution_note is null or length(resolution_note) <= 500),
  applied_minutes   integer check (applied_minutes is null or (applied_minutes > 0 and applied_minutes <= 1440)),
  -- A resolved row must carry who and when; a pending row must not.
  constraint bdr_resolution_coherent check (
    (status = 'pending' and resolved_by is null and resolved_at is null)
    or (status <> 'pending' and resolved_at is not null)
  ),
  -- Only an accepted request applies a pause.
  constraint bdr_applied_only_when_accepted check (
    applied_minutes is null or status = 'accepted'
  )
);

comment on table public.branch_delivery_requests is
  'Branch-to-call-centre requests to close delivery. Filing one changes nothing; only an accepted request pauses delivery, and it does so through set_branch_delivery_pause rather than a second write path. The branch delivery boundary (owner decision 2026-08-20) is unchanged by this table.';

create unique index if not exists bdr_one_open_per_branch
  on public.branch_delivery_requests (branch_id)
  where status = 'pending';

create index if not exists bdr_branch_recent_idx
  on public.branch_delivery_requests (branch_id, requested_at desc);

create index if not exists bdr_pending_idx
  on public.branch_delivery_requests (requested_at)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. RLS — read for the operations roles, NO client write path at all
-- ---------------------------------------------------------------------------
alter table public.branch_delivery_requests enable row level security;
revoke all on public.branch_delivery_requests from public, anon, authenticated;
grant select on public.branch_delivery_requests to authenticated;

drop policy if exists bdr_select_ops on public.branch_delivery_requests;
create policy bdr_select_ops
  on public.branch_delivery_requests for select to authenticated
  using (
    public.is_staff()
    or public.is_call_center()
    or public.is_branch_operator(branch_id)
  );

-- No insert/update/delete policy is defined, on purpose. The three RPCs below
-- are SECURITY DEFINER and are the only write path, exactly as the snooze and
-- delivery RPCs already work. RLS is the backstop, not the gate.

-- ---------------------------------------------------------------------------
-- 3. Realtime signal — widen the existing kind vocabulary
-- ---------------------------------------------------------------------------
-- Widening a CHECK to admit one more value cannot invalidate an existing row,
-- and ops_change_events is a self-pruning signal table carrying branch id and
-- kind only. Nothing about who may subscribe changes.
alter table public.ops_change_events
  drop constraint if exists ops_change_events_kind_check;
alter table public.ops_change_events
  add constraint ops_change_events_kind_check
  check (kind in ('availability','delivery','area','delivery_request'));

-- ---------------------------------------------------------------------------
-- 4. File a request — BRANCH side
-- ---------------------------------------------------------------------------
create or replace function public.request_branch_delivery_pause(
  p_branch_id   uuid,
  p_minutes     integer,
  p_reason_code text,
  p_note        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_minutes constant integer := 1440;
  c_ttl_minutes constant integer := 60;      -- an unanswered request dies after an hour
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id   uuid;
  v_exp  timestamptz;
begin
  -- The branch may ask about ITS OWN branch. An admin may file on anyone's
  -- behalf. The call centre deliberately cannot file a request to itself.
  if not (public.is_admin() or public.is_branch_operator(p_branch_id)) then
    raise exception 'Not authorized to request a delivery closure for this branch'
      using errcode = '42501';
  end if;
  if p_branch_id is null then
    raise exception 'branch id is required' using errcode = '22004';
  end if;
  if p_minutes is null then
    raise exception 'A requested duration is required' using errcode = '22004';
  end if;
  if p_minutes <= 0 or p_minutes > c_max_minutes then
    raise exception 'Requested duration must be between 1 and % minutes', c_max_minutes
      using errcode = '22023';
  end if;
  if p_reason_code is null or p_reason_code not in
     ('no_driver','weather','kitchen_overload','area_incident','other') then
    raise exception 'A valid reason is required' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'The note must be 500 characters or fewer' using errcode = '22023';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;

  -- Asking for something that has already happened is a no-op worth naming, so
  -- the cashier gets a useful message instead of a request nobody can action.
  if exists (
    select 1 from public.branches
     where id = p_branch_id and delivery_temporarily_closed
  ) then
    raise exception 'Delivery is already closed at this branch' using errcode = '22023';
  end if;

  -- Retire this branch's own stale rows first, so a request that nobody
  -- answered an hour ago does not block a fresh one through the partial index.
  update public.branch_delivery_requests
     set status = 'expired', resolved_at = now()
   where branch_id = p_branch_id
     and status = 'pending'
     and expires_at <= now();

  v_exp := now() + make_interval(mins => c_ttl_minutes);

  begin
    insert into public.branch_delivery_requests
      (branch_id, requested_by, requested_minutes, reason_code, note, expires_at)
    values
      (p_branch_id, auth.uid(), p_minutes, p_reason_code, v_note, v_exp)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This branch already has a request waiting for the call centre'
      using errcode = '23505';
  end;

  perform public.emit_ops_change_event(p_branch_id, 'delivery_request');

  return jsonb_build_object(
    'id', v_id,
    'branch_id', p_branch_id,
    'status', 'pending',
    'expires_at', v_exp);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Withdraw a request — BRANCH side
-- ---------------------------------------------------------------------------
create or replace function public.cancel_branch_delivery_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
  v_status text;
begin
  if p_request_id is null then
    raise exception 'request id is required' using errcode = '22004';
  end if;

  select branch_id, status into v_branch, v_status
    from public.branch_delivery_requests
   where id = p_request_id
   for update;

  if v_branch is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or public.is_branch_operator(v_branch)) then
    raise exception 'Not authorized to withdraw this request' using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'Only a waiting request can be withdrawn' using errcode = '22023';
  end if;

  update public.branch_delivery_requests
     set status = 'cancelled', resolved_at = now(), resolved_by = auth.uid()
   where id = p_request_id;

  perform public.emit_ops_change_event(v_branch, 'delivery_request');

  return jsonb_build_object('id', p_request_id, 'status', 'cancelled');
end $$;

-- ---------------------------------------------------------------------------
-- 6. Accept or decline — CALL CENTRE side
-- ---------------------------------------------------------------------------
-- On accept this calls set_branch_delivery_pause rather than updating
-- `branches` itself. That is the load-bearing decision in this file: the pause
-- keeps ONE implementation, so its validation, its audit trigger and its
-- reason/note plumbing cannot drift from a second copy. The caller is already
-- admin-or-call-centre, so the inner RPC's own gate passes for the right reason
-- rather than being bypassed.
create or replace function public.resolve_branch_delivery_request(
  p_request_id uuid,
  p_accept     boolean,
  p_minutes    integer default null,
  p_note       text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req     public.branch_delivery_requests;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_minutes integer;
  v_paused  jsonb;
begin
  if not (public.is_admin() or public.is_call_center()) then
    raise exception 'Only the call centre may answer a delivery request'
      using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request id is required' using errcode = '22004';
  end if;
  if p_accept is null then
    raise exception 'accept or decline must be stated' using errcode = '22004';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'The note must be 500 characters or fewer' using errcode = '22023';
  end if;

  select * into v_req
    from public.branch_delivery_requests
   where id = p_request_id
   for update;

  if v_req.id is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been answered' using errcode = '22023';
  end if;

  -- An expired request is answered by retiring it, never by acting on it: the
  -- branch's reason for asking may be an hour stale.
  --
  -- IT RETURNS RATHER THAN RAISING, and the reason is not stylistic. A raise
  -- rolls back everything the function has done, including the retirement --
  -- so the raising version left the row 'pending' forever and the next operator
  -- met the same dead request. Discovered by CASE 14 of the paired suite, which
  -- asserts the row is actually retired rather than that an error was thrown.
  -- Expiry is also not a caller error: the operator did nothing wrong and needs
  -- to be told the state, not handed an exception.
  if v_req.expires_at <= now() then
    update public.branch_delivery_requests
       set status = 'expired', resolved_at = now()
     where id = p_request_id;
    perform public.emit_ops_change_event(v_req.branch_id, 'delivery_request');
    return jsonb_build_object(
      'id', p_request_id,
      'status', 'expired',
      'applied', false,
      'message', 'This request expired before it was answered; ask the branch to send a new one');
  end if;

  if not p_accept then
    update public.branch_delivery_requests
       set status = 'declined', resolved_at = now(),
           resolved_by = auth.uid(), resolution_note = v_note
     where id = p_request_id;
    perform public.emit_ops_change_event(v_req.branch_id, 'delivery_request');
    return jsonb_build_object('id', p_request_id, 'status', 'declined');
  end if;

  -- The call centre may shorten or lengthen what the branch asked for; absent an
  -- override it gets what it asked for.
  v_minutes := coalesce(p_minutes, v_req.requested_minutes);

  v_paused := public.set_branch_delivery_pause(
    v_req.branch_id, v_minutes, v_req.reason_code,
    coalesce(v_note, v_req.note));

  update public.branch_delivery_requests
     set status = 'accepted', resolved_at = now(),
         resolved_by = auth.uid(), resolution_note = v_note,
         applied_minutes = v_minutes
   where id = p_request_id;

  perform public.emit_ops_change_event(v_req.branch_id, 'delivery_request');

  return jsonb_build_object(
    'id', p_request_id,
    'status', 'accepted',
    'applied_minutes', v_minutes,
    'delivery_closed_until', v_paused ->> 'delivery_closed_until');
end $$;

-- ---------------------------------------------------------------------------
-- 7. Grants — same shape as every other ops RPC
-- ---------------------------------------------------------------------------
revoke all on function public.request_branch_delivery_pause(uuid, integer, text, text) from public, anon;
revoke all on function public.cancel_branch_delivery_request(uuid)                     from public, anon;
revoke all on function public.resolve_branch_delivery_request(uuid, boolean, integer, text) from public, anon;

grant execute on function public.request_branch_delivery_pause(uuid, integer, text, text) to authenticated;
grant execute on function public.cancel_branch_delivery_request(uuid)                     to authenticated;
grant execute on function public.resolve_branch_delivery_request(uuid, boolean, integer, text) to authenticated;

comment on function public.request_branch_delivery_pause(uuid, integer, text, text) is
  'Branch asks the call centre to close delivery. Filing a request changes NOTHING about delivery state — only resolve_branch_delivery_request with p_accept = true does, and it applies the pause through set_branch_delivery_pause. Gate is is_admin() or is_branch_operator(branch), deliberately not is_call_center().';
comment on function public.resolve_branch_delivery_request(uuid, boolean, integer, text) is
  'Call centre answers a branch request. Accepting calls set_branch_delivery_pause so the pause keeps one implementation; the caller already satisfies that function''s own gate. An expired request is retired, never acted on.';

-- ---------------------------------------------------------------------------
-- 8. Self-verification
-- ---------------------------------------------------------------------------
-- A plpgsql body is not name-resolved at creation, so a clean apply proves only
-- that the text was stored. These checks assert the boundary this file is most
-- likely to be accused of moving, and they are written to be able to fail.
do $verify$
declare
  v_n integer;
  v_src text;
begin
  -- (a) The delivery-writing RPCs must STILL exclude branch operators.
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_branch_delivery_pause';
  if v_src is null then
    raise exception 'set_branch_delivery_pause is missing';
  end if;
  if v_src like '%is_branch_operator%' then
    raise exception 'set_branch_delivery_pause now references is_branch_operator -- the 2026-08-20 boundary moved';
  end if;
  if v_src not like '%is_call_center()%' then
    raise exception 'set_branch_delivery_pause lost its call-centre gate';
  end if;

  -- (b) Filing must be closed to the call centre, and answering closed to the
  --     branch. Asserted on the bodies, because that is where the gates live.
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_branch_delivery_pause';
  if v_src not like '%is_branch_operator(p_branch_id)%' or v_src like '%is_call_center%' then
    raise exception 'request_branch_delivery_pause has the wrong gate';
  end if;

  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resolve_branch_delivery_request';
  if v_src not like '%is_call_center()%' or v_src like '%is_branch_operator%' then
    raise exception 'resolve_branch_delivery_request has the wrong gate';
  end if;
  -- The accept path must REUSE the pause RPC, not re-implement it.
  if v_src not like '%public.set_branch_delivery_pause(%' then
    raise exception 'resolve_branch_delivery_request does not call set_branch_delivery_pause';
  end if;
  if v_src like '%update public.branches%' then
    raise exception 'resolve_branch_delivery_request writes branches directly -- it must go through the pause RPC';
  end if;

  -- (c) No client write policy may exist on the request table.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'branch_delivery_requests'
     and cmd <> 'SELECT';
  if v_n <> 0 then
    raise exception 'branch_delivery_requests must have no non-SELECT policy, found %', v_n;
  end if;

  -- (d) One open request per branch must be structural.
  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and indexname = 'bdr_one_open_per_branch';
  if v_n <> 1 then
    raise exception 'the one-open-request-per-branch index is missing';
  end if;

  -- (e) The widened signal vocabulary must admit the new kind and keep the old.
  select count(*) into v_n from pg_constraint
   where conrelid = 'public.ops_change_events'::regclass
     and conname = 'ops_change_events_kind_check'
     and pg_get_constraintdef(oid) like '%delivery_request%'
     and pg_get_constraintdef(oid) like '%availability%'
     and pg_get_constraintdef(oid) like '%delivery%'
     and pg_get_constraintdef(oid) like '%area%';
  if v_n <> 1 then
    raise exception 'ops_change_events kind check was not widened correctly';
  end if;

  -- (e2) Expiry must RETURN, not raise: a raise would roll back the retirement
  --      and leave the request pending forever (CASE 14).
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resolve_branch_delivery_request';
  if v_src not like '%''status'', ''expired''%' then
    raise exception 'resolve_branch_delivery_request no longer returns an expired result';
  end if;

  -- (f) Applying this must not have closed delivery anywhere.
  select count(*) into v_n from public.branch_delivery_requests;
  if v_n <> 0 then
    raise exception 'the request table must be created empty, found % rows', v_n;
  end if;

  raise notice 'branch delivery requests installed; delivery boundary unchanged';
end
$verify$;
