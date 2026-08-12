# Spicy Meal Documentation Hub

This directory contains both **current operating documentation** and **historical audit evidence**. Use this page to tell them apart.

> If a document conflicts with current source code, a newer dated decision, or `CLAUDE.md`, do not silently assume the older text is still authoritative. Fix the documentation in the same PR.

## Start here

| Document | Use it for |
| --- | --- |
| [`../README.md`](../README.md) | High-level project overview, tech stack and local setup |
| [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md) | Current engineering/release status and onboarding |
| [`../README_MOBILE.md`](../README_MOBILE.md) | Expo/EAS/mobile-specific development and builds |
| [`../CLAUDE.md`](../CLAUDE.md) | Mandatory repository and production change-control rules |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Current system topology and authority boundaries |

## Development and architecture

| Document | Scope |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Customer app, admin app, Supabase, integrations and data flow |
| [`NODE_VERSION.md`](NODE_VERSION.md) | Node 22 repository standard |
| [`DEV_VISUAL_REVIEW.md`](DEV_VISUAL_REVIEW.md) | Safe visual/fixture review workflow |
| [`BUTTON_FIELD_INVENTORY.md`](BUTTON_FIELD_INVENTORY.md) | Historical design-system migration inventory; useful for provenance, not current UI authority |
| [`../design-system/`](../design-system/) | Canonical shared design-system source |

## Release and deployment

| Document | Scope |
| --- | --- |
| [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) | Required release checks and post-merge verification |
| [`DEPLOY.md`](DEPLOY.md) | Vercel deployment behavior and verification |
| [`ROLLBACK.md`](ROLLBACK.md) | Per-surface rollback/mitigation guidance |
| [`DEPENDENCY_ADVISORIES.md`](DEPENDENCY_ADVISORIES.md) | Dependency audit policy and reviewed exceptions |
| [`OWNER_ACTIONS.md`](OWNER_ACTIONS.md) | Items that require owner/dashboard/business/legal decisions |

## Database and backend operations

| Document | Scope |
| --- | --- |
| [`MIGRATIONS.md`](MIGRATIONS.md) | **Authoritative** production migration ledger and apply workflow |
| [`BACKUP_RECOVERY.md`](BACKUP_RECOVERY.md) | Backup/PITR state and restore procedure |
| [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) | Incident handling and operational limitations |
| [`OPERATIONS_ALERTS_DIGEST.md`](OPERATIONS_ALERTS_DIGEST.md) | Operations alerts/digest behavior |
| [`../supabase/functions/README.md`](../supabase/functions/README.md) | Current Edge Function inventory and security boundary |

## Product/business behavior

| Document | Scope |
| --- | --- |
| [`ORDER_CONFIRMATION_FLOW.md`](ORDER_CONFIRMATION_FLOW.md) | Customer-visible order/POS confirmation lifecycle |
| [`DISCOUNTS_CAMPAIGNS.md`](DISCOUNTS_CAMPAIGNS.md) | Campaign/discount schema and unresolved business decisions |
| [`PAYMENT_POSTPONEMENT.md`](PAYMENT_POSTPONEMENT.md) | **Authoritative payment/refund freeze** while provider choice is unresolved |
| [`BRANCH_ONBOARDING.md`](BRANCH_ONBOARDING.md) | Restaurant-branch onboarding checklist |
| [`STAFF_MANUAL.md`](STAFF_MANUAL.md) | Staff operating guide |
| [`MAPS.md`](MAPS.md) | Map-provider setup and constraints |

## Observability and security

| Document | Scope |
| --- | --- |
| [`SENTRY_OBSERVABILITY.md`](SENTRY_OBSERVABILITY.md) | Native/mobile Sentry runbook |
| [`SENTRY_WEB_OBSERVABILITY.md`](SENTRY_WEB_OBSERVABILITY.md) | Admin/web Sentry runbook |
| [`../SECURITY.md`](../SECURITY.md) | Vulnerability reporting/security contact policy |

## Git/repository history

These documents are useful evidence, but they should not be treated as active branch/work queues.

| Document | Status |
| --- | --- |
| [`GIT_BRANCHES.md`](GIT_BRANCHES.md) | Current branch policy plus the result of the August 2026 cleanup |
| [`BRANCH_FEATURE_RETENTION_AUDIT.md`](BRANCH_FEATURE_RETENTION_AUDIT.md) | Final feature-retention evidence used before historical branches were deleted |
| [`BRANCH_DELETION.md`](BRANCH_DELETION.md) | Restaurant-branch deletion behavior, **not** Git branch cleanup |

## Documentation maintenance rule

When behavior changes, update the owning document in the same PR. Avoid adding a second document that restates the same current-state fact.

Prefer this ownership model:

- Product/repository overview → root `README.md`
- Current release state → `PROJECT_STATUS.md`
- Mobile/EAS details → `README_MOBILE.md`
- Architecture/invariants → `docs/ARCHITECTURE.md`
- Release procedure → `docs/RELEASE_CHECKLIST.md`
- Database truth → `docs/MIGRATIONS.md`
- Payment freeze → `docs/PAYMENT_POSTPONEMENT.md`
- Git branch state → `docs/GIT_BRANCHES.md`
- Agent/change-control rules → `CLAUDE.md`

Historical measurements, one-off audits and incident evidence should be clearly dated and labeled as snapshots so they are not mistaken for the current system.