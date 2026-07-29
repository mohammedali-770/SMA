/**
 * In-app legal document viewer. Reads the `type` route param, fetches the ACTIVE
 * document (RLS hides inactive rows -> shown as "not available"), and renders the
 * current-language content with preserved line breaks and RTL for Arabic. Version
 * and effective date are shown at the bottom when available.
 */
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { legalTitle } from '../../lib/legal';
import { legal } from '../../services/api';
import { colors, font, spacing } from '../../theme';
import { useThemeColors } from '../../theme/ThemeProvider';
import { makeStyles } from '../../theme/makeStyles';
import type { DbLegalDocument } from '../../types/db';

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'missing' }
  | { kind: 'ok'; doc: DbLegalDocument };

export function LegalDocScreen() {
  const colors = useThemeColors();
  const styles = useStyles();
  const { type } = useLocalSearchParams<{ type: string }>();
  const { t, pick, lang, isRTL } = useI18n();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const docType = String(type ?? '');

  const load = () => {
    setState({ kind: 'loading' });
    legal.byType(docType)
      .then((doc) => setState(doc && doc.is_active ? { kind: 'ok', doc } : { kind: 'missing' }))
      .catch(() => setState({ kind: 'error' }));
  };
  useEffect(load, [docType]);

  const headerTitle = state.kind === 'ok' ? pick(state.doc.title_en, state.doc.title_ar) : legalTitle(docType, lang);
  const align = { textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr' } as const;

  return (
    <Screen background={colors.bg} edges={['top', 'left', 'right']}>
      <Header title={headerTitle} showBack />
      {state.kind === 'loading' ? (
        <LoadingView label={t('loading')} />
      ) : state.kind === 'error' ? (
        <ErrorView message={pick('Could not load this document.', 'تعذّر تحميل هذا المستند.')} onRetry={load} retryLabel={t('retry')} />
      ) : state.kind === 'missing' ? (
        <View style={styles.center}>
          <Text style={styles.missing}>{pick('This document is not available.', 'هذا المستند غير متاح.')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
          <Text style={[styles.title, align]}>{pick(state.doc.title_en, state.doc.title_ar)}</Text>
          <Text style={[styles.body, align]}>{pick(state.doc.content_en, state.doc.content_ar)}</Text>
          <View style={styles.metaWrap}>
            <Text style={[styles.meta, align]}>
              {pick('Version', 'الإصدار')} {state.doc.version}
              {state.doc.effective_date ? ` · ${pick('Effective', 'ساري من')} ${state.doc.effective_date}` : ''}
            </Text>
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  missing: { fontSize: font.md, color: colors.muted, fontWeight: '700', textAlign: 'center' },
  title: { fontSize: font.xl, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  body: { fontSize: font.md, color: colors.text, lineHeight: 22 },
  metaWrap: { marginTop: spacing.xl, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  meta: { fontSize: font.xs, color: colors.muted, fontWeight: '600' },
}));
