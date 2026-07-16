-- ============================================================================
-- DB-level test for processor fencing-token behavior + Auth-deleted recovery
-- (Issue 3). Runs on a disposable local DB with all migrations applied. NOT part
-- of the Vitest/CI suite (needs a database). RAISES on any failure.
--
-- Proves the guarantees the Edge processor's transition() helper relies on:
--   1. A status transition guarded by the WRONG fencing token matches NO row and
--      does not overwrite a newer owner's state (a stale processor cannot mark
--      completed / waiting / manual_review).
--   2. The CORRECT fencing token matches exactly one row.
--   3. Auth-deleted recovery: a request whose Auth user is gone (user_id NULL,
--      via ON DELETE SET NULL) and whose lease expired is re-claimable and can be
--      finalized to 'completed' — so an Auth deletion followed by a failed
--      completion transition recovers on a later run.
-- ============================================================================
begin;
set local session_replication_role = replica;  -- skip triggers/FKs for fixtures

do $$
declare
  v_uid     uuid := gen_random_uuid();
  v_req     public.account_deletion_requests;
  v_tok     uuid;
  v_tok_b   uuid;
  v_n       int;
  v_claimed int;
  v_status  text;
begin
  insert into public.profiles (id, full_name) values (v_uid, 'Fence Test');
  v_req := public.create_account_deletion_request(v_uid, 'reauth');

  -- Claim it → status 'processing' + a fencing token (future lease).
  perform public.claim_due_account_deletions(50, 300);
  select lock_token into v_tok from public.account_deletion_requests where id = v_req.id;
  if v_tok is null then raise exception 'FAIL: claim did not set a lock token'; end if;

  -- 1) A transition guarded by the WRONG token matches NO row (fencing), and the
  -- row is left untouched (a stale processor cannot overwrite newer state).
  update public.account_deletion_requests
     set status = 'completed', completed_at = now(), locked_until = null, lock_token = null
   where id = v_req.id and lock_token = gen_random_uuid();
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL(1): a wrong/stale fencing token matched a row'; end if;
  select status into v_status from public.account_deletion_requests where id = v_req.id;
  if v_status <> 'processing' then raise exception 'FAIL(1): stale transition overwrote state (%)', v_status; end if;

  -- 2) The CORRECT token matches exactly one row.
  update public.account_deletion_requests
     set status = 'waiting_for_active_order', next_attempt_at = now() + interval '6 hours',
         locked_until = null, lock_token = null
   where id = v_req.id and lock_token = v_tok;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'FAIL(2): correct fencing token matched % rows (expected 1)', v_n; end if;

  -- 3) Auth-deleted recovery: user_id NULL (Auth gone) + expired lease → the row
  -- is re-claimable and can be finalized to 'completed'.
  update public.account_deletion_requests
     set status = 'processing', user_id = null, next_attempt_at = now(),
         locked_until = now() - interval '1 minute', lock_token = gen_random_uuid()
   where id = v_req.id;
  select count(*) into v_claimed from public.claim_due_account_deletions(50, 300);
  if v_claimed < 1 then raise exception 'FAIL(3): auth-deleted stale-lease row was not reclaimed'; end if;
  select lock_token into v_tok_b from public.account_deletion_requests where id = v_req.id;
  update public.account_deletion_requests
     set status = 'completed', completed_at = now(), locked_until = null, lock_token = null
   where id = v_req.id and lock_token = v_tok_b;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'FAIL(3): recovery completion (user_id null) did not persist'; end if;
  select status into v_status from public.account_deletion_requests where id = v_req.id;
  if v_status <> 'completed' then raise exception 'FAIL(3): request not completed after recovery (%)', v_status; end if;

  raise notice 'account_deletion_fencing_test: ALL CASES PASSED';
end $$;

rollback;
