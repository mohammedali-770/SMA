/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  BarChart3, Layers, ClipboardList, Store,
  Volume2, VolumeX, ShieldAlert, FileSpreadsheet, Settings
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ADMIN_LOCALES } from './admin/adminLocales';
import { ReportsPanel } from './admin/ReportsPanel';
import { SettingsPanel } from './admin/SettingsPanel';
import { StatsPanel } from './admin/StatsPanel';
import { BranchPoliciesPanel } from './admin/BranchPoliciesPanel';
import { LiveOrdersPanel } from './admin/LiveOrdersPanel';
import { MenuManagementPanel } from './admin/MenuManagementPanel';


export const AdminDashboard: React.FC = () => {
  const {
    orders, profiles, currentUser, setCurrentUser,
    adminLang, setAdminLang, newOrderAlert, setNewOrderAlert,
    playNotificationSound, soundMuted, setSoundMuted,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'stats' | 'orders' | 'menu' | 'branches' | 'reports' | 'settings'>('stats');

  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const isAccountant = currentUser.role === 'accountant';

  // Active-order count drives the sidebar "Live Orders" badge.
  const activeOrdersCount = orders
    .filter(o => o.status !== 'delivered' && o.status !== 'cancelled')
    .length;



  return (
    <div className="flex-1 glass-panel flex flex-col h-full min-h-[700px] rounded-2xl overflow-hidden select-none" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
      
      {/* Realtime Alert Pulsing banner if newOrderAlert is active */}
      {newOrderAlert && (
        <div className="bg-secondary text-white p-3.5 flex justify-between items-center animate-pulse z-40">
          <div className="flex items-center gap-2">
            <Volume2 className="w-5 h-5" />
            <span className="text-xs font-black tracking-wide">{t.realtime_pulse}</span>
          </div>
          <div className="flex gap-2">
            {!soundMuted && (
              <button
                onClick={() => playNotificationSound()}
                className="bg-white/20 hover:bg-white/30 text-white text-[10px] font-bold py-1 px-3 rounded-md transition-colors"
              >
                🔔 {isRTL ? 'إعادة صوت الرنين' : 'Replay Ring'}
              </button>
            )}
            <button 
              onClick={() => setNewOrderAlert(false)}
              className="bg-white text-secondary text-[10px] font-black py-1 px-3 rounded-md shadow-xs"
            >
              {t.dismiss}
            </button>
          </div>
        </div>
      )}

      {/* Admin Title bar Header */}
      <div className="bg-white/20 backdrop-blur-md border-b border-slate-200/60 p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-lg font-black text-primary flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-secondary" />
            {t.dashboard_title}
          </h2>
          <p className="text-[11px] text-gray-400 mt-0.5">{isRTL ? 'نظام التحكم والربط المباشر لفروع سبايسي ميل' : 'Real-time synchronization console connected to live Fast-Food branches'}</p>
        </div>

        {/* Global configurations / Language / Session roles */}
        <div className="flex flex-wrap items-center gap-3 self-end sm:self-auto">
          {/* Audio sound toggler */}
          <button
            onClick={() => setSoundMuted(!soundMuted)}
            className={`p-2 rounded-xl border transition-all ${soundMuted ? 'bg-red-50 text-red-500 border-red-100' : 'bg-green-50 text-green-700 border-green-100'}`}
            title={soundMuted ? t.sound_alert_off : t.sound_alert_on}
          >
            {soundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {/* Session Role switcher */}
          <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-xl border border-gray-200">
            <span className="text-[10px] text-gray-500 font-extrabold px-1.5 uppercase">{t.role}:</span>
            {profiles.filter(p => p.role !== 'customer').map(p => (
              <button 
                key={p.role}
                onClick={() => setCurrentUser(p)}
                className={`text-[10px] font-black px-2.5 py-1 rounded-lg capitalize transition-all ${currentUser.role === p.role ? 'bg-primary text-white shadow-sm' : 'text-gray-600 hover:bg-white/50'}`}
              >
                {p.fullName.split(' ')[0]} ({p.role})
              </button>
            ))}
          </div>

          {/* Admin panel English/Arabic translation switcher */}
          <button 
            onClick={() => setAdminLang(adminLang === 'en' ? 'ar' : 'en')}
            className="text-xs bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-xl font-bold text-gray-800 flex items-center gap-1"
          >
            ✕ {adminLang.toUpperCase()}
          </button>
        </div>
      </div>

      {/* Accountant role alert guard bar */}
      {isAccountant && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 flex items-center gap-2 text-amber-900 text-xs font-semibold">
          <ShieldAlert className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span>{t.role_accountant_warning}</span>
        </div>
      )}

      {/* Main Row: Sidebar Tabs and Tab Viewports */}
      <div className="flex-1 flex flex-col md:flex-row">
        
        {/* Responsive Left Sidebar */}
        <div className="w-full md:w-[220px] bg-white/20 backdrop-blur-md border-b md:border-b-0 md:border-r border-slate-200/60 p-3 flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-x-visible">
          <button 
            onClick={() => setActiveTab('stats')}
            className={`w-full text-left flex items-center gap-2 text-xs font-extrabold py-2.5 px-3.5 rounded-xl transition-all whitespace-nowrap ${activeTab === 'stats' ? 'glass-btn-primary text-white shadow-xs' : 'text-slate-700 hover:bg-white/40'}`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>{isRTL ? 'الملخص اليومي' : 'Sales Overview'}</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('orders')}
            className={`w-full text-left flex items-center justify-between text-xs font-extrabold py-2.5 px-3.5 rounded-xl transition-all whitespace-nowrap ${activeTab === 'orders' ? 'glass-btn-primary text-white shadow-xs' : 'text-slate-700 hover:bg-white/40'}`}
          >
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4" />
              <span>{isRTL ? 'الطلبات المباشرة' : 'Live Orders'}</span>
            </div>
            {activeOrdersCount > 0 && (
              <span className={`text-[9px] px-2 py-0.5 rounded-full ${activeTab === 'orders' ? 'bg-white text-primary' : 'bg-[#e02d3d] text-white'} font-black`}>
                {activeOrdersCount}
              </span>
            )}
          </button>

          <button 
            onClick={() => setActiveTab('menu')}
            className={`w-full text-left flex items-center gap-2 text-xs font-extrabold py-2.5 px-3.5 rounded-xl transition-all whitespace-nowrap ${activeTab === 'menu' ? 'glass-btn-primary text-white shadow-xs' : 'text-slate-700 hover:bg-white/40'}`}
          >
            <Layers className="w-4 h-4" />
            <span>{isRTL ? 'إدارة المنيو والأسعار' : 'Menu Management'}</span>
          </button>

          <button 
            onClick={() => setActiveTab('branches')}
            className={`w-full text-left flex items-center gap-2 text-xs font-extrabold py-2.5 px-3.5 rounded-xl transition-all whitespace-nowrap ${activeTab === 'branches' ? 'glass-btn-primary text-white shadow-xs' : 'text-slate-700 hover:bg-white/40'}`}
          >
            <Store className="w-4 h-4" />
            <span>{isRTL ? 'تخصيص الفروع والتوفر' : 'Branch Policies'}</span>
          </button>

          <button 
            onClick={() => setActiveTab('reports')}
            className={`w-full text-left flex items-center gap-2 text-xs font-extrabold py-2.5 px-3.5 rounded-xl transition-all whitespace-nowrap ${activeTab === 'reports' ? 'glass-btn-primary text-white shadow-xs' : 'text-slate-700 hover:bg-white/40'}`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{isRTL ? 'التقارير والتحليلات المالية' : 'Financial Reports'}</span>
          </button>

          <button 
            onClick={() => setActiveTab('settings')}
            className={`w-full text-left flex items-center gap-2 text-xs font-extrabold py-2.5 px-3.5 rounded-xl transition-all whitespace-nowrap ${activeTab === 'settings' ? 'glass-btn-primary text-white shadow-xs' : 'text-slate-700 hover:bg-white/40'}`}
          >
            <Settings className="w-4 h-4" />
            <span>{isRTL ? 'الربط السحابي والإعدادات' : 'Integrations & Settings'}</span>
          </button>
        </div>

        {/* Dynamic Tab Viewport container */}
        <div className="flex-1 p-4 overflow-y-auto">
          
          {/* TAB 1: SALES OVERVIEW & KPIs */}
          {activeTab === 'stats' && <StatsPanel />}

          {/* TAB 2: LIVE ORDERS STEAM */}
          {activeTab === 'orders' && <LiveOrdersPanel />}

          {/* TAB 3: MENU & CONTENT MANAGEMENT (PHASE 8 NEW FEATURE) */}
          {activeTab === 'menu' && <MenuManagementPanel />}

          {/* TAB 4: BRANCH MANAGEMENT & CUSTOM AVAILABILITY MATRIX */}
          {activeTab === 'branches' && <BranchPoliciesPanel />}

          {/* TAB 5: FINANCIAL REPORTS & ANALYTICS (PHASE 9) */}
          {activeTab === 'reports' && <ReportsPanel />}

          {/* TAB 6: INTEGRATIONS & SETTINGS (PHASE 10) */}
          {activeTab === 'settings' && <SettingsPanel />}
        </div>
      </div>



    </div>
  );
};
