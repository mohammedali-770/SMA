/**
 * What the console's payment calls send and read.
 *
 * The console deploys on merge, but the payment Edge Functions stay on whatever
 * bundle was last deployed until a separate deploy. So these calls have to work
 * against two versions of `payment-test-config` at once: the Moyasar-only one in
 * this repository and the older bundle still in Production.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { paymentGateway } from './api';
import { supabase } from './supabase';

vi.mock('./supabase', () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

describe('paymentGateway.testCheckoutResult', () => {
  it('sends the invoice id under both names', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { ok: true }, error: null } as never);
    await paymentGateway.testCheckoutResult('inv_123');
    // invoiceId is the Moyasar function's name for it; the older bundle reads
    // only chargeId, so dropping the alias would break the lookup until deploy.
    expect(supabase.functions.invoke).toHaveBeenCalledWith('payment-test-config', {
      body: { action: 'test_checkout_result', invoiceId: 'inv_123', chargeId: 'inv_123' },
    });
  });
});

/**
 * Moyasar sends a webhook-verification code once, when a webhook is registered,
 * and payment-webhook records it in integration_sync_logs (staff-read RLS) with
 * `request.type = 'webhook_verification'` and `response.verification_code`.
 * The console reads only the newest such row, and only the two values it shows.
 */
describe('paymentGateway.latestWebhookVerification', () => {
  function wire(result: { data: unknown; error: { message: string } | null }) {
    const calls: { method: string; args: unknown[] }[] = [];
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    for (const method of ['select', 'eq', 'order']) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return chain;
      };
    }
    chain.limit = (...args: unknown[]) => {
      calls.push({ method: 'limit', args });
      return Promise.resolve(result);
    };
    vi.mocked(supabase.from).mockReturnValue(chain as never);
    return calls;
  }

  it('reads the newest Moyasar verification row, and only its time and code', async () => {
    const calls = wire({
      data: [{ created_at: '2026-11-11T12:00:00Z', verification_code: '482913' }],
      error: null,
    });
    const row = await paymentGateway.latestWebhookVerification();

    expect(supabase.from).toHaveBeenCalledWith('integration_sync_logs');
    expect(calls).toEqual([
      { method: 'select', args: ['created_at, verification_code:response->>verification_code'] },
      { method: 'eq', args: ['provider', 'moyasar'] },
      { method: 'eq', args: ['request->>type', 'webhook_verification'] },
      { method: 'order', args: ['created_at', { ascending: false }] },
      { method: 'limit', args: [1] },
    ]);
    expect(row).toEqual({ created_at: '2026-11-11T12:00:00Z', verification_code: '482913' });
  });

  it('returns null when no code has arrived', async () => {
    wire({ data: [], error: null });
    expect(await paymentGateway.latestWebhookVerification()).toBeNull();
  });

  it('surfaces a failed read as an error, for the caller to decide', async () => {
    wire({ data: null, error: { message: 'permission denied' } });
    await expect(paymentGateway.latestWebhookVerification()).rejects.toThrow('permission denied');
  });
});

/**
 * The receipt's payment read selects the safe columns and nothing else.
 *
 * `provider_checkout_ref` (the Moyasar invoice id) is created by
 * 20260824100000, which is not applied in Production. Selecting a column that
 * does not exist makes PostgREST refuse the whole read, and the receipt swallows
 * that error, so payment details would vanish from every online order. `raw`
 * holds the provider payload, which the console never needs.
 */
describe('paymentGateway.record', () => {
  it('selects only the safe payment_records columns', async () => {
    const select = vi.fn();
    const chain = {
      select: (cols: string) => {
        select(cols);
        return chain;
      },
      eq: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: [], error: null }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain as never);

    await paymentGateway.record('o1');

    expect(supabase.from).toHaveBeenCalledWith('payment_records');
    const cols = String(select.mock.calls[0][0])
      .split(',')
      .map((c) => c.trim());
    expect(cols).toEqual([
      'id',
      'order_id',
      'provider',
      'provider_ref',
      'status',
      'amount',
      'currency',
      'mode',
      'card_scheme',
      'card_last_four',
      'failure_code',
      'failure_message_safe',
      'confirmed_at',
      'last_verified_at',
      'created_at',
    ]);
  });
});
