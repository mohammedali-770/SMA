/**
 * The notifications control in the console header.
 *
 * Everything here is defensive by design. This is an operational nicety bolted
 * onto a console that branch staff, the call centre and the admin depend on to
 * work; a thrown error, an unhandled rejection or a hung promise in this hook
 * would be a far more expensive bug than "the bell does not light up". So every
 * browser call is wrapped, every failure resolves to a state rather than an
 * exception, and the hook never blocks a render.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  deleteAdminPushSubscription,
  fetchAdminPushState,
  saveAdminPushSubscription,
} from '../../lib/adminPushApi';
import { resolveAdminPushState, type AdminPushState } from '../../lib/pwa/adminPushState';
import { pushReadiness, readPushEnvironment } from '../../lib/pwa/pushSupport';
import { serializeSubscription, urlBase64ToUint8Array } from '../../lib/pwa/pushSubscription';

export interface AdminPushControl {
  state: AdminPushState;
  busy: boolean;
  /** Set after a failed enable/disable so the header can say what went wrong. */
  error: string | null;
  toggle: () => void;
}

async function currentEndpoint(): Promise<string | null> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/');
    const sub = await reg?.pushManager?.getSubscription();
    return sub?.endpoint ?? null;
  } catch {
    return null;
  }
}

export function useAdminPush(lang: 'en' | 'ar', enabled: boolean): AdminPushControl {
  const [state, setState] = useState<AdminPushState>('unsupported');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against setting state on an unmounted header, and against a second
  // toggle landing while the first is still in flight.
  const alive = useRef(true);
  const working = useRef(false);

  const refresh = useCallback(async () => {
    const readiness = pushReadiness(readPushEnvironment(window, navigator));

    // Ask the server only when the platform could actually use the answer.
    if (readiness !== 'ready') {
      if (alive.current) setState(readiness);
      return;
    }

    const endpoint = await currentEndpoint();
    const server = await fetchAdminPushState(endpoint);
    let permission: NotificationPermission | 'unknown' = 'unknown';
    try {
      permission = Notification.permission;
    } catch {
      permission = 'unknown';
    }

    if (!alive.current) return;
    setState(
      resolveAdminPushState({
        readiness,
        permission,
        configured: server.configured,
        // A stored endpoint we no longer hold locally is not "on" for THIS
        // browser, which is what the control is about.
        subscribed: server.subscribed && endpoint !== null,
      }),
    );
  }, []);

  useEffect(() => {
    alive.current = true;
    if (enabled) void refresh();
    return () => {
      alive.current = false;
    };
  }, [enabled, refresh]);

  const toggle = useCallback(() => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);

    void (async () => {
      try {
        const endpoint = await currentEndpoint();

        if (endpoint) {
          // Turning it OFF. Unsubscribe locally first: if the server call then
          // fails, the browser has already stopped receiving, which is the
          // honest outcome for someone who just asked for silence.
          try {
            const reg = await navigator.serviceWorker.getRegistration('/');
            const sub = await reg?.pushManager?.getSubscription();
            await sub?.unsubscribe();
          } catch {
            // Best effort — the server row is what stops the sending.
          }
          await deleteAdminPushSubscription(endpoint);
        } else {
          // Turning it ON. The permission prompt must come from this click;
          // browsers refuse it otherwise, which is why the hook exposes a
          // toggle rather than doing this on mount.
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') {
            if (alive.current) setState('denied');
            return;
          }

          const server = await fetchAdminPushState(null);
          if (!server.configured || !server.vapidPublicKey) {
            if (alive.current) setState('not-configured');
            return;
          }

          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(server.vapidPublicKey),
          });

          const serialized = serializeSubscription(sub);
          if (!serialized) {
            // Storing a half-record would show a subscribed device that can
            // never be pushed to. Drop it and report honestly instead.
            await sub.unsubscribe().catch(() => undefined);
            throw new Error('incomplete subscription');
          }

          await saveAdminPushSubscription({
            ...serialized,
            lang,
            userAgent: navigator.userAgent,
          });
        }

        await refresh();
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : 'failed');
        await refresh().catch(() => undefined);
      } finally {
        working.current = false;
        if (alive.current) setBusy(false);
      }
    })();
  }, [lang, refresh]);

  return { state, busy, error, toggle };
}
