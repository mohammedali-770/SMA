/**
 * What the notifications control in the console header should say right now.
 *
 * There are seven distinct answers and only one of them is "on". Collapsing them
 * into a boolean is how a user ends up staring at a dead toggle with no idea
 * what to do: an iPhone in Safari, an iPhone installed before the manifest
 * existed, a browser that blocked notifications, and a server with no VAPID key
 * configured all look identical from a boolean and need four different
 * sentences.
 *
 * Pure: it takes the four facts and returns the state. No globals, no network.
 */
import type { PushReadiness } from './pushSupport';

export type AdminPushState =
  /** This browser cannot do web push at all. */
  | 'unsupported'
  /** iOS Safari — add the console to the Home Screen first. */
  | 'needs-install'
  /** Installed on iOS before the manifest existed — remove and re-add it. */
  | 'needs-reinstall'
  /** The browser or OS has blocked notifications for this site. */
  | 'denied'
  /** The server has no VAPID key yet, so nobody can subscribe. */
  | 'not-configured'
  /** Everything is ready and this device is not subscribed. */
  | 'off'
  /** This device is subscribed. */
  | 'on';

export interface AdminPushInputs {
  readiness: PushReadiness;
  /** The Notification permission, as the browser reports it. */
  permission: NotificationPermission | 'unknown';
  /** Whether a VAPID public key is configured server-side. */
  configured: boolean;
  /** Whether THIS device's endpoint is stored. */
  subscribed: boolean;
}

export function resolveAdminPushState(input: AdminPushInputs): AdminPushState {
  // Platform capability comes first: no amount of permission or configuration
  // rescues a browser that cannot receive a push, and the remedy for the two iOS
  // cases is a gesture the admin performs, not something we can fix for them.
  if (input.readiness !== 'ready') return input.readiness;

  // A hard denial outranks configuration, because re-granting is the admin's
  // next step either way and it is the more actionable sentence.
  if (input.permission === 'denied') return 'denied';

  // Not configured outranks "off": offering a button that cannot possibly work
  // is worse than saying the feature is not set up yet.
  if (!input.configured) return 'not-configured';

  return input.subscribed ? 'on' : 'off';
}

/** Whether the control should be an actionable button in this state. */
export function isActionable(state: AdminPushState): boolean {
  return state === 'on' || state === 'off';
}
