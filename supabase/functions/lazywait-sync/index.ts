import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import {
  buildCreateOrderPayload, classifyLazywaitError, computeBackoffMs, DEFAULT_BASE_URL,
  lazywaitFetch, MAX_SYNC_ATTEMPTS, normalizePhone, type LazywaitConfig,
} from '../_shared/lazywait.ts';

/**
 * lazywait-sync — server-side POS sync worker (invoked by a schedule/cron, NOT
 * by the app). Claims due orders (FOR UPDATE SKIP LOCKED), pushes each to the
 * confirmed Lazywait Create Order endpoint, and records the outcome via the
 * service-role-only record_lazywait_sync RPC.
 *
 * Source of truth stays Supabase/place_order. A Lazywait failure NEVER affects
 * the local order — it is retried with backoff, blocked (config/mapping), or
 * dead-lettered. Only PICKUP orders are synced (delivery Create Order schema is
 * unconfirmed and is blocked at insert).
 *
 * verify_jwt = false (config.toml): server/scheduled caller. Optionally gated by
 * a shared secret in secret_config.sync_trigger_secret (header x-sync-secret).
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'lazywait');
  if (!cfg || !cfg.enabled) return json({ status: 'disabled', reason: 'lazywait not enabled' }, 200);

  // Optional shared-secret gate for the scheduled trigger.
  const triggerSecret = String((cfg.secretConfig as Record<string, unknown>).sync_trigger_secret ?? '');
  if (triggerSecret && req.headers.get('x-sync-secret') !== triggerSecret) {
    return json({ error: 'unauthorized' }, 401);
  }

  const lw: LazywaitConfig = {
    baseUrl: String((cfg.publicConfig as Record<string, unknown>).base_url ?? DEFAULT_BASE_URL),
    clientId: String((cfg.publicConfig as Record<string, unknown>).client_id ?? ''),
    apiToken: String((cfg.secretConfig as Record<string, unknown>).api_token ?? ''),
  };
  if (!lw.clientId || !lw.apiToken) {
    return json({ error: 'lazywait config missing client_id or api_token' }, 500);
  }

  let limit = 5;
  try { const b = await req.json(); if (b && typeof b.limit === 'number') limit = b.limit; } catch { /* no body */ }

  // Claim a batch (flips them to 'syncing').
  const { data: claimed, error: claimErr } =
    await admin.rpc('claim_lazywait_sync_batch', { p_limit: limit });
  if (claimErr) return json({ error: claimErr.message }, 500);
  const orders = (claimed ?? []) as Array<Record<string, unknown>>;

  const summary = { claimed: orders.length, synced: 0, failed: 0, blocked: 0, dead_letter: 0 };

  for (const order of orders) {
    const orderId = String(order.id);
    try {
      // ---- Load branch mapping + items (server-trusted) --------------------
      const { data: branch } = await admin
        .from('branches').select('lazywait_branch_id').eq('id', order.branch_id).maybeSingle();
      const { data: items } = await admin
        .from('order_items')
        .select('name_en, quantity, unit_price, product_id, products(lazywait_item_id)')
        .eq('order_id', orderId);

      const mappedItems = (items ?? []).map((it: Record<string, unknown>) => ({
        menuItemId: (it.products as { lazywait_item_id?: string } | null)?.lazywait_item_id ?? null,
        name: String(it.name_en ?? 'Item'),
        quantity: Number(it.quantity ?? 1),
        unitPrice: Number(it.unit_price ?? 0),
      }));

      // ---- Optional CRM match by phone (best-effort, never blocks) ---------
      const phone = normalizePhone(order.customer_phone as string | null);
      if (phone && order.customer_id) {
        try {
          const crm = await lazywaitFetch<Array<{ id?: string }>>(lw, {
            method: 'GET', path: '/crm/customers/search', query: { query: phone }, timeoutMs: 8000,
          });
          const match = Array.isArray(crm.data) ? crm.data[0] : null;
          if (crm.ok && match?.id) {
            await admin.from('profiles').update({ lazywait_customer_id: match.id }).eq('id', order.customer_id);
          }
        } catch { /* CRM match is optional; ignore */ }
      }

      // ---- Build the confirmed Create Order payload ------------------------
      const built = buildCreateOrderPayload({
        clientId: lw.clientId,
        branchId: (branch as { lazywait_branch_id?: string } | null)?.lazywait_branch_id ?? null,
        orderType: String(order.order_type),
        customerName: String(order.customer_name ?? 'Guest'),
        items: mappedItems,
      });

      if (!built.ok) {
        summary.blocked++;
        await admin.rpc('record_lazywait_sync', {
          p_order_id: orderId,
          p_patch: { lazywait_sync_state: 'blocked', sync_blocked_reason: built.blockedReason, sync_last_error: built.blockedReason },
          p_log_status: 'skipped',
          p_error: built.blockedReason,
        });
        continue;
      }

      // ---- POST /pos/orders/create -----------------------------------------
      const res = await lazywaitFetch<{ success?: boolean; order?: Record<string, unknown> }>(lw, {
        method: 'POST', path: '/pos/orders/create', body: built.payload, timeoutMs: 15000,
      });

      const lwOrder = (res.data?.order ?? {}) as Record<string, unknown>;
      const trimmedResponse = {
        success: res.data?.success ?? res.ok,
        order_ref: lwOrder.order_ref ?? null,
        order_id: lwOrder.order_id ?? null,
        order_number: lwOrder.order_number ?? null,
        order_status_id: lwOrder.order_status_id ?? null,
      };

      if (res.ok && res.data?.success && lwOrder.order_ref) {
        summary.synced++;
        await admin.rpc('record_lazywait_sync', {
          p_order_id: orderId,
          p_patch: {
            lazywait_sync_state: 'synced',
            lazywait_ref: String(lwOrder.order_ref),
            lazywait_order_id: lwOrder.order_id != null ? String(lwOrder.order_id) : null,
            lazywait_order_number: lwOrder.order_number != null ? String(lwOrder.order_number) : null,
            lazywait_status: lwOrder.order_status_id != null ? String(lwOrder.order_status_id) : null,
            sync_last_error: null,
            synced_at: new Date().toISOString(),
          },
          p_log_status: 'success',
          p_request: { order_items_count: mappedItems.length, branch_id: built.payload.branch_id },
          p_response: trimmedResponse,
        });
        continue;
      }

      // ---- Failure classification ------------------------------------------
      const cls = classifyLazywaitError(res.status, res.code);
      const attempt = Number(order.sync_attempt_count ?? 0) + 1;
      if (cls.kind === 'terminal') {
        summary.blocked++;
        await admin.rpc('record_lazywait_sync', {
          p_order_id: orderId,
          p_patch: { lazywait_sync_state: 'blocked', sync_blocked_reason: cls.reason,
            sync_attempt_count: attempt, sync_last_error: safeErr(res.error) },
          p_log_status: 'failed',
          p_error: cls.reason,
        });
      } else {
        const dead = attempt >= MAX_SYNC_ATTEMPTS;
        if (dead) summary.dead_letter++; else summary.failed++;
        const nextMs = res.retryAfterMs ?? computeBackoffMs(attempt);
        await admin.rpc('record_lazywait_sync', {
          p_order_id: orderId,
          p_patch: {
            lazywait_sync_state: dead ? 'dead_letter' : 'failed',
            sync_attempt_count: attempt,
            sync_next_attempt_at: dead ? null : new Date(Date.now() + nextMs).toISOString(),
            sync_last_error: safeErr(res.error),
          },
          p_log_status: 'failed',
          p_error: `${cls.reason}: ${safeErr(res.error)}`,
        });
      }
    } catch (e) {
      // Unexpected error — treat as retryable so the order isn't lost.
      summary.failed++;
      const attempt = Number(order.sync_attempt_count ?? 0) + 1;
      await admin.rpc('record_lazywait_sync', {
        p_order_id: orderId,
        p_patch: {
          lazywait_sync_state: attempt >= MAX_SYNC_ATTEMPTS ? 'dead_letter' : 'failed',
          sync_attempt_count: attempt,
          sync_next_attempt_at: attempt >= MAX_SYNC_ATTEMPTS ? null : new Date(Date.now() + computeBackoffMs(attempt)).toISOString(),
          sync_last_error: safeErr(e instanceof Error ? e.message : String(e)),
        },
        p_log_status: 'failed',
        p_error: 'worker_exception',
      }).then(() => {}, () => {});
    }
  }

  return json({ status: 'ok', ...summary }, 200);
});

/** Truncate + strip anything token-shaped from an error string before storing. */
function safeErr(msg: string | null | undefined): string {
  if (!msg) return 'unknown';
  return msg.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***').slice(0, 500);
}
