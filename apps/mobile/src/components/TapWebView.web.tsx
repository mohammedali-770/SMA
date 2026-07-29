/**
 * Web build of the Tap checkout WebView: online card payment stays app-only
 * (the hosted checkout depends on the in-app WebView flow, which is part of
 * the frozen payment stack). Renders a clear bilingual unsupported state
 * instead — cash/app flows are unaffected. Accepts (and ignores) the native
 * WebView props so the checkout screen compiles unchanged.
 */
import React from 'react';
import { Text, View } from 'react-native';

import { makeStyles } from '../theme/makeStyles';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function WebView(_props: any) {
  const styles = useStyles();
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>الدفع الإلكتروني متاح في التطبيق فقط</Text>
      <Text style={styles.body}>Online card payment is available in the mobile app only.</Text>
      <Text style={styles.body}>يمكنك إكمال الطلب نقدًا من هذه النسخة التجريبية.</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8, backgroundColor: colors.surface },
  title: { fontSize: 16, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  body: { fontSize: 13, color: colors.muted, textAlign: 'center' },
}));
