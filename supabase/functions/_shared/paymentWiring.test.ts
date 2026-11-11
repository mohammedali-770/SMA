import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A source-shape tripwire for the payment Edge Functions, and honest about being
 * one: the same idiom as `adminAuthWiring.test.ts`. The handlers call
 * `Deno.serve` and import Deno-only modules, so Vitest cannot load them. The
 * pure decisions they call are tested behaviourally in `moyasar.test.ts` and
 * `moyasarRefund.test.ts`.
 *
 * What only a structural check can pin is the SHAPE of each handler: which
 * provider it will talk to, what it answers when the configuration names any
 * other, and the order in which the money path decides things. Moyasar became
 * the only payment provider on 2026-11-11 (owner decision). These assertions
 * make a second provider, or a quiet reordering of the money path, a deliberate
 * edit of this file rather than a side effect of some other change.
 */

const PAYMENT_FUNCTIONS = [
  'payment-initiate',
  'payment-verify',
  'payment-webhook',
  'payment-refund',
  'payment-test-config',
] as const;

function source(fn: string): string {
  return readFileSync(new URL(`../${fn}/index.ts`, import.meta.url), 'utf8');
}

/**
 * The same source with comments removed. These files explain, in prose, the Tap
 * code they replaced, and an assertion that a call is gone would otherwise match
 * the explanation of its removal.
 */
function code(fn: string): string {
  return source(fn)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

/** One top-level declaration, from its first line up to the next one. */
function fnBody(src: string, declaration: string): string {
  const start = src.indexOf(declaration);
  expect(start, declaration).toBeGreaterThan(-1);
  const rest = src.slice(start + declaration.length);
  const next = rest.search(/\n(?:async function |function |const |Deno\.serve\()/);
  return declaration + (next === -1 ? rest : rest.slice(0, next));
}

/** From `marker` to the brace that closes the block it opens. */
function block(src: string, marker: string): string {
  const start = src.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') depth -= 1;
    if (depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced block after ${marker}`);
}

function count(src: string, needle: string | RegExp): number {
  if (typeof needle === 'string') return src.split(needle).length - 1;
  return (src.match(new RegExp(needle.source, 'g')) ?? []).length;
}

describe('payment functions talk to Moyasar only', () => {
  it.each(PAYMENT_FUNCTIONS)('%s imports no Tap or Geidea module', (fn) => {
    expect(code(fn)).not.toMatch(/_shared\/(?:tap|tapVerify|tapRefund|geidea)\.ts/);
  });

  it.each(PAYMENT_FUNCTIONS)('%s calls no Tap or Geidea API', (fn) => {
    const src = code(fn);
    expect(src).not.toMatch(/api\.tap\.company|geidea/i);
    expect(src).not.toMatch(/resolveTapConfig|validateAndConfirmTapCharge|retrieveTapCharge/);
  });
});

describe('payment-initiate', () => {
  const src = code('payment-initiate');
  const handler = fnBody(src, 'Deno.serve(');

  it('answers {status: disabled} for a provider other than Moyasar, in both flows', () => {
    for (const fn of ['async function initiateMoyasar(', 'async function initiateMoyasarForSession(']) {
      expect(fnBody(src, fn)).toContain(
        "if (m.reason === 'disabled' || m.reason === 'not_moyasar') return json({ status: 'disabled' }, 200);",
      );
    }
    // A missing payment row gets the same answer instead of a null dereference.
    expect(count(handler, /if \(!cfg0?\) return json\(\{ status: 'disabled' \}, 200\);/)).toBe(2);
    expect(src).not.toContain('Online payment is not enabled');
  });

  it('sends every configuration down the Moyasar path, choosing nothing by provider name', () => {
    expect(handler).toContain('return await initiateMoyasarForSession(admin0, supaUser, sessionId, cfg0);');
    expect(handler).toContain('return await initiateMoyasar(admin, order, cfg);');
    expect(handler).not.toMatch(/providerName|sessionProvider/);
    expect(src).not.toMatch(/guardCrossProviderAttempt|decideCrossProviderAttempt|provider_switched/);
  });

  it('keeps the ownership gate ahead of any service-role work in the session flow', () => {
    const gate = handler.indexOf("if (!owned) return json({ error: 'Checkout session not found' }, 404);");
    expect(gate).toBeGreaterThan(-1);
    expect(handler.indexOf('adminClient()')).toBeGreaterThan(gate);
  });

  // The native app reaches customers only through an EAS build, so these keys
  // are a contract with every installed copy: status, orderId, checkoutUrl,
  // needsVerify, mode and checkoutSessionId (CheckoutScreen.tsx reads them).
  it('keeps the response keys the shipped app reads', () => {
    expect(src).toContain("return json({ status: 'already_paid', orderId }, 200);");
    expect(src).toContain("return json({ status: 'already_paid', orderId: session.order_id }, 200);");
    expect(src).toContain("provider: 'moyasar', mode: m.mode, invoiceId, checkoutUrl,");
    expect(src).toContain("...(outcome === 'pending' ? {} : { needsVerify: true }),");
    expect(src).toContain('checkoutUrl: attempt.checkout_url, checkoutSessionId: session.id,');
    expect(src).toContain('extra: { checkoutSessionId: session.id },');
  });
});

// A TEST-mode payment must never pay for a real customer's order. Moyasar's
// published test cards settle a test invoice through exactly the path a live
// one takes, so with online payment on in TEST mode they would confirm a real
// order and send it to the kitchen. Customer checkout is refused twice: on the
// configured mode before an attempt is opened, and on the attempt's STORED mode
// after begin_*_attempt, because a reused attempt can predate a switch to live.
describe('payment-initiate refuses customer checkout in TEST mode', () => {
  const src = code('payment-initiate');
  const flows = [
    { flow: 'order', fn: 'async function initiateMoyasar(', begin: "admin.rpc('begin_payment_attempt'" },
    {
      flow: 'session',
      fn: 'async function initiateMoyasarForSession(',
      begin: "admin.rpc('begin_session_attempt'",
    },
  ] as const;

  it.each(flows)(
    '$flow flow: checks the configured mode before an attempt is opened',
    ({ flow, fn, begin }) => {
      const body = fnBody(src, fn);
      const check = body.indexOf(
        `if (m.mode !== 'live') return refuseTestModeCheckout('${flow}', 'configured');`,
      );
      expect(check).toBeGreaterThan(body.indexOf('const m = resolveMoyasarConfig('));
      expect(check).toBeLessThan(body.indexOf(begin));
    },
  );

  it.each(flows)(
    "$flow flow: checks the attempt's stored mode before any invoice is handed out",
    ({ flow, fn, begin }) => {
      const body = fnBody(src, fn);
      const check = body.indexOf(
        `if (attempt.mode !== 'live') return refuseTestModeCheckout('${flow}', 'attempt');`,
      );
      expect(check).toBeGreaterThan(body.indexOf(begin));
      expect(check).toBeLessThan(
        body.indexOf('if (attempt.reused && attempt.checkout_url && attempt.provider_checkout_ref)'),
      );
      expect(check).toBeLessThan(body.indexOf('return await createMoyasarInvoice('));
    },
  );

  it('answers {status: disabled, reason: test_mode} and writes one JSON log line', () => {
    const refusal = fnBody(src, 'function refuseTestModeCheckout(');
    expect(refusal).toContain("return json({ status: 'disabled', reason: 'test_mode' }, 200);");
    expect(count(refusal, 'console.')).toBe(1);
    expect(refusal).toMatch(/console\.warn\(JSON\.stringify\(\{[^}]*reason: 'test_mode'/);
  });

  it('leaves no path to an invoice around the two checks', () => {
    expect(count(src, 'await createMoyasarInvoice(')).toBe(2);
    expect(count(src, "admin.rpc('begin_payment_attempt'")).toBe(1);
    expect(count(src, "admin.rpc('begin_session_attempt'")).toBe(1);
  });

  // Sandbox testing is the console's admin test, which never touches an order.
  it('leaves the admin sandbox test working in TEST mode', () => {
    const admin = code('payment-test-config');
    expect(admin).toContain(
      "if (mode !== 'test') return json({ ok: false, message: 'Admin test checkout is only available in TEST mode.' }, 200);",
    );
    expect(admin).toContain("resolveMoyasarConfig(true, 'moyasar', pub, sec, 'test')");
    expect(admin).not.toMatch(/refuseTestModeCheckout|payment-initiate/);
  });
});

describe('payment-verify', () => {
  const src = code('payment-verify');

  it('guards a missing payment row explicitly instead of asserting it away', () => {
    expect(src).not.toContain('cfg!');
    const orderFlow = fnBody(src, 'Deno.serve(');
    const sessionFlow = fnBody(src, 'async function verifySession(');
    for (const [body, call] of [
      [orderFlow, 'return await verifyMoyasarOrder(admin, cfg, orderId);'],
      [sessionFlow, 'return await verifyMoyasarSession(supaUser, admin, cfg, sessionId);'],
    ]) {
      const guard = body.indexOf("if (!cfg) return json({ status: 'pending' }, 200);");
      expect(guard, call).toBeGreaterThan(-1);
      expect(body.indexOf(call), call).toBeGreaterThan(guard);
    }
  });

  it('verifies the newest MOYASAR attempt, with the key for its stored mode', () => {
    expect(src).not.toMatch(/attemptProvider|unverifiableProvider|provider_not_configured/);
    expect(src).toContain(".eq(column, value).eq('provider', 'moyasar')");
    expect(count(src, "(rec.mode as 'test' | 'live') ?? undefined,")).toBe(2);
  });
});

describe('payment-webhook', () => {
  const src = code('payment-webhook');
  const handler = fnBody(src, 'Deno.serve(');

  it('acknowledges, and acts on nothing, when the configured provider is not Moyasar', () => {
    const gate = handler.indexOf("if (providerName !== 'moyasar') return json({ status: 'ignored'");
    expect(gate).toBeGreaterThan(-1);
    expect(handler.slice(gate)).toMatch(/^[^\n]*\}, 200\);/);
    expect(handler.indexOf('handleMoyasarWebhook(')).toBeGreaterThan(gate);
  });

  it('no longer chooses a handler from the shape of the body', () => {
    expect(src).not.toMatch(/looksLikeMoyasarWebhook|safeParse|provider_not_configured/);
  });

  it('still authenticates, filters, re-fetches and binds, in that order, before confirming', () => {
    const h = fnBody(src, 'async function handleMoyasarWebhook(');
    const steps = [
      'verifyWebhookSecretToken(evt.secretToken, m.webhookSecret)',
      'HANDLED_WEBHOOK_TYPES.has(evt.type)',
      'isAdminTestInvoice(payment)',
      'retrieveMoyasarPayment(mAttempt.secretKey, paymentId)',
      'validateAndConfirmMoyasarPayment(admin, rec, retrieved.body, { liveMode: evt.live })',
    ].map((step) => h.indexOf(step));
    for (const at of steps) expect(at).toBeGreaterThan(-1);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });
});

describe('payment-refund', () => {
  const src = code('payment-refund');

  it('runs only when Moyasar is the configured provider', () => {
    expect(src).toContain("if (configuredProvider !== 'moyasar') {");
    expect(src).not.toMatch(/'tap'/);
  });

  // Releasing such a row as 'pending' re-claims and releases it on every run,
  // for ever, and nobody ever sees it. 'failed' frees the one-live-refund slot
  // and puts it in front of a person via list_failed_order_refunds().
  it('finalizes a claimed refund for any other provider as failed instead of releasing it', () => {
    const marker = "if (rowProvider !== 'moyasar') {";
    const unsupported = block(src, marker);
    expect(unsupported).toContain("admin.rpc('finalize_order_refund', {");
    expect(unsupported).toContain('p_refund_id: row.refund_id, p_claim_token: claimToken,');
    expect(unsupported).toContain("p_status: 'failed'");
    expect(unsupported).toContain("p_failure_code: 'unsupported_provider'");
    expect(unsupported).toMatch(/continue;\s*\}$/);
    // Decided straight after the claim: before a key is chosen and before
    // anything is sent anywhere.
    const at = src.indexOf(marker);
    expect(at).toBeGreaterThan(src.indexOf('if (!row) break;'));
    expect(at).toBeLessThan(src.indexOf('resolveMoyasarConfig('));
    expect(at).toBeLessThan(src.indexOf('fetch('));
    expect(src).not.toContain('provider_switched');
  });

  it('keeps the lease fence, reconcile-before-post and review parking', () => {
    expect(src).toContain("admin.rpc('claim_order_refund', {");
    const reconcileFirst = src.indexOf('if (mustReconcileBeforePost(row.attempt_count)) {');
    const post = src.indexOf('await fetch(moyasarRefundUrl(moyasarRequest.paymentId), {');
    expect(reconcileFirst).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(reconcileFirst);
    expect(src).toContain('if (needsHumanReview(verdict)) {');
    expect(src).toContain('p_status: refundFinalStatus(verdict),');
    expect(src).toContain('const decision = decideRefundLogging(finalized, verdict.outcome);');
  });

  it('takes its two provider-neutral helpers from the Moyasar modules', () => {
    expect(src).toMatch(/import \{[^}]*\btimingSafeEqual\b[^}]*\} from '\.\.\/_shared\/moyasar\.ts';/);
    expect(src).toMatch(
      /import \{[^}]*\bdecideRefundLogging\b[^}]*\} from '\.\.\/_shared\/moyasarRefund\.ts';/,
    );
  });
});

describe('payment-test-config', () => {
  const src = code('payment-test-config');

  it('sends every action to the Moyasar handler', () => {
    expect(fnBody(src, 'Deno.serve(')).toMatch(/\n\s*return await handleMoyasar\(admin, payload, /);
    expect(src).not.toMatch(/if \(providerName === 'moyasar'\)/);
  });

  // The handler now answers for every configuration, so a hard-coded 'moyasar'
  // would tell the console Moyasar is selected when the row says otherwise.
  it('reports the configured provider in its status instead of assuming Moyasar', () => {
    expect(src).toContain("provider: (providerName ?? '').toLowerCase() || null,");
    expect(src).not.toContain("provider: 'moyasar',");
  });

  // The staff console deploys on every merge and must keep working against the
  // July bundle still live in Production as well as against this one.
  it('keeps the fields the staff console reads', () => {
    expect(src).toContain('return json({ ok: true, invoiceId, chargeId: invoiceId, checkoutUrl, mode: ');
    expect(src).toContain('const invoiceId = String(payload.invoiceId ?? payload.chargeId ??');
    expect(src).toContain("source_id: 'invoice',");
    expect(src).toContain('merchant_id_set: true,');
  });
});

// The admin sandbox invoice returns to this page (success_url AND back_url), so
// despite its old tap-admin-test-return name it was never Tap-only: deleting it
// would land the admin on a 404 after paying the test invoice.
describe('payment-admin-test-return', () => {
  // Read lazily, so a missing page fails these cases rather than the whole file.
  const page = () => source('payment-admin-test-return');
  const html = () => {
    const src = page();
    return src.slice(src.indexOf('const PAGE_HTML = `'), src.indexOf('</html>`;'));
  };

  it('is where the admin sandbox invoice sends the browser back to', () => {
    const admin = code('payment-test-config');
    expect(admin).toContain('successUrl: `${supabaseUrl}/functions/v1/payment-admin-test-return`,');
    expect(admin).toContain('backUrl: `${supabaseUrl}/functions/v1/payment-admin-test-return`,');
    expect(admin).not.toContain('tap-admin-test-return');
  });

  it('is registered with JWT verification off, under its new name only', () => {
    const config = readFileSync(new URL('../../config.toml', import.meta.url), 'utf8');
    expect(config).toMatch(/\[functions\.payment-admin-test-return\]\s*\nverify_jwt = false/);
    expect(config).not.toContain('[functions.tap-admin-test-return]');
    expect(existsSync(new URL('../tap-admin-test-return/index.ts', import.meta.url))).toBe(false);
  });

  it('marks nothing: no database client, no provider call, nothing read from the URL', () => {
    expect(code('payment-admin-test-return')).not.toMatch(
      /adminClient|userClient|supabaseClient|\.rpc\(|fetch\(|searchParams|req\.url/,
    );
  });

  it('keeps the cased content type that stops the platform serving it as plain text', () => {
    expect(page()).toContain("'Content-Type': 'text/HTML; charset=utf-8'");
    expect(page()).toContain('new TextEncoder().encode(PAGE_HTML)');
    expect(html()).toContain('<meta charset="utf-8" />');
  });

  it('names no provider, and says the same thing in both languages', () => {
    expect(html()).not.toMatch(/\btap\b|moyasar/i);
    expect(html()).toContain('Test checkout complete');
    expect(html()).toMatch(/lang="ar" dir="rtl"[\s\S]*[\u0600-\u06FF]/);
  });
});
