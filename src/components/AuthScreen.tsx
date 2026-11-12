/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BrandMark } from '../design-system/ui/BrandMark';
import { useOpsLang } from './ops/useOpsLang';

/**
 * Email + password SIGN-IN for the staff console (Supabase Auth / GoTrue). A
 * real session is required before any data loads, and the signed-in user's
 * profiles.role decides which app is shown.
 *
 * There is deliberately no sign-up. Staff accounts are created by an
 * administrator through the staff-accounts Edge Function (Settings → Staff
 * accounts), and customers sign in to the app with WhatsApp. A "Create Account"
 * tab used to sit here: anyone could make an email/password account on the
 * console domain, which shares its browser session with /app, and place cash
 * orders with no phone number behind them (S02#1, 2026-11-11). The server now
 * refuses an order from an account without a verified phone
 * (20261005120000), and this screen no longer offers the account.
 */
export const AuthScreen: React.FC = () => {
  const { t, dir, toggle } = useOpsLang('en');
  const { signIn } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 font-sans" dir={dir}>
      <div className="w-full max-w-sm border border-con-line bg-con-surface rounded-[2rem] p-7">
        {/* Branch and call-centre staff meet this screen before anything else,
            and a cashier who cannot read it cannot sign in. Defaults to English
            so existing admins see no change; the choice is remembered and
            shared with the operations console. */}
        <div className="flex justify-end mb-1">
          <button
            type="button"
            onClick={toggle}
            className="min-h-11 px-3 text-xs font-black text-con-text-2 hover:text-ember rounded-xl transition-colors"
          >
            {t('language')}
          </button>
        </div>
        <div className="flex flex-col items-center text-center mb-6">
          <BrandMark className="w-14 h-14 rounded-2xl object-contain bg-con-surface border border-con-line mb-3" />
          <h1 className="text-lg font-black text-ember tracking-tight">SPICY MEAL</h1>
          <p className="text-[11px] text-con-text-2 font-bold mt-1">{t('authSignInTitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-[10px] font-black text-con-text-3 uppercase mb-1">{t('authEmail')}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-label="Email"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-con-text-3 uppercase mb-1">{t('authPassword')}</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-label="Password"
            />
          </div>

          {error && (
            <p className="text-[11px] text-danger-ds font-bold bg-danger-tint border border-danger-line rounded-lg p-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-ember text-white text-xs font-black py-2.5 rounded-full shadow-sm hover:bg-ember/95 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('authSignIn')}
          </button>
        </form>

        <div className="mt-5 pt-4 border-t border-con-line flex items-center gap-1.5 text-[9.5px] text-con-text-3 font-semibold justify-center">
          <ShieldCheck className="w-3.5 h-3.5 text-mint" />
          <span>Secured by Supabase Auth · role-based access</span>
        </div>
      </div>
    </div>
  );
};
