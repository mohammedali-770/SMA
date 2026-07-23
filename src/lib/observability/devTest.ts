/**
 * DEVELOPMENT-ONLY Sentry verification hooks for the admin console.
 *
 * Registered exclusively inside `if (import.meta.env.DEV)` at the call site,
 * so Vite statically eliminates the registration from production bundles —
 * there is no customer- or staff-reachable trigger in a deployed build, no
 * navigation entry, and nothing executes automatically.
 *
 * Usage (local dev console, with VITE_SENTRY_DEV=1 to actually send):
 *   __spicySentryTest.message()    — captured warning message
 *   __spicySentryTest.exception()  — handled exception (safe_error_code DEV_TEST_EXCEPTION)
 *   __spicySentryTest.rejection()  — unhandled promise rejection
 *   __spicySentryTest.render()     — throws on next render (exercises the boundary)
 */
import {
  captureWebException, captureWebMessage, isWebObservabilityInitialized,
  webObservabilityEnvironment,
} from './index';

export interface DevSentryTestApi {
  status(): { initialized: boolean; environment: string };
  message(): void;
  exception(): void;
  rejection(): void;
}

/** Build the dev test API (framework-free; unit-testable). */
export function createDevSentryTestApi(): DevSentryTestApi {
  return {
    status() {
      return {
        initialized: isWebObservabilityInitialized(),
        environment: webObservabilityEnvironment(),
      };
    },
    message() {
      captureWebMessage('dev-sentry-web: test message', {
        subsystem: 'app', op: 'dev_test', level: 'warning',
      });
    },
    exception() {
      captureWebException(new Error('dev-sentry-web: handled test exception'), {
        subsystem: 'app', op: 'dev_test', code: 'DEV_TEST_EXCEPTION',
      });
    },
    rejection() {
      // Deliberately unhandled — exercises the global rejection handler.
      void Promise.reject(new Error('dev-sentry-web: test unhandled rejection'));
    },
  };
}

/** Attach the API to window. Call ONLY behind `if (import.meta.env.DEV)`. */
export function registerDevSentryTest(): void {
  (window as unknown as Record<string, unknown>).__spicySentryTest = createDevSentryTestApi();
}
