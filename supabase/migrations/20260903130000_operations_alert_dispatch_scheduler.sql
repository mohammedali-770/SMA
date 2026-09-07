-- ============================================================================
-- Operations alerts v2 — THE INVOCATION PATH.
--
-- WHY THIS EXISTS, AND WHY IT IS A SEPARATE FILE
-- 20260903120000 built the dispatcher and NOTHING CALLED IT. That was caught by
-- review on #328: a repo-wide search for `operations-alert-dispatch` found its
-- definition, its config entry, its test and the documents describing it -- no
-- caller. Enabling `external_dispatch_enabled` therefore filled the outbox and
-- left it full, while the documentation claimed enabling was "the only step that
-- sends mail". The documents were corrected; this file closes the gap itself.
--
-- Until this is applied AND its two Vault secrets exist, X3's real answer is
-- still the named human in INCIDENT_RESPONSE.md §1b. A dispatcher a person must
-- remember to run is still the person doing the remembering.
--
-- SHAPE, following 20260716180000 (account deletion) and 20260720120000
-- (lazywait sync): a SECURITY DEFINER driver reads Vault, posts to the function
-- over net.http_post with a dedicated trigger secret, and pg_cron calls the
-- driver. cron.job stores only a bare internal call -- no credentials, no URL.
--
-- WHY THE FUNCTION NEVER LEARNS THE SECRET -- AND WHY THE FIRST VERSION DID
-- lazywait-sync reads its expected trigger secret out of
-- `integration_settings.secret_config` and compares in TypeScript, which puts
-- the secret somewhere a service-role client can read.
--
-- The first version of THIS file claimed to fix that by keeping the secret in
-- Vault and having the Edge Function ask Postgres a yes/no question. It did not:
-- the driver put the decrypted secret verbatim in an `x-alert-dispatch-secret`
-- header, so the function received the plaintext on every single tick and could
-- read, log or leak it exactly as before. The only thing the boolean RPC
-- prevented was the function reading the secret when NOBODY had called it.
-- Review caught that on #329 and it was right; the claim was retired by making
-- it true rather than by softening it.
--
-- What the driver sends now is a SIGNATURE, never the secret:
--
--     nonce     = 16 random bytes, hex
--     timestamp = now(), ISO-8601 UTC to the second
--     signature = HMAC-SHA256(nonce || '.' || timestamp, secret)
--
-- `verify_operations_alert_dispatch_signature` recomputes it in Postgres. The
-- secret never crosses the process boundary, so it cannot appear in an Edge
-- Function log, in request instrumentation, or in a memory dump of a
-- compromised function. The function still cannot read it from Vault either.
--
-- REPLAY, stated rather than glossed. A captured request can be replayed inside
-- the freshness window (10 minutes -- wide enough for clock skew and the
-- driver's own 60s timeout). The effect is one extra dispatch run, which is what
-- the next tick does anyway: claims are fenced by a per-invocation token and
-- bounded to 20 rows, so a replay drains the queue rather than double-sending a
-- row that is already `sent`. A consumed-nonce table would close the window at
-- the cost of a write per tick and a cleanup job, which is not proportionate to
-- "the alert mail goes out a few minutes early". The nonce's job here is to make
-- each signature unique, not to prevent replay.
--
-- STILL INERT ON APPLY. The driver returns early while
-- `external_dispatch_enabled` is false -- which this file does not change -- so
-- the cron job runs, does nothing, and makes no outbound request. It does not
-- even read Vault in that state, so applying this before the secrets exist is
-- safe and silent.
-- ============================================================================

-- ---- 1. Signature verification, without disclosing the secret ---------------
-- Freshness window. Wide enough that clock skew between Postgres and the Edge
-- runtime cannot reject a legitimate tick, narrow enough that a captured
-- request stops working within one alert cycle.
create or replace function public.verify_operations_alert_dispatch_signature(
  p_nonce      text,
  p_timestamp  text,
  p_signature  text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_secret   text;
  v_when     timestamptz;
  v_expected text;
  v_probe    text;
begin
  -- Fail CLOSED on every path. Never fall through to a comparison: an
  -- unconfigured deployment must deny, not accept an empty signature.
  if p_nonce is null or length(p_nonce) = 0
     or p_timestamp is null or length(p_timestamp) = 0
     or p_signature is null or length(p_signature) = 0 then
    return false;
  end if;

  -- A malformed timestamp is a denial, not an exception: this runs on an
  -- unauthenticated path and must not turn attacker input into a 500.
  begin
    v_when := p_timestamp::timestamptz;
  exception when others then
    return false;
  end;
  if abs(extract(epoch from (now() - v_when))) > 600 then
    return false;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'operations_alert_dispatch_secret';
  if v_secret is null or length(v_secret) = 0 then
    return false;
  end if;

  v_expected := encode(
    extensions.hmac(p_nonce || '.' || p_timestamp, v_secret, 'sha256'),
    'hex'
  );

  -- Double-HMAC comparison under a fresh random probe key. `=` on text is not
  -- constant time, and this endpoint can be called at whatever rate an attacker
  -- likes. Comparing digests taken under a key the attacker cannot predict
  -- means the timing of the short-circuit reveals nothing about the real
  -- signature, and both operands are a fixed 32 bytes.
  -- Hex, not bytea: pgcrypto exposes hmac(text,text,text) and
  -- hmac(bytea,bytea,text), and a mixed pair matches neither.
  v_probe := encode(extensions.gen_random_bytes(32), 'hex');
  return extensions.hmac(v_expected, v_probe, 'sha256')
       = extensions.hmac(p_signature, v_probe, 'sha256');
end;
$$;

comment on function public.verify_operations_alert_dispatch_signature(text, text, text) is
  'Recomputes HMAC-SHA256(nonce.timestamp) against the Vault-held dispatch secret and returns a boolean. The secret never leaves Postgres: the Edge Function sends a signature, not the value it is checked against.';

-- The plaintext-secret check this replaces. Dropped rather than left in place:
-- an unused SECURITY DEFINER function that compares a caller-supplied string to
-- a Vault secret is a disclosure oracle waiting for its second caller.
drop function if exists public.verify_operations_alert_dispatch_secret(text);

-- ---- 2. The driver pg_cron calls -------------------------------------------
create or replace function public.invoke_operations_alert_dispatch()
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_enabled     boolean;
  v_pending     bigint;
  v_project_url text;
  v_secret      text;
  v_nonce       text;
  v_stamp       text;
  v_signature   text;
  v_request_id  bigint;
begin
  -- Gate 1: the master flag. Checked FIRST so that applying this migration
  -- before the feature is enabled costs one cheap select per tick and nothing
  -- else -- no Vault read, no HTTP, no log noise.
  select external_dispatch_enabled into v_enabled
    from public.operations_alert_settings where id;
  if not coalesce(v_enabled, false) then
    return null;
  end if;

  -- Gate 2: is there anything to do? The dispatcher is safe to call with an
  -- empty queue, but a request every five minutes forever to say "nothing"
  -- wastes an invocation and buries real activity in the logs.
  select count(*) into v_pending
    from public.operations_alert_outbox
   where channel = 'email'
     and status in ('pending', 'processing');
  if v_pending = 0 then
    return null;
  end if;

  select decrypted_secret into v_project_url
    from vault.decrypted_secrets where name = 'operations_alert_dispatch_project_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'operations_alert_dispatch_secret';

  -- Fail closed and LOUDLY: silence here would look identical to "nothing to
  -- send", which is the failure mode this whole subsystem exists to avoid.
  if v_project_url is null or v_secret is null then
    raise exception 'operations alert dispatch Vault configuration is incomplete';
  end if;

  -- Bounded: the dispatcher claims at most 20 rows and talks to SMTP, so a
  -- generous-but-finite timeout. Async fire-and-forget, like every other
  -- scheduler here; the outbox itself is the durable record of what happened.
  -- SIGN, do not send. `v_secret` is used to compute the signature and never
  -- leaves this function -- see the header for what the first version did.
  v_nonce := encode(extensions.gen_random_bytes(16), 'hex');
  v_stamp := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_signature := encode(
    extensions.hmac(v_nonce || '.' || v_stamp, v_secret, 'sha256'),
    'hex'
  );

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/operations-alert-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-alert-dispatch-nonce', v_nonce,
      'x-alert-dispatch-timestamp', v_stamp,
      'x-alert-dispatch-signature', v_signature
    ),
    body := jsonb_build_object('source', 'pg_cron', 'scheduled_at', now()),
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.invoke_operations_alert_dispatch() is
  'pg_cron driver for operations-alert-dispatch. No-ops while external dispatch is disabled or the email queue is empty; raises if Vault is incomplete once enabled.';

revoke all on function public.verify_operations_alert_dispatch_signature(text, text, text) from public, anon, authenticated;
revoke all on function public.invoke_operations_alert_dispatch() from public, anon, authenticated;
grant execute on function public.verify_operations_alert_dispatch_signature(text, text, text) to service_role;
grant execute on function public.invoke_operations_alert_dispatch() to service_role;

-- ---- 3. Schedule -------------------------------------------------------------
-- Five minutes matches the evaluator's own cadence, so an alert cannot sit
-- undelivered for longer than it took to be noticed. cron.schedule upserts by
-- name, so re-applying this file updates rather than duplicates the job.
select cron.schedule(
  'operations-alert-dispatch',
  '*/5 * * * *',
  'select public.invoke_operations_alert_dispatch();'
);

-- ---- 4. Self-verification ----------------------------------------------------
do $$
declare
  v_jobs integer;
  v_enabled boolean;
begin
  select count(*) into v_jobs from cron.job where jobname = 'operations-alert-dispatch';
  if v_jobs <> 1 then
    raise exception 'expected exactly one operations-alert-dispatch cron job, found %', v_jobs;
  end if;

  -- Applying an invocation path must not also switch the feature on.
  select external_dispatch_enabled into v_enabled
    from public.operations_alert_settings where id;
  if v_enabled is distinct from false then
    raise exception 'external_dispatch_enabled must remain false on apply (found %)', v_enabled;
  end if;

  if (select count(*) from public.operations_alert_outbox where channel = 'email') <> 0 then
    raise exception 'expected zero email outbox rows on apply';
  end if;

  -- The plaintext-secret comparison must not survive the apply. Leaving it
  -- would leave a SECURITY DEFINER oracle that answers "is this the secret?"
  -- for anyone who finds a second way to call it.
  if exists (select 1 from pg_proc where proname = 'verify_operations_alert_dispatch_secret') then
    raise exception 'verify_operations_alert_dispatch_secret must not exist after apply';
  end if;
end $$;
