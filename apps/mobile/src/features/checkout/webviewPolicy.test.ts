import { describe, expect, it } from 'vitest';

import { decideNavigation, safeHostForLog, type WebviewNavConfig } from './webviewPolicy';

const SESSION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const RETURN_HOST = 'wxfmmnihidsdyemasstf.supabase.co';
const RETURN_URL = `https://${RETURN_HOST}/functions/v1/payment-return`;

const cfg: WebviewNavConfig = {
  returnHost: RETURN_HOST,
  returnPath: '/functions/v1/payment-return',
};

/** The shape of Moyasar's own example (docs.moyasar.com/api/invoices/01-create-invoice). */
const INVOICE_URL = 'https://checkout.moyasar.com/invoices/efebc231-7795-4cfd-b69c-980fe4c02c49?lang=en';

describe('decideNavigation — allow (Moyasar hosted page and 3-D Secure)', () => {
  it('allows the hosted invoice page on checkout.moyasar.com', () => {
    expect(decideNavigation(INVOICE_URL, cfg)).toEqual({ decision: 'allow', reason: 'https' });
  });
  it('allows the 3-D Secure hop on api.moyasar.com', () => {
    const url = 'https://api.moyasar.com/v1/transaction_auths/4f6c1a2e-6d1b-4b3e-9b6f-2a1d3c4e5f60/form?token=auth_x';
    expect(decideNavigation(url, cfg).decision).toBe('allow');
  });
  it('allows the issuing bank’s challenge page, which no list could name in advance', () => {
    expect(decideNavigation('https://acs.issuer-bank.example/3ds2/challenge?txn=1', cfg).decision).toBe('allow');
    expect(decideNavigation('https://secure5.arcot-acs.example/acspage/cap?RID=1', cfg).decision).toBe('allow');
  });
  it('allows inert about:blank / about:srcdoc (3DS iframes)', () => {
    expect(decideNavigation('about:blank', cfg).decision).toBe('allow');
    expect(decideNavigation('about:srcdoc', cfg).decision).toBe('allow');
  });
});

describe('decideNavigation — complete (our return reached, never trusted)', () => {
  it('completes on success_url carrying Moyasar’s appended params, and reads only the session', () => {
    const r = decideNavigation(`${RETURN_URL}?session=${SESSION}&id=pay_79cced57&status=paid&message=APPROVED`, cfg);
    expect(r).toEqual({ decision: 'complete', session: SESSION, reason: 'payment-return-url' });
  });
  it('still completes when an append mangles the query (a second "?")', () => {
    const r = decideNavigation(`${RETURN_URL}?session=${SESSION}?id=pay_79cced57&status=paid`, cfg);
    // The session no longer parses as a UUID, so none is reported; the app
    // verifies with the session id it already holds.
    expect(r.decision).toBe('complete');
    expect(r.session).toBeUndefined();
  });
  it('completes on the spicymeal:// deep link (matched on raw string)', () => {
    const r = decideNavigation(`spicymeal://payment/return?session=${SESSION}`, cfg);
    expect(r).toEqual({ decision: 'complete', session: SESSION, reason: 'app-return-deeplink' });
    expect(decideNavigation('spicymeal://payment/return', cfg).decision).toBe('complete');
  });
  it('completes even with no/invalid session (server verify still uses the known id)', () => {
    expect(decideNavigation(RETURN_URL, cfg)).toEqual({ decision: 'complete', session: undefined, reason: 'payment-return-url' });
    expect(decideNavigation(`${RETURN_URL}?session=not-a-uuid`, cfg).session).toBeUndefined();
  });
  it('does NOT trust success/failure query params — the decision is the URL, not its status', () => {
    const ok = decideNavigation(`${RETURN_URL}?session=${SESSION}&status=paid`, cfg);
    const bad = decideNavigation(`${RETURN_URL}?session=${SESSION}&status=failed`, cfg);
    expect(bad).toEqual(ok); // identical — the app asks the server, not the URL
  });
});

describe('decideNavigation — look-alikes of our return are NOT our return', () => {
  // Each of these is "just another https page": it loads, but it never closes
  // the WebView or reports a session, because the host or path is not ours.
  it.each([
    ['our host as a prefix of another domain', `https://${RETURN_HOST}.evil.example/functions/v1/payment-return?session=${SESSION}`],
    ['our path on another host', `https://evil.example/functions/v1/payment-return?session=${SESSION}`],
    ['our host as userinfo', `https://${RETURN_HOST}@evil.example/functions/v1/payment-return?session=${SESSION}`],
    ['our host with a longer first label', `https://x${RETURN_HOST}/functions/v1/payment-return?session=${SESSION}`],
    ['a longer path segment on our host', `https://${RETURN_HOST}/functions/v1/payment-return-evil?session=${SESSION}`],
  ])('%s', (_label, url) => {
    expect(decideNavigation(url, cfg)).toEqual({ decision: 'allow', reason: 'https' });
  });
  it('blocks other spicymeal:// paths, including ones that only start like the return', () => {
    expect(decideNavigation(`spicymeal://payment/returns?session=${SESSION}`, cfg).decision).toBe('block');
    expect(decideNavigation('spicymeal://payment/return-evil', cfg).decision).toBe('block');
    expect(decideNavigation('spicymeal://somewhere-else', cfg).decision).toBe('block');
  });
});

describe('decideNavigation — block (only https ever loads)', () => {
  it('blocks an http downgrade of the hosted page (Moyasar’s own docs example uses http://)', () => {
    expect(decideNavigation(INVOICE_URL.replace('https:', 'http:'), cfg)).toEqual({
      decision: 'block',
      reason: 'blocked-scheme:http',
    });
  });
  it('never completes over http, even on our own host', () => {
    expect(decideNavigation(`http://${RETURN_HOST}/functions/v1/payment-return?session=${SESSION}`, cfg).decision).toBe('block');
  });
  it('blocks javascript:', () => {
    expect(decideNavigation('javascript:alert(document.cookie)', cfg)).toEqual({
      decision: 'block',
      reason: 'blocked-scheme:javascript',
    });
  });
  it('blocks data:, blob:, file: and intent:', () => {
    expect(decideNavigation('data:text/html,<h1>x</h1>', cfg).decision).toBe('block');
    expect(decideNavigation('blob:https://checkout.moyasar.com/9b1c', cfg).decision).toBe('block');
    expect(decideNavigation('file:///etc/passwd', cfg).decision).toBe('block');
    expect(decideNavigation('intent://pay#Intent;scheme=stcpay;end', cfg).decision).toBe('block');
  });
  it('blocks other apps’ schemes, so a page can never hand the customer to another app', () => {
    for (const url of ['tel:123', 'mailto:x@example.com', 'stcpay://pay?x=1', 'whatsapp://send?text=x', 'itms-apps://x']) {
      expect(decideNavigation(url, cfg).decision, url).toBe('block');
    }
  });
  it('blocks unparseable urls', () => {
    expect(decideNavigation('not a url', cfg)).toEqual({ decision: 'block', reason: 'unparseable-url' });
  });
});

describe('safeHostForLog', () => {
  it('returns only the hostname — never path, query or token', () => {
    expect(safeHostForLog(`${INVOICE_URL}&token=secret`)).toBe('checkout.moyasar.com');
  });
  it('masks the app deep link and unparseable input', () => {
    expect(safeHostForLog('spicymeal://payment/return?session=x')).toBe('spicymeal://(app)');
    expect(safeHostForLog('%%%')).toBe('(unparseable)');
  });
});
