import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A source-shape tripwire for the Expo send timeout in `push-dispatch`, in the
 * idiom of `adminAuthWiring.test.ts` and `pushReadyCopyWiring.test.ts`, and
 * honest about being one.
 *
 * `push-dispatch/index.ts` imports Deno-only modules and ends in `Deno.serve`,
 * so Vitest cannot load it and no test here can execute the send. `deno check`
 * only typechecks, and an options object without `signal` is perfectly typed.
 * That leaves the timeout pinned by nothing: a tidy-up that drops one line
 * would pass every other test.
 *
 * THE DEFECT THIS PINS. The fetch to exp.host carried no signal. Measured
 * 2026-11-11 against the real handler, with exp.host routed to a local socket
 * that accepts and never answers: a `pos_sync` dispatch was still pending at
 * 20 s. It had already claimed the event, which flips the row to 'processing',
 * and it never called `finalize_pos_sync_notification`. A 'processing'
 * pos_sync row is never reclaimed, by design, so that event would have stayed
 * 'processing' for good, and the push health card, which counts only failures,
 * would not have shown it. `order_status` hung the same way.
 *
 * Two groups. The first fails on the code before the fix. The second passes
 * before AND after, on purpose: it pins what a timeout turns into. If the
 * `catch` in `sendToDevices` rethrew instead of counting the chunk, a timeout
 * would become an unhandled 500, and the pos_sync row would strand in
 * 'processing' exactly as before. The timeout would still be there and
 * would have stopped doing its job.
 */

function source(): string {
  return readFileSync(new URL('../push-dispatch/index.ts', import.meta.url), 'utf8');
}

/**
 * The same source with comments removed. The handler explains its own history
 * in comments, and an assertion must not be satisfied by the explanation.
 * `adminAuthWiring.test.ts` records that trap firing twice.
 */
function code(): string {
  return source()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

/**
 * Index of the bracket that closes the one at `open`. Skips quoted strings and
 * trailing `//` comments, which `code()` leaves in place.
 */
function matchingClose(src: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const stack: string[] = [];
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      const newline = src.indexOf('\n', i);
      if (newline === -1) return -1;
      i = newline;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1;
      if (j >= src.length) return -1;
      i = j;
    } else if (pairs[ch]) {
      stack.push(pairs[ch]);
    } else if (ch === ')' || ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Every `fetch(...)` call in the code, as the text of the whole call. */
function fetchCalls(c: string): string[] {
  const calls: string[] = [];
  for (const m of c.matchAll(/\bfetch\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const close = matchingClose(c, open);
    expect(close).toBeGreaterThan(open);
    calls.push(c.slice(m.index, close + 1));
  }
  return calls;
}

/** The text of one `if (body.action === '<action>') { ... }` block. */
function actionBlock(c: string, action: string): string {
  const start = c.indexOf(`if (body.action === '${action}') {`);
  expect(start).toBeGreaterThan(-1);
  const open = c.indexOf('{', start);
  const close = matchingClose(c, open);
  expect(close).toBeGreaterThan(open);
  return c.slice(start, close + 1);
}

describe('push-dispatch: the Expo send is bounded', () => {
  it('exports the timeout, at the 10 s admin-push-dispatch also uses', () => {
    expect(code()).toMatch(/^export const EXPO_SEND_TIMEOUT_MS = 10_000;$/m);
  });

  it('passes it to the Expo fetch as the signal', () => {
    const expo = fetchCalls(code()).filter((call) => call.startsWith('fetch(EXPO_PUSH_URL,'));
    expect(expo).toHaveLength(1);
    expect(expo[0]).toContain('signal: AbortSignal.timeout(EXPO_SEND_TIMEOUT_MS)');
  });

  it('leaves no outbound fetch in the handler without a signal', () => {
    // The realistic regression is a SECOND send path added beside the first,
    // for receipts for example, which copies the options and not the timeout.
    const calls = fetchCalls(code());
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/\bsignal:\s*\S/);
  });
});

describe('push-dispatch: what a timed-out send becomes (true before and after)', () => {
  it('counts the whole chunk as failed when the fetch throws, which an abort does', () => {
    expect(code()).toMatch(/\}\s*catch\s*(?:\(\w*\)\s*)?\{\s*result\.failed \+= chunk\.length;\s*\}/);
  });

  it('counts the chunk as failed when the body stalls after the headers', () => {
    // The signal also covers reading the body. An abort there rejects
    // res.json(), which resolves to null here, so no tickets are read and the
    // whole chunk counts as failed.
    const c = code();
    expect(c).toContain('await res.json().catch(() => null)');
    expect(c).toContain('if (tickets.length === 0) result.failed += chunk.length;');
  });

  it("pos_sync: nothing sent finalizes as terminal 'failed', and is never released for a resend", () => {
    const block = actionBlock(code(), 'pos_sync');
    const send = block.indexOf('await sendToDevices(');
    expect(send).toBeGreaterThan(-1);
    const after = block.slice(send);
    expect(after).toContain("const sendStatus = result.sent > 0 ? 'sent' : 'failed';");
    expect(after).toContain("admin.rpc('finalize_pos_sync_notification'");
    expect(after).toContain('p_send_status: sendStatus');
    // At-most-once: after the request may have left, the row is never returned
    // to 'pending'. A timed-out send Expo accepted late would otherwise go twice.
    expect(after).not.toContain('release_pos_sync_notification');
  });

  it("order_status: nothing sent records 'failed', fenced by this attempt, inside a bounded reclaim", () => {
    const block = actionBlock(code(), 'order_status');
    const send = block.indexOf('await sendToDevices(');
    expect(send).toBeGreaterThan(-1);
    const after = block.slice(send);
    expect(after).toContain("const sendStatus = result.sent > 0 ? 'sent' : 'failed';");
    expect(after).toMatch(/\.update\(\{ send_status: sendStatus,/);
    expect(after).toContain(".eq('send_status', 'processing').eq('attempt_count', myAttempt)");
    expect(code()).toMatch(/^const MAX_SEND_ATTEMPTS = 5;$/m);
    expect(block).toContain(".lt('attempt_count', MAX_SEND_ATTEMPTS)");
  });
});
