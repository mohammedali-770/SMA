import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyRound, Loader2, LogOut, ShieldCheck } from 'lucide-react';

import { useApp } from '../context/AppContext';
import { Button } from '../design-system/ui/Button';
import { Card } from '../design-system/ui/Card';
import { Notice } from '../design-system/ui/Notice';
import { Text } from '../design-system/ui/Text';
import { supabase } from '../lib/supabase';

type GateMode = 'checking' | 'needs_enrollment' | 'enrolling' | 'challenge' | 'ready';

interface EnrollmentState {
  factorId: string;
  qrCode: string;
  secret: string;
}

function qrSource(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('<svg')) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`;
  }
  return value;
}

export const StaffMfaGate: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { reload, signOut } = useApp();
  const [mode, setMode] = useState<GateMode>('checking');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollmentState | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inspect = useCallback(async () => {
    setError(null);
    setMode('checking');

    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error) throw assurance.error;
    if (assurance.data.currentLevel === 'aal2') {
      setMode('ready');
      return;
    }

    const factors = await supabase.auth.mfa.listFactors();
    if (factors.error) throw factors.error;
    const verified = factors.data.totp.find((factor) => factor.status === 'verified');
    if (verified) {
      setFactorId(verified.id);
      setMode('challenge');
    } else {
      setFactorId(null);
      setMode('needs_enrollment');
    }
  }, []);

  useEffect(() => {
    let active = true;
    void inspect().catch((e) => {
      if (!active) return;
      setError(e instanceof Error ? e.message : String(e));
      setMode('needs_enrollment');
    });
    return () => { active = false; };
  }, [inspect]);

  // The mode, readable from the auth listener without making it a dependency —
  // resubscribing on every mode change would tear the listener down mid-flow.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  /**
   * Re-check the assurance level after an auth change, and demote ONLY if AAL2
   * was actually lost.
   *
   * WHY THIS EXISTS. `inspect()` runs once on mount. If AAL2 later drops — a
   * refresh that returns an aal1 session, a factor unenrolled in another tab,
   * an admin signed in elsewhere — the console stays rendered while every RLS
   * policy and admin RPC starts refusing. The admin sees a panel that looks
   * fine and fails on everything, until they happen to reload.
   *
   * WHY IT IS SILENT RATHER THAN A PLAIN `inspect()`. `inspect()` sets
   * mode='checking', which unmounts `children`. Running it on every
   * TOKEN_REFRESHED would flash the gate and remount the whole console —
   * discarding open forms — on a session that is perfectly valid. Tokens
   * refresh on a timer, so that would be routine, not rare. So the common case
   * (still AAL2) must cause NO state change at all.
   */
  const revalidate = useCallback(async () => {
    // A failed check is not proof of a lost session. Leave the console up and
    // let the next event decide: tearing it down on a network blip would be the
    // same disruption this function exists to avoid, and the real enforcement is
    // server-side anyway — RLS and the admin RPCs refuse an AAL1 caller whatever
    // this component renders. This gate is the explanation, not the boundary.
    //
    // That applies to a THROW as much as to a returned error. getAuthenticator-
    // AssuranceLevel() rejects rather than returning when it cannot read the
    // stored session or acquire the auth lock, and neither says anything about
    // the caller's assurance level. Only a successful, genuinely-below-AAL2
    // reading may close the console.
    let assurance;
    try {
      assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    } catch {
      return;
    }
    if (assurance.error) return;
    if (assurance.data.currentLevel === 'aal2') return;

    // AAL2 is genuinely gone. Fall back to the full inspection, which decides
    // between challenging an existing factor and asking for enrollment.
    await inspect();
  }, [inspect]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      // Only guard a console that is currently open. If the gate is already
      // showing, the admin is mid-enrollment or mid-challenge and re-running
      // the check would wipe a half-typed code for no benefit.
      if (modeRef.current !== 'ready') return;

      // MFA_CHALLENGE_VERIFIED is OUR OWN verify() completing. It already
      // re-reads the assurance level and sets the mode itself; re-entering here
      // would race that. SIGNED_OUT is handled by AppContext, which unmounts us.
      if (event === 'MFA_CHALLENGE_VERIFIED' || event === 'SIGNED_OUT') return;

      // Anything reaching here threw out of inspect(), which has already set
      // mode='checking' — the console is gone either way, and leaving it there
      // would hang on the spinner. Resolve to the same state the mount path
      // uses for the same failure.
      void revalidate().catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setMode('needs_enrollment');
      });
    });
    return () => sub.subscription.unsubscribe();
  }, [revalidate]);

  const beginEnrollment = async () => {
    setBusy(true); setError(null); setCode('');
    try {
      // Remove only abandoned, unverified TOTP factors. A verified factor is
      // never removed by this screen; it must be challenged instead.
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      for (const factor of factors.data.totp.filter((f) => f.status !== 'verified')) {
        const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (removed.error) throw removed.error;
      }

      const result = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Spicy Meal Staff',
      });
      if (result.error) throw result.error;
      if (!result.data.totp?.qr_code || !result.data.totp.secret) {
        throw new Error('Authenticator enrollment did not return a TOTP setup code.');
      }
      setEnrollment({
        factorId: result.data.id,
        qrCode: result.data.totp.qr_code,
        secret: result.data.totp.secret,
      });
      setFactorId(result.data.id);
      setMode('enrolling');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const normalized = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(normalized)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    if (!factorId) {
      setError('No authenticator factor is available. Start MFA setup again.');
      return;
    }

    setBusy(true); setError(null);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) throw challenge.error;
      const verified = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code: normalized,
      });
      if (verified.error) throw verified.error;

      const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error) throw assurance.error;
      if (assurance.data.currentLevel !== 'aal2') {
        throw new Error('MFA verification completed but the session did not reach AAL2.');
      }

      // The original AAL1 bootstrap may have been denied by staff RLS/RPCs.
      // Re-read everything under the newly upgraded session before rendering.
      await reload();
      setEnrollment(null); setCode(''); setMode('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const qr = useMemo(() => enrollment ? qrSource(enrollment.qrCode) : null, [enrollment]);

  if (mode === 'ready') return <>{children}</>;

  return (
    <main className="flex-grow p-4 md:p-6">
      <Card className="mx-auto max-w-md space-y-4">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-ds-md)] bg-ember/10 text-ember">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <div>
            <Text variant="title" as="h2">Staff multi-factor authentication</Text>
            <Text variant="body" tone="secondary" as="p" className="mt-1">
              Admin and accountant access requires a TOTP authenticator and an AAL2 session.
            </Text>
          </div>
        </div>

        {error ? <Notice title="MFA action failed" action={error} tone="blocking" /> : null}

        {mode === 'checking' ? (
          <div className="flex items-center justify-center gap-2 py-8">
            <Loader2 className="size-5 animate-spin text-ember" aria-hidden="true" />
            <Text variant="body" tone="tertiary" as="span">Checking session assurance…</Text>
          </div>
        ) : null}

        {mode === 'needs_enrollment' ? (
          <div className="space-y-3">
            <Notice
              title="Authenticator setup required"
              action="Use an authenticator app such as 1Password, Google Authenticator, Microsoft Authenticator, or another TOTP-compatible app."
              tone="warning"
            />
            <Button
              label={busy ? 'Starting setup…' : 'Set up authenticator'}
              onClick={() => { void beginEnrollment(); }}
              disabled={busy}
              leading={<KeyRound className="size-4" aria-hidden="true" />}
              className="w-full"
            />
          </div>
        ) : null}

        {mode === 'enrolling' && enrollment ? (
          <div className="space-y-4">
            <Text variant="body" as="p">
              Scan this QR code, then enter the current 6-digit code to finish enrollment.
            </Text>
            {qr ? (
              <img src={qr} alt="TOTP authenticator QR code" className="mx-auto size-52 rounded-lg bg-white p-2" />
            ) : null}
            <div className="rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface-2 p-3">
              <Text variant="caption" tone="tertiary" as="p">Manual setup key</Text>
              <Text variant="body" numeric as="p" className="mt-1 break-all select-all">{enrollment.secret}</Text>
            </div>
          </div>
        ) : null}

        {(mode === 'challenge' || mode === 'enrolling') ? (
          <div className="space-y-3">
            {mode === 'challenge' ? (
              <Text variant="body" as="p">Enter the current code from your authenticator app.</Text>
            ) : null}
            <input
              aria-label="Authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') void verify(); }}
              placeholder="000000"
              className="min-h-12 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-center font-ds-num text-xl tracking-[0.3em] text-con-text focus-visible:outline-2 focus-visible:outline-offset-2"
            />
            <Button
              label={busy ? 'Verifying…' : mode === 'enrolling' ? 'Finish MFA setup' : 'Verify and continue'}
              onClick={() => { void verify(); }}
              disabled={busy || code.length !== 6}
              className="w-full"
            />
          </div>
        ) : null}

        <div className="border-t border-con-line pt-3">
          <Button
            label="Sign out"
            onClick={() => { void signOut(); }}
            variant="secondary"
            leading={<LogOut className="size-4" aria-hidden="true" />}
            className="w-full"
          />
          <Text variant="caption" tone="tertiary" as="p" className="mt-2 text-center">
            Lost access to your authenticator? Sign out and use the organization’s account-recovery process. MFA is not bypassed from this screen.
          </Text>
        </div>
      </Card>
    </main>
  );
};
