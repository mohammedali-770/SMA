import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ObservabilityErrorBoundary} from './components/ObservabilityErrorBoundary.tsx';
import {initAdminObservability} from './lib/observability/index.ts';
import './index.css';

// Sentry (surface 'admin-web') initializes before the first render so bootstrap
// failures are captured. Disabled in tests and in dev without VITE_SENTRY_DEV=1;
// never throws. See docs/SENTRY_WEB_OBSERVABILITY.md.
initAdminObservability();

if (import.meta.env.DEV) {
  // Dev-only verification hooks (window.__spicySentryTest). The dynamic import
  // keeps the module out of production bundles entirely.
  void import('./lib/observability/devTest.ts').then(m => m.registerDevSentryTest());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ObservabilityErrorBoundary>
      <App />
    </ObservabilityErrorBoundary>
  </StrictMode>,
);
