-- ============================================================================
-- "GET A COPY OF MY DATA" NOW INCLUDES THE CUSTOMER'S OWN PAYMENT RECORDS
-- Gap PG-26, docs/readiness/20261113-card-payments-gaps.md.
--
-- WHAT WAS WRONG. `export_my_data()` (20260912120000) told the customer it held
-- "Everything Spicy Meal holds about you that is personal to you", and read no
-- payment table: not `payment_records`, `checkout_sessions` or
-- `order_refunds`. Measured on the local chain at 52a3976 against the live
-- body (md5(prosrc) 0edc9f733aa5756df86ee3a2505bc717, 4 973 characters; live
-- facts read 2026-11-14): the body names none of the three. Once card payment
-- is on, a customer's copy would leave out their card payments, the card used
-- (network, last four, issuing bank), every declined try and every refund.
--
-- WHAT THIS DOES. It redefines `export_my_data()` and nothing else. The new
-- body is the live one with ONE insertion: three new collections after
-- `notification_devices`. Every existing key is byte-identical, and so is the
-- `about` text. It stays true because nothing below exports how our own
-- systems handled an order: the one stored code that says so, a refund's
-- reason, is turned into words (below).
--
--   checkouts  every online checkout the customer started (checkout_sessions);
--   payments   every payment record that belongs to them (payment_records),
--              each with the card facts of every try at paying it;
--   refunds    every refund of one of their orders (order_refunds).
--
-- THE SECURITY MODEL DOES NOT MOVE. Still no argument: the subject is always
-- `auth.uid()`, so there is no id to forge. Still `SECURITY DEFINER`, `stable`,
-- `search_path = public`. Still 42501 for a caller with no subject, from the
-- same guard. The grants are re-stated exactly as 20260912120000 left them:
-- EXECUTE revoked from PUBLIC and `anon`, granted to `authenticated`.
-- `service_role` keeps the EXECUTE it had (a create-or-replace keeps the ACL).
--
-- WHICH ROWS. A checkout is the caller's when its `customer_id` is the
-- caller. A refund is the caller's when its order is. A payment record has no
-- customer column: it links to an order, a checkout session, or both (its own
-- CHECK requires one), and it is returned only when EVERY link it has points
-- at the caller. A record that touches another customer through either link is
-- never returned, even if the other link is the caller's.
--
-- An order whose customer deleted their account keeps its row with
-- `customer_id` NULL (`orders_customer_id_fkey` is ON DELETE SET NULL), and an
-- order-first payment record or a refund stays on it. NULL is nobody: every
-- test above is an equality with the caller, which NULL never satisfies, so
-- such a record reaches no export. The paired suite pins it with an account
-- that is really deleted.
--
-- Payment records are found FROM the caller's own orders and checkouts, by
-- their indexes (`orders_customer_created_idx`, `checkout_sessions_customer_idx`,
-- `payment_records_order_idx`, `payment_records_session_idx`), so one export
-- costs what that customer's history costs, not a scan of every payment.
--
-- EACH COLUMN, DECIDED WITH EVIDENCE. The test is the one the original header
-- set: the customer's own data is in, how our systems behaved is out, and every
-- number should be accountable from the export itself.
--
--   payment_records (one entry per record)
--     IN   provider, status, mode, amount, currency: what was charged, how it
--          ended, and whether it was a TEST payment (mode 'test' moved no
--          money, which the customer needs to read the amount).
--     IN   provider_ref as `payment_id` and provider_checkout_ref as
--          `invoice_id`: Moyasar's ids for the payment and the payment page.
--          They are the references a bank or Moyasar asks for.
--     IN   card_scheme, card_last_four: the card that paid, set at
--          confirmation (moyasarVerify.ts; finalize_checkout_session).
--     IN   created_at as `started_at`, confirmed_at, failed_at, expires_at.
--     IN   failure_message_safe as `note`: the outcome in words, written to be
--          shown. It is how a duplicate charge reads ("Duplicate payment: the
--          order was already paid. Refund this payment."); without it a
--          record with status `failed` would hide that money was taken.
--     IN   order_id as the order's `order_number`, and checkout_session_id as
--          `checkout_id`: the links, so a payment can be matched to its order
--          and checkout in the same file. The customer can already read their
--          own session ids (policy `checkout_sessions_select_own`), and every
--          function that acts on a session checks the caller, so the id is a
--          reference, not a key.
--     IN   from `raw`, one named field at a time (`tries`): for each try the
--          stored response holds, its payment id, status and time, and from
--          `source` the method, card network, last four, issuer name and
--          country, the bank's message and response code, and the
--          authorisation and reference numbers. These are fields
--          `sanitizeMoyasarPayment` (supabase/functions/_shared/moyasar.ts)
--          already keeps because they are safe; its amounts and fee are left
--          out (below), and its currency and invoice id are the record's own.
--          For a declined try `raw` is the only place we keep the card details
--          (PG-24), so leaving `tries` out would leave out data we hold. A Tap
--          record (history only) gives the same facts from Tap's shape.
--     OUT  raw itself: the provider payload. Its shape varies (one payment, an
--          invoice, or Tap's charge), and it carries Moyasar's `fee` (its
--          charge to us, not data about the customer) and amounts in halalas,
--          which are 100 times the riyal figure. The `refunded` and `captured`
--          amounts inside it are also left out: halalas again, and never
--          updated after the record is written (PG-14).
--     OUT  checkout_url: a link that opens the payment page. It is a
--          capability, not data about the customer, and an export may be
--          pasted into a support chat.
--     OUT  reference_transaction: our random per-attempt key, used to find an
--          invoice before creating another (find-before-create). It works as
--          an idempotency key.
--     OUT  reference_order: our reference built from the first 12 hex digits
--          of the order or session id. `checkout_id` and `order_number`
--          already link the record.
--     OUT  failure_code: our machine code for how our system recorded the
--          outcome (`create_401`, `network_unreachable`, `duplicate_payment`).
--          `note` and the bank's message in `tries` give the outcome.
--     OUT  id, initiated_at (set to the same moment as created_at),
--          last_verified_at (when our server last asked Moyasar), updated_at:
--          our bookkeeping.
--
--   checkout_sessions (one entry per checkout)
--     IN   always: id as `checkout_id`, created_at as `started_at`, status,
--          the order's `order_number` (only when the order is the caller's),
--          consumed_at as `completed_at`, expires_at, order_type,
--          payment_method.
--     IN   only for a checkout that did NOT become one of the caller's
--          orders: notes as `your_note`, subtotal, delivery_fee,
--          discount_amount as `coupon_discount`, loyalty_discount_amount as
--          `loyalty_discount`, vat_amount as `vat`, total, currency, and from
--          `snapshot`, named fields only: the branch name, the coupon code as
--          priced (`coupon_code`, upper-cased and trimmed, the way an order
--          stores it), the delivery address as it was, the points redeemed,
--          the comp flag and amount, and each line (item, size, unit price,
--          quantity, line total, note, add-ons with their prices).
--          For a checkout that became an order these were copied into that
--          order (`insert_order_from_snapshot`), and `orders` lists them.
--          Repeating them cost about 1 KB per card order and pushed long
--          histories over the app's share limit (see SIZE below).
--     OUT  the session's own coupon_code column: the raw text as the
--          customer typed it (`begin_checkout_session` stores
--          `p_coupon_code` unchanged), spaces and case included. The priced
--          code above is the same code, in the form an order uses.
--     OUT  snapshot itself: internal pricing state (product, size and add-on
--          ids, `coupon_code_raw`, the points projection).
--     OUT  from the address: its row `id` and `customer_id` (the caller's own
--          id). The snapshot stores the whole `addresses` row
--          (`to_jsonb(v_address)` in compute_order_snapshot); the rest of it
--          is the address as it was, so it stays. Note that an ORDER's
--          `delivered_to`, a key that existed before this file, is the same
--          kind of copy and still carries both ids: it is left byte-identical
--          on purpose, and both ids are the caller's own.
--     OUT  idempotency_key: an idempotency key.
--     OUT  loyalty_points: the number the app asked to use. The snapshot's
--          `loyalty_points_redeemed` is the number priced, which is what the
--          loyalty discount is made of, so that one is exported, as orders do.
--     OUT  customer_id (the caller), branch_id and address_id (internal ids;
--          the branch name and the address are exported), updated_at.
--
--   order_refunds (one entry per refund)
--     IN   provider, status, amount, currency, created_at as
--          `requested_at`, completed_at, the order's `order_number`, and
--          charge_ref as `payment_id`: the payment the money went back to.
--     IN   reason, in words, as `reason` (English) and `reason_ar` (Arabic).
--          The stored value is a machine code. Its only writer,
--          `open_order_refund_record`, always writes
--          'pos_delivery_failed_after_customer_retries': point-of-sale retry
--          bookkeeping, which the `about` text says is not included. So that
--          code reads "Your order could not be sent to the branch, so we are
--          returning your payment.", and any other code reads "A refund of
--          your payment.". The code itself is not exported.
--     OUT  provider_ref: for a Moyasar refund it is the same payment id,
--          because Moyasar's refund call answers with the payment
--          (docs/integrations/Moyasar_API_Reference.md §3.2).
--     OUT  idempotency_key, claim_token, attempt_count: the refund worker's
--          idempotency key, lease token and retry count.
--     OUT  failure_code, last_error_safe: why OUR call to Moyasar did not
--          finish. The text can name our own configuration (the proxy
--          setting). `status` says whether the money came back.
--     OUT  id, order_id, payment_record_id, updated_at: internal ids and
--          bookkeeping.
--
-- SIZE. The app shares the copy as text and refuses one over 256 KB
-- (`SHARE_TEXT_LIMIT_BYTES`, apps/mobile/src/features/profile/dataExport.ts),
-- because Android can drop large share text. Each card order now also carries
-- a payment record with its try, about 800 bytes, so a card customer's copy
-- grows. Measured on the local chain on 2026-11-14, with 80 two-line pickup
-- card orders built through begin_checkout_session, begin_session_attempt and
-- finalize_checkout_session (docs/MIGRATIONS.md §66 has the method):
--   before this file, shared indented: about 1 316 bytes a card order, so
--     about 199 orders fit (its payment data was simply missing);
--   this file as first written, shared indented: about 3 634, so about 72;
--   this file, with completed checkouts trimmed and the app sharing compact
--     JSON (same change): about 1 980, so about 132.
-- So a card customer with more than about 132 orders is told to contact us,
-- where before it was about 199. A cash customer gains: compact JSON alone
-- takes a cash order from about 1 316 bytes to about 868, so about 301 fit.
-- The real fix is a file attachment, which needs a native build.
--
-- NO MONEY-PATH CHANGE, and the file asserts it: place_order and
-- compute_order_snapshot must still hash 12b6816d256c29b76edf947ae1a7ea77 and
-- 22e2d42935459e7bf93abb2941b56325 (md5 of pg_get_functiondef). No data
-- changes. No deploy follows: the app calls this function by name with no
-- arguments, so the existing call binds to the new body.
--
-- THE SELF-CHECK WRITES, AND TAKES IT ALL BACK. A `plpgsql` body is not
-- name-resolved when it is created, so a clean apply proves storage, not that
-- the function runs. The check therefore CALLS it, as two throwaway customers
-- whose rows it creates inside a sub-transaction that it then aborts:
-- two `auth.users` rows (the profiles follow by trigger), two checkout
-- sessions and two payment records. It creates no order, because inserting
-- an order advances the order-number sequence, which no rollback returns. The
-- abort is proven afterwards, not assumed. The checks also act as `anon` and
-- as `authenticated`, which applied files already do in Production
-- (20260930120000 as `anon`; 20261008120000 to 20261010120000 as
-- `authenticated`). Writing `auth.users` is new: no applied file has done it.
-- So read `select has_table_privilege('auth.users', 'insert')` as the
-- applying role before applying (docs/OWNER_ACTIONS.md §56). Without that
-- privilege the file refuses to apply and nothing lands.
--
-- Rollback, as a new migration (never an edit of this file): re-apply the
-- function statement of 20260912120000 and its two grant statements. Nothing
-- else changed.
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
            'your_note', i.note,
            -- Add-ons carry their OWN price and are part of `line_total`.
            -- Without them the export shows a line total the customer cannot
            -- reconcile against the item price -- the same defect as omitting
            -- the comp flag: an amount stated with no way to account for it.
            -- Review caught this on #343.
            'add_ons', coalesce((
              select jsonb_agg(jsonb_build_object(
                'name', m.name_en,
                'price', m.price
              ) order by m.created_at)
              from public.order_item_modifiers m where m.order_item_id = i.id
            ), '[]'::jsonb)
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
    ), '[]'::jsonb),

    -- ---- Online payments: gap PG-26, added by 20261014120000 ---------------
    --
    -- Three collections, each keyed on the caller and on nothing else. The
    -- rule for every field is the one this function was built on: the
    -- customer's own amounts, statuses, times, card facts and the references
    -- Moyasar gave the payment are theirs; how our systems handled it (the
    -- payment-page link, our lookup keys, retry and claim bookkeeping, the raw
    -- provider response) is not. The migration header lists each column left
    -- out, with its reason.

    -- Every online checkout the caller started, finished or not. For one that
    -- never became an order, the priced snapshot is the only record of what
    -- they tried to buy, so its lines are read out of it field by field, the
    -- same fields an order's lines give. The snapshot itself is not exported.
    -- A checkout that became one of the caller's orders gives only its
    -- references and times: its lines, totals, address and note were copied
    -- into that order, which `orders` already lists, and repeating them would
    -- shrink the history that fits in one share (see the header).
    'checkouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'checkout_id', s.id,
        'started_at', s.created_at,
        'status', s.status,
        'order_number', so.order_number,
        'completed_at', s.consumed_at,
        'expires_at', s.expires_at,
        'order_type', s.order_type,
        'payment_method', s.payment_method
      ) || case when so.order_number is not null then '{}'::jsonb else jsonb_build_object(
        'branch', s.snapshot ->> 'branch_name_en',
        -- The address as it was, without its row id and the caller's own id.
        'deliver_to', case when jsonb_typeof(s.snapshot -> 'address_snapshot') = 'object'
                           then (s.snapshot -> 'address_snapshot') - 'id' - 'customer_id'
                           else s.snapshot -> 'address_snapshot' end,
        'your_note', s.notes,
        'subtotal', s.subtotal,
        'delivery_fee', s.delivery_fee,
        -- The code as priced, normalised the way an order stores it. The
        -- session's own column holds the raw text as typed, spaces and all.
        'coupon_code', s.snapshot ->> 'coupon_code',
        'coupon_discount', s.discount_amount,
        'loyalty_discount', s.loyalty_discount_amount,
        'points_redeemed', s.snapshot -> 'loyalty_points_redeemed',
        'comped', coalesce(s.snapshot -> 'is_comped', 'false'::jsonb),
        'comp_discount', s.snapshot -> 'comp_discount_amount',
        'vat', s.vat_amount,
        'total', s.total,
        'currency', s.currency,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'item', li.value ->> 'name_en',
            'variant', li.value ->> 'variant_name_en',
            'unit_price', li.value -> 'unit_price',
            'quantity', li.value -> 'quantity',
            'line_total', li.value -> 'line_total',
            'your_note', li.value ->> 'note',
            'add_ons', coalesce((
              select jsonb_agg(jsonb_build_object(
                'name', ad.value ->> 'name_en',
                'price', ad.value -> 'price'
              ) order by ad.ordinality)
              from jsonb_array_elements(
                     case when jsonb_typeof(li.value -> 'modifiers') = 'array'
                          then li.value -> 'modifiers' else '[]'::jsonb end
                   ) with ordinality as ad(value, ordinality)
            ), '[]'::jsonb)
          ) order by li.ordinality)
          from jsonb_array_elements(
                 case when jsonb_typeof(s.snapshot -> 'items') = 'array'
                      then s.snapshot -> 'items' else '[]'::jsonb end
               ) with ordinality as li(value, ordinality)
        ), '[]'::jsonb)
      ) end order by s.created_at, s.id)
      from public.checkout_sessions s
      left join public.orders so on so.id = s.order_id and so.customer_id = v_uid
      where s.customer_id = v_uid
    ), '[]'::jsonb),

    -- Every payment record that belongs to the caller. A record links to an
    -- order, a checkout, or both, and EVERY link it has must point at the
    -- caller, so a record that touches anyone else is never returned. `tries`
    -- reads the card facts out of the stored provider response, one named
    -- field at a time: for a declined try that response is the only place we
    -- keep them. The response itself is never exported.
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', r.provider,
        'status', r.status,
        'mode', r.mode,
        'amount', r.amount,
        'currency', r.currency,
        'order_number', o.order_number,
        'checkout_id', r.checkout_session_id,
        'payment_id', r.provider_ref,
        'invoice_id', r.provider_checkout_ref,
        'card_scheme', r.card_scheme,
        'card_last_four', r.card_last_four,
        'started_at', r.created_at,
        'confirmed_at', r.confirmed_at,
        'failed_at', r.failed_at,
        'expires_at', r.expires_at,
        'note', r.failure_message_safe,
        'tries', coalesce((
          select jsonb_agg(jsonb_build_object(
            'payment_id', t.payment_id,
            'status', t.status,
            'at', t.tried_at,
            'method', t.method,
            'card_scheme', t.card_scheme,
            'card_last_four', t.card_last_four,
            'card_issuer', t.card_issuer,
            'card_issuer_country', t.card_issuer_country,
            'bank_message', t.bank_message,
            'response_code', t.response_code,
            'authorization_code', t.authorization_code,
            'reference_number', t.reference_number
          ) order by t.ord)
          from (
            -- Moyasar. The stored response is ONE payment (it carries
            -- `source`), or an INVOICE listing every payment tried on it
            -- (`payments`). Amounts are left out: Moyasar's are in halalas, and
            -- the record's own `amount`, in riyals, is the figure to read.
            select mp.value ->> 'id' as payment_id,
                   mp.value ->> 'status' as status,
                   mp.value ->> 'created_at' as tried_at,
                   mp.value #>> '{source,type}' as method,
                   mp.value #>> '{source,company}' as card_scheme,
                   mp.value #>> '{source,last_four}' as card_last_four,
                   mp.value #>> '{source,issuer_name}' as card_issuer,
                   mp.value #>> '{source,issuer_country}' as card_issuer_country,
                   mp.value #>> '{source,message}' as bank_message,
                   mp.value #>> '{source,response_code}' as response_code,
                   mp.value #>> '{source,authorization_code}' as authorization_code,
                   mp.value #>> '{source,reference_number}' as reference_number,
                   mp.ord
              from (
                select r.raw as value, 0::bigint as ord
                 where r.provider = 'moyasar'
                   and jsonb_typeof(r.raw -> 'source') = 'object'
                union all
                select e.value, e.ordinality
                  from jsonb_array_elements(
                         case when r.provider = 'moyasar'
                                   and jsonb_typeof(r.raw -> 'payments') = 'array'
                              then r.raw -> 'payments' else '[]'::jsonb end
                       ) with ordinality as e(value, ordinality)
                 where jsonb_typeof(e.value) = 'object'
              ) as mp(value, ord)
            union all
            -- Tap, the retired provider, kept as history: one charge, with
            -- its card in `card` and the answer in `response`.
            select r.raw ->> 'id', r.raw ->> 'status', null,
                   r.raw ->> 'payment_method',
                   coalesce(r.raw #>> '{card,scheme}', r.raw #>> '{card,brand}'),
                   r.raw #>> '{card,last_four}',
                   null, null,
                   r.raw #>> '{response,message}',
                   r.raw #>> '{response,code}',
                   null, null,
                   0::bigint
             where r.provider = 'tap'
               and jsonb_typeof(r.raw -> 'card') = 'object'
          ) as t
        ), '[]'::jsonb)
      ) order by r.created_at, r.id)
      from public.payment_records r
      left join public.orders o on o.id = r.order_id
      left join public.checkout_sessions cs on cs.id = r.checkout_session_id
      -- Found FROM the caller's own orders and checkouts, through their
      -- indexes, so the cost follows this customer's history rather than
      -- every payment ever recorded. Then every link is checked.
      where r.id in (
              select pr.id
                from public.orders mo
                join public.payment_records pr on pr.order_id = mo.id
               where mo.customer_id = v_uid
              union
              select pr.id
                from public.checkout_sessions ms
                join public.payment_records pr on pr.checkout_session_id = ms.id
               where ms.customer_id = v_uid)
        and (r.order_id is null or o.customer_id = v_uid)
        and (r.checkout_session_id is null or cs.customer_id = v_uid)
    ), '[]'::jsonb),

    -- Every refund of one of the caller's orders. `payment_id` is the payment
    -- the money went back to. The refund's own provider reference is that
    -- same payment id for a Moyasar refund (its refund call answers with the
    -- payment), so it is not repeated.
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'order_number', o.order_number,
        'provider', f.provider,
        'status', f.status,
        'amount', f.amount,
        'currency', f.currency,
        -- The reason in words, in both languages. The stored value is our
        -- machine code for how the point-of-sale retries ended, which the
        -- `about` text says is not included.
        'reason', case f.reason
                    when 'pos_delivery_failed_after_customer_retries'
                      then 'Your order could not be sent to the branch, so we are returning your payment.'
                    else 'A refund of your payment.' end,
        'reason_ar', case f.reason
                    when 'pos_delivery_failed_after_customer_retries'
                      then 'تعذّر إرسال طلبك إلى الفرع، لذلك نعيد إليك المبلغ الذي دفعته.'
                    else 'استرداد المبلغ الذي دفعته.' end,
        'payment_id', f.charge_ref,
        'requested_at', f.created_at,
        'completed_at', f.completed_at
      ) order by f.created_at, f.id)
      from public.order_refunds f
      join public.orders o on o.id = f.order_id
      where o.customer_id = v_uid
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

comment on function public.export_my_data() is
  'PDPL access/portability: returns the calling customer''s own personal data as '
  'JSON, their checkouts, payment records and refunds included. Takes no '
  'argument by design -- the subject is always auth.uid(), so it cannot be used '
  'to read another customer. Excludes push tokens, raw provider payloads, '
  'payment-page links, lookup and idempotency keys, and internal operational '
  'state.';

-- ---- Self-verification -------------------------------------------------------
-- Outcomes, read back as values, never notices: the SQL tool that applies this
-- file shows no notices, so a check that only printed would prove nothing.
--
-- Every change of role or caller happens INSIDE a sub-transaction that ends by
-- raising, so the abort itself restores them. Nothing here runs `reset role`,
-- which would fall back to the connection's login role rather than the role
-- that is applying this file.
do $verify$
declare
  v_oid      oid;
  v_n        integer;
  v_txt      text;
  v_state    text;
  v_keys     text[];
  v_branch   uuid;
  v_made     uuid;
  v_out      jsonb;
  v_a        uuid := gen_random_uuid();
  v_b        uuid := gen_random_uuid();
  v_sa       uuid;
  v_sb       uuid;
  v_tag      text := replace(gen_random_uuid()::text, '-', '');
  v_role     text := current_user;
  v_claims   text := coalesce(current_setting('request.jwt.claims', true), '');
  v_sub      text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  c_top      constant text[] := array[
    'about', 'account', 'checkouts', 'generated_at', 'loyalty_history',
    'notification_devices', 'orders', 'payments', 'refunds', 'saved_addresses'];
  c_payment  constant text[] := array[
    'amount', 'card_last_four', 'card_scheme', 'checkout_id', 'confirmed_at',
    'currency', 'expires_at', 'failed_at', 'invoice_id', 'mode', 'note',
    'order_number', 'payment_id', 'provider', 'started_at', 'status', 'tries'];
  c_try      constant text[] := array[
    'at', 'authorization_code', 'bank_message', 'card_issuer',
    'card_issuer_country', 'card_last_four', 'card_scheme', 'method',
    'payment_id', 'reference_number', 'response_code', 'status'];
  c_checkout constant text[] := array[
    'branch', 'checkout_id', 'comp_discount', 'comped', 'completed_at',
    'coupon_code', 'coupon_discount', 'currency', 'deliver_to', 'delivery_fee',
    'expires_at', 'items', 'loyalty_discount', 'order_number', 'order_type',
    'payment_method', 'points_redeemed', 'started_at', 'status', 'subtotal',
    'total', 'vat', 'your_note'];
begin
  -- 1. Cardinality FIRST: every later read takes "the" function, and with two
  -- overloads that read would pick one at random.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'export_my_data';
  if v_n <> 1 then
    raise exception 'export_my_data verification failed: expected exactly 1 overload, found %', v_n;
  end if;
  select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'export_my_data';

  -- 2. The shape that IS the security model.
  if (select p.pronargs from pg_proc p where p.oid = v_oid) is distinct from 0::smallint then
    raise exception 'export_my_data verification failed: it takes arguments, which makes it an enumeration oracle';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = v_oid) is distinct from true then
    raise exception 'export_my_data verification failed: not SECURITY DEFINER';
  end if;
  if (select p.provolatile from pg_proc p where p.oid = v_oid) is distinct from 's' then
    raise exception 'export_my_data verification failed: no longer STABLE';
  end if;
  if not coalesce((select 'search_path=public' = any (p.proconfig) from pg_proc p where p.oid = v_oid), false) then
    raise exception 'export_my_data verification failed: search_path is not pinned to public';
  end if;

  -- 3. The grants, exactly as 20260912120000 left them. A NULL ACL is the
  -- default, which lets PUBLIC execute, so it is refused too.
  if (select p.proacl from pg_proc p where p.oid = v_oid) is null then
    raise exception 'export_my_data verification failed: default ACL, so PUBLIC can execute it';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = v_oid and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception 'export_my_data verification failed: PUBLIC can execute it';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'export_my_data verification failed: anon can execute it';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'export_my_data verification failed: authenticated cannot execute it, so the app cannot';
  end if;
  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'export_my_data verification failed: service_role lost EXECUTE';
  end if;

  -- 4. Carried forward from 20260917120000: the customer export must not grow
  -- a branch reference table.
  select p.prosrc into v_txt from pg_proc p where p.oid = v_oid;
  if v_txt like '%branch_reference%' then
    raise exception 'export_my_data verification failed: it references branch reference data';
  end if;

  -- 5. The money path is untouched. One overload each first, then the hash.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_n <> 1 then
    raise exception 'export_my_data verification failed: expected 1 place_order, found %', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_txt is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'place_order moved to %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_txt, 'NULL');
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_n <> 1 then
    raise exception 'export_my_data verification failed: expected 1 compute_order_snapshot, found %', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;

  -- 6. Refused without a subject, both ways, read back as SQLSTATE and text.
  -- The text is compared too: "permission denied to set role" is also 42501,
  -- and must not pass for the refusal being tested.
  -- 6a. `anon` holds no EXECUTE at all.
  begin
    set local role anon;
    perform public.export_my_data();
    raise exception 'PROBE_RETURNED';
  exception when others then
    v_state := sqlstate || ' ' || sqlerrm;
  end;
  if v_state is distinct from '42501 permission denied for function export_my_data' then
    raise exception 'export_my_data verification failed: anon got %, expected 42501 permission denied', coalesce(v_state, 'NULL');
  end if;
  -- 6b. A signed-in role with no subject: the function's OWN guard must fire,
  -- rather than the body running as owner with a null filter.
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    set local role authenticated;
    perform public.export_my_data();
    raise exception 'PROBE_RETURNED';
  exception when others then
    v_state := sqlstate || ' ' || sqlerrm;
  end;
  if v_state is distinct from '42501 export_my_data requires an authenticated session' then
    raise exception 'export_my_data verification failed: a caller with no subject got %', coalesce(v_state, 'NULL');
  end if;

  -- 7. A fixture customer sees their own rows and only those. Everything here
  -- is written inside a sub-transaction that the last statement aborts, and
  -- the abort is proven after it. No order is created: an order advances the
  -- order-number sequence, which a rollback does not return.
  begin
    select b.id into v_branch from public.branches b order by b.created_at, b.id limit 1;
    if v_branch is null then
      -- An empty database (the CI chain applies migrations before its seed).
      insert into public.branches (name_en, name_ar)
        values ('Export probe ' || v_tag, 'Export probe ' || v_tag)
        returning id into v_branch;
      v_made := v_branch;
    end if;

    insert into auth.users (id) values (v_a), (v_b);

    insert into public.checkout_sessions
      (customer_id, status, order_type, branch_id, snapshot, subtotal, total, notes,
       coupon_code)
    values
      (v_a, 'expired', 'pickup', v_branch,
       jsonb_build_object(
         'branch_name_en', 'Probe branch',
         'coupon_code', 'PROBECOUPON',
         'coupon_code_raw', 'rawcoupon_a' || v_tag,
         -- The whole address row, as compute_order_snapshot stores it.
         'address_snapshot', jsonb_build_object(
           'id', 'addr_a' || v_tag, 'customer_id', v_a, 'label', 'Probe home'),
         'items', jsonb_build_array(jsonb_build_object(
           'product_id', 'prod_a' || v_tag, 'name_en', 'Probe item A',
           'unit_price', 12.5, 'quantity', 2, 'line_total', 25.0,
           'modifiers', jsonb_build_array(jsonb_build_object(
             'modifier_id', 'mod_a' || v_tag, 'name_en', 'Probe add-on', 'price', 0))))),
       25.00, 25.00, 'Probe note A', ' typed_a' || v_tag || ' ')
    returning id into v_sa;
    insert into public.checkout_sessions
      (customer_id, status, order_type, branch_id, snapshot, subtotal, total)
    values
      (v_b, 'expired', 'pickup', v_branch,
       jsonb_build_object('items', '[]'::jsonb), 40.00, 40.00)
    returning id into v_sb;

    -- A's record: the invoice shape, with one declined try, and every column
    -- the export must leave out filled with a value that can be searched for.
    insert into public.payment_records
      (checkout_session_id, provider, status, amount, currency, mode,
       provider_ref, provider_checkout_ref, checkout_url,
       reference_transaction, reference_order, failure_code, raw)
    values
      (v_sa, 'moyasar', 'failed', 25.00, 'SAR', 'live',
       'pay_a' || v_tag, 'inv_a' || v_tag,
       'https://checkout.moyasar.com/invoices/url_a' || v_tag,
       'sm_a' || v_tag, 'CS-a' || v_tag, 'code_a' || v_tag,
       jsonb_build_object(
         'id', 'inv_a' || v_tag, 'status', 'expired', 'amount', 2500,
         'metadata', jsonb_build_object('reference_transaction', 'meta_a' || v_tag),
         'payments', jsonb_build_array(jsonb_build_object(
           'id', 'pay_a' || v_tag, 'status', 'failed', 'fee', 'fee_a' || v_tag,
           'source', jsonb_build_object(
             'type', 'creditcard', 'company', 'visa', 'last_four', '1111',
             'issuer_name', 'Probe Issuer A', 'issuer_country', 'SA',
             'message', 'Declined', 'ip', 'ip_a' || v_tag)))));
    -- B's record: the single-payment shape.
    insert into public.payment_records
      (checkout_session_id, provider, status, amount, currency, mode,
       provider_ref, provider_checkout_ref, raw)
    values
      (v_sb, 'moyasar', 'failed', 40.00, 'SAR', 'live',
       'pay_b' || v_tag, 'inv_b' || v_tag,
       jsonb_build_object(
         'id', 'pay_b' || v_tag, 'status', 'failed',
         'source', jsonb_build_object('company', 'mada', 'last_four', '2222',
                                      'issuer_name', 'Probe Issuer B')));

    -- As A. Everything from here to the raise runs as `authenticated`, which
    -- needs no table access: the assertions read only the returned value.
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_out := public.export_my_data();

    select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_out) k;
    if v_keys is distinct from c_top then
      raise exception 'export_my_data verification failed: top-level keys are %', v_keys;
    end if;
    if jsonb_typeof(v_out -> 'payments') is distinct from 'array'
       or jsonb_array_length(v_out -> 'payments') is distinct from 1
       or v_out #>> '{payments,0,payment_id}' is distinct from 'pay_a' || v_tag
       or v_out #>> '{payments,0,invoice_id}' is distinct from 'inv_a' || v_tag
       or v_out #>> '{payments,0,checkout_id}' is distinct from v_sa::text then
      raise exception 'export_my_data verification failed: the fixture customer did not get exactly their own payment record';
    end if;
    if jsonb_typeof(v_out -> 'checkouts') is distinct from 'array'
       or jsonb_array_length(v_out -> 'checkouts') is distinct from 1
       or v_out #>> '{checkouts,0,checkout_id}' is distinct from v_sa::text
       or v_out #>> '{checkouts,0,items,0,item}' is distinct from 'Probe item A' then
      raise exception 'export_my_data verification failed: the fixture customer did not get exactly their own checkout';
    end if;
    -- The coupon as priced, not as typed; the address without its ids.
    if v_out #>> '{checkouts,0,coupon_code}' is distinct from 'PROBECOUPON'
       or v_out #>> '{checkouts,0,deliver_to,label}' is distinct from 'Probe home'
       or (v_out #> '{checkouts,0,deliver_to}') ? 'id'
       or (v_out #> '{checkouts,0,deliver_to}') ? 'customer_id' then
      raise exception 'export_my_data verification failed: a checkout''s coupon or address reads %',
        coalesce((v_out #> '{checkouts,0}')::text, 'NULL');
    end if;
    if v_out -> 'refunds' is distinct from '[]'::jsonb then
      raise exception 'export_my_data verification failed: refunds is %, expected []', coalesce((v_out -> 'refunds')::text, 'NULL');
    end if;
    -- The issuer exists only inside the stored response, so this proves the
    -- card facts are read out of it.
    if v_out #>> '{payments,0,tries,0,card_issuer}' is distinct from 'Probe Issuer A'
       or v_out #>> '{payments,0,tries,0,card_last_four}' is distinct from '1111' then
      raise exception 'export_my_data verification failed: the card facts of a declined try are missing';
    end if;
    select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_out #> '{payments,0}') k;
    if v_keys is distinct from c_payment then
      raise exception 'export_my_data verification failed: a payment record exports %', v_keys;
    end if;
    select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_out #> '{payments,0,tries,0}') k;
    if v_keys is distinct from c_try then
      raise exception 'export_my_data verification failed: a try exports %', v_keys;
    end if;
    select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_out #> '{checkouts,0}') k;
    if v_keys is distinct from c_checkout then
      raise exception 'export_my_data verification failed: a checkout exports %', v_keys;
    end if;

    v_txt := v_out::text;
    -- Nothing of B's.
    if position(('pay_b' || v_tag) in v_txt) > 0 or position(('inv_b' || v_tag) in v_txt) > 0
       or position('Probe Issuer B' in v_txt) > 0 or position(v_sb::text in v_txt) > 0 then
      raise exception 'export_my_data verification failed: another customer''s payment data reached the export';
    end if;
    -- None of the values the export must leave out.
    if position(('url_a' || v_tag) in v_txt) > 0 then
      raise exception 'export_my_data verification failed: the payment-page link was exported';
    end if;
    if position(('sm_a' || v_tag) in v_txt) > 0 or position(('meta_a' || v_tag) in v_txt) > 0
       or position(('CS-a' || v_tag) in v_txt) > 0 then
      raise exception 'export_my_data verification failed: an internal lookup reference was exported';
    end if;
    if position(('fee_a' || v_tag) in v_txt) > 0 or position(('ip_a' || v_tag) in v_txt) > 0
       or position(('code_a' || v_tag) in v_txt) > 0 then
      raise exception 'export_my_data verification failed: the raw provider payload, or our failure code, was exported';
    end if;
    if position(('prod_a' || v_tag) in v_txt) > 0 or position(('mod_a' || v_tag) in v_txt) > 0
       or position(('rawcoupon_a' || v_tag) in v_txt) > 0
       or position(('typed_a' || v_tag) in v_txt) > 0
       or position(('addr_a' || v_tag) in v_txt) > 0 then
      raise exception 'export_my_data verification failed: internal snapshot state was exported';
    end if;

    -- As B: B's own record, none of A's.
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', v_b, 'role', 'authenticated')::text, true);
    v_out := public.export_my_data();
    v_txt := v_out::text;
    if jsonb_array_length(v_out -> 'payments') is distinct from 1
       or v_out #>> '{payments,0,payment_id}' is distinct from 'pay_b' || v_tag
       or v_out #>> '{payments,0,tries,0,card_issuer}' is distinct from 'Probe Issuer B'
       or jsonb_array_length(v_out -> 'checkouts') is distinct from 1
       or position(('pay_a' || v_tag) in v_txt) > 0
       or position('Probe Issuer A' in v_txt) > 0
       or position(v_sa::text in v_txt) > 0 then
      raise exception 'export_my_data verification failed: the second fixture customer did not get exactly their own rows';
    end if;

    raise exception 'ROLLBACK_PROBE';
  exception when others then
    if sqlerrm is distinct from 'ROLLBACK_PROBE' then
      raise;
    end if;
  end;

  -- 8. The abort is proven, not assumed: no probe row, and the role and the
  -- caller identity are what they were before the checks.
  if exists (select 1 from auth.users where id in (v_a, v_b))
     or exists (select 1 from public.profiles where id in (v_a, v_b))
     or exists (select 1 from public.checkout_sessions where customer_id in (v_a, v_b))
     or exists (select 1 from public.payment_records
                 where provider_ref in ('pay_a' || v_tag, 'pay_b' || v_tag))
     or (v_made is not null and exists (select 1 from public.branches where id = v_made)) then
    raise exception 'export_my_data verification failed: a probe row survived the sub-transaction';
  end if;
  if current_user is distinct from v_role
     or coalesce(current_setting('request.jwt.claims', true), '') is distinct from v_claims
     or coalesce(current_setting('request.jwt.claim.sub', true), '') is distinct from v_sub then
    raise exception 'export_my_data verification failed: the checks left a different role or caller behind';
  end if;
end
$verify$;
