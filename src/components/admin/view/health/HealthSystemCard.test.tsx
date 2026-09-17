// @vitest-environment jsdom
/**
 * The `branch_availability` card's METRIC SET.
 *
 * WHY THIS FILE EXISTS. `20260925120000_health_card_variant_coverage.sql` added
 * `closed_sizes` to the snapshot payload, and the card was not updated to render
 * it. Nothing failed: `numberValue` returns 0 for a key it cannot find, so the
 * card did not show a gap — it showed a confident **zero**. A branch with a size
 * closed read "Closed items 0 / Closed options 0", which is the card stating
 * that nothing is closed while something is. Caught in review on #394.
 *
 * That is the same defect the migration itself exists to fix, one layer up. The
 * snapshot enumerated availability TABLES by name and went blind to a new one;
 * this card enumerates METRICS by name and went blind to a new one. So the guard
 * belongs here rather than in the migration: assert the whole set, so the next
 * counter added to the payload and forgotten here fails a test instead of
 * quietly reading 0.
 *
 * Deliberately asserts VALUES, not merely labels. A test that only checked the
 * label would pass against a card wired to the wrong key — which is precisely
 * the failure mode being guarded.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

import { HealthSystemCard } from './HealthSystemCard';
import type { OperationsHealthSystem } from '../../../../lib/operationsHealthApi';

const system = (details: Record<string, unknown>): OperationsHealthSystem => ({
  id: 'branch_availability',
  critical: false,
  state: 'degraded',
  source: 'branch_availability_runs',
  details,
});

/** The shape `operations_health_snapshot_internal` returns after 20260925120000. */
const FULL = {
  closed_products: 3,
  closed_sizes: 7,
  closed_options: 5,
  overdue_restores: 2,
  worst_overdue_minutes: 11,
  untimed_closures: 4,
  paused_branches: 0,
  disabled_areas: 0,
};

describe('branch_availability health card', () => {
  afterEach(() => cleanup());

  it('renders all four closure counters, each bound to its own key', () => {
    render(<HealthSystemCard system={system(FULL)} lang="en" />);
    for (const [label, value] of [
      ['Closed items', '3'],
      ['Closed sizes', '7'],
      ['Closed options', '5'],
      ['Overdue restores', '2'],
    ] as const) {
      const node = screen.getByText(label);
      expect(node, `${label} is missing from the card`).toBeTruthy();
      // The metric's value sits beside its label; assert the pair, so a metric
      // wired to the wrong payload key fails here rather than reading plausibly.
      expect(node.parentElement?.textContent, `${label} is bound to the wrong key`).toContain(value);
    }
  });

  it('a closed SIZE is visible — the exact case that read as "nothing closed"', () => {
    render(
      <HealthSystemCard
        system={system({ ...FULL, closed_products: 0, closed_options: 0, closed_sizes: 6 })}
        lang="en"
      />,
    );
    expect(screen.getByText('Closed sizes').parentElement?.textContent).toContain('6');
  });

  it('reads 0 rather than breaking before the migration is applied', () => {
    // `closed_sizes` is absent from the payload until 20260925120000 lands. That
    // must render a truthful zero, not blank and not NaN: no size can be closed
    // until the table exists and the operator controls ship.
    const { closed_sizes: _omitted, ...preMigration } = FULL;
    render(<HealthSystemCard system={system(preMigration)} lang="en" />);
    expect(screen.getByText('Closed sizes').parentElement?.textContent).toContain('0');
  });

  it('names sizes in the card description, in both languages', () => {
    render(<HealthSystemCard system={system(FULL)} lang="en" />);
    expect(screen.getByText(/timed item, size, option and delivery closures/)).toBeTruthy();
    cleanup();
    render(<HealthSystemCard system={system(FULL)} lang="ar" />);
    expect(screen.getByText(/الأحجام/)).toBeTruthy();
  });
});
