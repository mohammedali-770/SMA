import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';

/**
 * order-intake — authenticated "create order + sync to POS" orchestration.
 *
 * 1) Calls place_order AS THE USER, so auth.uid(), RLS, totals, coupon, VAT and
 *    loyalty stay the single source of truth (nothing about pricing changes).
 * 2) Best-effort SYNCHRONOUS Lazywait sync so the receipt can show the POS order
 *    number (e.g. "#5") immediately: it invokes the existing `lazywait-sync`
 *    worker (which owns the confirmed Create Order payload + claim-lock + retry
 *    logic) server-to-server and waits for it, bounded by an ~11s timeout. On a
 *    slow/down POS it returns the order WITHOUT a POS number — the order still
 *    stands and the background worker finishes it, so the app falls back to the
 *    SM-… number. A POS problem can NEVER fail the order or block checkout past
 *    the timeout.
 *
 * The Lazywait payload/logic live only in the worker (unchanged), and the
 * `sync_trigger_secret` is read server-side and sent as the x-sync-secret header
 * — it never reaches the app or the response.
 */
const SYNC_TIMEOUT_MS = 11_000;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Authentication required' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const supa = userClient(auth);
  const { data: placed, error } = await supa.rpc('place_order', {
    p_branch_id: body.branchId,
    p_order_type: body.orderType,
    p_items: body.items,
    p_address_id: body.addressId ?? null,
    p_coupon_code: body.couponCode ?? null,
    p_notes: body.notes ?? null,
    p_loyalty_points: body.loyaltyPoints ?? 0,
    p_idempotency_key: body.idempotencyKey ?? null,
    p_payment_method: body.paymentMethod ?? null,
  });
  if (error) return json({ error: error.message }, 400);

  const order = placed as Record<string, unknown> | null;
  const orderId = order?.id ? String(order.id) : null;
  if (!orderId) return json({ order: placed });

  // Best-effort synchronous POS sync for pickup orders (delivery is 'blocked' at
  // insert). Fully guarded — a POS/network problem never fails the order.
  if (String(order?.order_type) === 'pickup') {
    try {
      const admin = adminClient();
      const cfg = await getProviderConfig(admin, 'lazywait');
      const secret = String((cfg?.secretConfig as Record<string, unknown>)?.sync_trigger_secret ?? '');
      const url = Deno.env.get('SUPABASE_URL');
      const anon = Deno.env.get('SUPABASE_ANON_KEY');
      if (cfg?.enabled && secret && url && anon) {
        await fetch(`${url}/functions/v1/lazywait-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: anon, 'x-sync-secret': secret },
          body: JSON.stringify({ limit: 5 }),
          signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
        });
      }
    } catch { /* never block/fail the order on a POS hiccup — background retry covers it */ }
  }

  // Best-effort "order received" push (cash/order-first path — the order now
  // exists with status 'received'). push-dispatch is master-flag gated and
  // idempotent per (order,status); a push failure never affects the order.
  // The task is REGISTERED with the Edge Runtime (waitUntil) so returning the
  // response cannot kill it mid-flight; when waitUntil is unavailable the
  // call is awaited, bounded by its 4s timeout.
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (url && serviceKey) {
      const pushPromise = fetch(`${url}/functions/v1/push-dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ action: 'order_status', orderId, status: 'received' }),
        signal: AbortSignal.timeout(4000),
      }).then(() => undefined, () => undefined); // never throws
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(pushPromise);
      else await pushPromise;
    }
  } catch { /* notification is best-effort only */ }

  // Return the fresh RLS-scoped order row so the client sees the POS number if it
  // arrived in time; otherwise it carries the SM-… number and syncs in the tail.
  const { data: fresh } = await supa.from('orders').select('*').eq('id', orderId).maybeSingle();
  return json({ order: fresh ?? placed });
});
