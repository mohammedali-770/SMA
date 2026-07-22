# Operations Health Center — Security Model

## Authorization

- The aggregate RPC is granted to `authenticated` only.
- The first statement enforces `public.is_staff()` and raises SQLSTATE `42501`
  for customers or non-staff callers.
- The function is `SECURITY DEFINER`, `STABLE`, and pins
  `search_path = public`.
- The deterministic overall-state helper is service-role-only and is not
  client-executable.

## Data minimization

The RPC returns safe status fields, timestamps, and aggregate counts only. It
never returns integration secrets, API credentials, push tokens, customer PII,
raw provider messages, full payment references, cron commands, usernames,
database names, or cron return messages.

Integration configuration is reduced to booleans such as `enabled` and
`configured`, plus the non-secret provider name and safe public mode/currency
where operationally useful.

## Failure isolation

Each subsystem query has its own PL/pgSQL exception boundary. A failure is
reported with a SQLSTATE-only `safe_error_code` and state `unavailable`; raw
error text is never returned. Critical unavailable systems degrade the overall
state rather than producing a false healthy result.

The client also has a safe fallback for network/auth/transient RPC failures. It
renders all systems unavailable and the platform degraded, using only the fixed
code `client_fetch_failed`.

## No operational actions

The migration adds no trigger, cron job, provider request, dispatcher, retry,
refund, resend, or auto-remediation path. The web panel offers Refresh and safe
navigation only.
