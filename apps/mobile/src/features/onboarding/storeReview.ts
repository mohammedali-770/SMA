/**
 * Store-review request, wrapped so the screen never touches the SDK directly
 * and every call is safe to make.
 *
 * Both platforms treat this as a REQUEST, not a command: iOS caps its own
 * dialog at three prompts per 365 days and decides on its own whether to show
 * anything at all, and there is no callback telling us what happened. So this
 * can never be relied on to have been seen — which is exactly why the one-shot
 * flag is written before asking rather than after.
 */
import * as StoreReview from 'expo-store-review';

export const requestStoreReview = {
  /** True only when the OS both supports and is currently willing to review. */
  async isAvailable(): Promise<boolean> {
    try {
      // hasAction() is the stricter of the two: it also covers "no store on
      // this device" and a fallback URL not being configured.
      return await StoreReview.hasAction();
    } catch {
      return false;
    }
  },

  /** Never throws — a failed review prompt must not disturb the order flow. */
  async request(): Promise<void> {
    try {
      await StoreReview.requestReview();
    } catch { /* best-effort by design */ }
  },
};
