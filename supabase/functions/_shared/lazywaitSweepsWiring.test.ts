import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-shape tripwire for F-X09-002, honest about being one: the handler
 * imports Deno-only modules, so Vitest cannot execute its control flow.
 *
 * THE DEFECT. `lazywait-sync` answered `disabled` / 503 / 401 / 500 BEFORE it
 * reached `reap_stale_lazywait_syncs`, which is also the deadline sweep and has
 * no other caller. Orders keep entering `pending` whatever the integration
 * switch says, so a switched-off (or misconfigured) integration left every one
 * of them on "sending to the branch" with no deadline, then dead-lettered the
 * whole backlog in one burst on re-enable.
 *
 * WHAT MUST HOLD NOW, and what these assertions pin:
 *   1. the caller is authenticated BEFORE any sweep (the function is
 *      internet-reachable, verify_jwt = false);
 *   2. the sweeps run BEFORE the disabled / base-URL / credential exits;
 *   3. NOTHING that claims an order or talks to the POS runs before those exits.
 */
function code(): string {
  return readFileSync(new URL('../lazywait-sync/index.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

const src = code();
const at = (needle: string | RegExp): number =>
  typeof needle === 'string' ? src.indexOf(needle) : src.search(needle);

describe('lazywait-sync sweeps run when the integration is off or misconfigured', () => {
  it('authenticates the caller BEFORE the reaper', () => {
    const auth = at('timingSafeEqual(providedSyncSecret, triggerSecret)');
    const reap = at("rpc('reap_stale_lazywait_syncs'");
    expect(auth).toBeGreaterThan(-1);
    expect(reap).toBeGreaterThan(auth);
  });

  it('refuses a caller with the wrong secret (401) before any sweep', () => {
    const check = at('if (!timingSafeEqual(providedSyncSecret, triggerSecret)) {');
    expect(check).toBeGreaterThan(-1);
    expect(src.slice(check, check + 120)).toContain("return json({ error: 'unauthorized' }, 401)");
    expect(at("rpc('reap_stale_lazywait_syncs'")).toBeGreaterThan(check);
  });

  it('runs the reaper BEFORE the disabled, base-URL and credential exits', () => {
    const reap = at("rpc('reap_stale_lazywait_syncs'");
    for (const exit of [
      'if (!cfg.enabled) {',
      'if (!resolvedBase.ok)',
      'if (!lw.clientId || !lw.apiToken)',
    ]) {
      const i = at(exit);
      expect(i, exit).toBeGreaterThan(-1);
      expect(reap, exit).toBeLessThan(i);
    }
  });

  it('no longer returns `disabled` from the very first config check', () => {
    // The old shape: `if (!cfg || !cfg.enabled) return json({ status: 'disabled' ...`
    expect(src).not.toMatch(/if \(!cfg \|\| !cfg\.enabled\)/);
    expect(src).toMatch(/if \(!cfg\) return json\(\{ status: 'disabled'/);
  });

  it('the disabled exit still reports `disabled` and carries the sweep result', () => {
    const block = src.slice(at('if (!cfg.enabled) {'), at('if (!cfg.enabled) {') + 220);
    expect(block).toContain("status: 'disabled'");
    expect(block).toContain('reaped');
  });

  it('drains the customer messages the sweep queued on every early exit', () => {
    const exits = [
      at('if (!cfg.enabled) {'),
      at('if (!resolvedBase.ok) {'),
      at('if (!lw.clientId || !lw.apiToken) {'),
    ];
    for (const e of exits) {
      expect(src.slice(e, e + 260)).toContain('await drainNotifications()');
    }
  });

  it('claims NOTHING and sends NOTHING before the last early exit', () => {
    const lastExit = at('if (!lw.clientId || !lw.apiToken) {');
    expect(lastExit).toBeGreaterThan(-1);
    for (const poster of [
      'claim_lazywait_sync_batch',
      'claim_lazywait_sync_one',
      'begin_lazywait_create_attempt',
      "'/pos/orders/create'",
      "'/crm/customers/search'",
    ]) {
      const i = at(poster);
      expect(i, poster).toBeGreaterThan(-1);
      expect(i, poster).toBeGreaterThan(lastExit);
    }
    // No POS transport call of any kind precedes it either.
    expect(at(/lazywaitFetch\s*[<(]/)).toBeGreaterThan(lastExit);
  });

  it('a disabled integration with no trigger secret still answers 200 disabled, sweeping nothing', () => {
    const block = src.slice(at('if (!triggerSecret) {'), at('if (!triggerSecret) {') + 260);
    expect(block).toMatch(/if \(!cfg\.enabled\) return json\(\{ status: 'disabled'/);
    expect(block).toContain('sync trigger secret not configured');
  });

  it('keeps the reaper non-fatal and the deadline sweep inside the same RPC', () => {
    expect(src).toContain('reap_stale_lazywait_syncs failed (non-fatal)');
    expect(src).toContain('p_timeout_minutes: STALE_SYNC_TIMEOUT_MINUTES');
  });
});
