/**
 * AsyncStorage side of the consent text: whether THIS customer has seen it on
 * THIS device. Kept apart from `notificationPolicy.ts` so the rule that reads
 * it (`shouldShowConsentNotice`) stays pure and unit-tested.
 *
 * Per customer, not per device, because a shared phone is the case the notice
 * exists for: the first customer's grant says nothing about whether the second
 * was ever told that offers come with order updates.
 *
 * Reads fail SOFT, as `firstRunStore.ts` does: if storage is unreadable the
 * text counts as seen. Getting that backwards would raise the notice on every
 * launch, which is worse than missing it once; the opt-out itself stays in
 * Profile either way.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'spicymeal.notifConsent.seen.v1:';

/** Never rejects. On any storage failure, reports the text as already seen. */
export async function readConsentSeen(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY_PREFIX + userId)) === '1';
  } catch {
    return true;
  }
}

export async function markConsentSeen(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + userId, '1');
  } catch {
    /* best-effort */
  }
}
