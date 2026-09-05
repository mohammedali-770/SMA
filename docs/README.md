# Spicy Meal documentation

Spicy Meal is First Taste Trading Company's ordering platform: a customer app for iOS, Android and web, a staff and admin console, and a Supabase backend that connects them to the branch point-of-sale.

This is the entry point to everything written about it. If you are looking for something specific, use [find it by task](#find-it-by-task). If you are new, read [Architecture](ARCHITECTURE.md) and then the runbook for whatever you are about to touch.

## How this documentation stays true

Documentation rots. This set is built so that the parts most likely to rot cannot, and the rest is forced to keep up. Every document belongs to exactly one of three layers, and the layer determines who maintains it and what happens when it falls behind.

| Layer | What it is | Kept true by |
| --- | --- | --- |
| **Generated** | Inventories: routes, Edge Functions, database objects, tests, environment variables, CI gates | A generator rewrites them from source. `npm run docs:check` fails CI if they drift. |
| **Owned** | Runbooks, integration contracts, operational decisions | [`ownership.json`](ownership.json) maps source paths to the document that must change with them. CI fails a change that touches owned code without touching its document. |
| **Curated** | Architecture, manuals, decision records | Human judgement, review, and the rule in [CLAUDE.md §14](../CLAUDE.md) that documentation changes ship in the same pull request as the behaviour they describe. |

The practical consequence: **adding a route, an Edge Function, a table or an environment variable turns CI red until you regenerate.** Changing payments, push, WhatsApp sign-in, the POS integration, account deletion, the order lifecycle, maps or a deploy path turns CI red until you update the owning document. That is deliberate. See [Contributing to the documentation](CONTRIBUTING.md).

```sh
npm run docs:generate   # rewrite the generated reference
npm run docs:check      # what CI runs: drift + ownership
```

> **A standing warning about live state.** Nothing in this repository can prove what production currently holds. Source describes source. Dashboard settings, deployed function versions, Supabase configuration and store console state all change independently of Git. Where a document states a live fact it carries the date it was verified and how. Treat an undated live claim as unverified, and check it read-only rather than assuming — or writing.

## Find it by task

### I am changing something

| I want to… | Start with |
| --- | --- |
| Understand how the pieces fit together | [Architecture](ARCHITECTURE.md) |
| Find the code behind a screen or panel | [Application surface](reference/app-surface.md) |
| Know what an Edge Function does and how it deploys | [Edge Functions](reference/edge-functions.md) |
| Find a table, RPC or policy | [Database objects](reference/database.md) |
| See whether something is already tested | [Test inventory](reference/testing.md) |
| Know which environment variables exist and which are public | [Environment variables](reference/environment.md) |
| Know which CI check is which | [CI gates and scripts](reference/ci-and-scripts.md) |
| Write or change a migration | [Migration workflow](MIGRATIONS.md) · [latest live reconciliation](MIGRATION_RECONCILIATION_20260812.md) |
| Follow the repository's change-control rules | [CLAUDE.md](../CLAUDE.md) |
| Add or change documentation | [Contributing to the documentation](CONTRIBUTING.md) |

### I am operating the system

| I want to… | Start with |
| --- | --- |
| Run a shift on the admin console | [Staff manual](STAFF_MANUAL.md) |
| Handle an incident | [Incident response](INCIDENT_RESPONSE.md) |
| Undo something that shipped | [Rollback](ROLLBACK.md) |
| Understand an alert I have been paged about | [Operations alerts digest](OPERATIONS_ALERTS_DIGEST.md) · [Health center](OPERATIONS_HEALTH_CENTER.md) |
| Investigate a stranded or missing order | [Order integrity watchdog](ORDER_INTEGRITY_WATCHDOG.md) · [Order confirmation flow](ORDER_CONFIRMATION_FLOW.md) |
| Bring a new restaurant branch online | [Branch onboarding](BRANCH_ONBOARDING.md) |
| Remove a restaurant branch | [Branch deletion](BRANCH_DELETION.md) |
| Restore data | [Backup and recovery](BACKUP_RECOVERY.md) |
| See what needs a decision from the owner | [Owner actions](OWNER_ACTIONS.md) |
| Judge whether the product can launch at all | [Go-live readiness](GO_LIVE_READINESS.md) |
| Know what the two app stores require of a first submission | [Store submission](STORE_SUBMISSION.md) |

### I am releasing

| I want to… | Start with |
| --- | --- |
| Ship a release | [Release checklist](RELEASE_CHECKLIST.md) |
| Understand how deployment works | [Deploy](DEPLOY.md) |
| Build for a store or TestFlight | [Mobile guide](../README_MOBILE.md) |
| Submit to the App Store or Play for the first time | [Store submission](STORE_SUBMISSION.md) |
| Check dependency advisories | [Dependency advisories](DEPENDENCY_ADVISORIES.md) |
| Know the Node version | [Node version](NODE_VERSION.md) |
| Follow branch policy | [Git branches](GIT_BRANCHES.md) |

### I am working on an integration

| Integration | Document |
| --- | --- |
| Lazywait POS | [Lazywait](LAZYWAIT.md) · [API reference](integrations/Lazywait_API_Reference.md) · [pilot](LAZYWAIT_PILOT.md) · [open questions](lazywait-delivery-open-questions.md) |
| WhatsApp sign-in and OTP | [WhatsApp login](WHATSAPP_LOGIN.md) · [OTP autofill findings](OTP_AUTOFILL.md) |
| Push notifications | [Owner actions §10](OWNER_ACTIONS.md) · [CLAUDE.md §7](../CLAUDE.md) |
| Payments | [Payment postponement](PAYMENT_POSTPONEMENT.md) — **frozen**, read this first |
| Maps | [Maps](MAPS.md) |
| Sentry | [Mobile](SENTRY_OBSERVABILITY.md) · [Web and admin](SENTRY_WEB_OBSERVABILITY.md) |
| Account deletion | [Deletion scheduler](account-deletion-scheduler.md) |
| Email | [Owner actions](OWNER_ACTIONS.md) |

### I want to know why something is the way it is

| | |
| --- | --- |
| [Decision records](decisions/README.md) | Why a choice was made, what was rejected, and what it costs |
| [Payment postponement](PAYMENT_POSTPONEMENT.md) | Why payments are frozen and what the freeze covers |
| [Discounts and campaigns](DISCOUNTS_CAMPAIGNS.md) | The schema, and the business questions still open |
| [Security review](SECURITY_REVIEW.md) | Security posture and findings |
| [Security policy](../SECURITY.md) | How to report a vulnerability |

## Reference

Generated from source on every run. Do not edit by hand — see [`reference/`](reference/README.md).

- [Application surface](reference/app-surface.md)
- [Edge Functions](reference/edge-functions.md)
- [Database objects](reference/database.md)
- [Test inventory](reference/testing.md)
- [Environment variables](reference/environment.md)
- [CI gates and scripts](reference/ci-and-scripts.md)

## Historical evidence

Useful as provenance. **Not** current-state authority, and not a work queue.

| Document | What it is |
| --- | --- |
| [Migration reconciliation, 12 Aug 2026](MIGRATION_RECONCILIATION_20260812.md) | Latest dated read-only production migration snapshot |
| [Migrations ledger](MIGRATIONS.md) | Historical workflow and provenance record; its classification counts are a dated Aug 7 snapshot |
| [Address delete runbook](MIGRATION_RUNBOOK_20260801_ADDRESS_DELETE.md) | A specific migration, start to finish |
| [Branch feature retention audit](BRANCH_FEATURE_RETENTION_AUDIT.md) | Evidence gathered before historical Git branches were deleted |
| [Button and field inventory](BUTTON_FIELD_INVENTORY.md) | Design-system migration inventory |
| [Health center baseline](OPERATIONS_HEALTH_CENTER_BASELINE.md) · [rollback](OPERATIONS_HEALTH_CENTER_ROLLBACK.md) | Point-in-time operational evidence |
| [Readiness reviews](readiness/) | Dated pull-request review evidence |
| [Development visual review](DEV_VISUAL_REVIEW.md) | Fixture-based review workflow |

## Where things live

```
README.md              project overview and local setup
README_MOBILE.md       Expo, EAS and mobile builds
PROJECT_STATUS.md      engineering and release status
CLAUDE.md              mandatory change-control rules
SECURITY.md            vulnerability reporting

docs/
  README.md            this page
  CONTRIBUTING.md      how to write and maintain documentation
  ownership.json       source path → owning document map, enforced in CI
  reference/           GENERATED — regenerate, never edit
  decisions/           architecture decision records
  integrations/        third-party API references
  readiness/           dated review evidence
  *.md                 runbooks, integration contracts, operational guides
```
