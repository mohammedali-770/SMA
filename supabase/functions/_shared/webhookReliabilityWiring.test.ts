import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A source-shape tripwire for the two inbound webhooks, and honest about being
 * one — the same constraint and the same idiom as `lazywaitBaseUrlWiring.test.ts`
 * and `adminAuthWiring.test.ts`. These handlers call `Deno.serve` and import
 * Deno-only modules, so Vitest cannot load them; the decision itself is tested
 * behaviourally in `syncLog.test.ts`.
 *
 * What only a structural check can pin is that the handlers actually LOOK at the
 * results they were ignoring. All three defects fixed on 2026-09-02 were the same
 * shape — supabase-js resolves with `{ error }` instead of throwing, so a write
 * that failed reads exactly like one that succeeded unless somebody destructures
 * it. That is a property of how the call is WRITTEN, which is what this file
 * asserts.
 *
 * The `.then(() => {}, () => {})` assertions are the important ones. That idiom
 * is what discarded the results in the first place, and it is easy to reach for
 * again when a promise is meant to be fire-and-forget.
 */

function source(fn: string): string {
  return readFileSync(new URL(`../${fn}/index.ts`, import.meta.url), 'utf8');
}

/**
 * Comments removed, because both files now DOCUMENT the defects they fixed —
 * naming the 200, the hardcoded 'success' and the swallowing `.then(...)` in
 * prose. An assertion that those are gone would otherwise match the explanation
 * of their removal.
 */
function code(fn: string): string {
  return source(fn)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

describe('lazywait-webhook', () => {
  const src = code('lazywait-webhook');

  // THE CASE THAT WOULD HAVE CAUGHT THE ORIGINAL BUG. A 200 tells Lazywait the
  // delivery succeeded, so it never retries and the event is gone for good.
  it('refuses, rather than acknowledges, when the webhook secret is missing', () => {
    expect(src).toMatch(/if\s*\(!secret\)/);
    expect(src).toMatch(/return json\([^)]*\},\s*503\s*\)/);
    expect(src).not.toMatch(/reason:\s*'webhook secret not configured'[^)]*\},\s*200/);
  });

  it('matches whatsapp-webhook, which already returned 503 for the same condition', () => {
    expect(code('whatsapp-webhook')).toContain('503');
  });

  it('captures the orders write result instead of discarding it', () => {
    expect(src).toMatch(/const\s*\{\s*error:\s*updateError\s*\}\s*=\s*await\s+admin/);
    expect(src).toMatch(/if\s*\(updateError\)/);
  });

  it('derives the log row status from that result, never a literal', () => {
    expect(src).toContain('syncLogOutcome(');
    expect(src).toMatch(/status:\s*outcome\.status/);
    expect(src).toMatch(/error:\s*outcome\.error/);
    expect(src).not.toMatch(/status:\s*'success'/);
  });

  it('observes a failed log insert rather than swallowing it', () => {
    expect(src).toMatch(/const\s*\{\s*error:\s*logError\s*\}\s*=\s*await\s+admin\s*\.?\s*\n?\s*\.from\('integration_sync_logs'\)|const\s*\{\s*error:\s*logError\s*\}/);
    expect(src).toContain('console.error');
  });

  it('has no result-discarding .then handler left anywhere', () => {
    expect(src).not.toMatch(/\.then\(\s*\(\)\s*=>\s*\{\s*\}\s*,\s*\(\)\s*=>\s*\{\s*\}\s*\)/);
  });

  // Deliberately UNCHANGED behaviour, pinned so a later "tidy-up" cannot make the
  // POS retry callbacks for orders we simply do not have.
  it('still accepts an authenticated callback whose order_ref is unknown', () => {
    expect(src).toMatch(/status:\s*'accepted'[\s\S]*?\},\s*200\s*\)/);
  });

  it('still rejects a bad signature with 401', () => {
    expect(src).toMatch(/invalid signature'\s*\}\s*,\s*401/);
  });
});

describe('whatsapp-webhook', () => {
  const src = code('whatsapp-webhook');

  it('checks the record_whatsapp_message RPC result', () => {
    expect(src).toMatch(/const\s*\{\s*error:\s*rpcError\s*\}\s*=\s*await\s+admin\.rpc\('record_whatsapp_message'/);
    expect(src).toMatch(/if\s*\(rpcError\)/);
    expect(src).toContain('console.error');
  });

  it('logs through syncLogOutcome, so no phone number can reach the log line', () => {
    expect(src).toContain('syncLogOutcome(rpcError)');
  });

  // Meta must NOT be made to retry: an authenticated event we could not store is
  // still an event we accepted. The 200 is deliberate, not an oversight.
  it('still returns 200 to Meta after an RPC failure', () => {
    expect(src).toMatch(/return json\(\{\s*status:\s*'ok'\s*\}\s*,\s*200\s*\)/);
  });
});
