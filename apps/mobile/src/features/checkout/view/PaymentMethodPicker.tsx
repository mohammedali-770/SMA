/**
 * Payment method selection.
 *
 * Availability is admin-controlled and re-validated by the server — this
 * renders whatever `methods` it is handed and never decides what is offerable.
 * Three distinct states, deliberately different shapes:
 *
 *   nothing available   a blocking notice, no controls at all;
 *   online unavailable  a warning notice ALONGSIDE the working cash option;
 *   normal              the options.
 *
 * The second is the one that matters: an outage is a warning, not an error —
 * the customer can still order — so it must not use the same red as a blocked
 * checkout, or "you can still pay cash" reads as "checkout is broken".
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { color, radius, space } from '../../../design-system/generated/tokens';
import { Notice } from '../../../design-system/ui/Notice';
import { Text } from '../../../design-system/ui/Text';
import type { PaymentMethod } from '../../../lib/payment';

export function PaymentMethodPicker({
  methods,
  selected,
  onSelect,
  labelFor,
  blocked,
  blockedTitle,
  outageNotice,
  cashNote,
}: {
  methods: PaymentMethod[];
  selected: PaymentMethod | null;
  onSelect: (m: PaymentMethod) => void;
  labelFor: (m: PaymentMethod) => string;
  blocked: boolean;
  blockedTitle: string;
  /** Shown when online is off but cash is on. */
  outageNotice: string | null;
  /** Shown when cash is the chosen method. */
  cashNote: string | null;
}) {
  if (blocked) return <Notice title={blockedTitle} tone="blocking" />;

  return (
    <View style={{ gap: space.s3 }}>
      <View style={styles.options}>
        {methods.map((m) => (
          <MethodOption
            key={m}
            label={labelFor(m)}
            active={selected === m}
            onPress={() => onSelect(m)}
          />
        ))}
      </View>
      {cashNote ? <Text variant="caption" tone="secondary">{cashNote}</Text> : null}
      {outageNotice ? <Notice title={outageNotice} tone="warning" /> : null}
    </View>
  );
}

function MethodOption({
  label, active, onPress,
}: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active, checked: active }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.option,
        active && styles.optionActive,
        pressed && styles.pressed,
      ]}
    >
      {/* A radio, not a filled chip: these are mutually exclusive choices, and
          the ember fill is reserved for things that commit an action. */}
      <View style={[styles.radio, active && styles.radioOn]}>
        {active ? <View style={styles.radioDot} /> : null}
      </View>
      <Text variant="label" tone={active ? 'primary' : 'secondary'} align="center">
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Fixed row direction: the options are a set, and mirroring their order in
  // Arabic gains nothing while making the two languages harder to compare.
  options: { flexDirection: 'row', gap: space.s3 },
  option: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s2,
    minHeight: 76,
    paddingHorizontal: space.s2,
    paddingVertical: space.s3,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.appLine,
    backgroundColor: color.appSurface,
  },
  optionActive: { borderColor: color.ember, backgroundColor: color.appSurface2 },
  pressed: { opacity: 0.8 },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: color.appText3,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { borderColor: color.ember },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.ember },
});
