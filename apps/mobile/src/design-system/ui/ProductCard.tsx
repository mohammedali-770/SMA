/** Design-system menu card. */
import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { DishIcon } from '../../components/Icons';
import { Price } from '../../components/Price';
import { useI18n } from '../../i18n/I18nProvider';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';
import type { Product } from '../../types/models';
import { motion, radius, space, type as typeScale } from '../generated/tokens';
import { Text } from './Text';

interface Props {
  product: Product;
  hasModifiers: boolean;
  onAdd: (product: Product, withModifiers: boolean) => void;
}

export const ProductCard = React.memo(function ProductCard({ product, hasModifiers, onAdd }: Props) {
  const { t, pick, rtlRow } = useI18n();
  const color = useThemeColors();
  const styles = useStyles();
  const [imgFailed, setImgFailed] = useState(false);

  const name = pick(product.nameEn, product.nameAr);
  const description = pick(product.descriptionEn, product.descriptionAr);
  const kcalLabel = product.calories ? `${product.calories} ${t('kcal')}` : '';
  const actionLabel = hasModifiers ? t('customizeAdd') : t('addToCart');
  const showImage = !!product.imageUrl && !imgFailed;

  return (
    <View style={[styles.card, rtlRow]}>
      {showImage ? (
        <Image
          source={{ uri: product.imageUrl }}
          style={styles.img}
          contentFit="cover"
          transition={motion.quick}
          cachePolicy="memory-disk"
          recyclingKey={product.id}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <View style={[styles.img, styles.imgEmpty]}>
          <DishIcon size={34} color={color.heatOff} />
        </View>
      )}

      <View style={styles.body}>
        <Text variant="heading" numberOfLines={2}>{name}</Text>
        {description ? <Text variant="caption" tone="secondary" numberOfLines={2}>{description}</Text> : null}

        <View style={[styles.bottom, rtlRow]}>
          <View>
            <Price amount={product.price} size={typeScale.body.size} weight="700" />
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

const useStyles = makeStyles((color) => ({
  card: {
    flexDirection: 'row' as const,
    backgroundColor: color.appSurface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.appLine,
    overflow: 'hidden' as const,
  },
  img: { width: 104, minHeight: 112, backgroundColor: color.appSurface2 },
  imgEmpty: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: color.appSurface3,
  },
  body: { flex: 1, padding: space.s3, gap: space.s1 },
  bottom: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    justifyContent: 'space-between' as const,
    marginTop: space.s2,
  },
  add: {
    backgroundColor: color.ember,
    paddingHorizontal: space.s4,
    paddingVertical: space.s2,
    borderRadius: radius.md,
  },
  addPressed: { opacity: motion.pressedOpacity },
}));
