/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The storage supabase-js is handed for the GoTrue session, wired to the
 * platform.
 *
 * All of the logic lives in `chunkedSecureStorage.ts`, which is pure and
 * tested; this file exists only to decide WHICH backend it gets, because that
 * decision needs React Native and Expo and therefore cannot be unit-tested
 * here (the root vitest config requires mobile suites to be framework-free).
 *
 * NATIVE — the keystore. `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` is chosen
 * deliberately over plain `AFTER_FIRST_UNLOCK`: the `THIS_DEVICE_ONLY` variant
 * is the one iOS excludes from backups and from iCloud Keychain sync, and
 * keeping the refresh token out of backups is the entire point of the change.
 * `AFTER_FIRST_UNLOCK` rather than `WHEN_UNLOCKED` because the app refreshes
 * its token on foreground and a locked-device read must not fail.
 *
 * The visible consequence, so it is not discovered as a bug: restoring a phone
 * from a backup signs the customer out. That is correct for a credential, and
 * signing in again is one WhatsApp code.
 *
 * WEB — AsyncStorage, unchanged. There is no keystore in a browser;
 * `expo-secure-store` is unavailable there and throws. The Expo web export
 * therefore keeps exactly the behaviour it has today, which is also what the
 * admin web app does.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { createChunkedSecureStorage, type KeyValueBackend } from './chunkedSecureStorage';

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const keystore: KeyValueBackend = {
  getItem: (key) => SecureStore.getItemAsync(key, SECURE_OPTIONS),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, SECURE_OPTIONS),
  removeItem: (key) => SecureStore.deleteItemAsync(key, SECURE_OPTIONS),
};

const asyncStorage: KeyValueBackend = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

export const sessionStorage: KeyValueBackend =
  Platform.OS === 'web'
    ? asyncStorage
    : createChunkedSecureStorage({ secure: keystore, legacy: asyncStorage });
