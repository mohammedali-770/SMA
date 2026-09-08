-- ============================================================================
-- DATA PORTABILITY -- `export_my_data()`
--
-- WHY THIS EXISTS. `docs/GO_LIVE_READINESS.md` A6 marks data-subject rights as
-- partially met: deletion and correction exist (`anonymize_account_data`,
-- `AccountSettingsScreen`), but **access and portability -- giving a customer a
-- copy of their own data -- have no implementation at all.** Confirmed live
-- before writing this: zero functions in `public` match `%export%`, `%portab%`
-- or `%my_data%`. Under the PDPL a data subject may ask to see their data and
-- to receive a copy of it; there was no way to answer either request except by
-- an administrator querying the database by hand.
--
-- THE WHOLE DESIGN IS "NO PARAMETER". The function takes NOTHING and reads
-- `auth.uid()`. That is deliberate and it is the security property: a portability
-- endpoint that accepts a customer id is an enumeration oracle for every
-- customer's name, phone, address history and order history. There is no id to
-- forge because there is no argument. This is the same reasoning that keeps
-- `compute_order_snapshot` service-role-only and made `preview_loyalty_points` a
-- wrapper rather than an exposure (`docs/LOYALTY.md` §3a).
--
-- WHAT IS DELIBERATELY LEFT OUT, and why each omission is a decision:
--
--   * `push_devices.expo_push_token` -- device metadata and the two notification
--     preferences ARE included, because they are the customer's own settings and
--     they are what a "what do you know about me" request is really asking. The
--     raw token is not: an export is a file the customer may email to themselves
--     or paste into a support chat, and a leaked token lets a third party
--     address notifications to that device. Metadata answers the question; the
--     token only adds risk.
--   * `profiles.role`, `lazywait_customer_id`, `updated_by` anywhere, and the
--     whole `orders` operational tail (`sync_*`, `pos_*`, `lazywait_*`,
--     `refund_*`, `idempotency_key`). These are ours, not theirs -- internal
--     integration state that describes how our systems behaved, not personal
--     data about the customer. Including them would make the export harder to
--     read and would leak the POS integration's shape.
--   * anything belonging to anybody else. Every subquery is keyed on the caller.
--
-- WHAT IS INCLUDED ON PURPOSE: the identity fields, saved addresses, the full
-- order history with line items, and the complete loyalty ledger -- the last
-- because after `20260909120000` a balance can be reduced by an `expire` row,
-- and a customer who cannot see that row cannot check the arithmetic.
-- ============================================================================

create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  -- Not an assertion about configuration -- an anonymous caller reaching a
  -- SECURITY DEFINER function must be refused explicitly, or the function would
  -- run as owner with a null filter and return nothing while looking successful.
  if v_uid is null then
    raise exception 'export_my_data requires an authenticated session'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'about', 'Everything Spicy Meal holds about you that is personal to you. '
             || 'Operational records of how our own systems handled an order '
             || '(point-of-sale sync state, retry bookkeeping) are not included, '
             || 'and neither is your device notification token.',

    'account', (
      select jsonb_build_object(
        'name', p.full_name,
        'phone', p.phone_number,
        'phone_verified', p.phone_verified,
        'phone_verified_at', p.phone_verified_at,
        'email', p.email,
        'loyalty_points_balance', p.loyalty_points,
        'account_created_at', p.created_at
      )
      from public.profiles p where p.id = v_uid
    ),

    'saved_addresses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', a.label,
        'description', a.description,
        'national_short_address', a.national_short_address,
        'latitude', a.latitude,
        'longitude', a.longitude,
        'is_default', a.is_default,
        'saved_at', a.created_at
      ) order by a.created_at)
      from public.addresses a where a.customer_id = v_uid
    ), '[]'::jsonb),

    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'order_number', o.order_number,
        'placed_at', o.created_at,
        'status', o.status,
        'order_type', o.order_type,
        'branch', o.branch_name_en,
        'delivered_to', o.address_snapshot,
        'your_note', o.notes,
        'subtotal', o.subtotal,
        'delivery_fee', o.delivery_fee,
        'coupon_code', o.coupon_code,
        'coupon_discount', o.discount_amount,
        'loyalty_discount', o.loyalty_discount_amount,
        'vat', o.vat_amount,
        'total', o.total,
        'payment_method', o.payment_method,
        'payment_status', o.payment_status,
        'paid_at', o.paid_at,
        'points_earned', o.loyalty_points_earned,
        'points_redeemed', o.loyalty_points_redeemed,
        -- Included because without it the record is confusing rather than
        -- merely terse: a comped order shows a total of 0.00 and, with no
        -- `comped` flag beside it, nothing explains why. A subject-access
        -- response that leaves the reader unable to account for their own
        -- figures has not really answered the request.
        'comped', coalesce(o.is_comped, false),
        'comp_discount', o.comp_discount_amount,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'item', i.name_en,
            'variant', i.variant_name_en,
            'unit_price', i.unit_price,
            'quantity', i.quantity,
            'line_total', i.line_total,
            'your_note', i.note
          ) order by i.created_at)
          from public.order_items i where i.order_id = o.id
        ), '[]'::jsonb)
      ) order by o.created_at)
      from public.orders o where o.customer_id = v_uid
    ), '[]'::jsonb),

    'loyalty_history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', t.created_at,
        'type', t.type,
        'points', t.points,
        'balance_after', t.balance_after,
        'reason', t.reason
      ) order by t.created_at)
      from public.loyalty_transactions t where t.profile_id = v_uid
    ), '[]'::jsonb),

    -- Metadata and preferences only. The token is withheld on purpose; see the
    -- header.
    'notification_devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'platform', d.platform,
        'language', d.lang,
        'active', d.is_active,
        'order_updates_enabled', d.order_updates_enabled,
        'offers_enabled', d.promos_enabled,
        'registered_at', d.created_at
      ) order by d.created_at)
      from public.push_devices d where d.customer_id = v_uid
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

comment on function public.export_my_data() is
  'PDPL access/portability: returns the calling customer''s own personal data as '
  'JSON. Takes no argument by design -- the subject is always auth.uid(), so it '
  'cannot be used to read another customer. Excludes push tokens and internal '
  'operational state.';

-- ---- Self-verification -------------------------------------------------------
do $$
declare v_args int; v_acl text;
begin
  -- Zero arguments is the security property, so it is asserted rather than
  -- trusted: an overload taking a customer id would defeat the whole design.
  select count(*) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'export_my_data';
  if v_args <> 1 then
    raise exception 'export_my_data verification failed: expected exactly 1 overload, found %', v_args;
  end if;

  if (select pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='export_my_data') <> 0 then
    raise exception 'export_my_data verification failed: the function takes arguments, which makes it an enumeration oracle';
  end if;

  select array_to_string(proacl, ' | ') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='export_my_data';
  if v_acl like '%anon=X%' then
    raise exception 'export_my_data verification failed: anon can execute it';
  end if;
end $$;
