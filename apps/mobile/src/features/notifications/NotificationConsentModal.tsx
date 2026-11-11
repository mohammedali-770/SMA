/**
 * The notification consent screen, in the two modes useNotificationOnboarding
 * decides between:
 *
 *  - PROMPT — before the OS notification prompt, which is raised only if the
 *    customer taps Allow. Apple 4.5.4 asks for consent language in the app's
 *    own UI before marketing push, and the OS dialog cannot carry it.
 *  - NOTICE — once, where the OS never asks (Android 12 and older, or a second
 *    account on a phone someone else allowed), so offers never reach a customer
 *    who was not told about them. It writes nothing.
 *
 * Both say the same two things: order updates AND occasional offers, and that
 * offers can be turned off in Profile › Notifications.
 *
 * It appears only on a tab and never over the order-type pop-up
 * (`consentScreenVisible`): both are native modals, and this one must never
 * cover checkout, a receipt or the branch picker.
 */
import { router, usePathname } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Modal, View } from 'react-native';

import { radius, space } from '../../design-system/generated/tokens';
import { Button } from '../../design-system/ui/Button';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { makeStyles } from '../../theme/makeStyles';
import type { ConsentMode, NotificationConsent } from '../onboarding/useNotificationOnboarding';
import { consentScreenVisible } from './notificationPolicy';

export function NotificationConsentModal({
  consent,
  blocked,
}: {
  consent: NotificationConsent | null;
  blocked: boolean;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const pathname = usePathname();
  const visible = consent !== null && consentScreenVisible({ pathname, blocked });

  // Record "shown" once each time the screen is offered, when it is really on
  // screen — not when it was decided, which may be long before a tab is reached.
  // Reset when the offer ends, so the next one (perhaps for another customer on
  // the same phone) is recorded too.
  const shownMode = useRef<ConsentMode | null>(null);
  useEffect(() => {
    if (!consent) {
      shownMode.current = null;
      return;
    }
    if (!visible || shownMode.current === consent.mode) return;
    shownMode.current = consent.mode;
    consent.onShown();
  }, [visible, consent]);

  if (!visible || !consent) return null;

  const prompt = consent.mode === 'prompt';
  const openSettings = () => {
    consent.onDecline();
    router.push('/profile/notifications');
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={consent.onDecline}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text variant="title" align="center" accessibilityRole="header">
            {t('notifConsentTitle')}
          </Text>
          <Text variant="body" tone="secondary">
            {t(prompt ? 'notifConsentBody' : 'notifConsentNoticeBody')}
          </Text>
          <View style={styles.actions}>
            <Button label={t(prompt ? 'notifConsentAllow' : 'notifConsentOk')} onPress={consent.onAccept} />
            <Button
              variant="ghost"
              label={t(prompt ? 'notifConsentNotNow' : 'notifConsentSettings')}
              onPress={prompt ? consent.onDecline : openSettings}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: space.s4,
    backgroundColor: colors.scrim,
  },
  card: {
    width: '100%' as const,
    maxWidth: 430,
    gap: space.s3,
    padding: space.s5,
    borderRadius: radius.xl,
    borderCurve: 'continuous' as const,
    backgroundColor: colors.appSurface,
    borderWidth: 1,
    borderColor: colors.appLine,
  },
  actions: { gap: space.s2, marginTop: space.s2 },
}));
