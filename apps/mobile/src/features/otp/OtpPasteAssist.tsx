/**
 * One-tap paste for the verification code.
 *
 * WHY THIS EXISTS: iOS 26.x does not reliably surface the keyboard autofill
 * suggestion for codes delivered by WhatsApp — Apple's own developer forums
 * report the same across 26.0.1–26.3 with no working fix, and there is no
 * public API to opt into, only an OS heuristic. WhatsApp's own "Copy code"
 * button, by contrast, works every time. So the app meets the customer where
 * the platform is actually reliable: copy in WhatsApp, one tap here.
 *
 * iOS 16+: renders UIPasteControl (`ClipboardPasteButton`), which pastes
 * WITHOUT the "Allow Paste?" permission dialog — the tap itself is the consent.
 * Everywhere else: a plain action that reads the clipboard on press, which does
 * prompt once on iOS but is never reached on a version that has the control.
 *
 * The affordance only appears when the clipboard actually holds something and
 * the code is still incomplete, so it never sits there as dead furniture.
 * `hasStringAsync` is used for that check precisely because it does NOT prompt.
 */
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';

import { hitTarget, radius, space } from '../../design-system/generated/tokens';
import { Text } from '../../design-system/ui/Text';
import { useI18n } from '../../i18n/I18nProvider';
import { makeStyles } from '../../theme/makeStyles';
import { extractOtp } from './otpAutofill';

interface Props {
  /** Expected code length. */
  length: number;
  /** True while the code is incomplete — the only time the affordance is useful. */
  visible: boolean;
  /** Receives a clean code of exactly `length` digits. */
  onCode: (code: string) => void;
}

export function OtpPasteAssist({ length, visible, onCode }: Props) {
  const styles = useStyles();
  const { t } = useI18n();
  const [hasClipboardText, setHasClipboardText] = useState(false);

  // Re-check when mounted and whenever the app comes back from WhatsApp, which
  // is exactly the moment the customer has just copied the code.
  useEffect(() => {
    let alive = true;
    const check = () => {
      Clipboard.hasStringAsync()
        .then((has) => { if (alive) setHasClipboardText(has); })
        .catch(() => { /* never break the login screen over the clipboard */ });
    };
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => { alive = false; sub.remove(); };
  }, []);

  // A pasted payload may be the bare code or the whole WhatsApp line
  // ("698968 is your verification code…"); extractOtp pulls the run of digits
  // and returns null rather than half-filling when nothing matches.
  const accept = useCallback((raw: string) => {
    const code = extractOtp(raw, length);
    if (code) onCode(code);
  }, [length, onCode]);

  const pasteManually = useCallback(() => {
    Clipboard.getStringAsync()
      .then(accept)
      .catch(() => { /* declined the paste prompt — manual entry still works */ });
  }, [accept]);

  if (!visible || !hasClipboardText) return null;

  if (Clipboard.isPasteButtonAvailable) {
    return (
      <View style={styles.row}>
        <Clipboard.ClipboardPasteButton
          acceptedContentTypes={['plain-text']}
          displayMode="iconAndLabel"
          cornerStyle="capsule"
          onPress={(data) => { if (data.type === 'text') accept(data.text); }}
          style={styles.pasteButton}
        />
      </View>
    );
  }

  return (
    <Pressable
      onPress={pasteManually}
      accessibilityRole="button"
      accessibilityLabel={t('pasteCode')}
      style={styles.fallback}
    >
      <Text variant="label" tone="ember" align="center">{t('pasteCode')}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles(() => ({
  row: { alignItems: 'center' as const },
  // UIPasteControl sizes itself; this only reserves a comfortable tap area.
  pasteButton: { height: hitTarget, width: 160 },
  fallback: {
    minHeight: hitTarget,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderRadius: radius.md,
    paddingHorizontal: space.s4,
  },
}));
