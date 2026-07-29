/**
 * Screenshot harness entry. Mounts the REAL admin components against the
 * repository's demo data so captures show the actual stylesheet, not a mock-up.
 */
import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';

import '../src/index.css';
import { ThemeProvider } from '../src/components/ThemeProvider';

const AdminDashboard = lazy(() =>
  import('../src/components/AdminDashboard').then((m) => ({ default: m.AdminDashboard })),
);
const DatabasePlayground = lazy(() =>
  import('../src/components/DatabasePlayground').then((m) => ({ default: m.DatabasePlayground })),
);

const view = new URLSearchParams(location.search).get('view') ?? 'admin';

function Harness() {
  return (
    // Same position as in App: above every screen, so the DatabasePlayground
    // view is themed too, not only the dashboard.
    <ThemeProvider>
    <div className="min-h-screen flex flex-col font-sans">
      <header className="sticky top-0 backdrop-blur-md bg-white/30 border-b border-slate-200/60 text-slate-800 py-3 px-6 z-40">
        <div className="max-w-7xl mx-auto flex justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white shadow-md border border-white/20 flex items-center justify-center font-black text-primary">S</div>
            <h1 className="text-base font-black tracking-tight leading-tight text-primary">SPICY MEAL</h1>
          </div>
          <div className="text-right">
            <p className="text-xs font-black text-slate-800 leading-tight">Mohammed Al-Ali</p>
            <span className="text-[9px] font-black uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 rounded">Admin</span>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto p-6">
        <Suspense fallback={<div className="p-10 text-slate-600 font-bold">Loading…</div>}>
          {view === 'db' ? <DatabasePlayground /> : <AdminDashboard />}
        </Suspense>
      </main>
    </div>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
