/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { MobileEmulator } from './components/MobileEmulator';
import { Server, Info, CheckCircle2 } from 'lucide-react';

// The Admin POS panel and the Supabase console are heavy and secondary to the
// customer mobile app, so they load as separate chunks on demand rather than
// bloating the initial bundle. Named exports are adapted to lazy()'s default shape.
const AdminDashboard = lazy(() =>
  import('./components/AdminDashboard').then(m => ({ default: m.AdminDashboard }))
);
const DatabasePlayground = lazy(() =>
  import('./components/DatabasePlayground').then(m => ({ default: m.DatabasePlayground }))
);

/** Placeholder shown while a lazily-loaded panel's chunk is fetched. */
const PanelFallback: React.FC = () => (
  <div className="flex-1 glass-panel rounded-2xl min-h-[400px] flex items-center justify-center">
    <span className="text-slate-400 text-sm font-bold animate-pulse">Loading…</span>
  </div>
);

function AppContent() {
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<'all' | 'mobile' | 'admin' | 'database'>('all');
  const { currentUser, setCurrentUser, newOrderAlert } = useApp();

  return (
    <div className="min-h-screen flex flex-col font-sans">
      
      {/* Top Main Brand Header */}
      <header className="sticky top-0 backdrop-blur-md bg-white/30 border-b border-slate-200/60 text-slate-800 py-4 px-6 z-40">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Spicy Meal logo" className="w-10 h-10 rounded-xl object-contain bg-white shadow-md border border-white/20" />
            <div>
              <h1 className="text-lg font-black tracking-tight leading-tight text-primary">SPICY MEAL MONOREPO PLATFORM</h1>
              <p className="text-[10px] font-bold text-slate-500 flex items-center gap-1 mt-0.5">
                <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded font-black text-[9px] uppercase tracking-wider">Phase 1-9 Prototype</span>
                <span>• Saudi Fast-Food Delivery & Administrative POS Ecosystem</span>
              </p>
            </div>
          </div>

          {/* Unified workspace mode switches */}
          <div className="flex bg-slate-200/50 backdrop-blur-md p-1 rounded-2xl border border-slate-300/40 shadow-xs">
            {[
              { key: 'all', label: '🎛️ Combined View' },
              { key: 'mobile', label: '📱 Customer Mobile App' },
              { key: 'admin', label: '🖥️ Admin POS Panel' },
              { key: 'database', label: '⚙️ Supabase Console' }
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveWorkspaceTab(tab.key as any)}
                className={`text-xs font-bold py-1.5 px-3.5 rounded-xl transition-all whitespace-nowrap ${
                  activeWorkspaceTab === tab.key 
                    ? 'bg-white text-primary shadow-sm scale-102 font-black' 
                    : 'text-slate-600 hover:text-primary hover:bg-white/30'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Synchronized flow tutorial panel */}
      <div className="bg-white/40 backdrop-blur-md border-b border-slate-200/60 py-3 px-6 text-xs text-slate-700">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3 font-semibold">
          <div className="flex items-start md:items-center gap-2">
            <Info className="w-4.5 h-4.5 text-primary flex-shrink-0 mt-0.5 md:mt-0" />
            <div>
              <span className="font-extrabold text-primary">{activeWorkspaceTab === 'all' ? 'Combined Real-time Sandbox:' : 'Sync Checklist:'}</span>
              <span className="text-slate-600 font-medium ml-1">
                {activeWorkspaceTab === 'all' 
                  ? 'Add items with modifiers in the Mobile App, complete checkout with Saudi Address, and see the Admin panel immediately buzz with alerts and audio! Toggle product availability in Branch matrix to watch the Mobile menu instantly update!'
                  : 'All views share the PostgreSQL emulator state. Actions on one screen dynamically trigger updates and real-time syncing on the others!'}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <span className="text-[10px] bg-emerald-500/10 text-emerald-800 py-0.5 px-2 rounded-full font-bold flex items-center gap-1 border border-emerald-500/20">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              RTL/Arabic Ready
            </span>
            <span className="text-[10px] bg-primary/10 text-primary py-0.5 px-2 rounded-full font-bold flex items-center gap-1 border border-purple-500/10">
              <Server className="w-3 h-3" />
              Lazywait Mapping
            </span>
          </div>
        </div>
      </div>

      {/* Main Interactive Workspace Area */}
      <main className="flex-grow p-4 md:p-6 max-w-7xl mx-auto w-full">
        
        {/* COMBINED MULTI-SCREEN SANDBOX VIEW */}
        {activeWorkspaceTab === 'all' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Column 1: Customer Mobile Emulator (Span 4) */}
            <div className="lg:col-span-4 flex flex-col items-center">
              <div className="w-full text-center mb-2.5">
                <span className="text-xs bg-white/50 backdrop-blur-md text-primary font-black py-1 px-3 rounded-full border border-white/85 uppercase tracking-widest shadow-2xs">
                  📱 Customer Mobile App Simulation
                </span>
              </div>
              <MobileEmulator />
            </div>

            {/* Column 2: Administrative pos dashboard and Supabase playground (Span 8) */}
            <div className="lg:col-span-8 space-y-6">
              
              {/* Top sub-row: Admin POS control center */}
              <div className="flex flex-col">
                <span className="text-xs bg-white/50 backdrop-blur-md text-secondary font-black py-1 px-3 rounded-full border border-white/85 uppercase tracking-widest self-start mb-2.5 shadow-2xs">
                  🖥️ Administrative POS Panel (Phase 8 Menu & Branch Controls)
                </span>
                <Suspense fallback={<PanelFallback />}>
                  <AdminDashboard />
                </Suspense>
              </div>

              {/* Bottom sub-row: Supabase postgres table inspector */}
              <div className="flex flex-col">
                <span className="text-xs bg-white/50 backdrop-blur-md text-slate-600 font-black py-1 px-3 rounded-full border border-white/85 uppercase tracking-widest self-start mb-2.5 flex items-center gap-1 shadow-2xs">
                  <Server className="w-3.5 h-3.5 text-secondary" />
                  <span>⚙️ Live Supabase PostgreSQL Database Tables</span>
                </span>
                <Suspense fallback={<PanelFallback />}>
                  <DatabasePlayground />
                </Suspense>
              </div>

            </div>

          </div>
        )}

        {/* WORKSPACE TAB 2: MOBILE ONLY VIEW */}
        {activeWorkspaceTab === 'mobile' && (
          <div className="flex flex-col items-center max-w-md mx-auto py-4">
            <div className="text-center mb-4">
              <h2 className="text-lg font-black text-primary flex items-center justify-center gap-2">
                <span>📱 Customer Mobile App Simulation</span>
              </h2>
              <p className="text-xs text-slate-500 mt-1">Simulates Expo React Native navigation with localized fields, modifier choices, Saudi short address, and instant VAT invoice receipts.</p>
            </div>
            <MobileEmulator />
          </div>
        )}

        {/* WORKSPACE TAB 3: ADMIN POS ONLY VIEW */}
        {activeWorkspaceTab === 'admin' && (
          <div className="space-y-4">
            <div className="backdrop-blur-md bg-white/40 border border-white/60 p-4 rounded-2xl shadow-xs">
              <h3 className="text-sm font-black text-slate-800 uppercase">POS Administrative command center</h3>
              <p className="text-xs text-slate-500 mt-1">Manage orders, update live branch parameters, and bulk load files. Logged in as: <span className="font-extrabold text-primary">{currentUser.fullName} ({currentUser.role})</span>. Switch profiles in the header to change permissions.</p>
            </div>
            <Suspense fallback={<PanelFallback />}>
              <AdminDashboard />
            </Suspense>
          </div>
        )}

        {/* WORKSPACE TAB 4: DATABASE CONSOLE ONLY VIEW */}
        {activeWorkspaceTab === 'database' && (
          <div className="space-y-4">
            <div className="backdrop-blur-md bg-slate-900/40 border border-slate-800/80 p-4 rounded-2xl text-slate-300 text-xs">
              <h3 className="text-sm font-black text-white font-mono uppercase">POSTGRESQL RELATIONAL SCHEMA ENGINE</h3>
              <p className="text-slate-400 mt-1">Direct representation of tables created during Phase 2. These state lists represent live data elements synchronized via our unified local store wrapper.</p>
            </div>
            <Suspense fallback={<PanelFallback />}>
              <DatabasePlayground />
            </Suspense>
          </div>
        )}

      </main>

      {/* Global Footer info credits */}
      <footer className="backdrop-blur-md bg-white/10 text-slate-500 text-center py-6 border-t border-slate-200/60 mt-12 text-xs">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-3">
          <span>© 2026 Spicy Meal Brand Group. Saudi Arabia. All Rights Reserved.</span>
          <div className="flex gap-4">
            <span>Riyadh Office • 1stTaste Group</span>
            <span className="text-slate-300">|</span>
            <span>POS Systems Integration Engine</span>
          </div>
        </div>
      </footer>

    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
