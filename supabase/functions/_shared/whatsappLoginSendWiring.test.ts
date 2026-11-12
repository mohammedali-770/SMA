import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-shape tripwires for the WhatsApp leg of every customer sign-in, in the
 * style of adminAuthWiring.test.ts and with the same limit stated plainly: both
 * files import Deno-only modules (`npm:` specifiers), so Vitest cannot execute
 * them, and `deno check` only typechecks. These assertions read the source as
 * text.
 *
 * TWO GAPS THIS EXISTS FOR, both found by the 2026-11-11 app-hardening
 * assessment (its items R02 and S07; the evidence is in the pull request).
 *
 * 1. The Meta Graph send had no timeout (R02). Supabase Auth gives the
 *    Send SMS hook 5 s for the whole invocation. Against a Graph API that
 *    accepted the connection and never answered, the real handler was still
 *    waiting at 20 s, with no log row written and its rate-limit reservation
 *    still held.
 *
 * 2. The hook's rate-limit wiring was pinned by nothing (S07). The SQL
 *    budget has its own suite (otp_login_rate_limit_test.sql), but deleting the
 *    reservation, moving it after the send or dropping the release would have
 *    passed every test and `deno check`. That reservation is the only per-phone
 *    throttle on a live, billable channel.
 *
 * The executed evidence, the real handler against a stub Graph API before and
 * after, is recorded in docs/WHATSAPP_LOGIN.md. It needs Deno and sockets, so it
 * is not part of this suite.
 */

function source(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

/**
 * The source with every comment removed and every string literal kept.
 *
 * Stricter than the stripper in adminAuthWiring.test.ts, which drops only
 * whole-line `//` comments: whatsappSend.ts also carries trailing ones, and a
 * check that a comment can satisfy is not a check. String literals are tracked
 * so that the `//` in 'https://graph.facebook.com' is not read as a comment.
 * Neither file contains a regex literal, which this does not understand; the
 * known-positive tests below fail if the output stops looking like the code.
 */
function stripComments(src: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      out += ch;
      if (ch === '\\') out += src[++i] ?? '';
      else if (ch === quote) quote = null;
    } else if (ch === '/' && src[i + 1] === '/') {
      while (i + 1 < src.length && src[i + 1] !== '\n') i++;
    } else if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 1;
    } else {
      if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      out += ch;
    }
  }
  return out;
}

/** Index just past the bracket that closes the one at `open`. String contents are skipped. */
function closeOf(code: string, open: number): number {
  const closer: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (closer[ch]) {
      stack.push(closer[ch]);
    } else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  throw new Error(`no bracket closes the one at offset ${open}`);
}

/** The text of the call whose callee starts at `at`, through its closing paren. */
function callAt(code: string, at: number): string {
  return code.slice(at, closeOf(code, code.indexOf('(', at)));
}

/** The statement opened by the first match of `head` at or after `from`, through its block. `head` must end in `{`. */
function blockAfter(code: string, head: RegExp, from: number): { at: number; text: string } | null {
  const re = new RegExp(head.source, 'g');
  re.lastIndex = from;
  const m = re.exec(code);
  if (!m) return null;
  return { at: m.index, text: code.slice(m.index, closeOf(code, m.index + m[0].length - 1)) };
}

describe('whatsappSend.ts — the Meta send has a deadline', () => {
  const RAW = source('./whatsappSend.ts');
  const CODE = stripComments(RAW);
  const TIMEOUT = /\bsignal:\s*AbortSignal\.timeout\(\s*([A-Z][A-Z0-9_]*)\s*\)/;

  /** The Graph fetch call inside deliverOtpTemplate, or null when either is missing. */
  function graphFetch(): string | null {
    const fn = CODE.indexOf('export async function deliverOtpTemplate(');
    if (fn === -1) return null;
    const bodyOpen = CODE.indexOf('{', closeOf(CODE, CODE.indexOf('(', fn)));
    const body = CODE.slice(bodyOpen, closeOf(CODE, bodyOpen));
    const at = body.indexOf('fetch(`${GRAPH_BASE}/');
    return at === -1 ? null : callAt(body, at);
  }

  it('reads code, not comments (checked on a known string and a known comment)', () => {
    // Known positives first: without them, every negative assertion in this file
    // would also pass against an empty string.
    expect(CODE).toContain("const GRAPH_BASE = 'https://graph.facebook.com';");
    expect(RAW).toContain('// not fully configured');
    expect(CODE).not.toContain('not fully configured');
    expect(graphFetch(), 'Graph fetch not found in deliverOtpTemplate').not.toBeNull();
  });

  it('passes AbortSignal.timeout(<constant>) to the Graph fetch in deliverOtpTemplate', () => {
    expect(graphFetch()).toMatch(TIMEOUT);
  });

  it('that constant is a numeric literal of at most 4000 ms, and not a slipped digit', () => {
    // Auth gives the whole hook 5 s, and the hook makes up to five database round
    // trips around this send. The floor is not a measured minimum: it catches 300
    // typed for 3000, which would fail every login while Meta is healthy.
    const name = TIMEOUT.exec(graphFetch() ?? '')?.[1];
    expect(name, 'no AbortSignal.timeout(<CONSTANT>) on the Graph fetch').toBeDefined();
    const decl = new RegExp(`^(?:export )?const ${name} = ([0-9_]+);`, 'm').exec(CODE);
    expect(decl, `${name} is not declared as a numeric literal`).not.toBeNull();
    const ms = Number(decl![1].replace(/_/g, ''));
    expect(ms).toBeLessThanOrEqual(4000);
    expect(ms).toBeGreaterThanOrEqual(1000);
  });

  it('every fetch in this module carries a signal', () => {
    // Today there is exactly one. A second one added without a bound would bring
    // the same hang back through a different call.
    const sites = [...CODE.matchAll(/\bfetch\(/g)].map((m) => callAt(CODE, m.index!));
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) expect(site).toMatch(/\bsignal:/);
  });
});

describe('auth-send-sms-whatsapp — the per-phone reservation gates every send', () => {
  const RAW = source('../auth-send-sms-whatsapp/index.ts');
  const CODE = stripComments(RAW);

  // The identifiers the handler binds today, read from the code rather than
  // assumed: a rename alone does not break these, a hardcoded value does.
  const reserve = /const \{ data: (\w+), error: (\w+) \} = await admin\.rpc\(\s*'otp_reserve_send'/.exec(
    CODE,
  );
  const deliver = /const (\w+) = await deliverOtpTemplate\(/.exec(CODE);
  const reserveAt = reserve?.index ?? -1;
  const deliverAt = deliver?.index ?? -1;
  const [, DATA, ERR] = reserve ?? [];
  const OUT = deliver?.[1];
  const gateDecl = DATA ? new RegExp(`const (\\w+) = ([^;]*\\b${DATA}\\b[^;]*);`).exec(CODE) : null;
  const GATE = gateDecl?.[1];

  it('reads code, not comments (checked on a known comment)', () => {
    // Step 6's comment names deliverOtpTemplate in prose, above the code. If it
    // survived stripping, the ordering below would be measuring an explanation.
    expect(RAW).toContain('This path calls deliverOtpTemplate');
    expect(CODE).not.toContain('This path calls deliverOtpTemplate');
    expect(CODE).toContain('Deno.serve(');
  });

  it('reserves BEFORE it delivers, and delivers from exactly one place', () => {
    expect(reserveAt, 'otp_reserve_send call not found').toBeGreaterThan(-1);
    expect(deliverAt, 'deliverOtpTemplate call not found').toBeGreaterThan(-1);
    expect(reserveAt).toBeLessThan(deliverAt);
    // A second call site, anywhere, could send without a reservation.
    expect([...CODE.matchAll(/\bdeliverOtpTemplate\(/g)].length).toBe(1);
  });

  it('reserves for the same normalized number it delivers to', () => {
    // The budget is counted per phone_e164 and shared with the verification path,
    // which reserves the normalized form. Reserving the raw payload phone would
    // give one number two budgets.
    const norm = /const (\w+) = normalizeSaudiPhoneE164\(/.exec(CODE)?.[1];
    expect(norm, 'normalizeSaudiPhoneE164 result not found').toBeDefined();
    expect(callAt(CODE, reserveAt)).toMatch(new RegExp(`p_phone: ${norm}\\.e164,`));
    expect(callAt(CODE, CODE.indexOf('deliverOtpTemplate(', deliverAt))).toMatch(
      new RegExp(`^deliverOtpTemplate\\(admin, \\w+, ${norm}\\.e164,`),
    );
  });

  it('fails CLOSED with 503 when the limiter itself errors', () => {
    const block = ERR ? blockAfter(CODE, new RegExp(`if \\(${ERR}\\) \\{`), reserveAt) : null;
    expect(block, `no if (${ERR}) block after the reservation`).not.toBeNull();
    expect(block!.text).toMatch(/\breturn hookError\(503,/);
    expect(block!.at).toBeLessThan(deliverAt);
  });

  it('refuses with 429 when the budget says no (allowed === false)', () => {
    // The gate must be the RPC's own answer. `const gate = { allowed: true }`
    // would pass any assertion that looked only for the 429.
    expect(GATE, `no binding derived from ${DATA}`).toBeDefined();
    expect(gateDecl!.index).toBeGreaterThan(reserveAt);
    expect(gateDecl![2]).not.toContain('{');
    const block = blockAfter(CODE, new RegExp(`if \\([^)]*\\b${GATE}\\.allowed === false\\) \\{`), reserveAt);
    expect(block, `no refusal on ${GATE}.allowed === false`).not.toBeNull();
    expect(block!.text).toMatch(/\breturn hookError\(429,/);
    expect(block!.at).toBeLessThan(deliverAt);
  });

  it('hands the reservation back when the send did not succeed, and only then', () => {
    const block = OUT ? blockAfter(CODE, new RegExp(`if \\(${OUT} !== 'sent'\\) \\{`), deliverAt) : null;
    expect(block, `no if (${OUT} !== 'sent') block after the send`).not.toBeNull();
    const release = block!.text.search(
      new RegExp(`\\.rpc\\('otp_release_send', \\{ p_reservation_id: ${GATE}\\??\\.reservation_id \\}\\)`),
    );
    expect(release, 'otp_release_send(<gate>.reservation_id) not called on failure').toBeGreaterThan(-1);
    expect(block!.text.indexOf('return hookError(502,')).toBeGreaterThan(release);
    // Exactly one release, and it is the one above. Releasing after a SUCCESSFUL
    // send would hand every slot back and silently remove the limit.
    expect([...CODE.matchAll(/'otp_release_send'/g)].length).toBe(1);
    expect(CODE.indexOf('return hookOk();', block!.at + block!.text.length)).toBeGreaterThan(-1);
  });
});
