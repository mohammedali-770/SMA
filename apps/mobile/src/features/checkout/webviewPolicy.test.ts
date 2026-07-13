import { describe, expect, it } from 'vitest';

import { decideNavigation, safeHostForLog, type WebviewNavConfig } from './webviewPolicy';

const SESSION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const cfg: WebviewNavConfig = {
  checkoutHost: 'checkout.tap.company',
  returnHost: 'wxfmmnihidsdyemasstf.supabase.co',
  returnPath: '/functions/v1/payment-return',
};

describe('decideNavigation — allow (Tap ecosystem)', () => {
  it('allows the exact server-supplied checkout host', () => {
    expect(decideNavigation('https://checkout.tap.company/pay/abc123', cfg).decision).toBe('allow');
  });
  it('allows any *.tap.company subdomain (Tap-hosted 3DS in TEST mode)', () => {
    expect(decideNavigation('https://sandbox.payments.tap.company/3ds', cfg).decision).toBe('allow');
  });
  it('allows the tap.company apex and other Tap registrable domains', () => {
    expect(decideNavigation('https://tap.company/x', cfg).decision).toBe('allow');
    expect(decideNavigation('https://foo.gosell.io/y', cfg).decision).toBe('allow');
    expect(decideNavigation('https://api.gosellapi.com/z', cfg).decision).toBe('allow');
  });
  it('allows a server-supplied checkout host even outside TAP_DOMAINS', () => {
    const custom = { ...cfg, checkoutHost: 'secure.paytabs-tap.example' };
    expect(decideNavigation('https://secure.paytabs-tap.example/pay', custom).decision).toBe('allow');
  });
  it('allows inert about:blank / about:srcdoc (3DS iframes)', () => {
    expect(decideNavigation('about:blank', cfg).decision).toBe('allow');
    expect(decideNavigation('about:srcdoc', cfg).decision).toBe('allow');
  });
});

describe('decideNavigation — block (hard security wall)', () => {
  it('blocks an arbitrary external https host', () => {
    const r = decideNavigation('https://evil.example.com/phish', cfg);
    expect(r.decision).toBe('block');
    expect(r.reason).toBe('external-host');
  });
  it('blocks a look-alike host that only ends with the brand as a substring', () => {
    // nottap.company !== tap.company and does not end with ".tap.company"
    expect(decideNavigation('https://nottap.company/x', cfg).decision).toBe('block');
    expect(decideNavigation('https://tap.company.evil.com/x', cfg).decision).toBe('block');
  });
  it('blocks non-https schemes: http, javascript, file, data, blob', () => {
    expect(decideNavigation('http://checkout.tap.company/x', cfg).decision).toBe('block');
    expect(decideNavigation('javascript:alert(1)', cfg).decision).toBe('block');
    expect(decideNavigation('file:///etc/passwd', cfg).decision).toBe('block');
    expect(decideNavigation('data:text/html,<h1>x</h1>', cfg).decision).toBe('block');
    expect(decideNavigation('blob:https://checkout.tap.company/uuid', cfg).decision).toBe('block');
  });
  it('blocks an unknown app scheme and unparseable urls', () => {
    expect(decideNavigation('spicymeal://somewhere-else', cfg).decision).toBe('block');
    expect(decideNavigation('not a url', cfg).decision).toBe('block');
  });
  it('does NOT treat the return path as a prefix of a look-alike path', () => {
    const r = decideNavigation(`https://${cfg.returnHost}/functions/v1/payment-return-evil?session=${SESSION}`, cfg);
    expect(r.decision).toBe('block');
  });
});

describe('decideNavigation — complete (return reached, never trusted)', () => {
  it('completes on the https payment-return url and extracts a valid session', () => {
    const r = decideNavigation(`https://${cfg.returnHost}/functions/v1/payment-return?session=${SESSION}&tap_id=chg_x&status=CAPTURED`, cfg);
    expect(r.decision).toBe('complete');
    expect(r.session).toBe(SESSION);
  });
  it('completes on the spicymeal:// deep link (matched on raw string)', () => {
    const r = decideNavigation(`spicymeal://payment/return?session=${SESSION}`, cfg);
    expect(r.decision).toBe('complete');
    expect(r.session).toBe(SESSION);
  });
  it('completes even with no/invalid session (server verify still uses the known id)', () => {
    expect(decideNavigation(`https://${cfg.returnHost}/functions/v1/payment-return`, cfg).session).toBeUndefined();
    expect(decideNavigation(`https://${cfg.returnHost}/functions/v1/payment-return?session=not-a-uuid`, cfg).session).toBeUndefined();
    expect(decideNavigation(`https://${cfg.returnHost}/functions/v1/payment-return`, cfg).decision).toBe('complete');
  });
  it('does NOT trust success/failure query params — decision is purely the URL, not its status', () => {
    const ok = decideNavigation(`https://${cfg.returnHost}/functions/v1/payment-return?session=${SESSION}&status=CAPTURED`, cfg);
    const bad = decideNavigation(`https://${cfg.returnHost}/functions/v1/payment-return?session=${SESSION}&status=DECLINED`, cfg);
    expect(ok.decision).toBe('complete');
    expect(bad.decision).toBe('complete'); // identical — the app asks the server, not the URL
  });
});

describe('safeHostForLog', () => {
  it('returns only the hostname — never path, query or token', () => {
    expect(safeHostForLog(`https://checkout.tap.company/pay/secret-token?x=1`)).toBe('checkout.tap.company');
  });
  it('masks the app deep link and unparseable input', () => {
    expect(safeHostForLog('spicymeal://payment/return?session=x')).toBe('spicymeal://(app)');
    expect(safeHostForLog('%%%')).toBe('(unparseable)');
  });
});
