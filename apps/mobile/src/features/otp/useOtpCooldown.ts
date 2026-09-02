/**
 * Resend-cooldown timer for the OTP screens — the exact logic that once lived
 * duplicated in PhoneOtpLogin and the since-deleted VerifyPhoneWhatsApp:
 * startCooldown(n) shows n seconds and counts down once per second to 0;
 * resetCooldown() stops and clears immediately; the interval is torn down on
 * unmount. Timing and semantics are unchanged (1s interval, floor at 0).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { tickCooldown } from './otpInput';

export function useOtpCooldown() {
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const startCooldown = useCallback((seconds: number) => {
    setCooldown(seconds);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((c) => {
        const next = tickCooldown(c);
        if (next === 0 && timer.current) { clearInterval(timer.current); timer.current = null; }
        return next;
      });
    }, 1000);
  }, []);

  const resetCooldown = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setCooldown(0);
  }, []);

  return { cooldown, startCooldown, resetCooldown };
}
