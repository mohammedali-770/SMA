/**
 * Profile → Legal & Support. Lists the ACTIVE legal/policy documents (RLS only
 * returns active rows) in canonical order and opens each in the in-app viewer.
 * Self-fetching; a load failure shows a friendly retry, never a broken screen.
 */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { legalDocOrder } from '../../lib/legal';
import { legal } from '../../services/api';
import { colors, font, radius, shadow, spacing } from '../../theme';
import type { DbLegalDocument } from '../../types/db';

export function LegalListScreen() {
  const { t, pick, isRTL } = useI18n();
  const [docs, setDocs] = useState<DbLegalDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null); setDocs(null);
    legal.list()
      .then((rows) => setDocs(rows.slice().sort((a, b) => legalDocOrder(a.document_type) - legalDocOrder(b.document_type))))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, []);

  return (
    <Screen background={colors.bg} edges={['top', 'left', 'right']}>
      <Header title={t('legalSupport')} showBack />
      {error ? (
        <ErrorView message={pick('Could not load documents.', 'تعذّر تحميل المستندات.')} onRetry={load} retryLabel={t('retry')} />
      ) : docs === null ? (
        <LoadingView label={t('loading')} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }} showsVerticalScrollIndicator={false}>
          {docs.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => router.push(`/legal/${d.document_type}`)}
              style={[styles.row, shadow.card]}
              accessibilityRole="button"
            >
              <Text style={[styles.rowText, { textAlign: isRTL ? 'right' : 'left' }]} numberOfLines={2}>
                {pick(d.title_en, d.title_ar)}
              </Text>
              <Text style={styles.chevron}>{isRTL ? '‹' : '›'}</Text>
            </Pressable>
          ))}
          {docs.length === 0 ? (
            <Text style={styles.empty}>{pick('No documents available.', 'لا توجد مستندات متاحة.')}</Text>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.white, borderRadius: radius.lg, paddingVertical: spacing.lg, paddingHorizontal: spacing.lg,
  },
  rowText: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.text },
  chevron: { fontSize: font.xl, fontWeight: '800', color: colors.purple },
  empty: { textAlign: 'center', color: colors.muted, fontSize: font.md, marginTop: spacing.xl },
});
