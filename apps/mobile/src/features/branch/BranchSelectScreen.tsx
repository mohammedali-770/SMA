/**
 * Manual branch picker (presented as a modal). Per the brief the app NEVER
 * auto-selects a branch — the customer must choose here. Closed branches are
 * shown but visibly marked; selecting one is allowed (browse), but checkout
 * blocks on a closed branch.
 */
import { router } from 'expo-router';
import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { useCatalog } from '../../store';
import { colors, font, radius, spacing, shadow } from '../../theme';
import { formatSAR } from '../../utils/format';
import type { Branch } from '../../types/models';

export function BranchSelectScreen() {
  const { t, pick, lang } = useI18n();
  const { branches, loading, error, reload, selectedBranchId, setSelectedBranch, branchIsOpen } = useCatalog();

  const choose = (b: Branch) => {
    setSelectedBranch(b.id);
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} background={colors.bg}>
      <Header title={t('selectBranch')} showBack />
      {loading ? (
        <LoadingView label={t('loading')} />
      ) : error ? (
        <ErrorView message={error} onRetry={reload} retryLabel={t('retry')} />
      ) : branches.length === 0 ? (
        <EmptyView emoji="🏬" title={t('noBranches')} />
      ) : (
        <FlatList
          data={branches}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const open = branchIsOpen(item);
            const selected = item.id === selectedBranchId;
            return (
              <Pressable
                onPress={() => choose(item)}
                style={({ pressed }) => [
                  styles.card,
                  shadow.card,
                  selected && styles.cardSelected,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.name}>{pick(item.nameEn, item.nameAr)}</Text>
                  <View style={[styles.badge, open ? styles.badgeOpen : styles.badgeClosed]}>
                    <Text style={[styles.badgeText, { color: open ? colors.success : colors.red }]}>
                      {open ? t('open') : t('closed')}
                    </Text>
                  </View>
                </View>
                {pick(item.addressEn, item.addressAr) ? (
                  <Text style={styles.address}>{pick(item.addressEn, item.addressAr)}</Text>
                ) : null}
                <View style={styles.metaRow}>
                  <Text style={styles.meta}>
                    {t('deliveryFee')}: {formatSAR(item.deliveryFee, lang)}
                  </Text>
                  <Text style={styles.meta}>
                    {t('minOrder')}: {formatSAR(item.minDeliveryOrder, lang)}
                  </Text>
                </View>
                {selected ? <Text style={styles.selectedTag}>✓ {pick('Selected', 'محدد')}</Text> : null}
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: 'transparent',
    gap: spacing.xs,
  },
  cardSelected: { borderColor: colors.purple },
  pressed: { opacity: 0.85 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: font.lg, fontWeight: '800', color: colors.text, flex: 1, paddingRight: spacing.sm },
  address: { fontSize: font.sm, color: colors.muted },
  metaRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs, flexWrap: 'wrap' },
  meta: { fontSize: font.sm, color: colors.text, fontWeight: '600' },
  badge: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  badgeOpen: { backgroundColor: '#e7f6ee' },
  badgeClosed: { backgroundColor: '#fdeaec' },
  badgeText: { fontSize: font.xs, fontWeight: '800' },
  selectedTag: { color: colors.purple, fontWeight: '800', marginTop: spacing.xs, fontSize: font.sm },
});
