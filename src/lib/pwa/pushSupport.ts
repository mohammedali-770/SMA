/**
 * Can THIS browser, in THIS state, subscribe the admin to web push?
 *
 * The answer is not a single boolean, because the interesting case is not
 * "supported" versus "not supported" — it is the iPhone in between.
 *
 * Apple only exposes web push to a web app that has been ADDED TO THE HOME
 * SCREEN, and only when the site served a manifest with `display: standalone`
 * at the moment it was added. Safari itself can never receive one. So a console
 * opened in Safari on an iPhone is not broken, it is merely in the wrong place;
 * and a console that WAS added to the Home Screen before this app shipped a
 * manifest is installed but permanently without `PushManager` until it is
 * removed and re-added. Those two states need different sentences in front of
 * the admin, and neither of them is "your browser is not supported".
 *
 * Pure on purpose: it reads an environment description rather than globals, so
 * every branch is testable without pretending to be an iPhone.
 */

export type PushReadiness =
  /** Subscribing can proceed now. */
  | 'ready'
  /** iOS Safari: the console must be added to the Home Screen first. */
  | 'needs-install'
  /** Installed on iOS, but with no PushManager — added before the manifest existed. */
  | 'needs-reinstall'
  /** This browser cannot do web push at all. */
  | 'unsupported';

export interface PushEnvironment {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  /** Running as an installed web app rather than a browser tab. */
  isStandalone: boolean;
  isIos: boolean;
}

export function pushReadiness(env: PushEnvironment): PushReadiness {
  // A service worker and the Notification API are the floor everywhere.
  if (!env.hasServiceWorker || !env.hasNotification) return 'unsupported';

  // iOS in a browser tab: no amount of permission-granting will help, and the
  // remedy is a specific gesture the admin can perform in about ten seconds.
  if (env.isIos && !env.isStandalone) return 'needs-install';

  if (!env.hasPushManager) {
    // Installed on iOS and still missing PushManager means the Home Screen entry
    // predates the manifest. Removing and re-adding it is the ONLY fix; iOS
    // decides an installed web app's capabilities once, at install time.
    return env.isIos && env.isStandalone ? 'needs-reinstall' : 'unsupported';
  }

  return 'ready';
}

/** Build a {@link PushEnvironment} from real browser globals. Never throws. */
export function readPushEnvironment(win: Window & typeof globalThis, nav: Navigator): PushEnvironment {
  let isStandalone = false;
  try {
    isStandalone =
      // iOS's own, non-standard flag; still the reliable one on iPhone.
      (nav as Navigator & { standalone?: boolean }).standalone === true ||
      win.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    isStandalone = false;
  }

  return {
    hasServiceWorker: 'serviceWorker' in nav,
    hasPushManager: 'PushManager' in win,
    hasNotification: 'Notification' in win,
    isStandalone,
    isIos: isIosDevice(nav),
  };
}

/**
 * iPadOS 13+ reports itself as a Mac, so the user-agent alone is not enough —
 * a Mac that reports touch points is an iPad.
 */
export function isIosDevice(nav: Navigator): boolean {
  const ua = nav.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  const platform = (nav as Navigator & { platform?: string }).platform || '';
  return platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
}
