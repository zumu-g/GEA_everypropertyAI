import { describe, it, expect } from 'vitest';
import { classifyFreshness, anyUnhealthy, FEED_SLA_HOURS } from '../freshness';

const NOW = Date.parse('2026-06-06T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe('classifyFreshness', () => {
  it('marks a sold feed fresh when newest row is within 36h', () => {
    const f = classifyFreshness('sold', hoursAgo(10), NOW);
    expect(f.status).toBe('fresh');
    expect(f.ageHours).toBeCloseTo(10, 5);
  });

  it('marks a sold feed stale when newest row is older than 36h', () => {
    expect(classifyFreshness('sold', hoursAgo(48), NOW).status).toBe('stale');
  });

  it('uses the 8-day window for rent', () => {
    expect(FEED_SLA_HOURS.rent).toBe(192);
    expect(classifyFreshness('rent', hoursAgo(120), NOW).status).toBe('fresh'); // 5 days
    expect(classifyFreshness('rent', hoursAgo(200), NOW).status).toBe('stale'); // ~8.3 days
  });

  it('boundary: exactly at the SLA is fresh, just past is stale', () => {
    expect(classifyFreshness('on-market', hoursAgo(36), NOW).status).toBe('fresh');
    expect(classifyFreshness('on-market', hoursAgo(36.5), NOW).status).toBe('stale');
  });

  it('returns no-data for null or unparseable timestamps', () => {
    expect(classifyFreshness('sold', null, NOW).status).toBe('no-data');
    expect(classifyFreshness('sold', 'not-a-date', NOW).status).toBe('no-data');
  });
});

describe('anyUnhealthy', () => {
  it('is true when any feed is stale or no-data, false when all fresh', () => {
    const fresh = classifyFreshness('sold', hoursAgo(1), NOW);
    const stale = classifyFreshness('on-market', hoursAgo(99), NOW);
    const none = classifyFreshness('rent', null, NOW);
    expect(anyUnhealthy([fresh])).toBe(false);
    expect(anyUnhealthy([fresh, stale])).toBe(true);
    expect(anyUnhealthy([fresh, none])).toBe(true);
  });
});
