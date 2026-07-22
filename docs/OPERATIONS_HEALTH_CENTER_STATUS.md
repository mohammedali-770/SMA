# Operations Health Center — Current Status

Status: **repository-only / UNAPPLIED**.

Branch: `feature/operations-health-center`

Base commit: `411c7c9d82392dc7e7aaa6f74d942294361a5b47`

No Operations Health Center migration has been applied to Production. The
`operations_health_summary` RPC does not exist in Production, and the capability
gate therefore keeps the new tab hidden in any pre-application web deployment.

Merge approval and Production apply approval are separate. Nothing in this
branch authorizes a Production change.
