/**
 * Post-payment Lazywait handoff, called from moyasarVerify.ts once a Moyasar
 * payment is confirmed — by the webhook, the customer's verify or the admin
 * re-verify alike. Runs ONLY after confirm_order_payment (or
 * finalize_checkout_session) has marked the order paid server-side.
 * Best-effort and never throws — a POS hiccup must never undo a confirmed
 * payment; the background sync worker + reaper reconcile the tail.
 *
 * It only KICKS the sync: the payment reaches the POS on the ticket itself
 * (`order_payments`, posPaidFlag.ts). The separate update-online-payment call
 * that lived here was removed on 2026-11-19 (owner: "remove it"): Lazywait
 * accepted it and recorded nothing.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { internalFunctionUrl } from './functionRegion.ts';
import { publishableKey } from './apiKeys.ts';
import { getProviderConfig } from './secrets.ts';

/**
 * Kick the existing lazywait-sync worker once (server-to-server, bounded) so a
 * just-paid online pickup order — which confirm_order_payment moved from
 * 'awaiting_payment' to 'pending' — is created in the POS promptly. The
 * sync_trigger_secret is read server-side and sent as x-sync-secret; it never
 * leaves Postgres/the function.
 *
 * `apikey` is the publishable key from `publishableKey()`, exactly as
 * order-intake's kick sends it: lazywait-sync authorizes on x-sync-secret, and
 * the key only identifies the project. Until 2026-11-18 this read
 * `SUPABASE_ANON_KEY` directly, which the gateway refuses once the legacy keys
 * are deactivated (docs/SUPABASE_API_KEYS.md §5). Without a publishable key the
 * kick is skipped: it is best-effort, and the once-a-minute cron picks the paid
 * order up.
 */
/**
 * Run work AFTER the response, where the platform allows it.
 *
 * Why (measured 2026-11-18, order SM-2026-000099): the order existed at
 * 13:23:20.5, yet payment-verify answered the app only at 13:23:35.6, because
 * it waited for the POS kick and the online-payment attach first. The customer
 * looked at a spinner for those 15 s although nothing they see depends on the
 * POS: the receipt shows "sending to the branch" until the POS answers.
 *
 * `EdgeRuntime.waitUntil` keeps the isolate alive past the Response; the
 * guarded shape is the one lazywait-sync and account-delete-request use. On a
 * platform without it, or in a local run or test, this degrades to awaiting,
 * never to skipping. The work must catch its own errors.
 */
export async function runAfterResponse(work: () => Promise<void>): Promise<void> {
  const p = work();
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(x: Promise<unknown>): void } }).EdgeRuntime;
  if (rt?.waitUntil) {
    try { rt.waitUntil(p); return; } catch { /* fall through to await */ }
  }
  await p;
}

export async function triggerLazywaitSyncOnce(admin: SupabaseClient): Promise<void> {
  try {
    const cfg = await getProviderConfig(admin, 'lazywait');
    const secret = String((cfg?.secretConfig as Record<string, unknown>)?.sync_trigger_secret ?? '');
    const url = Deno.env.get('SUPABASE_URL');
    const apikey = publishableKey()?.value;
    if (cfg?.enabled && secret && url && apikey) {
      await fetch(internalFunctionUrl(url, 'lazywait-sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey, 'x-sync-secret': secret },
        body: JSON.stringify({ limit: 5 }),
        signal: AbortSignal.timeout(11_000),
      });
    }
  } catch { /* background worker retries — never fail the payment on a POS hiccup */ }
}
