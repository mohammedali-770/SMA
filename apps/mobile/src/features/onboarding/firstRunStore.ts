/**
 * AsyncStorage side of the first-run flags. Kept separate from `firstRun.ts`
 * so the decision rules stay pure and unit-testable.
 *
 * Every read fails SOFT: if storage is unreadable we treat the customer as
 * already onboarded and already asked. Getting that backwards would re-show
 * onboarding, or re-prompt for a review, on every launch — far worse than
 * silently skipping a one-off nicety.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_FIRST_RUN, type FirstRunState } from './firstRun';

const ONBOARDED_KEY = 'spicymeal.firstRun.onboarded.v1';
const REVIEW_KEY = 'spicymeal.firstRun.reviewAsked.v1';

/** Never rejects. On any storage failure, reports both flags as already done. */
export async function readFirstRun(): Promise<FirstRunState> {
  try {
    const [onboarded, reviewAsked] = await Promise.all([
      AsyncStorage.getItem(ONBOARDED_KEY),
      AsyncStorage.getItem(REVIEW_KEY),
    ]);
    return { onboarded: onboarded === '1', reviewAsked: reviewAsked === '1' };
  } catch {
    return { onboarded: true, reviewAsked: true };
  }
}

export async function markOnboarded(): Promise<void> {
  try { await AsyncStorage.setItem(ONBOARDED_KEY, '1'); } catch { /* best-effort */ }
}

export async function markReviewAsked(): Promise<void> {
  try { await AsyncStorage.setItem(REVIEW_KEY, '1'); } catch { /* best-effort */ }
}

export { DEFAULT_FIRST_RUN };
