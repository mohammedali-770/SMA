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
untouched. Deploy order (processor before its callers) and rollback:
`docs/SUPABASE_API_KEYS.md` §3.

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
