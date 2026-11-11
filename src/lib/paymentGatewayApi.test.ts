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
