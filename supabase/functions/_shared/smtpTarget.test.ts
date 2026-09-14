import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  isAllowedSmtpHost,
  parseSmtpTarget,
  SMTP_HOST_INVALID,
  SMTP_HOST_NOT_ALLOWED,
  SMTP_HOST_NOT_ROUTABLE,
  SMTP_NOT_CONFIGURED,
  SMTP_PORT_INVALID,
} from './smtpTarget';

/** The shape of the row that is actually in Production, read 2026-09-14. */
const LIVE = {
  host: 'mail.spicymeal.com.sa',
  port: '465',
  secure: true,
  username: 'info@spicymeal.com.sa',
  from_name: 'Spicy Meal',
  from_email: 'info@spicymeal.com.sa',
};

describe('parseSmtpTarget', () => {
  it('accepts the endpoint that is configured today', () => {
    // The guard is worth nothing if it refuses the only real configuration; this
    // case is the live row, field for field.
    const t = parseSmtpTarget(LIVE);
    expect(t.reason).toBeNull();
    expect(t).toMatchObject({
      host: 'mail.spicymeal.com.sa',
      port: 465,
      tls: true,
      username: 'info@spicymeal.com.sa',
      fromEmail: 'info@spicymeal.com.sa',
      fromName: 'Spicy Meal',
    });
  });

  it('accepts a STARTTLS relay on 587, which denomailer upgrades itself', () => {
    // Refusing this would be the cost of a config-level TLS requirement, and is
    // why there is not one. See the header of smtpTarget.ts.
    const t = parseSmtpTarget({ ...LIVE, host: 'smtp.sendgrid.net', port: '587', secure: false });
    expect(t.reason).toBeNull();
    expect(t).toMatchObject({ port: 587, tls: false });
  });

  it('defaults the port to 587 when none is set', () => {
    const t = parseSmtpTarget({ ...LIVE, port: '' });
    expect(t).toMatchObject({ port: 587, reason: null });
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['the cloud metadata endpoint', '169.254.169.254'],
    ['private space', '10.0.0.5'],
    ['a decimal literal', '2130706433'],
    ['a hex literal', '0x7f000001'],
    ['a short-form literal', '127.1'],
    ['an octal literal', '0177.0.0.1'],
    ['IPv6', '::1'],
    ['bracketed IPv6', '[fd00::1]'],
    ['localhost', 'localhost'],
    ['an mDNS name', 'printer.local'],
    ['an internal suffix', 'relay.internal'],
    ['home.arpa', 'relay.home.arpa'],
  ])('refuses %s as not routable', (_label, host) => {
    expect(parseSmtpTarget({ ...LIVE, host }).reason).toBe(SMTP_HOST_NOT_ROUTABLE);
  });

  it.each([
    ['a bare label', 'mailserver'],
    ['an empty label', 'mail..com'],
    ['a leading hyphen', '-mail.example.com'],
    ['a numeric TLD', 'mail.example.12'],
    ['a space', 'mail example.com'],
    ['a path', 'mail.example.com/x'],
    ['an @ sign', 'user@mail.example.com'],
  ])('refuses %s as an invalid hostname', (_label, host) => {
    expect(parseSmtpTarget({ ...LIVE, host }).reason).toBe(SMTP_HOST_INVALID);
  });

  it.each([['0'], ['65536'], ['-1'], ['not-a-port'], ['587.5']])('refuses port %s', (port: string) => {
    expect(parseSmtpTarget({ ...LIVE, port }).reason).toBe(SMTP_PORT_INVALID);
  });

  it('refuses a row with no host or no from address', () => {
    expect(parseSmtpTarget({ ...LIVE, host: '' }).reason).toBe(SMTP_NOT_CONFIGURED);
    expect(parseSmtpTarget({ ...LIVE, from_email: '' }).reason).toBe(SMTP_NOT_CONFIGURED);
  });

  it('strips the trailing dot, so an allowlist cannot be walked past', () => {
    // `evil.com.` and `evil.com` resolve identically; only one of them would
    // match a naive allowlist comparison.
    const t = parseSmtpTarget({ ...LIVE, host: 'MAIL.Spicymeal.com.sa.' });
    expect(t).toMatchObject({ host: 'mail.spicymeal.com.sa', reason: null });
  });

  it('applies the optional allowlist when one is set, and ignores it when not', () => {
    expect(parseSmtpTarget(LIVE, 'spicymeal.com.sa').reason).toBeNull();
    expect(parseSmtpTarget(LIVE, ' spicymeal.com.sa , example.net ').reason).toBeNull();
    expect(parseSmtpTarget(LIVE, 'example.net').reason).toBe(SMTP_HOST_NOT_ALLOWED);
    expect(parseSmtpTarget(LIVE, '').reason).toBeNull();
    expect(parseSmtpTarget(LIVE, null).reason).toBeNull();
  });
});

describe('isAllowedSmtpHost', () => {
  it('matches a subdomain but not a suffix that merely looks like one', () => {
    expect(isAllowedSmtpHost('mail.example.com', 'example.com')).toBe(true);
    expect(isAllowedSmtpHost('example.com', 'example.com')).toBe(true);
    // The classic near-miss: `notexample.com` ends with `example.com` as a
    // STRING but is a different registrable domain.
    expect(isAllowedSmtpHost('notexample.com', 'example.com')).toBe(false);
  });
});

/**
 * A source-level pin, not a behavioural test.
 *
 * denomailer refuses to send AUTH over a connection it could not secure — it
 * STARTTLSes when the server advertises it, then throws "Connection is not
 * secure!" if it is still in the clear. That refusal is switchable off with
 * `debug.allowUnsecure`, and switching it on is exactly what somebody would
 * reach for to silence that error. Then the SMTP password crosses the wire in
 * cleartext, and nothing else in this repository would notice.
 */
describe('alert dispatcher SMTP wiring', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../operations-alert-dispatch/index.ts', import.meta.url)),
    'utf8',
  );

  it('never disables denomailer’s refusal to authenticate in the clear', () => {
    expect(source).not.toMatch(/allowUnsecure/);
    expect(source).not.toMatch(/noStartTLS/);
  });

  it('connects only to the validated target, never to raw config fields', () => {
    expect(source).toMatch(/parseSmtpTarget\(/);
    expect(source).toMatch(/if \(target\.reason !== null\)/);
    // The pre-guard code read `pub.host` straight into `Deno.connect`.
    expect(source).not.toMatch(/hostname:\s*String\(/);
    expect(source).not.toMatch(/pub\.host/);
  });
});
