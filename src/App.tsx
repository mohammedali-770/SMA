/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthScreen } from './components/AuthScreen';
import { StaffMfaGate } from './components/StaffMfaGate';
import { ThemeProvider } from './components/ThemeProvider';
import { AppearanceToggle } from './components/AppearanceToggle';
import { BrandMark } from './design-system/ui/BrandMark';
import { chooseConsoleAudience, type ConsoleAudience } from './lib/consoleAudience';
import { opsT, type OpsLang, type OpsStringKey } from './components/ops/opsStrings';
import { useOpsLangFollower } from './components/ops/useOpsLang';
import { NonStaffNotice, ProfileUnavailableNotice } from './components/AccessNotices';
import { Server, Loader2, LogOut, AlertTriangle, RefreshCw, X } from 'lucide-react';

const AdminDashboard = lazy(() =>
  import('./components/AdminDashboard').then(m => ({ default: m.AdminDashboard }))
);
const OpsConsole = lazy(() =>
  import('./components/ops/OpsConsole').then(m => ({ default: m.OpsConsole }))
);
const DatabasePlayground = lazy(() =>
  import('./components/DatabasePlayground').then(m => ({ default: m.DatabasePlayground }))
);

/**
 * The language of the frame AROUND each console (header, loaders, load and save
 * errors) — F-X14-001. It used to be English everywhere, so the one control a
 * cashier needs when the network drops (Sign out, Retry) was in the one language
 * the ops consoles were built to spare them. It follows the surface it wraps:
 *   - admin / accountant: `adminLang`, the language the dashboard is showing;
 *   - everything else: the operations language (Arabic by default for `ops`,
 *     English for the sign-in / notice states, like the screens they sit on),
 *     including a toggle made inside the ops console, via `useOpsLangFollower`.
 * It only READS: the surface that owns the language sets `<html lang>`.
 */
function useShellLang(audience: ConsoleAudience): { lang: OpsLang; dir: 'rtl' | 'ltr'; t: (key: OpsStringKey) => string } {
  const { adminLang } = useApp();
  const ops = useOpsLangFollower(audience === 'ops' ? 'ar' : 'en');
  const lang: OpsLang = audience === 'admin' && (adminLang === 'ar' || adminLang === 'en') ? adminLang : ops.lang;
  return {
    lang,
    dir: lang === 'ar' ? 'rtl' : 'ltr',
    t: (key) => opsT(lang, key),
  };
}

const ROLE_KEYS: Record<string, OpsStringKey> = {
  admin: 'roleAdmin',
  accountant: 'roleAccountant',
  branch_staff: 'roleBranchStaff',
  call_center: 'roleCallCentre',
  customer: 'roleCustomer',
};

const PanelFallback: React.FC<{ lang?: OpsLang }> = ({ lang = 'en' }) => (
  <div className="flex-1 border border-con-line bg-con-surface rounded-2xl min-h-[400px] flex items-center justify-center">
    <span className="text-con-text-3 text-sm font-bold animate-pulse">{opsT(lang, 'loading')}</span>
  </div>
);

const FullScreenLoader: React.FC<{ label: string; dir?: 'rtl' | 'ltr' }> = ({ label, dir }) => (
  <div dir={dir} className="min-h-screen flex flex-col items-center justify-center gap-3 font-sans">
    <Loader2 className="w-8 h-8 text-ember animate-spin" aria-hidden="true" />
    <span className="text-sm font-bold text-con-text-2">{label}</span>
  </div>
);

const AppHeader: React.FC<{ lang: OpsLang; dir: 'rtl' | 'ltr' }> = ({ lang, dir }) => {
  const { currentUser, signOut } = useApp();
  // Until a profile has loaded, `currentUser` is GUEST_USER, whose role is the
  // placeholder `customer`. Rendering it labelled every admin "Customer" for the
  // length of each sign-in, and — worse — sat a "Customer" badge directly above
  // the notice explaining that an unreadable profile is NOT a sign you are a
  // customer. Identity details appear only once there is an identity to show.
  // Sign out stays, because it is the way out of every one of those states.
  const identityKnown = Boolean(currentUser.id);
  // A role id is a database value, not copy: "branch_staff" is not something a
  // cashier should read in a header. An unrecognised role falls back to the id.
  const roleKey = ROLE_KEYS[currentUser.role];
  const roleLabel = roleKey
    ? opsT(lang, roleKey)
    : currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);
  return (
    <header dir={dir} className="sticky top-0 backdrop-blur-md bg-con-surface/30 border-b border-con-line text-con-text py-3 px-6 z-40">
      <div className="max-w-7xl mx-auto flex justify-between items-center gap-3">
        <div className="flex items-center gap-3">
          <BrandMark className="w-9 h-9 rounded-xl object-contain bg-con-surface border border-con-line" />
          <div><h1 className="text-base font-black tracking-tight leading-tight text-ember">SPICY MEAL</h1></div>
        </div>
        <div className="flex items-center gap-3">
          <AppearanceToggle lang={lang} />
          {identityKnown && (
            <div className="text-end hidden sm:block">
              <p className="text-xs font-black text-con-text leading-tight">{currentUser.fullName || currentUser.email}</p>
              <span className="text-[9px] font-black uppercase tracking-wider bg-ember/10 text-ember px-1.5 py-0.5 rounded">{roleLabel}</span>
            </div>
          )}
          <button
            onClick={() => { void signOut(); }}
            // The text span below is `hidden sm:inline`, which removes it from
            // the accessibility tree: under 640px this button had NO name
            // (F-X14-002), and it is the only way out of every error state.
            aria-label={opsT(lang, 'signOut')}
            title={opsT(lang, 'signOut')}
            className="flex items-center justify-center gap-1.5 min-h-11 min-w-11 text-xs font-bold bg-con-surface/50 hover:bg-con-surface text-con-text-2 hover:text-ember border border-con-line py-1.5 px-3 rounded-xl transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{opsT(lang, 'signOut')}</span>
          </button>
        </div>
      </div>
    </header>
  );
};

const DataErrorPanel: React.FC<{ lang: OpsLang; dir: 'rtl' | 'ltr' }> = ({ lang, dir }) => {
  const { dataError, reload } = useApp();
  return (
    <div dir={dir} className="max-w-md mx-auto mt-16 border border-con-line bg-con-surface rounded-2xl p-6 text-center space-y-3">
      <AlertTriangle className="w-8 h-8 text-ember mx-auto" aria-hidden="true" />
      <h2 className="text-sm font-black text-con-text">{opsT(lang, 'shellLoadErrorTitle')}</h2>
      <p dir="auto" className="text-xs text-con-text-2 font-medium break-words">{dataError}</p>
      <button
        onClick={() => { void reload(); }}
        className="inline-flex items-center gap-1.5 bg-ember text-white text-xs font-black py-2 px-4 rounded-xl mx-auto"
      >
        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> {opsT(lang, 'retry')}
      </button>
    </div>
  );
};

const WriteErrorBanner: React.FC<{ lang: OpsLang; dir: 'rtl' | 'ltr' }> = ({ lang, dir }) => {
  const { writeError, dismissWriteError } = useApp();
  if (!writeError) return null;
  return (
    <div dir={dir} className="px-4 md:px-6 pt-3">
      <div className="max-w-7xl mx-auto flex items-start gap-2 bg-danger-tint border border-danger-line text-danger-ink rounded-xl px-3 py-2.5 shadow-sm">
        <AlertTriangle className="w-4 h-4 text-danger-ds flex-shrink-0 mt-0.5" />
        <div className="flex-1 text-xs font-bold break-words">
          <span className="block text-[10px] uppercase tracking-wide text-danger-ink font-black">{opsT(lang, 'shellSaveFailed')}</span>
          <span dir="auto">{writeError}</span>
        </div>
        <button onClick={dismissWriteError} aria-label={opsT(lang, 'shellDismiss')} className="flex-shrink-0 text-danger-ink hover:text-danger-ink transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

const StaffApp: React.FC = () => {
  const { currentUser, adminLang } = useApp();
  const fallbackLang: OpsLang = adminLang === 'ar' ? 'ar' : 'en';
  const isAdmin = currentUser.role === 'admin';
  const showDbConsole = isAdmin && import.meta.env.DEV;
  return (
    <main className="flex-grow p-4 md:p-6 max-w-7xl mx-auto w-full space-y-6">
      <Suspense fallback={<PanelFallback lang={fallbackLang} />}><AdminDashboard /></Suspense>
      {showDbConsole && (
        <div className="flex flex-col">
          <span className="text-xs bg-con-surface/50 backdrop-blur-md text-con-text-2 font-black py-1 px-3 rounded-full border border-white/85 uppercase tracking-widest self-start mb-2.5 flex items-center gap-1 shadow-2xs">
            <Server className="w-3.5 h-3.5 text-ember" />
            <span>Supabase Data Console</span>
          </span>
          <Suspense fallback={<PanelFallback lang={fallbackLang} />}><DatabasePlayground /></Suspense>
        </div>
      )}
    </main>
  );
};

/** Exported for `App.test.tsx`; the default export below is what ships. */
export function AppContent() {
  const { authReady, isAuthenticated, currentUser, dataLoading, dataError, profileUnavailable } = useApp();

  // Routing used to be `role !== 'customer'`, i.e. "anyone who is not a customer
  // gets the admin console behind the TOTP gate". With the branch-operations
  // roles that is no longer the right question — a cashier signing in on shared
  // shop-floor hardware has no authenticator app and no permission to read the
  // admin dataset. Each surface is now chosen explicitly.
  //
  // The choice itself lives in `chooseConsoleAudience` rather than in these
  // ternaries, because the arm that used to sit LAST here was the customer app:
  // anything unrecognised became `customer` and was redirected to /app, so an
  // administrator whose profile could not be read was locked out of the
  // dashboard. That ordering is now a pure function with its own exhaustive
  // tests (`src/lib/consoleAudience.test.ts`).
  const audience = chooseConsoleAudience({
    authReady,
    isAuthenticated,
    profileUnavailable,
    identityKnown: Boolean(currentUser.id),
    dataLoading,
    role: currentUser.role,
  });
  const shell = useShellLang(audience);

  if (audience === 'starting') return <FullScreenLoader label={shell.t('shellStarting')} dir={shell.dir} />;
  if (audience === 'sign-in') return <AuthScreen />;

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <AppHeader lang={shell.lang} dir={shell.dir} />
      <WriteErrorBanner lang={shell.lang} dir={shell.dir} />
      {audience === 'admin' ? (
        <StaffMfaGate>
          {dataError ? (
            <DataErrorPanel lang={shell.lang} dir={shell.dir} />
          ) : dataLoading ? (
            <FullScreenLoader label={shell.t('shellLoadingStaff')} dir={shell.dir} />
          ) : (
            <StaffApp />
          )}
        </StaffMfaGate>
      ) : audience === 'ops' ? (
        dataError ? (
          <DataErrorPanel lang={shell.lang} dir={shell.dir} />
        ) : dataLoading ? (
          <FullScreenLoader label={shell.t('shellLoadingBranch')} dir={shell.dir} />
        ) : (
          <Suspense fallback={<PanelFallback lang={shell.lang} />}><OpsConsole /></Suspense>
        )
      ) : audience === 'account-loading' ? (
        dataError ? <ProfileUnavailableNotice /> : <FullScreenLoader label={shell.t('shellLoadingAccount')} dir={shell.dir} />
      ) : audience === 'profile-unavailable' ? (
        // NEVER DataErrorPanel here. Its Retry calls `reload()`, which is a
        // no-op without `currentUser.id` — and the identity is exactly what is
        // missing. An earlier revision of this arm preferred DataErrorPanel when
        // `dataError` was set, so a thrown profile read (which `myProfile()` now
        // raises deliberately) landed on a dead Retry button: the very failure
        // `retryProfile` was written to prevent. The notice retries through
        // `retryProfile` and shows `dataError` as its detail line, so the
        // message is not lost either.
        <ProfileUnavailableNotice />
      ) : dataError ? (
        <DataErrorPanel lang={shell.lang} dir={shell.dir} />
      ) : (
        <NonStaffNotice />
      )}
      <footer className="backdrop-blur-md bg-con-surface/10 text-con-text-2 text-center py-5 border-t border-con-line mt-10 text-xs">
        <div className="max-w-7xl mx-auto px-6"><span dir="rtl">© 2026 شركة الطعم الأول للتجارة</span></div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppProvider><AppContent /></AppProvider>
    </ThemeProvider>
  );
}
