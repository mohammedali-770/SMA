/** Profile hub: personal info, loyalty, preferences, social links and support. */
import { router } from 'expo-router';
import React from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { AwardIcon, SignOutIcon } from '../../components/Icons';
import { InstagramIcon, SnapchatIcon, TikTokIcon, WhatsAppIcon } from '../../components/SocialIcons';
import { Screen } from '../../components/Screen';
import { radius, space } from '../../design-system/generated/tokens';
import { SelectableChip } from '../../design-system/ui/Chip';
import { columnStyles } from '../../design-system/ui/ContentColumn';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { useAddressBook, useAuth } from '../../store';
import { useTheme, type ThemePreference } from '../../theme/ThemeProvider';
import { makeStyles } from '../../theme/makeStyles';
import { EditableName } from './EditableName';
const APPEARANCE: ThemePreference[] = ['system', 'light', 'dark'];
// Official brand marks and the brand's own profiles. WhatsApp points at the
// broadcast channel — the support number lives on the Legal & support screen.
const SOCIALS = [
  { key: 'instagram', label: 'Instagram', Icon: InstagramIcon, url: 'https://www.instagram.com/spicymeal/' },
  { key: 'snapchat', label: 'Snapchat', Icon: SnapchatIcon, url: 'https://snapchat.com/t/6I9ziooc' },
  { key: 'tiktok', label: 'TikTok', Icon: TikTokIcon, url: 'https://www.tiktok.com/@spicymeal' },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    Icon: WhatsAppIcon,
    url: 'https://whatsapp.com/channel/0029VbCRe0y1noyzP6Ds3z0Q',
  },
] as const;
// Signing out deliberately does NOT deactivate this device's push row. A
// customer who signs out still has orders in flight, and silencing the device
// here meant push stayed dead after signing back in: the first-run permission
// flag is device-scoped and never re-raised, so nothing re-registered. The
// token is instead re-claimed at the next sign-in (usePushDeviceSync), which
// is also what hands a shared phone over to its new account. Account DELETION
// still deactivates — see DeleteAccountScreen.
export function ProfileScreen() {
  const { t, pick, lang, setLang, rtlRow } = useI18n();
  const { preference, setPreference, colors } = useTheme();
  const s = useStyles();
  const { profile, status, signOut } = useAuth();
  const addressBook = useAddressBook();
  const onSignOut = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };
  const addressCount = addressBook.addresses.length;
  const appearanceLabel = (v: ThemePreference) =>
    v === 'system' ? pick('System', 'النظام') : v === 'light' ? pick('Light', 'فاتح') : pick('Dark', 'داكن');
  const openUrl = (url?: string) => {
    if (url) void Linking.openURL(url).catch(() => {});
  };
  return (
    <Screen>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={[columnStyles.column, s.column]}>
          <Text variant="display">{t('profile')}</Text>
          <EditableName />
          <View style={[s.card, s.loyalty, rtlRow]}>
            <View style={[s.loyaltyLabel, rtlRow]}>
              <AwardIcon size={22} color={colors.saffron} />
              <Text variant="heading" style={{ color: colors.amberInk }}>
                {t('loyaltyPoints')}
              </Text>
            </View>
            <Text variant="display" style={{ color: colors.amberInk }}>
              {profile?.loyaltyPoints ?? 0}
            </Text>
          </View>
          {profile ? (
            <MenuRow
              label={t('addrManage')}
              subtitle={addressCount === 0 ? t('addrEmptyTitle') : `${addressCount}`}
              onPress={() => router.push('/profile/addresses')}
            />
          ) : null}
          <MenuRow
            label={t('notificationsTitle')}
            subtitle={pick('Order updates and offers', 'تحديثات الطلب والعروض')}
            onPress={() => router.push('/profile/notifications')}
          />
          <Text variant="title" style={s.sectionTitle}>
            {pick('Follow us', 'تابعنا')}
          </Text>
          <View style={[s.socialRow, rtlRow]}>
            {SOCIALS.map((x) => (
              <SocialButton key={x.key} label={x.label} icon={<x.Icon />} onPress={() => openUrl(x.url)} />
            ))}
          </View>
          <Text variant="title" style={s.sectionTitle}>
            {t('language')}
          </Text>
          <View style={s.langRow}>
            <SelectableChip
              label={t('english')}
              selected={lang === 'en'}
              onPress={() => setLang('en')}
              style={s.langChip}
            />
            <SelectableChip
              label={t('arabic')}
              selected={lang === 'ar'}
              onPress={() => setLang('ar')}
              style={s.langChip}
            />
          </View>
          <Text variant="title" style={s.sectionTitle}>
            {pick('Appearance', 'المظهر')}
          </Text>
          <View style={s.appearanceRow}>
            {APPEARANCE.map((v) => (
              <SelectableChip
                key={v}
                label={appearanceLabel(v)}
                selected={preference === v}
                onPress={() => setPreference(v)}
                style={s.appearanceChip}
              />
            ))}
          </View>
          <Text variant="title" style={s.sectionTitle}>
            {t('legalSupport')}
          </Text>
          <MenuRow
            label={pick('Policies, privacy & contact', 'السياسات والخصوصية والتواصل')}
            onPress={() => router.push('/legal')}
          />
          {/*
            Apple 5.1.1(v) requires account deletion to be EASILY FOUND. Until this
            row existed the only route was Profile -> "Policies, privacy & contact"
            -> a network-fetched list of nine legal documents -> "Account & privacy"
            -> "Delete account": four taps, behind a loading state, under a heading
            that gives no hint deletion lives there. It links straight to
            `/account/delete`; the intermediate screen stays reachable from the
            legal list for anyone who arrives that way.

            GATED ON AUTHENTICATION, NOT ON PROFILE DATA — deliberately unlike the
            Addresses row above, which needs a profile because it renders the
            address count. `status === 'signed_in'` with `profile === null` is
            reachable three ways in AuthProvider: a `fetch_success` carrying an
            authoritative null (no profile row), the synchronous `signed_in` in
            `onChange` before the deferred fetch resolves, and retry exhaustion
            leaving the last known profile null. `/account/delete` is valid for that
            auth account in every one of those states, so guarding on `profile`
            would hide deletion from a signed-in user — the exact failure this row
            exists to fix.
          */}
          {status === 'signed_in' ? (
            <MenuRow
              label={t('delAccount')}
              subtitle={pick('Permanently delete your account', 'احذف حسابك نهائياً')}
              onPress={() => router.push('/account/delete')}
            />
          ) : null}
          <Pressable
            onPress={onSignOut}
            accessibilityRole="button"
            accessibilityLabel={t('signOut')}
            style={({ pressed }) => [s.signOut, rtlRow, pressed && s.pressed]}
          >
            <SignOutIcon size={18} color={colors.onEmber} />
            <Text variant="button" tone="onEmber">
              {t('signOut')}
            </Text>
          </Pressable>
          <Text variant="caption" tone="tertiary" align="center" style={s.version}>
            {pick('Spicy Meal · v1.0.0', 'سبايسي ميل · الإصدار 1.0.0')}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
function MenuRow({ label, subtitle, onPress }: { label: string; subtitle?: string; onPress: () => void }) {
  const { lang, rtlRow } = useI18n();
  const s = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [s.card, s.menuRow, rtlRow, pressed && s.pressed]}
    >
      <View style={s.menuText}>
        <Text variant="body">{label}</Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Text variant="title" tone="ember">
        {lang === 'ar' ? '‹' : '›'}
      </Text>
    </Pressable>
  );
}
function SocialButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  const s = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => [s.social, pressed && s.pressed]}
    >
      {icon}
      <Text variant="caption" align="center" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
const useStyles = makeStyles((c) => ({
  scroll: { padding: space.s4, paddingBottom: space.s6 * 2, alignItems: 'center' as const },
  column: { gap: space.s3 },
  card: {
    backgroundColor: c.appSurface,
    borderRadius: radius.lg,
    borderCurve: 'continuous' as const,
    borderWidth: 1,
    borderColor: c.appLine,
    padding: space.s4,
  },
  pressed: { opacity: 0.78 },
  loyalty: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: c.warnTint,
    borderColor: c.warnLine,
  },
  loyaltyLabel: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.s2 },
  menuRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    minHeight: 64,
    gap: space.s3,
  },
  menuText: { flex: 1, gap: 2 },
  sectionTitle: { marginTop: space.s2 },
  socialRow: { flexDirection: 'row' as const, gap: space.s2 },
  social: {
    flex: 1,
    minWidth: 0,
    minHeight: 72,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.appLine,
    backgroundColor: c.appSurface,
  },
  langRow: { flexDirection: 'row' as const, gap: space.s2 },
  langChip: { flex: 1, minHeight: 44 },
  appearanceRow: { flexDirection: 'row' as const, gap: space.s2 },
  appearanceChip: { flex: 1, minHeight: 44, paddingHorizontal: space.s2 },
  signOut: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: space.s2,
    backgroundColor: c.danger,
    borderRadius: radius.md,
    minHeight: 52,
    paddingHorizontal: space.s4,
    marginTop: space.s4,
  },
  version: { marginTop: space.s5 },
}));
