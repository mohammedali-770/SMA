import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A SOURCE-LEVEL TRIPWIRE ON WHAT KEEPS A CASHIER SIGNED IN.
 *
 * Branch staff reported being signed out of the console. Nothing in this
 * repository signs anyone out on a timer — there is no idle timeout, and
 * `AppContext`'s auth listener only reaches the guest state when Supabase hands
 * it an event with no session. What keeps a session alive across a shift is two
 * flags on the client, and both are one careless edit from being flipped:
 *
 *  - `persistSession` writes the session to storage. Off, and every reload —
 *    every iPad wake, every crashed tab — is a sign-out.
 *  - `autoRefreshToken` renews the access token before it expires. Off, and the
 *    session dies at the JWT lifetime regardless of what the operator is doing,
 *    which is EXACTLY the reported symptom.
 *
 * Neither has a behavioural test that could fail, because proving them needs a
 * real GoTrue and a wall-clock hour. Reading the source is the honest
 * substitute: it cannot prove the session survives, but it does fail the moment
 * someone removes the reason it should.
 *
 * `structuredClone` of the argument is not possible here — this asserts on the
 * text deliberately, so that replacing the literal with a variable, an env
 * lookup or a spread also trips it. If you are changing this file because the
 * shape moved, change the flags' VALUES only on purpose.
 */
const source = readFileSync(resolve(__dirname, 'supabase.ts'), 'utf8');

describe('supabase client session persistence', () => {
  it('persists the session, so a reload is not a sign-out', () => {
    expect(source).toMatch(/persistSession:\s*true/);
    expect(source).not.toMatch(/persistSession:\s*false/);
  });

  it('refreshes the access token, so a shift outlasts the JWT lifetime', () => {
    expect(source).toMatch(/autoRefreshToken:\s*true/);
    expect(source).not.toMatch(/autoRefreshToken:\s*false/);
  });

  it('introduces no inactivity timeout of its own', () => {
    // If a session expiry is ever wanted it belongs in Auth configuration,
    // where it applies to every client — not in one bundle, silently.
    expect(source).not.toMatch(/setTimeout|setInterval|idle|inactiv/i);
  });
});
