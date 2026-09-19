/*
 * Spicy Meal staff console — service worker.
 *
 * THIS WORKER DELIBERATELY HAS NO `fetch` HANDLER, AND THAT IS THE MOST
 * IMPORTANT THING ABOUT IT.
 *
 * A service worker that intercepts `fetch` can serve a stale or broken shell to
 * every staff device and keep doing it after the fix ships, because the bad
 * worker is the thing deciding what to serve. This console has already had one
 * outage where branch staff, the call centre and the admin could not sign in
 * (docs/DEPLOY.md). Caching is not needed for push, so this worker does not
 * cache anything at all: with no `fetch` handler the browser goes straight to
 * the network exactly as it does today, and the worst a broken worker can do is
 * fail to show a notification.
 *
 * Its only jobs are to receive a push and to open the console when one is
 * tapped. Sending is added in a later change; until an admin subscribes, this
 * worker is installed and idle.
 */

// Bump when this file changes so devices pick the new worker up promptly.
const SW_VERSION = '1';

self.addEventListener('install', () => {
  // Replace an older worker immediately rather than waiting for every tab to
  // close. Safe here precisely because nothing is cached.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/*
 * APPLE REVOKES A SUBSCRIPTION THAT RECEIVES A PUSH AND SHOWS NOTHING, so every
 * branch below ends in showNotification — including the malformed-payload path.
 * A silent push is not a smaller bug than a wrong one; it is how the admin's
 * subscription quietly dies.
 */
/**
 * Resolve a payload's target to a path INSIDE the staff console, or '/'.
 *
 * Prefix checks are not enough, and two separate findings say so.
 * `//evil.example` starts with a slash. So does `/\evil.example/x` — and the URL
 * parser treats a backslash as a path separator, so that resolves to
 * https://evil.example/x. Parsing and comparing the ORIGIN is the only check
 * that holds, because it asks the same question the browser will ask when the
 * notification is tapped.
 *
 * `/app` is excluded too: this origin also serves the customer web export, and a
 * staff notification must never deep-link into the customer app.
 */
function consolePath(raw) {
  if (typeof raw !== 'string' || !raw) return '/';
  try {
    const url = new URL(raw, self.location.origin);
    if (url.origin !== self.location.origin) return '/';
    if (url.pathname === '/app' || url.pathname.startsWith('/app/')) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}

/** Whether an open window is the staff console rather than the customer app. */
function isConsoleClient(client) {
  try {
    const url = new URL(client.url);
    if (url.origin !== self.location.origin) return false;
    return url.pathname !== '/app' && !url.pathname.startsWith('/app/');
  } catch {
    return false;
  }
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    const parsed = event.data ? event.data.json() : null;
    /*
     * ONLY AN OBJECT HAS FIELDS TO READ. A literal `null`, a number, a string
     * and an array all parse CLEANLY, so the catch below never sees them — and
     * dereferencing one would throw OUTSIDE this block, before waitUntil or
     * showNotification ever ran. That is not a cosmetic failure: a push that
     * displays nothing is how Apple revokes the subscription, which is the exact
     * outcome this fallback exists to prevent.
     */
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed;
    }
  } catch {
    payload = {};
  }

  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title : 'سبايسي ميل';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const url = consolePath(payload.url);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // Arabic copy: mark the notification itself so the OS lays it out RTL.
      lang: typeof payload.lang === 'string' ? payload.lang : 'ar',
      dir: typeof payload.dir === 'string' ? payload.dir : 'rtl',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // `tag` lets a later event about the same subject replace an earlier one
      // instead of stacking. The sender chooses it; absent means never collapse.
      tag: typeof payload.tag === 'string' ? payload.tag : undefined,
      renotify: typeof payload.tag === 'string' ? true : undefined,
      timestamp: typeof payload.at === 'number' ? payload.at : Date.now(),
      data: { url, version: SW_VERSION },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      /*
       * Reuse an open CONSOLE window rather than stacking another one — and
       * only a console window. This origin also serves the customer web export
       * at /app, and matchAll returns ANY same-origin window, so navigating the
       * first one found would throw away a customer tab's state to show a staff
       * notification. Filter first, then reuse.
       */
      for (const client of windows) {
        if (!isConsoleClient(client)) continue;
        if ('focus' in client) {
          if ('navigate' in client) {
            try {
              await client.navigate(target);
            } catch {
              // A cross-origin or otherwise un-navigable client: just focus it.
            }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })(),
  );
});
