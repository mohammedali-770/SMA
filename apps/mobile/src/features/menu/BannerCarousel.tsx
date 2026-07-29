/**
 * Homepage promotional banners — shown BELOW the branch selector and ABOVE the
 * search bar. Self-contained: it fetches its own data (RLS returns only active,
 * in-window rows) so a slow/failed banner fetch never blocks menu rendering.
 *
 *  - 0 active banners  -> renders nothing (the area collapses; search moves up).
 *  - 1 active banner   -> a single static banner.
 *  - 2+ active banners -> an auto-rotating, swipeable carousel with dots + loop.
 *
 * Aspect ratio ~16:6 (short, never tall), rounded corners, cover-fit (no
 * distortion). A banner whose image fails to load is skipped, not crashed.
 */
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { catalog } from '../../services/api';
import { mapBanner } from '../../lib/mappers';
import { colors, radius, spacing } from '../../theme';
import { makeStyles } from '../../theme/makeStyles';
import type { HomeBanner } from '../../types/models';

const ROTATE_MS = 4000;
const RATIO = 6 / 16; // height = width * 6/16 (~2.67:1) — short banner.

export function BannerCarousel() {
  const styles = useStyles();
  const [banners, setBanners] = useState<HomeBanner[]>([]);
  const [failed, setFailed] = useState<Record<string, true>>({});
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const [focused, setFocused] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  // Pause auto-rotation while the home tab is not focused (expo-router focus).
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  // Independent fetch — errors just yield an empty (hidden) banner area.
  useEffect(() => {
    let alive = true;
    catalog
      .banners()
      .then((rows) => { if (alive) setBanners(rows.map(mapBanner).filter((b) => b.imageUrl)); })
      .catch(() => { if (alive) setBanners([]); });
    return () => { alive = false; };
  }, []);

  const visible = banners.filter((b) => !failed[b.id]);
  const count = visible.length;
  const height = width > 0 ? Math.round(width * RATIO) : 0;

  // Auto-rotate only when there is something to rotate, we know the width, and
  // the home tab is actually focused (no work while the user is elsewhere).
  useEffect(() => {
    if (count <= 1 || width === 0 || !focused) return;
    const id = setInterval(() => {
      setIndex((prev) => {
        const next = (prev + 1) % count;
        scrollRef.current?.scrollTo({ x: next * width, animated: true });
        return next;
      });
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [count, width, focused]);

  // Keep the active-dot in sync when the index would fall out of range (e.g. a
  // banner was skipped after an image error).
  useEffect(() => {
    if (index > count - 1) setIndex(0);
  }, [count, index]);

  if (count === 0) return null;

  const onImgError = (id: string) => setFailed((f) => ({ ...f, [id]: true }));

  const onTap = (b: HomeBanner) => {
    if (b.actionType === 'product' && b.actionValue) router.push(`/product/${b.actionValue}`);
    // 'category' / 'none' -> no navigation (kept intentionally simple).
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width > 0) setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <View style={[styles.frame, { height }]}>
          {count === 1 ? (
            <BannerImage banner={visible[0]} width={width} height={height} onError={onImgError} onPress={onTap} />
          ) : (
            <>
              <ScrollView
                ref={scrollRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={onMomentumEnd}
                scrollEventThrottle={16}
              >
                {visible.map((b) => (
                  <BannerImage key={b.id} banner={b} width={width} height={height} onError={onImgError} onPress={onTap} />
                ))}
              </ScrollView>
              <View style={styles.dots} pointerEvents="none">
                {visible.map((b, i) => (
                  <View key={b.id} style={[styles.dot, i === index && styles.dotActive]} />
                ))}
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function BannerImage({
  banner, width, height, onError, onPress,
}: {
  banner: HomeBanner; width: number; height: number;
  onError: (id: string) => void; onPress: (b: HomeBanner) => void;
}) {
  const tappable = banner.actionType === 'product' && !!banner.actionValue;
  return (
    <Pressable onPress={() => onPress(banner)} disabled={!tappable} style={{ width, height }} accessibilityRole={tappable ? 'button' : 'image'}>
      <Image
        source={{ uri: banner.imageUrl }}
        style={{ width, height }}
        contentFit="cover"
        transition={150}
        cachePolicy="memory-disk"
        onError={() => onError(banner.id)}
      />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { marginHorizontal: spacing.lg, marginTop: spacing.md },
  frame: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.bgAlt, width: '100%' },
  dots: { position: 'absolute', bottom: spacing.sm, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { backgroundColor: colors.surface, width: 16 },
}));
