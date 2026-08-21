/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A short beep for a new closure, via the Web Audio API.
 *
 * Deliberately synthesised rather than an audio asset: no file to ship, no
 * decode, and nothing to fail silently on a locked-down browser.
 *
 * Every failure mode here is swallowed. Browsers block audio until the user has
 * interacted with the page, and an operator who has not yet clicked anything
 * must not see an error because a notification could not chime — the toast is
 * the real signal, the sound is the enhancement.
 */
export function playAlertBeep(): void {
  try {
    const Ctor = (window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return;

    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    // Ramp down rather than stopping abruptly: a hard stop clicks.
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
    osc.onended = () => { void ctx.close().catch(() => undefined); };
  } catch {
    /* autoplay blocked, no audio device, or an ancient browser — never fatal */
  }
}
