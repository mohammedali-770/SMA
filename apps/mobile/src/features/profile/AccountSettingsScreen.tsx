import { router } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, Share, View } from 'react-native';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { radius, space } from '../../design-system/generated/tokens';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { makeStyles } from '../../theme/makeStyles';
import { dataExport } from '../../services/api';
import {
  exportErrorMessage,
  exportTitle,
  isTooLargeToShare,
  shouldStartExport,
  summarizeExport,
  summaryLine,
  tooLargeMessage,
  type ExportState,
} from './dataExport';
export function AccountSettingsScreen() {
  const s = useStyles();
  const { t, pick, rtlRow, lang } = useI18n();
  const [exportState, setExportState] = React.useState<ExportState>('idle');
  const [exportNote, setExportNote] = React.useState<string | null>(null);
  const requestMyData = React.useCallback(async () => {
    if (!shouldStartExport(exportState)) return;
    setExportState('working');
    setExportNote(null);
    try {
      const payload = await dataExport.mine();
      const summary = summarizeExport(payload);
      const json = JSON.stringify(payload, null, 2);
      // Refuse loudly rather than hand Android an Intent extra it may drop. The
      // share text crosses Binder, whose buffer is shared and about 1 MB, so an
      // oversized payload fails — sometimes silently — for exactly the customers
      // with the most history. See dataExport.ts; the real fix is a file
      // attachment once a native build can carry expo-file-system.
      if (isTooLargeToShare(json)) {
        setExportState('too_large');
        setExportNote(tooLargeMessage(lang));
        return;
      }
      await Share.share({ title: exportTitle(new Date(), lang), message: json });
      setExportState('shared');
      setExportNote(summaryLine(summary, lang));
    } catch (e) {
      setExportState('error');
      setExportNote(exportErrorMessage(e, lang));
    }
  }, [exportState, lang]);
  return (
    <Screen>
      <Header title={pick('Account & privacy', 'الحساب والخصوصية')} showBack />
      {/* SCROLLABLE, like every other variable-height profile screen.
          `Screen` wraps its children in a plain non-scrolling `View`, and this
          screen stopped being fixed-height the moment the data card was added —
          more so once a summary or error note appends after an export. On a
          compact device, or at a large accessibility font size, that pushed the
          danger zone and the delete-account row below the viewport with no way
          to reach them. B1 requires account deletion to be reachable, so this is
          a functional regression rather than a layout nicety. Review caught it
          on #343. */}
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.card}>
          <Text variant="title">{pick('Account management', 'إدارة الحساب')}</Text>
          <Text variant="body" tone="secondary">
            {pick('Manage sensitive account actions here.', 'يمكنك إدارة إجراءات الحساب الحساسة من هنا.')}
          </Text>
        </View>
        <View style={s.card}>
          <Text variant="title">{pick('Your data', 'بياناتك')}</Text>
          <Text variant="body" tone="secondary">
            {pick(
              'Get a copy of everything we hold about you — your account, addresses, orders and loyalty history.',
              'احصل على نسخة من كل ما نحتفظ به عنك: حسابك وعناوينك وطلباتك وسجل نقاطك.',
            )}
          </Text>
          <Pressable
            onPress={() => void requestMyData()}
            disabled={exportState === 'working'}
            accessibilityRole="button"
            accessibilityLabel={pick('Get a copy of my data', 'احصل على نسخة من بياناتي')}
            style={({ pressed }) => [
              s.deleteRow,
              rtlRow,
              pressed && s.pressed,
              exportState === 'working' && s.pressed,
            ]}
          >
            <Text variant="heading">
              {exportState === 'working'
                ? pick('Preparing…', 'جارٍ التجهيز…')
                : pick('Get a copy of my data', 'احصل على نسخة من بياناتي')}
            </Text>
            <Text variant="title">›</Text>
          </Pressable>
          {exportNote ? (
            <Text variant="caption" tone={exportState === 'error' ? 'danger' : 'secondary'}>
              {exportNote}
            </Text>
          ) : null}
        </View>
        <View style={s.dangerCard}>
          <Text variant="title" tone="danger">
            {pick('Danger zone', 'إجراءات حساسة')}
          </Text>
          <Text variant="caption" tone="secondary">
            {pick(
              'Account deletion requires additional confirmation.',
              'حذف الحساب يتطلب خطوات تأكيد إضافية.',
            )}
          </Text>
          <Pressable
            onPress={() => router.push('/account/delete')}
            accessibilityRole="button"
            style={({ pressed }) => [s.deleteRow, rtlRow, pressed && s.pressed]}
          >
            <Text variant="heading" tone="danger">
              {t('delAccount')}
            </Text>
            <Text variant="title" tone="danger">
              ›
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}
const useStyles = makeStyles((c) => ({
  body: { padding: space.s4, gap: space.s4 },
  card: {
    backgroundColor: c.appSurface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.appLine,
    padding: space.s4,
    gap: space.s2,
  },
  dangerCard: {
    backgroundColor: c.dangerTint,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.dangerLine,
    padding: space.s4,
    gap: space.s3,
  },
  deleteRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    minHeight: 52,
    paddingTop: space.s2,
  },
  pressed: { opacity: 0.75 },
}));
