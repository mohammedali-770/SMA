/**
 * Root error boundary: captures unexpected React render errors to Sentry and
 * shows a minimal bilingual fallback INSTEAD of a crashed white screen.
 *
 * Deliberate properties:
 *  - captures the FIRST error per failure (no infinite capture loops — see
 *    shouldCaptureBoundaryError); retry resets the guard;
 *  - never shows a stack trace or technical details to customers;
 *  - static AR + EN copy (rendered above the i18n provider so a crash inside
 *    localization itself still produces a readable screen);
 *  - zero customer data in the captured event (component stack only, which is
 *    sanitized in the observability module).
 */
import * as SplashScreen from 'expo-splash-screen';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { captureRenderError } from '../lib/observability';
import { shouldCaptureBoundaryError } from '../lib/observability/classify';
import { color } from '../design-system/generated/tokens';
interface Props { children: React.ReactNode }
interface State { hasError: boolean }

export class ObservabilityErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };
  private captured = false;

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }): void {
    // A crash during provider bootstrap can happen BEFORE SplashGate's
    // hideAsync ever runs; without this, the fallback would render behind the
    // pinned native splash and the launch screen would appear frozen.
    // hideAsync is idempotent and safe to call after the splash is gone.
    SplashScreen.hideAsync().catch(() => {});
    if (shouldCaptureBoundaryError(this.captured)) {
      this.captured = true;
      captureRenderError(error, info.componentStack);
    }
  }

  private retry = (): void => {
    this.captured = false;
    this.setState({ hasError: false });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.wrap}>
        <Text style={styles.titleAr}>حدث خطأ غير متوقع</Text>
        <Text style={styles.titleEn}>Something unexpected went wrong</Text>
        <Text style={styles.bodyAr}>نعتذر عن الإزعاج — فريقنا تم إشعاره تلقائيًا.</Text>
        <Text style={styles.bodyEn}>Sorry for the inconvenience — our team has been notified.</Text>
        <TouchableOpacity style={styles.button} onPress={this.retry} accessibilityRole="button">
          <Text style={styles.buttonText}>إعادة المحاولة · Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.appBg, padding: 32, gap: 6,
  },
  titleAr: { fontSize: 18, fontWeight: '800', color: color.appText, textAlign: 'center' },
  titleEn: { fontSize: 15, fontWeight: '700', color: color.appText, textAlign: 'center', marginBottom: 8 },
  bodyAr: { fontSize: 13, color: color.appText2, textAlign: 'center' },
  bodyEn: { fontSize: 12, color: color.appText2, textAlign: 'center', marginBottom: 16 },
  button: {
    backgroundColor: color.ember, borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 12, marginTop: 8,
  },
  buttonText: { color: color.appSurface, fontWeight: '800', fontSize: 14 },
});
