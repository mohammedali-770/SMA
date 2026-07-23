/**
 * WEB-PLATFORM observability wiring for the customer app (Expo web export,
 * served at /app with React Native Web).
 *
 * Metro platform resolution picks THIS file instead of ./index.ts for web
 * builds only — iOS/Android keep the @sentry/react-native implementation from
 * PR #80 completely untouched. This module exports the exact same API surface
 * as ./index.ts so `_layout.tsx`, `ObservabilityErrorBoundary` and
 * `/dev-sentry` work unchanged on every platform; the implementation delegates
 * to the shared browser core (./webCore, @sentry/react) with the
 * 'expo-web' surface tag.
 */
import type React from 'react';

import {
  addSafeWebBreadcrumb, captureWebException, captureWebMessage, captureWebRenderError,
  initWebObservability, isWebObservabilityInitialized, setSafeWebContext,
  webObservabilityEnvironment, withWebErrorMonitoring,
} from './webCore';

export { SENTRY_DSN, SENTRY_ORG, SENTRY_PROJECT } from './config';
export { isExpectedError } from './classify';

import type { SentryEnvironment } from './config';

/** Same union as ./index.ts — keeps platform-agnostic app code compiling. */
export type ObservabilitySubsystem =
  | 'auth' | 'menu' | 'branch' | 'cart' | 'checkout' | 'payment' | 'orders'
  | 'lazywait' | 'account_deletion' | 'notifications' | 'operations_health'
  | 'operations_alerts' | 'app';

export interface SafeCaptureContext {
  subsystem?: ObservabilitySubsystem;
  op?: string;
  code?: string;
  extra?: Record<string, unknown>;
  tags?: Record<string, string | number | boolean>;
}

/** The environment the SDK was initialized with (for the dev test screen). */
export function observabilityEnvironment(): SentryEnvironment {
  return webObservabilityEnvironment();
}

/** True once init ran (idempotence guard; also used by the dev screen). */
export function isObservabilityInitialized(): boolean {
  return isWebObservabilityInitialized();
}

/**
 * Initialize browser Sentry exactly once for the Expo web export.
 *
 * Environment/release inputs are inlined by Metro from EXPO_PUBLIC_* values;
 * scripts/export-web.js maps Vercel's build metadata (VERCEL_ENV, commit sha)
 * into them so production/preview deploys are tagged correctly with zero
 * owner action. Hostname heuristics in webConfig cover any build where they
 * are absent.
 */
export function initObservability(): boolean {
  return initWebObservability({
    surface: 'expo-web',
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    explicitEnv: process.env.EXPO_PUBLIC_SENTRY_ENV,
    vercelEnv: process.env.EXPO_PUBLIC_VERCEL_ENV,
    commitSha: process.env.EXPO_PUBLIC_WEB_COMMIT_SHA,
    isDevBuild: __DEV__,
    devOptIn: process.env.EXPO_PUBLIC_SENTRY_DEV === '1',
    testRunnerEnv: {
      VITEST: process.env.VITEST,
      JEST_WORKER_ID: process.env.JEST_WORKER_ID,
      NODE_ENV: process.env.NODE_ENV,
    },
  });
}

/**
 * Root wrapper — identity on web. `Sentry.wrap` is a React Native construct
 * (touch boundary + native profiler); the browser SDK needs neither, and the
 * global error/rejection handlers are installed by Sentry.init.
 */
export function wrapRoot<P extends Record<string, unknown>>(
  component: React.ComponentType<P>,
): React.ComponentType<P> {
  return component;
}

/**
 * Capture an unexpected technical failure. Expected failures are downgraded
 * to a breadcrumb and NOT sent — same contract as the native implementation
 * (the shared core performs the classification and breadcrumb downgrade).
 */
export function captureException(error: unknown, ctx: SafeCaptureContext = {}): string | null {
  return captureWebException(error, ctx);
}

/** Capture a diagnostic message (warning-level by default). */
export function captureMessage(
  message: string,
  ctx: SafeCaptureContext & { level?: 'info' | 'warning' | 'error' } = {},
): string {
  return captureWebMessage(message, ctx);
}

/** Add a sanitized breadcrumb (never an event). */
export function addSafeBreadcrumb(input: {
  category: string;
  message: string;
  data?: Record<string, unknown>;
  level?: 'info' | 'warning' | 'error';
}): void {
  addSafeWebBreadcrumb(input);
}

/** Set persistent non-sensitive tags (scalars only; keys/values sanitized). */
export function setOperationalContext(tags: Record<string, string | number | boolean>): void {
  setSafeWebContext(tags);
}

/** Run an operation; capture (and rethrow) unexpected failures. */
export async function withErrorMonitoring<T>(
  fn: () => Promise<T>,
  ctx: SafeCaptureContext = {},
): Promise<T> {
  return withWebErrorMonitoring(fn, ctx);
}

/** Error-boundary capture: tags the event as a render error. */
export function captureRenderError(error: unknown, componentStack?: string | null): void {
  captureWebRenderError(error, componentStack, false);
}
