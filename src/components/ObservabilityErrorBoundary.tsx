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
      <div className="min-h-screen flex flex-col items-center justify-center gap-2 p-8 text-center font-sans bg-slate-50">
        <h1 className="text-base font-black text-slate-800">Something unexpected went wrong</h1>
        <p className="text-sm font-bold text-slate-700" dir="rtl" lang="ar">حدث خطأ غير متوقع</p>
        <p className="text-xs text-slate-500">
          Our team has been notified automatically — no data was lost.
        </p>
        <p className="text-xs text-slate-500" dir="rtl" lang="ar">
          تم إشعار فريقنا تلقائيًا — لم تُفقد أي بيانات.
        </p>
        <button
          type="button"
          onClick={this.retry}
          className="mt-4 bg-slate-800 text-white text-xs font-black py-2.5 px-6 rounded-xl hover:bg-slate-700 transition-colors"
        >
          Try again · إعادة المحاولة
        </button>
      </div>
    );
  }
}
