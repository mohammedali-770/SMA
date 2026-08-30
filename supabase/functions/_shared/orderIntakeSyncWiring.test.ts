import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-shape tripwires for the two halves of "the customer is told the truth
 * about the POS", in the established style of `adminAuthWiring.test.ts` and
 * `lazywaitBaseUrlWiring.test.ts` — and equally honest about the limit: both
 * handlers import Deno-only modules, so Vitest cannot execute them and
 * `deno check` only typechecks. What no runtime test can pin is WHICH function
 * sends the customer's first message, and that is the whole property.
 *
 * TWO DEFECTS THIS EXISTS FOR, both found 2026-08-27.
 *
 * 1. order-intake's sync kick read `if (order_type === 'pickup')`, correct only
 *    while the insert trigger parked every delivery order at `blocked`. Once
 *    migration 20260827120000 opened that gate the condition was a leftover, and
 *    delivery fell through to the once-a-minute cron: 17.8-44.6 s from placing
 *    the order to the branch number appearing, every one a first-attempt
 *    success, so the wait was the tick and never the POS.
 *
 * 2. order-intake pushed `order_status/received` unconditionally — "we received
 *    your order and sent it to the kitchen" — a claim about the BRANCH made
 *    whether or not the branch had heard of the order. The POS outcome now owns
 *    that message, and `lazywait-sync` dispatches it.
 */
function source(fn: string): string {
  return readFileSync(new URL(`../${fn}/index.ts`, import.meta.url), 'utf8');
}
/**
 * Comments stripped — BOTH `//` lines and `/* *\/` blocks. These files
 * deliberately document what they no longer do and why, naming the very
 * identifiers being asserted against, so a prose mention would otherwise
 * satisfy a `toContain` or shift a positional index. (It did: the first version
 * of the ordering assertion was measuring this drain's own doc comment.)
 */
function code(fn: string): string {
  return source(fn)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
}

describe('order-intake — immediate POS sync, and no premature promise', () => {
  const CODE = code('order-intake');

  it('does NOT gate the sync kick on order type', () => {
    expect(CODE).not.toMatch(/order_type\s*\)?\s*===\s*['"]pickup['"]/);
    expect(CODE).not.toMatch(/===\s*['"]pickup['"]\s*\)\s*\{/);
  });

  it('still kicks the worker, with the server-side secret', () => {
    expect(CODE).toContain('/functions/v1/lazywait-sync');
    expect(CODE).toContain("'x-sync-secret'");
    expect(CODE).toContain('sync_trigger_secret');
  });

  it('keeps the sync non-fatal — a POS problem can never fail the order', () => {
    expect(CODE).toContain('SYNC_TIMEOUT_MS');
    expect(CODE).toContain('AbortSignal.timeout');
  });

  it('sends NO push of its own — the POS outcome owns the first message', () => {
    // The regression this blocks: re-adding an unconditional "sent it to the
    // kitchen" push here, which is a claim about the branch that this function
    // is in no position to make.
    expect(CODE).not.toContain('push-dispatch');
    expect(CODE).not.toContain('order_status');
  });
});

describe('lazywait-sync — dispatches the POS lifecycle messages', () => {
  const CODE = code('lazywait-sync');

  it('drains pending pos_sync events to push-dispatch', () => {
    // Before this, record_lazywait_sync and the reaper enqueued these rows and
    // NOTHING ever sent them: no cron, no trigger, no caller.
    expect(CODE).toContain('dispatchPendingPosSync');
    expect(CODE).toContain('/functions/v1/push-dispatch');
    expect(CODE).toContain("action: 'pos_sync'");
    expect(CODE).toContain("'notification_log'");
    expect(CODE).toContain("'pending'");
  });

  it('drains in the SAME run that produced the events', () => {
    // order-intake invokes this worker synchronously on checkout, so the
    // confirmation push must ride that invocation rather than wait for a tick.
    // Positional: the drain call has to come after the order loop's recording.
    const record = CODE.lastIndexOf('record_lazywait_sync');
    const drain = CODE.indexOf('await dispatchPendingPosSync');
    expect(record).toBeGreaterThan(-1);
    expect(drain).toBeGreaterThan(record);
  });

  it('bounds the drain so a backlog cannot fan out without limit', () => {
    expect(CODE).toContain('POS_NOTIFY_DRAIN_LIMIT');
    expect(CODE).toMatch(/\.limit\(POS_NOTIFY_DRAIN_LIMIT\)/);
  });

  it('announces a confirmed order on EVERY success, not only after a failure', () => {
    // The old gate — `priorFailure ? 'pos_confirmed' : null` — meant a clean
    // order enqueued nothing, which is why zero pos_sync rows had ever existed
    // and why the missing dispatcher stayed invisible.
    expect(CODE).not.toMatch(/priorFailure\w*\s*\?\s*'pos_confirmed'/);
    expect(CODE).not.toMatch(/first_pos_sync_failure_at\s*!=\s*null\s*\?\s*'pos_confirmed'/);
    expect(CODE).toContain("p_notify_status: 'pos_confirmed'");
  });
});

/**
 * THE KICK IS TARGETED, AND THE WORK THE CUSTOMER IS NOT WAITING FOR IS
 * DEFERRED RATHER THAN DROPPED (added 2026-08-27).
 *
 * The defect: order-intake kicked the worker with `{limit: 5}`, and
 * `claim_lazywait_sync_batch` orders by created_at ASC while the worker
 * processes serially — so the customer's brand-new order was handled LAST of
 * whatever the batch claimed. Measured on SM-2026-000065 the awaited call took
 * 10.747 s against an 11 s abort (253 ms of headroom); on -000064 the abort
 * appears to have fired and the branch number arrived by luck.
 *
 * The case worth reading twice is "the reaper is still CALLED". Skipping it on
 * the kick path saves the same ~0.9 s as deferring it and is the obvious
 * shortcut, but `reap_stale_lazywait_syncs` has exactly one production caller —
 * this worker — so the cron and this kick are also its only two reaping
 * drivers, and they do not share a failure mode. Deleting the redundant one
 * would let a single missing vault secret stop all reaping, and a cash order
 * stranded in 'syncing' with no ref is invisible to the watchdog as well (R1 and
 * R7 both require payment_status = 'paid'). Deferring costs nothing and keeps
 * both alive.
 */
describe('targeted kick and deferred off-path work', () => {
  it('order-intake asks for ONE named order, not a batch', () => {
    const c = code('order-intake');
    expect(c).toContain('JSON.stringify({ orderId })');
    expect(c).not.toContain('limit: 5');
  });

  it('the id it sends is server-derived, never taken from the request body', () => {
    const c = code('order-intake');
    // `orderId` is derived from place_customer_order's return and validated
    // before the kick; a client-supplied id would let one customer name
    // another's order.
    expect(c).toMatch(/const orderId = order\?\.id \? String\(order\.id\) : null;/);
    expect(c).toContain("if (!orderId) return json(");
    expect(c).not.toMatch(/orderId\s*[:=]\s*body\./);
  });

  it('the worker claims ONE order when targeted and keeps the batch path', () => {
    const c = code('lazywait-sync');
    expect(c).toContain("claim_lazywait_sync_one");
    expect(c).toContain("claim_lazywait_sync_batch");
    // The narrow 'pending'-only predicate was set deliberately by
    // 20260813143000_manual_only_pos_resend; the worker must not reintroduce a
    // 'failed' claim by calling some other RPC.
    expect(c).not.toContain("claim_lazywait_sync_failed");
  });

  it('STILL CALLS the reaper — deferred, never skipped', () => {
    const c = code('lazywait-sync');
    expect(c).toContain('reap_stale_lazywait_syncs');
    // And it must sit INSIDE the off-path wrapper. Positional rather than a
    // negative regex: the tempting shortcut is `if (!targeted) { ...reap... }`,
    // which still contains the RPC name, so presence alone proves nothing.
    const reap = c.indexOf('reap_stale_lazywait_syncs');
    const wrap = c.indexOf('runOffPath(async () => {');
    expect(wrap).toBeGreaterThan(-1);
    expect(wrap).toBeLessThan(reap);
    // Nothing between the wrapper and the RPC may reintroduce a skip.
    expect(c.slice(wrap, reap)).not.toContain('targeted');
  });

  it('defers the reaper and the push drain through one guarded helper', () => {
    const c = code('lazywait-sync');
    expect(c).toContain('runOffPath');
    expect(c).toContain('EdgeRuntime');
    expect(c).toContain('waitUntil');
    // Both off-path jobs go through it. The regex matches INVOCATIONS only —
    // the declaration is `const runOffPath = async (`, which it does not match —
    // so this is exactly the two call sites: the reaper and the push drain.
    const calls = c.match(/(?<!const )runOffPath\(/g) ?? [];
    expect(calls).toHaveLength(2);
  });

  it('the deferral degrades to awaiting, never to skipping', () => {
    const c = code('lazywait-sync');
    // On a runtime without EdgeRuntime.waitUntil the work must still run.
    expect(c).toContain('await p;');
  });

  it('DEFERS the CRM lookup on the kick path, and does not drop it', () => {
    const c = code('lazywait-sync');
    // Capping it at 1.5 s was not enough: on SM-2026-000067 it spent the whole
    // cap and still returned nothing. It is now off the awaited path entirely.
    expect(c).not.toContain('CRM_SEARCH_TIMEOUT_MS_TARGETED');
    expect(c).toContain('crmBackfills');
    expect(c).toMatch(/if \(targeted\) \{\s*crmBackfills\.push\(refreshCrmLink\);/);
  });

  it('still RUNS the CRM refresh, because the cron would never run it', () => {
    const c = code('lazywait-sync');
    // The cron claims nothing now that the kick syncs every order on placement
    // (every observed tick reports claimed: 0), so a search moved to the cron
    // path would never execute and profiles.lazywait_customer_id would stay
    // null for ever. The deferred call is what keeps the feature alive.
    expect(c).toContain('/crm/customers/search');
    const drain = c.indexOf('dispatchPendingPosSync(admin)');
    const loop = c.indexOf('for (const backfill of crmBackfills)');
    expect(loop).toBeGreaterThan(-1);
    // Runs after the push, inside the same deferred block.
    expect(loop).toBeGreaterThan(drain);
  });

  it('keeps the full 8 s inline search on the untargeted (cron) path', () => {
    const c = code('lazywait-sync');
    // Where nothing is waiting, a fresh match should still supersede the stored
    // link on the ticket being built.
    expect(c).toMatch(/crmCustomerId = String\(match\.id\);/);
    expect(c).not.toContain('timeoutMs: targeted');
  });

  it('issues the three per-order reads concurrently', () => {
    const c = code('lazywait-sync');
    expect(c).toMatch(/await Promise\.all\(\[\s*admin\.from\('branches'\)/);
  });

  it('bounds the customer wait at 11 s until a build ships the client half', () => {
    // Cut to 5 s on 2026-08-27, reverted on 2026-08-28. Returning mid-send hands
    // the app a `syncing` row that ALREADY carries pos_create_attempted_at, and
    // the confirmation screen read that as "we could not verify whether the
    // branch received this order" — shown to a customer on SM-2026-000070, which
    // was synced as ticket #2 in 7.30 s with zero failed attempts.
    //
    // Re-cut to 5 s only once a shipped build carries BOTH client changes: the
    // syncing-before-marker ordering in orderConfirmation.ts, and
    // nextReceiptPollMs in ordersRefresh.ts. The measurements that justified the
    // cut still stand; only its client half was missing.
    const c = code('order-intake');
    expect(c).toContain('const SYNC_TIMEOUT_MS = 11_000;');
    expect(c).not.toContain('5_000');
  });

  it('does NOT shorten the Create Order timeout, which means something else', () => {
    // lazywaitFetch's 15 s on /pos/orders/create is the boundary between
    // proven-not-sent and may-have-been-sent: a timeout there is classified
    // `ambiguous` and routes to confirmation_required rather than a resend,
    // because Create Order has no idempotency key. Cutting it would convert
    // slow-but-successful tickets into orders a human must verify by hand.
    // It is the obvious next thing to "optimise" and it must not be.
    const c = code('lazywait-sync');
    expect(c).toMatch(/path: '\/pos\/orders\/create', body: built\.payload, timeoutMs: 15000/);
  });

  it('order-intake still bounds the kick and still sends the secret', () => {
    // Unchanged guarantees — the targeting must not have loosened either.
    const c = code('order-intake');
    expect(c).toContain('AbortSignal.timeout(SYNC_TIMEOUT_MS)');
    expect(c).toContain("'x-sync-secret'");
  });

  it('starts the provider-config read BEFORE placing the order', () => {
    // The config read uses the service-role client and does not depend on the
    // order, so running it strictly afterwards cost a full extra CROSS-REGION
    // round trip on the customer's awaited path. The database is in
    // eu-central-1 while a Dammam customer's function executes in ap-south-1 or
    // eu-central-2, so every PostgREST call is intercontinental — that ordering
    // was worth roughly a whole round trip for no reason.
    const c = code('order-intake');
    const cfgStart = c.indexOf('cfgPromise = getProviderConfig(');
    const place = c.indexOf("supa.rpc('place_customer_order'");
    expect(cfgStart, 'cfgPromise assignment not found').toBeGreaterThan(-1);
    expect(place, 'place_customer_order call not found').toBeGreaterThan(-1);
    expect(cfgStart).toBeLessThan(place);
    // And it must be AWAITED only inside the sync block, not before the order.
    expect(c.indexOf('await cfgPromise')).toBeGreaterThan(place);
  });

  it('never lets a missing service-role env fail the order', () => {
    // adminClient() THROWS when SUPABASE_SERVICE_ROLE_KEY is absent. It used to
    // sit inside the sync block's try/catch; hoisting it bare to start the
    // config read early would turn a misconfigured environment into a failed
    // checkout — the exact opposite of "a POS problem can NEVER fail the order".
    const c = code('order-intake');
    const guarded = /try\s*\{[^}]*const admin = adminClient\(\);/s.test(c);
    expect(guarded, 'adminClient() must stay inside a try').toBe(true);
    expect(c).toContain('cfgPromise = Promise.resolve(null)');
  });

  it('logs timing as numbers only — no order contents, no customer data', () => {
    // The timing line exists because apportioning this latency from OUTSIDE
    // produced a confident wrong answer once already (it blamed Deno cold
    // start; a 15-minute idle test then measured 828 ms). It must not become a
    // PII leak in the process.
    //
    // ALLOWLIST, not a blacklist, and over the WHOLE payload — the first
    // version of this test did neither and was shown two escapes in review: it
    // sliced from the `at` key onward, so an identifier added ABOVE `at` was
    // never scanned, and it blacklisted a handful of names, so `customerId` or
    // `email` passed anywhere. Both were reproduced before this rewrite.
    const c = code('order-intake');
    const open = c.indexOf('console.log(JSON.stringify({');
    expect(open, 'timing log not found').toBeGreaterThan(-1);
    const payload = c.slice(c.indexOf('{', open) + 1, c.indexOf('}));', open));

    const entries = payload
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter(Boolean)
      .map((l) => {
        const m = /^(\w+):\s*(.+?),?$/.exec(l);
        expect(m, `unparsed line in the timing payload: ${l}`).not.toBeNull();
        return [(m as RegExpExecArray)[1], (m as RegExpExecArray)[2]] as const;
      });

    // Every key is known and expected — an added key fails here.
    expect(entries.map(([k]) => k).sort()).toEqual([
      'at', 'body_read_ms', 'config_ms', 'entry_ms', 'isolate_age_ms',
      'parse_ms', 'place_ms', 'reread_ms', 'reread_span_ms', 'sync_ms',
      'sync_span_ms', 'total_ms',
    ]);

    // Every VALUE may only mention these identifiers. Anything reaching for an
    // order, a customer, a body field or a secret fails, whatever it is called.
    const ALLOWED = new Set(['mark', 'config', 'place', 'sync', 'reread', 'entry', 'parse', 'Date', 'now', 't0', 'MODULE_LOADED_AT', 'null']);
    for (const [key, value] of entries) {
      if (key === 'at') {
        expect(value).toBe("'order-intake.timing'");
        continue;
      }
      expect(value, `${key} must not contain a string literal`).not.toMatch(/['"`]/);
      for (const ident of value.match(/[A-Za-z_$][\w$]*/g) ?? []) {
        expect(ALLOWED.has(ident), `timing value for ${key} references ${ident}`).toBe(true);
      }
    }
  });
  it('starts the clock on the FIRST line of the handler', () => {
    // The first version set t0 after `await req.json()` and under-reported the
    // invocation by 2062 ms — total_ms 7129 against the platform's
    // execution_time_ms 9191 for the same request. Everything in front of it
    // (gateway JWT verification, isolate boot, and the phone uploading the
    // request body) was invisible, and it was the largest unexplained block in
    // checkout. If t0 drifts back below req.json(), that blind spot reopens
    // silently — the numbers still look plausible, they are just missing two
    // seconds. Hence a positional assertion rather than a comment.
    const c = code('order-intake');
    const serve = c.indexOf('Deno.serve(');
    const t0 = c.indexOf('const t0 = Date.now();');
    const parse = c.indexOf('await req.json()');
    const auth = c.indexOf("req.headers.get('Authorization')");
    expect(t0, 't0 not found').toBeGreaterThan(-1);
    expect(t0).toBeGreaterThan(serve);
    expect(t0, 't0 must precede the Authorization check').toBeLessThan(auth);
    expect(t0, 't0 must precede req.json() — that await is the body upload').toBeLessThan(parse);
    // And exactly one t0, so a second declaration cannot shadow it.
    expect(c.split('const t0 = Date.now();').length - 1).toBe(1);
  });
  it('stamps isolate boot at MODULE scope, outside the handler', () => {
    // t0 on the first line of the callback is NOT the invocation start: the
    // imports (one of them npm:@supabase/supabase-js) are evaluated at isolate
    // boot before Deno.serve registers anything, and gateway JWT verification
    // happens before that again. Review raised this as a P1 against a revision
    // that claimed total_ms would converge with execution_time_ms.
    //
    // MODULE_LOADED_AT is the one piece of that front observable from inside,
    // so it must sit OUTSIDE the handler — inside, it would just equal t0 and
    // report a constant zero while looking like a measurement.
    const c = code('order-intake');
    const decl = c.indexOf('const MODULE_LOADED_AT = Date.now();');
    const serve = c.indexOf('Deno.serve(');
    expect(decl, 'MODULE_LOADED_AT not found').toBeGreaterThan(-1);
    expect(decl, 'MODULE_LOADED_AT must be declared before Deno.serve').toBeLessThan(serve);
    expect(c).toContain('isolate_age_ms: t0 - MODULE_LOADED_AT');
  });

  it('does not claim the body read is the device upload', () => {
    // body_read_ms is a LOWER BOUND: the runtime may buffer part of the body
    // before the callback runs. The earlier name asserted otherwise.
    const c = code('order-intake');
    expect(c).not.toContain('upload_span_ms');
    expect(c).toContain('body_read_ms');
  });
});
