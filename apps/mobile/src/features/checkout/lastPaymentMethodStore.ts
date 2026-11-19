/**
 * The customer's own last payment choice, kept on this device per account.
 *
 * Read by CheckoutScreen through `rememberedPreselection` (lib/payment.ts),
 * which preselects ONLY a remembered online choice. Keyed by user id so a
 * second account on a shared phone never inherits the first one's choice.
 * Fails soft: a storage error reads as nothing remembered and a failed write
 * is ignored, so it can never block an order.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseRememberedMethod, type PaymentMethod } from '../../lib/payment';

export const LAST_PAYMENT_METHOD_KEY_PREFIX = 'spicymeal.lastPaymentMethod.';

export function lastPaymentMethodKey(userId: string): string {
  return `${LAST_PAYMENT_METHOD_KEY_PREFIX}${userId}`;
}

export async function loadLastPaymentMethod(userId: string): Promise<PaymentMethod | null> {
  try {
    return parseRememberedMethod(await AsyncStorage.getItem(lastPaymentMethodKey(userId)));
  } catch {
    return null;
  }
}

export async function saveLastPaymentMethod(userId: string, method: PaymentMethod): Promise<void> {
  try {
    await AsyncStorage.setItem(lastPaymentMethodKey(userId), method);
  } catch {
    /* ignore */
  }
}
