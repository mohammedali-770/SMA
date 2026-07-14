/**
 * Profile → Notifications card. Two per-device toggles:
 *   Order updates (default ON at registration) · Offers & promotions (OPT-IN).
 *
 * The OS permission is requested only when the customer first turns a toggle
 * ON (clear context — see notificationPolicy.toggleRequiresPermission). With
 * both toggles off the device row is deactivated and its token is never
 * targeted. All writes go through the RLS-scoped client (own rows only);
 * sending is server-side and separately master-flag gated.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import * as Device from 'expo-device';

import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../store';
import {
  deviceShouldStayActive, toggleRequiresPermission, type DevicePrefs,
} from './notificationPolicy';
import {
  deactivateThisDevice, ensureAndroidChannel, ensureNotificationPermission, findThisDevice, registerThisDevice,
} from './pushRegistration';
import { colors, font, radius, shadow, spacing } from '../../theme';
import type { DbPushDevice } from '../../types/db';

export function NotificationSettings() {
  const { t, lang, rtlText, rtlRow } = useI18n();
  const { userId } = useAuth();
  const [device, setDevice] = useState<DbPushDevice | null>(null);
  const [prefs, setPrefs] = useState<DevicePrefs>({ orderUpdatesEnabled: false, promosEnabled: false });
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [supported, setSupported] = useState(true);

  // Reflect the current registration of THIS device (if any).
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!Device.isDevice) { if (active) setSupported(false); return; }
      const row = await findThisDevice();
      if (!active || !row) return;
      setDevice(row);
      setPrefs(row.is_active
        ? { orderUpdatesEnabled: row.order_updates_enabled, promosEnabled: row.promos_enabled }
        : { orderUpdatesEnabled: false, promosEnabled: false });
    })();
    return () => { active = false; };
  }, []);

  const apply = async (next: DevicePrefs) => {
    if (!userId || busy) return;
    setBusy(true);
    setDenied(false);
    const prev = prefs;
    setPrefs(next); // optimistic; reverted on failure
    try {
      if (toggleRequiresPermission(prev, next)) {
        // Order per enableFlowPlan(): the Android channel must exist BEFORE
        // the permission prompt / token fetch (iOS: channel step is a no-op).
        await ensureAndroidChannel();
        const granted = await ensureNotificationPermission();
        if (!granted) { setPrefs(prev); setDenied(true); return; }
      }
      // ALL writes go through the SECURITY DEFINER RPCs (RLS exposes no
      // direct client write path): any-channel-on → (re)register with the
      // new preferences; everything-off → deactivate this device's token.
      if (deviceShouldStayActive(next)) {
        const row = await registerThisDevice(lang, next);
        if (!row) { setPrefs(prev); setSupported(false); return; }
        setDevice(row);
      } else if (device) {
        await deactivateThisDevice();
        setDevice({ ...device, is_active: false, order_updates_enabled: false, promos_enabled: false });
      }
    } catch {
      setPrefs(prev);
    } finally {
      setBusy(false);
    }
  };

  if (!supported) return null; // simulators/web — nothing to configure

  return (
    <View style={[styles.card, shadow.card]}>
      <Text style={[styles.title, rtlText]}>{t('notificationsTitle')}</Text>
      <Text style={[styles.sub, rtlText]}>{t('notificationsSub')}</Text>

      <View style={[styles.row, rtlRow]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowLabel, rtlText]}>{t('notifOrderUpdates')}</Text>
          <Text style={[styles.rowSub, rtlText]}>{t('notifOrderUpdatesSub')}</Text>
        </View>
        <Switch
          value={prefs.orderUpdatesEnabled}
          disabled={busy}
          onValueChange={(v) => void apply({ ...prefs, orderUpdatesEnabled: v })}
          trackColor={{ true: colors.purple, false: colors.border }}
          accessibilityLabel={t('notifOrderUpdates')}
        />
      </View>

      <View style={[styles.row, rtlRow]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowLabel, rtlText]}>{t('notifPromos')}</Text>
          <Text style={[styles.rowSub, rtlText]}>{t('notifPromosSub')}</Text>
        </View>
        <Switch
          value={prefs.promosEnabled}
          disabled={busy}
          onValueChange={(v) => void apply({ ...prefs, promosEnabled: v })}
          trackColor={{ true: colors.purple, false: colors.border }}
          accessibilityLabel={t('notifPromos')}
        />
      </View>

      {denied ? <Text style={[styles.denied, rtlText]}>{t('notifPermissionDenied')}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  title: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  sub: { fontSize: font.sm, color: colors.muted, marginTop: 2, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rowLabel: { fontSize: font.md, fontWeight: '800', color: colors.text },
  rowSub: { fontSize: font.xs, color: colors.muted, marginTop: 1 },
  denied: { color: colors.red, fontWeight: '700', fontSize: font.sm, marginTop: spacing.sm },
});
