/**
 * Shared browser Sentry wiring for BOTH web surfaces (single implementation):
 *   - 'expo-web'  — the customer app exported with React Native Web, served
 *                   at /app (wired via ./index.web.ts, which Metro resolves in
 *                   place of ./index.ts on web builds only);
 *   - 'admin-web' — the staff console (root Vite app; wired via
 *                   src/lib/observability in the repository root).
 *
 * Native mobile builds NEVER load this module — Metro resolves ./index.ts for
 * iOS/Android, which keeps using @sentry/react-native exactly as merged in
 * PR #80.
 *
 * Everything privacy-critical is delegated to the framework-free, unit-tested
 * siblings: sanitize.ts (key/value scrubbing, span walking, breadcrumb drop
 * policy), classify.ts + webClassify.ts (expected-error filtering),
 * webRoutes.ts (route templating) and webConfig.ts (env/sampling/enable).
 *
 * Hard policy (mirrors mobile): no session replay, no screenshots, no
 * profiling, no user-feedback widget, no PII, no interaction breadcrumbs,
 * conservative tracing only.
 */
import * as Sentry from '@sentry/react';

import { errorMessage, formatComponentStack, shouldCaptureBoundaryError } from './classify';
import {
  sanitizeBreadcrumb, sanitizeEvent, sanitizeObject, sanitizeText, shouldDropBreadcrumb,
} from './sanitize';
import { classifyWebError } from './webClassify';
import {
  buildWebRelease, isWebSentryEnabled, isWebTestRunner, resolveWebEnvironment,
  WEB_DEFAULT_SENTRY_DSN, webSampleRates,
  type WebSentryEnvironment, type WebSurface,
} from './webConfig';
import { normalizeTransactionName, normalizeWebRoute } from './webRoutes';

export type { WebSentryEnvironment, WebSurface } from './webConfig';

/** Subsystem tags shared across surfaces; web adds admin panels over mobile's list. */
export type WebObservabilitySubsystem =
  | 'auth' | 'menu' | 'branch' | 'cart' | 'checkout' | 'payment' | 'orders'
  | 'lazywait' | 'account_deletion' | 'notifications' | 'operations_health'
  | 'operations_alerts' | 'reports' | 'integrations' | 'dashboard' | 'app';

export interface SafeWebCaptureContext {
  subsystem?: WebObservabilitySubsystem;
  /** Short machine-readable operation name, e.g. 'load_summary'. */
  op?: string;
  /** Safe error code, e.g. 'DASHBOARD_SUMMARY_FAILED'. Never raw provider text. */
  code?: string;
  /** Small scalar metadata only; deep-sanitized before sending. */
  extra?: Record<string, unknown>;
  /** Non-sensitive tags (strings/numbers/booleans). */
  tags?: Record<string, string | number | boolean>;
}

export interface WebObservabilityInput {
  surface: WebSurface;
  /** Optional DSN override from the runtime's public env; default DSN otherwise. */
  dsn?: string | null;
  /** VITE_SENTRY_ENV / EXPO_PUBLIC_SENTRY_ENV. */
  explicitEnv?: string | null;
  /** Vercel build environment when exposed (VITE_VERCEL_ENV). */
  vercelEnv?: string | null;
  /** Deploy commit sha for release naming, when exposed. */
  commitSha?: string | null;
  isDevBuild: boolean;
  /** Explicit development opt-in flag (VITE_SENTRY_DEV / EXPO_PUBLIC_SENTRY_DEV = '1'). */
  devOptIn: boolean;
  /** Test-runner detection material (MODE / NODE_ENV / VITEST / JEST_WORKER_ID). */
  testRunnerEnv: {
    VITEST?: string | boolean;
    JEST_WORKER_ID?: string;
    NODE_ENV?: string;
    MODE?: string;
  };
}

let initialized = false;
let resolvedEnv: WebSentryEnvironment = 'development';
let activeSurface: WebSurface = 'admin-web';

/** The environment the SDK was initialized with. */
export function webObservabilityEnvironment(): WebSentryEnvironment {
  return resolvedEnv;
}

/** True once init ran (idempotence guard; also used by dev test tooling). */
export function isWebObservabilityInitialized(): boolean {
  return initialized;
}

/**
 * Initialize browser Sentry exactly once for this runtime. Never throws — a
 * failed telemetry init must not break the application. Returns whether the
 * SDK is actually enabled (false when skipped or disabled by policy).
 */
export function initWebObservability(input: WebObservabilityInput): boolean {
  if (initialized) return false;
  initialized = true;
  activeSurface = input.surface;
  try {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
    resolvedEnv = resolveWebEnvironment({
      explicitEnv: input.explicitEnv,
      vercelEnv: input.vercelEnv,
      hostname,
      isDevBuild: input.isDevBuild,
    });
    const dsn = (input.dsn ?? '').trim() || WEB_DEFAULT_SENTRY_DSN;
    const enabled = isWebSentryEnabled({
      env: resolvedEnv,
      testRunner: isWebTestRunner(input.testRunnerEnv),
      hasDsn: Boolean(dsn),
      devOptIn: input.devOptIn,
    });
    const { tracesSampleRate, profilesSampleRate } = webSampleRates(resolvedEnv);

    Sentry.init({
      dsn,
      enabled,
      environment: resolvedEnv,
      release: buildWebRelease(input.commitSha),
      tracesSampleRate,
      profilesSampleRate,          // 0 — profiling disabled by policy
      sendDefaultPii: false,       // never IPs/usernames/cookies by default
      maxBreadcrumbs: 50,
      // Browser-extension frames are third-party noise, never our code.
      denyUrls: [
        /^chrome-extension:\/\//i,
        /^moz-extension:\/\//i,
        /^safari-(?:web-)?extension:\/\//i,
      ],
      // NO replayIntegration, NO feedbackIntegration, NO profiling
      // integration — all require separate owner approval. Conservative
      // pageload/navigation tracing only: interaction (INP) and long-task
      // instrumentation stay off.
      integrations: [
        Sentry.browserTracingIntegration({
          enableInp: false,
          enableLongTask: false,
          enableLongAnimationFrame: false,
        }),
      ],
      initialScope: { tags: { app_surface: input.surface } },
      beforeSend(event, hint) {
        // Expected, UI-handled failures never become events — even when they
        // escape as unhandled rejections (e.g. an aborted fetch).
        const original = hint?.originalException;
        if (classifyWebError(original ?? event.exception?.values?.[0]?.value) === 'expected') {
          return null;
        }
        if (typeof event.transaction === 'string') {
          event.transaction = normalizeTransactionName(event.transaction);
        }
        return sanitizeEvent(event);
      },
      beforeSendTransaction(event) {
        if (typeof event.transaction === 'string') {
          event.transaction = normalizeTransactionName(event.transaction);
        }
        return sanitizeEvent(event);
      },
      beforeBreadcrumb(crumb) {
        // Drops 'touch'/'ui.*' (clicks, inputs, DOM interactions) everywhere
        // and 'console' outside development — see sanitize.ts. Navigation
        // crumbs keep only TEMPLATED from/to routes.
        if (shouldDropBreadcrumb(crumb.category, resolvedEnv)) return null;
        if (crumb.category === 'navigation' && crumb.data) {
          const { from, to } = crumb.data as Record<string, unknown>;
          crumb.data = {
            ...(typeof from === 'string' ? { from: normalizeWebRoute(from) } : {}),
            ...(typeof to === 'string' ? { to: normalizeWebRoute(to) } : {}),
          };
        }
        return sanitizeBreadcrumb(crumb);
      },
    });
    return enabled;
  } catch {
    // Telemetry must never take the app down.
    return false;
  }
}

/**
 * Capture an unexpected technical failure. Expected web failures are
 * downgraded to a breadcrumb and NOT sent. Returns the event id or null.
 */
export function captureWebException(
  error: unknown,
  ctx: SafeWebCaptureContext = {},
): string | null {
  if (classifyWebError(error) === 'expected') {
    addSafeWebBreadcrumb({
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
export function captureWebMessage(
  message: string,
  ctx: SafeWebCaptureContext & { level?: 'info' | 'warning' | 'error' } = {},
): string {
  return Sentry.captureMessage(sanitizeText(message), (scope) => {
    scope.setLevel(ctx.level ?? 'warning');
    applyContext(scope, ctx);
    return scope;
  });
}

/** Add a sanitized breadcrumb (never an event). */
export function addSafeWebBreadcrumb(input: {
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
export function setSafeWebContext(tags: Record<string, string | number | boolean>): void {
  const clean = sanitizeObject(tags);
  for (const [k, v] of Object.entries(clean)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      Sentry.setTag(k, String(v));
    }
  }
}

/** Run an operation; capture (and rethrow) unexpected failures. */
export async function withWebErrorMonitoring<T>(
  fn: () => Promise<T>,
  ctx: SafeWebCaptureContext = {},
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    captureWebException(error, ctx);
    throw error;
  }
}

/**
 * Error-boundary capture: tags the event as a render error on this surface.
 * `alreadyCaptured` implements the capture-once contract (see
 * shouldCaptureBoundaryError); returns true when a capture happened.
 */
export function captureWebRenderError(
  error: unknown,
  componentStack: string | null | undefined,
  alreadyCaptured: boolean,
): boolean {
  if (!shouldCaptureBoundaryError(alreadyCaptured)) return false;
  Sentry.captureException(error, (scope) => {
    scope.setTag('mechanism', 'react_error_boundary');
    scope.setTag('app_surface', activeSurface);
    if (componentStack) {
      scope.setExtra('component_stack', sanitizeText(formatComponentStack(componentStack)));
    }
    return scope;
  });
  return true;
}

function applyContext(scope: Sentry.Scope, ctx: SafeWebCaptureContext): void {
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
