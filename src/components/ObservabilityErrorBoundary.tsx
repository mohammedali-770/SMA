/**
 * Root error boundary for the admin/staff console: captures unexpected React
 * render errors to Sentry (surface 'admin-web') and shows a minimal bilingual
 * fallback instead of a blank screen.
 *
 * Deliberate properties (mirrors the mobile boundary contract):
 *  - captures the FIRST error per failure only (no capture loops; the shared
 *    shouldCaptureBoundaryError guard lives in webCore); retry resets it;
 *  - never shows a stack trace or technical details;
 *  - static EN + AR copy with correct LTR/RTL direction per line, rendered
 *    outside every provider so a crash during app bootstrap still produces a
 *    readable screen;
 *  - zero customer or admin data in the captured event (sanitized component
 *    stack only).
 */
import React from 'react';

import { captureWebRenderError } from '../lib/observability';

interface Props { children: React.ReactNode }
interface State { hasError: boolean }

export class ObservabilityErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };
  private captured = false;

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }): void {
    if (captureWebRenderError(error, info.componentStack, this.captured)) {
      this.captured = true;
    }
  }

  private retry = (): void => {
    this.captured = false;
    this.setState({ hasError: false });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      // Design-system TOKENS, but not design-system COMPONENTS. This renders
      // after something has already thrown, so it must not depend on a hook,
      // a context or an import that could throw again on the way to showing
      // the message.
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-con-bg p-8 text-center font-sans">
        <h1 className="text-base font-bold text-con-text">Something unexpected went wrong</h1>
        <p className="text-sm font-semibold text-con-text-2" dir="rtl" lang="ar">حدث خطأ غير متوقع</p>
        <p className="text-xs text-con-text-2">
          Our team has been notified automatically — no data was lost.
        </p>
        <p className="text-xs text-con-text-2" dir="rtl" lang="ar">
          تم إشعار فريقنا تلقائيًا — لم تُفقد أي بيانات.
        </p>
        <button
          type="button"
          onClick={this.retry}
          className="ds-motion mt-4 rounded-[var(--radius-ds-md)] bg-ember px-6 py-2.5 text-xs font-bold text-on-ember transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Try again · إعادة المحاولة
        </button>
      </div>
    );
  }
}
