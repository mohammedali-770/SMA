-- ============================================================================
-- OPERATIONS ALERTS -- pair a recovery EMAIL with the opening that was mailed
--
-- WHY THIS EXISTS. Measured on live data on 2026-09-09, while checking what
-- turning `external_dispatch_enabled` on would actually send: of the 12 emails
-- the last seven days would have produced, **four were `lazywait:sync_degraded`
-- recoveries whose openings were never mailed.** The opening is `warning`, which
-- `dispatch_min_severity = 'critical'` correctly suppresses; the recovery is
-- `info`, and the producer admits `recovered` through its own switch:
--
--     (p_event_type = 'recovered' and recovery_notifications_enabled)
--       or p_severity = 'critical'
--       or (p_severity = 'warning' and dispatch_min_severity = 'warning')
--
-- so the recovery bypasses the severity floor entirely. The responder is told an
-- incident CLEARED that they were never told had STARTED. That is worse than
-- either mailing both or mailing neither: an alert channel whose messages do not
-- refer to anything the reader has seen is a channel they learn to ignore, which
-- is the exact failure this subsystem exists to prevent.
--
-- THIS IS THE MISSING HALF OF AN IDEA THAT IS ALREADY HERE, not a new rule. The
-- evaluator's recovery pass already refuses to notify about a recovery that was
-- never announced:
--
--     v_suppress := (not v_settings.recovery_notifications_enabled)
--                   or (v_alert.last_notified_at is null);
--
-- That guard is correct and it stays. It simply measures the wrong channel for
-- email: `last_notified_at` records that the alert was notified AT ALL -- and it
-- is set on open and on escalation regardless of severity, so a `warning` that
-- only ever appeared in-app satisfies it. The email channel inherited a decision
-- made for the in-app inbox. This migration gives email its own answer to the
-- same question.
--
-- THE RULE. A `recovered` event emits an email row only if THIS EPISODE has
-- already emitted one. Everything else is unchanged.
--
-- WHY `alert_id` IS THE RIGHT SCOPE, and why it is exact rather than
-- approximate. `operations_alert_state` carries a unique index on
-- `(fingerprint) where status = 'open'`, and the evaluator's open pass INSERTS A
-- NEW ROW per episode with `generation = max(generation) + 1` -- it does not
-- reuse the recovered row. So every event of one episode shares one `alert_id`,
-- and the next episode has a different one. A time window or a fingerprint match
-- would both be approximations of that; the foreign key is the fact.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--
--   * It does not touch `in_app`. The in-app inbox is a history, and a history
--     with openings but no closings is worse than a noisy one.
--   * It does not change the severity floor, the language rule, or
--     `recovery_notifications_enabled`. Turning recoveries off entirely is still
--     one settings change; this makes that a preference rather than the only
--     defence against nonsense mail.
--   * It does not suppress a recovery whose episode mailed an ESCALATION rather
--     than an opening. If you were told anything about this episode you are told
--     it ended -- which is why the check is "any earlier email row for this
--     alert_id" and not "the opened row".
--   * It changes NO money path, no customer-facing behaviour, and sends nothing:
--     `external_dispatch_enabled` is false, so the branch it guards is
--     unreachable until somebody turns dispatch on.
-- ============================================================================

create or replace function public.operations_alerts_outbox_for_event(
  p_event_id uuid,
  p_event_type text,
  p_subsystem text,
  p_condition_code text,
  p_severity text
)
returns integer
language plpgsql
volatile
set search_path = public
as $$
declare
  v_lang text;
  v_rendered jsonb;
  v_inserted integer := 0;
  v_ct integer;
  v_s public.operations_alert_settings%rowtype;
  v_email boolean;
  v_episode_mailed boolean := false;
begin
  -- Settings decide whether an EMAIL sibling row is emitted beside the in_app
  -- one. Read once, outside the loop: the language and severity floor are
  -- per-call constants, and a missing singleton must not silently enable mail.
  select * into v_s from public.operations_alert_settings where id;

  -- RECOVERY PAIRING. Computed once, before the loop, and only for the event
  -- type that needs it -- a recovery is the only event that can be admitted
  -- while its own episode was never mailed.
  --
  -- Read through `operations_alert_events` rather than off the outbox alone:
  -- `alert_event_id` is nullable there (digest rows carry `digest_run_id`
  -- instead), so the join is what restricts the question to this episode.
  --
  -- `o.alert_event_id <> p_event_id` is INSURANCE, NOT A LOAD-BEARING GUARD, and
  -- it is worth saying so rather than letting a reader assume it is tested.
  -- Removing it survives mutation testing: every current caller inserts the
  -- event and then calls this function, so the current event cannot already own
  -- an email row and the exclusion never changes an answer. It is kept because
  -- a future caller that pre-inserts one would otherwise make this check
  -- self-satisfying -- a recovery would license itself. The suite cannot kill
  -- this line without manufacturing a state the system cannot currently reach,
  -- so it is documented instead of faked.
  if p_event_type = 'recovered' then
    select exists (
      select 1
        from public.operations_alert_outbox o
        join public.operations_alert_events e on e.id = o.alert_event_id
       where o.channel = 'email'
         and o.alert_event_id <> p_event_id
         and e.alert_id = (
           select e2.alert_id from public.operations_alert_events e2
            where e2.id = p_event_id
         )
    ) into v_episode_mailed;
  end if;

  foreach v_lang in array array['en', 'ar'] loop
    v_rendered := public.operations_alerts_render_event(
      p_event_type, v_lang, p_subsystem, p_condition_code, p_severity);
    insert into public.operations_alert_outbox
      (idempotency_key, alert_event_id, channel, language,
       subject_safe, body_safe, template_data, status, blocked_reason)
    values
      ('alert_event:' || p_event_id::text || ':in_app:' || v_lang,
       p_event_id, 'in_app', v_lang,
       v_rendered ->> 'subject', v_rendered ->> 'body',
       jsonb_build_object(
         'event_type', p_event_type, 'subsystem', p_subsystem,
         'condition_code', p_condition_code, 'severity', p_severity),
       'recorded', null)
    on conflict (idempotency_key) do nothing;
    get diagnostics v_ct = row_count;
    v_inserted := v_inserted + v_ct;

    -- EMAIL sibling. ONE row per event, not one per language: the in_app pair
    -- is a bilingual record, but a responder reads one mailbox. `v_lang` is
    -- matched against the configured dispatch language so exactly one of the
    -- two loop passes emits.
    --
    -- The severity gate is what makes this safe to switch on. Measured live
    -- 2026-09-03: `lazywait:sync_degraded` has opened and self-recovered within
    -- the evaluator's own 5-minute interval on all four occasions it fired.
    -- Mailing every warning would have sent eight emails for four non-events.
    -- The floor therefore defaults to 'critical'; widening it is a settings
    -- change, not a migration.
    --
    -- `recovered` events carry severity 'info', so they are admitted by their
    -- own switch rather than by the severity comparison -- and `v_episode_mailed`
    -- is what stops that switch announcing the end of something whose beginning
    -- this channel never announced. See the header.
    v_email := coalesce(v_s.external_dispatch_enabled, false)
      and v_lang = coalesce(v_s.dispatch_language, 'en')
      and (
        (p_event_type = 'recovered'
           and coalesce(v_s.recovery_notifications_enabled, true)
           and v_episode_mailed)
        or p_severity = 'critical'
        or (p_severity = 'warning' and coalesce(v_s.dispatch_min_severity, 'critical') = 'warning')
      );

    if v_email then
      insert into public.operations_alert_outbox
        (idempotency_key, alert_event_id, channel, language,
         subject_safe, body_safe, template_data, status, blocked_reason)
      values
        ('alert_event:' || p_event_id::text || ':email:' || v_lang,
         p_event_id, 'email', v_lang,
         v_rendered ->> 'subject', v_rendered ->> 'body',
         jsonb_build_object(
           'event_type', p_event_type, 'subsystem', p_subsystem,
           'condition_code', p_condition_code, 'severity', p_severity),
         'pending', null)
      on conflict (idempotency_key) do nothing;
      get diagnostics v_ct = row_count;
      v_inserted := v_inserted + v_ct;
    end if;
  end loop;
  return v_inserted;
end;
$$;

comment on function public.operations_alerts_outbox_for_event(uuid, text, text, text, text) is
  'Writes the in_app pair and, when external dispatch is on, one email sibling in the configured language. A recovered event mails only if the same episode (alert_id) already mailed.';

revoke all on function public.operations_alerts_outbox_for_event(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.operations_alerts_outbox_for_event(uuid, text, text, text, text)
  to service_role;

-- ---- Self-verification -------------------------------------------------------
do $$
declare
  v_src text;
  v_acl text;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_alerts_outbox_for_event';
  if v_src is null then
    raise exception 'recovery pairing verification failed: producer function is missing';
  end if;

  -- The guard is present AND wired into the gate. Asserting only that the
  -- variable exists would pass on a version that computes it and never uses it,
  -- which is precisely the shape of the bug being fixed -- a value decided in
  -- one place and ignored in another.
  if v_src not like '%v_episode_mailed%' then
    raise exception 'recovery pairing verification failed: v_episode_mailed absent from the producer';
  end if;
  if v_src not like '%and v_episode_mailed%' then
    raise exception 'recovery pairing verification failed: v_episode_mailed is computed but not applied to the email gate';
  end if;

  -- The episode scope must be alert_id. A fingerprint or time-window variant
  -- would look similar and silently re-admit a LATER episode's recovery.
  if v_src not like '%e.alert_id%' then
    raise exception 'recovery pairing verification failed: the episode check is not scoped by alert_id';
  end if;

  -- What must NOT have changed: the severity floor and the in_app pair.
  if v_src not like '%dispatch_min_severity%' then
    raise exception 'recovery pairing verification failed: the severity floor was lost';
  end if;
  if v_src not like '%:in_app:%' then
    raise exception 'recovery pairing verification failed: the in_app pair was lost';
  end if;

  select array_to_string(p.proacl, ' | ') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'operations_alerts_outbox_for_event';
  if v_acl like '%anon=X%' or v_acl like '%authenticated=X%' then
    raise exception 'recovery pairing verification failed: producer is reachable by anon or authenticated';
  end if;

  -- Applying this must not have enabled anything.
  if (select coalesce(external_dispatch_enabled, false)
        from public.operations_alert_settings limit 1) then
    raise exception 'recovery pairing verification failed: external_dispatch_enabled is true; this migration must not enable dispatch';
  end if;
end $$;
