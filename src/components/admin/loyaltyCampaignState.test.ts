import { describe, expect, it } from 'vitest';

import { campaignState, scopeLabel } from './LoyaltyCampaignsPanel';

/**
 * The four states an operator can see, and why they are worth a test: "active"
 * in the database does NOT mean "paying out right now". A row can be active and
 * scheduled for next month, or active and finished last week, and an operator
 * who reads either as live will wonder why points are not doubling.
 */
const NOW = new Date('2026-09-15T12:00:00Z');

describe('campaignState', () => {
  it('is live when active and inside an open-ended window', () => {
    expect(campaignState({ is_active: true, starts_at: null, ends_at: null }, NOW)).toBe('live');
  });

  it('is off whenever deactivated, whatever the window says', () => {
    // Checked first on purpose: a stopped campaign that still reads "Live"
    // because its dates look right is the most misleading state of the four.
    expect(
      campaignState(
        { is_active: false, starts_at: '2026-09-01T00:00:00Z', ends_at: '2026-09-30T00:00:00Z' },
        NOW,
      ),
    ).toBe('off');
  });

  it('is scheduled before it starts', () => {
    expect(campaignState({ is_active: true, starts_at: '2026-10-01T00:00:00Z', ends_at: null }, NOW)).toBe(
      'scheduled',
    );
  });

  it('is ended after it finishes', () => {
    expect(campaignState({ is_active: true, starts_at: null, ends_at: '2026-09-01T00:00:00Z' }, NOW)).toBe(
      'ended',
    );
  });

  it('is live on the boundaries, matching the SQL resolver', () => {
    // The resolver uses `>=` and `<=`, so a campaign is live on its own start
    // and end instants. A UI that disagreed would show "Ended" while points were
    // still doubling.
    expect(campaignState({ is_active: true, starts_at: NOW.toISOString(), ends_at: null }, NOW)).toBe('live');
    expect(campaignState({ is_active: true, starts_at: null, ends_at: NOW.toISOString() }, NOW)).toBe('live');
  });
});

/**
 * Scope, which only became reachable from the UI once the form grew the three
 * selects. The list has to distinguish a house-wide campaign from a
 * burgers-only one, or an operator reading two rows called "Double points"
 * cannot tell which is which.
 */
describe('scopeLabel', () => {
  const ctx = {
    branches: [{ id: 'b1', nameEn: 'Olaya', nameAr: 'العليا' }],
    categories: [{ id: 'c1', nameEn: 'Burgers', nameAr: 'برجر' }],
    products: [{ id: 'p1', nameEn: 'Classic', nameAr: 'كلاسيك' }],
    isRTL: false,
  };
  const none = { branch_id: null, category_id: null, product_id: null };

  it('says "Everything" when nothing is narrowed', () => {
    expect(scopeLabel(none, ctx)).toBe('Everything');
  });

  it('names a single narrowing', () => {
    expect(scopeLabel({ ...none, category_id: 'c1' }, ctx)).toBe('Burgers');
  });

  it('lists several narrowings most-specific first', () => {
    expect(scopeLabel({ product_id: 'p1', category_id: 'c1', branch_id: 'b1' }, ctx)).toBe(
      'Classic · Burgers · Olaya',
    );
  });

  it('never renders a bare id, and never reads as "everything", when a target is gone', () => {
    // The dangerous outcome is silence: a narrowed campaign that renders as an
    // empty cell looks house-wide, which is the opposite of what it does.
    expect(scopeLabel({ ...none, product_id: 'deleted-id' }, ctx)).toBe('(deleted)');
  });

  it('uses Arabic names when the console is RTL', () => {
    expect(scopeLabel({ ...none, category_id: 'c1' }, { ...ctx, isRTL: true })).toBe('برجر');
  });
});
