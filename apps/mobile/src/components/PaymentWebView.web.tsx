/**
 * Web build of the payment WebView. Online card payment is app-only: the hosted
 * payment page runs in the in-app WebView, which a browser build cannot host, so
 * the web build hides the online option altogether (lib/payment.ts). This stand-in
 * renders a clear bilingual unsupported state in case the route is reached
 * anyway. Accepts (and ignores) the native WebView props so the payment screen
 * compiles unchanged.
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
      <Text style={styles.body}>يمكنك إكمال طلبك عبر الموقع والدفع نقدًا.</Text>
      <Text style={styles.body}>You can still complete your order on the website and pay in cash.</Text>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
    backgroundColor: '#fff',
  },
  title: { fontSize: 16, fontWeight: '800', color: '#1e293b', textAlign: 'center' },
  body: { fontSize: 13, color: '#64748b', textAlign: 'center' },
}));
