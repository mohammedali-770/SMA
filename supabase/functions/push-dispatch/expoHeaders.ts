/**
 * Request headers for Expo's push send API (checklist gap S03#1).
 *
 * WHY. With Expo's "Enhanced Security for Push Notifications" off, an
 * ExponentPushToken is a bearer credential: anyone who holds one can send any
 * text to that device through Expo's public API, appearing as Spicy Meal, with
 * no `notification_log` row and no `promos_enabled` filter. Turning the setting
 * on closes that, but only once every send from this project carries the
 * project's access token. Turned on before that, Expo refuses every push from
 * here, order updates included.
 *
 * So this module adds `Authorization: Bearer <EXPO_ACCESS_TOKEN>` when, and
 * only when, the secret is set and non-blank. Until it is set, the headers are
 * byte-for-byte what push-dispatch has always sent, so this change alone
 * changes nothing a customer receives.
 *
 * The token is never logged, and never returned anywhere but this object.
 * Order of owner steps: set the secret, deploy, confirm a real order push
 * arrives, and only then enable Enhanced Security (docs/OWNER_ACTIONS.md §52).
 *
 * Pure and framework-free, so Vitest can execute it; `index.ts` cannot be
 * loaded outside Deno.
 */
export const EXPO_BASE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

export function expoPushHeaders(accessToken: string | undefined | null): Record<string, string> {
  const token = typeof accessToken === 'string' ? accessToken.trim() : '';
  if (!token) return { ...EXPO_BASE_HEADERS };
  return { ...EXPO_BASE_HEADERS, Authorization: `Bearer ${token}` };
}
