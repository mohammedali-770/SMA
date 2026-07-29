/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthScreen } from './components/AuthScreen';
import { ThemeProvider } from './components/ThemeProvider';
import { Server, Loader2, LogOut, AlertTriangle, RefreshCw, X } from 'lucide-react';

// The Admin POS panel and the Supabase console are heavy and secondary to the
// customer mobile app, so they load as separate chunks on demand.
const AdminDashboard = lazy(() =>
  import('./components/AdminDashboard').then(m => ({ default: m.AdminDashboard }))
);
const DatabasePlayground = lazy(() =>
  import('./components/DatabasePlayground').then(m => ({ default: m.DatabasePlayground }))
);

/** Placeholder shown while a lazily-loaded panel's chunk is fetched. */
const PanelFallback: React.FC = () => (
  <div className="flex-1 glass-panel rounded-2xl min-h-[400px] flex items-center justify-center">
    <span className="text-slate-600 text-sm font-bold animate-pulse">Loading…</span>
  </div>
);

/** Full-screen centered spinner used while auth/session or data is loading. */
const FullScreenLoader: React.FC<{ label: string }> = ({ label }) => (
  <div className="min-h-screen flex flex-col items-center justify-center gap-3 font-sans">
    <Loader2 className="w-8 h-8 text-primary animate-spin" />
    <span className="text-sm font-bold text-slate-600">{label}</span>
  </div>
);

/** Top brand bar with the signed-in user + a real sign-out. */
const AppHeader: React.FC = () => {
  const { currentUser, signOut } = useApp();
  const roleLabel = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);
  return (
    <header className="sticky top-0 backdrop-blur-md bg-white/30 border-b border-slate-200/60 text-slate-800 py-3 px-6 z-40">
      <div className="max-w-7xl mx-auto flex justify-between items-center gap-3">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Spicy Meal logo" className="w-9 h-9 rounded-xl object-contain bg-white shadow-md border border-white/20" />
          <div>
            <h1 className="text-base font-black tracking-tight leading-tight text-primary">SPICY MEAL</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-black text-slate-800 leading-tight">{currentUser.fullName || currentUser.email}</p>
            <span className="text-[9px] font-black uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 rounded">
              {roleLabel}
            </span>
          </div>
          <button
            onClick={() => { void signOut(); }}
            className="flex items-center gap-1.5 text-xs font-bold bg-white/50 hover:bg-white text-slate-600 hover:text-secondary border border-slate-200/60 py-1.5 px-3 rounded-xl transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
};

/** Error card shown if the initial Supabase load fails, with a retry. */
const DataErrorPanel: React.FC = () => {
  const { dataError, reload } = useApp();
  return (
    <div className="max-w-md mx-auto mt-16 glass-panel rounded-2xl p-6 text-center space-y-3">
      <AlertTriangle className="w-8 h-8 text-secondary mx-auto" />
      <h2 className="text-sm font-black text-slate-800">Couldn't load your data</h2>
      <p className="text-xs text-slate-600 font-medium break-words">{dataError}</p>
      <button
        onClick={() => { void reload(); }}
        className="inline-flex items-center gap-1.5 bg-primary text-white text-xs font-black py-2 px-4 rounded-xl mx-auto"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Retry
      </button>
    </div>
  );
};

/**
 * Non-fatal write-failure banner. A failed settings/order/loyalty save surfaces
 * here — dismissible, overlaid on the dashboard — instead of replacing the whole
 * screen with DataErrorPanel (which would unmount the console and lose the
 * admin's place and unsaved edits). Full-screen is reserved for initial load.
 */
const WriteErrorBanner: React.FC = () => {
  const { writeError, dismissWriteError } = useApp();
  if (!writeError) return null;
  return (
    <div className="px-4 md:px-6 pt-3">
      <div className="max-w-7xl mx-auto flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2.5 shadow-sm">
        <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 text-xs font-bold break-words">
          <span className="block text-[10px] uppercase tracking-wide text-red-700 font-black">Save failed</span>
          {writeError}
        </div>
        <button
          onClick={dismissWriteError}
          aria-label="Dismiss"
          className="flex-shrink-0 text-red-700 hover:text-red-700 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

/**
 * Customer accounts land in the REAL app, served at /app (the Expo application
 * rendered with React Native Web — single customer UI, no duplicated preview).
 * The Supabase session is shared (same origin + storage key), so the redirect
 * is seamless. A visible link covers any blocked client-side navigation.
 */
const CustomerApp: React.FC = () => {
  React.useEffect(() => { window.location.replace('/app'); }, []);
  return (
    <main className="flex-grow p-6 max-w-md mx-auto w-full text-center space-y-3">
      <p className="text-sm font-black text-slate-700">Opening the Spicy Meal app…</p>
      <a href="/app" className="text-primary text-sm font-black underline">/app</a>
    </main>
  );
};

/** The staff console (role = admin or accountant). */
const StaffApp: React.FC = () => {
  const { currentUser } = useApp();
  const isAdmin = currentUser.role === 'admin';
  // The emulated Supabase console is a DEV-only aid — Vite statically replaces
  // import.meta.env.DEV with false in production builds, so it never ships to
  // the live dashboard (the lazy chunk is tree-shaken away).
  const showDbConsole = isAdmin && import.meta.env.DEV;
  return (
    <main className="flex-grow p-4 md:p-6 max-w-7xl mx-auto w-full space-y-6">
      <Suspense fallback={<PanelFallback />}>
        <AdminDashboard />
      </Suspense>
      {showDbConsole && (
        <div className="flex flex-col">
          <span className="text-xs bg-white/50 backdrop-blur-md text-slate-600 font-black py-1 px-3 rounded-full border border-white/85 uppercase tracking-widest self-start mb-2.5 flex items-center gap-1 shadow-2xs">
            <Server className="w-3.5 h-3.5 text-secondary" />
            <span>Supabase Data Console</span>
          </span>
          <Suspense fallback={<PanelFallback />}>
            <DatabasePlayground />
          </Suspense>
        </div>
      )}
    </main>
  );
};

function AppContent() {
  const { authReady, isAuthenticated, currentUser, dataLoading, dataError } = useApp();

  if (!authReady) return <FullScreenLoader label="Starting…" />;
  if (!isAuthenticated) return <AuthScreen />;

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <AppHeader />
      <WriteErrorBanner />
      {dataError ? (
        <DataErrorPanel />
      ) : dataLoading && !currentUser.id ? (
        <FullScreenLoader label="Loading your account…" />
      ) : currentUser.role === 'customer' ? (
        <CustomerApp />
      ) : (
        <StaffApp />
      )}
      <footer className="backdrop-blur-md bg-white/10 text-slate-600 text-center py-5 border-t border-slate-200/60 mt-10 text-xs">
        <div className="max-w-7xl mx-auto px-6">
          <span dir="rtl">© 2026 شركة الطعم الأول للتجارة</span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    // Theme sits OUTSIDE the app provider: the colour scheme has to hold on the
    // sign-in screen and the loading state too, neither of which has a session.
    <ThemeProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ThemeProvider>
  );
}
