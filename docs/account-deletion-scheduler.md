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
