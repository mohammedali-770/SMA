/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';

import { Notice } from '../design-system/ui/Notice';
import { AdminHeader } from './admin/view/AdminHeader';
import { AdminSidebar } from './admin/view/AdminSidebar';
import { NewOrderAlertBar } from './admin/view/NewOrderAlertBar';
import { parseTabFromHash, tabToHash, type AdminTab } from './admin/view/adminNav';
import { useApp } from '../context/AppContext';
import { useOnline } from '../lib/useOnline';
import { orderIntegrity } from '../lib/api';
import { operationsHealth } from '../lib/operationsHealthApi';
import { operationsAlerts } from '../lib/operationsAlertsApi';
import { WatchdogCapability, watchdogTabVisible } from '../lib/orderIntegrityCapability';
import {
  OperationsHealthCapability, deriveHealthBadge, operationsHealthTabVisible,
} from '../lib/operationsHealthCapability';
import type { OperationsHealthSummary } from '../lib/operationsHealthApi';
import { OperationsAlertsCapability, operationsAlertsTabVisible } from '../lib/operationsAlertsCapability';
import { canTriageRole } from '../lib/orderIntegrityTriage';
import { ADMIN_LOCALES } from './admin/adminLocales';
import { ReportsPanel } from './admin/ReportsPanel';
import { SettingsPanel } from './admin/SettingsPanel';
import { IntegrationsPanel } from './admin/IntegrationsPanel';
import { BannerManagementPanel } from './admin/BannerManagementPanel';
import { LegalDocumentsPanel } from './admin/LegalDocumentsPanel';
import { StatsPanel } from './admin/StatsPanel';
import { BranchPoliciesPanel } from './admin/BranchPoliciesPanel';
import { LiveOrdersPanel } from './admin/LiveOrdersPanel';
import { MenuManagementPanel } from './admin/MenuManagementPanel';
import { OrderIntegrityPanel } from './admin/OrderIntegrityPanel';
import { OperationsHealthPanel } from './admin/OperationsHealthPanel';
import { OperationsAlertsPanel } from './admin/OperationsAlertsPanel';


export const AdminDashboard: React.FC = () => {
  const {
    orders, currentUser,
    adminLang, setAdminLang, newOrderAlert, setNewOrderAlert,
    playNotificationSound, soundMuted, setSoundMuted,
    ordersLiveMode, ordersLastUpdated,
  } = useApp();

  // Seeded from the URL hash so a refresh, a crash-recovery remount or signing
  // back in returns to the tab the operator was on — previously every one of
  // those dropped them on Stats, including mid-rush from Live Orders. Lazy
  // initialiser: the hash is read once, not on every render.
  const [activeTab, setActiveTab] = useState<AdminTab>(
    () => parseTabFromHash(typeof window === 'undefined' ? null : window.location.hash) ?? 'stats',
  );

  // Keep the hash in step with the tab, and follow Back/Forward. replaceState
  // rather than pushState: each tab click should not become a history entry the
  // operator has to click Back through, but the address stays linkable and
  // survives a reload.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const want = tabToHash(activeTab);
    if (window.location.hash !== want) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${want}`);
    }
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHashChange = () => {
      const next = parseTabFromHash(window.location.hash);
      // Ignore an unrecognised hash rather than resetting the console: it may be
      // a stale bookmark or a hand-edited URL, and silently jumping to Stats
      // mid-task is worse than staying put.
      if (next) setActiveTab(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const online = useOnline();
  const isAccountant = currentUser.role === 'accountant';
  const canTriage = canTriageRole(currentUser.role);

  // Capability-gate the Order Integrity tab: it must stay hidden until the
  // watchdog migration/RPCs exist (the web app may deploy before the Production
  // migration is applied). Only a CONFIRMED missing function hides it; network/
  // auth errors keep it visible so they surface in the panel. Re-probes on mount,
  // so a post-migration refresh reveals the tab automatically (no hard-coded flag).
  const [watchdogCap, setWatchdogCap] = useState<WatchdogCapability | 'loading'>('loading');
  useEffect(() => {
    let alive = true;
    orderIntegrity.probeAvailability()
      .then((cap) => { if (alive) setWatchdogCap(cap); })
      .catch(() => { if (alive) setWatchdogCap('unknown'); });
    return () => { alive = false; };
  }, []);
  const watchdogVisible = watchdogTabVisible(watchdogCap);

  // The UI can deploy before the Operations Health Center migration is applied.
  // Hide the tab only for a confirmed missing RPC. Network/auth/dependency errors
  // stay visible so operators receive a truthful, fail-visible error state.
  const [healthCap, setHealthCap] = useState<OperationsHealthCapability | 'loading'>('loading');
  // The probe fetches a full summary and used to discard it. It now returns the
  // payload as well, which is what lets the sidebar show operational trouble to
  // an operator who is looking at some OTHER tab — previously the only way to
  // learn the platform was unhealthy was to go and open the health tab.
  const [healthSummary, setHealthSummary] = useState<OperationsHealthSummary | null>(null);
  useEffect(() => {
    let alive = true;
    operationsHealth.probeAvailability()
      .then((probe) => {
        if (!alive) return;
        setHealthCap(probe.capability);
        setHealthSummary(probe.summary);
      })
      .catch(() => { if (alive) setHealthCap('unknown'); });
    return () => { alive = false; };
  }, []);
  const healthVisible = operationsHealthTabVisible(healthCap);

  // Which states earn a badge lives in `deriveHealthBadge`, not here — it is a
  // judgement call and belongs somewhere a test can reach it.
  const healthAlert = deriveHealthBadge(healthSummary, healthVisible);

  // Operations Alerts follows the same fail-visible capability pattern: the tab
  // hides only when the probe confirms its RPC is missing (pre-migration deploy).
  const [alertsCap, setAlertsCap] = useState<OperationsAlertsCapability | 'loading'>('loading');
  useEffect(() => {
    let alive = true;
    operationsAlerts.probeAvailability()
      .then((cap) => { if (alive) setAlertsCap(cap); })
      .catch(() => { if (alive) setAlertsCap('unknown'); });
    return () => { alive = false; };
  }, []);
  const alertsVisible = operationsAlertsTabVisible(alertsCap);

  useEffect(() => {
    if (activeTab === 'health' && !healthVisible && healthCap !== 'loading') {
      setActiveTab('stats');
    }
    if (activeTab === 'alerts' && !alertsVisible && alertsCap !== 'loading') {
      setActiveTab('stats');
    }
    if (activeTab === 'integrity' && !watchdogVisible && watchdogCap !== 'loading') {
      setActiveTab('stats');
    }
  }, [activeTab, healthVisible, healthCap, alertsVisible, alertsCap, watchdogVisible, watchdogCap]);

  // Active-order count drives the sidebar "Live Orders" badge.
  const activeOrdersCount = orders
    .filter(o => o.status !== 'delivered' && o.status !== 'cancelled')
    .length;



  return (
    <div
      className="flex h-full min-h-[700px] flex-1 select-none flex-col overflow-hidden rounded-[var(--radius-ds-lg)] border border-con-line bg-con-bg"
      style={{ direction: isRTL ? 'rtl' : 'ltr' }}
    >
      {newOrderAlert && (
        <NewOrderAlertBar
          message={t.realtime_pulse}
          dismissLabel={t.dismiss}
          onDismiss={() => setNewOrderAlert(false)}
          replayLabel={soundMuted ? undefined : (isRTL ? 'إعادة صوت الرنين' : 'Replay Ring')}
          onReplay={soundMuted ? undefined : () => playNotificationSound()}
        />
      )}

      <AdminHeader
        title={t.dashboard_title}
        subtitle={isRTL
          ? 'نظام التحكم والربط المباشر لفروع سبايسي ميل'
          : 'Real-time synchronization console connected to live Fast-Food branches'}
        roleLabel={t.role}
        roleValue={`${currentUser.fullName ? `${currentUser.fullName.split(' ')[0]} ` : ''}(${currentUser.role})`}
        lang={adminLang}
        onToggleLang={() => setAdminLang(adminLang === 'en' ? 'ar' : 'en')}
        soundMuted={soundMuted}
        onToggleSound={() => setSoundMuted(!soundMuted)}
        soundOnLabel={t.sound_alert_on}
        soundOffLabel={t.sound_alert_off}
        liveMode={ordersLiveMode}
        lastUpdated={ordersLastUpdated}
      />

      {/* Offline: the most useful thing the console can say when the branch wifi
          drops, because a stale order list and a broken app look identical.
          Blocking, not a warning — every number on screen is now untrustworthy,
          and the instruction that matters is "do not reload", since reloading on
          a dead connection trades a stale-but-useful screen for a blank one. */}
      {!online && (
        <Notice
          title={isRTL ? 'لا يوجد اتصال بالإنترنت' : 'No internet connection'}
          action={isRTL
            ? 'ما تراه هنا قد يكون قديماً، ولن تصل الطلبات الجديدة ولن تُحفظ أي تغييرات. لا تُعد تحميل الصفحة — انتظر عودة الاتصال.'
            : 'What you see may be out of date. New orders will not arrive and changes will not save. Do not reload the page — wait for the connection to return.'}
          tone="blocking"
          className="rounded-none border-x-0 border-t-0"
        />
      )}

      {/* Accountant guard: a warning, not an error — the console still works,
          this role simply cannot act on orders. */}
      {isAccountant && (
        <Notice
          title={t.role_accountant_warning}
          tone="warning"
          className="rounded-none border-x-0 border-t-0"
        />
      )}

      {/* `lg` is where the sidebar becomes a column; below it the nav is a
          compact drawer, so the shell stacks. */}
      <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
        <AdminSidebar
          active={activeTab}
          onSelect={setActiveTab}
          visibility={{ health: healthVisible, alerts: alertsVisible, integrity: watchdogVisible }}
          lang={adminLang}
          liveOrderCount={activeOrdersCount}
          healthAlert={healthAlert}
        />

        {/* Dynamic Tab Viewport container.
            `min-w-0` is what stops a wide child (a table, a chart) from forcing
            the whole console to scroll sideways: a flex item defaults to
            min-width:auto and refuses to shrink below its content. */}
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          
          {/* TAB 1: SALES OVERVIEW & KPIs */}
          {activeTab === 'stats' && <StatsPanel />}

          {/* TAB 2: LIVE ORDERS STEAM */}
          {activeTab === 'orders' && <LiveOrdersPanel />}

          {/* TAB 3: MENU & CONTENT MANAGEMENT (PHASE 8 NEW FEATURE) */}
          {activeTab === 'menu' && <MenuManagementPanel />}

          {/* TAB: HOMEPAGE BANNERS (admin marketing banners for the mobile app) */}
          {activeTab === 'banners' && <BannerManagementPanel />}

          {/* TAB 4: BRANCH MANAGEMENT & CUSTOM AVAILABILITY MATRIX */}
          {activeTab === 'branches' && <BranchPoliciesPanel />}

          {/* TAB 5: FINANCIAL REPORTS & ANALYTICS (PHASE 9) */}
          {activeTab === 'reports' && <ReportsPanel />}

          {/* TAB 6: INTEGRATIONS (secure provider slots, grouped) */}
          {activeTab === 'integrations' && <IntegrationsPanel />}

          {/* TAB: OPERATIONS HEALTH CENTER (staff read-only observability).
              Mounted only when the capability probe does not confirm a missing RPC. */}
          {activeTab === 'health' && healthVisible && (
            <OperationsHealthPanel lang={adminLang} onNavigate={(tab) => setActiveTab(tab)} />
          )}

          {/* TAB: OPERATIONS ALERTS + DAILY DIGEST (read-only inbox/digest; admin-only
              dormant settings). External delivery is disabled in this version. */}
          {activeTab === 'alerts' && alertsVisible && (
            <OperationsAlertsPanel lang={adminLang} isAdmin={canTriage} />
          )}

          {/* TAB: ORDER INTEGRITY WATCHDOG (observe-only monitoring; read + ack/suppress).
              Only mounted when the capability probe confirms the RPCs exist, and
              triage controls only for admins (accountants are read-only). */}
          {activeTab === 'integrity' && watchdogVisible && <OrderIntegrityPanel canTriage={canTriage} />}

          {/* TAB 7: SYSTEM SETTINGS (brand, payment methods, maps, loyalty) */}
          {activeTab === 'settings' && <SettingsPanel />}

          {/* TAB: LEGAL DOCUMENTS (admin-editable policies for the mobile app) */}
          {activeTab === 'legal' && <LegalDocumentsPanel />}
        </div>
      </div>



    </div>
  );
};
