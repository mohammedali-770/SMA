/**
 * Profile: identity, loyalty, saved addresses, language, appearance and sign out.
 */
import { router } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AwardIcon, SignOutIcon } from '../../components/Icons';
import { Screen } from '../../components/Screen';
import { radius, space } from '../../design-system/generated/tokens';
import { SelectableChip } from '../../design-system/ui/Chip';
import { columnStyles } from '../../design-system/ui/ContentColumn';
import { Text } from '../../design-system/ui/Text';
import { EditableName } from './EditableName';
import { NotificationSettings } from '../notifications/NotificationSettings';
import { deactivateThisDevice } from '../notifications/pushRegistration';
import { VerifyPhoneWhatsApp } from './VerifyPhoneWhatsApp';
import { useI18n } from '../../i18n/I18nProvider';
import { useAddressBook, useAuth } from '../../store';
import { useTheme, type ThemePreference } from '../../theme/ThemeProvider';
import { makeStyles } from '../../theme/makeStyles';

const APPEARANCE: ThemePreference[] = ['system', 'light', 'dark'];

export function ProfileScreen() {
  const { t, pick, lang, setLang, rtlRow } = useI18n();
  const { preference, setPreference, colors } = useTheme();
  const styles = useStyles();
  const { profile, signOut } = useAuth();
  const addressBook = useAddressBook();

  const onSignOut = async () => {
    await deactivateThisDevice();
    await signOut();
    router.replace('/(auth)/login');
  };

  const addressCount = addressBook.addresses.length;
  const appearanceLabel = (value: ThemePreference) =>
    value === 'system' ? pick('System', 'النظام')
    : value === 'light' ? pick('Light', 'فاتح')
    : pick('Dark', 'داكن');

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[columnStyles.column, styles.column]}>
        <Text variant="display">{t('profile')}</Text>

        <EditableName />

        <View style={[styles.card, styles.loyalty, rtlRow]}>
          <View style={[styles.loyaltyLabel, rtlRow]}>
            <AwardIcon size={22} color={colors.saffron} />
            <Text variant="heading" style={{ color: colors.amberInk }}>{t('loyaltyPoints')}</Text>
          </View>
          <Text variant="display" style={{ color: colors.amberInk }}>{profile?.loyaltyPoints ?? 0}</Text>
        </View>

        <View style={styles.card}>
          <DetailRow label={t('phone')} value={profile?.phoneNumber || '—'} />
          <DetailRow label={t('role')} value={profile?.role ?? '—'} last />
        </View>

        {profile ? (
          <Pressable
            style={({ pressed }) => [styles.card, styles.legalRow, rtlRow, pressed && styles.pressed]}
            onPress={() => router.push('/profile/addresses')}
            accessibilityRole="button"
            accessibilityLabel={t('addrManage')}
            accessibilityHint={t('addrManageHint')}
          >
            <View style={styles.addressLabel}>
              <Text variant="body">{t('addrManage')}</Text>
              <Text variant="caption" tone="secondary">
                {addressCount === 0 ? t('addrEmptyTitle') : `${addressCount}`}
              </Text>
            </View>
            <Text variant="title" tone="ember">{lang === 'ar' ? '‹' : '›'}</Text>
          </Pressable>
        ) : null}

        {profile ? <VerifyPhoneWhatsApp /> : null}
        {profile ? <NotificationSettings /> : null}

        <Text variant="title" style={styles.sectionTitle}>{t('language')}</Text>
        <View style={styles.langRow}>
          <SelectableChip label={t('english')} selected={lang === 'en'} onPress={() => setLang('en')} style={styles.langChip} />
          <SelectableChip label={t('arabic')} selected={lang === 'ar'} onPress={() => setLang('ar')} style={styles.langChip} />
        </View>

        <Text variant="title" style={styles.sectionTitle}>{pick('Appearance', 'المظهر')}</Text>
        <View style={styles.appearanceRow}>
          {APPEARANCE.map((value) => (
            <SelectableChip
              key={value}
              label={appearanceLabel(value)}
              selected={preference === value}
              onPress={() => setPreference(value)}
              style={styles.appearanceChip}
            />
          ))}
        </View>
        <Text variant="caption" tone="tertiary">
          {pick('System follows your device appearance.', 'النظام يتبع مظهر جهازك.')}
        </Text>

        <Text variant="title" style={styles.sectionTitle}>{t('legalSupport')}</Text>
        <Pressable
          style={({ pressed }) => [styles.card, styles.legalRow, rtlRow, pressed && styles.pressed]}
          onPress={() => router.push('/legal')}
          accessibilityRole="button"
        >
          <Text variant="body" style={styles.legalText}>
            {pick('Policies, privacy & contact', 'السياسات والخصوصية والتواصل')}
          </Text>
          <Text variant="title" tone="ember">{lang === 'ar' ? '‹' : '›'}</Text>
        </Pressable>

        <Pressable
          onPress={onSignOut}
          accessibilityRole="button"
          accessibilityLabel={t('signOut')}
          style={({ pressed }) => [styles.signOut, rtlRow, pressed && styles.pressed]}
        >
          <SignOutIcon size={18} color={colors.onEmber} />
          <Text variant="button" tone="onEmber">{t('signOut')}</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/account/delete')}
          accessibilityRole="button"
          accessibilityLabel={t('delAccount')}
          accessibilityHint={pick('Opens account deletion', 'يفتح حذف الحساب')}
          style={({ pressed }) => [styles.delete, pressed && styles.pressed]}
        >
          <Text variant="body" align="center" style={styles.deleteText}>{t('delAccount')}</Text>
        </Pressable>

        <Text variant="caption" tone="tertiary" align="center" style={styles.version}>
          {pick('Spicy Meal · v1.0.0', 'سبايسي ميل · الإصدار 1.0.0')}
        </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const { rtlRow } = useI18n();
  const styles = useStyles();
  return (
    <View style={[styles.detailRow, rtlRow, !last && styles.detailBorder]}>
      <Text variant="body" tone="secondary">{label}</Text>
      <Text variant="label" style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  scroll: { padding: space.s4, paddingBottom: space.s6 * 2, alignItems: 'center' as const },
  column: { gap: space.s3 },
  card: {
    backgroundColor: color.appSurface, borderRadius: radius.lg, borderCurve: 'continuous' as const,
    borderWidth: 1, borderColor: color.appLine, padding: space.s4,
  },
  pressed: { opacity: 0.9 },
  addressLabel: { flexShrink: 1, gap: 2 },
  loyalty: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const,
    backgroundColor: color.warnTint, borderColor: color.warnLine,
  },
  loyaltyLabel: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.s2 },
  detailRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const,
    gap: space.s3, paddingVertical: space.s3,
  },
  detailBorder: { borderBottomWidth: 1, borderBottomColor: color.appLine },
  detailValue: { flexShrink: 1 },
  sectionTitle: { marginTop: space.s2 },
  langRow: { flexDirection: 'row' as const, gap: space.s2 },
  langChip: { flex: 1, minHeight: 44 },
  appearanceRow: { flexDirection: 'row' as const, gap: space.s2 },
  appearanceChip: { flex: 1, minHeight: 44, paddingHorizontal: space.s2 },
  legalRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, minHeight: 44 },
  legalText: { flexShrink: 1 },
  signOut: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: space.s2,
    backgroundColor: color.danger, borderRadius: radius.md, borderCurve: 'continuous' as const,
    minHeight: 52, paddingHorizontal: space.s4, marginTop: space.s4,
  },
  delete: { alignItems: 'center' as const, justifyContent: 'center' as const, minHeight: 44, marginTop: space.s2 },
  deleteText: { color: color.danger, textDecorationLine: 'underline' as const },
  version: { marginTop: space.s5 },
}));
