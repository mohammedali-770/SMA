-- ---------------------------------------------------------------------------
-- Supabase-shaped prerequisites for a plain PostGIS Postgres.
--
-- The migration chain is written against a Supabase database: it assumes the
-- `anon` / `authenticated` / `service_role` roles exist, that `auth.uid()`
-- resolves the caller, and that `cron` and `net` are available. A stock
-- Postgres image has none of that, so CI recreates the SMALLEST surface the
-- chain and the test suites actually touch — nothing more.
--
-- WHAT THIS IS NOT. It is not a Supabase emulator and must never grow into
-- one. Everything here is derived from a grep of what the migrations and tests
-- reference; if a migration starts using something new, this file should fail
-- loudly rather than quietly approximate it.
--
-- FIDELITY NOTE. Two things are deliberately faked and therefore NOT covered
-- by this harness:
--   * `cron.schedule` records a row instead of scheduling anything. Nothing
--     ever fires. Tests that assert a job ROW exists are meaningful; a test
--     that asserted a job RAN would be meaningless here.
--   * `net.http_post` records the call and returns an id. No HTTP leaves the
--     container — which is also what makes the suite safe to run in CI.
-- Both are recorded in tables so a test can assert what WOULD have been
-- scheduled or sent.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Roles. NOLOGIN: the suites reach them with `set local role`, never by
--    connecting as them.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- The suites run as the bootstrap superuser and switch with `set local role`,
-- which requires membership.
grant anon, authenticated, service_role to current_user;

-- ---------------------------------------------------------------------------
-- 2. Schemas the chain installs into or references.
-- ---------------------------------------------------------------------------
create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;
create schema if not exists vault;
create schema if not exists cron;
create schema if not exists net;

grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth        to anon, authenticated, service_role;

-- pgcrypto must live in `extensions`, as it does on Supabase: the account-
-- deletion scheduler calls `extensions.digest(...)` fully qualified. Creating
-- it here rather than letting the chain's own
-- `create extension if not exists pgcrypto;` place it in `public` — that form
-- then becomes a no-op, because CREATE EXTENSION IF NOT EXISTS keys on the
-- extension existing at all, not on which schema it landed in.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 3. auth.users — only the columns the chain reads.
--
--    `public.handle_new_user()` reads id / email / phone / raw_user_meta_data;
--    the WhatsApp login migration reads phone_confirmed_at; profiles carries
--    `references auth.users(id) on delete cascade`. Test suites insert rows
--    directly, so every other column must be nullable or defaulted.
-- ---------------------------------------------------------------------------
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  phone              text,
  raw_user_meta_data jsonb   not null default '{}'::jsonb,
  phone_confirmed_at timestamptz,
  email_confirmed_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

-- ---------------------------------------------------------------------------
-- 4. auth.uid() and friends.
--
--    The suites impersonate with
--      perform set_config('request.jwt.claim.sub', <uuid>, true);
--      set local role authenticated;
--    which is the PostgREST convention. Both the flat claim GUC and the JSON
--    `request.jwt.claims` form are honoured, because different suites in this
--    repository use different ones and BOTH must resolve to the same caller.
--
--    Every lookup is `current_setting(..., true)` (missing_ok) so an
--    unauthenticated statement yields NULL rather than erroring — that is what
--    the real implementation does, and RLS policies depend on the distinction.
-- ---------------------------------------------------------------------------
create or replace function auth.jwt()
returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(auth.jwt() ->> 'sub', '')
    ),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', ''),
    current_user::text
  );
$$;

create or replace function auth.email()
returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    nullif(auth.jwt() ->> 'email', '')
  );
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt(), auth.role(), auth.email()
  to anon, authenticated, service_role;

-- Suites insert into auth.users while impersonating; without this the insert
-- fails on permissions rather than on the behaviour under test.
grant select, insert, update, delete on auth.users to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. cron — a RECORDING stub, not a scheduler.
--
--    Column names match pg_cron's real catalog (jobid / jobname / schedule /
--    command / active / database / username / nodename / nodeport) because the
--    health-summary RPCs select them by name and join job_run_details on jobid.
-- ---------------------------------------------------------------------------
create table if not exists cron.job (
  jobid    bigserial primary key,
  schedule text    not null,
  command  text    not null,
  nodename text    not null default 'localhost',
  nodeport integer not null default 5432,
  database text    not null default current_database(),
  username text    not null default current_user,
  active   boolean not null default true,
  jobname  text    unique
);

create table if not exists cron.job_run_details (
  jobid          bigint,
  runid          bigserial primary key,
  job_pid        integer,
  database       text,
  username       text,
  command        text,
  status         text,
  return_message text,
  start_time     timestamptz,
  end_time       timestamptz
);

-- `cron.schedule(jobname, schedule, command)` — the 3-argument form, the only
-- one this chain calls. Upsert, because migrations re-schedule idempotently.
create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint
language plpgsql
as $$
declare
  v_id bigint;
begin
  insert into cron.job (jobname, schedule, command)
       values (job_name, schedule, command)
  on conflict (jobname) do update
          set schedule = excluded.schedule,
              command  = excluded.command,
              active   = true
    returning jobid into v_id;
  return v_id;
end $$;

create or replace function cron.unschedule(job_name text)
returns boolean
language plpgsql
as $$
begin
  delete from cron.job where jobname = job_name;
  return found;
end $$;

create or replace function cron.unschedule(job_id bigint)
returns boolean
language plpgsql
as $$
begin
  delete from cron.job where jobid = job_id;
  return found;
end $$;

grant usage on schema cron to postgres, service_role;
grant select on cron.job, cron.job_run_details to postgres, service_role;

-- ---------------------------------------------------------------------------
-- 6. net — a RECORDING stub. No HTTP leaves the container, which is precisely
--    why the suite is safe to run unattended in CI.
-- ---------------------------------------------------------------------------
create table if not exists net.http_request_queue (
  id         bigserial primary key,
  method     text not null,
  url        text not null,
  headers    jsonb,
  body       jsonb,
  timeout_ms integer,
  created_at timestamptz not null default now()
);

-- Named-argument call sites: url / headers / body / timeout_milliseconds.
-- Defaults on every argument but `url`, matching pg_net.
create or replace function net.http_post(
  url                  text,
  body                 jsonb   default '{}'::jsonb,
  params               jsonb   default '{}'::jsonb,
  headers              jsonb   default '{}'::jsonb,
  timeout_milliseconds integer default 5000
)
returns bigint
language plpgsql
as $$
declare
  v_id bigint;
begin
  insert into net.http_request_queue (method, url, headers, body, timeout_ms)
       values ('POST', url, headers, body, timeout_milliseconds)
    returning id into v_id;
  return v_id;
end $$;

grant usage on schema net to postgres, service_role;

-- ---------------------------------------------------------------------------
-- 7. storage — the banner-images bucket and the objects table its RLS
--    policies attach to.
--
--    `20260712130000_homepage_banners.sql` inserts a bucket row (with an
--    ON CONFLICT (id) DO UPDATE, so `id` must genuinely be the primary key)
--    and creates four policies on storage.objects referencing `bucket_id`.
--    Only what those statements touch is recreated here.
-- ---------------------------------------------------------------------------
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean not null default false,
  avif_autodetection boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets (id),
  name             text,
  owner            uuid,
  metadata         jsonb,
  path_tokens      text[],
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_accessed_at timestamptz not null default now()
);

-- The chain creates policies on this table; without RLS enabled they would be
-- inert, and a suite asserting that a policy DENIES something would pass for
-- the wrong reason.
alter table storage.objects enable row level security;

grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. vault — referenced when the chain reads integration secrets.
-- ---------------------------------------------------------------------------
create table if not exists vault.secrets (
  id          uuid primary key default gen_random_uuid(),
  name        text unique,
  secret      text not null,
  description text,
  created_at  timestamptz not null default now()
);

-- `decrypted_secret` is a CAST, not a bare column reference, and that is
-- load-bearing: a view whose target list is only simple column references is
-- auto-updatable, so `update vault.decrypted_secrets set decrypted_secret=…`
-- would silently succeed. Real Vault refuses it, and
-- lazywait_sync_scheduler_test asserts the refusal. An expression makes that
-- column non-updatable, so the UPDATE errors as it should.
create or replace view vault.decrypted_secrets as
  select id, name, secret, (secret)::text as decrypted_secret, description, created_at
    from vault.secrets;
