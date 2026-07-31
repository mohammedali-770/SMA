/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { LogIn, UserPlus, Loader2, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BrandMark } from '../design-system/ui/BrandMark';

/**
 * Email + password authentication gate (Supabase Auth / GoTrue). This replaces
 * the old client-side role switcher and the simulated phone OTP: a real session
 * is required before any data loads, and the signed-in user's profiles.role
 * decides which app (customer vs admin) is shown. SMS/OTP is intentionally not
 * used here (out of scope for this build).
 */
export const AuthScreen: React.FC = () => {
  const { signIn, signUp } = useApp();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
      } else {
        if (!fullName.trim()) { setError('Please enter your full name'); setBusy(false); return; }
        await signUp(email.trim(), password, fullName.trim(), phone.trim() || undefined);
        // If email confirmation is required the session won't exist yet; tell the
        // user. With auto-confirm the auth listener signs them straight in.
        setNotice('Account created. If sign-in does not continue automatically, please sign in.');
        setMode('signin');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-sm border border-con-line bg-con-surface rounded-[2rem] p-7">
        <div className="flex flex-col items-center text-center mb-6">
          <BrandMark className="w-14 h-14 rounded-2xl object-contain bg-con-surface border border-con-line mb-3" />
          <h1 className="text-lg font-black text-ember tracking-tight">SPICY MEAL</h1>
          <p className="text-[11px] text-con-text-2 font-bold mt-1">
            {mode === 'signin' ? 'Sign in to your account' : 'Create your account'}
          </p>
        </div>

        {/* Mode switch */}
        <div className="flex gap-1.5 p-1 bg-con-surface-2 rounded-xl border border-con-line mb-5">
          <button
            type="button"
            onClick={() => { setMode('signin'); setError(null); setNotice(null); }}
            className={`flex-1 text-xs font-black py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${mode === 'signin' ? 'bg-con-surface text-ember shadow-sm' : 'text-con-text-2 hover:bg-con-surface/40'}`}
          >
            <LogIn className="w-3.5 h-3.5" /> Sign In
          </button>
          <button
            type="button"
            onClick={() => { setMode('signup'); setError(null); setNotice(null); }}
            className={`flex-1 text-xs font-black py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${mode === 'signup' ? 'bg-con-surface text-ember shadow-sm' : 'text-con-text-2 hover:bg-con-surface/40'}`}
          >
            <UserPlus className="w-3.5 h-3.5" /> Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {mode === 'signup' && (
            <>
              <div>
                <label className="block text-[10px] font-black text-con-text-3 uppercase mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Mohammed Ali"
                  className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
                  aria-label="Full name"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-con-text-3 uppercase mb-1">Phone (optional)</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+966 5X XXX XXXX"
                  className="ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 text-[15px] text-con-text transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
                  aria-label="Phone number"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-[10px] font-black text-con-text-3 uppercase mb-1">Email</label>
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
            <label className="block text-[10px] font-black text-con-text-3 uppercase mb-1">Password</label>
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
          {notice && (
            <p className="text-[11px] text-mint font-bold bg-mint-tint border border-mint-line rounded-lg p-2">{notice}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-ember text-white text-xs font-black py-2.5 rounded-full shadow-sm hover:bg-ember/95 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'signin' ? 'Sign In' : 'Create Account'}
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
