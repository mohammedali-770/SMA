import { describe, expect, it } from 'vitest';

import {
  applyDeactivate, applyRegister, isValidExpoToken, orderUpdateTargets, type PushDeviceRecord,
} from './pushDeviceOwnership';

const TOKEN = 'ExponentPushToken[abc123DEF456]';

const reg = (customerId: string, over: Partial<Parameters<typeof applyRegister>[1]> = {}) => ({
  customerId, token: TOKEN, lang: 'en' as const,
  orderUpdatesEnabled: true, promosEnabled: false, ...over,
});

describe('cross-account token transfer (Codex P1 scenarios)', () => {
  it('A registers → A owns the token and is targeted', () => {
    const registry = applyRegister([], reg('user-a'));
    expect(registry).toHaveLength(1);
    expect(registry[0].customerId).toBe('user-a');
    expect(orderUpdateTargets(registry, 'user-a')).toHaveLength(1);
  });

  it('A logs out → deactivation stops targeting; deactivation is IDEMPOTENT', () => {
    let registry = applyRegister([], reg('user-a'));
    registry = applyDeactivate(registry, TOKEN);
    expect(orderUpdateTargets(registry, 'user-a')).toHaveLength(0);
    // calling it again changes nothing
    expect(applyDeactivate(registry, TOKEN)).toEqual(registry);
  });

  it('B registers the SAME token → the token belongs ONLY to B; A is no longer targeted', () => {
    let registry = applyRegister([], reg('user-a'));
    registry = applyDeactivate(registry, TOKEN); // A logs out
    registry = applyRegister(registry, reg('user-b'));
    expect(registry).toHaveLength(1); // no duplicate active ownership
    expect(registry[0].customerId).toBe('user-b');
    expect(registry[0].isActive).toBe(true);
    expect(orderUpdateTargets(registry, 'user-a')).toHaveLength(0);
    expect(orderUpdateTargets(registry, 'user-b')).toHaveLength(1);
  });

  it('transfer works EVEN IF A\'s logout cleanup never ran (registration is sufficient)', () => {
    let registry = applyRegister([], reg('user-a')); // A never deactivated
    registry = applyRegister(registry, reg('user-b'));
    expect(registry).toHaveLength(1);
    expect(registry[0].customerId).toBe('user-b');
    expect(orderUpdateTargets(registry, 'user-a')).toHaveLength(0);
  });

  it('stale preferences from the previous owner are NOT inherited', () => {
    let registry = applyRegister([], reg('user-a', { orderUpdatesEnabled: true, promosEnabled: true, lang: 'ar' }));
    registry = applyRegister(registry, reg('user-b', { orderUpdatesEnabled: true, promosEnabled: false, lang: 'en' }));
    expect(registry[0].promosEnabled).toBe(false); // B never opted into promos
    expect(registry[0].lang).toBe('en');
  });

  it('two different devices (tokens) can belong to two customers independently', () => {
    const other: PushDeviceRecord = {
      customerId: 'user-c', token: 'ExpoPushToken[zzz999]', isActive: true,
      orderUpdatesEnabled: true, promosEnabled: false, lang: 'ar',
    };
    const registry = applyRegister([other], reg('user-a'));
    expect(registry).toHaveLength(2);
    expect(orderUpdateTargets(registry, 'user-c')).toHaveLength(1);
  });
});

describe('token format guard (registry never holds arbitrary strings)', () => {
  it('accepts real Expo token shapes only', () => {
    expect(isValidExpoToken('ExponentPushToken[abc123DEF456]')).toBe(true);
    expect(isValidExpoToken('ExpoPushToken[a-b_c123]')).toBe(true);
  });
  it('rejects arbitrary strings, URLs, and injections', () => {
    expect(isValidExpoToken('hello')).toBe(false);
    expect(isValidExpoToken('https://evil.example/x')).toBe(false);
    expect(isValidExpoToken('ExponentPushToken[abc]; drop table orders;')).toBe(false);
    expect(() => applyRegister([], reg('user-a', { token: 'garbage' }))).toThrow();
  });
});
