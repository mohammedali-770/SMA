-- ============================================================================
-- Account deletion scheduler runtime dependencies
--
-- Enables pg_net for asynchronous HTTP invocation and pg_cron for the recurring
-- account-deletion processor job. The actual Production cron job and Vault
-- entries are environment-specific operational configuration and are created
-- separately after this migration is applied.
-- ============================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
