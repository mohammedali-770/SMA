/** Spicy Meal logo lockup: brand mark + wordmark, shown at the top of screens. */
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, spacing } from '../theme';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MARK = require('../../assets/icon.png');

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.row}>
      <Image source={MARK} style={compact ? styles.markSm : styles.mark} contentFit="cover" />
      {!compact && (
        <View>
          <Text style={styles.word}>Spicy Meal</Text>
          <Text style={styles.tag}>سبايسي ميل</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: { width: 40, height: 40, borderRadius: radius.sm },
  markSm: { width: 30, height: 30, borderRadius: radius.sm },
  word: { fontSize: font.xl, fontWeight: '800', color: colors.purple, letterSpacing: 0.2 },
  tag: { fontSize: font.xs, fontWeight: '600', color: colors.red, marginTop: -2 },
});
