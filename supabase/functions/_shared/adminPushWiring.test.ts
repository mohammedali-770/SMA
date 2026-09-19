import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { assertVapidKeyPair } from './webPush';
import { buildPayload, parseNotificationRequest, requestFromQueueRow } from './adminPush';

/**
 * A source-shape tripwire for `admin-push-dispatch`, in the idiom of
 * `alertDispatchWiring.test.ts`, and honest about being one.
 *
 * The handler ends in `Deno.serve` and imports Deno-only modules, so Vitest
 * cannot load it and nothing here executes its control flow. `adminPush.ts` and
 * `webPush.ts` hold the decisions and ARE executed, by their own suites. What
 * this file adds is the two things neither of those can see: that the handler
 * actually wires the decisions up, and that the payload contract with
 * `public/sw.js` — a different file, in a different language, shipped to a
 * browser — still holds.
 */

function handler(): string {
  return readFileSync(new URL('../admin-push-dispatch/index.ts', import.meta.url), 'utf8');
}

/**
 * Handler source with comments AND the import block stripped. Both are
 * load-bearing rather than tidy, and each removes a way for an assertion to
 * pass while proving nothing:
 *
 *   - the header documents the very properties asserted below, so an assertion
 *     would happily match the prose explaining a guarantee instead of the code
 *     providing it. `pushReadyCopyWiring.test.ts` records that trap firing;
 *   - an import NAMES a helper without calling it. The first version of this
 *     file asserted `toContain('assertVapidKeyPair')`, and a mutant that
 *     replaced the call with `await Promise.resolve()` survived — the import
 *     line alone satisfied the check. That is the repository's "a check a
 *     comment can satisfy is not a check" in a new costume, and it was found by
 *     mutation testing rather than by review.
 */
function code(): string {
  return handler()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^import[\s\S]*?from '[^']+';$/gm, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

describe('the admin channel is separate from the customer channel', () => {
  /*
   * THE PROPERTY THE WHOLE FEATURE RESTS ON. Customer push is Expo, keyed on
   * `push_devices.customer_id`, governed by CLAUDE.md §7. The moment the two
   * share a table or a code path, a predicate error in a staff feature can put
   * a branch closure on a real customer's lock screen. Migration
   * 20260927120000's assertion 5.9 enforces the same thing on the SQL side.
   */
  it('never names the customer push table or function', () => {
    const c = code();
    expect(c).not.toContain('push_devices');
    expect(c).not.toContain('push-dispatch');
    expect(c).not.toContain('promos_enabled');
    expect(c).not.toContain('expo');
  });

  it('reads only the admin subscription table', () => {
    const c = code();
    expect(c).toContain("from('admin_push_subscriptions')");
    // `app_settings` for the advertised key and `profiles` for the caller's
    // role are the only other tables it may touch.
    const tables = [...c.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]);
    expect([...new Set(tables)].sort()).toEqual(['admin_push_subscriptions', 'app_settings', 'profiles']);
  });
});

describe('the caller gate', () => {
  it('runs role AND AAL2 through the shared predicate', () => {
    const c = code();
    expect(c).toContain('decideAdminAuthorization(');
    expect(c).toContain("rpc('is_admin')");
    // Mutation killed: judging on the profile role alone, which is the exact
    // defect fixed in push-dispatch and four other admin functions.
    expect(c).not.toMatch(/role\s*===\s*'admin'/);
  });

  it('derives the scope from scopeFor rather than from the request body', () => {
    const c = code();
    expect(c).toContain('const scope = scopeFor(caller)');
    // Mutation killed: a `scope` field in the request that an admin could set
    // to 'all', which would hand every administrator a broadcast.
    expect(c).not.toMatch(/body\.scope|source\.scope|request\.scope/);
  });

  it("restricts a self-scoped send with the caller's own id", () => {
    const c = code();
    expect(c).toContain("if (scope === 'self')");
    expect(c).toContain("query.eq('admin_id', callerId)");
    // Fail closed: a missing caller id must refuse, never fall through to the
    // unfiltered query sitting directly above it.
    expect(c).toMatch(/if \(callerId === null\) return json\([^)]*401\)/);
  });

  it('accepts the service role only by exact key comparison', () => {
    expect(code()).toContain('auth === `Bearer ${key}`');
  });
});

describe('the VAPID configuration is checked before anything is sent', () => {
  it('refuses to send on a mismatched key pair or a mismatched advertised key', () => {
    const c = code();
    expect(c).toContain('await assertVapidKeyPair(keys);');
    expect(c).toContain('admin_push_vapid_public_key');
    expect(c).toContain('advertised !== keys.publicKey');
    expect(c).toContain("status: 'misconfigured'");
  });

  it('answers not_configured with a 200 so a driver does not retry a missing secret', () => {
    expect(code()).toMatch(/status: 'not_configured'[^}]*}, 200\)/);
  });

  it('reads the private key from the environment and never from a table', () => {
    const c = code();
    expect(c).toContain("Deno.env.get('ADMIN_PUSH_VAPID_PRIVATE_KEY')");
    // Mutation killed: sourcing the private half from app_settings alongside
    // the public one, which would put it in reach of every client role. The
    // check is case-SENSITIVE on the snake_case spelling, because that is what
    // a column would be called; the SCREAMING_CASE environment variable name is
    // the legitimate occurrence and must not be swept up with it.
    expect(c).not.toMatch(/select\([^)]*private/i);
    expect(c).not.toContain('vapid_private');
    // And it is read exactly once, from the environment.
    expect(c.split('ADMIN_PUSH_VAPID_PRIVATE_KEY').length - 1).toBe(1);
  });
});

describe('failure handling', () => {
  it('deletes a subscription only through classifyDelivery', () => {
    const c = code();
    expect(c).toContain('classifyDelivery(status)');
    expect(c).toContain('shouldPruneAfterFailure(nextCount)');
    /*
     * Mutation killed: an ad-hoc `status === 403` delete, which would wipe
     * every admin registration the first time a VAPID key was mistyped. The
     * assertion is structural rather than a search for that one literal,
     * because the first version of it searched for the literal and the mutant
     * walked straight past: the handler classifies a status in exactly one
     * place, and deletes in exactly two.
     */
    expect(c).not.toMatch(/status\s*===\s*\d/);
    expect((c.match(/\.delete\(\)/g) ?? []).length).toBe(2);
  });

  it('treats a thrown send as retryable rather than as a dead subscription', () => {
    // status 0 is not in the 2xx range and is not 404/410, so classifyDelivery
    // returns 'failed'. Asserted here because the handler chooses the sentinel.
    expect(code()).toContain('status = 0;');
  });

  it('never logs a push endpoint whole', () => {
    const c = code();
    // The endpoint is a capability URL: whoever holds it can address that
    // device. Only its origin is ever written to a log line (CLAUDE.md §9).
    expect(c).toContain('endpointOrigin(row.endpoint)');
    expect(c).not.toMatch(/console\.(log|error|warn)\([^)]*endpoint:\s*row\.endpoint/);
  });
});

describe('the payload contract with public/sw.js', () => {
  function serviceWorker(): string {
    return readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8');
  }

  /*
   * THE ONE CROSS-FILE CHECK THAT IS NOT A GREP. `buildPayload` is executed,
   * and the keys it really emits are compared with the keys `public/sw.js`
   * really reads. A key the worker does not read is dead weight inside a
   * payload with a hard byte ceiling; a key the worker reads and the sender
   * never sends is a notification field that silently falls back.
   */
  it('emits only keys the service worker reads', () => {
    const read = new Set([...serviceWorker().matchAll(/payload\.([A-Za-z]+)/g)].map((m) => m[1]));
    expect(read.size).toBeGreaterThan(0);
    const result = parseNotificationRequest({
      title: 'مغلق',
      body: 'حجم مغلق',
      url: '/?tab=items',
      tag: 'variant:1',
    });
    if (!result.ok) throw new Error(result.reason);
    for (const key of Object.keys(buildPayload(result.request, 'ar', 0))) {
      expect([...read]).toContain(key);
    }
  });

  it('sends every key the service worker reads', () => {
    const read = [...serviceWorker().matchAll(/payload\.([A-Za-z]+)/g)].map((m) => m[1]);
    const result = parseNotificationRequest({
      title: 'a',
      body: 'b',
      url: '/',
      tag: 't',
    });
    if (!result.ok) throw new Error(result.reason);
    const emitted = Object.keys(buildPayload(result.request, 'ar', 0));
    for (const key of new Set(read)) expect(emitted).toContain(key);
  });
});

describe('the queue-drain mode', () => {
  function migration(): string {
    return readFileSync(
      new URL('../../migrations/20260928120000_admin_push_closure_notifications.sql', import.meta.url),
      'utf8',
    );
  }

  it('authenticates the scheduler through Postgres, never by holding its secret', () => {
    const c = code();
    expect(c).toContain("rpc('verify_admin_push_dispatch_signature'");
    expect(c).toContain("req.headers.get('x-admin-push-signature')");
    // Mutation killed: reading the shared secret itself out of a header or the
    // environment and comparing it here, which is what `operations-alert-dispatch`
    // did while its own header claimed otherwise (#329).
    expect(c).not.toMatch(/x-admin-push-secret/);
    expect(c).toContain('if (ok !== true)');
  });

  it('fails closed when the signature RPC does not exist yet', () => {
    // Deploying before the step 4 migration is applied is an ordering mistake,
    // and the honest answer is the same as for a bad signature. A 500 here
    // would read as a fault in the function instead.
    expect(code()).toMatch(/if \(error\) return json\(\{ error: 'unauthorized'/);
  });

  it('refuses a queue drain from an admin', () => {
    const c = code();
    expect(c).toContain("mode === 'queue' && !mayDrainQueue(caller)");
    expect(c).toMatch(/code: 'forbidden' \}, 403\)/);
  });

  it('reads the audience before claiming anything', () => {
    // Claiming first would burn an attempt against every queued notice on a
    // deployment where nobody has subscribed, and three ticks later they would
    // all be `failed` for a reason that was never theirs.
    const c = code();
    const audience = c.indexOf("status: 'no_subscriptions'");
    const claim = c.indexOf("rpc(\n    'claim_admin_push_notifications'");
    expect(audience).toBeGreaterThan(-1);
    expect(c.indexOf('claim_admin_push_notifications')).toBeGreaterThan(audience);
    expect(claim === -1 || claim > audience).toBe(true);
  });

  it('finalizes every claimed row under the token it claimed with', () => {
    const c = code();
    expect(c).toContain("rpc('finalize_admin_push_notification'");
    expect(c).toContain('p_claim_token: claimToken');
    // Mutation killed: reporting `sent` regardless of whether any device took
    // it, which would mark a notification delivered that reached nobody.
    expect(c).toContain('const ok = delivered > 0;');
  });

  /*
   * THE #328 COUPLING, MADE EXECUTABLE. PostgREST serialises an RPC's declared
   * OUT parameter names, not the aliases inside its body — and naming them
   * wrong in TypeScript made every field `undefined` in
   * `operations-alert-dispatch`, which then sent empty mail and stranded every
   * claim. Here the migration's own `returns table (...)` is parsed and
   * compared with the keys `requestFromQueueRow` actually reads, collected with
   * a Proxy rather than written down a second time.
   */
  it('reads exactly the columns the claim RPC declares', () => {
    const declared = /returns table \(([\s\S]*?)\)\nlanguage plpgsql/.exec(migration());
    expect(declared).not.toBeNull();
    const columns = new Set(
      (declared?.[1] ?? '')
        .split('\n')
        .map((line) => /^\s*([a-z_]+)\s+\S/.exec(line)?.[1])
        .filter((name): name is string => Boolean(name)),
    );
    expect(columns.size).toBeGreaterThan(4);

    const used = new Set<string>();
    requestFromQueueRow(
      new Proxy({} as never, {
        get(_target, key) {
          if (typeof key === 'string') used.add(key);
          return '';
        },
      }),
    );
    expect(used.size).toBeGreaterThan(0);
    for (const key of used) expect([...columns]).toContain(key);
  });

  it('passes the RPC arguments the migration declares', () => {
    const sql = migration();
    const c = code();
    for (const arg of ['p_claim_token', 'p_limit']) {
      expect(sql).toContain(`${arg} `);
    }
    expect(c).toContain('p_claim_token: claimToken');
    expect(c).toContain('p_limit: CLAIM_LIMIT');
    for (const arg of ['p_id', 'p_claim_token', 'p_status', 'p_error_safe']) {
      expect(sql).toContain(arg);
      expect(c).toContain(`${arg}:`);
    }
  });
});

describe('deployment wiring', () => {
  it('is registered in config.toml with verify_jwt disabled', () => {
    const config = readFileSync(new URL('../../config.toml', import.meta.url), 'utf8');
    expect(config).toMatch(/\[functions\.admin-push-dispatch\]\s*\nverify_jwt = false/);
  });

  /*
   * `scripts/generate-vapid-keys.mjs` reimplements the base64url encoding
   * because it has to run under plain `node`. Rather than trust that
   * duplication, run the script and feed its output to the real checker — a
   * drift in the encoding then fails here instead of producing keys that look
   * fine and are refused by every push service.
   */
  it('produces a usable key pair from the generator script', async () => {
    const out = execFileSync('node', ['scripts/generate-vapid-keys.mjs'], { encoding: 'utf8' });
    const publicKey = /ADMIN_PUSH_VAPID_PUBLIC_KEY=(\S+)/.exec(out)?.[1] ?? '';
    const privateKey = /ADMIN_PUSH_VAPID_PRIVATE_KEY=(\S+)/.exec(out)?.[1] ?? '';
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(privateKey).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    await expect(assertVapidKeyPair({ publicKey, privateKey })).resolves.toBeUndefined();
  });

  it('prints the private key nowhere but the secret line', () => {
    const out = execFileSync('node', ['scripts/generate-vapid-keys.mjs'], { encoding: 'utf8' });
    const privateKey = /ADMIN_PUSH_VAPID_PRIVATE_KEY=(\S+)/.exec(out)?.[1] ?? '';
    expect(privateKey).not.toBe('');
    // The SQL line it prints must carry the PUBLIC key. Printing the private
    // one there would invite pasting a signing key into a table every client
    // role can read.
    expect(out.split(privateKey).length - 1).toBe(1);
    expect(/update public\.app_settings set admin_push_vapid_public_key = '(\S+)'/.exec(out)?.[1]).toBe(
      /ADMIN_PUSH_VAPID_PUBLIC_KEY=(\S+)/.exec(out)?.[1],
    );
  });
});
