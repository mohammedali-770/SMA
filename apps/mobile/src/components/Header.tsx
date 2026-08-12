/** Screen header: optional back button, centered title, optional right slot. */
import { router } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, space, type as typeScale } from '../design-system/generated/tokens';
import { useI18n } from '../i18n/I18nProvider';
import { makeStyles } from '../theme/makeStyles';

interface Props {
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
  left?: React.ReactNode;
  safeTop?: boolean;
}

export function Header({ title, showBack, onBack, right, left, safeTop }: Props) {
  const insets = useSafeAreaInsets();
  const { isRTL, t, rtlRow } = useI18n();
  const styles = useStyles();
  const back = () => {
    if (onBack) onBack();
    else if (router.canGoBack()) router.back();
  };
  const chevron = isRTL ? '›' : '‹';

  return (
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

const useStyles = makeStyles((color) => ({
  wrap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
    backgroundColor: color.appSurface,
    borderBottomWidth: 1,
    borderBottomColor: color.appLine,
  },
  side: { minWidth: 44, justifyContent: 'center' as const },
  right: { alignItems: 'flex-end' as const },
  rightRTL: { alignItems: 'flex-start' as const },
  backBtn: {
    width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: color.appSurface2,
  },
  chevron: { fontSize: 28, fontWeight: '800' as const, color: color.ember, lineHeight: 30 },
  title: {
    flex: 1,
    textAlign: 'center' as const,
    fontSize: typeScale.heading.size,
    lineHeight: typeScale.heading.lineHeight,
    fontWeight: typeScale.heading.weight as '700',
    color: color.appText,
  },
}));
