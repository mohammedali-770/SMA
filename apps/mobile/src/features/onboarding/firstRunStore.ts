/**
 * AsyncStorage side of the first-run flags. Kept separate from `firstRun.ts`
 * so the decision rules stay pure and unit-testable.
 *
 * Every read fails SOFT: if storage is unreadable we treat both prompts as
 * already raised. Getting that backwards would re-raise the OS
 * permission dialogs, or re-prompt for a review, on every launch — far worse
 * than silently skipping a one-off.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_FIRST_RUN, type FirstRunState } from './firstRun';

const PERMISSIONS_KEY = 'spicymeal.firstRun.permissionsRequested.v1';
const REVIEW_KEY = 'spicymeal.firstRun.reviewAsked.v1';

/** Never rejects. On any storage failure, reports both flags as already done. */
export async function readFirstRun(): Promise<FirstRunState> {
  try {
    const [permissionsRequested, reviewAsked] = await Promise.all([
      AsyncStorage.getItem(PERMISSIONS_KEY),
      AsyncStorage.getItem(REVIEW_KEY),
    ]);
    return { permissionsRequested: permissionsRequested === '1', reviewAsked: reviewAsked === '1' };
  } catch {
    return { permissionsRequested: true, reviewAsked: true };
  }
}

export async function markPermissionsRequested(): Promise<void> {
  try { await AsyncStorage.setItem(PERMISSIONS_KEY, '1'); } catch { /* best-effort */ }
}

export async function markReviewAsked(): Promise<void> {
  try { await AsyncStorage.setItem(REVIEW_KEY, '1'); } catch { /* best-effort */ }
}

export { DEFAULT_FIRST_RUN };
