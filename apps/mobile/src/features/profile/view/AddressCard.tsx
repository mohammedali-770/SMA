/**
 * One saved address in the profile list, with its three actions.
 *
 * Deliberately NOT `checkout/view/SavedAddressList` and deliberately not a
 * variant of it. That component is a radio group: its whole job is "which one
 * are you ordering to", it returns null when the list is empty, and every row is
 * one big press target. Here the row is not selectable at all — it carries three
 * separate destinations (edit, make default, delete), so making the card itself
 * pressable would put a destructive action inside a tap target that also means
 * "open". They render the same information in the same visual language because
 * they are the same address, not because one is a copy of the other.
 *
 * Presentational only: every string is injected, exactly like SavedAddressList,
 * so the copy stays with the screen that owns the flow.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { color, radius, space } from '../../../design-system/generated/tokens';
import { Button } from '../../../design-system/ui/Button';
import { StatusPill } from '../../../design-system/ui/Chip';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import type { SavedAddress } from '../../../types/models';

export function AddressCard({
  address,
  busy,
  fallbackLabel,
  defaultLabel,
  setDefaultLabel,
  editLabel,
  deleteLabel,
  onEdit,
  onSetDefault,
  onDelete,
}: {
  address: SavedAddress;
  /** A write is in flight for THIS address; its actions are inert meanwhile. */
  busy: boolean;
  fallbackLabel: string;
  defaultLabel: string;
  setDefaultLabel: string;
  editLabel: string;
  deleteLabel: string;
  onEdit: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  const { rtlRow } = useI18n();
  const name = address.label || fallbackLabel;

  return (
    <View style={styles.card}>
      <View style={[styles.head, rtlRow]}>
        <Text variant="label" style={styles.name} numberOfLines={1}>{name}</Text>
        {address.isDefault ? <StatusPill label={defaultLabel} tone="success" /> : null}
      </View>

      {/* The mandatory landmark is the thing a driver actually reads, so it is
          the body of the card rather than a footnote. */}
      {address.description ? (
        <Text variant="caption" tone="secondary" numberOfLines={3}>{address.description}</Text>
      ) : null}

      {/* The short address is a code, so it stays LTR even in Arabic. */}
      {address.nationalShortAddress ? (
        <Text variant="caption" tone="tertiary" align="ltr-start">{address.nationalShortAddress}</Text>
      ) : null}

      <View style={[styles.actions, rtlRow]}>
        <Button
          label={editLabel}
          variant="secondary"
          size="md"
          onPress={onEdit}
          disabled={busy}
          style={styles.action}
          accessibilityLabel={`${editLabel} — ${name}`}
        />
        {/* The default address has nowhere to be promoted to; showing a
            disabled "Make default" on it would be a control that can never do
            anything. */}
        {address.isDefault ? null : (
          <Button
            label={setDefaultLabel}
            variant="ghost"
            size="md"
            onPress={onSetDefault}
            loading={busy}
            style={styles.action}
            accessibilityLabel={`${setDefaultLabel} — ${name}`}
          />
        )}
        <Button
          label={deleteLabel}
          variant="danger"
          size="md"
          onPress={onDelete}
          disabled={busy}
          style={styles.action}
          accessibilityLabel={`${deleteLabel} — ${name}`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.s2,
    padding: space.s4,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: color.appLine,
    backgroundColor: color.appSurface,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  name: { flexShrink: 1 },
  // Wraps rather than squeezing three labels onto one line — Arabic labels are
  // longer than their English counterparts and would otherwise truncate.
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2, marginTop: space.s2 },
  action: { flexGrow: 1, flexBasis: 96 },
});
