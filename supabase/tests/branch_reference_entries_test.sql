-- ============================================================================
-- Branch reference entries + Vault-backed credentials (20260917120000).
--
-- WHAT THIS SUITE PROVES, AND WHAT IT DOES NOT. The CI harness stubs Vault
-- WITHOUT encryption (.github/sql-ci/bootstrap.sql §8). So these cases prove
-- wiring, authorization, branch scoping and the audit row -- everything this
-- repository controls. They prove NOTHING about cryptography, which is Vault's
-- and is exercised only in Production. A passing run here is not evidence that
-- a secret was encrypted.
--
-- IMPERSONATION NOTE. As in the other ops suites, impersonation is through
-- request.jwt.claim.sub rather than the test.* GUCs, which cannot express
-- call_center or branch_staff.
--
-- Single transaction, rolled back. Disposable/local database only.
-- ============================================================================
begin;

do $$
declare
  v_admin uuid := 'a9000000-0000-0000-0000-000000000001';
  v_op    uuid := 'a9000000-0000-0000-0000-000000000002';
  v_cc    uuid := 'a9000000-0000-0000-0000-000000000003';
  v_op2   uuid := 'a9000000-0000-0000-0000-000000000004';
  v_cust  uuid := 'a9000000-0000-0000-0000-000000000005';
begin
  insert into auth.users(id) values (v_admin),(v_op),(v_cc),(v_op2),(v_cust)
  on conflict (id) do nothing;
  insert into public.profiles(id, full_name, role) values
    (v_admin,'Ref Admin','admin'),
    (v_op,   'Ref Operator','branch_staff'),
    (v_cc,   'Ref Call Centre','call_center'),
    (v_op2,  'Ref Other Operator','branch_staff'),
    (v_cust, 'Ref Customer','customer')
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

  insert into public.branches (id, name_en, name_ar, is_active)
  values ('b9000000-0000-0000-0000-0000000000aa','Ref Branch A','فرع أ', true),
         ('b9000000-0000-0000-0000-0000000000bb','Ref Branch B','فرع ب', true)
  on conflict (id) do update set is_active = true;

  insert into public.staff_branch_assignments(user_id, branch_id) values
    (v_op,  'b9000000-0000-0000-0000-0000000000aa'),
    (v_op2, 'b9000000-0000-0000-0000-0000000000bb')
  on conflict (user_id) do update set branch_id = excluded.branch_id;
end $$;

create or replace function pg_temp.as_user(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, true); $$;

create or replace function pg_temp.err(p_sql text) returns text
language plpgsql as $$
begin execute p_sql; return null;
exception when others then return sqlstate; end $$;

-- ---- CASE 1: admin creates a plain entry and a SECRET entry ----------------
do $$
declare v_out jsonb; v_n integer;
begin
  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000001');
  perform public.admin_upsert_branch_reference(
    'b9000000-0000-0000-0000-0000000000aa','phone','Kitchen extension','تحويلة المطبخ','114');
  v_out := public.admin_upsert_branch_reference(
    'b9000000-0000-0000-0000-0000000000aa','secret','Aggregator password','كلمة مرور المنصة','hunter2-not-real');

  if v_out ->> 'kind' <> 'secret' then
    raise exception 'CASE 1: expected a secret entry, got %', v_out ->> 'kind';
  end if;
  select count(*) into v_n from public.branch_reference_entries
   where branch_id = 'b9000000-0000-0000-0000-0000000000aa';
  if v_n <> 2 then raise exception 'CASE 1: expected 2 entries, got %', v_n; end if;
  raise notice 'CASE 1 OK — admin can create both kinds';
end $$;

-- ---- CASE 2: THE SECRET IS NOT IN THE ENTRY TABLE. The core property. ------
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.branch_reference_entries
   where value_plain is not null and value_plain like '%hunter2%';
  if v_n <> 0 then
    raise exception 'CASE 2: the secret was written into value_plain -- Vault bypassed';
  end if;

  select count(*) into v_n from public.branch_reference_entries
   where kind = 'secret' and secret_id is null;
  if v_n <> 0 then raise exception 'CASE 2: a secret entry carries no vault id'; end if;

  select count(*) into v_n from public.branch_reference_entries
   where kind = 'secret' and value_plain is not null;
  if v_n <> 0 then raise exception 'CASE 2: a secret entry also carries a plaintext value'; end if;
  raise notice 'CASE 2 OK — the entry table holds a vault id, never the value';
end $$;

-- ---- CASE 3: the shape constraint refuses a hand-written violation ---------
do $$
declare v_state text;
begin
  v_state := pg_temp.err($q$
    insert into public.branch_reference_entries
      (branch_id, kind, label_en, label_ar, value_plain)
    values ('b9000000-0000-0000-0000-0000000000aa','secret','x','س','plaintext-password') $q$);
  if v_state is distinct from '23514' then
    raise exception 'CASE 3: a secret with a plaintext value was accepted (sqlstate %)', v_state;
  end if;
  raise notice 'CASE 3 OK — a password cannot be stored in value_plain';
end $$;

-- ---- CASE 4: the branch operator can reveal ITS OWN secret, and it audits --
do $$
declare v_id uuid; v_out jsonb; v_n integer;
begin
  select id into v_id from public.branch_reference_entries
   where branch_id = 'b9000000-0000-0000-0000-0000000000aa' and kind = 'secret';

  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000002');
  v_out := public.branch_reference_reveal(v_id);

  if v_out ->> 'value' <> 'hunter2-not-real' then
    raise exception 'CASE 4: reveal returned the wrong value';
  end if;
  if not (v_out ->> 'audited')::boolean then
    raise exception 'CASE 4: reveal reported audited = false';
  end if;

  select count(*) into v_n from public.branch_reference_reveals where entry_id = v_id;
  if v_n <> 1 then raise exception 'CASE 4: expected 1 audit row, got %', v_n; end if;
  raise notice 'CASE 4 OK — own-branch reveal works and is audited';
end $$;

-- ---- CASE 5: the audit row names the reader and carries NO value ----------
do $$
declare v_by uuid; v_cols integer;
begin
  select revealed_by into v_by from public.branch_reference_reveals
   order by revealed_at desc limit 1;
  if v_by is distinct from 'a9000000-0000-0000-0000-000000000002'::uuid then
    raise exception 'CASE 5: the audit row names the wrong reader (%)', v_by;
  end if;

  select count(*) into v_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'branch_reference_reveals'
     and column_name in ('value','secret','value_plain','decrypted_secret','label_en','label_ar');
  if v_cols <> 0 then
    raise exception 'CASE 5: the audit table has a value-bearing column -- it is a second home for the secret';
  end if;
  raise notice 'CASE 5 OK — audit names the reader, stores no value';
end $$;

-- ---- CASE 6: ANOTHER branch's operator cannot reveal ----------------------
do $$
declare v_id uuid; v_state text; v_n integer;
begin
  select id into v_id from public.branch_reference_entries
   where branch_id = 'b9000000-0000-0000-0000-0000000000aa' and kind = 'secret';
  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000004');
  v_state := pg_temp.err(format('select public.branch_reference_reveal(%L)', v_id));
  if v_state is distinct from '42501' then
    raise exception 'CASE 6: a foreign branch revealed the credential (sqlstate %)', v_state;
  end if;
  select count(*) into v_n from public.branch_reference_reveals where entry_id = v_id;
  if v_n <> 1 then
    raise exception 'CASE 6: a refused reveal still wrote an audit row (now %)', v_n;
  end if;
  raise notice 'CASE 6 OK — reveal is branch-scoped';
end $$;

-- ---- CASE 7: THE CALL CENTRE CAN READ ENTRIES BUT CANNOT REVEAL -----------
-- The deliberate asymmetry. A console that watches forty branches must not be
-- able to read forty branches' passwords.
do $$
declare v_id uuid; v_state text; v_n integer;
begin
  select id into v_id from public.branch_reference_entries
   where branch_id = 'b9000000-0000-0000-0000-0000000000aa' and kind = 'secret';

  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000003');
  v_state := pg_temp.err(format('select public.branch_reference_reveal(%L)', v_id));
  if v_state is distinct from '42501' then
    raise exception 'CASE 7a: the call centre revealed a branch credential (sqlstate %)', v_state;
  end if;

  set local role authenticated;
  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000003');
  select count(*) into v_n from public.branch_reference_entries;
  reset role;
  if v_n < 2 then
    raise exception 'CASE 7b: the call centre cannot read entry rows (saw %) -- it needs them', v_n;
  end if;
  raise notice 'CASE 7 OK — call centre reads entries, cannot reveal secrets';
end $$;

-- ---- CASE 8: a customer can neither read nor reveal -----------------------
do $$
declare v_id uuid; v_state text; v_n integer;
begin
  select id into v_id from public.branch_reference_entries
   where branch_id = 'b9000000-0000-0000-0000-0000000000aa' and kind = 'secret';

  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000005');
  v_state := pg_temp.err(format('select public.branch_reference_reveal(%L)', v_id));
  if v_state is distinct from '42501' then
    raise exception 'CASE 8a: a customer revealed a credential (sqlstate %)', v_state;
  end if;

  set local role authenticated;
  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000005');
  select count(*) into v_n from public.branch_reference_entries;
  reset role;
  if v_n <> 0 then raise exception 'CASE 8b: a customer read % entry rows', v_n; end if;
  raise notice 'CASE 8 OK — customers see nothing';
end $$;

-- ---- CASE 9: a branch operator sees ONLY its own branch's entries ---------
do $$
declare v_n integer;
begin
  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000001');
  perform public.admin_upsert_branch_reference(
    'b9000000-0000-0000-0000-0000000000bb','text','Bin day','يوم النفايات','Tuesday');

  set local role authenticated;
  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000002');   -- pinned to A
  select count(*) into v_n from public.branch_reference_entries
   where branch_id = 'b9000000-0000-0000-0000-0000000000bb';
  reset role;
  if v_n <> 0 then
    raise exception 'CASE 9: a branch operator read % rows of another branch', v_n;
  end if;
  raise notice 'CASE 9 OK — entry reads are branch-scoped';
end $$;

-- ---- CASE 10: only an admin may write ------------------------------------
do $$
declare v_state text;
begin
  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000002');
  v_state := pg_temp.err($q$
    select public.admin_upsert_branch_reference(
      'b9000000-0000-0000-0000-0000000000aa','text','x','س','y') $q$);
  if v_state is distinct from '42501' then
    raise exception 'CASE 10a: a branch operator wrote a reference entry (sqlstate %)', v_state;
  end if;

  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000003');
  v_state := pg_temp.err($q$
    select public.admin_upsert_branch_reference(
      'b9000000-0000-0000-0000-0000000000aa','text','x','س','y') $q$);
  if v_state is distinct from '42501' then
    raise exception 'CASE 10b: the call centre wrote a reference entry (sqlstate %)', v_state;
  end if;
  raise notice 'CASE 10 OK — writing is admin-only';
end $$;

-- ---- CASE 11: updating a secret changes the value, not the row shape ------
do $$
declare v_id uuid; v_out jsonb; v_n integer;
begin
  select id into v_id from public.branch_reference_entries
   where branch_id = 'b9000000-0000-0000-0000-0000000000aa' and kind = 'secret';

  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000001');
  perform public.admin_upsert_branch_reference(
    'b9000000-0000-0000-0000-0000000000aa','secret','Aggregator password','كلمة مرور المنصة',
    'rotated-value', v_id);

  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000002');
  v_out := public.branch_reference_reveal(v_id);
  if v_out ->> 'value' <> 'rotated-value' then
    raise exception 'CASE 11: rotation did not take, got %', v_out ->> 'value';
  end if;

  select count(*) into v_n from public.branch_reference_entries
   where branch_id = 'b9000000-0000-0000-0000-0000000000aa' and kind = 'secret';
  if v_n <> 1 then raise exception 'CASE 11: rotation created a duplicate row (%)', v_n; end if;
  raise notice 'CASE 11 OK — a secret rotates in place';
end $$;

-- ---- CASE 12: kind cannot be switched between secret and plain ------------
do $$
declare v_id uuid; v_state text;
begin
  select id into v_id from public.branch_reference_entries
   where branch_id = 'b9000000-0000-0000-0000-0000000000aa' and kind = 'secret';
  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000001');
  v_state := pg_temp.err(format($q$
    select public.admin_upsert_branch_reference(
      'b9000000-0000-0000-0000-0000000000aa','text','x','س','y', %L) $q$, v_id));
  if v_state is distinct from '22023' then
    raise exception 'CASE 12: a secret was converted to plaintext in place (sqlstate %)', v_state;
  end if;
  raise notice 'CASE 12 OK — kind is immutable';
end $$;

-- ---- CASE 13: deleting an entry removes its Vault row --------------------
do $$
declare v_id uuid; v_secret uuid; v_n integer;
begin
  select id, secret_id into v_id, v_secret from public.branch_reference_entries
   where branch_id = 'b9000000-0000-0000-0000-0000000000aa' and kind = 'secret';

  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000001');
  perform public.admin_delete_branch_reference(v_id);

  select count(*) into v_n from vault.secrets where id = v_secret;
  if v_n <> 0 then
    raise exception 'CASE 13: the vault row survived the entry -- an orphaned secret';
  end if;
  raise notice 'CASE 13 OK — deletion removes the stored credential too';
end $$;

-- ---- CASE 14: the audit trail is admin-only reading ----------------------
do $$
declare v_n integer;
begin
  set local role authenticated;
  perform pg_temp.as_user('a9000000-0000-0000-0000-000000000002');
  select count(*) into v_n from public.branch_reference_reveals;
  reset role;
  if v_n <> 0 then
    raise exception 'CASE 14: a branch operator read % audit rows', v_n;
  end if;
  raise notice 'CASE 14 OK — the reveal trail is admin-only';
end $$;

-- ---- CASE 15: the gates are pinned at SOURCE level ------------------------
-- Mutation testing on the sibling feature showed a widened gate can be masked
-- by a second refusal downstream. There is no second gate here, so the source
-- assertion is the whole guarantee.
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'branch_reference_reveal';
  if v_src like '%is_call_center%' then
    raise exception 'CASE 15a: reveal admits the call centre';
  end if;
  if v_src like '%is_staff()%' then
    raise exception 'CASE 15b: reveal admits accountants via is_staff()';
  end if;
  if v_src not like '%insert into public.branch_reference_reveals%' then
    raise exception 'CASE 15c: reveal no longer audits';
  end if;
  if v_src like '%raise notice%' then
    raise exception 'CASE 15d: reveal emits a notice -- the value would reach the Postgres log';
  end if;
  raise notice 'CASE 15 OK — reveal gates and audit pinned at source';
end $$;

rollback;
