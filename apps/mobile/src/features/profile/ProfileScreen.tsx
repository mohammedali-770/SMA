/**
 * Profile: identity from `profiles`, loyalty balance, language toggle, sign out.
 *
 * Name editing and address management do NOT exist here — the web app still
 * owns those flows. They are tracked as feature work, not as part of the design
 * migration: both would need new profile writes and address CRUD, and this pass
 * adds no API calls. See the issue linked from docs/BUTTON_FIELD_INVENTORY.md.
 */
import { router } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AwardIcon, SignOutIcon } from '../../components/Icons';
import { Screen } from '../../components/Screen';
import { color, radius, space } from '../../design-system/generated/tokens';
import { SelectableChip } from '../../design-system/ui/Chip';
import { columnStyles } from '../../design-system/ui/ContentColumn';
import { Text } from '../../design-system/ui/Text';
import { NotificationSettings } from '../notifications/NotificationSettings';
import { deactivateThisDevice } from '../notifications/pushRegistration';
import { VerifyPhoneWhatsApp } from './VerifyPhoneWhatsApp';
import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../store';

export function ProfileScreen() {
  const { t, pick, lang, setLang, rtlRow } = useI18n();
  const { profile, signOut } = useAuth();

  const onSignOut = async () => {
    // Silence this device BEFORE the JWT disappears — on a shared phone the
    // next account must not receive this account's pushes. Best-effort and
    // fast; sign-out proceeds regardless.
    await deactivateThisDevice();
    await signOut();
    router.replace('/(auth)/login');
  };

  const displayName = profile?.fullName || t('guest');
  const initials = displayName.trim().charAt(0).toUpperCase();

  return (
    <Screen background={color.appBg}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[columnStyles.column, styles.column]}>
        <Text variant="display">{t('profile')}</Text>

        <View style={[styles.card, styles.identity, rtlRow]}>
          <View style={styles.avatar}>
            <Text variant="title" tone="onEmber">{initials}</Text>
          </View>
          <View style={styles.identityBody}>
            <Text variant="heading" numberOfLines={1}>{displayName}</Text>
            {profile?.email ? (
              <Text variant="caption" tone="secondary" numberOfLines={1}>{profile.email}</Text>
            ) : null}
          </View>
        </View>

        {/* Loyalty — the one place a saffron accent earns its keep: a reward is
            neither a warning nor an action. */}
        <View style={[styles.card, styles.loyalty, rtlRow]}>
          <View style={[styles.loyaltyLabel, rtlRow]}>
            <AwardIcon size={22} color={color.saffron} />
            <Text variant="heading" style={{ color: color.amberInk }}>{t('loyaltyPoints')}</Text>
          </View>
          <Text variant="display" style={{ color: color.amberInk }}>{profile?.loyaltyPoints ?? 0}</Text>
        </View>

        <View style={styles.card}>
          <DetailRow label={t('phone')} value={profile?.phoneNumber || '—'} />
          <DetailRow label={t('role')} value={profile?.role ?? '—'} last />
        </View>

        {/* WhatsApp phone verification (signed-in only) */}
        {profile ? <VerifyPhoneWhatsApp /> : null}

        {/* Push notification preferences (signed-in only; real devices only) */}
        {profile ? <NotificationSettings /> : null}

        <Text variant="title" style={styles.sectionTitle}>{t('language')}</Text>
        {/* Same setters and labels as before. Two chips rather than a bespoke
            segmented control — the design system already owns "selected". */}
        <View style={styles.langRow}>
          <SelectableChip
            label={t('english')}
            selected={lang === 'en'}
            onPress={() => setLang('en')}
            style={styles.langChip}
          />
          <SelectableChip
            label={t('arabic')}
            selected={lang === 'ar'}
            onPress={() => setLang('ar')}
            style={styles.langChip}
          />
        </View>

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

        {/* Sign out — destructive, separated from normal settings. The sequence
            inside onSignOut is security-sensitive and unchanged. */}
        <Pressable
          onPress={onSignOut}
          accessibilityRole="button"
          accessibilityLabel={t('signOut')}
          style={({ pressed }) => [styles.signOut, rtlRow, pressed && styles.pressed]}
        >
          <SignOutIcon size={18} color={color.onEmber} />
          <Text variant="button" tone="onEmber">{t('signOut')}</Text>
        </Pressable>

        {/* Delete account — destructive and de-emphasized (text only) so it is
            discoverable but not tapped by accident. Opens the guarded flow. */}
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
  return (
    <View style={[styles.detailRow, rtlRow, !last && styles.detailBorder]}>
      <Text variant="body" tone="secondary">{label}</Text>
      <Text variant="label" style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: space.s4, paddingBottom: space.s6 * 2, alignItems: 'center' },
  column: { gap: space.s3 },
  card: {
    backgroundColor: color.appSurface, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: color.appLine, padding: space.s4,
  },
  pressed: { opacity: 0.9 },

  identity: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  identityBody: { flex: 1, gap: 2 },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: color.ember, alignItems: 'center', justifyContent: 'center',
  },

  loyalty: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: color.warnTint, borderColor: color.warnLine,
  },
  loyaltyLabel: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },

  detailRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: space.s3, paddingVertical: space.s3,
  },
  detailBorder: { borderBottomWidth: 1, borderBottomColor: color.appLine },
  detailValue: { flexShrink: 1 },

  sectionTitle: { marginTop: space.s2 },
  langRow: { flexDirection: 'row', gap: space.s2 },
  langChip: { flex: 1, minHeight: 44 },

  legalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  legalText: { flexShrink: 1 },

  signOut: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s2,
    backgroundColor: color.danger, borderRadius: radius.md, borderCurve: 'continuous',
    minHeight: 52, paddingHorizontal: space.s4, marginTop: space.s4,
  },
  delete: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: space.s2 },
  deleteText: { color: color.danger, textDecorationLine: 'underline' },
  version: { marginTop: space.s5 },
});
