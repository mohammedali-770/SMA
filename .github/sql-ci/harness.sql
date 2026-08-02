-- ---------------------------------------------------------------------------
-- The test-harness contract the suites were written against.
--
-- Ten of the twenty-six suites impersonate a caller like this:
--
--     perform set_config('test.auth_uid', p_uid::text, true);
--     perform set_config('test.is_staff', 'false',     true);
--     perform set_config('test.is_admin', 'false',     true);
--     set local role authenticated;
--
-- Nothing in this repository has ever defined `test.auth_uid`, `test.is_admin`
-- or `test.is_staff`. The suites were written against a harness that was never
-- committed — which is the deeper reason they had never run: there was nothing
-- to run them WITH. This file is that missing contract, written down.
--
-- Applied AFTER the migration chain, because it overrides functions the chain
-- creates. Kept separate from bootstrap.sql for exactly that reason: bootstrap
-- is "things Supabase would have provided", this is "things the test suites
-- assume about impersonation".
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- auth.uid() — now three sources, highest priority first.
--
--   1. `test.auth_uid`            (harness impersonation)
--   2. `request.jwt.claim.sub`    (PostgREST flat claim; used by other suites)
--   3. `request.jwt.claims->>sub` (PostgREST JSON claims)
--
-- Both PostgREST forms are kept because different suites in this repository
-- use different ones and both must resolve to the same caller.
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
-- current_app_role() — ONE override point, which is why is_admin() and
-- is_staff() are left exactly as the chain defines them. Both derive from this
-- function, so overriding it keeps their real logic under test.
--
-- The override applies only when `test.auth_uid` is set. That matters: a suite
-- that sets `test.is_admin = 'false'` means "treat this caller as a plain
-- customer", and falling through to the profiles lookup could hand back
-- 'admin' anyway if that row happened to be an admin — silently inverting what
-- the suite was asserting. When `test.auth_uid` is absent, behaviour is
-- byte-for-byte the chain's own: look the role up from profiles.
-- ---------------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$
  select case
    when nullif(current_setting('test.auth_uid', true), '') is not null then
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
-- vault.create_secret / vault.update_secret — the two entry points the suites
-- call. Real Vault encrypts; this stores plaintext in a throwaway container,
-- which is fine and is why nothing real may ever be put in it.
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
