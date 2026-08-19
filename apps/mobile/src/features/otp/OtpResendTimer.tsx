/**
 * Resend countdown, isolated from the OTP field.
 *
 * WHY THIS EXISTS: the countdown ticks once per second, and when its state
 * lived in the OTP screen the whole screen — including the focused code input —
 * re-rendered ~60 times during a single cooldown. iOS 26 drops a field's
 * focused state on re-render, which is one of the two causes of the autofill
 * suggestion never appearing (the other was the six-input structure).
 *
 * Owning the timer here means only this subtree re-renders on each tick. The
 * screen keeps control through a ref, so nothing about the send/resend flow
 * changes.
 *
 * Renders through a child function so each screen keeps its own presentation
 * (a caption link on login, a button in profile) without this component
 * dictating any UI.
 */
import React, { forwardRef, useImperativeHandle } from 'react';

import { useOtpCooldown } from './useOtpCooldown';

export interface OtpResendHandle {
  /** Begin (or restart) the countdown at `seconds`. */
  start: (seconds: number) => void;
  /** Stop and clear immediately — e.g. when the user changes their number. */
  reset: () => void;
}

interface Props {
  /** Receives the remaining seconds; 0 means "resend is available". */
  children: (cooldown: number) => React.ReactNode;
}

export const OtpResendTimer = forwardRef<OtpResendHandle, Props>(
  function OtpResendTimer({ children }, ref) {
    const { cooldown, startCooldown, resetCooldown } = useOtpCooldown();
    useImperativeHandle(
      ref,
      () => ({ start: startCooldown, reset: resetCooldown }),
      [startCooldown, resetCooldown],
    );
    return <>{children(cooldown)}</>;
  },
);
