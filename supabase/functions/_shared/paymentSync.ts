/**
 * Post-payment Lazywait handoff, called from moyasarVerify.ts once a Moyasar
 * payment is confirmed — by the webhook, the customer's verify or the admin
 * re-verify alike. Runs ONLY after confirm_order_payment (or
 * finalize_checkout_session) has marked the order paid server-side.
 * Both helpers are best-effort and never throw — a POS hiccup must never undo a
 * confirmed payment; the background sync worker + reaper reconcile the tail.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { internalFunctionUrl } from './functionRegion.ts';
import { publishableKey } from './apiKeys.ts';
import { getProviderConfig } from './secrets.ts';
import { DEFAULT_BASE_URL, lazywaitFetch, round2, type LazywaitConfig } from './lazywait.ts';

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

/**
 * The payment-method label the POS shows for an app card payment (owner,
 * 2026-11-19: "send it to Lazywait as Online Credit Card"). Lazywait's own
 * documentation for update-online-payment puts this label in `names`, and both
 * strings are the ones its example uses.
 */
export const ONLINE_PAYMENT_NAMES = { en: 'ONLINE CREDIT CARD', ar: 'بطاقة ائتمانية' } as const;

/**
 * update-online-payment was written for a card terminal in the branch, and
 * Lazywait requires its three terminal ids (`tid`, `pos_terminal_id`,
 * `nearpay_terminal_id`) on every call, "a missing one returns 400 Missing
 * required fields" (its documentation, read 2026-11-19). An app payment taken
 * by Moyasar has no terminal, so all three carry this fixed value, which says
 * where the payment really came from.
 */
export const APP_PAYMENT_TERMINAL = 'MOYASAR-APP';

/**
 * The card scheme as the POS expects it (`Card_Type`, "Card scheme", e.g.
 * VISA). Moyasar reports it in lower case (`mada`, `visa`, `master`), stored on
 * the paid payment record. Required, so an unknown or odd value sends CARD.
 */
export function posCardType(scheme: unknown): string {
  const s = typeof scheme === 'string' ? scheme.trim().toUpperCase() : '';
  return /^[A-Z][A-Z0-9_]{1,19}$/.test(s) ? s : 'CARD';
}

/**
 * The card number as the POS may see it: four asterisks and the last four
 * digits, the shape Lazywait's own example uses ("****1234"), so it carries
 * nothing beyond what a paper receipt prints. Required, so anything that is
 * not exactly four digits sends the asterisks alone.
 */
export function maskedCardNumber(lastFour: unknown): string {
  const s = typeof lastFour === 'string' ? lastFour.trim() : '';
  return /^\d{4}$/.test(s) ? `****${s}` : '****';
}

/**
 * The sync-log error for a refused payment push: the HTTP status, plus
 * Lazywait's own code and message, so a refusal can be diagnosed from our logs
 * (until 2026-11-19 only the status was kept, and nine 400s said nothing).
 * Bounded to 240 characters, and any run of 12+ digits is masked, in case a
 * provider message ever echoes a card or phone number. Null on success.
 */
export function paymentPushError(res: {
  ok: boolean;
  status: number;
  code?: string | null;
  error?: string | null;
  text?: string | null;
}): string | null {
  if (res.ok) return null;
  const parts = [`payment_push_${res.status}`];
  if (res.code) parts.push(String(res.code));
  // lazywaitFetch falls back to a bare "HTTP <status>" when the reply has no
  // `message` field, which is exactly what Lazywait's 400 does (2026-11-19).
  // The reply body then is the only place the reason lives, so log it.
  const generic = !res.error || /^HTTP \d{3}$/.test(String(res.error));
  if (!generic) parts.push(String(res.error));
  else if (res.text) parts.push(String(res.text).replace(/\s+/g, ' ').trim());
  return parts.join(' ').replace(/\d{12,}/g, '[digits]').slice(0, 240);
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

  // Every field Lazywait's documentation marks required is sent (read
  // 2026-11-19; a missing one returns 400 "Missing required fields"):
  //   - transaction_uuid: Moyasar's payment id, already sent as Approval_No;
  //   - Card_Number: the card's LAST FOUR digits only, masked. The full number
  //     never reaches our servers; the last four are stored on the paid
  //     payment record when Moyasar confirms the payment;
  //   - Card_Type: the card scheme from that same record (MADA, VISA, ...);
  //   - tid / pos_terminal_id / nearpay_terminal_id: there is no terminal, so
  //     a fixed value naming the app (APP_PAYMENT_TERMINAL).
  // The owner approved the card fields on 2026-11-19.
  const { data: paidRecord } = await admin
    .from('payment_records').select('card_last_four, card_scheme')
    .eq('order_id', order.id).eq('status', 'paid')
    .order('confirmed_at', { ascending: false }).limit(1).maybeSingle();
  const paid = paidRecord as { card_last_four?: unknown; card_scheme?: unknown } | null;
  const cardNumber = maskedCardNumber(paid?.card_last_four);
  const cardType = posCardType(paid?.card_scheme);

  const res = await lazywaitFetch(lw, {
    method: 'POST',
    path: '/pos/orders/update-online-payment',
    body: {
      client_id: lw.clientId,
      branch_id: branchId,
      order_ref: lazywaitRef,
      Trans_Amount: round2(Number(order.total ?? 0)), // server-trusted paid amount
      tid: APP_PAYMENT_TERMINAL,
      pos_terminal_id: APP_PAYMENT_TERMINAL,
      nearpay_terminal_id: APP_PAYMENT_TERMINAL,
      Approval_No: approvalNo,
      Card_Number: cardNumber,
      Card_Type: cardType,
      transaction_uuid: approvalNo,
      status: 'approved',
      names: ONLINE_PAYMENT_NAMES,
    },
    timeoutMs: 12000,
  });

  await admin.from('integration_sync_logs').insert({
    provider: 'lazywait',
    order_id: order.id ? String(order.id) : null,
    direction: 'push',
    status: res.ok ? 'success' : 'failed',
    request: { endpoint: 'update-online-payment', order_ref: lazywaitRef },
    error: paymentPushError(res),
  }).then(() => {}, () => {});
}
