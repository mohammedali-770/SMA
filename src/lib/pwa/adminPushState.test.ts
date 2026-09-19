import { describe, expect, it } from 'vitest';
import { isActionable, resolveAdminPushState, type AdminPushInputs } from './adminPushState';

const ready: AdminPushInputs = {
  readiness: 'ready',
  permission: 'granted',
  configured: true,
  subscribed: false,
};

describe('resolveAdminPushState', () => {
  it('is off when everything is ready and this device is not subscribed', () => {
    expect(resolveAdminPushState(ready)).toBe('off');
  });

  it('is on when this device is subscribed', () => {
    expect(resolveAdminPushState({ ...ready, subscribed: true })).toBe('on');
  });

  it('passes each platform verdict straight through', () => {
    for (const r of ['unsupported', 'needs-install', 'needs-reinstall'] as const) {
      expect(resolveAdminPushState({ ...ready, readiness: r })).toBe(r);
    }
  });

  it('reports the platform problem even when everything else looks perfect', () => {
    // An iPhone in Safari with permission granted and a key configured is still
    // an iPhone in Safari. Saying "off" here would offer a button that silently
    // cannot work.
    expect(
      resolveAdminPushState({
        readiness: 'needs-install',
        permission: 'granted',
        configured: true,
        subscribed: true,
      }),
    ).toBe('needs-install');
  });

  it('reports a denial ahead of a missing key, because re-granting is the next step', () => {
    expect(resolveAdminPushState({ ...ready, permission: 'denied', configured: false })).toBe('denied');
  });

  it('reports not-configured ahead of off, rather than offering a dead button', () => {
    expect(resolveAdminPushState({ ...ready, configured: false })).toBe('not-configured');
  });

  it('does not claim "on" when the server has no key, whatever is stored locally', () => {
    // A stored subscription with no VAPID key server-side can never be pushed to.
    expect(resolveAdminPushState({ ...ready, configured: false, subscribed: true })).toBe('not-configured');
  });

  it('treats an unknown permission as workable — default is not denied', () => {
    expect(resolveAdminPushState({ ...ready, permission: 'unknown' })).toBe('off');
    expect(resolveAdminPushState({ ...ready, permission: 'default' })).toBe('off');
  });
});

describe('isActionable', () => {
  it('is true only for the two states the admin can act on with a tap', () => {
    expect(isActionable('on')).toBe(true);
    expect(isActionable('off')).toBe(true);
    for (const s of [
      'unsupported',
      'needs-install',
      'needs-reinstall',
      'denied',
      'not-configured',
    ] as const) {
      expect(isActionable(s)).toBe(false);
    }
  });
});
