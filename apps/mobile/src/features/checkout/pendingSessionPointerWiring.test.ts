import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SESSION_NOT_FOUND_MESSAGE } from './pendingSession';

/**
 * The saved-checkout pointer must not be steerable by a link or by another
 * account (audit findings F-TA5-001 and F-TA5-002). Both halves are call-site
 * facts that a unit test cannot call, so these read the source with comments
 * removed.
 */
const SRC = resolve(__dirname, '../..');
const REPO = resolve(SRC, '../../..');
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the client constant is the sentence the server really sends', () => {
  it('payment-verify answers a session the caller cannot see with exactly SESSION_NOT_FOUND_MESSAGE', () => {
    const server = strip(readFileSync(resolve(REPO, 'supabase/functions/payment-verify/index.ts'), 'utf8'));
    expect(server).toContain(`error: '${SESSION_NOT_FOUND_MESSAGE}', httpStatus: 404`);
  });
});

describe('the payment return link', () => {
  const route = strip(readFileSync(resolve(SRC, 'app/payment/return.tsx'), 'utf8'));

  it('records a session only when none is pending or it is the one already pending', () => {
    expect(route).toContain('const existing = await loadPendingSession();');
    expect(route).toMatch(
      /if \(!existing \|\| existing\.sessionId === sid\) await savePendingSession\(sid, Date\.now\(\)\);/,
    );
  });

  it('never saves a link-supplied session unconditionally', () => {
    expect(route).not.toMatch(/if \(sid\) await savePendingSession/);
  });
});
