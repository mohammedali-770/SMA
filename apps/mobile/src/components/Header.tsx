/** Screen header: optional back button, centered title, optional right slot. */
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, spacing } from '../theme';
import { useI18n } from '../i18n/I18nProvider';

interface Props {
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
  left?: React.ReactNode;
  /**
   * Pads the header below the status bar / notch. Opt-in so screens that
   * already wrap their content in a safe-area container keep their spacing.
   */
  safeTop?: boolean;
}

export function Header({ title, showBack, onBack, right, left, safeTop }: Props) {
  const insets = useSafeAreaInsets();
  const { isRTL, t, rtlRow } = useI18n();
  const back = () => {
    if (onBack) onBack();
    else if (router.canGoBack()) router.back();
  };
  // The back chevron points toward the "start" edge for the active direction.
  const chevron = isRTL ? '›' : '‹';

  return (
    // Mirrored in Arabic so Back sits on the trailing (right) edge, matching
    // native RTL convention; the chevron above already points the correct way.
    <View style={[styles.wrap, rtlRow, safeTop && { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.side}>
        {showBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('back')} onPress={back} hitSlop={10} style={styles.backBtn}>
            <Text style={styles.chevron}>{chevron}</Text>
          </Pressable>
        ) : left ?? null}
      </View>
      <Text numberOfLines={1} style={styles.title}>{title}</Text>
      <View style={[styles.side, styles.right, isRTL && styles.rightRTL]}>{right ?? null}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  side: { minWidth: 44, justifyContent: 'center' },
  right: { alignItems: 'flex-end' },
  rightRTL: { alignItems: 'flex-start' },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bgAlt,
  },
  chevron: { fontSize: 28, fontWeight: '800', color: colors.purple, lineHeight: 30 },
  title: { flex: 1, textAlign: 'center', fontSize: font.lg, fontWeight: '800', color: colors.text },
});
