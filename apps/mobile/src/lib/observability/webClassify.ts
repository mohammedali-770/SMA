/**
 * Web-specific expected-error classification — FRAMEWORK-FREE, unit-tested.
 *
 * Layers browser-only noise on top of the shared mobile classification
 * (./classify) WITHOUT modifying it: the mobile list stays exactly as merged
 * in PR #80, and native builds never see these web patterns.
 *
 * Expected (ignored / breadcrumb-only) on web:
 *  - benign browser-internal noise (ResizeObserver loop warnings);
 *  - aborted requests/navigations (AbortError — user navigated away);
 *  - generic browser fetch failures already covered by the shared list.
 *
 * Deliberately still CAPTURED (actionable):
 *  - dynamic-import/chunk load failures (deploy version skew signal);
 *  - invalid API response shapes, render crashes, impossible states.
 */
import { errorMessage, isExpectedError } from './classify';

const WEB_EXPECTED_PATTERNS: ReadonlyArray<RegExp> = [
  /resizeobserver loop/i,
  /\baborterror\b/i,
  /signal is aborted/i,
  /the operation was aborted/i,
  /fetch is aborted/i,
  /load cancelled/i,
];

/**
 * Overrides checked FIRST: failure shapes that superficially match an
 * expected pattern but are actionable on web. A chunk/dynamic-import fetch
 * failure contains "failed to fetch" (expected connectivity noise on the
 * shared list) yet on a deployed SPA it usually means version skew — stale
 * HTML referencing purged hashed assets — which must be visible.
 */
const WEB_ALWAYS_CAPTURE_PATTERNS: ReadonlyArray<RegExp> = [
  /dynamically imported module/i,
  /importing a module script failed/i,
  /chunkloaderror/i,
];

/** True when a web error is expected, UI-handled noise (shared list + web list). */
export function isExpectedWebError(error: unknown): boolean {
  const message = errorMessage(error);
  const name = (error as { name?: unknown } | null | undefined)?.name;
  const haystack = `${typeof name === 'string' ? name : ''} ${message}`;
  if (WEB_ALWAYS_CAPTURE_PATTERNS.some((re) => re.test(haystack))) return false;
  if (isExpectedError(error)) return true;
  return WEB_EXPECTED_PATTERNS.some((re) => re.test(haystack));
}

/** 'capture' for actionable failures, 'expected' for UI-handled outcomes. */
export function classifyWebError(error: unknown): 'capture' | 'expected' {
  return isExpectedWebError(error) ? 'expected' : 'capture';
}
