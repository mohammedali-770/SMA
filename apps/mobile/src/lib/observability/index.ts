/**
 * Observability wiring for the Spicy Meal mobile app (Sentry).
 *
 * Everything React-Native/Sentry-specific lives HERE; the sibling modules
 * (config/sanitize/classify) are framework-free and unit-tested by the root
 * vitest suite. Screens and services should use the safe API below instead of
 * importing @sentry/react-native directly:
 *
 *   captureException(err, { subsystem: 'checkout', op: 'init', code: 'CHECKOUT_INIT' })
 *   captureMessage('payment return parsed with fallback', { subsystem: 'payment' })
 *   addSafeBreadcrumb({ category: 'checkout', message: 'coupon rejected (expected)' })
 *   setOperationalContext({ order_type: 'pickup' })
 *   await withErrorMonitoring(() => api.placeOrder(...), { subsystem: 'orders', op: 'place' })
 *
 * The API sanitizes every metadata object and silently downgrades EXPECTED
 * failures (offline, cancelled, business declines — see classify.ts) to
 * breadcrumbs, so passing raw provider errors cannot leak PII or create noise.
 * Do NOT pass customer/order/payment objects; sanitization redacts them, but
 * the contract is safe codes + subsystem + operation + small scalar metadata.
 */
import * as Sentry from '@sentry/react-native';
import type React from 'react';
import { Platform } from 'react-native';

import {
  isSentryEnabled, isTestRunner, resolveSentryEnvironment, sentrySampleRates,
  SENTRY_DSN, type SentryEnvironment,
} from './config';
import { classifyError, errorMessage, formatComponentStack } from './classify';
import {
  sanitizeBreadcrumb, sanitizeEvent, sanitizeObject, sanitizeText, shouldDropBreadcrumb,
} from './sanitize';

export { SENTRY_DSN, SENTRY_ORG, SENTRY_PROJECT } from './config';
export { isExpectedError } from './classify';

/** Subsystems used as the `subsystem` tag. Keep this list in sync with docs. */
export type ObservabilitySubsystem =
  | 'auth' | 'menu' | 'branch' | 'cart' | 'checkout' | 'payment' | 'orders'
  | 'lazywait' | 'account_deletion' | 'notifications' | 'operations_health'
  | 'operations_alerts' | 'app';

export interface SafeCaptureContext {
  subsystem?: ObservabilitySubsystem;
  /** Short machine-readable operation name, e.g. 'load_menu'. */
  op?: string;
  /** Safe error code, e.g. 'CHECKOUT_INIT_FAILED'. Never raw provider text. */
  code?: string;
  /** Small scalar metadata only; deep-sanitized before sending. */
  extra?: Record<string, unknown>;
  /** Non-sensitive tags (strings/numbers/booleans). */
  tags?: Record<string, string | number | boolean>;
}

let initialized = false;
let resolvedEnv: SentryEnvironment = 'development';

/** The environment the SDK was initialized with (for the dev test screen). */
export function observabilityEnvironment(): SentryEnvironment {
  return resolvedEnv;
}

/** True once init ran (idempotence guard; also used by the dev screen). */
export function isObservabilityInitialized(): boolean {
  return initialized;
}

/**
 * Initialize Sentry exactly once, at app entry (imported by the root layout).
 *
 * Returns false when skipped (already initialized, web platform, or test
 * runner). Web is deliberately NOT initialized in v1 — the Expo web export and
 * the Vite admin app are tracked as a separate follow-up so the mobile
 * integration ships without experimental web-SDK risk.
 */
export function initObservability(): boolean {
  if (initialized) return false;
  if (Platform.OS === 'web') return false;

  const testRunner = isTestRunner();
  resolvedEnv = resolveSentryEnvironment({
    explicitEnv: process.env.EXPO_PUBLIC_SENTRY_ENV,
    isDev: __DEV__,
  });
  const enabled = isSentryEnabled({
    env: resolvedEnv,
    testRunner,
    hasDsn: Boolean(SENTRY_DSN),
    devOptIn: process.env.EXPO_PUBLIC_SENTRY_DEV === '1',
  });
  const { tracesSampleRate, profilesSampleRate } = sentrySampleRates(resolvedEnv);

  Sentry.init({
    dsn: SENTRY_DSN,
    enabled,
    environment: resolvedEnv,
    // Release/dist deliberately use the SDK's native defaults
    // (<bundle id>@<version>+<build>), which track EAS remote versioning
    // exactly. See config.buildSentryRelease for the pinned naming contract.

    // Crash coverage: native crash handling, unhandled JS errors and
    // unhandled promise rejections are all ON by default in this SDK.
    tracesSampleRate,
    profilesSampleRate,          // 0 — profiling disabled until approved
    sendDefaultPii: false,       // never IPs/usernames by default
    attachScreenshot: false,     // requires separate owner approval
    attachViewHierarchy: false,
    maxBreadcrumbs: 50,
    // Session replay stays fully disabled (requires separate owner approval).
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    enableCaptureFailedRequests: false, // no request/response capture
    enableUserInteractionTracing: false, // no user-interaction SPANS; the
    // touch BREADCRUMBS Sentry.wrap emits are dropped in beforeBreadcrumb
    integrations(defaults) {
      return [
        // Expo Router instrumentation: navigation spans + breadcrumbs with
        // TEMPLATED paths (dynamic segments like [id] are never raw values).
        ...defaults,
        Sentry.expoRouterIntegration(),
      ];
    },
    beforeSend(event, hint) {
      // Expected, UI-handled failures never become events — even when they
      // escape as unhandled rejections (e.g. an offline fetch).
      const original = hint?.originalException;
      if (classifyError(original ?? event.exception?.values?.[0]?.value) === 'expected') {
        return null;
      }
      return sanitizeEvent(event);
    },
    beforeSendTransaction(event) {
      return sanitizeEvent(event);
    },
    beforeBreadcrumb(crumb) {
      // Drops 'touch' crumbs (component paths + labels of tapped UI) in every
      // environment and 'console' noise outside development — see sanitize.ts.
      if (shouldDropBreadcrumb(crumb.category, resolvedEnv)) return null;
      return sanitizeBreadcrumb(crumb);
    },
  });

  initialized = true;
  return enabled;
}

/**
 * Root-component wrapper (profiler + touch-event boundary). The boundary's
 * 'touch' breadcrumbs never leave the device — beforeBreadcrumb drops them.
 */
export function wrapRoot<P extends Record<string, unknown>>(
  component: React.ComponentType<P>,
): React.ComponentType<P> {
  return Sentry.wrap(component);
}

/**
 * Capture an unexpected technical failure. Expected failures (see classify.ts)
 * are downgraded to a breadcrumb and NOT sent. Returns the event id, or null
 * when the error was expected.
 */
export function captureException(error: unknown, ctx: SafeCaptureContext = {}): string | null {
  if (classifyError(error) === 'expected') {
    addSafeBreadcrumb({
      category: ctx.subsystem ?? 'app',
      message: `expected: ${sanitizeText(errorMessage(error)).slice(0, 200)}`,
    });
    return null;
  }
  return Sentry.captureException(error, (scope) => {
    applyContext(scope, ctx);
    return scope;
  });
}

/** Capture a diagnostic message (warning-level by default). */
export function captureMessage(
  message: string,
  ctx: SafeCaptureContext & { level?: 'info' | 'warning' | 'error' } = {},
): string {
  return Sentry.captureMessage(sanitizeText(message), (scope) => {
    scope.setLevel(ctx.level ?? 'warning');
    applyContext(scope, ctx);
    return scope;
  });
}

/** Add a sanitized breadcrumb (never an event). */
export function addSafeBreadcrumb(input: {
  category: string;
  message: string;
  data?: Record<string, unknown>;
  level?: 'info' | 'warning' | 'error';
}): void {
  Sentry.addBreadcrumb(sanitizeBreadcrumb({
    category: input.category,
    message: input.message,
    level: input.level ?? 'info',
    data: input.data,
  }));
}

/** Set persistent non-sensitive tags (scalars only; keys/values sanitized). */
export function setOperationalContext(tags: Record<string, string | number | boolean>): void {
  const clean = sanitizeObject(tags);
  for (const [k, v] of Object.entries(clean)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      Sentry.setTag(k, String(v));
    }
  }
}

/** Run an operation; capture (and rethrow) unexpected failures. */
export async function withErrorMonitoring<T>(
  fn: () => Promise<T>,
  ctx: SafeCaptureContext = {},
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    captureException(error, ctx);
    throw error;
  }
}

/** Error-boundary capture: tags the event as a render error. */
export function captureRenderError(error: unknown, componentStack?: string | null): void {
  Sentry.captureException(error, (scope) => {
    scope.setTag('mechanism', 'react_error_boundary');
    if (componentStack) {
      scope.setExtra('component_stack', sanitizeText(formatComponentStack(componentStack)));
    }
    return scope;
  });
}

function applyContext(scope: Sentry.Scope, ctx: SafeCaptureContext): void {
  if (ctx.subsystem) scope.setTag('subsystem', ctx.subsystem);
  if (ctx.op) scope.setTag('op', sanitizeText(ctx.op).slice(0, 64));
  if (ctx.code) scope.setTag('safe_error_code', sanitizeText(ctx.code).slice(0, 64));
  if (ctx.tags) {
    const clean = sanitizeObject(ctx.tags);
    for (const [k, v] of Object.entries(clean)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        scope.setTag(k, String(v));
      }
    }
  }
  if (ctx.extra) scope.setContext('operation', sanitizeObject(ctx.extra));
}
