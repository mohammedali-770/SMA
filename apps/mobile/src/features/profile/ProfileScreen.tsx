/**
 * Profile: identity from `profiles`, loyalty balance, language toggle, sign out.
 * Address management / editing profile fields is deferred to a later pass — the
 * web app still owns those flows.
 */
import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';

import { AwardIcon, SignOutIcon } from '../../components/Icons';
import { Screen } from '../../components/Screen';
import { NotificationSettings } from '../notifications/NotificationSettings';
import { deactivateThisDevice } from '../notifications/pushRegistration';
import { VerifyPhoneWhatsApp } from './VerifyPhoneWhatsApp';
import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../store';
import { colors, font, radius, shadow, spacing } from '../../theme';

export function ProfileScreen() {
  const { t, pick, lang, setLang, rtlText, rtlRow } = useI18n();
  const { profile, signOut } = useAuth();

  const onSignOut = async () => {
    // Silence this device BEFORE the JWT disappears — on a shared phone the
    // next account must not receive this account's pushes. Best-effort and
    // fast; sign-out proceeds regardless.
    await deactivateThisDevice();
    await signOut();
    router.replace('/(auth)/login');
  };

  const initials = (profile?.fullName || t('guest')).trim().charAt(0).toUpperCase();

  return (
    <Screen background={colors.bg}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl * 2 }} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('profile')}</Text>
        </View>

        <View style={[styles.card, shadow.card, styles.identity, rtlRow]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, rtlText]}>{profile?.fullName || t('guest')}</Text>
            {profile?.email ? <Text style={[styles.muted, rtlText]} numberOfLines={1}>{profile.email}</Text> : null}
          </View>
        </View>

        {/* Loyalty */}
        <View style={[styles.card, shadow.card, styles.loyalty, rtlRow]}>
          <View style={[styles.loyaltyLabelRow, rtlRow]}>
            <AwardIcon size={22} />
            <Text style={styles.loyaltyLabel}>{t('loyaltyPoints')}</Text>
          </View>
          <Text style={styles.loyaltyValue}>{profile?.loyaltyPoints ?? 0}</Text>
        </View>

        {/* Details */}
        <View style={[styles.card, shadow.card]}>
          <DetailRow label={t('phone')} value={profile?.phoneNumber || '—'} />
          <DetailRow label={t('role')} value={profile?.role ?? '—'} last />
        </View>

        {/* WhatsApp phone verification (signed-in only) */}
        {profile ? <VerifyPhoneWhatsApp /> : null}

        {/* Push notification preferences (signed-in only; real devices only) */}
        {profile ? <NotificationSettings /> : null}

        {/* Language — one segmented control, same setters and labels. */}
        <Text style={[styles.sectionTitle, rtlText]}>{t('language')}</Text>
        <View style={[styles.card, shadow.card, styles.langCard]}>
          <View style={styles.langRow}>
            <LangBtn label={t('english')} active={lang === 'en'} onPress={() => setLang('en')} />
            <LangBtn label={t('arabic')} active={lang === 'ar'} onPress={() => setLang('ar')} />
          </View>
        </View>

        {/* Legal & Support */}
        <Text style={[styles.sectionTitle, rtlText]}>{t('legalSupport')}</Text>
        <Pressable
          style={({ pressed }) => [styles.card, shadow.card, styles.legalRow, rtlRow, pressed && styles.pressed]}
          onPress={() => router.push('/legal')}
          accessibilityRole="button"
        >
          <Text style={[styles.legalText, rtlText]}>{pick('Policies, privacy & contact', 'السياسات والخصوصية والتواصل')}</Text>
          <Text style={styles.legalChevron}>{lang === 'ar' ? '‹' : '›'}</Text>
        </Pressable>

        {/* Sign out — destructive, red, separated from normal settings. The
            sequence inside onSignOut is security-sensitive and unchanged. */}
        <Pressable
          onPress={onSignOut}
          accessibilityRole="button"
          accessibilityLabel={t('signOut')}
          style={({ pressed }) => [styles.signOutBtn, rtlRow, pressed && styles.pressed]}
        >
          <SignOutIcon size={18} />
          <Text style={styles.signOutText}>{t('signOut')}</Text>
        </Pressable>

        {/* Delete account — destructive, de-emphasized (text only) so it is
            discoverable but not tapped by accident. Opens the guarded flow. */}
        <Pressable
          onPress={() => router.push('/account/delete')}
          accessibilityRole="button"
          accessibilityLabel={t('delAccount')}
          accessibilityHint={pick('Opens account deletion', 'يفتح حذف الحساب')}
          style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
        >
          <Text style={styles.deleteText}>{t('delAccount')}</Text>
        </Pressable>

        <Text style={styles.footerNote}>{pick('Spicy Meal · v1.0.0', 'سبايسي ميل · الإصدار 1.0.0')}</Text>
      </ScrollView>
    </Screen>
  );
}

function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const { rtlRow } = useI18n();
  return (
    <View style={[styles.detailRow, rtlRow, !last && styles.detailBorder]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function LangBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.langBtn, active && styles.langBtnActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.langBtnText, active && styles.langBtnTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: spacing.md },
  title: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  card: {
    backgroundColor: colors.white, borderRadius: radius.lg, borderCurve: 'continuous',
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md,
  },
  pressed: { opacity: 0.9 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.purple, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.white, fontSize: font.xl, fontWeight: '800' },
  name: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  muted: { fontSize: font.sm, color: colors.muted },

  loyalty: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.purpleBg, borderColor: colors.purpleBg,
  },
  loyaltyLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  loyaltyLabel: { fontSize: font.md, fontWeight: '800', color: colors.purple },
  loyaltyValue: { fontSize: font.xxl, fontWeight: '800', color: colors.purple, fontVariant: ['tabular-nums'] },

  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.md },
  detailBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  detailLabel: { fontSize: font.md, color: colors.muted, fontWeight: '600' },
  detailValue: { fontSize: font.md, color: colors.text, fontWeight: '700', flexShrink: 1 },

  sectionTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  langCard: { padding: spacing.xs + 2 },
  // Segmented control: identical metrics in both states — only fill changes.
  langRow: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: radius.pill, padding: 4, gap: 4 },
  langBtn: { flex: 1, minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, alignItems: 'center', backgroundColor: 'transparent' },
  langBtnActive: { backgroundColor: colors.purple },
  langBtnText: { fontSize: font.md, fontWeight: '700', color: colors.text },
  langBtnTextActive: { color: colors.white, fontWeight: '800' },

  legalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  legalText: { fontSize: font.md, color: colors.text, fontWeight: '700', flexShrink: 1 },
  legalChevron: { fontSize: font.xl, fontWeight: '800', color: colors.purple },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.red, borderRadius: radius.lg, borderCurve: 'continuous',
    minHeight: 52, paddingHorizontal: spacing.lg, marginTop: spacing.xl,
  },
  signOutText: { color: colors.white, fontWeight: '800', fontSize: font.lg },

  deleteBtn: {
    alignItems: 'center', justifyContent: 'center', minHeight: 44,
    marginTop: spacing.md,
  },
  deleteText: { color: colors.red, fontWeight: '700', fontSize: font.md, textDecorationLine: 'underline' },

  footerNote: { textAlign: 'center', color: colors.muted, fontSize: font.xs, marginTop: spacing.xl },
});
