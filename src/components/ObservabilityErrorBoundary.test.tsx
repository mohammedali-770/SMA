// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureWebRenderError = vi.fn(
  (_error: unknown, _stack: string | null | undefined, alreadyCaptured: boolean) => !alreadyCaptured,
);

vi.mock('../lib/observability', () => ({
  captureWebRenderError: (
    error: unknown, stack: string | null | undefined, alreadyCaptured: boolean,
  ) => captureWebRenderError(error, stack, alreadyCaptured),
}));

import { ObservabilityErrorBoundary } from './ObservabilityErrorBoundary';

const BOOM_MESSAGE = 'boundary-test: secret-free crash';

function Boom(): React.ReactElement {
  throw new Error(BOOM_MESSAGE);
}

describe('admin ObservabilityErrorBoundary', () => {
  beforeEach(() => {
    captureWebRenderError.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders children when nothing fails', () => {
    render(
      <ObservabilityErrorBoundary>
        <p>dashboard content</p>
      </ObservabilityErrorBoundary>,
    );
    expect(screen.getByText('dashboard content')).toBeTruthy();
    expect(captureWebRenderError).not.toHaveBeenCalled();
  });

  it('captures a render error once and shows the bilingual fallback', () => {
    render(
      <ObservabilityErrorBoundary>
        <Boom />
      </ObservabilityErrorBoundary>,
    );
    expect(screen.getByText('Something unexpected went wrong')).toBeTruthy();
    expect(screen.getByText('حدث خطأ غير متوقع')).toBeTruthy();
    expect(screen.getByRole('button')).toBeTruthy();
    // Capture-once contract: passes the not-yet-captured flag on first hit.
    expect(captureWebRenderError).toHaveBeenCalled();
    expect(captureWebRenderError.mock.calls[0][2]).toBe(false);
  });

  it('never shows the error message, stack, or technical details to the user', () => {
    const { container } = render(
      <ObservabilityErrorBoundary>
        <Boom />
      </ObservabilityErrorBoundary>,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain(BOOM_MESSAGE);
    expect(text.toLowerCase()).not.toContain('stack');
    expect(text).not.toContain('Error:');
  });

  it('the AR lines are RTL and the boundary offers a retry action', () => {
    render(
      <ObservabilityErrorBoundary>
        <Boom />
      </ObservabilityErrorBoundary>,
    );
    const ar = screen.getByText('حدث خطأ غير متوقع');
    expect(ar.getAttribute('dir')).toBe('rtl');
    expect(screen.getByRole('button').textContent).toContain('Try again');
  });
});
