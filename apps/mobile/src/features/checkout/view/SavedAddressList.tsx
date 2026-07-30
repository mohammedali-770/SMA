/**
 * Saved delivery locations. Selecting one moves the map pin to its
 * coordinates — the screen owns that; this is the list and its selected state.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { color, radius, space } from '../../../design-system/generated/tokens';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import type { SavedAddress } from '../../../types/models';

export function SavedAddressList({
  addresses,
  selectedId,
  onSelect,
  title,
  fallbackLabel,
}: {
  addresses: SavedAddress[];
  selectedId: string | null;
  onSelect: (a: SavedAddress) => void;
  title: string;
  fallbackLabel: string;
}) {
  const { rtlRow } = useI18n();
  if (addresses.length === 0) return null;

  return (
    <View style={{ gap: space.s2 }}>
      <Text variant="label" tone="secondary">{title}</Text>
      {addresses.map((a) => {
        const active = selectedId === a.id;
        return (
          <Pressable
            key={a.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, checked: active }}
            accessibilityLabel={a.label || fallbackLabel}
            style={({ pressed }) => [
              styles.row, rtlRow,
              active && styles.rowActive,
              pressed && styles.pressed,
            ]}
            onPress={() => onSelect(a)}
          >
            <View style={[styles.radio, active && styles.radioOn]}>
              {active ? <View style={styles.radioDot} /> : null}
            </View>
            <View style={styles.body}>
              <Text variant="label">{a.label || fallbackLabel}</Text>
              {a.description ? (
                <Text variant="caption" tone="secondary" numberOfLines={2}>{a.description}</Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3,
    padding: space.s3, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: color.appLine, backgroundColor: color.appSurface,
  },
  rowActive: { borderColor: color.ember, backgroundColor: color.appSurface2 },
  pressed: { opacity: 0.8 },
  body: { flex: 1, gap: 2 },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: color.appText3,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { borderColor: color.ember },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.ember },
});
