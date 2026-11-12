import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A source-shape tripwire for the two `lazywait-sync` gate refusals that leave
 * no row, in the idiom of `adminAuthWiring.test.ts` and
 * `orderIntakeSyncWiring.test.ts`, and honest about being one: the handler
 * imports Deno-only modules, so Vitest cannot execute it.
 *
 * THE GAP THIS PINS. `begin_lazywait_create_attempt` is the fenced gate
 * immediately before the Create Order POST. Two of its outcomes write nothing:
 * the RPC itself failing, and a status other than the five the worker handles
 * (`invalid_state`, `not_found`). Both skip the order and leave it 'syncing'
 * for the stale reaper. Until 2026-11-11 each logged free text without the
 * order id:
 *
 *     begin_lazywait_create_attempt failed (no send): <error>
 *     begin_lazywait_create_attempt not ready (no send): <status>
 *
 * Neither calls `record_lazywait_sync`, so no `integration_sync_logs` row
 * exists for the attempt. A responder chasing a stuck order had a log line
 * that could not be tied to any order. Each branch now emits one JSON line
 * carrying the order's UUID, in the shape of order-intake's timing line.
 *
 * The change is LOGGING ONLY, so the last group pins the control flow it must
 * not touch: both branches still skip the order and send nothing.
 */

function source(): string {
  return readFileSync(new URL('../lazywait-sync/index.ts', import.meta.url), 'utf8');
}

/**
 * Comments removed. The handler documents its own history, and this file
 * quotes the old free-text lines above, so an assertion must not be satisfied
 * by prose.
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

/** The body of the `if (...) { ... }` that starts with `head`, which must occur once. */
function ifBlock(c: string, head: string): string {
  const start = c.indexOf(head);
  expect(start).toBeGreaterThan(-1);
  expect(c.indexOf(head, start + 1)).toBe(-1);
  const open = c.indexOf('{', start + head.length - 1);
  const close = matchingClose(c, open);
  expect(close).toBeGreaterThan(open);
  return c.slice(open, close + 1);
}

/** The one JSON log call in a block: its console method and its fields, in order. */
function jsonLog(block: string): { method: string; fields: Array<[string, string]> } {
  const calls = [...block.matchAll(/console\.(\w+)\(/g)];
  expect(calls).toHaveLength(1);
  const m = /console\.(\w+)\(JSON\.stringify\(\{/.exec(block);
  expect(m).not.toBeNull();
  const open = (m?.index ?? 0) + (m?.[0].length ?? 0) - 1;
  const close = matchingClose(block, open);
  expect(close).toBeGreaterThan(open);
  const fields = block
    .slice(open + 1, close)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): [string, string] => {
      const colon = part.indexOf(':');
      expect(colon).toBeGreaterThan(0);
      return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
    });
  return { method: m?.[1] ?? '', fields };
}

const GATE_ERROR = 'if (gateErr) {';
const NOT_READY = "if (gateStatus !== 'ready_to_send') {";

describe('lazywait-sync: a gate refusal that writes no row logs the order id', () => {
  it('the RPC-error branch emits one JSON line naming the order', () => {
    const log = jsonLog(ifBlock(code(), GATE_ERROR));
    expect(log.method).toBe('error');
    expect(log.fields).toEqual([
      ['at', "'lazywait-sync.gate'"],
      ['order_id', 'orderId'],
      ['outcome', "'rpc_error'"],
      ['sent', 'false'],
      ['error', 'safeErr(gateErr.message)'],
    ]);
  });

  it('the not-ready branch emits one JSON line naming the order', () => {
    const log = jsonLog(ifBlock(code(), NOT_READY));
    expect(log.method).toBe('warn');
    expect(log.fields).toEqual([
      ['at', "'lazywait-sync.gate'"],
      ['order_id', 'orderId'],
      ['outcome', "'not_ready'"],
      ['sent', 'false'],
      ['gate_status', 'gateStatus'],
    ]);
  });

  it('no longer logs either refusal as free text', () => {
    const c = code();
    expect(c).not.toContain("'begin_lazywait_create_attempt failed (no send):'");
    expect(c).not.toContain("'begin_lazywait_create_attempt not ready (no send):'");
  });
});

describe('lazywait-sync: what the gate refusals must keep doing (true before and after)', () => {
  it("the id it logs is the claimed row's, never one taken from the request", () => {
    // In targeted mode the request names an order, but `orderId` is read off
    // the row the claim RPC returned. A request-supplied value in a log line is
    // a value anyone who can reach the function can choose.
    const c = code();
    expect(c).toMatch(/for \(const order of orders\) \{\s*const orderId = String\(order\.id\);/);
    // `\b` matters: the claim RPC's own argument, `p_order_id: targetOrderId`, is
    // correct and must not satisfy this.
    expect(c).not.toMatch(/\border_id:\s*targetOrderId/);
  });

  for (const [label, head] of [
    ['RPC error', GATE_ERROR],
    ['not ready', NOT_READY],
  ] as const) {
    it(`${label}: counts a skip, writes nothing, and moves to the next order`, () => {
      const block = ifBlock(code(), head);
      expect(block).toContain('summary.skipped++;');
      expect(block).toMatch(/continue;\s*\}$/);
      expect(block).not.toContain('record_lazywait_sync');
      expect(block).not.toContain('lazywaitFetch');
      expect(block).not.toContain('posAttempted');
    });
  }

  it('the Create Order POST still comes after both refusals', () => {
    const c = code();
    const post = c.indexOf("path: '/pos/orders/create'");
    expect(post).toBeGreaterThan(c.indexOf(GATE_ERROR));
    expect(post).toBeGreaterThan(c.indexOf(NOT_READY));
  });
});
