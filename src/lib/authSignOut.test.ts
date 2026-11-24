import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }));

import { auth } from './api';
import { supabase } from './supabase';

/**
 * supabase-js returns `{ error }` and KEEPS the stored session when the sign-out
 * request fails (network error, 5xx), so a signOut that ignores that result
 * leaves a live AAL2 session behind a sign-in form (audit finding F-TA3-001).
 */
describe('auth.signOut', () => {
  beforeEach(() => vi.mocked(supabase.auth.signOut).mockReset());

  it('resolves when the server call succeeds', async () => {
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });
    await expect(auth.signOut()).resolves.toBeUndefined();
  });

  it('throws when the server call fails, so the caller does not claim to be signed out', async () => {
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: { message: 'fetch failed' } } as never);
    await expect(auth.signOut()).rejects.toThrow('fetch failed');
  });
});
