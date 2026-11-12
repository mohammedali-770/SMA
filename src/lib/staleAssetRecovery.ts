/**
 * Recovery for a console tab that outlived its deploy.
 *
 * Every merge to the default branch deploys (CLAUDE.md §13), and a deploy
 * replaces the content-hashed chunks the console loads lazily (AdminDashboard,
 * OpsConsole, the branch and zone modals). A tab opened before the deploy — an
 * installed console is meant to stay open for web push — still asks for the old
 * names. Vite reports that failure as a `vite:preloadError` event on `window`,
 * and without a listener the panel shows "Something unexpected went wrong",
 * whose "Try again" re-renders the same rejected import and cannot recover.
 *
 * What this does, once per failure burst:
 *   1. refetches every failing URL with `cache: 'reload'`. The response for a
 *      missing chunk carries the immutable header (vercel.json attaches headers
 *      by path, whatever the status), so a browser may hold the miss for a year;
 *      a reload fetch overwrites that cache entry. It is what lets a tab recover
 *      after a Vercel ROLLBACK, when the old chunk exists again but the cached
 *      miss would still be served;
 *   2. reloads the page, which revalidates index.html and so picks up the
 *      current deploy's chunk names.
 *
 * A sessionStorage timestamp stops a genuinely broken deploy from reloading in
 * a loop: a second failure within RELOAD_GUARD_WINDOW_MS of the last reload is
 * left to the error boundary. If sessionStorage cannot be written, the guard
 * cannot work, so nothing is reloaded.
 *
 * The event is deliberately NOT cancelled. Cancelling makes Vite resolve the
 * import to `undefined`, which React reports as a different, misleading error;
 * letting the original error through keeps the real cause in Sentry for the
 * moment before the reload.
 *
 * The decisions are pure and injected so `staleAssetRecovery.test.ts` can drive
 * them without a browser.
 */

export const RELOAD_GUARD_KEY = 'sm-stale-asset-reload-at';
/** A failure this soon after our own reload means the reload did not help. */
export const RELOAD_GUARD_WINDOW_MS = 60_000;
/** Failures arriving this close together are one burst: one refetch round, one reload. */
export const COLLECT_MS = 100;
/** A refetch that has not answered by now does not hold the reload back. */
export const REFETCH_TIMEOUT_MS = 4_000;

/**
 * The same-origin URL a preload error names, or null.
 *
 * Chrome: "Failed to fetch dynamically imported module: https://host/assets/X.js".
 * Firefox: "error loading dynamically imported module: https://host/assets/X.js".
 * Vite's CSS preload: "Unable to preload CSS for /assets/X.css".
 * Safari names no URL ("Importing a module script failed."), so it gets the
 * reload without the refetch.
 *
 * Only same-origin URLs are returned: the error text is not ours, and nothing
 * here should fetch a URL somebody else chose.
 */
export function failedAssetUrl(reason: unknown, pageOrigin: string): string | null {
  const message =
    typeof reason === 'string'
      ? reason
      : reason instanceof Error
        ? reason.message
        : typeof (reason as { message?: unknown } | null)?.message === 'string'
          ? (reason as { message: string }).message
          : '';
  const candidate = message.match(/(?:https?:\/\/|\/)[^\s'"<>()]+/)?.[0];
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate.replace(/[.,;:]+$/, ''), pageOrigin);
  } catch {
    return null;
  }
  return url.origin === new URL(pageOrigin).origin ? url.href : null;
}

/** Whether a failure at `nowMs` may reload, given the timestamp of the last reload (or null). */
export function mayReload(
  nowMs: number,
  lastReloadAt: string | null,
  windowMs = RELOAD_GUARD_WINDOW_MS,
): boolean {
  if (lastReloadAt == null) return true;
  const last = Number(lastReloadAt);
  if (!Number.isFinite(last)) return true;
  // A timestamp in the future (clock moved back) is treated as recent: refusing
  // one reload is cheap, and a loop is not.
  return nowMs - last >= windowMs;
}

export interface RecoveryDeps {
  origin: string;
  now: () => number;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  fetch: (url: string, init: RequestInit) => Promise<unknown>;
  reload: () => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
}

export type RecoveryOutcome = 'scheduled' | 'joined' | 'guarded' | 'no-storage';

/**
 * A handler for `vite:preloadError` payloads. The first failure of a burst
 * claims the guard and schedules the repair; later ones in the same burst only
 * add their URL.
 */
export function createStaleAssetRecovery(deps: RecoveryDeps): (reason: unknown) => RecoveryOutcome {
  let pending: Set<string> | null = null;

  const flush = async (urls: string[]) => {
    const refetches = urls.map((url) =>
      deps.fetch(url, { cache: 'reload', credentials: 'same-origin' }).catch(() => undefined),
    );
    const timeout = new Promise<void>((resolve) => deps.setTimeout(resolve, REFETCH_TIMEOUT_MS));
    await Promise.race([Promise.allSettled(refetches), timeout]);
    deps.reload();
  };

  return (reason) => {
    const url = failedAssetUrl(reason, deps.origin);
    if (pending) {
      if (url) pending.add(url);
      return 'joined';
    }
    const now = deps.now();
    let last: string | null;
    try {
      if (!deps.storage) return 'no-storage';
      last = deps.storage.getItem(RELOAD_GUARD_KEY);
    } catch {
      return 'no-storage';
    }
    if (!mayReload(now, last)) return 'guarded';
    try {
      deps.storage.setItem(RELOAD_GUARD_KEY, String(now));
      if (deps.storage.getItem(RELOAD_GUARD_KEY) !== String(now)) return 'no-storage';
    } catch {
      return 'no-storage';
    }
    const burst = new Set<string>(url ? [url] : []);
    pending = burst;
    deps.setTimeout(() => void flush([...burst]), COLLECT_MS);
    return 'scheduled';
  };
}

/** Wire the handler to the real window. Called once from `main.tsx`. */
export function installStaleAssetRecovery(win: Window = window): void {
  let storage: Storage | null = null;
  try {
    storage = win.sessionStorage;
  } catch {
    storage = null;
  }
  const handle = createStaleAssetRecovery({
    origin: win.location.origin,
    now: () => Date.now(),
    storage,
    fetch: (url, init) => win.fetch(url, init),
    reload: () => win.location.reload(),
    setTimeout: (fn, ms) => win.setTimeout(fn, ms),
  });
  win.addEventListener('vite:preloadError', (event) => {
    handle((event as Event & { payload?: unknown }).payload);
  });
}
