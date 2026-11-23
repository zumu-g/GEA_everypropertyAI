import { describe, it, expect } from 'vitest';
import { DAYS, domBasis, select55Day, selectWithdrawn, dedupeBySlug, priceCutSummary, groupBySuburb } from './listing-reports.mjs';

const NOW = '2026-11-24T02:00:00.000Z';
const SINCE = '2026-11-23T02:00:00.000Z';
const daysBefore = (iso, n) => new Date(Date.parse(iso) - n * 86_400_000).toISOString();
const row = (o = {}) => ({
  address_slug: 'a', raw_address: '1 A St, Berwick VIC 3806', suburb: 'Berwick', source: 'domain-web-unlocker',
  active: true, lifecycle_status: 'active', listed_date: null, campaign_started_at: daysBefore(NOW, 55.5),
  created_at: daysBefore(NOW, 55.5), last_seen_at: NOW, removed_at: null, close_reason: null, ...o,
});

describe('domBasis', () => {
  it('prefers the portal listed date, else first seen (flagged)', () => {
    expect(domBasis(row({ listed_date: '2026-09-01' }))).toEqual({ date: '2026-09-01', firstSeen: false });
    expect(domBasis(row()).firstSeen).toBe(true);
  });
});

describe('select55Day', () => {
  it('A1: one address on three sources crossing day 55 gives one row, latest-seen copy', () => {
    const rows = [
      row({ source: 'rea-apify-one-api', last_seen_at: daysBefore(NOW, 3) }),
      row({ source: 'domain-web-unlocker', last_seen_at: NOW, display_price: '$800k' }),
      row({ source: 'homely', last_seen_at: daysBefore(NOW, 1) }),
    ];
    const out = select55Day(rows, SINCE, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].display_price).toBe('$800k');
    expect(out[0].daysOnMarket).toBe(55);
  });
  it('skips listings that crossed before the window, not yet 55, or are no longer active', () => {
    expect(select55Day([row({ campaign_started_at: daysBefore(NOW, 60) })], SINCE, NOW)).toHaveLength(0);
    expect(select55Day([row({ campaign_started_at: daysBefore(NOW, 54) })], SINCE, NOW)).toHaveLength(0);
    expect(select55Day([row({ active: false })], SINCE, NOW)).toHaveLength(0);
  });
  it('A4: a two-day window catches both days', () => {
    const rows = [row({ address_slug: 'x', campaign_started_at: daysBefore(NOW, 55.5) }), row({ address_slug: 'y', campaign_started_at: daysBefore(NOW, 56.5) })];
    expect(select55Day(rows, daysBefore(NOW, 2), NOW)).toHaveLength(2);
    expect(DAYS).toBe(55);
  });
});

describe('selectWithdrawn', () => {
  const w = (o = {}) => row({ active: false, lifecycle_status: 'withdrawn', close_reason: 'sweep', removed_at: daysBefore(NOW, 0.5), ...o });
  it('lists sweep withdrawals in the window with days on market at withdrawal', () => {
    const out = selectWithdrawn([w({ listed_date: '2026-10-01' })], SINCE, NOW);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].daysOnMarket).toBe(Math.floor((Date.parse(daysBefore(NOW, 0.5)) - Date.parse('2026-10-01')) / 86_400_000));
  });
  it('A2: backstop (stale) closures are counted, never listed; old cleanup rows are ignored', () => {
    const out = selectWithdrawn([w({ close_reason: 'stale' }), w({ close_reason: null }), w({ removed_at: daysBefore(NOW, 3) })], SINCE, NOW);
    expect(out.rows).toHaveLength(0);
    expect(out.staleCount).toBe(1);
  });
  it('A3: a withdrawal later matched to a sale is never listed', () => {
    expect(selectWithdrawn([w({ lifecycle_status: 'sold' })], SINCE, NOW).rows).toHaveLength(0);
  });
  it('drops an address that is still active on another portal', () => {
    expect(selectWithdrawn([w(), row({ source: 'homely' })], SINCE, NOW).rows).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('dedupeBySlug keeps the latest last_seen_at', () => {
    expect(dedupeBySlug([row({ last_seen_at: '2026-01-01', id: 1 }), row({ last_seen_at: '2026-02-01', id: 2 })])[0].id).toBe(2);
  });
  it('priceCutSummary counts cuts and total % from first to latest asking', () => {
    const h = [{ observed_at: '2026-10-01', price_low: 800000, price_high: 800000 }, { observed_at: '2026-10-10', price_low: 760000, price_high: 760000 }, { observed_at: '2026-10-20', price_low: 760000, price_high: 760000 }, { observed_at: '2026-11-01', price_low: 720000, price_high: 720000 }];
    expect(priceCutSummary(h)).toEqual({ cuts: 2, pct: -10 });
    expect(priceCutSummary([])).toEqual({ cuts: 0, pct: null });
  });
  it('groupBySuburb sorts suburbs and rows by address', () => {
    const g = groupBySuburb([row({ suburb: 'Officer', raw_address: '2 B' }), row({ suburb: 'Berwick', raw_address: '9 Z' }), row({ suburb: 'Berwick', raw_address: '1 A' })]);
    expect(g.map(([s]) => s)).toEqual(['Berwick', 'Officer']);
    expect(g[0][1].map((r) => r.raw_address)).toEqual(['1 A', '9 Z']);
  });
});
