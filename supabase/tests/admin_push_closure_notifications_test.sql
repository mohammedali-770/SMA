-- ============================================================================
-- Admin closure notifications (migration 20260928120000).
--
-- WHAT THIS PINS, and why each one is worth a test rather than a comment.
--
--   * A NOTIFICATION CANNOT BLOCK A CLOSURE. The enqueue triggers run inside
--     the transaction that takes an item off the menu, so an exception in one
--     would abort the closure itself — a cashier told "could not close Large"
--     because a notification helper was broken. CASE 9 breaks the composer
--     deliberately and asserts the closure still lands. This is the single most
--     important assertion in the file.
--
--   * THE FILTERS ARE THE OWNER'S DECISIONS, not defaults. Closing notifies;
--     every reopen is silent; add-ons are silent; a single delivery AREA is
--     silent. Each is asserted, because each would be an easy thing to
--     "simplify" into notifying on everything.
--
--   * THE COPY NAMES THE RIGHT THINGS. A size notice has to say which size, of
--     which product, at which branch — a body that lost the product name would
--     still look plausible in a diff and be useless on a phone.
--
--   * THE CLAIM IS FENCED. Two dispatchers must not both send the same
--     notification, and a dispatcher whose lease expired must not be able to
--     overwrite the outcome written by the one that took over.
--
--   * THE QUEUE CLEANS UP AFTER ITSELF. With no sender deployed, rows must
--     expire rather than accumulate for ever.
--
--   * THE TWO PUSH CHANNELS STAY APART. Nothing here may reference
--     `push_devices`. That separation is why a bug in a staff feature cannot
--     put a branch closure on a real customer's lock screen.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

create temporary table t_fx (
  branch_id  uuid,
  product_id uuid,
  variant_id uuid,
  modifier_id uuid
) on commit drop;

do $$
declare
  v_branch   uuid := 'b0000000-0000-0000-0000-000000000001';  -- seeded: الرياض - العليا
  v_cat      uuid;
  v_product  uuid := gen_random_uuid();
  v_variant  uuid := gen_random_uuid();
  v_group    uuid := gen_random_uuid();
  v_modifier uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.branches where id = v_branch) then
    raise exception 'FIXTURE FAILED: the seeded branch is missing';
  end if;

  select id into v_cat from public.categories order by sort_order limit 1;
  if v_cat is null then
    raise exception 'FIXTURE FAILED: no seeded category';
  end if;

  insert into public.products (id, category_id, name_en, name_ar, price, is_active)
  values (v_product, v_cat, 'Test Burger', 'برجر اختبار', 25.00, true);

  insert into public.product_variants (id, product_id, name_en, name_ar, price, is_active)
  values (v_variant, v_product, 'Large', 'كبير', 30.00, true);

  -- modifier_groups is linked to products through product_modifier_groups; it
  -- carries no product_id of its own.
  insert into public.modifier_groups (id, name_en, name_ar, min_select, max_select)
  values (v_group, 'Extras', 'إضافات', 0, 3);
  insert into public.product_modifier_groups (product_id, group_id)
  values (v_product, v_group);
  insert into public.modifiers (id, group_id, name_en, name_ar, price, is_active)
  values (v_modifier, v_group, 'Cheese', 'جبن', 3.00, true);

  insert into t_fx values (v_branch, v_product, v_variant, v_modifier);
end $$;

-- Insert one audit row directly, which is exactly what the enqueue trigger
-- fires on. Driving the real RPCs is done separately in CASE 8 and CASE 9; here
-- the point is the trigger's own filters and copy, one variable at a time.
create or replace function pg_temp.emit_availability(
  p_branch uuid, p_product uuid, p_variant uuid, p_modifier uuid,
  p_action text, p_minutes integer
) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into public.branch_availability_events
    (branch_id, product_id, variant_id, modifier_id, action, duration_minutes, source)
  values (p_branch, p_product, p_variant, p_modifier, p_action, p_minutes, 'manual')
  returning id into v_id;
  return v_id;
end $$;

create or replace function pg_temp.emit_delivery(
  p_branch uuid, p_action text, p_minutes integer
) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into public.branch_delivery_events
    (branch_id, action, duration_minutes, source)
  values (p_branch, p_action, p_minutes, 'manual')
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 1 — the outbox is closed to both client roles
-- ---------------------------------------------------------------------------
do $$
declare v_n integer; v_rls boolean;
begin
  select relrowsecurity into v_rls from pg_class where oid = 'public.admin_push_outbox'::regclass;
  if not coalesce(v_rls, false) then
    raise exception 'CASE 1 FAILED: RLS is not enabled on admin_push_outbox';
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'admin_push_outbox';
  if v_n <> 0 then
    raise exception 'CASE 1 FAILED: expected zero policies, found %', v_n;
  end if;

  select count(*) into v_n from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'admin_push_outbox'
     and grantee in ('anon', 'authenticated');
  if v_n <> 0 then
    raise exception 'CASE 1 FAILED: client roles hold % privilege(s)', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 2 — closing a whole item queues one bilingual notice
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx   t_fx%rowtype;
  v_id   bigint;
  v_row  public.admin_push_outbox%rowtype;
  v_n    integer;
begin
  select * into v_fx from t_fx;
  v_id := pg_temp.emit_availability(v_fx.branch_id, v_fx.product_id, null, null, 'closed', 30);

  select count(*) into v_n from public.admin_push_outbox
   where source_table = 'branch_availability_events' and source_id = v_id;
  if v_n <> 1 then
    raise exception 'CASE 2 FAILED: expected 1 queued notice, found %', v_n;
  end if;

  select * into v_row from public.admin_push_outbox
   where source_table = 'branch_availability_events' and source_id = v_id;

  if v_row.status <> 'pending' or v_row.attempt_count <> 0 then
    raise exception 'CASE 2 FAILED: new row is %/% ', v_row.status, v_row.attempt_count;
  end if;
  if v_row.branch_id is distinct from v_fx.branch_id then
    raise exception 'CASE 2 FAILED: branch not recorded';
  end if;
  -- The Arabic body must name the product and carry the duration. A body that
  -- lost either would read as a generic "something closed" on the phone.
  if v_row.body_ar not like '%برجر اختبار%' then
    raise exception 'CASE 2 FAILED: Arabic body omits the product name: %', v_row.body_ar;
  end if;
  if v_row.body_ar not like '%30%' then
    raise exception 'CASE 2 FAILED: Arabic body omits the duration: %', v_row.body_ar;
  end if;
  if v_row.title_ar not like '%الرياض - العليا%' then
    raise exception 'CASE 2 FAILED: Arabic title omits the branch: %', v_row.title_ar;
  end if;
  if v_row.body_en not like '%Test Burger%' or v_row.body_en not like '%30 minutes%' then
    raise exception 'CASE 2 FAILED: English body is wrong: %', v_row.body_en;
  end if;
  if v_row.title_en not like '%Riyadh - Olaya%' then
    raise exception 'CASE 2 FAILED: English title omits the branch: %', v_row.title_en;
  end if;
  if v_row.tag is distinct from 'product:' || v_fx.product_id::text then
    raise exception 'CASE 2 FAILED: tag is %', v_row.tag;
  end if;
  if v_row.url <> '/' then
    raise exception 'CASE 2 FAILED: url is %', v_row.url;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 3 — closing a price tier names the size AND the product it belongs to
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx  t_fx%rowtype;
  v_id  bigint;
  v_row public.admin_push_outbox%rowtype;
begin
  select * into v_fx from t_fx;
  v_id := pg_temp.emit_availability(v_fx.branch_id, null, v_fx.variant_id, null, 'closed', 45);
  select * into v_row from public.admin_push_outbox
   where source_table = 'branch_availability_events' and source_id = v_id;

  if v_row.id is null then
    raise exception 'CASE 3 FAILED: a tier closure queued nothing';
  end if;
  -- BOTH names. "كبير مغلق" without the product is useless when nine products
  -- have a size called كبير.
  if v_row.body_ar not like '%كبير%' or v_row.body_ar not like '%برجر اختبار%' then
    raise exception 'CASE 3 FAILED: Arabic body is %', v_row.body_ar;
  end if;
  if v_row.body_en not like '%Large%' or v_row.body_en not like '%Test Burger%' then
    raise exception 'CASE 3 FAILED: English body is %', v_row.body_en;
  end if;
  if v_row.title_ar not like 'إغلاق حجم%' then
    raise exception 'CASE 3 FAILED: Arabic title is %', v_row.title_ar;
  end if;
  if v_row.tag is distinct from 'variant:' || v_fx.variant_id::text then
    raise exception 'CASE 3 FAILED: tag is %', v_row.tag;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 4 — every reopen is silent, and so is an add-on closure
--
-- These are the owner's decisions rather than defaults, which is why each is
-- asserted separately instead of one "non-closure events are ignored" case.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx  t_fx%rowtype;
  v_id  bigint;
  v_n   integer;
  v_act text;
begin
  select * into v_fx from t_fx;

  foreach v_act in array array['opened_manual', 'opened_auto'] loop
    v_id := pg_temp.emit_availability(v_fx.branch_id, v_fx.product_id, null, null, v_act, null);
    select count(*) into v_n from public.admin_push_outbox
     where source_table = 'branch_availability_events' and source_id = v_id;
    if v_n <> 0 then
      raise exception 'CASE 4 FAILED: % queued a notification', v_act;
    end if;
  end loop;

  -- An add-on closure. The highest-volume, lowest-value event there is.
  v_id := pg_temp.emit_availability(v_fx.branch_id, null, null, v_fx.modifier_id, 'closed', 30);
  select count(*) into v_n from public.admin_push_outbox
   where source_table = 'branch_availability_events' and source_id = v_id;
  if v_n <> 0 then
    raise exception 'CASE 4 FAILED: a modifier closure queued a notification';
  end if;

  -- THE EXCLUSION IS ENFORCED TWICE, and this asserts the half that carries it.
  -- The trigger's `modifier_id is not null` early-out saves a subtransaction and
  -- two queries on the most frequent event there is, but it is not what makes
  -- the behaviour correct: the composer refuses a subject it cannot describe.
  -- Mutation testing showed that removing the trigger filter alone changes
  -- nothing observable — recorded here rather than left looking like coverage.
  if public.admin_push_availability_copy(v_fx.branch_id, null, null, 30) is not null then
    raise exception 'CASE 4 FAILED: the composer produced copy for an event naming no product or tier';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 5 — delivery: a branch pause notifies, an area change does not
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx  t_fx%rowtype;
  v_id  bigint;
  v_row public.admin_push_outbox%rowtype;
  v_n   integer;
  v_act text;
begin
  select * into v_fx from t_fx;

  v_id := pg_temp.emit_delivery(v_fx.branch_id, 'delivery_paused', 60);
  select * into v_row from public.admin_push_outbox
   where source_table = 'branch_delivery_events' and source_id = v_id;
  if v_row.id is null then
    raise exception 'CASE 5 FAILED: a delivery pause queued nothing';
  end if;
  if v_row.title_ar not like 'إيقاف التوصيل%' or v_row.title_ar not like '%الرياض - العليا%' then
    raise exception 'CASE 5 FAILED: Arabic title is %', v_row.title_ar;
  end if;
  if v_row.body_en not like '%60 minutes%' then
    raise exception 'CASE 5 FAILED: English body is %', v_row.body_en;
  end if;
  if v_row.tag is distinct from 'delivery:' || v_fx.branch_id::text then
    raise exception 'CASE 5 FAILED: tag is %', v_row.tag;
  end if;

  -- Everything else on that table stays silent, including the area events and
  -- both resumes.
  foreach v_act in array array['delivery_resumed_manual', 'delivery_resumed_auto',
                               'area_disabled', 'area_enabled_manual', 'area_enabled_auto'] loop
    v_id := pg_temp.emit_delivery(v_fx.branch_id, v_act, 30);
    select count(*) into v_n from public.admin_push_outbox
     where source_table = 'branch_delivery_events' and source_id = v_id;
    if v_n <> 0 then
      raise exception 'CASE 5 FAILED: % queued a notification', v_act;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 6 — the Arabic duration phrase, which is not a template
--
-- Arabic counts 1, 2, 3-10 and 11+ differently. A bare "لمدة N دقيقة" is wrong
-- for every value below 11, and wrong in a way an English reader reviewing the
-- diff cannot see.
-- ---------------------------------------------------------------------------
do $$
begin
  if public.admin_push_duration_ar(null) <> 'حتى إشعار آخر' then
    raise exception 'CASE 6 FAILED: null -> %', public.admin_push_duration_ar(null);
  end if;
  if public.admin_push_duration_ar(0) <> 'حتى إشعار آخر' then
    raise exception 'CASE 6 FAILED: 0 -> %', public.admin_push_duration_ar(0);
  end if;
  if public.admin_push_duration_ar(1) <> 'لمدة دقيقة واحدة' then
    raise exception 'CASE 6 FAILED: 1 -> %', public.admin_push_duration_ar(1);
  end if;
  if public.admin_push_duration_ar(2) <> 'لمدة دقيقتين' then
    raise exception 'CASE 6 FAILED: 2 -> %', public.admin_push_duration_ar(2);
  end if;
  if public.admin_push_duration_ar(5) <> 'لمدة 5 دقائق' then
    raise exception 'CASE 6 FAILED: 5 -> %', public.admin_push_duration_ar(5);
  end if;
  if public.admin_push_duration_ar(30) <> 'لمدة 30 دقيقة' then
    raise exception 'CASE 6 FAILED: 30 -> %', public.admin_push_duration_ar(30);
  end if;
  if public.admin_push_duration_en(1) <> 'for 1 minute' then
    raise exception 'CASE 6 FAILED: en 1 -> %', public.admin_push_duration_en(1);
  end if;
  if public.admin_push_duration_en(null) <> 'until further notice' then
    raise exception 'CASE 6 FAILED: en null -> %', public.admin_push_duration_en(null);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 7 — the master switch stops NEW rows being queued
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx t_fx%rowtype;
  v_id bigint;
  v_n  integer;
begin
  select * into v_fx from t_fx;
  update public.app_settings set admin_push_enabled = false where id;

  v_id := pg_temp.emit_availability(v_fx.branch_id, v_fx.product_id, null, null, 'closed', 15);
  select count(*) into v_n from public.admin_push_outbox
   where source_table = 'branch_availability_events' and source_id = v_id;
  if v_n <> 0 then
    raise exception 'CASE 7 FAILED: a closure queued a notice while the switch was off';
  end if;

  update public.app_settings set admin_push_enabled = true where id;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 8 — the REAL closure path, end to end
--
-- Everything above inserts an audit row directly. This drives the RPC a cashier
-- actually presses, so it proves the whole chain: set_product_snooze writes
-- branch_product_availability, its own trigger writes the audit row, and the
-- enqueue trigger fires off that.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx    t_fx%rowtype;
  v_n     integer;
  v_body  text;
begin
  select * into v_fx from t_fx;
  perform set_config('test.is_admin', 'true', true);

  perform public.set_product_snooze(v_fx.branch_id, v_fx.product_id, 20, 'out_of_stock', null);

  select count(*) into v_n from public.branch_product_availability
   where branch_id = v_fx.branch_id and product_id = v_fx.product_id and not is_available;
  if v_n <> 1 then
    raise exception 'CASE 8 FAILED: the product was not closed';
  end if;

  select o.body_ar into v_body
    from public.admin_push_outbox o
    join public.branch_availability_events e
      on e.id = o.source_id and o.source_table = 'branch_availability_events'
   where e.product_id = v_fx.product_id and e.action = 'closed'
   order by o.id desc limit 1;
  if v_body is null then
    raise exception 'CASE 8 FAILED: the real closure path queued nothing';
  end if;
  if v_body not like '%برجر اختبار%' then
    raise exception 'CASE 8 FAILED: body is %', v_body;
  end if;

  perform set_config('test.is_admin', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- CASE 9 — A BROKEN NOTIFICATION CANNOT BLOCK A CLOSURE
--
-- The most important assertion here. The enqueue trigger runs inside the
-- transaction that closes the item, so without its exception guard a fault in
-- any part of this feature becomes a cashier unable to take something off the
-- menu during a rush. The composer is deliberately replaced with one that
-- raises, and the closure must still land.
-- ---------------------------------------------------------------------------
savepoint before_broken_composer;

create or replace function public.admin_push_availability_copy(
  p_branch_id uuid, p_product_id uuid, p_variant_id uuid, p_minutes integer
) returns jsonb language plpgsql stable as $broken$
begin
  raise exception 'deliberately broken composer';
end $broken$;

do $$
declare
  v_fx t_fx%rowtype;
  v_n  integer;
begin
  select * into v_fx from t_fx;

  -- Reopen first so the next close is a real transition the RPC will act on.
  perform set_config('test.is_admin', 'true', true);
  perform public.clear_product_snooze(v_fx.branch_id, v_fx.product_id);
  perform public.set_product_snooze(v_fx.branch_id, v_fx.product_id, 25, 'out_of_stock', null);
  perform set_config('test.is_admin', '', true);

  select count(*) into v_n from public.branch_product_availability
   where branch_id = v_fx.branch_id and product_id = v_fx.product_id and not is_available;
  if v_n <> 1 then
    raise exception 'CASE 9 FAILED: a broken notification composer blocked the closure';
  end if;

  -- And the audit row still exists: the closure was recorded in full.
  select count(*) into v_n from public.branch_availability_events
   where product_id = v_fx.product_id and action = 'closed' and duration_minutes = 25;
  if v_n < 1 then
    raise exception 'CASE 9 FAILED: the audit row was lost with the notification';
  end if;
end $$;

-- The real composer comes back with the savepoint, which also undoes the
-- closure this case made. Restoring by re-running the migration would work and
-- would also re-schedule the cron job and re-enter the Vault block, so it would
-- be testing the restore rather than the feature.
rollback to savepoint before_broken_composer;
release savepoint before_broken_composer;

-- The guard must be REAL, not an artefact of the composer never being called:
-- with the genuine composer back, the same closure queues a notice.
do $$
declare v_fx t_fx%rowtype; v_n integer;
begin
  select * into v_fx from t_fx;
  perform set_config('test.is_admin', 'true', true);
  perform public.clear_product_snooze(v_fx.branch_id, v_fx.product_id);
  perform public.set_product_snooze(v_fx.branch_id, v_fx.product_id, 35, 'out_of_stock', null);
  perform set_config('test.is_admin', '', true);

  select count(*) into v_n
    from public.admin_push_outbox o
    join public.branch_availability_events e
      on e.id = o.source_id and o.source_table = 'branch_availability_events'
   where e.product_id = v_fx.product_id and e.duration_minutes = 35;
  if v_n <> 1 then
    raise exception 'CASE 9 FAILED: the restored composer queued % notice(s)', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 10 — the claim is fenced, bounded and idempotent under a second caller
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx     t_fx%rowtype;
  v_token1 uuid := gen_random_uuid();
  v_token2 uuid := gen_random_uuid();
  v_first  integer;
  v_second integer;
  v_row    public.admin_push_outbox%rowtype;
  v_ok     boolean;
  v_id     bigint;
begin
  select * into v_fx from t_fx;

  -- A queue with exactly one row, whatever the earlier cases left behind.
  delete from public.admin_push_outbox;
  v_id := pg_temp.emit_availability(v_fx.branch_id, v_fx.product_id, null, null, 'closed', 10);

  select count(*) into v_first from public.claim_admin_push_notifications(v_token1, 10);
  if v_first <> 1 then
    raise exception 'CASE 10 FAILED: first claim returned % rows', v_first;
  end if;

  select * into v_row from public.admin_push_outbox where source_id = v_id;
  if v_row.status <> 'processing' or v_row.attempt_count <> 1
     or v_row.claim_token is distinct from v_token1 then
    raise exception 'CASE 10 FAILED: after claim the row is %/%/%',
      v_row.status, v_row.attempt_count, v_row.claim_token;
  end if;

  -- A SECOND DISPATCHER MUST GET NOTHING. The lease is fresh, so this row is
  -- not available to anyone else — which is what stops one closure producing
  -- two notifications.
  select count(*) into v_second from public.claim_admin_push_notifications(v_token2, 10);
  if v_second <> 0 then
    raise exception 'CASE 10 FAILED: a second dispatcher claimed % row(s)', v_second;
  end if;

  -- THE FENCE. The stale owner must not be able to write the outcome.
  v_ok := public.finalize_admin_push_notification(v_row.id, v_token2, 'sent', null);
  if v_ok then
    raise exception 'CASE 10 FAILED: a foreign token finalized the row';
  end if;
  select status into v_row.status from public.admin_push_outbox where id = v_row.id;
  if v_row.status <> 'processing' then
    raise exception 'CASE 10 FAILED: a foreign token changed the status to %', v_row.status;
  end if;

  -- The real owner can.
  v_ok := public.finalize_admin_push_notification(v_row.id, v_token1, 'sent', null);
  if not v_ok then
    raise exception 'CASE 10 FAILED: the owning token could not finalize';
  end if;
  select * into v_row from public.admin_push_outbox where id = v_row.id;
  if v_row.status <> 'sent' or v_row.claim_token is not null then
    raise exception 'CASE 10 FAILED: after finalize the row is %/%', v_row.status, v_row.claim_token;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 11 — the attempt budget, and the only two outcomes finalize accepts
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx    t_fx%rowtype;
  v_token uuid := gen_random_uuid();
  v_n     integer;
  v_id    bigint;
  v_state text;
begin
  select * into v_fx from t_fx;
  delete from public.admin_push_outbox;
  v_id := pg_temp.emit_availability(v_fx.branch_id, v_fx.product_id, null, null, 'closed', 10);

  -- A row that has already used its budget is invisible to the claim, so a
  -- permanently failing notification cannot be retried for ever.
  update public.admin_push_outbox set attempt_count = 3, status = 'pending';
  select count(*) into v_n from public.claim_admin_push_notifications(v_token, 10);
  if v_n <> 0 then
    raise exception 'CASE 11 FAILED: an exhausted row was claimed';
  end if;

  update public.admin_push_outbox set attempt_count = 2, status = 'pending';
  select count(*) into v_n from public.claim_admin_push_notifications(v_token, 10);
  if v_n <> 1 then
    raise exception 'CASE 11 FAILED: a row with budget left was not claimed';
  end if;

  begin
    perform public.finalize_admin_push_notification(
      (select id from public.admin_push_outbox limit 1), v_token, 'skipped', null);
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from '22023' then
    raise exception 'CASE 11 FAILED: finalize accepted a bad status (sqlstate %)', coalesce(v_state, 'none');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 12 — the driver expires and prunes, and no-ops on an empty queue
--
-- With no sender deployed the queue must clean itself rather than grow for
-- ever, and a notice too old to be worth showing must never be shown.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx  t_fx%rowtype;
  v_old bigint;
  v_new bigint;
  v_n   integer;
  v_ret bigint;
begin
  select * into v_fx from t_fx;
  delete from public.admin_push_outbox;

  v_old := pg_temp.emit_availability(v_fx.branch_id, v_fx.product_id, null, null, 'closed', 10);
  update public.admin_push_outbox set created_at = now() - interval '3 hours'
   where source_id = v_old;

  v_new := pg_temp.emit_availability(v_fx.branch_id, null, v_fx.variant_id, null, 'closed', 10);

  -- THE PROPERTY UNDER TEST IS THAT HOUSEKEEPING SURVIVES AN UNCONFIGURED
  -- DEPLOYMENT. This harness has no project URL in Vault, so the driver takes
  -- its incomplete-configuration path — and that path must RECORD rather than
  -- raise, because pg_cron runs the job in one transaction and an exception
  -- would roll the expiry back with it. A driver that raised here would pass
  -- every other assertion in this file and still let the table grow for ever on
  -- exactly the deployment that cannot send.
  begin
    v_ret := public.invoke_admin_push_dispatch();
  exception when others then
    raise exception 'CASE 12 FAILED: the driver raised (%) instead of recording — pg_cron runs the job in one transaction, so that rolls the expiry back with it', sqlerrm;
  end;
  if v_ret is not null then
    raise exception 'CASE 12 FAILED: an unconfigured driver returned %', v_ret;
  end if;

  if (select status from public.admin_push_outbox where source_id = v_old) <> 'skipped' then
    raise exception 'CASE 12 FAILED: a three-hour-old notice was not expired';
  end if;
  if (select status from public.admin_push_outbox where source_id = v_new) <> 'pending' then
    raise exception 'CASE 12 FAILED: a fresh notice was expired';
  end if;

  -- And the fault is written where somebody will read it, rather than only into
  -- a server log nobody tails.
  if (select last_error from public.admin_push_outbox where source_id = v_new)
       not like 'dispatch not configured%' then
    raise exception 'CASE 12 FAILED: the held notice records no reason';
  end if;

  -- Retention: a terminal row past fourteen days goes.
  update public.admin_push_outbox
     set status = 'sent', created_at = now() - interval '20 days'
   where source_id = v_new;
  v_ret := public.invoke_admin_push_dispatch();
  select count(*) into v_n from public.admin_push_outbox where source_id = v_new;
  if v_n <> 0 then
    raise exception 'CASE 12 FAILED: a twenty-day-old sent row survived the prune';
  end if;

  -- An empty queue is a no-op that returns null rather than raising, so the
  -- cron job is silent on an unconfigured deployment.
  delete from public.admin_push_outbox;
  v_ret := public.invoke_admin_push_dispatch();
  if v_ret is not null then
    raise exception 'CASE 12 FAILED: an empty queue returned %', v_ret;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 13 — the two push channels stay apart
--
-- Nothing this feature installs may reference the customer Expo channel. The
-- moment they share a code path, a predicate error in a staff feature can put a
-- branch closure on a real customer's lock screen.
-- ---------------------------------------------------------------------------
do $$
declare v_n integer; v_name text;
begin
  -- `%admin_push%`, NOT `admin_push%`. Three of this feature's functions are
  -- named `claim_`/`finalize_`/`invoke_admin_push_…`, so a prefix match would
  -- silently exempt the claim RPC — the one function that reads rows and would
  -- be the natural place for somebody to "also notify the customer".
  select count(*), string_agg(p.proname, ', ') into v_n, v_name
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname like '%admin_push%'
     and (p.prosrc like '%push_devices%' or p.prosrc like '%promos_enabled%'
          or p.prosrc like '%expo%');
  if v_n <> 0 then
    raise exception 'CASE 13 FAILED: % reference the customer push channel', v_name;
  end if;

  -- And the reverse: nothing outside this feature may touch the queue.
  select count(*), string_agg(p.proname, ', ') into v_n, v_name
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname not like '%admin_push%'
     and p.prosrc like '%admin_push_outbox%';
  if v_n <> 0 then
    raise exception 'CASE 13 FAILED: % touch the outbox from outside the feature', v_name;
  end if;
end $$;

rollback;
