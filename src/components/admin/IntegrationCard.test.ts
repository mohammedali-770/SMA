/**
 * The Lazywait base-URL placeholder must name the host that is actually live.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. `docs/LAZYWAIT.md` has carried this as a
 * known trap since 2026-08-24 — it named this exact placeholder as "how the wrong
 * host could get typed back in" — and the trap survived anyway, because nothing
 * executable disagreed with it.
 *
 * The live POS is the **dev** host. That is not a mistake to be tidied up: it is
 * owner-confirmed, it is what `integration_settings.public_config.base_url` holds
 * in Production, and every order that has ever synced went there. The production
 * host `apiv2.lazywait.com` is a real, reachable, DIFFERENT point-of-sale that
 * nobody watches.
 *
 * The fail-closed guard added in #254 rejects a missing or malformed `base_url`,
 * so the blank case is covered. It cannot reject a well-formed URL pointing at
 * the wrong restaurant — an operator who clears the field and accepts the
 * suggested value would send real customer orders into a POS with no kitchen
 * behind it, and every one of them would look successful.
 *
 * So the negative assertion below is the point of the file, not decoration.
 */
import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { PROVIDER_SPECS } from './IntegrationCard';

const LIVE_HOST = 'https://apiv2-dev.lazywait.com/v1';
const OTHER_POS = 'https://apiv2.lazywait.com/v1';

describe('Lazywait base_url placeholder', () => {
  const baseUrlField = PROVIDER_SPECS.lazywait.publicFields.find((f) => f.key === 'base_url');

  it('exists as a public field', () => {
    expect(baseUrlField).toBeDefined();
  });

  it('suggests the host the integration actually posts to', () => {
    expect(baseUrlField?.placeholder).toBe(LIVE_HOST);
  });

  it('never suggests the production POS, which is a different restaurant', () => {
    expect(baseUrlField?.placeholder).not.toBe(OTHER_POS);
    // Substring rather than equality: a future edit could reintroduce the wrong
    // host with a trailing slash, a different version segment, or no scheme, and
    // each would slip past an equality check while still being the wrong POS.
    expect(baseUrlField?.placeholder).not.toMatch(/(^|\/\/)apiv2\.lazywait\.com/);
  });

  it('keeps the secret fields out of the public list', () => {
    // Placement, not redaction, is what keeps these server-side: a secret listed
    // as a public field would be rendered and round-tripped through the browser.
    const publicKeys = PROVIDER_SPECS.lazywait.publicFields.map((f) => f.key);
    expect(publicKeys).not.toContain('api_token');
    expect(publicKeys).not.toContain('webhook_secret');
    expect(publicKeys).not.toContain('sync_trigger_secret');
  });
});

/**
 * The payment card writes Moyasar's credentials and nothing else.
 *
 * Moyasar is the only payment provider (owner decision, 2026-11-11). The card
 * used to offer a provider dropdown and swap between two field sets, so an
 * administrator could still be shown another gateway's merchant id and key
 * slots — boxes that configure nothing the server reads.
 *
 * The field NAMES are live data, not labels. The payment row already stores
 * `moyasar_test_publishable_key` under this exact name, and `secret_config` is
 * merged on save, so a renamed field would write a new key beside the old one
 * and leave the server reading the old one. The last test therefore checks the
 * card against what `resolveMoyasarConfig` actually reads, rather than against
 * a list copied into this file.
 */
describe('payment card — Moyasar only', () => {
  const payment = PROVIDER_SPECS.payment;
  const publicKeys = payment.publicFields.map((f) => f.key);
  const secretKeys = payment.secretFields.map((f) => f.key);

  it('offers Moyasar and nothing else', () => {
    expect(payment.providerOptions).toEqual(['moyasar']);
  });

  it("asks for none of the other gateway's inputs", () => {
    for (const key of ['merchant_id', 'source_id', 'test_secret_key', 'live_secret_key']) {
      expect(publicKeys).not.toContain(key);
      expect(secretKeys).not.toContain(key);
    }
  });

  it('asks for both webhook secret tokens, as secrets', () => {
    // Moyasar signs nothing: this token is the only thing authenticating a
    // webhook, and the server refuses to act on one without it.
    expect(secretKeys).toContain('moyasar_test_webhook_secret_token');
    expect(secretKeys).toContain('moyasar_live_webhook_secret_token');
  });

  it('keeps every secret key and token out of the public fields', () => {
    // Public fields are rendered and round-tripped through the browser.
    for (const f of payment.publicFields) {
      expect(f.key).not.toMatch(/secret|token/i);
      expect(`${f.label} ${f.placeholder ?? ''}`).not.toMatch(/sk_/);
    }
  });

  it('writes only names the server reads, under the same kind of config', () => {
    const src = readFileSync(new URL('../../../supabase/functions/_shared/moyasar.ts', import.meta.url), 'utf8');
    const file = ts.createSourceFile('moyasar.ts', src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    const code = ts.createPrinter({ removeComments: true }).printFile(file);
    const read = (obj: string) => new Set([...code.matchAll(new RegExp(`${obj}\\.(\\w+)`, 'g'))].map((m) => m[1]));
    const serverPublic = read('publicConfig');
    const serverSecret = read('secretConfig');

    expect(serverSecret.size).toBeGreaterThan(0);
    for (const key of publicKeys) expect(serverPublic).toContain(key);
    for (const key of secretKeys) expect(serverSecret).toContain(key);
  });
});
