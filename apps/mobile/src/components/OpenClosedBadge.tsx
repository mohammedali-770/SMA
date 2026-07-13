/** Shared open/closed status pill (menu context card, branch selection, …). */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n/I18nProvider';
import { colors, font, radius, spacing } from '../theme';

export function OpenClosedBadge({ open }: { open: boolean }) {
  const { t } = useI18n();
  return (
    <View style={[styles.badge, { backgroundColor: open ? colors.successBg : colors.dangerBg }]}>
      <Text style={[styles.text, { color: open ? colors.success : colors.red }]}>
        {open ? t('open') : t('closed')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  text: { fontSize: font.xs, fontWeight: '800' },
});
