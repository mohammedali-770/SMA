import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A source-shape tripwire for `email-test-config`'s SMTP connection, in the
 * idiom of `adminAuthWiring.test.ts`, and honest about being one.
 *
 * THE DEFECT THIS PINS (2026-11-11). The "send test email" button connected to
 * whatever `integration_settings.public_config` held: `host` and `port` went
 * straight into `new SMTPClient`, checked only for being non-empty and
 * positive, and the connection error came back to the browser, up to 300
 * characters of it. So the button could reach `169.254.169.254`, `127.0.0.1`
 * or any port, and say what answered there. The alert dispatcher had been
 * guarded against exactly this since 2026-09-14 (`_shared/smtpTarget.ts`), and
 * this sibling path, with the same config row and the same library, had not.
 *
 * The handler ends in `Deno.serve` and imports Deno-only modules, so Vitest
 * cannot load it. What it decides is executed for real in `smtpTarget.test.ts`;
 * this file pins that the handler asks those questions, in the right order, and
 * acts on the answers.
 */

function source(): string {
  return readFileSync(new URL('../email-test-config/index.ts', import.meta.url), 'utf8');
}

/**
 * Source with comments stripped. The handler documents the defect it fixed by
 * describing the old line, and an assertion that the old line is gone would
 * otherwise match that description.
 */
function code(): string {
  return source()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

/** The `test_send` branch alone; the `status` branch reads raw fields for booleans. */
function testSendBranch(): string {
  const c = code();
  const start = c.indexOf("payload.action === 'test_send'");
  const end = c.indexOf("status: 'ok'", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return c.slice(start, end);
}

describe('email-test-config validates the SMTP endpoint before connecting', () => {
  it('asks the shared guard, with the deployment allowlist', () => {
    const c = code();
    expect(c).toMatch(/import \{[^}]*\bparseSmtpTarget\b[^}]*\} from '\.\.\/_shared\/smtpTarget\.ts'/);
    expect(c).toContain("Deno.env.get('SMTP_ALLOWED_HOSTS')");
    expect(testSendBranch()).toContain('parseSmtpTarget(pub, SMTP_ALLOWED_HOSTS)');
  });

  it('decides before it constructs the client, and constructs exactly one', () => {
    const branch = testSendBranch();
    const parse = branch.indexOf('parseSmtpTarget(');
    const refusal = branch.indexOf('if (target.reason !== null)');
    const connect = branch.indexOf('new SMTPClient(');
    // -1 would otherwise satisfy `connect > parse` if the guard were deleted.
    expect(parse).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(parse);
    expect(connect).toBeGreaterThan(refusal);
    expect(code().match(/new SMTPClient\(/g) ?? []).toHaveLength(1);
  });

  // PRESENCE IS NOT USE. A guard computed and then ignored is the original
  // defect again, so the refusal must return before anything connects.
  it('returns the refusal, with its reason code, instead of connecting', () => {
    const branch = testSendBranch();
    const refusal = branch.indexOf('if (target.reason !== null) {');
    const connect = branch.indexOf('new SMTPClient(');
    expect(refusal).toBeGreaterThan(-1);
    expect(branch.slice(refusal, connect)).toMatch(/return json\(\{\s*ok: false,\s*reason: target\.reason,/);
  });

  it('connects only to the validated target, never to raw config fields', () => {
    const branch = testSendBranch();
    expect(branch).toContain('hostname: target.host');
    expect(branch).toContain('port: target.port');
    expect(branch).toContain('tls: target.tls');
    for (const raw of [
      'pub.host',
      'pub.port',
      'pub.secure',
      'pub.username',
      'pub.from_email',
      'pub.from_name',
    ]) {
      expect(branch).not.toContain(raw);
    }
  });
});

describe('email-test-config never echoes the raw connection error', () => {
  it('classifies the failure instead of quoting it', () => {
    const branch = testSendBranch();
    expect(branch).toContain('classifySmtpFailure(e, target.port)');
    expect(branch).not.toMatch(/e instanceof Error \? e\.message/);
    expect(branch).not.toContain('String(e)');
    expect(code()).not.toContain('sanitize(');
  });

  it('returns only the classified reason and sentence, never the error itself', () => {
    // A blocklist of old spellings misses a new one (`${e}`, `(e as Error).message`),
    // so pin the failure response itself: nothing from the error object, under
    // any spelling, and exactly the two classified values.
    const branch = testSendBranch();
    const block = branch.slice(branch.indexOf('} catch (e) {'));
    const start = block.indexOf('return json(');
    const end = block.indexOf('}, 200)', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const response = block.slice(start, end);
    expect(response).not.toMatch(/\be\b/);
    expect(response.match(/\$\{[^}]*\}/g)).toEqual(['${failure.message}', '${failure.reason}']);
    expect(response).toMatch(/reason:\s*failure\.reason,/);
  });

  it('never disables denomailer’s refusal to authenticate in the clear', () => {
    // The same pin as the dispatcher's, for the same reason: switching it off is
    // what somebody would reach for to silence a "not secure" failure.
    expect(code()).not.toMatch(/allowUnsecure/);
    expect(code()).not.toMatch(/noStartTLS/);
  });
});
