import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthGate } from '../components/AuthGate';
import { color, radius, space } from '../design-system/generated/tokens';
import { Text } from '../design-system/ui/Text';
import { OrderTypeSelectScreen } from '../features/order/OrderTypeSelectScreen';
import { useI18n } from '../i18n/I18nProvider';

/**
 * The order-type screen is a blocking first-run gate, so language switching
 * must remain reachable here instead of existing only behind the Home/Profile
 * surfaces the customer cannot reach until a valid order context is chosen.
 *
 * The control is overlaid into the Header's intentionally-empty trailing slot
 * rather than modifying the large order-selection screen or reviving its old
 * pre-design-system implementation. In RTL the Header reverses its children,
 * so the trailing slot moves to the left and this control follows it.
 */
export default function SelectRoute() {
  const insets = useSafeAreaInsets();
  const { lang, isRTL, toggle } = useI18n();

  return (
    <AuthGate>
      <View style={styles.root}>
        <OrderTypeSelectScreen />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={lang === 'en' ? 'Switch to Arabic' : 'التبديل إلى الإنجليزية'}
          hitSlop={8}
          onPress={toggle}
          style={[
            styles.language,
            { top: insets.top + space.s3 },
            isRTL ? styles.languageRTL : styles.languageLTR,
          ]}
        >
          <Text variant="label" tone="ember" align="center">
            {lang === 'en' ? 'العربية' : 'EN'}
          </Text>
        </Pressable>
      </View>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  language: {
    position: 'absolute',
    zIndex: 20,
    minWidth: 44,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.s2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: color.ember,
    backgroundColor: color.appSurface,
  },
  languageLTR: { right: space.s4 },
  languageRTL: { left: space.s4 },
});
