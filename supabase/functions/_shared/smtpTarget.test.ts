import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  classifySmtpFailure,
  describeSmtpRefusal,
  isAllowedSmtpHost,
  parseSmtpTarget,
  SMTP_AUTH_FAILED,
  SMTP_CONNECT_FAILED,
  SMTP_HOST_INVALID,
  SMTP_HOST_NOT_ALLOWED,
  SMTP_HOST_NOT_ROUTABLE,
  SMTP_NOT_CONFIGURED,
  SMTP_NOT_SECURE,
  SMTP_NOT_SMTP,
  SMTP_PORT_INVALID,
  SMTP_PORT_NOT_ALLOWED,
  SMTP_PORTS,
  SMTP_REJECTED,
  SMTP_SEND_FAILED,
  SMTP_TLS_FAILED,
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

  /*
   * A MAIL RELAY LISTENS ON A MAIL PORT (2026-11-11). The guard used to admit any
   * port from 1 to 65535, so `attacker-controlled.example:6379` passed, and
   * `email-test-config` reported back what answered there. The set is the three
   * standard ports plus 2525, the alternate that relay providers offer because so
   * many networks block 25 and 587 — Supabase's Edge runtime among them.
   */
  it('admits exactly the mail ports', () => {
    expect(SMTP_PORTS).toEqual([25, 465, 587, 2525]);
    for (const port of SMTP_PORTS) {
      expect(parseSmtpTarget({ ...LIVE, port: String(port) }).reason).toBeNull();
    }
  });

  it.each([
    ['Redis', '6379'],
    ['HTTP, where the cloud metadata service answers', '80'],
    ['HTTPS', '443'],
    ['SSH', '22'],
    ['PostgreSQL', '5432'],
  ])('refuses %s as not a mail port', (_label, port) => {
    expect(parseSmtpTarget({ ...LIVE, port }).reason).toBe(SMTP_PORT_NOT_ALLOWED);
  });

  it('refuses a public name on a non-mail port, which the guard used to admit', () => {
    const probe = { ...LIVE, host: 'attacker-controlled.example', port: '6379' };
    expect(parseSmtpTarget(probe).reason).toBe(SMTP_PORT_NOT_ALLOWED);
  });

  /*
   * WHAT THIS GUARD CANNOT SEE, pinned so the documentation cannot drift back to
   * overstating it. Every host rule is lexical and no name is ever resolved, so a
   * wildcard-DNS name that answers with a private address is a well-formed public
   * hostname. It passes until SMTP_ALLOWED_HOSTS pins the relay. If names are
   * ever resolved, this case should flip: revisit it then, rather than deleting
   * it to make a change pass.
   */
  it('admits a name that resolves into private space, until SMTP_ALLOWED_HOSTS pins the relay', () => {
    const inward = { ...LIVE, host: '127.0.0.1.nip.io', port: '25' };
    expect(parseSmtpTarget(inward).reason).toBeNull();
    expect(parseSmtpTarget(inward, 'spicymeal.com.sa').reason).toBe(SMTP_HOST_NOT_ALLOWED);
  });
});

describe('describeSmtpRefusal', () => {
  const REFUSALS = [
    SMTP_NOT_CONFIGURED,
    SMTP_PORT_INVALID,
    SMTP_PORT_NOT_ALLOWED,
    SMTP_HOST_INVALID,
    SMTP_HOST_NOT_ROUTABLE,
    SMTP_HOST_NOT_ALLOWED,
  ];

  it('gives every refusal its own sentence', () => {
    const sentences = REFUSALS.map(describeSmtpRefusal);
    expect(new Set(sentences).size).toBe(REFUSALS.length);
    for (const sentence of sentences) expect(sentence).toMatch(/^[A-Z].*\.$/);
  });

  it('keeps the two sentences the console already showed', () => {
    expect(describeSmtpRefusal(SMTP_NOT_CONFIGURED)).toBe(
      'Email server is not fully configured (host + from email required).',
    );
    expect(describeSmtpRefusal(SMTP_PORT_INVALID)).toBe('Invalid SMTP port.');
  });

  it('names the mail ports and the allowlist variable, so the admin knows what to change', () => {
    expect(describeSmtpRefusal(SMTP_PORT_NOT_ALLOWED)).toContain('25, 465, 587 or 2525');
    expect(describeSmtpRefusal(SMTP_HOST_NOT_ALLOWED)).toContain('SMTP_ALLOWED_HOSTS');
  });

  it('falls back to a generic sentence for a code it does not know', () => {
    expect(describeSmtpRefusal('something_new')).toBe('The SMTP settings were refused.');
  });
});

/** Deno names its network errors by class; a plain Error carries the rest. */
function denoError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('classifySmtpFailure', () => {
  /*
   * WHY THIS EXISTS. `email-test-config` returned up to 300 characters of the
   * raw error to the browser, and denomailer builds that error out of whatever
   * the far end said. Against a listener that sends an SSH banner, the test
   * button answered `NaN: 2.0-OpenSSH_9.6 internal-host,`. Each message below
   * was MEASURED on 2026-11-11 (Deno 2.9.4, denomailer 1.6.0, loopback
   * listeners), except TimedOut and ConnectionReset, which are Deno's own error
   * classes and were not reproduced.
   */
  const MEASURED: Array<[string, unknown, string]> = [
    [
      'a refused connection',
      denoError('ConnectionRefused', 'Connection refused (os error 111)'),
      SMTP_CONNECT_FAILED,
    ],
    [
      'a name that does not resolve',
      new Error('failed to lookup address information: Name or service not known'),
      SMTP_CONNECT_FAILED,
    ],
    ['a timeout', denoError('TimedOut', 'connection timed out'), SMTP_CONNECT_FAILED],
    ['a reset', denoError('ConnectionReset', 'Connection reset by peer (os error 104)'), SMTP_CONNECT_FAILED],
    [
      'TLS to a listener that does not speak it',
      denoError('UnexpectedEof', 'unexpected end of file'),
      SMTP_TLS_FAILED,
    ],
    [
      'a certificate that does not fit',
      denoError('InvalidData', 'invalid peer certificate: Other(OtherError(CaUsedAsEndEntity))'),
      SMTP_TLS_FAILED,
    ],
    [
      'a server that offers no TLS',
      new Error("Connection is not secure! Don't send authentication over non secure connection!"),
      SMTP_NOT_SECURE,
    ],
    ['refused credentials', new Error('535: 5.7.8 Authentication credentials invalid'), SMTP_AUTH_FAILED],
    [
      'a refused recipient',
      new Error('550: 5.1.1 <c@d.co>: Recipient address rejected: internal-mx.corp.example'),
      SMTP_REJECTED,
    ],
    ['a service that is not SMTP', new Error('NaN: 2.0-OpenSSH_9.6 internal-host,'), SMTP_NOT_SMTP],
    ['a connection closed before any reply', new Error('NaN: '), SMTP_NOT_SMTP],
    ['something unforeseen', new Error('boom'), SMTP_SEND_FAILED],
    ['a thrown string', 'boom', SMTP_SEND_FAILED],
  ];

  it.each(MEASURED)('classifies %s', (_label, error, reason) => {
    expect(classifySmtpFailure(error).reason).toBe(reason);
  });

  it('never repeats anything the far end said', () => {
    const remoteText = [
      'OpenSSH',
      'internal-host',
      'internal-mx',
      'corp.example',
      'c@d.co',
      'os error',
      'boom',
    ];
    for (const [, error] of MEASURED) {
      const { message } = classifySmtpFailure(error);
      for (const fragment of remoteText) expect(message).not.toContain(fragment);
    }
  });

  it('keeps the SMTP reply code of a refusal, which is a number and not the server’s text', () => {
    const { message } = classifySmtpFailure(new Error('550: 5.1.1 <c@d.co>: Recipient address rejected'));
    expect(message).toContain('550');
    expect(message).not.toContain('Recipient address rejected');
  });

  it('adds the runtime’s port block to a failed connection on 25 or 587, and only there', () => {
    const refused = denoError('ConnectionRefused', 'Connection refused (os error 111)');
    expect(classifySmtpFailure(refused, 587).message).toContain('465');
    expect(classifySmtpFailure(refused, 25).message).toContain('465');
    expect(classifySmtpFailure(refused, 465).message).toBe(classifySmtpFailure(refused).message);
    const authFailed = new Error('535: 5.7.8 Authentication credentials invalid');
    expect(classifySmtpFailure(authFailed, 587).message).toBe(classifySmtpFailure(authFailed).message);
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
