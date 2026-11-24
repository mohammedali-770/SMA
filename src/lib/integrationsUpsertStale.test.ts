/**
 * F-X09-004: the integration cards save a whole form, and
 * `upsert_integration_settings` overwrites `enabled`, `provider_name` and the
 * whole `public_config`. A form older than the row therefore undoes someone
 * else's change to the push master flag, the Moyasar mode or the POS switch.
 * `integrations.upsert` must compare the form's `updated_at` against a fresh read
 * and refuse, without writing, when the row has moved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { IntegrationConflictError, integrations, type DbIntegrationSetting } from './api';

const row = (over: Partial<DbIntegrationSetting> = {}): DbIntegrationSetting => ({
  provider_type: 'push',
  provider_name: 'expo',
  enabled: true,
  public_config: {},
  has_secret: false,
  updated_at: '2026-11-24T10:00:00.000Z',
  ...over,
});

const input = (expectedUpdatedAt: string | null) => ({
  providerType: 'push' as const,
  providerName: 'expo',
  enabled: true,
  publicConfig: {},
  expectedUpdatedAt,
});

beforeEach(() => rpc.mockReset());

describe('integrations.upsert stale-form guard', () => {
  it('refuses a save whose form is older than the stored row, and writes nothing', async () => {
    const moved = row({ enabled: false, updated_at: '2026-11-24T11:30:00.000Z' });
    rpc.mockResolvedValueOnce({ data: [moved], error: null });
    const err = await integrations.upsert(input('2026-11-24T10:00:00.000Z')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntegrationConflictError);
    expect((err as IntegrationConflictError).latest).toEqual(moved);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('list_integration_settings');
  });

  it('writes when the form is current', async () => {
    const saved = row({ updated_at: '2026-11-24T10:05:00.000Z' });
    rpc
      .mockResolvedValueOnce({ data: [row()], error: null })
      .mockResolvedValueOnce({ data: [saved], error: null });
    await expect(integrations.upsert(input('2026-11-24T10:00:00.000Z'))).resolves.toEqual(saved);
    expect(rpc.mock.calls[1][0]).toBe('upsert_integration_settings');
  });

  it('treats the same instant in another timestamp format as unchanged', async () => {
    rpc
      .mockResolvedValueOnce({ data: [row({ updated_at: '2026-11-24T10:00:00+00:00' })], error: null })
      .mockResolvedValueOnce({ data: [row()], error: null });
    await expect(integrations.upsert(input('2026-11-24T10:00:00.000Z'))).resolves.toBeTruthy();
  });

  it('refuses a form built with no row when a row now exists', async () => {
    rpc.mockResolvedValueOnce({ data: [row()], error: null });
    await expect(integrations.upsert(input(null))).rejects.toBeInstanceOf(IntegrationConflictError);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('allows the first save when no row exists on either side', async () => {
    rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [row()], error: null });
    await expect(integrations.upsert(input(null))).resolves.toBeTruthy();
  });

  it('refuses when the row was deleted after the form loaded', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(integrations.upsert(input('2026-11-24T10:00:00.000Z'))).rejects.toBeInstanceOf(
      IntegrationConflictError,
    );
  });
});
