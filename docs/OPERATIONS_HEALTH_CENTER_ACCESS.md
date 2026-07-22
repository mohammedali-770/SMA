# Operations Health Center — Role Access

- **Admin:** safe read-only health view and links to existing admin panels.
- **Accountant/staff:** the same safe read-only health view; no triage or
  configuration actions are added.
- **Customer/non-staff:** denied by `is_staff()` with SQLSTATE `42501` and has no
  dashboard access.

The Health Center does not duplicate the Order Integrity Acknowledge/Suppress
controls. Those remain admin-only in the existing Order Integrity panel.
