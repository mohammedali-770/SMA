/**
 * Profile → Legal & Support.
 *
 * Top: the Contact & Support card — admin-configured channels (Call / WhatsApp
 * / Email + working hours). Channels render ONLY when enabled AND their value
 * survives sanitization (placeholder/template values are rejected), and each
 * row can open ONLY a link constructed by lib/supportContact (tel:, mailto:,
 * https://wa.me/<digits>) — never a stored URL. Customers cannot edit any of
 * it; writes are admin-only via app_settings RLS.
 *
 * Below: the ACTIVE legal/policy documents (RLS only returns active rows) in
 * canonical order, opened in the in-app viewer. Self-fetching; a load failure
 * shows a friendly retry, never a broken screen.
 */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useI18n } from '../../i18n/I18nProvider';
import { legalDocOrder } from '../../lib/legal';
import {
  supportDescription, visibleSupportChannels, workingHoursText, type SupportChannelKind,
} from '../../lib/supportContact';
import { legal } from '../../services/api';
import { useCatalog } from '../../store';
import { color, radius, space, type as typeScale } from '../../design-system/generated/tokens';
import { Text } from '../../design-system/ui/Text';
import type { DbLegalDocument } from '../../types/db';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';

const CHANNEL_EMOJI: Record<SupportChannelKind, string> = { phone: '📞', whatsapp: '💬', email: '✉️' };

export function LegalListScreen() {
  const styles = useStyles();
  const colors = useThemeColors();
  const { t, pick, lang, isRTL, rtlRow } = useI18n();
  const { support } = useCatalog();
  const [docs, setDocs] = useState<DbLegalDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState(false);

  const load = () => {
    setError(null); setDocs(null);
    legal.list()
      .then((rows) => setDocs(rows.slice().sort((a, b) => legalDocOrder(a.document_type) - legalDocOrder(b.document_type))))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, []);

  const channels = visibleSupportChannels(support);
  const hours = workingHoursText(support, lang);
  const desc = supportDescription(support, lang);
  const channelLabel: Record<SupportChannelKind, string> = {
    phone: t('callSupport'),
    whatsapp: t('whatsappSupport'),
    email: t('emailSupport'),
  };

  // The url is CONSTRUCTED by supportContact (tel:/mailto:/https://wa.me only).
  const openChannel = (url: string) => {
    setOpenError(false);
    Linking.openURL(url).catch(() => setOpenError(true));
  };

  return (
    <Screen background={colors.appBg} edges={['top', 'left', 'right']}>
      <Header title={t('legalSupport')} showBack />
      {error ? (
        <ErrorView message={pick('Could not load documents.', 'تعذّر تحميل المستندات.')} onRetry={load} retryLabel={t('retry')} />
      ) : docs === null ? (
        <LoadingView label={t('loading')} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Contact & Support — hidden entirely when nothing is configured. */}
          {channels.length > 0 || hours || desc ? (
            <View style={styles.supportCard}>
              <Text variant="title">{t('supportTitle')}</Text>
              {desc ? <Text variant="caption" tone="secondary">{desc}</Text> : null}
              {channels.map((c) => (
                <Pressable
                  key={c.kind}
                  onPress={() => openChannel(c.url)}
                  style={({ pressed }) => [styles.supportRow, rtlRow, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={channelLabel[c.kind]}
                >
                  <Text variant="title" style={styles.emoji}>{CHANNEL_EMOJI[c.kind]}</Text>
                  <View style={{ flex: 1 }}>
                    <Text variant="label">{channelLabel[c.kind]}</Text>
                    <Text variant="caption" tone="secondary" numberOfLines={1}>{c.display}</Text>
                  </View>
                  <Text variant="title" tone="ember">{isRTL ? '‹' : '›'}</Text>
                </Pressable>
              ))}
              {hours ? (
                <View style={[styles.supportRow, rtlRow]}>
                  <Text variant="title" style={styles.emoji}>🕘</Text>
                  <View style={{ flex: 1 }}>
                    <Text variant="label">{t('workingHours')}</Text>
                    <Text variant="caption" tone="secondary">{hours}</Text>
                  </View>
                </View>
              ) : null}
              {openError ? <Text variant="label" tone="danger">{t('supportOpenFailed')}</Text> : null}
            </View>
          ) : null}

          {docs.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => router.push(`/legal/${d.document_type}`)}
              style={({ pressed }) => [styles.row, rtlRow, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text variant="label" style={styles.rowText} numberOfLines={2}>
                {pick(d.title_en, d.title_ar)}
              </Text>
              <Text variant="title" tone="ember">{isRTL ? '‹' : '›'}</Text>
            </Pressable>
          ))}
          {docs.length === 0 ? (
            <Text variant="body" tone="secondary" align="center" style={styles.empty}>{pick('No documents available.', 'لا توجد مستندات متاحة.')}</Text>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  scroll: { padding: space.s4, gap: space.s2 },
  supportCard: {
    backgroundColor: colors.appSurface, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: colors.appLine, padding: space.s4, gap: space.s2, marginBottom: space.s1,
  },
  supportRow: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingVertical: space.s2 },
  emoji: { lineHeight: typeScale.title.lineHeight },
  pressed: { opacity: 0.7 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3,
    backgroundColor: colors.appSurface, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: colors.appLine, padding: space.s4,
  },
  rowText: { flex: 1 },
  empty: { marginTop: space.s5 },
}));
