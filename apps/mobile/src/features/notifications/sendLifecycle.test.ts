import { describe, expect, it } from 'vitest';

import { claim, complete, MAX_SEND_ATTEMPTS, type SendRecord } from './sendLifecycle';

const KEY = 'order-1|preparing';

describe('order-status send lifecycle (claim / retry semantics)', () => {
  it('concurrent duplicate call: second caller backs off while the first is processing', () => {
    const first = claim([], KEY);
    expect(first.action).toBe('proceed');
    const registry = first.action === 'proceed' ? first.registry : [];
    // A concurrent call arrives BEFORE the first completes:
    expect(claim(registry, KEY).action).toBe('in_progress'); // never double-sends
  });

  it('successful send is terminal — never repeated', () => {
    let registry: SendRecord[] = (claim([], KEY) as { registry: SendRecord[] }).registry;
    registry = complete(registry, KEY, { targeted: 2, sent: 2, failed: 0 });
    expect(registry[0].sendStatus).toBe('sent');
    expect(claim(registry, KEY).action).toBe('duplicate'); // idempotent
  });

  it('TOTAL transient failure can be retried, attempt_count increments', () => {
    let registry: SendRecord[] = (claim([], KEY) as { registry: SendRecord[] }).registry;
    registry = complete(registry, KEY, { targeted: 2, sent: 0, failed: 2 });
    expect(registry[0].sendStatus).toBe('failed');
    const retry = claim(registry, KEY);
    expect(retry.action).toBe('proceed'); // failed rows are reclaimable
    const reclaimed = (retry as { registry: SendRecord[] }).registry[0];
    expect(reclaimed.sendStatus).toBe('processing');
    expect(reclaimed.attemptCount).toBe(2);
  });

  it('no-target case is terminal — does not loop', () => {
    let registry: SendRecord[] = (claim([], KEY) as { registry: SendRecord[] }).registry;
    registry = complete(registry, KEY, { targeted: 0, sent: 0, failed: 0 });
    expect(registry[0].sendStatus).toBe('no_targets');
    expect(claim(registry, KEY).action).toBe('duplicate'); // idempotent, no retry loop
  });

  it('PARTIAL result resolves to sent (not retryable) so no device gets a double push', () => {
    let registry: SendRecord[] = (claim([], KEY) as { registry: SendRecord[] }).registry;
    registry = complete(registry, KEY, { targeted: 3, sent: 2, failed: 1 });
    expect(registry[0].sendStatus).toBe('sent');
    expect(registry[0].lastErrorSafe).toContain('partial: 1/3');
    expect(claim(registry, KEY).action).toBe('duplicate'); // already-delivered devices protected
  });

  it('failed retries are BOUNDED — exhausted failures become terminal (review finding)', () => {
    let registry: SendRecord[] = (claim([], KEY) as { registry: SendRecord[] }).registry;
    registry = complete(registry, KEY, { targeted: 1, sent: 0, failed: 1 });
    // burn through the retry budget
    for (let attempt = 2; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      const c = claim(registry, KEY);
      expect(c.action).toBe('proceed');
      registry = (c as { registry: SendRecord[] }).registry;
      expect(registry[0].attemptCount).toBe(attempt);
      registry = complete(registry, KEY, { targeted: 1, sent: 0, failed: 1 });
    }
    // budget spent → terminal, no matter how many more calls arrive
    expect(claim(registry, KEY).action).toBe('exhausted');
    expect(claim(registry, KEY).action).toBe('exhausted');
    expect(registry[0].attemptCount).toBe(MAX_SEND_ATTEMPTS);
  });

  it('different (order,status) transitions are independent', () => {
    const a = (claim([], 'order-1|preparing') as { registry: SendRecord[] }).registry;
    const b = claim(a, 'order-1|ready');
    expect(b.action).toBe('proceed');
  });
});
