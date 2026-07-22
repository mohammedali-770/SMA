# Operations Health Center — Change Control

This feature requires:

1. a clean final-head Codex review;
2. explicit owner approval to merge;
3. a separate explicit owner approval to apply the migration to Production;
4. byte-exact application through the documented MCP `apply_migration` flow.

No `db push`, migration repair, untracked DDL, external provider call, or
notification/test message is authorized.
