/**
 * INTERNAL crash-reporting verification screen — development builds ONLY.
 *
 * Availability: the screen renders exclusively when `__DEV__` is true (Metro
 * dev server / development-client builds). In every release binary — preview
 * and production alike — the route immediately redirects home, so customers
 * can never reach it and no test control ships in store builds. It is linked
 * from nowhere; developers open it by typing the path.
 *
 * Verification actions (all clearly labeled, no customer data involved):
 *   1. captured MESSAGE   -> appears in Sentry as a warning-level message
 *   2. captured EXCEPTION -> appears as a handled error event
 *   3. JS crash (confirm) -> uncaught render error -> boundary + crash event
 *
 * Events go to whatever environment the running build resolved (development
 * builds report 'development' and require EXPO_PUBLIC_SENTRY_DEV=1 to send).
 * NEVER run this against a production-environment build — Production must not
 * receive test events.
 */
import { Redirect } from 'expo-router';
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import {
  captureException, captureMessage, isObservabilityInitialized, observabilityEnvironment,
} from '../lib/observability';
import { colors } from '../theme';

export default function DevSentryScreen() {
  // Release builds: hard redirect. The dev-only body below is unreachable.
  if (!__DEV__) return <Redirect href="/" />;
  return <DevSentryBody />;
}

function DevSentryBody() {
  const [lastAction, setLastAction] = useState<string>('none');
  const [crashNow, setCrashNow] = useState(false);

  if (crashNow) {
    // Intentional unhandled render error (dev verification of the boundary +
    // crash pipeline). Only reachable behind __DEV__ + explicit confirmation.
    throw new Error('dev-sentry: intentional test crash (no customer impact)');
  }

  const sendMessage = () => {
    const id = captureMessage('dev-sentry: test message', {
      subsystem: 'app', op: 'sentry_verification', level: 'warning',
    });
    setLastAction(`message sent (${id.slice(0, 8)}…)`);
  };

  const sendHandled = () => {
    const id = captureException(new Error('dev-sentry: test handled exception'), {
      subsystem: 'app', op: 'sentry_verification', code: 'DEV_TEST_EXCEPTION',
    });
    setLastAction(id ? `exception sent (${id.slice(0, 8)}…)` : 'classified expected (not sent)');
  };

  const confirmCrash = () => {
    Alert.alert(
      'Trigger test crash?',
      'This throws an uncaught render error to verify the crash pipeline. Development builds only.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Crash', style: 'destructive', onPress: () => setCrashNow(true) },
      ],
    );
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Sentry verification (dev only)</Text>
      <Text style={styles.meta}>
        initialized: {String(isObservabilityInitialized())} · env: {observabilityEnvironment()}
      </Text>
      <Text style={styles.meta}>last action: {lastAction}</Text>
      <TouchableOpacity style={styles.button} onPress={sendMessage}>
        <Text style={styles.buttonText}>Send test message</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={sendHandled}>
        <Text style={styles.buttonText}>Send handled exception</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.button, styles.danger]} onPress={confirmCrash}>
        <Text style={styles.buttonText}>Trigger test crash…</Text>
      </TouchableOpacity>
      <Text style={styles.note}>
        Dev builds send only with EXPO_PUBLIC_SENTRY_DEV=1. Never use against a
        production-environment build.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  title: { fontSize: 17, fontWeight: '800', color: colors.ink },
  meta: { fontSize: 12, color: colors.muted },
  button: { backgroundColor: colors.purple, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 12, minWidth: 240, alignItems: 'center' },
  danger: { backgroundColor: colors.red },
  buttonText: { color: colors.white, fontWeight: '800' },
  note: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 12 },
});
