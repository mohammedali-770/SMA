# Operations Health Center v1 — Limitations

- Tap, SMTP, Expo, WhatsApp, and SMS provider availability is not tested.
- Refund health is unavailable because the current schema has no trustworthy
  refund lifecycle.
- Provider-side captures absent from the database cannot be detected without a
  separately approved reconciliation job.
- The page does not dispatch alerts; it is an operator dashboard only.
- Historical initiated payment records are shown for context, but only recent
  stale initiations are elevated to an attention item to avoid treating known
  legacy/test data as a new incident.
