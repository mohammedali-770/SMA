import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
  return stripComments(source(fn));
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

/** Every deployable source file under supabase/functions, keyed by its path there. */
function functionSources(): Map<string, string> {
  const root = new URL('../', import.meta.url);
  const out = new Map<string, string>();
  const walk = (dir: URL, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const at = new URL(name, dir);
      if (statSync(at).isDirectory()) {
        if (name !== '__fixtures__') walk(new URL(`${name}/`, dir), `${prefix}${name}/`);
      } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
        out.set(`${prefix}${name}`, readFileSync(at, 'utf8'));
      }
    }
  };
  walk(root, '');
  return out;
}

/** One top-level declaration, from its first line up to the next one. */
function fnBody(src: string, declaration: string): string {
  const start = src.indexOf(declaration);
  expect(start, declaration).toBeGreaterThan(-1);
  const rest = src.slice(start + declaration.length);
  const next = rest.search(/\n(?:async function |function |const |Deno\.serve\()/);
  return declaration + (next === -1 ? rest : rest.slice(0, next));
}

/** From `from` up to `to`: one exported function, whose signature may hold braces. */
function section(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + from.length);
  expect(start, from).toBeGreaterThan(-1);
  expect(end, to).toBeGreaterThan(start);
  return src.slice(start, end);
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

// Moyasar LIVE refuses a secret-key call from any address not on the
// account's Allowed IPs list, and Supabase Edge Functions have no static
// outbound IP, so every call has to be able to go through MOYASAR_PROXY_URL.
// One call that bypasses moyasarFetch would work in TEST and fail in LIVE.
describe('every Moyasar request goes through moyasarFetch', () => {
  const ENDPOINT = /MOYASAR_API_BASE|api\.moyasar\.com|moyasarPaymentUrl\(|moyasarRefundUrl\(|MOYASAR_INVOICES/;
  const RAW_FETCH = /(?<![\w$.])fetch\s*\(|\b(?:globalThis|self|window)\s*\.\s*fetch\b/;
  const sources = functionSources();

  it('leaves no raw fetch in any file that names a Moyasar endpoint', () => {
    const naming = [...sources].filter(([, src]) => ENDPOINT.test(stripComments(src)));
    expect(naming.map(([path]) => path).sort()).toEqual([
      '_shared/moyasar.ts',
      '_shared/moyasarRefund.ts',
      '_shared/moyasarVerify.ts',
      'payment-initiate/index.ts',
      'payment-refund/index.ts',
      'payment-test-config/index.ts',
    ]);
    for (const [path, src] of naming) expect(stripComments(src), path).not.toMatch(RAW_FETCH);
  });

  it('sends each call site through the helper', () => {
    const calls = (path: string) => count(stripComments(sources.get(path) ?? ''), 'moyasarFetch(');
    expect(calls('_shared/moyasarVerify.ts')).toBe(1); // every invoice and payment GET, and the list
    expect(calls('payment-initiate/index.ts')).toBe(1); // invoice create
    expect(calls('payment-refund/index.ts')).toBe(2); // reconcile GET, refund POST
    expect(calls('payment-test-config/index.ts')).toBe(2); // test_connection, test_checkout
    // The webhook's re-fetch is retrieveMoyasarPayment, so it fetches nothing itself.
    expect(code('payment-webhook')).not.toMatch(RAW_FETCH);
  });

  it('keeps the only raw fetch inside moyasarHttp.ts', () => {
    const http = stripComments(sources.get('_shared/moyasarHttp.ts') ?? '');
    expect(count(http, RAW_FETCH)).toBe(2); // direct, and through the proxy client
    expect(http).toContain('res = await fetch(input, { ...init, client });');
  });

  it('reports a failed GET as a value instead of throwing it at the caller', () => {
    const verify = stripComments(sources.get('_shared/moyasarVerify.ts') ?? '');
    const get = block(verify, 'async function moyasarGet(');
    expect(get).toMatch(/\} catch \(e\) \{[\s\S]*return \{ ok: false, status: 0, body: \{\} \};/);
    expect(
      section(verify, 'export async function verifyMoyasarAttempt(', 'export interface InvoiceLookupResult'),
    ).toContain('isMoyasarIpNotAllowed(retrieved.status, retrieved.body) ? { reason: MOYASAR_IP_NOT_ALLOWED } : {}');
  });
});

// An administrator told "the key was rejected" goes and replaces a key that is
// fine. Every admin action that reaches Moyasar names the Allowed IPs refusal.
describe('payment-test-config names an Allowed IPs refusal', () => {
  const src = code('payment-test-config');

  it('tells test_connection\'s refused address apart from a rejected key', () => {
    const named = src.indexOf('if (isMoyasarIpNotAllowed(resp.status, refusal)) return json({ ok: false, message: ipNotAllowedMessage(mode) }, 200);');
    expect(named).toBeGreaterThan(-1);
    expect(named).toBeLessThan(src.indexOf('secret key was rejected by Moyasar (unauthorized).'));
  });

  it('says it in every action that calls Moyasar', () => {
    expect(src).toContain('if (result.reason === MOYASAR_IP_NOT_ALLOWED) {'); // verify_order
    expect(count(src, 'isMoyasarIpNotAllowed(resp.status, result)')).toBe(1); // test_checkout
    expect(count(src, 'isMoyasarIpNotAllowed(retrieved.status, retrieved.body)')).toBe(1); // test_checkout_result
    expect(count(src, 'ipNotAllowedMessage(')).toBe(5); // the four, plus its definition
  });

  it('reports an unusable MOYASAR_PROXY_URL instead of a generic network error', () => {
    expect(src).toContain('return e instanceof MoyasarProxyError ? e.message : ');
    expect(count(src, 'message: unreachableMessage(e)')).toBe(2);
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
    expect(handler).toContain('return await initiateMoyasarForSession(admin0, supaUser, sessionId, cfg0, lang);');
    expect(handler).toContain('return await initiateMoyasar(admin, order, cfg, lang);');
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
    expect(src).toContain('checkoutUrl, checkoutSessionId: session.id,');
    expect(src).toContain('extra: { checkoutSessionId: session.id },');
  });
});

// The app opens whatever URL payment-initiate returns, in a WebView or the
// system browser. A created, reconciled or reused attempt all hand one out, so
// each goes through customerCheckoutUrl, which allows only https on Moyasar's
// domain and sets the page's language.
describe('payment-initiate hands the app only a Moyasar checkout URL', () => {
  const src = code('payment-initiate');
  const handler = fnBody(src, 'Deno.serve(');
  const create = fnBody(src, 'async function createMoyasarInvoice(');

  it('checks the created or reconciled invoice URL before storing anything', () => {
    const check = create.indexOf('const checkoutUrl = customerCheckoutUrl(invoiceUrl, params.lang);');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(create.indexOf('provider_checkout_ref: invoiceId,'));
    const refused = block(create, 'if (!checkoutUrl) {');
    expect(refused).toContain("status: 'failed', failure_code: 'checkout_url_rejected'");
    expect(refused).toContain("return refuseCheckoutUrl(invoiceUrl, 'created');");
    // The reconcile path adopts an invoice through the same function.
    expect(count(create, 'return await persistAndReturn(')).toBe(3);
  });

  it('checks a reused URL too, and never hands out a stored one as it is', () => {
    for (const fn of ['async function initiateMoyasar(', 'async function initiateMoyasarForSession(']) {
      const reuse = block(fnBody(src, fn), 'if (attempt.reused && attempt.checkout_url && attempt.provider_checkout_ref) {');
      expect(reuse, fn).toContain('const checkoutUrl = customerCheckoutUrl(attempt.checkout_url, lang);');
      expect(reuse, fn).toContain("if (!checkoutUrl) return refuseCheckoutUrl(attempt.checkout_url, 'reused');");
    }
    expect(src).not.toMatch(/checkoutUrl: (?:attempt\.checkout_url|invoiceUrl|String\()/);
    expect(count(src, 'customerCheckoutUrl(')).toBe(3);
  });

  it('fails closed with a 502 and one log line naming only the scheme and host', () => {
    const refuse = fnBody(src, 'function refuseCheckoutUrl(');
    expect(refuse).toContain("return json({ error: 'Could not start the payment. Please try again.' }, 502);");
    expect(count(refuse, 'console.')).toBe(1);
    expect(refuse).toMatch(/console\.error\(JSON\.stringify\(\{ event: 'payment_initiate_refused', reason: 'checkout_url_rejected', attempt, scheme, host \}\)\)/);
  });

  it("takes the page's language from the request, defaulting to English", () => {
    expect(handler).toContain("const lang: CheckoutLanguage = body.language === 'ar' ? 'ar' : 'en';");
    expect(handler).toContain('return await initiateMoyasarForSession(admin0, supaUser, sessionId, cfg0, lang);');
    expect(handler).toContain('return await initiateMoyasar(admin, order, cfg, lang);');
    expect(count(src, '    lang,\n  });')).toBe(2);
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

// Moyasar's sandbox settles a test invoice exactly as live settles a real one,
// so the binding matches and a published test card could mark a real order
// paid. payment-initiate refuses to open such an attempt; this is the second
// line, in the one function every confirmation passes through.
describe('a TEST-mode attempt never confirms an order', () => {
  const verify = stripComments(readFileSync(new URL('./moyasarVerify.ts', import.meta.url), 'utf8'));
  const confirm = section(
    verify,
    'export async function validateAndConfirmMoyasarPayment(',
    'export async function verifyMoyasarAttempt(',
  );
  const paid = block(confirm, "if (outcome === 'paid' && allMatch) {");

  it('refuses before the payment id is stamped and before either confirmation RPC', () => {
    const refusal = paid.indexOf("if (attempt.mode !== 'live') {");
    expect(refusal).toBeGreaterThan(-1);
    for (const step of [
      "admin.rpc('finalize_checkout_session'",
      '.update({ provider_ref: paymentId })',
      "admin.rpc('confirm_order_payment'",
      'triggerLazywaitSyncOnce(admin)',
    ]) {
      expect(paid.indexOf(step), step).toBeGreaterThan(refusal);
    }
    const refused = block(paid, "if (attempt.mode !== 'live') {");
    expect(refused).toContain("return { outcome: 'failed', paid: false, reason: 'test_mode_attempt' };");
    expect(refused).toContain("status: 'failed', failure_code: 'test_mode_attempt',");
    expect(count(refused, 'console.')).toBe(1);
    expect(refused).not.toMatch(/\.rpc\(/);
  });

  it('leaves no second way to a confirmation', () => {
    expect(count(verify, "admin.rpc('finalize_checkout_session'")).toBe(1);
    expect(count(verify, "admin.rpc('confirm_order_payment'")).toBe(1);
    for (const fn of ['payment-verify', 'payment-webhook', 'payment-test-config']) {
      expect(code(fn), fn).not.toMatch(/confirm_order_payment|finalize_checkout_session/);
    }
  });

  it('never reports the refusal as a success', () => {
    expect(
      section(verify, 'export async function verifyMoyasarAttempt(', 'export interface InvoiceLookupResult'),
    ).toContain('messageKey: confirmMessageKey(payment.status, result.paid)');
    expect(code('payment-test-config')).toContain("if (result.reason === 'test_mode_attempt') {");
  });

  // The admin sandbox test is a separate path, and must keep working in TEST.
  it('leaves the admin sandbox result path alone', () => {
    const result = block(code('payment-test-config'), "if (payload.action === 'test_checkout_result') {");
    expect(result).toContain('retrieveMoyasarInvoice(m.secretKey, invoiceId)');
    expect(result).toContain('if (!isAdminTestInvoice(invoice))');
    expect(result).not.toMatch(/verifyMoyasarAttempt|validateAndConfirm/);
  });
});

// An expired or cancelled invoice with nothing settled can never be paid. Read
// as 'pending', it kept the app resuming a dead page and refusing every new
// order, cash included, because recovery runs before either branch.
describe('verifyMoyasarAttempt closes an invoice Moyasar has closed', () => {
  const verify = stripComments(readFileSync(new URL('./moyasarVerify.ts', import.meta.url), 'utf8'));
  const fn = section(verify, 'export async function verifyMoyasarAttempt(', 'export interface InvoiceLookupResult');

  it('decides it once the invoice is read, before the "not paid yet" answer and any confirmation', () => {
    const decided = fn.indexOf('const closed = closedInvoiceOutcome(invoice);');
    expect(decided).toBeGreaterThan(fn.indexOf('if (!retrieved.ok) {'));
    expect(decided).toBeLessThan(fn.indexOf('const payment = selectInvoicePayment(invoice);'));
    expect(decided).toBeLessThan(fn.indexOf('await validateAndConfirmMoyasarPayment(admin, attempt, payment)'));
  });

  it('closes the attempt, never a paid one, and answers with the closed outcome', () => {
    const closed = block(fn, 'if (closed) {');
    expect(closed).toContain("status: 'failed', failure_code: closed.failureCode,");
    expect(closed).toContain(".eq('id', attempt.id).neq('status', 'paid')");
    expect(closed).toContain('return { outcome: closed.outcome, paid: false, messageKey: closed.messageKey };');
    expect(closed).not.toMatch(/\.rpc\(/);
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

  // Moyasar sends the verification code once and never retries it, so it is
  // recorded even while the payment row is switched off, and before anything
  // on the payment path can acknowledge it and drop it.
  it('records a webhook verification before the enabled check and the payment path', () => {
    const verification = handler.indexOf(
      'if (evt.type === WEBHOOK_VERIFICATION_TYPE) return await recordWebhookVerification(admin, cfg, evt);',
    );
    expect(verification).toBeGreaterThan(handler.indexOf("if (providerName !== 'moyasar')"));
    expect(verification).toBeLessThan(handler.indexOf("if (!cfg.enabled) return json({ status: 'ignored'"));
    expect(count(handler, 'cfg.enabled')).toBe(1);
    expect(verification).toBeLessThan(handler.indexOf('return await handleMoyasarWebhook(admin, cfg, rawBody);'));
  });

  it('answers 401 and writes nothing on a token mismatch, and never touches a payment', () => {
    const v = fnBody(src, 'async function recordWebhookVerification(');
    const check = v.indexOf('if (!matchesAnyWebhookSecret(evt.secretToken, cfg.secretConfig)) {');
    const insert = v.indexOf(".from('integration_sync_logs').insert(webhookVerificationLogRow(evt))");
    expect(check).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(check);
    expect(v.slice(check, insert)).toContain("return json({ error: 'invalid secret token' }, 401);");
    expect(count(v, '.insert(')).toBe(1);
    expect(v).toContain("return json({ status: 'acknowledged', reason: WEBHOOK_VERIFICATION_TYPE }, 200);");
    expect(v).not.toMatch(/retrieveMoyasar|validateAndConfirm|\.rpc\(|payment_records|fetch\(/);
  });

  it('keeps the verification code out of every log line and out of the response', () => {
    const v = fnBody(src, 'async function recordWebhookVerification(');
    const said = v.split('\n').filter((line) => /console\.|return json\(/.test(line));
    expect(said.length).toBeGreaterThan(2);
    for (const line of said) expect(line).not.toMatch(/verification_code|evt\.data|evt\b(?!\.secretToken)/);
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
    expect(at).toBeLessThan(src.indexOf('moyasarFetch('));
    expect(src).not.toContain('provider_switched');
  });

  it('keeps the lease fence, reconcile-before-post and review parking', () => {
    expect(src).toContain("admin.rpc('claim_order_refund', {");
    const reconcileFirst = src.indexOf('if (mustReconcileBeforePost(row.attempt_count)) {');
    const post = src.indexOf('await moyasarFetch(moyasarRefundUrl(moyasarRequest.paymentId), {');
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
  // test_checkout forces 'moyasar' into the resolver to pick the TEST key, so
  // without its own check any enabled payment row would run a Moyasar invoice.
  it('runs test_checkout only when the configured provider is Moyasar', () => {
    const checkout = block(src, "if (payload.action === 'test_checkout') {");
    const gate = checkout.indexOf("if ((providerName ?? '').toLowerCase() !== 'moyasar') {");
    expect(gate).toBeGreaterThan(-1);
    expect(block(checkout, "if ((providerName ?? '').toLowerCase() !== 'moyasar') {")).toContain(
      "return json({ ok: false, message: \"Set the payment provider to 'moyasar' first.\" }, 200);",
    );
    expect(gate).toBeLessThan(checkout.indexOf("resolveMoyasarConfig(true, 'moyasar', pub, sec, 'test')"));
    expect(gate).toBeLessThan(checkout.indexOf('moyasarFetch('));
  });

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
