import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthGate } from '../components/AuthGate';
import { radius, space } from '../design-system/generated/tokens';
import { Text } from '../design-system/ui/Text';
import { OrderTypeSelectScreen } from '../features/order/OrderTypeSelectScreen';
import { useI18n } from '../i18n/I18nProvider';
import { makeStyles } from '../theme/makeStyles';
import type { OrderType } from '../types/models';

export default function SelectRoute() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { type } = useLocalSearchParams<{ type?: string }>();
  const { lang, isRTL, toggle } = useI18n();
  const initialType: OrderType | undefined = type === 'delivery' ? 'delivery' : type === 'pickup' ? 'pickup' : undefined;
  return (
    <AuthGate><View style={styles.root}>
      <OrderTypeSelectScreen initialType={initialType} />
      <Pressable accessibilityRole="button" accessibilityLabel={lang === 'en' ? 'Switch to Arabic' : 'التبديل إلى الإنجليزية'} hitSlop={8} onPress={toggle}
        style={[styles.language, { top: insets.top + space.s3 }, isRTL ? styles.languageRTL : styles.languageLTR]}>
        <Text variant="label" tone="ember" align="center">{lang === 'en' ? 'العربية' : 'EN'}</Text>
      </Pressable>
    </View></AuthGate>
  );
}
const useStyles = makeStyles((colors) => ({
  root: { flex: 1 }, language: { position: 'absolute' as const, zIndex: 20, minWidth: 44, minHeight: 40, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: space.s2, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.ember, backgroundColor: colors.appSurface },
  languageLTR: { right: space.s4 }, languageRTL: { left: space.s4 },
}));
