import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
const rpc = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

const { fetchAdminPushState, sendAdminPushConfirmation } = await import('./adminPushApi');

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
});

const ENDPOINT = 'https://web.push.apple.com/abc123';

describe('sendAdminPushConfirmation', () => {
  function body(): Record<string, unknown> {
    return (invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body;
  }

  it('invokes the admin sender and nothing else', async () => {
    invoke.mockResolvedValue({ data: { status: 'ok' }, error: null });
    await sendAdminPushConfirmation(ENDPOINT);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe('admin-push-dispatch');
    // Mutation killed: reaching for the CUSTOMER sender, which would put a
    // staff confirmation into the Expo channel governed by CLAUDE.md §7.
    expect(invoke.mock.calls[0][0]).not.toBe('push-dispatch');
  });

  /*
   * THE SAFETY PROPERTY, asserted from the caller's side as well as the
   * sender's. `scopeFor` in the Edge Function forces an authenticated caller to
   * their own devices; this check is that the client never even asks for
   * anything else, so a future change to the sender's parsing cannot quietly
   * turn this into a broadcast.
   */
  /*
   * WITHOUT THIS, THE CONFIRMATION PROVES THE WRONG THING. An admin who already
   * has a subscribed phone would receive it there, which looks exactly like
   * evidence that the browser they just enabled works. Review caught it on
   * #398. The sender ANDs this with the scope filter, so it can only ever
   * narrow the caller's own set.
   */
  it('names the device that was just enabled', async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    await sendAdminPushConfirmation(ENDPOINT);
    expect(body().endpoint).toBe(ENDPOINT);
  });

  it('never asks for a scope or an audience', async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    await sendAdminPushConfirmation(ENDPOINT);
    const sent = body();
    expect('scope' in sent).toBe(false);
    expect('adminId' in sent).toBe(false);
    expect('all' in sent).toBe(false);
    // `endpoint` is a narrowing filter, not an audience: the server still
    // scopes to the caller, so this cannot address another admin's device.
    expect(sent.endpoint).toBe(ENDPOINT);
  });

  it('sends copy in both languages so the sender can pick per device', async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    await sendAdminPushConfirmation(ENDPOINT);
    const sent = body();
    for (const key of ['title', 'body', 'titleEn', 'bodyEn']) {
      expect(typeof sent[key]).toBe('string');
      expect((sent[key] as string).length).toBeGreaterThan(0);
    }
    // The Arabic copy is the default, so it must actually be Arabic.
    expect(sent.title).toMatch(/[؀-ۿ]/);
    expect(sent.titleEn).not.toMatch(/[؀-ۿ]/);
  });

  it('expires quickly and links into the console rather than the customer app', async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    await sendAdminPushConfirmation(ENDPOINT);
    const sent = body();
    expect(sent.ttl).toBe(120);
    expect(sent.url).toBe('/');
    expect(String(sent.url).startsWith('/app')).toBe(false);
  });

  it('throws when the sender refuses', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('not deployed') });
    await expect(sendAdminPushConfirmation(ENDPOINT)).rejects.toThrow('not deployed');
  });
});

describe('fetchAdminPushState still fails soft', () => {
  /*
   * Re-asserted here because `sendAdminPushConfirmation` was added to the same
   * module and throws. The two are deliberately different: the read runs on
   * every console load and must never take the console down, while a send the
   * admin asked for owes them a truthful answer.
   */
  it('returns the unconfigured state when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('missing function') });
    await expect(fetchAdminPushState(null)).resolves.toEqual({
      configured: false,
      vapidPublicKey: null,
      subscribed: false,
      deviceCount: 0,
    });
  });
});
