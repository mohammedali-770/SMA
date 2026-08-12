/**
 * Static ghost layouts for the first paint — no animation loops.
 *
 * Each WRAPPER is the single accessible element, announcing one "loading"
 * progress state; the decorative ghost shapes stay out of the accessibility
 * tree so there are no per-block announcements.
 *
 * These are shaped like the real layouts on purpose: a skeleton whose
 * proportions differ from the loaded content produces a visible jump, which is
 * worse than no skeleton at all.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { color, radius, space } from '../../../design-system/generated/tokens';
import { useI18n } from '../../../i18n/I18nProvider';
import { makeStyles } from '../../../theme/makeStyles';

function Ghost({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('loading')}
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
      style={styles.flex}
    >
      <View
        style={styles.pad}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {children}
      </View>
    </View>
  );
}

export function OrdersSkeleton() {
  const styles = useStyles();
  return (
    <Ghost>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.card}>
          <View style={styles.spread}>
            <View style={[styles.line, { width: '40%' }]} />
            <View style={styles.badge} />
          </View>
          <View style={[styles.line, { width: '55%' }]} />
          <View style={[styles.spread, { marginTop: space.s2 }]}>
            <View style={[styles.line, { width: '35%' }]} />
            <View style={[styles.line, { width: 72 }]} />
          </View>
        </View>
      ))}
    </Ghost>
  );
}

export function ReceiptSkeleton() {
  const styles = useStyles();
  return (
    <Ghost>
      <View style={styles.hero}>
        <View style={styles.disc} />
        <View style={[styles.line, { width: '50%', height: 18 }]} />
        <View style={[styles.line, { width: '70%' }]} />
      </View>
      {[0, 1].map((card) => (
        <View key={card} style={styles.card}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.spread, { paddingVertical: space.s2 }]}>
              <View style={[styles.line, { width: '30%' }]} />
              <View style={[styles.line, { width: '38%' }]} />
            </View>
          ))}
        </View>
      ))}
    </Ghost>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  pad: { padding: space.s4, gap: space.s3 },
  spread: { flexDirection: 'row', justifyContent: 'space-between' },
  hero: { alignItems: 'center', paddingVertical: space.s5, gap: space.s2 },
  card: {
    backgroundColor: colors.appSurface, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: colors.appLine, padding: space.s4, gap: space.s2,
  },
  disc: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: colors.appSurface2, borderWidth: 1, borderColor: colors.appLine,
  },
  line: { height: 12, borderRadius: 6, backgroundColor: colors.appSurface2 },
  badge: { width: 76, height: 22, borderRadius: radius.pill, backgroundColor: colors.appSurface2 },
}));
