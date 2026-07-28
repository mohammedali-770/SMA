import { describe, it, expect } from 'vitest';
import {
  selectLiveCampaigns,
  formatCampaignSummary,
  type LiveCampaignRow,
  type DbCampaign,
} from './campaigns';

const NOW = Date.parse('2026-07-28T12:00:00Z');

const row = (over: Partial<LiveCampaignRow> & { id?: string }): LiveCampaignRow & { id: string } => ({
  id: over.id ?? 'x',
  is_active: over.is_active ?? true,
  code: over.code ?? null,
  starts_at: over.starts_at ?? null,
  ends_at: over.ends_at ?? null,
});

describe('selectLiveCampaigns (mirrors the public RLS)', () => {
  it('no rows -> empty', () => {
    expect(selectLiveCampaigns([], NOW)).toEqual([]);
  });

  it('shows an active, codeless, windowless promo', () => {
    expect(selectLiveCampaigns([row({ id: 'a' })], NOW).map((c) => c.id)).toEqual(['a']);
  });

  it('hides inactive promos', () => {
    const rows = [row({ id: 'on' }), row({ id: 'off', is_active: false })];
    expect(selectLiveCampaigns(rows, NOW).map((c) => c.id)).toEqual(['on']);
  });

  it('hides CODED promos (secret; validated only via the RPC)', () => {
    const rows = [row({ id: 'auto' }), row({ id: 'coded', code: 'SAVE20' })];
    expect(selectLiveCampaigns(rows, NOW).map((c) => c.id)).toEqual(['auto']);
  });

  it('hides future promos (starts_at ahead)', () => {
    const rows = [row({ id: 'live' }), row({ id: 'future', starts_at: '2026-08-01T00:00:00Z' })];
    expect(selectLiveCampaigns(rows, NOW).map((c) => c.id)).toEqual(['live']);
  });

  it('hides expired promos (ends_at behind)', () => {
    const rows = [row({ id: 'live' }), row({ id: 'expired', ends_at: '2026-07-10T00:00:00Z' })];
    expect(selectLiveCampaigns(rows, NOW).map((c) => c.id)).toEqual(['live']);
  });

  it('shows a promo inside its window', () => {
    const rows = [row({ id: 'inwin', starts_at: '2026-07-01T00:00:00Z', ends_at: '2026-07-31T00:00:00Z' })];
    expect(selectLiveCampaigns(rows, NOW).map((c) => c.id)).toEqual(['inwin']);
  });
});

const offer = (over: Partial<Pick<DbCampaign, 'type' | 'value' | 'max_discount_amount'>>) => ({
  type: over.type ?? 'percentage',
  value: over.value ?? 0,
  max_discount_amount: over.max_discount_amount ?? null,
});

describe('formatCampaignSummary (display only)', () => {
  it('percentage without a cap', () => {
    expect(formatCampaignSummary(offer({ type: 'percentage', value: 20 }))).toBe('20% off');
  });
  it('percentage with a cap', () => {
    expect(formatCampaignSummary(offer({ type: 'percentage', value: 50, max_discount_amount: 15 })))
      .toBe('50% off up to 15 SAR');
  });
  it('fixed amount', () => {
    expect(formatCampaignSummary(offer({ type: 'fixed', value: 30 }))).toBe('30 SAR off');
  });
  it('free delivery', () => {
    expect(formatCampaignSummary(offer({ type: 'free_delivery', value: 0 }))).toBe('Free delivery');
  });
  it('Arabic variants', () => {
    expect(formatCampaignSummary(offer({ type: 'free_delivery', value: 0 }), 'ar')).toBe('توصيل مجاني');
    expect(formatCampaignSummary(offer({ type: 'fixed', value: 30 }), 'ar')).toBe('خصم 30 ريال');
    expect(formatCampaignSummary(offer({ type: 'percentage', value: 50, max_discount_amount: 15 }), 'ar'))
      .toBe('خصم 50% حتى 15 ريال');
  });
});
