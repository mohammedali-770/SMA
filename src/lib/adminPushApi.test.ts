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

describe('sendAdminPushConfirmation', () => {
  function body(): Record<string, unknown> {
    return (invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body;
  }

  it('invokes the admin sender and nothing else', async () => {
    invoke.mockResolvedValue({ data: { status: 'ok' }, error: null });
    await sendAdminPushConfirmation();
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
  it('never asks for a scope or an audience', async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    await sendAdminPushConfirmation();
    const sent = body();
    expect('scope' in sent).toBe(false);
    expect('adminId' in sent).toBe(false);
    expect('all' in sent).toBe(false);
  });

  it('sends copy in both languages so the sender can pick per device', async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    await sendAdminPushConfirmation();
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
    await sendAdminPushConfirmation();
    const sent = body();
    expect(sent.ttl).toBe(120);
    expect(sent.url).toBe('/');
    expect(String(sent.url).startsWith('/app')).toBe(false);
  });

  it('throws when the sender refuses', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('not deployed') });
    await expect(sendAdminPushConfirmation()).rejects.toThrow('not deployed');
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
