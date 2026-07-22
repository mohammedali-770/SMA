# Operations Health Center — Telemetry Sources

| subsystem | source | provider probe | determines overall state |
|---|---|---:|---:|
| Lazywait Sync | `lazywait_sync_health_summary()` | no | yes |
| Order Integrity | `order_integrity_health_summary()` | no | yes |
| Account Deletion | pg_cron execution evidence + queue aggregates | no | yes |
| Database Jobs | allowlisted `cron.job` + `cron.job_run_details` | no | yes |
| Payment / Tap | `payment_records` + payment-related integrity incidents + safe integration metadata | no | no |
| Push | `push_devices` + `notification_log` + safe integration metadata | no | no |
| Email / SMTP | safe integration metadata only | no | no |
| WhatsApp / OTP | safe integration metadata only | no | no |

The absence of a provider probe is explicit. Optional configured integrations
are `not_monitored`, not `healthy`.
