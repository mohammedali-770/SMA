/**
 * A `fetch` that gives up on a stalled database READ.
 *
 * Neither layer under the app sets a timeout of its own: React Native's
 * Android networking sets no connect, read or write timeout, and supabase-js
 * adds none. On a stalled connection a catalogue read therefore stayed pending
 * indefinitely, and `CatalogProvider` stayed in `loading` with it, so the first
 * screen showed a spinner and never the Retry button that only an error
 * reveals. This wrapper turns "pending for ever" into an ordinary error after
 * `READ_TIMEOUT_MS`, which the existing error and Retry path already handles.
 *
 * Deliberately narrow. It applies only to GET and HEAD requests to PostgREST
 * (`/rest/v1/`). Everything else passes through to the underlying fetch with
 * its arguments untouched:
 *  - POST, PATCH and DELETE, which covers every RPC and so order placement. A
 *    write that is abandoned client-side may still commit server-side, and
 *    timing it out would invite a retry that the idempotency key then has to
 *    rescue.
 *  - `/functions/v1/`, the Edge Functions, which carry payment and order
 *    intake.
 *  - `/auth/v1/`, so a slow token or user read is never turned into an error
 *    the auth client might act on.
 *
 * `AbortSignal.timeout` and `AbortSignal.any` are not reliably present on
 * React Native's JavaScript engines, so the timeout is a plain `setTimeout`
 * and a caller's own signal is composed by hand.
 *
 * The abort carries no reason on purpose. Without one, fetch rejects with an
 * `AbortError`, which postgrest-js never retries, and which the app's failure
 * classifier reads as a timeout. A custom reason would surface under its own
 * name instead, and postgrest-js retries a rejection it does not recognise.
 *
 * Framework-free: no React Native, Expo or Supabase import, so it is unit
 * tested under Node.
 */

/** How long a read may take before it is abandoned. */
export const READ_TIMEOUT_MS = 20_000;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function requestOf(input: RequestInfo | URL): Request | null {
  return typeof Request !== 'undefined' && input instanceof Request ? input : null;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  const req = requestOf(input);
  if (req) return req.url;
  return String(input);
}

/**
 * True when this request is one the timeout applies to: a GET or HEAD to
 * PostgREST. Exported so the boundary itself is tested, not only its effect.
 */
export function isTimedRead(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? requestOf(input)?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  return urlOf(input).includes('/rest/v1/');
}

/**
 * Build the wrapper around a given fetch. `baseFetch` is resolved at call time
 * when omitted, so a fetch installed after this module loads is still the one
 * used.
 */
export function createReadTimeoutFetch(
  baseFetch?: FetchLike,
  timeoutMs: number = READ_TIMEOUT_MS,
): FetchLike {
  return (input, init) => {
    const doFetch: FetchLike = baseFetch ?? ((i, o) => fetch(i, o));
    if (!isTimedRead(input, init)) return doFetch(input, init);

    const controller = new AbortController();
    const callerSignal = init?.signal ?? requestOf(input)?.signal ?? null;
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason);
      else callerSignal.addEventListener('abort', onCallerAbort);
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const settle = () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    };

    let pending: Promise<Response>;
    try {
      pending = doFetch(input, { ...init, signal: controller.signal });
    } catch (e) {
      // A fetch that throws synchronously still answers with a rejection, as
      // the real one does.
      settle();
      return Promise.reject(e);
    }
    return pending.then(
      (res) => {
        settle();
        return res;
      },
      (err: unknown) => {
        settle();
        throw err;
      },
    );
  };
}

/** The instance passed to the app's Supabase client as `global.fetch`. */
export const readTimeoutFetch: FetchLike = createReadTimeoutFetch();
