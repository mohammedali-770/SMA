/**
 * Post-payment Lazywait handoff, shared by the Tap webhook + verify paths.
 * Runs ONLY after confirm_order_payment has marked the order paid server-side.
 * Both helpers are best-effort and never throw — a POS hiccup must never undo a
 * confirmed payment; the background sync worker + reaper reconcile the tail.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getProviderConfig } from './secrets.ts';
import { DEFAULT_BASE_URL, lazywaitFetch, round2, type LazywaitConfig } from './lazywait.ts';

/**
 * Kick the existing lazywait-sync worker once (server-to-server, bounded) so a
 * just-paid online pickup order — which confirm_order_payment moved from
 * 'awaiting_payment' to 'pending' — is created in the POS promptly. The
 * sync_trigger_secret is read server-side and sent as x-sync-secret; it never
 * leaves Postgres/the function.
 */
export async function triggerLazywaitSyncOnce(admin: SupabaseClient): Promise<void> {
  try {
    const cfg = await getProviderConfig(admin, 'lazywait');
    const secret = String((cfg?.secretConfig as Record<string, unknown>)?.sync_trigger_secret ?? '');
    const url = Deno.env.get('SUPABASE_URL');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    if (cfg?.enabled && secret && url && anon) {
      await fetch(`${url}/functions/v1/lazywait-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anon, 'x-sync-secret': secret },
        body: JSON.stringify({ limit: 5 }),
        signal: AbortSignal.timeout(11_000),
      });
    }
  } catch { /* background worker retries — never fail the payment on a POS hiccup */ }
}

/**
 * POST /pos/orders/update-online-payment with the SERVER-TRUSTED paid total, once
 * the order has a lazywait_ref (i.e. it's been created in the POS). Logged + safe.
 */
export async function pushLazywaitOnlinePayment(
  admin: SupabaseClient, order: Record<string, unknown> | null, approvalNo: string,
): Promise<void> {
  if (!order) return;
  const lazywaitRef = order.lazywait_ref ? String(order.lazywait_ref) : '';
  if (!lazywaitRef) return; // not synced to POS yet — the online-payment attach happens on a later reconcile

  const cfg = await getProviderConfig(admin, 'lazywait');
  if (!cfg || !cfg.enabled) return;
  const lw: LazywaitConfig = {
    baseUrl: String((cfg.publicConfig as Record<string, unknown>).base_url ?? DEFAULT_BASE_URL),
    clientId: String((cfg.publicConfig as Record<string, unknown>).client_id ?? ''),
    apiToken: String((cfg.secretConfig as Record<string, unknown>).api_token ?? ''),
  };
  if (!lw.clientId || !lw.apiToken) return;

  const { data: branch } = await admin
    .from('branches').select('lazywait_branch_id').eq('id', order.branch_id).maybeSingle();
  const branchId = (branch as { lazywait_branch_id?: string } | null)?.lazywait_branch_id;
  if (!branchId) return;

  const res = await lazywaitFetch(lw, {
    method: 'POST',
    path: '/pos/orders/update-online-payment',
    body: {
      client_id: lw.clientId,
      branch_id: branchId,
      order_ref: lazywaitRef,
      Trans_Amount: round2(Number(order.total ?? 0)), // server-trusted paid amount
      Approval_No: approvalNo,
      Card_Type: 'card',
    },
    timeoutMs: 12000,
  });

  await admin.from('integration_sync_logs').insert({
    provider: 'lazywait',
    order_id: order.id ? String(order.id) : null,
    direction: 'push',
    status: res.ok ? 'success' : 'failed',
    request: { endpoint: 'update-online-payment', order_ref: lazywaitRef },
    error: res.ok ? null : `payment_push_${res.status}`,
  }).then(() => {}, () => {});
}
