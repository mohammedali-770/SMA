/**
 * Design-system menu card.
 *
 * Extracted from HomeMenuScreen so the menu, search results and the dev preview
 * all render one implementation. PRESENTATION ONLY — availability, modifier
 * resolution and cart mutation stay with the caller; this component receives a
 * product, a precomputed `hasModifiers` flag and an `onAdd` callback and does
 * nothing else.
 *
 * Memoized with stable props (product ref, boolean, stable handler) so a cart
 * tap or a keystroke in search does not re-render every card. Language changes
 * still propagate, because `useI18n` reads context and context bypasses memo.
 */
import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DishIcon } from '../../components/Icons';
import { Price } from '../../components/Price';
import { useI18n } from '../../i18n/I18nProvider';
import type { Product } from '../../types/models';
import { color, motion, radius, space, type as typeScale } from '../generated/tokens';
import { Text } from './Text';

interface Props {
  product: Product;
  hasModifiers: boolean;
  onAdd: (product: Product, withModifiers: boolean) => void;
}

export const ProductCard = React.memo(function ProductCard({ product, hasModifiers, onAdd }: Props) {
  const { t, pick, rtlRow } = useI18n();
  const [imgFailed, setImgFailed] = useState(false);

  const name = pick(product.nameEn, product.nameAr);
  const description = pick(product.descriptionEn, product.descriptionAr);
  const kcalLabel = product.calories ? `${product.calories} ${t('kcal')}` : '';
  const actionLabel = hasModifiers ? t('customizeAdd') : t('addToCart');
  const showImage = !!product.imageUrl && !imgFailed;

  return (
    // Mirrored in Arabic: image on the reading edge, text block reading RTL.
    <View style={[styles.card, rtlRow]}>
      {showImage ? (
        <Image
          source={{ uri: product.imageUrl }}
          style={styles.img}
          contentFit="cover"
          transition={motion.quick}
          // Keep decoded thumbnails in memory so cards scrolled back into view
          // don't re-decode from disk; recyclingKey pairs with virtualization.
          cachePolicy="memory-disk"
          recyclingKey={product.id}
          onError={() => setImgFailed(true)}
        />
      ) : (
        // Missing/broken image → a quiet plate glyph, never a blank block.
        <View style={[styles.img, styles.imgEmpty]}>
          <DishIcon size={34} color={color.heatOff} />
        </View>
      )}

      <View style={styles.body}>
        <Text variant="heading" numberOfLines={2}>{name}</Text>
        {description ? (
          <Text variant="caption" tone="secondary" numberOfLines={2}>{description}</Text>
        ) : null}

        <View style={[styles.bottom, rtlRow]}>
          <View>
            <Price amount={product.price} size={typeScale.body.size} color={color.appText} weight="700" />
            {kcalLabel ? <Text variant="caption" tone="tertiary">{kcalLabel}</Text> : null}
          </View>
          <Pressable
            onPress={() => onAdd(product, hasModifiers)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
          >
            <Text variant="label" tone="onEmber" align="center">{actionLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // Flat: a hairline, not a shadow. Structure comes from colour boundaries.
  card: {
    flexDirection: 'row',
    backgroundColor: color.appSurface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.appLine,
    overflow: 'hidden',
  },
  img: { width: 104, minHeight: 112, backgroundColor: color.appSurface2 },
  // The empty state needs a visible edge: on the cream ground the tinted block
  // alone reads as nothing at all, so the placeholder looked like a hole in the
  // card rather than a missing photo.
  imgEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.appSurface3,
  },
  body: { flex: 1, padding: space.s3, gap: space.s1 },
  bottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: space.s2,
  },
  add: {
    backgroundColor: color.ember,
    paddingHorizontal: space.s4,
    paddingVertical: space.s2,
    borderRadius: radius.md,
  },
  addPressed: { opacity: motion.pressedOpacity },
});
