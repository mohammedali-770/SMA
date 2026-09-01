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
