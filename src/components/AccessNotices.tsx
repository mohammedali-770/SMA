/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two states where somebody is SIGNED IN to the staff console but cannot be
 * given a console surface. Both used to be handled by sending the browser to
 * `/app`, which is how an administrator could end up locked out of the
 * dashboard with no way back.
 *
 * WHY A SCREEN RATHER THAN A REDIRECT. The console and the customer app are
 * served from the same origin — `/` and `/app` — and supabase-js derives the
 * same `localStorage` key for both, so ONE session is shared between them.
 * Signing in to the customer app therefore also signs you in here. The console
 * then read the role, found `customer`, and called
 * `window.location.replace('/app')` from a mount effect. Because `AuthScreen`
 * renders only while `isAuthenticated` is false, that redirect fired before the
 * sign-in form could ever appear: the dashboard became unreachable in that
 * browser, and the header's Sign out button was navigated away from in the same
 * frame. Measured on 2026-10-08, a live customer session on the owner's desktop
 * did exactly this.
 *
 * So the forwarding is now a BUTTON, not an effect. A customer who lands on the
 * bare domain is one tap from the app; a staff member who is signed in as the
 * wrong account can always sign out. Nothing auto-navigates, which is what
 * makes the lockout impossible rather than unlikely.
 *
 * The map WebView in the customer app passes this origin as a `baseUrl` for an
 * inline HTML document (`LocationPickerMap.tsx`) and never fetches `/`, so it
 * is unaffected by what this renders.
 */
import React from 'react';
import { AlertTriangle, ExternalLink, Loader2, LogOut, RefreshCw } from 'lucide-react';

import { useApp } from '../context/AppContext';
import { BrandMark } from '../design-system/ui/BrandMark';
import { useOpsLang } from './ops/useOpsLang';

/** Shared frame so both notices read as one surface. `min-h-[44px]` on every
 *  control keeps the tap targets at the 44px contract (`tokens.hitTarget`). */
const NoticeCard: React.FC<{
  dir: 'rtl' | 'ltr';
  tone: 'info' | 'warn';
  title: string;
  body: string;
  children: React.ReactNode;
}> = ({ dir, tone, title, body, children }) => (
  <main dir={dir} className="flex-grow w-full px-4 py-10 flex items-start justify-center font-sans">
    <div className="w-full max-w-md border border-con-line bg-con-surface rounded-2xl p-6 space-y-4 text-center">
      {tone === 'warn' ? (
        <AlertTriangle className="w-8 h-8 text-ember mx-auto" aria-hidden="true" />
      ) : (
        <BrandMark className="w-12 h-12 rounded-xl object-contain bg-con-surface border border-con-line mx-auto" />
      )}
      <h2 className="text-sm font-black text-con-text">{title}</h2>
      <p className="text-xs text-con-text-2 font-medium leading-relaxed break-words">{body}</p>
      <div className="flex flex-col gap-2 pt-1">{children}</div>
    </div>
  </main>
);

/**
 * Signed in with an account that is not admin / accountant / branch_staff /
 * call_center. The console cannot serve them, but it says so and offers both
 * ways out instead of navigating on their behalf.
 */
export const NonStaffNotice: React.FC = () => {
  const { t, dir } = useOpsLang('en');
  const { currentUser, signOut } = useApp();
  const who = currentUser.fullName || currentUser.email || currentUser.phoneNumber;

  return (
    <NoticeCard dir={dir} tone="info" title={t('notStaffTitle')} body={t('notStaffBody')}>
      {who && (
        <p className="text-[11px] text-con-text-3 font-bold">
          {t('notStaffSignedInAs')} <span className="text-con-text-2">{who}</span>
        </p>
      )}
      <a
        href="/app"
        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] bg-ember text-white text-xs font-black px-4 rounded-xl transition-colors hover:opacity-90"
      >
        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        {t('notStaffOpenApp')}
      </a>
      <button
        type="button"
        onClick={() => {
          void signOut();
        }}
        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] bg-con-surface/50 hover:bg-con-surface text-con-text-2 hover:text-ember border border-con-line text-xs font-bold px-4 rounded-xl transition-colors"
      >
        <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
        {t('notStaffSignOutHint')}
      </button>
    </NoticeCard>
  );
};

/**
 * The profile row could not be read, so the role is UNKNOWN. This must never
 * fall through to the non-staff notice: reporting a fault as "you are a
 * customer" is the defect this screen exists to replace.
 */
export const ProfileUnavailableNotice: React.FC = () => {
  const { t, dir } = useOpsLang('en');
  const { retryProfile, signOut, dataError } = useApp();
  const [busy, setBusy] = React.useState(false);

  const retry = async () => {
    setBusy(true);
    try {
      await retryProfile();
    } finally {
      setBusy(false);
    }
  };

  return (
    <NoticeCard dir={dir} tone="warn" title={t('profileUnavailableTitle')} body={t('profileUnavailableBody')}>
      {/* A thrown profile read arrives here with its reason in `dataError`.
          It is shown rather than swallowed: this screen replaced DataErrorPanel
          for that case only because DataErrorPanel's Retry could not work, not
          because the message stopped being worth reading. Rendered as text —
          React escapes it — and LTR, since it is usually an English error. */}
      {dataError && (
        <p dir="ltr" className="text-[11px] text-con-text-3 font-medium break-words">
          {dataError}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          void retry();
        }}
        disabled={busy}
        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] bg-ember text-white text-xs font-black px-4 rounded-xl transition-colors hover:opacity-90 disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        {t('retry')}
      </button>
      <button
        type="button"
        onClick={() => {
          void signOut();
        }}
        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] bg-con-surface/50 hover:bg-con-surface text-con-text-2 hover:text-ember border border-con-line text-xs font-bold px-4 rounded-xl transition-colors"
      >
        <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
        {t('signOut')}
      </button>
    </NoticeCard>
  );
};
