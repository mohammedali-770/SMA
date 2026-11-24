// @vitest-environment jsdom
/**
 * The summary card must say WHY it is red. `overall_state` is 'failing' as soon
 * as one order is stranded, even with no open incident row, and the card used
 * to show `failing` over `Open Critical 0` with nothing to explain it
 * (F-X11-004).
 */
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { IntegritySummary } from './IntegritySummary';

afterEach(cleanup);

describe('IntegritySummary stranded orders', () => {
  it('shows the stranded counts and the age of the oldest when orders are stranded', () => {
    render(
      <IntegritySummary
        health={{
          overall_state: 'failing',
          open_critical_count: 0,
          stranded_order_count: 3,
          stranded_dead_letter_count: 2,
          stranded_missing_mapping_count: 1,
          oldest_stranded_order_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
        }}
      />,
    );
    const line = screen.getByText(/stranded orders 3/);
    expect(line.textContent).toContain('dead-letter 2');
    expect(line.textContent).toContain('missing mapping 1');
    expect(line.textContent).toContain('oldest 3h');
  });

  it('says zero when the server reports none stranded', () => {
    render(<IntegritySummary health={{ overall_state: 'healthy', stranded_order_count: 0 }} />);
    expect(screen.getByText('stranded orders 0')).toBeTruthy();
  });

  it('shows no line, not a reassuring zero, when the server does not return the field', () => {
    render(<IntegritySummary health={{ overall_state: 'failing', open_critical_count: 0 }} />);
    expect(screen.queryByText(/stranded orders/)).toBeNull();
  });
});
