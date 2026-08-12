# Spicy Meal — Supabase Backend

> **Updated 2026-08-12.** Supabase is the live backend for the customer app and staff/admin console. This is no longer a disconnected “foundation” project.

The `supabase/` tree contains the database migration history, SQL regression suites, Edge Functions and local CLI configuration for the production backend architecture.

## Directory layout

```text
supabase/
  config.toml             Local Supabase CLI/function invocation configuration
  migrations/             Forward-only database migrations
  functions/              Deno Edge Functions + shared server helpers
  tests/                  SQL regression/security/integrity suites
  seed.sql                Local/test seed data only
```

The authoritative migration workflow/history document is `docs/MIGRATIONS.md`. Its last full live-count reconciliation was Aug 7; later Aug 10 migration files mean the current live relationship needs a fresh read-only reconciliation (`docs/OWNER_ACTIONS.md` §12).

## Current backend responsibilities

Supabase currently provides:

- Auth / JWT identity.
- WhatsApp-delivered customer phone login through the Supabase Auth hook.
- PostgREST/RPC data access.
- Row Level Security and server-side staff/customer authorization.
- Catalog, branches, modifiers, availability and delivery zones.
- Customer profiles and saved addresses.
- Server-authoritative order placement and lifecycle.
- Loyalty and coupon/accounting contracts.
- Lazywait POS synchronization, callbacks and operational state.
- Account-deletion queue/processing/audit.
- Operations Health / alerts / integrity checks.
- Audited staff role administration and AAL2/TOTP staff authorization.
- Edge Function provider/server boundaries.

Payment/refund source remains present but **frozen/provisional** while the final provider is unresolved. Push source remains **dormant** by product decision.

## Security model

### Clients

The customer and admin clients use:

- Supabase project URL;
- anon/publishable key;
- user JWT/session.

The anon/publishable key is not a server secret. RLS, JWT identity, server predicates and SECURITY DEFINER contracts are the authorization boundary.

### Server-only

The following must never be exposed to a browser/mobile bundle:

- service-role key;
- provider secret keys;
- Meta app secret;
- SMTP password;
- payment/refund secrets;
- private operational scheduler secrets.

Edge Functions and approved server-side database paths are the only places that may use those credentials.

## Staff authorization

Do **not** use the historical `update profiles set role='admin'` shortcut as routine staff administration.

Current production hardening provides audited role-administration RPCs, a Staff Access admin UI and TOTP/AAL2 requirements for privileged staff paths.

If a brand-new/recovered environment has no administrator at all, initial bootstrap is a privileged recovery/setup operation. Approve/document the exact method separately; do not normalize a direct SQL role mutation into the normal onboarding workflow.

## Order/data integrity

The backend owns final business facts. Client UI validation is convenience, not authority.

Current hardening includes server/database enforcement for areas such as:

- authenticated order ownership;
- branch/order-type requirements;
- product/modifier relationships;
- required/min/max modifier cardinality;
- current monetary calculations;
- order lifecycle transitions;
- cancellation loyalty/coupon compensation;
- historical VAT snapshots;
- customer-safe order identifiers;
- staff role/MFA boundaries.

See `docs/ARCHITECTURE.md` for the system-level trust model.

## Local development

### Local Supabase

For local/disposable development only:

```bash
supabase start
supabase db reset
```

`db reset` applies the repository migration chain to the local stack and loads local seed behavior as configured.

### SQL suites

SQL tests are designed for disposable/local databases/CI harnesses. Never point them at Production.

The CI SQL gate replays the migration chain and runs the regression suites when relevant database paths change.

## Production migration rules

### Never use these against Production

```text
supabase db push
supabase migration repair
```

These commands are permanently forbidden for the Production project because repository filename timestamps and live migration-history versions intentionally diverge.

### Approved production model

1. Add a new forward-only migration file.
2. Add/update its regression suite.
3. Review and merge the source through a PR.
4. Reconcile the live migration state read-only before assuming it is unapplied.
5. Obtain separate explicit owner approval for live application.
6. Apply only through the approved migration workflow documented in `docs/MIGRATIONS.md`.
7. Verify live object state/data impact.
8. Update the migration ledger with verified evidence.

Merge approval is **not** migration-application approval.

## Current migration count caveat

The Aug 7 ledger snapshot recorded 68 repository migration files / 70 live migration-history rows and zero repository-only migrations **at that time**.

Merged Aug 10 readiness work added 11 more migration files, bringing the current source count to **79**. That does not prove which ones are currently represented in live Production history.

Until the read-only reconciliation in `docs/OWNER_ACTIONS.md` §12 is completed, do not copy the old `0 unapplied` value into new docs/release decisions.

## Edge Functions

See [`functions/README.md`](functions/README.md) for the current function inventory and invocation/security model.

Important principles:

- `verify_jwt=true` functions still need correct role/RLS behavior.
- `verify_jwt=false` functions must authenticate through their own external/service contract.
- provider secrets remain server-side;
- deployment is an explicit owner-approved production action;
- payment functions remain frozen even though they exist in source;
- push remains dormant even though `push-dispatch` exists.

## Lazywait

Lazywait is an active operational integration. The backend includes:

- catalog/mapping support;
- synchronization worker;
- webhook handling;
- retry/deadline/fencing logic;
- confirmation-required handling for ambiguous POS-create outcomes;
- operational verification/health signals.

Never blindly retry an ambiguous Create Order response; the lifecycle is designed specifically to avoid duplicate POS tickets.

## WhatsApp authentication

There are two separate server paths and they must stay conceptually separate:

1. **Customer login delivery** — Supabase Auth owns the OTP/session; `auth-send-sms-whatsapp` only delivers the Auth-generated code.
2. **Signed-in profile phone verification** — custom verification challenge/functions; does not create/login an Auth session.

See `functions/README.md` for details.

## Account deletion

Account deletion is not a direct `delete profiles` action. The system has a verified/requested workflow, processing queue, anonymization/erasure behavior and manual-review resolution/audit controls.

Restore/rebuild work must also respect this lifecycle and its database objects.

## Local seed data

`seed.sql` is for local/test environments. Do not treat seed rows as Production configuration or customer data, and do not use a seed command against Production.

## Related documentation

- `../docs/README.md` — documentation index.
- `../docs/ARCHITECTURE.md` — current topology/trust boundaries.
- `../docs/MIGRATIONS.md` — migration workflow/history ledger.
- `../docs/OWNER_ACTIONS.md` — current live-reconciliation/owner decisions.
- `../docs/PAYMENT_POSTPONEMENT.md` — payment/refund freeze.
- `../docs/BACKUP_RECOVERY.md` — backup/restore state.
- `functions/README.md` — Edge Functions.