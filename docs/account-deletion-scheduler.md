# Account deletion scheduler

## Production configuration

- Cron job: `account-deletion-processor`
- Schedule: `* * * * *` (every minute)
- Scheduler gateway: `account-delete-scheduler`
- Queue processor: `account-delete-process`
- Vault secrets:
  - `account_deletion_project_url`
  - `account_deletion_process_secret`
- Scheduler SQL: `supabase/migrations/20260716170000_account_deletion_scheduler.sql`

The cron job stores only `select public.invoke_account_deletion_processor();`. The helper reads the endpoint and dedicated credential from Supabase Vault at runtime and invokes `account-delete-scheduler` through `pg_net`. The gateway verifies the Vault credential through the restricted database RPC and forwards the request to `account-delete-process` using its built-in service-role credential. The service-role key is never placed in Vault, Git, cron.job, or the request sent by Postgres.

## Monitoring

```sql
select jobid, jobname, schedule, active, command
from cron.job
where jobname = 'account-deletion-processor';

select status, count(*)
from public.account_deletion_requests
group by status
order by status;

select *
from cron.job_run_details
where jobid = (
  select jobid from cron.job where jobname = 'account-deletion-processor'
)
order by start_time desc
limit 20;
```

Inspect Edge Function logs for scheduled POST responses and `net._http_response` for recent HTTP status codes. Never select or print decrypted Vault values during routine monitoring.

## Rollback

```sql
select cron.unschedule('account-deletion-processor');
drop function if exists public.invoke_account_deletion_processor();
```

Removing the dedicated Vault entries or the scheduler gateway is a separate operational action and should happen only after confirming no remaining scheduler or diagnostic path uses them. The account-deletion database migrations, queue, request function, and processor function are not removed by this scheduler rollback.

## Supabase API keys (2026-11-09)

The scheduler and the post-request kick reach `account-delete-process` with
`serviceCallHeaders(secretKey())` from `supabase/functions/_shared/apiKeys.ts`,
and the processor recognises them with the shared constant-time `isServiceCall`.
While only legacy keys exist the wire format is unchanged; once a secret key
exists it travels on `apikey` alone. The Vault-held `x-process-secret` path is
untouched.

**Step 9 cleanup (2026-11-18, merged only after step 8 held):** the legacy
fallback is gone. The scheduler answers 503 `scheduler_unavailable` when
`SUPABASE_SECRET_KEYS` holds no `sb_secret_…` key, even if
`SUPABASE_SERVICE_ROLE_KEY` is still set; the processor no longer accepts the
legacy `Bearer <service_role>`. `handler_test.ts` pins both. All three
account-deletion functions need a redeploy for it (`docs/SUPABASE_API_KEYS.md`
§3, step 9). Deploy order (processor before its callers) and rollback:
`docs/SUPABASE_API_KEYS.md` §3.

**Deployed 2026-11-18.** `account-delete-process` v5 → **v6**, then
`account-delete-scheduler` v4 → **v5**, both from the default branch at
`5c78d17`, every file byte-identical, `verify_jwt = false` as `config.toml` sets
it. 0 deletion requests were open at the time. Before v6, the processor refused
the new key: once the new keys existed, `account-delete-request` v5 (already on
the new code) sent its post-request kick with the secret key, and live v5 refused
it with 403. No customer was affected, because the scheduled run still used the
legacy key. Detail: `docs/SUPABASE_API_KEYS.md` §3 "Progress".

## Tests (2026-11-12)

The gateway's request handler lives in
`supabase/functions/account-delete-scheduler/handler.ts`; `index.ts` keeps only
`Deno.serve(handler)`. The handler body was moved verbatim, so the deployed
function's behaviour is unchanged and **no redeploy is needed or implied**. The
next deploy, whenever one is approved, simply bundles one more local module.

`handler_test.ts` beside it calls that handler under `deno test`, with `fetch`
stubbed and no `--allow-net`, and pins every branch: CORS preflight, 405 for
any other method, 503 when `SUPABASE_URL` or the service key is missing, 403
with no `x-process-secret`, 403 when the RPC refuses, errors or answers anything
but `true` (the processor is never called), the forward to
`account-delete-process` in both key formats (legacy: `apikey` and a bearer;
opaque: `apikey` only, on the RPC call as well), the processor's status, body
and content type relayed, and 502 when the processor is unreachable. The
`Edge Function typecheck (Deno)` CI job runs it:

```bash
deno test --no-lock --node-modules-dir=none --allow-env supabase/functions/*/*_test.ts
```

## The app's sign-out after a deletion request (2026-11-24)

After the deletion request is accepted, the confirmation screen signs the
customer out and then leaves for the login screen. `auth.signOut` now throws when
supabase-js reports a failed server call (it keeps the stored session in that
case, audit finding F-TA3-001). The screen therefore stays put, lets Done be
pressed again and says "Could not sign out" instead of leaving for the login
screen over a live session. The deletion request itself is already accepted and
is unaffected. The Arabic of that message is engineering-drafted and joins the
native-read list in `docs/OWNER_ACTIONS.md` section 35.

## Staff accounts never leave through this queue (F-X05-001, 2026-11-24)

`account-delete-request` re-verifies with a code to the account's own phone or its
own password, which is an AAL1 session, and `create_account_deletion_request`
takes only a user id. For an administrator, accountant, branch or call-centre
account that path skipped both the AAL2 requirement every staff gate carries and
the last-administrator rule in `admin_set_user_role`, and the processor would
then call `auth.admin.deleteUser`. It is now closed in two places:

- **`account-delete-request`** reads the caller's `profiles.role` (the id comes
  from the verified JWT, never the body) before either action, and answers 403
  `staff_account` for any role other than `customer`. A failed read answers 500
  `role_check_failed` — it never falls through. A user with no profile row is
  treated as a customer, since no staff predicate is true for them. It is an
  allow-list, so a role added to the enum later is refused until someone decides.
- **`account-delete-process`** holds a staff account in `manual_review` with the
  reason `staff_account_requires_admin` before it checks blockers, anonymises or
  deletes anything. That covers a request queued before the refusal shipped and an
  account promoted after it was queued, and it is what keeps the last
  administrator from being removed: every administrator is held, not only the last.
  An administrator resolves it with `resolve_account_deletion_request`.

Staff leave through `staff-accounts` (branch and call centre, which asks
`is_admin()`: role and AAL2) or an administrator's own process. There is
deliberately no "administrator at AAL2 may delete themselves" exception here; if
one is wanted it needs its own decision, including how the last administrator is
protected. Customers are unchanged. **Both functions were deployed 2026-11-24**
(`account-delete-request` v9, byte-identical to the repository;
`account-delete-process` v10, whose `index.ts` was compared with the source by eye
because the script read-back could not be run). The decision is `decideDeletionAccountGuard` in
`supabase/functions/_shared/accountDeletion.ts`; the handlers are pinned by
`accountDeletionStaffWiring.test.ts`.
