import { corsHeaders, json } from '../_shared/cors.ts';
import { userClient } from '../_shared/supabaseClient.ts';

/**
 * order-intake — thin, authenticated wrapper over the place_order RPC.
 *
 * The mobile app may keep calling place_order directly (it is RLS-protected and
 * server-authoritative). This function exists as the future orchestration point
 * where "create order + start payment" happen atomically server-side. It calls
 * place_order AS THE USER so auth.uid(), RLS, totals, coupon, VAT and loyalty
 * all stay exactly as the single source of truth. It never marks an order paid.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Authentication required' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const supa = userClient(auth);
  const { data, error } = await supa.rpc('place_order', {
    p_branch_id: body.branchId,
    p_order_type: body.orderType,
    p_items: body.items,
    p_address_id: body.addressId ?? null,
    p_coupon_code: body.couponCode ?? null,
    p_notes: body.notes ?? null,
    p_loyalty_points: body.loyaltyPoints ?? 0,
    p_idempotency_key: body.idempotencyKey ?? null,
  });
  if (error) return json({ error: error.message }, 400);

  // TODO(payment): when online payment is enabled, create a payment intent here
  // with the gateway (secret read via _shared/secrets.ts) and return its client
  // token alongside the order. Until then the order stays payment_status='pending'
  // and is only marked paid by the verified payment-webhook.
  return json({ order: data });
});
