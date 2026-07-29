/**
 * Zero-tap / autofill capability for the OTP screens, wired to degrade
 * gracefully on every platform:
 *
 *   - Web (react-native-web): the WebOTP API — navigator.credentials.get({ otp })
 *     — reads an incoming SMS code programmatically. Guarded by a capability
 *     check; on unsupported browsers, abort, or the user declining, it silently
 *     does nothing and manual entry stays available. The AbortController is torn
 *     down on unmount / when the code step closes.
 *
 *   - Native iOS / Android: autofill is DECLARATIVE and lives on the input
 *     itself (textContentType="oneTimeCode" for iOS QuickType; autoComplete
 *     "sms-otp" for Android) — see OtpCodeInput. This hook is a no-op there, so
 *     there is nothing to crash if a native SMS-retriever module is absent.
 *
 * The hook only READS a code and hands it to `onCode`; it never sends, generates,
 * or verifies. The screens pass the code straight to the existing verify path.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { isWebOtpSupported, requestWebOtp, type NavigatorLike } from './otpAutofill';

interface Options {
  /** Only listen while the code step is visible (avoids an idle WebOTP prompt). */
  enabled: boolean;
  /** Expected code length (number of boxes). */
  length: number;
  /** Called with the normalized digits once a code is read. */
  onCode: (code: string) => void;
}

export function useOtpAutofill({ enabled, length, onCode }: Options): void {
  // Keep the latest callback in a ref so a new inline `onCode` each render does
  // not restart the WebOTP request (which would re-prompt / churn the signal).
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    if (!enabled) return;
    if (Platform.OS !== 'web') return; // native autofill is declarative on the input

    // Access web globals via globalThis so this file needs no DOM lib types.
    const g = globalThis as unknown as {
      window?: unknown;
      navigator?: NavigatorLike;
      OTPCredential?: unknown;
      AbortController?: new () => { signal: { aborted: boolean }; abort: () => void };
    };
    if (typeof g.window === 'undefined' || !g.AbortController) return;

    const nav = g.navigator;
    const otpCredentialGlobal = typeof g.OTPCredential !== 'undefined';
    if (!isWebOtpSupported(nav, otpCredentialGlobal) || !nav) return;

    const controller = new g.AbortController();
    let cancelled = false;

    void requestWebOtp(nav, controller.signal, length).then((code) => {
      if (cancelled || !code) return;
      onCodeRef.current(code);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, length]);
}
