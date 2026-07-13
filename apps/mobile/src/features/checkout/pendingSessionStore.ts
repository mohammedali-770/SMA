/**
 * Thin AsyncStorage wrappers for the pending checkout session. Kept separate from
 * pendingSession.ts so the recovery LOGIC stays pure/unit-testable while the
 * storage side-effects live here. Never throws — a storage hiccup must not break
 * checkout (worst case: recovery no-ops and the existing server-side guards hold).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  PENDING_SESSION_KEY,
  parsePendingSession,
  serializePendingSession,
  type PendingSession,
} from './pendingSession';

export async function savePendingSession(sessionId: string, at: number): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_SESSION_KEY, serializePendingSession(sessionId, at));
  } catch {
    /* ignore */
  }
}

export async function loadPendingSession(): Promise<PendingSession | null> {
  try {
    return parsePendingSession(await AsyncStorage.getItem(PENDING_SESSION_KEY));
  } catch {
    return null;
  }
}

export async function clearPendingSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
