-- 20260917120000_branch_reference_entries.sql
--
-- WHAT: the branch reference sheet a cashier can read on the POS iPad — links,
-- phone numbers, free-text notes, and credentials. Today a branch_staff account
-- sees exactly one screen (item availability) and cannot see so much as its own
-- branch's telephone number.
--
-- THE CREDENTIAL DECISION, stated first because it shapes everything else.
-- Owner decision 2026-09-13: secret values are held in SUPABASE VAULT, shown
-- MASKED, revealed only on an explicit action, and every reveal is AUDITED.
-- The alternative considered and rejected was a plaintext column with RLS.
--
-- WHY VAULT RATHER THAN A COLUMN. `vault.decrypted_secrets` is readable by
-- `postgres` and `service_role` and by NOBODY else — `authenticated` has no
-- privilege on it at all (measured live 2026-09-13). So the secret is not in a
-- table a database dump hands over in the clear, and the only door to it is the
-- definer RPC below, which is where branch scoping and the audit row live.
-- `branch_reference_entries` stores a vault id, never a value; publishing that
-- row to a client leaks nothing, because the id is useless without Vault.
--
-- WHAT THE LOCAL SUITE DOES NOT PROVE. The CI harness already stubs
-- `vault.create_secret` / `vault.update_secret` (`.github/sql-ci/harness.sql`)
-- and stores plaintext in a throwaway container. The suite therefore proves
-- wiring, authorization, branch scoping and the audit row — and says nothing
-- about cryptography, which is Vault's and is exercised only in Production.
-- Do not read a passing local suite as evidence that a secret was encrypted.
--
-- The calls below pass THREE arguments. The harness stub takes three; real
-- Vault takes four, the fourth (`new_key_id`) defaulted — so one call form
-- reaches both. A four-argument call would compile here and fail there.
--
-- WHO SEES WHAT, and the asymmetry is deliberate:
--   * the ENTRY ROWS (label, kind, non-secret value) are readable by the branch
--     operator for its own branch, by the call centre for every branch, and by
--     staff — the call centre needs branch reference material while a customer
--     is on the line;
--   * a SECRET VALUE is revealable by the branch operator for its own branch, or
--     an admin. The call centre deliberately cannot reveal: these are cashier
--     credentials, and a console that monitors forty branches is the wrong place
--     to be able to read forty branches' passwords.
--
-- MONEY PATH: untouched. NO DEPLOY IMPLIED: new objects only.

-- ---------------------------------------------------------------------------
-- 1. Entries
-- ---------------------------------------------------------------------------
create table if not exists public.branch_reference_entries (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches(id) on delete cascade,
  kind        text not null check (kind in ('text','link','phone','secret')),
  label_en    text not null check (length(btrim(label_en)) between 1 and 120),
  label_ar    text not null check (length(btrim(label_ar)) between 1 and 120),
  -- Exactly one of these is populated, enforced below.
  value_plain text check (value_plain is null or length(value_plain) <= 2000),
  secret_id   uuid,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  -- A secret carries a vault id and NEVER a plaintext value; everything else is
  -- the exact opposite. This is the constraint that stops a password being
  -- written into value_plain by a careless caller.
  constraint bre_value_shape check (
    (kind = 'secret'  and secret_id is not null and value_plain is null)
    or
    (kind <> 'secret' and secret_id is null     and value_plain is not null)
  )
);

comment on table public.branch_reference_entries is
  'Cashier-facing branch reference sheet. Rows of kind ''secret'' hold a Vault id, never a value: the plaintext is unreachable from this table and is returned only by branch_reference_reveal(), which is branch-scoped and audited. Readable by the branch operator for its own branch, and by the call centre for every branch.';

create index if not exists bre_branch_order_idx
  on public.branch_reference_entries (branch_id, sort_order, created_at);

-- ---------------------------------------------------------------------------
-- 2. Reveal audit — who looked at which secret, and when. Never the value.
-- ---------------------------------------------------------------------------
create table if not exists public.branch_reference_reveals (
  id          bigint generated always as identity primary key,
  entry_id    uuid not null references public.branch_reference_entries(id) on delete cascade,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  revealed_by uuid references public.profiles(id),
  revealed_at timestamptz not null default now()
);

comment on table public.branch_reference_reveals is
  'One row per secret reveal. Deliberately carries no value and no label — it answers "who looked at that credential, and when", which is the question an incident asks, without becoming a second place the secret lives.';

create index if not exists brr_entry_idx on public.branch_reference_reveals (entry_id, revealed_at desc);
create index if not exists brr_branch_idx on public.branch_reference_reveals (branch_id, revealed_at desc);

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.branch_reference_entries enable row level security;
revoke all on public.branch_reference_entries from public, anon, authenticated;
grant select on public.branch_reference_entries to authenticated;

drop policy if exists bre_select_ops on public.branch_reference_entries;
create policy bre_select_ops
  on public.branch_reference_entries for select to authenticated
  using (
    public.is_staff()
    or public.is_call_center()
    or public.is_branch_operator(branch_id)
  );

-- No write policy: the admin RPCs below are the only write path.

alter table public.branch_reference_reveals enable row level security;
revoke all on public.branch_reference_reveals from public, anon, authenticated;
grant select on public.branch_reference_reveals to authenticated;

-- The audit is admin-only reading. A branch seeing its own reveal history would
-- be useful; a branch seeing it would also tell a compromised branch account
-- exactly which credentials are worth taking. Admin only until asked otherwise.
drop policy if exists brr_select_admin on public.branch_reference_reveals;
create policy brr_select_admin
  on public.branch_reference_reveals for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. Reveal — the ONLY door to a secret value
-- ---------------------------------------------------------------------------
-- VOLATILE, not stable: it writes the audit row. Marking it stable would let
-- PostgreSQL skip repeat executions and silently lose reveals from the trail.
create or replace function public.branch_reference_reveal(p_entry_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_entry public.branch_reference_entries;
  v_value text;
begin
  if p_entry_id is null then
    raise exception 'entry id is required' using errcode = '22004';
  end if;

  select * into v_entry from public.branch_reference_entries where id = p_entry_id;
  if v_entry.id is null then
    raise exception 'Reference entry not found' using errcode = 'P0002';
  end if;

  -- The call centre is deliberately absent from this gate. It may READ the
  -- entry rows for every branch; it may not reveal any branch's credentials.
  if not (public.is_admin() or public.is_branch_operator(v_entry.branch_id)) then
    raise exception 'Not authorized to reveal this entry' using errcode = '42501';
  end if;

  if v_entry.kind <> 'secret' then
    -- Nothing to reveal; the value was never hidden. Returned rather than
    -- raised so a client can call this uniformly.
    return jsonb_build_object('id', p_entry_id, 'kind', v_entry.kind,
                              'value', v_entry.value_plain, 'audited', false);
  end if;

  select decrypted_secret into v_value
    from vault.decrypted_secrets where id = v_entry.secret_id;

  if v_value is null then
    raise exception 'The stored credential could not be read' using errcode = 'P0002';
  end if;

  -- Audit BEFORE returning. If the insert fails the reveal fails with it, which
  -- is the correct direction: an unaudited reveal must not happen.
  insert into public.branch_reference_reveals (entry_id, branch_id, revealed_by)
  values (p_entry_id, v_entry.branch_id, auth.uid());

  -- No RAISE NOTICE anywhere in this function: a notice would put the value in
  -- the Postgres log, which is precisely what Vault is here to avoid.
  return jsonb_build_object('id', p_entry_id, 'kind', 'secret',
                            'value', v_value, 'audited', true);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Admin write path
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_branch_reference(
  p_branch_id  uuid,
  p_kind       text,
  p_label_en   text,
  p_label_ar   text,
  p_value      text,
  p_entry_id   uuid    default null,
  p_sort_order integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_secret uuid;
  v_exist  public.branch_reference_entries;
  v_value  text := nullif(btrim(coalesce(p_value, '')), '');
  v_next   integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins may edit branch reference entries' using errcode = '42501';
  end if;
  if p_branch_id is null then
    raise exception 'branch id is required' using errcode = '22004';
  end if;
  if p_kind is null or p_kind not in ('text','link','phone','secret') then
    raise exception 'kind must be text, link, phone or secret' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_label_en,'')),'') is null
     or nullif(btrim(coalesce(p_label_ar,'')),'') is null then
    raise exception 'Both labels are required' using errcode = '22004';
  end if;
  if v_value is null then
    raise exception 'A value is required' using errcode = '22004';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;

  if p_entry_id is not null then
    select * into v_exist from public.branch_reference_entries where id = p_entry_id;
    if v_exist.id is null then
      raise exception 'Reference entry not found' using errcode = 'P0002';
    end if;
    -- Changing an entry's kind between secret and non-secret would orphan a
    -- vault secret or strand a plaintext value. Delete and recreate instead.
    if v_exist.kind <> p_kind then
      raise exception 'An entry''s kind cannot be changed; delete it and add a new one'
        using errcode = '22023';
    end if;
  end if;

  if p_kind = 'secret' then
    if p_entry_id is null then
      v_id := gen_random_uuid();
      v_secret := vault.create_secret(v_value, 'branch_ref:' || v_id::text,
                                      'Branch reference credential');
      select coalesce(max(sort_order), 0) + 1 into v_next
        from public.branch_reference_entries where branch_id = p_branch_id;
      insert into public.branch_reference_entries
        (id, branch_id, kind, label_en, label_ar, secret_id, sort_order, created_by)
      values (v_id, p_branch_id, p_kind, btrim(p_label_en), btrim(p_label_ar),
              v_secret, coalesce(p_sort_order, v_next), auth.uid());
    else
      perform vault.update_secret(v_exist.secret_id, v_value);
      update public.branch_reference_entries
         set label_en = btrim(p_label_en), label_ar = btrim(p_label_ar),
             sort_order = coalesce(p_sort_order, sort_order), updated_at = now()
       where id = p_entry_id;
      v_id := p_entry_id;
    end if;
  else
    if p_entry_id is null then
      select coalesce(max(sort_order), 0) + 1 into v_next
        from public.branch_reference_entries where branch_id = p_branch_id;
      insert into public.branch_reference_entries
        (branch_id, kind, label_en, label_ar, value_plain, sort_order, created_by)
      values (p_branch_id, p_kind, btrim(p_label_en), btrim(p_label_ar),
              v_value, coalesce(p_sort_order, v_next), auth.uid())
      returning id into v_id;
    else
      update public.branch_reference_entries
         set label_en = btrim(p_label_en), label_ar = btrim(p_label_ar),
             value_plain = v_value,
             sort_order = coalesce(p_sort_order, sort_order), updated_at = now()
       where id = p_entry_id;
      v_id := p_entry_id;
    end if;
  end if;

  return jsonb_build_object('id', v_id, 'branch_id', p_branch_id, 'kind', p_kind);
end $$;

create or replace function public.admin_delete_branch_reference(p_entry_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_entry public.branch_reference_entries;
begin
  if not public.is_admin() then
    raise exception 'Only admins may delete branch reference entries' using errcode = '42501';
  end if;
  if p_entry_id is null then
    raise exception 'entry id is required' using errcode = '22004';
  end if;

  select * into v_entry from public.branch_reference_entries where id = p_entry_id;
  if v_entry.id is null then
    raise exception 'Reference entry not found' using errcode = 'P0002';
  end if;

  delete from public.branch_reference_entries where id = p_entry_id;

  -- Remove the Vault row too: leaving it would accumulate unreferenced secrets
  -- that nothing can read and nobody can account for.
  if v_entry.secret_id is not null then
    delete from vault.secrets where id = v_entry.secret_id;
  end if;

  return jsonb_build_object('id', p_entry_id, 'deleted', true);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.branch_reference_reveal(uuid)                                   from public, anon;
revoke all on function public.admin_upsert_branch_reference(uuid, text, text, text, text, uuid, integer) from public, anon;
revoke all on function public.admin_delete_branch_reference(uuid)                             from public, anon;

grant execute on function public.branch_reference_reveal(uuid)                                   to authenticated;
grant execute on function public.admin_upsert_branch_reference(uuid, text, text, text, text, uuid, integer) to authenticated;
grant execute on function public.admin_delete_branch_reference(uuid)                             to authenticated;

comment on function public.branch_reference_reveal(uuid) is
  'The only door to a stored credential. Branch operator (own branch) or admin — the call centre is deliberately excluded. Writes an audit row BEFORE returning, so an unaudited reveal cannot happen, and emits no NOTICE, so the value never reaches the Postgres log.';

-- ---------------------------------------------------------------------------
-- 7. Self-verification
-- ---------------------------------------------------------------------------
do $verify$
declare v_n integer; v_src text;
begin
  -- (a) The tables must be created empty.
  select count(*) into v_n from public.branch_reference_entries;
  if v_n <> 0 then raise exception 'entries table must start empty, found %', v_n; end if;

  -- (b) authenticated must NOT be able to reach Vault directly. This is the
  --     property the whole design rests on; assert it rather than assume it.
  if has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT') then
    raise exception 'authenticated can read vault.decrypted_secrets -- the RPC is not the only door';
  end if;

  -- (c) No write policy may exist on either table.
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and tablename in ('branch_reference_entries','branch_reference_reveals')
     and cmd <> 'SELECT';
  if v_n <> 0 then raise exception 'reference tables must have no write policy, found %', v_n; end if;

  -- (d) The call centre must not be able to reveal.
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'branch_reference_reveal';
  if v_src like '%is_call_center%' then
    raise exception 'branch_reference_reveal admits the call centre';
  end if;
  if v_src not like '%is_branch_operator(v_entry.branch_id)%' then
    raise exception 'branch_reference_reveal is not branch-scoped';
  end if;
  -- (e) It must audit, and must not log.
  if v_src not like '%insert into public.branch_reference_reveals%' then
    raise exception 'branch_reference_reveal does not write an audit row';
  end if;
  if v_src like '%raise notice%' then
    raise exception 'branch_reference_reveal emits a notice -- a secret would reach the log';
  end if;

  -- (f) The shape constraint that keeps a password out of value_plain.
  select count(*) into v_n from pg_constraint
   where conrelid = 'public.branch_reference_entries'::regclass
     and conname = 'bre_value_shape';
  if v_n <> 1 then raise exception 'the value-shape constraint is missing'; end if;

  -- (g) The customer data export must not have grown a branch table.
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'export_my_data';
  if v_src is not null and v_src like '%branch_reference%' then
    raise exception 'export_my_data references branch reference data';
  end if;

  raise notice 'branch reference entries installed; vault is the only store for secrets';
end
$verify$;
