import { describe, expect, it } from 'vitest';
import {
  buildSentryRelease, DEFAULT_SENTRY_DSN, isSentryEnabled, isTestRunner,
  resolveSentryEnvironment, SENTRY_DSN, SENTRY_ORG, SENTRY_PROJECT, sentrySampleRates,
} from './config';

describe('Sentry identity', () => {
  it('matches the owner-provided org/project/DSN exactly', () => {
    expect(SENTRY_ORG).toBe('first-taste-trading-company');
    expect(SENTRY_PROJECT).toBe('react-native');
    expect(DEFAULT_SENTRY_DSN).toBe(
      'https://fcdc98794ff4488c9e1bc7ac4efed315@o4511778933243904.ingest.de.sentry.io/4511778937765968',
    );
  });

  it('the effective DSN honors the rotation override, else the default', () => {
    expect(SENTRY_DSN).toBe(process.env.EXPO_PUBLIC_SENTRY_DSN ?? DEFAULT_SENTRY_DSN);
  });

  it('the DSN is the public ingestion identifier, not a secret token shape', () => {
    expect(SENTRY_DSN.startsWith('https://')).toBe(true);
    expect(SENTRY_DSN).not.toMatch(/sntrys_/); // org auth tokens
    expect(SENTRY_DSN).not.toMatch(/sntryu_/); // user auth tokens
  });
});

describe('resolveSentryEnvironment', () => {
  it('explicit env from the EAS profile wins', () => {
    expect(resolveSentryEnvironment({ explicitEnv: 'production', isDev: true })).toBe('production');
    expect(resolveSentryEnvironment({ explicitEnv: 'preview', isDev: false })).toBe('preview');
    expect(resolveSentryEnvironment({ explicitEnv: ' Development ', isDev: false })).toBe('development');
  });

  it('invalid/missing explicit env falls back to __DEV__ semantics', () => {
    expect(resolveSentryEnvironment({ explicitEnv: 'staging?', isDev: true })).toBe('development');
    expect(resolveSentryEnvironment({ explicitEnv: null, isDev: false })).toBe('production');
    expect(resolveSentryEnvironment({ isDev: false })).toBe('production');
  });

  it('production and preview are distinguishable', () => {
    expect(resolveSentryEnvironment({ explicitEnv: 'production', isDev: false }))
      .not.toBe(resolveSentryEnvironment({ explicitEnv: 'preview', isDev: false }));
  });
});

describe('sentrySampleRates', () => {
  it('production tracing stays within the approved 0.05-0.10 band', () => {
    const { tracesSampleRate } = sentrySampleRates('production');
    expect(tracesSampleRate).toBeGreaterThanOrEqual(0.05);
    expect(tracesSampleRate).toBeLessThanOrEqual(0.10);
  });

  it('preview tracing stays at or under 0.20; development at 0', () => {
    expect(sentrySampleRates('preview').tracesSampleRate).toBeLessThanOrEqual(0.20);
    expect(sentrySampleRates('development').tracesSampleRate).toBe(0);
  });

  it('profiling is disabled in every environment', () => {
    for (const env of ['development', 'preview', 'production'] as const) {
      expect(sentrySampleRates(env).profilesSampleRate).toBe(0);
    }
  });
});

describe('isTestRunner', () => {
  it('is true under the current vitest run (so init stays disabled in tests)', () => {
    expect(isTestRunner()).toBe(true);
  });

  it('detects jest and NODE_ENV=test; false for a plain runtime env', () => {
    expect(isTestRunner({ JEST_WORKER_ID: '1' })).toBe(true);
    expect(isTestRunner({ NODE_ENV: 'test' })).toBe(true);
    expect(isTestRunner({ NODE_ENV: 'production' })).toBe(false);
    expect(isTestRunner({})).toBe(false);
  });
});

describe('isSentryEnabled', () => {
  it('never enabled in test runners or without a DSN', () => {
    expect(isSentryEnabled({ env: 'production', testRunner: true, hasDsn: true, devOptIn: true })).toBe(false);
    expect(isSentryEnabled({ env: 'production', testRunner: false, hasDsn: false, devOptIn: true })).toBe(false);
  });

  it('development requires the explicit opt-in flag', () => {
    expect(isSentryEnabled({ env: 'development', testRunner: false, hasDsn: true, devOptIn: false })).toBe(false);
    expect(isSentryEnabled({ env: 'development', testRunner: false, hasDsn: true, devOptIn: true })).toBe(true);
  });

  it('preview and production report by default', () => {
    expect(isSentryEnabled({ env: 'preview', testRunner: false, hasDsn: true, devOptIn: false })).toBe(true);
    expect(isSentryEnabled({ env: 'production', testRunner: false, hasDsn: true, devOptIn: false })).toBe(true);
  });
});

describe('buildSentryRelease', () => {
  it('pins the canonical <bundle id>@<version>+<build> contract', () => {
    expect(buildSentryRelease({ appId: 'com.spicymeal.app', version: '1.0.0', build: '42' }))
      .toBe('com.spicymeal.app@1.0.0+42');
    expect(buildSentryRelease({ appId: 'sa.com.spicymeal.app', version: '1.0.0', build: '7' }))
      .toBe('sa.com.spicymeal.app@1.0.0+7');
  });

  it('returns undefined when any part is missing (SDK native default wins)', () => {
    expect(buildSentryRelease({ appId: 'x', version: null, build: '1' })).toBeUndefined();
    expect(buildSentryRelease({ appId: null, version: '1', build: '1' })).toBeUndefined();
    expect(buildSentryRelease({ appId: 'x', version: '1', build: undefined })).toBeUndefined();
  });
});
