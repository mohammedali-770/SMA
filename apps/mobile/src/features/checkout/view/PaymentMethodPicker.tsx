/**
 * Payment method selection.
 *
 * Availability is admin-controlled and re-validated by the server — this
 * renders whatever `methods` it is handed and never decides what is offerable.
 * Two states now, not three:
 *
 *   nothing available   a blocking notice, no controls at all;
 *   normal              the options, NONE of them preselected.
 *
 * THE THIRD STATE WAS REMOVED ON PURPOSE (owner decision, 2026-09-14). A
 * warning used to sit beside the working cash option saying online payment was
 * unavailable and cash was enabled. Cash is not a fallback for a gateway that
 * is down — it is the launch payment method, and there is no gateway to be
 * down. Apologising for its absence advertised something the customer cannot
 * have, and framed the normal way to pay as a degraded mode. The shop simply
 * takes cash; the picker says so by offering it and saying nothing else.
 *
 * `selected` may be null and usually is on arrival. The customer chooses; the
 * footer's blocking message is what tells them so, and the Place Order button
 * stays dead until they do.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { color, radius, space } from '../../../design-system/generated/tokens';
import { Notice } from '../../../design-system/ui/Notice';
import { Text } from '../../../design-system/ui/Text';
import type { PaymentMethod } from '../../../lib/payment';
import { makeStyles } from '../../../theme/makeStyles';

export function PaymentMethodPicker({
  methods,
  selected,
  onSelect,
  labelFor,
  blocked,
  blockedTitle,
  cashNote,
}: {
  methods: PaymentMethod[];
  selected: PaymentMethod | null;
  onSelect: (m: PaymentMethod) => void;
  labelFor: (m: PaymentMethod) => string;
  blocked: boolean;
  blockedTitle: string;
  /** Shown when cash is the chosen method — so it appears only after a choice. */
  cashNote: string | null;
}) {
  const styles = useStyles();
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
    </View>
  );
}

function MethodOption({
  label, active, onPress,
}: { label: string; active: boolean; onPress: () => void }) {
  const styles = useStyles();
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

const useStyles = makeStyles((colors) => ({
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
    borderColor: colors.appLine,
    backgroundColor: colors.appSurface,
  },
  optionActive: { borderColor: colors.ember, backgroundColor: colors.appSurface2 },
  pressed: { opacity: 0.8 },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: colors.appText3,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { borderColor: colors.ember },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ember },
}));
