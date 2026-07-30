/** Screen header: optional back button, centered title, optional right slot. */
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, radius, space, type as typeScale } from '../design-system/generated/tokens';
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
    <View style={[styles.wrap, rtlRow, safeTop && { paddingTop: insets.top + space.s3 }]}>
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
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
    backgroundColor: color.appSurface,
    borderBottomWidth: 1,
    borderBottomColor: color.appLine,
  },
  side: { minWidth: 44, justifyContent: 'center' },
  right: { alignItems: 'flex-end' },
  rightRTL: { alignItems: 'flex-start' },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.appSurface2,
  },
  chevron: { fontSize: 28, fontWeight: '800', color: color.ember, lineHeight: 30 },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: typeScale.heading.size,
    lineHeight: typeScale.heading.lineHeight,
    fontWeight: typeScale.heading.weight,
    color: color.appText,
  },
});
