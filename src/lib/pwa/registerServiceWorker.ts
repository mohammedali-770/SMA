/**
 * Install the console's service worker.
 *
 * The worker exists only to receive pushes (public/sw.js caches nothing), so
 * registration is a background nicety, never a gate on the app starting. Every
 * failure path here is swallowed deliberately: a console that will not load
 * because its notification plumbing failed would be a far worse bug than one
 * that simply cannot notify.
 */

/** Registered at most once per page load, even under React StrictMode. */
let inFlight: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerConsoleServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (inFlight) return inFlight;
  inFlight = register();
  return inFlight;
}

async function register(): Promise<ServiceWorkerRegistration | null> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    // Scope '/' so a notification tapped from anywhere reaches the whole console.
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

/** Test seam: forget the memoised registration. */
export function resetServiceWorkerRegistrationForTests(): void {
  inFlight = null;
}
