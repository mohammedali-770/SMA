/**
 * First-run setup, shown ONCE after the customer's first successful sign-in.
 *
 * Why after sign-in rather than at cold launch: the name is written to their
 * profile row, which needs a session. There is nowhere to put it before login.
 *
 * PERMISSIONS ARE ASKED HERE, BUT NEVER COLD. Each row states what the
 * permission buys the customer, and the OS prompt fires only when they switch
 * that row on. That matters more on iOS than it looks: a notification denial is
 * sticky (`canAskAgain: false`), so a prompt raised before anyone knows why
 * costs the opt-in permanently. Explaining first, then asking, is also what
 * App Review expects — a bare prompt on launch is a 5.1.1 rejection risk.
 *
 * Everything here is skippable. Nothing blocks the customer from reaching the
 * menu, and both permissions remain changeable later in Profile.
 */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import * as Location from 'expo-location';

import { Logo } from '../../components/Logo';
import { Screen } from '../../components/Screen';
import { radius, space } from '../../design-system/generated/tokens';
import { Button } from '../../design-system/ui/Button';
import { columnStyles } from '../../design-system/ui/ContentColumn';
import { Field } from '../../design-system/ui/Field';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../store';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';
import { checkCustomerName, nameMessage, type NameProblem } from '../profile/customerName';
import { updateCustomerProfile } from '../profile/profileService';
import { PUSH_CLIENT_ENABLED } from '../notifications/notificationPolicy';
import {
  ensureAndroidChannel, ensureNotificationPermission, registerThisDevice,
} from '../notifications/pushRegistration';
import { markOnboarded } from './firstRunStore';

export function OnboardingScreen() {
  const styles = useStyles();
  const colors = useThemeColors();
  const { t, lang, rtlRow } = useI18n();
  const { profile, refreshProfile } = useAuth();

  const [name, setName] = useState(profile?.fullName ?? '');
  const [nameProblem, setNameProblem] = useState<NameProblem | null>(null);
  const [notifOn, setNotifOn] = useState(false);
  const [locationOn, setLocationOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  /** The switch IS the ask: the row above it has already explained why. */
  const toggleNotifications = async (next: boolean) => {
    if (!next) { setNotifOn(false); return; }
    await ensureAndroidChannel();          // channel must exist before the prompt
    const granted = await ensureNotificationPermission();
    setNotifOn(granted);
    if (granted) {
      // Order updates only. `promos` stays FALSE — marketing consent is the
      // customer's to give later, not something to bundle into setup.
      await registerThisDevice(lang, { orderUpdatesEnabled: true, promosEnabled: false });
    }
  };

  const toggleLocation = async (next: boolean) => {
    if (!next) { setLocationOn(false); return; }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationOn(status === 'granted');
    } catch {
      setLocationOn(false);
    }
  };

  const finish = async (withName: boolean) => {
    if (busy) return;
    setSaveFailed(false);

    if (withName) {
      const check = checkCustomerName(name);
      setNameProblem(check.problem);
      if (!check.valid) return;
      setBusy(true);
      try {
        await updateCustomerProfile(check.value, profile?.email ?? '');
        try { await refreshProfile(); } catch { /* the name is saved either way */ }
      } catch {
        // Never trap the customer in setup over a name they can add later.
        setSaveFailed(true);
        setBusy(false);
        return;
      }
    }

    await markOnboarded();
    setBusy(false);
    router.replace('/(tabs)');
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[columnStyles.column, styles.column]}>
          <View style={styles.hero}><Logo stacked /></View>

          <Text variant="title" align="center">{t('onbTitle')}</Text>
          <Text variant="body" tone="secondary" align="center">{t('onbSub')}</Text>

          <Field
            id="onboarding-name"
            label={t('onbNameLabel')}
            value={name}
            onChangeText={(v) => { setName(v); setNameProblem(null); }}
            placeholder={t('onbNamePlaceholder')}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            error={nameProblem ? nameMessage(nameProblem, lang) : null}
            containerStyle={styles.field}
          />

          {PUSH_CLIENT_ENABLED ? (
            <View style={[styles.row, rtlRow]}>
              <View style={styles.rowText}>
                <Text variant="label">{t('onbNotifTitle')}</Text>
                <Text variant="caption" tone="secondary">{t('onbNotifSub')}</Text>
              </View>
              <Switch
                value={notifOn}
                onValueChange={(v) => void toggleNotifications(v)}
                trackColor={{ true: colors.ember, false: colors.appLine }}
                accessibilityLabel={t('onbNotifTitle')}
              />
            </View>
          ) : null}

          <View style={[styles.row, rtlRow]}>
            <View style={styles.rowText}>
              <Text variant="label">{t('onbLocTitle')}</Text>
              <Text variant="caption" tone="secondary">{t('onbLocSub')}</Text>
            </View>
            <Switch
              value={locationOn}
              onValueChange={(v) => void toggleLocation(v)}
              trackColor={{ true: colors.ember, false: colors.appLine }}
              accessibilityLabel={t('onbLocTitle')}
            />
          </View>

          {saveFailed ? (
            <Text variant="caption" tone="danger" align="center">{t('onbSaveFailed')}</Text>
          ) : null}

          <View style={styles.actions}>
            <Button label={t('onbContinue')} onPress={() => void finish(true)} loading={busy} />
            <Button label={t('onbSkip')} onPress={() => void finish(false)} disabled={busy} variant="ghost" />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const useStyles = makeStyles((color) => ({
  scroll: { padding: space.s5, paddingBottom: space.s6, alignItems: 'center' as const },
  column: { gap: space.s3 },
  hero: { alignItems: 'center' as const, marginTop: space.s4, marginBottom: space.s5 },
  field: { marginTop: space.s3 },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.s3,
    backgroundColor: color.appSurface,
    borderWidth: 1,
    borderColor: color.appLine,
    borderRadius: radius.lg,
    borderCurve: 'continuous' as const,
    padding: space.s4,
  },
  rowText: { flex: 1, gap: 2 },
  actions: { marginTop: space.s4, gap: space.s2 },
}));
