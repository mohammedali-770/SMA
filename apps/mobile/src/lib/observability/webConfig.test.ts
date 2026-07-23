import { describe, expect, it } from 'vitest';
import { DEFAULT_SENTRY_DSN, isSentryEnabled } from './config';
import {
  buildWebRelease, isWebSentryEnabled, isWebTestRunner, resolveWebEnvironment,
  SENTRY_INGEST_ORIGIN, WEB_DEFAULT_SENTRY_DSN, webSampleRates,
} from './webConfig';

describe('web Sentry identity', () => {
  it('pins the web DSN to the exact mobile default DSN (no drift)', () => {
    expect(WEB_DEFAULT_SENTRY_DSN).toBe(DEFAULT_SENTRY_DSN);
  });

  it('the ingest origin matches the DSN host (CSP connect-src contract)', () => {
    expect(WEB_DEFAULT_SENTRY_DSN).toContain(SENTRY_INGEST_ORIGIN.replace('https://', ''));
    expect(SENTRY_INGEST_ORIGIN.startsWith('https://')).toBe(true);
  });

  it('is the public ingestion identifier, not a secret token shape', () => {
    expect(WEB_DEFAULT_SENTRY_DSN).not.toMatch(/sntrys_/);
    expect(WEB_DEFAULT_SENTRY_DSN).not.toMatch(/sntryu_/);
  });
});

describe('resolveWebEnvironment', () => {
  it('explicit env override wins over everything', () => {
    expect(resolveWebEnvironment({
      explicitEnv: 'preview', vercelEnv: 'production', hostname: 'localhost', isDevBuild: true,
    })).toBe('preview');
    expect(resolveWebEnvironment({ explicitEnv: ' Production ', isDevBuild: true })).toBe('production');
  });

  it('Vercel build environment is used when exposed', () => {
    expect(resolveWebEnvironment({ vercelEnv: 'preview', isDevBuild: false })).toBe('preview');
    expect(resolveWebEnvironment({ vercelEnv: 'production', isDevBuild: false })).toBe('production');
    expect(resolveWebEnvironment({ vercelEnv: 'development', isDevBuild: false })).toBe('development');
  });

  it('hostname heuristics: localhost is development, -git- vercel URLs are preview', () => {
    expect(resolveWebEnvironment({ hostname: 'localhost', isDevBuild: false })).toBe('development');
    expect(resolveWebEnvironment({ hostname: '127.0.0.1', isDevBuild: false })).toBe('development');
    expect(resolveWebEnvironment({
      hostname: 'sma-git-feature-x-team.vercel.app', isDevBuild: false,
    })).toBe('preview');
  });

  it('defaults: dev build → development; release host → production (strictest rules)', () => {
    expect(resolveWebEnvironment({ isDevBuild: true })).toBe('development');
    expect(resolveWebEnvironment({ hostname: 'sma.vercel.app', isDevBuild: false })).toBe('production');
    expect(resolveWebEnvironment({ hostname: 'www.spicymeal.example', isDevBuild: false })).toBe('production');
    expect(resolveWebEnvironment({ explicitEnv: 'staging?', isDevBuild: false })).toBe('production');
  });
});

describe('webSampleRates', () => {
  it('production tracing stays within the approved band; preview ≤ 0.15; dev 0', () => {
    expect(webSampleRates('production').tracesSampleRate).toBe(0.05);
    expect(webSampleRates('preview').tracesSampleRate).toBeLessThanOrEqual(0.15);
    expect(webSampleRates('development').tracesSampleRate).toBe(0);
  });

  it('profiling is disabled in every environment', () => {
    for (const env of ['development', 'preview', 'production'] as const) {
      expect(webSampleRates(env).profilesSampleRate).toBe(0);
    }
  });
});

describe('isWebTestRunner', () => {
  it('detects vitest (VITEST flag or MODE=test), jest, and NODE_ENV=test', () => {
    expect(isWebTestRunner({ VITEST: 'true' })).toBe(true);
    expect(isWebTestRunner({ MODE: 'test' })).toBe(true);
    expect(isWebTestRunner({ JEST_WORKER_ID: '1' })).toBe(true);
    expect(isWebTestRunner({ NODE_ENV: 'test' })).toBe(true);
    expect(isWebTestRunner({ MODE: 'production' })).toBe(false);
    expect(isWebTestRunner({})).toBe(false);
  });
});

describe('isWebSentryEnabled', () => {
  it('mirrors the mobile enable-switch semantics exactly', () => {
    for (const env of ['development', 'preview', 'production'] as const) {
      for (const testRunner of [true, false]) {
        for (const hasDsn of [true, false]) {
          for (const devOptIn of [true, false]) {
            const input = { env, testRunner, hasDsn, devOptIn };
            expect(isWebSentryEnabled(input), JSON.stringify(input))
              .toBe(isSentryEnabled(input));
          }
        }
      }
    }
  });

  it('never enabled in test runners; dev requires the explicit opt-in flag', () => {
    expect(isWebSentryEnabled({ env: 'production', testRunner: true, hasDsn: true, devOptIn: true })).toBe(false);
    expect(isWebSentryEnabled({ env: 'development', testRunner: false, hasDsn: true, devOptIn: false })).toBe(false);
    expect(isWebSentryEnabled({ env: 'development', testRunner: false, hasDsn: true, devOptIn: true })).toBe(true);
    expect(isWebSentryEnabled({ env: 'preview', testRunner: false, hasDsn: true, devOptIn: false })).toBe(true);
  });
});

describe('buildWebRelease', () => {
  it('pins the spicy-meal-web@<sha12> contract', () => {
    expect(buildWebRelease('22e5aca5ad03a680740fc405fcebe35275e959c3'))
      .toBe('spicy-meal-web@22e5aca5ad03');
    expect(buildWebRelease('ABCDEF1')).toBe('spicy-meal-web@abcdef1');
  });

  it('returns undefined for missing or non-sha input (SDK default wins)', () => {
    expect(buildWebRelease(undefined)).toBeUndefined();
    expect(buildWebRelease('')).toBeUndefined();
    expect(buildWebRelease('not-a-sha!')).toBeUndefined();
  });
});
