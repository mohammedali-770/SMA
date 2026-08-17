/**
 * "You might also like" — the horizontal upsell rail on the cart screen.
 *
 * Fully PROP-DRIVEN: it takes a ready-made view model and knows nothing about
 * the catalog, the cart or the ranking. That is what lets `dev-preview` render
 * it against a mock array with no provider, the same way `CartLine` is already
 * shaped.
 */
import { Image } from 'expo-image';
import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { DishIcon } from '../../components/Icons';
import { Price } from '../../components/Price';
import { motion, radius, space, type as typeScale } from '../../design-system/generated/tokens';
import { Text } from '../../design-system/ui/Text';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';

export interface SuggestionCardModel {
  id: string;
  name: string;
  imageUrl: string;
  price: number;
  /** Pre-formatted, e.g. "320 kcal". Empty string hides the row. */
  kcalLabel: string;
  /** Add vs Customize & Add — decided by the caller from the product's modifier groups. */
  actionLabel: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
}

export function SuggestionStrip({ title, items, isRTL, onPress }: {
  title: string;
  items: readonly SuggestionCardModel[];
  isRTL: boolean;
  onPress: (id: string) => void;
}) {
  const styles = useStyles();
  const railRef = useRef<ScrollView>(null);
  if (items.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text variant="title" style={styles.sectionTitle}>{title}</Text>
      <ScrollView
        ref={railRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.railViewport}
        contentContainerStyle={[styles.rail, isRTL && styles.railRTL]}
        // The app never calls I18nManager.forceRTL, so RN keeps the scroll
        // origin at x=0: a reversed rail would otherwise open on the LAST card.
        onContentSizeChange={() => { if (isRTL) railRef.current?.scrollToEnd({ animated: false }); }}
      >
        {items.map((item) => <SuggestionCard key={item.id} item={item} isRTL={isRTL} onPress={() => onPress(item.id)} />)}
      </ScrollView>
    </View>
  );
}

/**
 * One press target for the whole card. The action pill is a non-interactive
 * View that looks like a button: at 148pt wide the card is far above the 44pt
 * minimum, so a nested Pressable would only add stop-propagation complexity.
 */
function SuggestionCard({ item, isRTL, onPress }: { item: SuggestionCardModel; isRTL: boolean; onPress: () => void }) {
  const styles = useStyles();
  const colors = useThemeColors();
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!item.imageUrl && !imgFailed;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={item.accessibilityLabel}
      accessibilityHint={item.accessibilityHint}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {showImage
        ? <Image source={{ uri: item.imageUrl }} style={styles.img} contentFit="cover" transition={motion.quick} cachePolicy="memory-disk" recyclingKey={item.id} onError={() => setImgFailed(true)} />
        : <View style={[styles.img, styles.imgEmpty]}><DishIcon size={30} color={colors.heatOff} /></View>}
      <View style={styles.body}>
        <Text variant="label" numberOfLines={2}>{item.name}</Text>
        {item.kcalLabel ? <Text variant="caption" tone="tertiary">{item.kcalLabel}</Text> : null}
        {/* Price is a View, not a Text, so it does not pick up the reading-edge
            alignment the name and caption get. Stretched to the card width it
            would pack left even in Arabic — row-reverse anchors the block to
            the reading edge while leaving the riyal symbol on the left of the
            digits, which Price deliberately keeps in both languages. */}
        <View style={isRTL ? styles.priceRowRTL : styles.priceRow}>
          <Price amount={item.price} size={typeScale.label.size} weight="700" />
        </View>
        <View style={styles.action}><Text variant="label" tone="onEmber" align="center">{item.actionLabel}</Text></View>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((color) => ({
  // The page gutter is `padding` on the ScrollView's contentContainerStyle, so
  // it wraps this section too. Negative margin is what lets the rail bleed to
  // the screen edge while the title keeps the gutter.
  section: { marginTop: space.s5, marginHorizontal: -space.s4, gap: space.s3 },
  sectionTitle: { marginHorizontal: space.s4 },
  railViewport: { flexGrow: 0 },
  // flexGrow keeps the content view at least viewport-wide. Without it a
  // two-card slate measures ~336pt, the scroll view pins it at content origin
  // x=0, and `row-reverse` — which only reorders items INSIDE that box — leaves
  // the rail hugging the left edge in Arabic.
  rail: { flexGrow: 1, paddingHorizontal: space.s4, gap: space.s2, paddingBottom: space.s1 },
  railRTL: { flexDirection: 'row-reverse' as const },
  priceRow: { flexDirection: 'row' as const },
  priceRowRTL: { flexDirection: 'row-reverse' as const },
  card: { width: 148, backgroundColor: color.appSurface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.appLine, overflow: 'hidden' as const },
  cardPressed: { opacity: motion.pressedOpacity },
  img: { width: '100%' as const, height: 96, backgroundColor: color.appSurface2 },
  imgEmpty: { alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: color.appSurface3 },
  body: { padding: space.s3, gap: space.s1 },
  action: { marginTop: space.s1, backgroundColor: color.ember, borderRadius: radius.md, paddingVertical: space.s2, minHeight: 34, justifyContent: 'center' as const },
}));
