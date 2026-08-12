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
import { Server, Loader2, LogOut, AlertTriangle, RefreshCw, X } from 'lucide-react';

const AdminDashboard = lazy(() =>
  import('./components/AdminDashboard').then(m => ({ default: m.AdminDashboard }))
);
const DatabasePlayground = lazy(() =>
  import('./components/DatabasePlayground').then(m => ({ default: m.DatabasePlayground }))
);

const PanelFallback: React.FC = () => (
  <div className="flex-1 border border-con-line bg-con-surface rounded-2xl min-h-[400px] flex items-center justify-center">
    <span className="text-con-text-3 text-sm font-bold animate-pulse">Loading…</span>
  </div>
);

const FullScreenLoader: React.FC<{ label: string }> = ({ label }) => (
  <div className="min-h-screen flex flex-col items-center justify-center gap-3 font-sans">
    <Loader2 className="w-8 h-8 text-ember animate-spin" />
    <span className="text-sm font-bold text-con-text-2">{label}</span>
  </div>
);

const AppHeader: React.FC = () => {
  const { currentUser, signOut } = useApp();
  const roleLabel = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);
  return (
    <header className="sticky top-0 backdrop-blur-md bg-con-surface/30 border-b border-con-line text-con-text py-3 px-6 z-40">
      <div className="max-w-7xl mx-auto flex justify-between items-center gap-3">
        <div className="flex items-center gap-3">
          <BrandMark className="w-9 h-9 rounded-xl object-contain bg-con-surface border border-con-line" />
          <div><h1 className="text-base font-black tracking-tight leading-tight text-ember">SPICY MEAL</h1></div>
        </div>
        <div className="flex items-center gap-3">
          <AppearanceToggle />
          <div className="text-right hidden sm:block">
            <p className="text-xs font-black text-con-text leading-tight">{currentUser.fullName || currentUser.email}</p>
            <span className="text-[9px] font-black uppercase tracking-wider bg-ember/10 text-ember px-1.5 py-0.5 rounded">{roleLabel}</span>
          </div>
          <button
            onClick={() => { void signOut(); }}
            className="flex items-center gap-1.5 text-xs font-bold bg-con-surface/50 hover:bg-con-surface text-con-text-2 hover:text-ember border border-con-line py-1.5 px-3 rounded-xl transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
};

const DataErrorPanel: React.FC = () => {
  const { dataError, reload } = useApp();
  return (
    <div className="max-w-md mx-auto mt-16 border border-con-line bg-con-surface rounded-2xl p-6 text-center space-y-3">
      <AlertTriangle className="w-8 h-8 text-ember mx-auto" />
      <h2 className="text-sm font-black text-con-text">Couldn't load your data</h2>
      <p className="text-xs text-con-text-2 font-medium break-words">{dataError}</p>
      <button
        onClick={() => { void reload(); }}
        className="inline-flex items-center gap-1.5 bg-ember text-white text-xs font-black py-2 px-4 rounded-xl mx-auto"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Retry
      </button>
    </div>
  );
};

const WriteErrorBanner: React.FC = () => {
  const { writeError, dismissWriteError } = useApp();
  if (!writeError) return null;
  return (
    <div className="px-4 md:px-6 pt-3">
      <div className="max-w-7xl mx-auto flex items-start gap-2 bg-danger-tint border border-danger-line text-danger-ds rounded-xl px-3 py-2.5 shadow-sm">
        <AlertTriangle className="w-4 h-4 text-danger-ds flex-shrink-0 mt-0.5" />
        <div className="flex-1 text-xs font-bold break-words">
          <span className="block text-[10px] uppercase tracking-wide text-danger-ds font-black">Save failed</span>
          {writeError}
        </div>
        <button onClick={dismissWriteError} aria-label="Dismiss" className="flex-shrink-0 text-danger-ds hover:text-danger-ds transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

const CustomerApp: React.FC = () => {
  React.useEffect(() => { window.location.replace('/app'); }, []);
  return (
    <main className="flex-grow p-6 max-w-md mx-auto w-full text-center space-y-3">
      <p className="text-sm font-black text-con-text-2">Opening the Spicy Meal app…</p>
      <a href="/app" className="text-ember text-sm font-black underline">/app</a>
    </main>
  );
};

const StaffApp: React.FC = () => {
  const { currentUser } = useApp();
  const isAdmin = currentUser.role === 'admin';
  const showDbConsole = isAdmin && import.meta.env.DEV;
  return (
    <main className="flex-grow p-4 md:p-6 max-w-7xl mx-auto w-full space-y-6">
      <Suspense fallback={<PanelFallback />}><AdminDashboard /></Suspense>
      {showDbConsole && (
        <div className="flex flex-col">
          <span className="text-xs bg-con-surface/50 backdrop-blur-md text-con-text-2 font-black py-1 px-3 rounded-full border border-white/85 uppercase tracking-widest self-start mb-2.5 flex items-center gap-1 shadow-2xs">
            <Server className="w-3.5 h-3.5 text-ember" />
            <span>Supabase Data Console</span>
          </span>
          <Suspense fallback={<PanelFallback />}><DatabasePlayground /></Suspense>
        </div>
      )}
    </main>
  );
};

function AppContent() {
  const { authReady, isAuthenticated, currentUser, dataLoading, dataError } = useApp();

  if (!authReady) return <FullScreenLoader label="Starting…" />;
  if (!isAuthenticated) return <AuthScreen />;

  const staffIdentityKnown = Boolean(currentUser.id) && currentUser.role !== 'customer';

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <AppHeader />
      <WriteErrorBanner />
      {staffIdentityKnown ? (
        <StaffMfaGate>
          {dataError ? (
            <DataErrorPanel />
          ) : dataLoading ? (
            <FullScreenLoader label="Loading staff data…" />
          ) : (
            <StaffApp />
          )}
        </StaffMfaGate>
      ) : dataError ? (
        <DataErrorPanel />
      ) : dataLoading && !currentUser.id ? (
        <FullScreenLoader label="Loading your account…" />
      ) : (
        <CustomerApp />
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
