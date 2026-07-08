-- ============================================================================
-- Spicy Meal — enable Supabase Realtime for the admin live-orders console.
--
-- postgres_changes only streams rows for tables added to the supabase_realtime
-- publication. Adding orders here lets the staff console receive INSERT/UPDATE
-- events (RLS still applies to each subscriber). Guarded + idempotent: on a
-- plain Postgres (no supabase_realtime publication) this is a harmless no-op,
-- and re-running never double-adds the table. The frontend also keeps a polling
-- fallback, so this is an enhancement, not a hard dependency.
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
    ) then
      execute 'alter publication supabase_realtime add table public.orders';
    end if;
  end if;
end $$;
