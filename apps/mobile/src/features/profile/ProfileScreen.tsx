/**
 * Profile: identity from `profiles`, loyalty balance, language toggle, sign out.
 * Address management / editing profile fields is deferred to a later pass — the
 * web app still owns those flows.
 */
import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';

import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { VerifyPhoneWhatsApp } from './VerifyPhoneWhatsApp';
import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../store';
import { colors, font, radius, shadow, spacing } from '../../theme';

export function ProfileScreen() {
  const { t, pick, lang, setLang } = useI18n();
  const { profile, signOut } = useAuth();

  const onSignOut = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  const initials = (profile?.fullName || t('guest')).trim().charAt(0).toUpperCase();

  return (
    <Screen background={colors.bg}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('profile')}</Text>
        </View>

        <View style={[styles.card, shadow.card, styles.identity]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{profile?.fullName || t('guest')}</Text>
            {profile?.email ? <Text style={styles.muted}>{profile.email}</Text> : null}
          </View>
        </View>

        {/* Loyalty */}
        <View style={[styles.card, shadow.card, styles.loyalty]}>
          <Text style={styles.loyaltyLabel}>⭐ {t('loyaltyPoints')}</Text>
          <Text style={styles.loyaltyValue}>{profile?.loyaltyPoints ?? 0}</Text>
        </View>

        {/* Details */}
        <View style={[styles.card, shadow.card]}>
          <DetailRow label={t('phone')} value={profile?.phoneNumber || '—'} />
          <DetailRow label={t('role')} value={profile?.role ?? '—'} last />
        </View>

        {/* WhatsApp phone verification (signed-in only) */}
        {profile ? <VerifyPhoneWhatsApp /> : null}

        {/* Language */}
        <Text style={styles.sectionTitle}>{t('language')}</Text>
        <View style={[styles.card, shadow.card, styles.langRow]}>
          <LangBtn label={t('english')} active={lang === 'en'} onPress={() => setLang('en')} />
          <LangBtn label={t('arabic')} active={lang === 'ar'} onPress={() => setLang('ar')} />
        </View>

        <Button label={t('signOut')} onPress={onSignOut} variant="secondary" style={{ marginTop: spacing.xl }} />

        <Text style={styles.footerNote}>{pick('Spicy Meal · v1.0.0', 'سبايسي ميل · الإصدار ١٫٠٫٠')}</Text>
      </ScrollView>
    </Screen>
  );
}

function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.detailRow, !last && styles.detailBorder]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function LangBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.langBtn, active && styles.langBtnActive]} onPress={onPress} accessibilityRole="button">
      <Text style={[styles.langBtnText, active && styles.langBtnTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: spacing.md },
  title: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.purple, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.white, fontSize: font.xl, fontWeight: '800' },
  name: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  muted: { fontSize: font.sm, color: colors.muted },

  loyalty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f1edfb' },
  loyaltyLabel: { fontSize: font.md, fontWeight: '800', color: colors.purple },
  loyaltyValue: { fontSize: font.xxl, fontWeight: '800', color: colors.purple },

  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  detailBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  detailLabel: { fontSize: font.md, color: colors.muted, fontWeight: '600' },
  detailValue: { fontSize: font.md, color: colors.text, fontWeight: '700' },

  sectionTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  langRow: { flexDirection: 'row', gap: spacing.md },
  langBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center' },
  langBtnActive: { borderColor: colors.purple, backgroundColor: '#f1edfb' },
  langBtnText: { fontSize: font.md, fontWeight: '800', color: colors.muted },
  langBtnTextActive: { color: colors.purple },

  footerNote: { textAlign: 'center', color: colors.muted, fontSize: font.xs, marginTop: spacing.xl },
});
