/**
 * In-app legal document viewer. Reads the `type` route param, fetches the ACTIVE
 * document (RLS hides inactive rows -> shown as "not available"), and renders the
 * current-language content with preserved line breaks and RTL for Arabic. Version
 * and effective date are shown at the bottom when available.
 */
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { legalTitle } from '../../lib/legal';
import { legal } from '../../services/api';
import { color, space } from '../../design-system/generated/tokens';
import { Text } from '../../design-system/ui/Text';
import type { DbLegalDocument } from '../../types/db';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'missing' }
  | { kind: 'ok'; doc: DbLegalDocument };

export function LegalDocScreen() {
  const styles = useStyles();
  const colors = useThemeColors();
  const { type } = useLocalSearchParams<{ type: string }>();
  const { t, pick, lang } = useI18n();
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

  return (
    <Screen background={colors.appBg} edges={['top', 'left', 'right']}>
      <Header title={headerTitle} showBack />
      {state.kind === 'loading' ? (
        <LoadingView label={t('loading')} />
      ) : state.kind === 'error' ? (
        <ErrorView message={pick('Could not load this document.', 'تعذّر تحميل هذا المستند.')} onRetry={load} retryLabel={t('retry')} />
      ) : state.kind === 'missing' ? (
        <View style={styles.center}>
          <Text variant="body" tone="secondary" align="center">{pick('This document is not available.', 'هذا المستند غير متاح.')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text variant="display" style={styles.title}>{pick(state.doc.title_en, state.doc.title_ar)}</Text>
          <Text variant="body">{pick(state.doc.content_en, state.doc.content_ar)}</Text>
          <View style={styles.metaWrap}>
            <Text variant="caption" tone="tertiary">
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.s6 },
  scroll: { padding: space.s4, paddingBottom: space.s6 },
  title: { marginBottom: space.s3 },
  metaWrap: { marginTop: space.s5, paddingTop: space.s3, borderTopWidth: 1, borderTopColor: colors.appLine },
}));
