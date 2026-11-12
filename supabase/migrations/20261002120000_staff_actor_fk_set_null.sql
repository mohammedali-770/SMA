-- ============================================================================
-- STAFF ACTOR FOREIGN KEYS: ON DELETE SET NULL
--
-- WHAT WENT WRONG. Deleting a staff account removes its auth.users row, which
-- cascades to its profile (profiles_id_fkey). Four columns that record WHO did
-- something point at profiles with the default ON DELETE NO ACTION, so once a
-- staff member has done that thing, the cascade is refused with 23503 and the
-- console's staff "Delete" fails ("Database error deleting user"):
--
--   branch_delivery_requests.requested_by   (20260916120000; also NOT NULL)
--   branch_delivery_requests.resolved_by    (20260916120000)
--   branch_reference_entries.created_by     (20260917120000)
--   branch_reference_reveals.revealed_by    (20260917120000)
--
-- So any branch operator who ever filed a delivery-closure request or revealed a
-- reference secret, any call-centre user who resolved a request, and any admin
-- who created a reference entry could no longer be deleted. Offboarding fell back
-- to demotion, which keeps the person's name, phone and email: the opposite of
-- what the delete is for. Read live 2026-11-11: Production carries exactly these
-- four NO ACTION keys into profiles, and no others.
--
-- THE CONVENTION THIS RESTORES. Every other actor or audit column in this schema
-- already uses ON DELETE SET NULL: role_change_audit.changed_by,
-- comp_member_audit.changed_by, branch_delivery_events.changed_by,
-- loyalty_transactions.created_by and the rest. These four were the outliers.
--
-- WHAT IT COSTS, stated rather than hidden. After a staff account is deleted, its
-- requests, entries and reveal rows stay, but no longer say who filed, resolved,
-- created or revealed them. That is the trade the other audit tables already make.
-- bdr_resolution_coherent permits it: a resolved request must carry resolved_at,
-- not resolved_by. The console never reads any of these four columns (it selects
-- explicit column lists without them), so nothing renders a missing actor.
--
-- NOTHING ELSE CHANGES. No function is redefined, no row is written, and no
-- deploy is implied. place_order and compute_order_snapshot are asserted
-- unchanged below.
-- ============================================================================

alter table public.branch_delivery_requests
  alter column requested_by drop not null;

alter table public.branch_delivery_requests
  drop constraint if exists branch_delivery_requests_requested_by_fkey,
  add constraint branch_delivery_requests_requested_by_fkey
    foreign key (requested_by) references public.profiles(id) on delete set null;

alter table public.branch_delivery_requests
  drop constraint if exists branch_delivery_requests_resolved_by_fkey,
  add constraint branch_delivery_requests_resolved_by_fkey
    foreign key (resolved_by) references public.profiles(id) on delete set null;

alter table public.branch_reference_entries
  drop constraint if exists branch_reference_entries_created_by_fkey,
  add constraint branch_reference_entries_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.branch_reference_reveals
  drop constraint if exists branch_reference_reveals_revealed_by_fkey,
  add constraint branch_reference_reveals_revealed_by_fkey
    foreign key (revealed_by) references public.profiles(id) on delete set null;

-- ---- Self-verification ---------------------------------------------------------
-- One transaction: if any check fails, the whole file rolls back.
do $verify$
declare
  v_txt text;
  v_n   integer;
begin
  -- The four keys exist once each, and now set the actor to null.
  select count(*) into v_n
    from pg_constraint c
   where c.contype = 'f'
     and c.confrelid = 'public.profiles'::regclass
     and c.confdeltype = 'n'
     and (c.conrelid, c.conname) in (
       ('public.branch_delivery_requests'::regclass, 'branch_delivery_requests_requested_by_fkey'),
       ('public.branch_delivery_requests'::regclass, 'branch_delivery_requests_resolved_by_fkey'),
       ('public.branch_reference_entries'::regclass, 'branch_reference_entries_created_by_fkey'),
       ('public.branch_reference_reveals'::regclass, 'branch_reference_reveals_revealed_by_fkey'));
  if v_n <> 4 then
    raise exception 'staff actor keys verification failed: expected 4 ON DELETE SET NULL keys, found %', v_n;
  end if;

  -- SET NULL on a NOT NULL column would only move the failure from 23503 to 23502.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'branch_delivery_requests'
                and column_name = 'requested_by' and is_nullable = 'NO') then
    raise exception 'staff actor keys verification failed: requested_by is still NOT NULL';
  end if;

  -- The guard for the future: no key anywhere in public may block deleting a
  -- profile or a sign-in account. A new table that records an actor with the
  -- default NO ACTION fails this check instead of quietly blocking offboarding.
  select count(*) into v_n
    from pg_constraint c
   where c.contype = 'f'
     and c.connamespace = 'public'::regnamespace
     and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
     and c.confdeltype in ('a', 'r');
  if v_n <> 0 then
    raise exception 'staff actor keys verification failed: % key(s) in public still block deleting a profile or account', v_n;
  end if;

  -- The money path is untouched.
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_txt is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'place_order moved to %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_txt, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;

  raise notice 'staff actor keys: deleting a staff account now clears its actor columns instead of failing';
end
$verify$;
