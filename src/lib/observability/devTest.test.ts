import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureWebException = vi.fn();
const captureWebMessage = vi.fn();

vi.mock('./index', () => ({
  captureWebException: (...args: unknown[]) => captureWebException(...args),
  captureWebMessage: (...args: unknown[]) => captureWebMessage(...args),
  isWebObservabilityInitialized: () => true,
  webObservabilityEnvironment: () => 'development',
}));

import { createDevSentryTestApi } from './devTest';

describe('admin dev Sentry test facility', () => {
  beforeEach(() => {
    captureWebException.mockClear();
    captureWebMessage.mockClear();
  });

  it('reports status from the observability module', () => {
    expect(createDevSentryTestApi().status())
      .toEqual({ initialized: true, environment: 'development' });
  });

  it('sends only safe, data-free test payloads', () => {
    const api = createDevSentryTestApi();
    api.message();
    api.exception();
    expect(captureWebMessage).toHaveBeenCalledWith(
      'dev-sentry-web: test message',
      expect.objectContaining({ subsystem: 'app', op: 'dev_test' }),
    );
    const [error, ctx] = captureWebException.mock.calls[0];
    expect((error as Error).message).toBe('dev-sentry-web: handled test exception');
    expect(ctx).toMatchObject({ code: 'DEV_TEST_EXCEPTION', subsystem: 'app' });
  });

  it('exposes no payload fields beyond the fixed test strings', () => {
    const api = createDevSentryTestApi();
    api.exception();
    const [, ctx] = captureWebException.mock.calls[0];
    expect(Object.keys(ctx as Record<string, unknown>).sort()).toEqual(['code', 'op', 'subsystem']);
  });
});
