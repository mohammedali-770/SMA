# Rollback and Mitigation

> **Updated 2026-08-12; §5 updated 2026-11-11.** Rollback differs by surface. Use the smallest safe mechanism, preserve auditability, and do not bypass owner/production controls because the word “rollback” sounds safer than “deploy.”

## 1. First identify the failing surface

| Surface | Primary mitigation |
| --- | --- |
| Admin + customer web (`/` and `/app`) | point Vercel Production back to a known reviewed artifact, then revert through a PR |
| Edge Function | redeploy a known reviewed prior source through the controlled owner-approved workflow |
| Native iOS/Android | halt rollout / submit a fixed build; there is no instant JS OTA path in the current architecture |
| Database schema | forward corrective migration or approved data restore; no `down` migration path |
| Live provider/config | use the supported control or separately approved dashboard/provider action |

Before rollback, verify the problem is not a provider outage or dashboard/env change unrelated to the code release.

## 2. Web/admin fast mitigation

Both browser surfaces are one Vercel project/build.

If a newly deployed artifact is clearly responsible:

1. Vercel → Deployments.
2. Select the last **known reviewed good** Production artifact.
3. Use the current Vercel rollback/promote mechanism to repoint Production.
4. Verify the Production alias now serves that artifact/commit.
5. Open a normal revert/fix PR so the production branch returns to the intended source state.

Do not leave Production permanently serving an artifact that differs from the production branch without documenting that emergency state.

### Source revert

Create a fresh branch from the current production branch and revert/fix there. Open a PR; do not push the revert directly to production.

A source revert can be unsafe if the database or provider configuration has already moved forward. Check schema/config compatibility before reverting client code.

## 3. Edge Function rollback

Edge Function rollback is itself a **Production deployment**.

Do not use the old direct CLI pattern from historical docs as the normal response path.

Safe approach:

1. Identify the last reviewed commit whose function behavior is known good.
2. Prepare the intended function source on a fresh branch/PR or, during an explicitly approved emergency, identify the exact prior source to redeploy.
3. Verify `supabase/config.toml` invocation/auth settings for that function.
4. Obtain the required explicit owner approval.
5. Use the controlled deployment workflow with the exact function name(s).
6. Verify behavior and logs/health after deployment.
7. Record the deployed source commit/version as incident evidence.

### Payment functions

*Changed 2026-11-12: this said the payment functions were frozen. The owner chose Moyasar on 2026-11-11 (CLAUDE.md §6).*

An incident does **not** automatically authorize changing or redeploying a payment function. Every payment deploy is its own owner approval.

- **The fast mitigation is not a redeploy.** Switch online payment off: console → Settings → Payment Methods → Online Payment off. Switching off is always allowed, and cash continues. It stops new checkout sessions only: a session opened before the switch can still be resumed and paid until it expires.
- **Redeploy the seven payment functions together**, from one known reviewed commit (`DEPLOY.md` §12). Never one alone: a new bundle beside an older one can open a Moyasar invoice that nothing confirms.
- **The July Tap-era bundles are not a rollback target** once the Moyasar-only set is live. They do not speak Moyasar, and after `20261004120000` the Tap functions they call no longer exist.

## 4. Native mobile rollback

The current mobile architecture does not provide a general-purpose EAS Update/OTA rollback channel.

For a bad store/native build:

- pause a staged/phased rollout where the store supports it;
- submit an approved fixed build;
- use server-side supported controls only when they are safe for both old and new clients;
- never make a breaking backend change solely to rescue the newest client while older installed versions still exist.

A native dependency/framework crash requires a new compatible native build; a Vercel rollback cannot change an installed iOS/Android binary.

Starting a new EAS/store build requires explicit owner approval.

## 5. Database rollback model

There is no automatic schema rollback/down path.

Production database changes are forward-only:

- never edit an applied migration;
- never run `supabase db push` against production;
- never run `supabase migration repair` to force history alignment;
- create a new corrective migration and apply it only through the approved process.

If the problem is **data loss/corruption**, a corrective DDL migration may not recover data. Follow `BACKUP_RECOVERY.md` before promising recovery: on 2026-11-11 the project is on Supabase's Free plan, which keeps no backups at all.

For the current applied and unapplied migrations, read CLAUDE.md §8 and `MIGRATIONS.md` §1. The counts move with every apply.

### A recorded rollback is valid only against the schema it was written for

Many migrations end with a rollback footer, and `MIGRATIONS.md` §9-B.4 captures
rollback SQL before each apply. Both describe how to undo that migration **against
the schema as it was then**. Every later migration can make them wrong, and nothing
warns you:

- **A `DROP FUNCTION` succeeds while other functions still call the dropped one.**
  PostgreSQL records a dependency for a view, a trigger or a column default, but not
  for a call made inside a function body written as a string. That covers every
  `plpgsql` function and every `language sql` function written `as $$ … $$`, which is
  all of them in this chain: it has no SQL-standard (`begin atomic`) bodies. So
  `pg_depend` sees none of the calls between its functions. The DROP reports
  success, and the failure arrives at the next call.
- **Re-applying an old function body silently reverts every later change to that
  function.**

So before you run any recorded rollback:

1. **Re-derive it** from the function's current definition, the last migration that
   defines it, not from the file the footer came from.
2. **Search the live function bodies for callers of each function it drops.**
   `pg_depend` will not find them. This is read-only:

   ```sql
   select n.nspname, p.proname
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosrc ~* '\morder_note_normalized\s*\('   -- the dropped name
     and p.proname <> 'order_note_normalized'
   order by 1, 2;
   ```

   Every row is a caller the rollback breaks, unless the same rollback also drops
   it. A comment that mentions the name matches too, so read each hit.
3. **For each function it re-applies, list the later migrations that define it:**
   `grep -l "create or replace function public.<name>(" supabase/migrations/*.sql`.
   Every file after the one the rollback came from is a change the rollback would
   undo.
4. **Then treat it as a corrective migration like any other:** reviewed, tested on
   the local chain, applied by name on owner approval.

**Two documented rollbacks are already unsafe for exactly these reasons.** Both were
measured on a disposable copy of the full chain on 2026-11-11:

- **`20260819120000_order_note_length_limit`** (`MIGRATIONS.md` §27). Its footer
  drops `order_note_normalized(text)`, which five later functions call:
  `place_order`, `compute_order_snapshot`, `insert_order_from_snapshot`,
  `enforce_order_item_note` (the trigger on every `order_items` insert) and
  `order_item_note_is_acceptable`. Every DROP succeeded, and the next call raised
  `function public.order_note_normalized(text) does not exist`. Following that
  footer stops every order.
- **`20260807150000_order_flow_health_card`** (`MIGRATIONS.md` §25). Its footer
  re-applies a July body of `operations_health_snapshot_internal`, which three later
  migrations have redefined. The snapshot lost the branch-availability card along
  with the order-flow card, and raised no error. The footer's second step, dropping
  the five-argument `operations_health_overall_state`, makes the current snapshot
  raise on every call.

Migration files are never edited, so both footers still read as they were written.

## 6. Configuration rollback

Many incidents are configuration rather than source:

- Vercel env variables;
- integration settings;
- branch/catalog controls;
- provider dashboards;
- scheduled jobs;
- staff roles/MFA;
- EAS secrets/credentials.

Rollback/change only the specific setting you understand and are authorized to change. Record old/new value **without copying secret material**.

Do not use a direct SQL mutation as a generic “fast rollback” when a supported audited path exists.

## 7. Payment/refund safety

*Changed 2026-11-12: this list applied "while payment work is frozen". It still applies; only the reason changed.*

- do not use a payment/refund transaction as a rollback smoke test;
- keep `payment-refund-worker` in its expected state: off until the owner re-enables it (`OWNER_ACTIONS.md` §47.16);
- after any environment restore/rebuild, re-verify its cron state before traffic;
- financial/provider correction is an explicit owner action.

## 8. Verify the rollback/mitigation

Verification must prove the actual affected path, not only that a dashboard became green.

### Web

- Production alias serves the intended artifact/commit.
- `/` and `/app` load the expected distinct applications.
- security headers remain present.
- customer/staff auth reaches the expected role/MFA flow.

### Backend

- affected RPC/function returns expected result;
- RLS/authorization boundary still holds;
- Operations Health / relevant integrity signals do not show a new failure;
- no unexpected provider side effect was triggered.

### Native

- fixed build installs/cold-launches on a physical device;
- native-only path that failed is explicitly re-tested.

### Database

- intended object/data state is verified read-only;
- migration ledger/status docs are updated after any approved live migration action;
- no hidden cron/provider action was activated by a rebuild.

## 9. After the immediate incident

Once customer impact is stopped:

1. bring production source/config back to a documented state;
2. open/finalize the corrective PR if the first action was an artifact-level emergency rollback;
3. document any manual dashboard/provider change;
4. add a regression test/guard when possible;
5. update `INCIDENT_RESPONSE.md` / relevant runbook if the actual recovery path differed from documentation.

## 10. Related docs

- `docs/INCIDENT_RESPONSE.md`
- `docs/DEPLOY.md`
- `docs/BACKUP_RECOVERY.md`
- `docs/MIGRATIONS.md`
- `docs/OWNER_ACTIONS.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/PAYMENT_POSTPONEMENT.md`