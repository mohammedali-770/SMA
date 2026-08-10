-- ---------------------------------------------------------------------------
-- The test-harness contract the suites were written against.
--
-- Ten of the suites impersonate a caller with test.* GUCs. The harness is
-- applied AFTER the migration chain so it can replace auth/current-user helpers
-- only inside the throwaway CI database.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- auth.uid() — test impersonation first, then the two PostgREST claim shapes.
-- ---------------------------------------------------------------------------
create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('test.auth_uid',          true), ''),
      nullif(current_setting('request.jwt.claim.sub',  true), ''),
      nullif(auth.jwt() ->> 'sub', '')
    ),
    ''
  )::uuid;
$$;

-- ---------------------------------------------------------------------------
-- current_app_role() — one role-impersonation override point.
-- ---------------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$
  select case
    when nullif(current_setting('test.auth_uid', true), '') is not null
      or nullif(current_setting('test.is_admin', true), '') is not null
      or nullif(current_setting('test.is_staff', true), '') is not null then
      case
        when coalesce(nullif(current_setting('test.is_admin', true), '')::boolean, false)
          then 'admin'::public.user_role
        when coalesce(nullif(current_setting('test.is_staff', true), '')::boolean, false)
          then 'accountant'::public.user_role
        else 'customer'::public.user_role
      end
    else
      (select p.role from public.profiles p where p.id = auth.uid())
  end;
$$;

-- ---------------------------------------------------------------------------
-- Staff MFA harness override.
--
-- Production `is_admin()` / `is_staff()` now require jwt_has_aal2(). Existing
-- SQL suites are unit/integration tests for authorization logic and use test.*
-- role impersonation rather than constructing real MFA JWTs. In this disposable
-- database only, treat that impersonation as already MFA-complete so those tests
-- continue exercising the same role contracts. The dedicated staff-MFA suite
-- tests the pure AAL predicate separately.
-- ---------------------------------------------------------------------------
create or replace function public.jwt_has_aal2()
returns boolean
language sql stable
set search_path = public
as $$
  select true;
$$;

-- ---------------------------------------------------------------------------
-- vault.create_secret / vault.update_secret — the two entry points the suites
-- call. Real Vault encrypts; this stores plaintext in a throwaway container.
-- ---------------------------------------------------------------------------
create or replace function vault.create_secret(
  new_secret      text,
  new_name        text default null,
  new_description text default ''
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into vault.secrets (name, secret, description)
       values (new_name, new_secret, new_description)
  on conflict (name) do update
          set secret = excluded.secret,
              description = excluded.description
    returning id into v_id;
  return v_id;
end $$;

create or replace function vault.update_secret(
  secret_id       uuid,
  new_secret      text default null,
  new_name        text default null,
  new_description text default null
)
returns void
language plpgsql
as $$
begin
  update vault.secrets
     set secret      = coalesce(new_secret, secret),
         name        = coalesce(new_name, name),
         description = coalesce(new_description, description)
   where id = secret_id;
end $$;
