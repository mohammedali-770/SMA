import { describe, expect, it } from 'vitest';

import {
  claim, complete, MAX_SEND_ATTEMPTS, PROCESSING_LEASE_MS, releaseFailedLookup, type SendRecord,
} from './sendLifecycle';

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

  it('STALE processing lease is reclaimed — a crashed owner cannot strand the send (review finding)', () => {
    const t0 = 1_000_000;
    // Owner claims at t0 and then crashes (never completes):
    const registry = (claim([], KEY, t0) as { registry: SendRecord[] }).registry;
    // While the lease is LIVE every caller still backs off:
    expect(claim(registry, KEY, t0 + PROCESSING_LEASE_MS).action).toBe('in_progress');
    // Once the lease has EXPIRED the claim is reclaimed with attempt_count++:
    const later = t0 + PROCESSING_LEASE_MS + 1;
    const retry = claim(registry, KEY, later);
    expect(retry.action).toBe('proceed');
    const reclaimed = (retry as { registry: SendRecord[] }).registry[0];
    expect(reclaimed.sendStatus).toBe('processing');
    expect(reclaimed.attemptCount).toBe(2);
    expect(reclaimed.lastErrorSafe).toContain('stale processing lease');
    // The reclaim renews the lease — an immediate third caller backs off again:
    expect(claim((retry as { registry: SendRecord[] }).registry, KEY, later + 1).action).toBe('in_progress');
  });

  it('stale-lease reclaims share the SAME bounded attempt budget — never reclaimed forever', () => {
    let now = 1_000_000;
    let registry = (claim([], KEY, now) as { registry: SendRecord[] }).registry;
    // Every owner crashes; each expiry burns one attempt from the shared budget.
    for (let attempt = 2; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      now += PROCESSING_LEASE_MS + 1;
      const c = claim(registry, KEY, now);
      expect(c.action).toBe('proceed');
      registry = (c as { registry: SendRecord[] }).registry;
      expect(registry[0].attemptCount).toBe(attempt);
    }
    now += PROCESSING_LEASE_MS + 1;
    expect(claim(registry, KEY, now).action).toBe('exhausted'); // terminal even though expired
  });

  it('FAILED device lookup releases the claim as retryable failed — never terminal no_targets (review finding)', () => {
    let registry = (claim([], KEY) as { registry: SendRecord[] }).registry;
    // The audience query errors → the claim is released, NOT resolved empty:
    registry = releaseFailedLookup(registry, KEY);
    expect(registry[0].sendStatus).toBe('failed'); // retryable — not no_targets
    expect(registry[0].lastErrorSafe).toContain('device lookup failed');
    // A later call retries and, with the lookup healthy again, delivers:
    const retry = claim(registry, KEY);
    expect(retry.action).toBe('proceed');
    registry = complete((retry as { registry: SendRecord[] }).registry, KEY, { targeted: 1, sent: 1, failed: 0 });
    expect(registry[0].sendStatus).toBe('sent');
  });

  it('releaseFailedLookup only releases a live processing claim (terminal rows untouched)', () => {
    let registry = (claim([], KEY) as { registry: SendRecord[] }).registry;
    registry = complete(registry, KEY, { targeted: 2, sent: 2, failed: 0 });
    expect(releaseFailedLookup(registry, KEY)[0].sendStatus).toBe('sent'); // no-op on terminal rows
  });
});
