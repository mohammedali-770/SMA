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
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
import { colors, font, radius, shadow, spacing } from '../../theme';
import type { DbLegalDocument } from '../../types/db';

const CHANNEL_EMOJI: Record<SupportChannelKind, string> = { phone: '📞', whatsapp: '💬', email: '✉️' };

export function LegalListScreen() {
  const { t, pick, lang, isRTL, rtlText, rtlRow } = useI18n();
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
    <Screen background={colors.bg} edges={['top', 'left', 'right']}>
      <Header title={t('legalSupport')} showBack />
      {error ? (
        <ErrorView message={pick('Could not load documents.', 'تعذّر تحميل المستندات.')} onRetry={load} retryLabel={t('retry')} />
      ) : docs === null ? (
        <LoadingView label={t('loading')} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }} showsVerticalScrollIndicator={false}>
          {/* Contact & Support — hidden entirely when nothing is configured. */}
          {channels.length > 0 || hours || desc ? (
            <View style={[styles.supportCard, shadow.card]}>
              <Text style={[styles.supportTitle, rtlText]}>{t('supportTitle')}</Text>
              {desc ? <Text style={[styles.supportDesc, rtlText]}>{desc}</Text> : null}
              {channels.map((c) => (
                <Pressable
                  key={c.kind}
                  onPress={() => openChannel(c.url)}
                  style={({ pressed }) => [styles.supportRow, rtlRow, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={channelLabel[c.kind]}
                >
                  <Text style={styles.supportEmoji}>{CHANNEL_EMOJI[c.kind]}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.supportAction, rtlText]}>{channelLabel[c.kind]}</Text>
                    <Text style={[styles.supportValue, rtlText]} numberOfLines={1}>{c.display}</Text>
                  </View>
                  <Text style={styles.chevron}>{isRTL ? '‹' : '›'}</Text>
                </Pressable>
              ))}
              {hours ? (
                <View style={[styles.supportRow, rtlRow]}>
                  <Text style={styles.supportEmoji}>🕘</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.supportAction, rtlText]}>{t('workingHours')}</Text>
                    <Text style={[styles.supportValue, rtlText]}>{hours}</Text>
                  </View>
                </View>
              ) : null}
              {openError ? <Text style={[styles.openError, rtlText]}>{t('supportOpenFailed')}</Text> : null}
            </View>
          ) : null}

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
  supportCard: {
    backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.lg,
    gap: spacing.sm, marginBottom: spacing.sm,
  },
  supportTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  supportDesc: { fontSize: font.sm, color: colors.muted },
  supportRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  supportEmoji: { fontSize: font.xl },
  supportAction: { fontSize: font.md, fontWeight: '800', color: colors.text },
  supportValue: { fontSize: font.sm, color: colors.muted, marginTop: 1 },
  openError: { color: colors.danger, fontWeight: '700', fontSize: font.sm },
  pressed: { opacity: 0.7 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.white, borderRadius: radius.lg, paddingVertical: spacing.lg, paddingHorizontal: spacing.lg,
  },
  rowText: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.text },
  chevron: { fontSize: font.xl, fontWeight: '800', color: colors.purple },
  empty: { textAlign: 'center', color: colors.muted, fontSize: font.md, marginTop: spacing.xl },
});
