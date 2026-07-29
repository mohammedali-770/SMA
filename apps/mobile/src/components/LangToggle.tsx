/**
 * Language switch, as a quiet neutral pill.
 *
 * Shared rather than per-screen because it belongs on the blocking order-type
 * gate as well as the menu. The gate is the first screen a customer sees and,
 * until this existed, the only one they COULD see — it carried no toggle, so a
 * customer who landed in English had to choose a branch before reaching any
 * control that would put the app into Arabic. In an Arabic-first app that is
 * not a cosmetic gap.
 */
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useI18n } from '../i18n/I18nProvider';
import { colors, font, radius, spacing } from '../theme';

export function LangToggle() {
  const { lang, toggle } = useI18n();
  // The label names the language you would switch TO, so it reads as an action.
  const label = lang === 'en' ? 'العربية' : 'EN';
  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      style={styles.btn}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: colors.bgAlt, borderWidth: 1, borderColor: colors.border,
  },
  text: { color: colors.text, fontWeight: '700', fontSize: font.sm },
});
