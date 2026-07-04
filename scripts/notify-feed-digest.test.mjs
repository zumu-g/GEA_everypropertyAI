import { describe, it, expect } from 'vitest';
import { buildDigest } from './notify-feed-digest.mjs';

const NOW = new Date('2026-06-24T01:00:00Z').getTime(); // ~11am AEST
const hoursAgo = (h) => new Date(NOW - h * 3.6e6).toISOString();

describe('buildDigest', () => {
  it('reports ✅ when all expected feeds are ok and fresh', () => {
    const rows = [
      { category: 'sold', status: 'ok', items: 463, source_used: 'domain-web-unlocker', last_run_at: hoursAgo(2.2) },
      { category: 'on-market', status: 'ok', items: 611, source_used: 'homely', last_run_at: hoursAgo(1.9) },
    ];
    const { ok, text } = buildDigest(rows, { now: NOW, expected: ['sold', 'on-market'] });
    expect(ok).toBe(true);
    expect(text).toContain('✅ everypropertyAI feeds OK');
    expect(text).toContain('sold');
    expect(text).toContain('611');
    expect(text).not.toContain('⚠️');
  });

  it('flips to ⚠️ when an expected feed is blocked', () => {
    const rows = [
      { category: 'sold', status: 'blocked', items: 0, source_used: 'domain-web-unlocker', last_run_at: hoursAgo(2) },
      { category: 'on-market', status: 'ok', items: 611, source_used: 'homely', last_run_at: hoursAgo(2) },
    ];
    const { ok, text } = buildDigest(rows, { now: NOW });
    expect(ok).toBe(false);
    expect(text).toContain('⚠️ everypropertyAI feeds need attention');
    expect(text).toContain('sold: blocked');
  });

  it('flips to ⚠️ when an expected feed is stale (ran too long ago)', () => {
    const rows = [
      { category: 'sold', status: 'ok', items: 463, source_used: 'domain-web-unlocker', last_run_at: hoursAgo(30) },
      { category: 'on-market', status: 'ok', items: 611, source_used: 'homely', last_run_at: hoursAgo(2) },
    ];
    const { ok, text } = buildDigest(rows, { now: NOW, freshHours: 26 });
    expect(ok).toBe(false);
    expect(text).toContain('sold: stale');
  });

  it('flags an expected feed that never ran', () => {
    const rows = [
      { category: 'on-market', status: 'ok', items: 611, source_used: 'homely', last_run_at: hoursAgo(2) },
    ];
    const { ok, text } = buildDigest(rows, { now: NOW, expected: ['sold', 'on-market'] });
    expect(ok).toBe(false);
    expect(text).toContain('sold: no run recorded');
    expect(text).toContain('never run');
  });

  it('lists extra (non-expected) feeds without failing the overall status', () => {
    const rows = [
      { category: 'sold', status: 'ok', items: 463, source_used: 'domain-web-unlocker', last_run_at: hoursAgo(2) },
      { category: 'on-market', status: 'ok', items: 611, source_used: 'homely', last_run_at: hoursAgo(2) },
      { category: 'rent', status: 'blocked', items: 0, source_used: 'domain-web-unlocker', last_run_at: hoursAgo(40) },
    ];
    const { ok, text } = buildDigest(rows, { now: NOW, expected: ['sold', 'on-market'] });
    expect(ok).toBe(true); // rent is not expected → does not gate overall status
    expect(text).toContain('rent');
  });

  it('defaults to expecting rent alongside sold/on-market', () => {
    const rows = [
      { category: 'sold', status: 'ok', items: 463, source_used: 'domain-web-unlocker', last_run_at: hoursAgo(2) },
      { category: 'on-market', status: 'ok', items: 611, source_used: 'homely', last_run_at: hoursAgo(2) },
      { category: 'rent', status: 'ok', items: 88, source_used: 'domain-web-unlocker', last_run_at: hoursAgo(2) },
    ];
    const { ok, text } = buildDigest(rows, { now: NOW }); // no `expected` override → uses the default
    expect(ok).toBe(true);
    expect(text).toContain('rent');
    expect(text).not.toContain('⚠️');
  });

  it('flags rent as missing when it never ran, using the default expected set', () => {
    const rows = [
      { category: 'sold', status: 'ok', items: 463, source_used: 'domain-web-unlocker', last_run_at: hoursAgo(2) },
      { category: 'on-market', status: 'ok', items: 611, source_used: 'homely', last_run_at: hoursAgo(2) },
    ];
    const { ok, text } = buildDigest(rows, { now: NOW }); // no rent row at all
    expect(ok).toBe(false);
    expect(text).toContain('rent: no run recorded');
  });

  it('an explicit expected list still overrides the default (env override still wins)', () => {
    const rows = [
      { category: 'sold', status: 'ok', items: 463, source_used: 'domain-web-unlocker', last_run_at: hoursAgo(2) },
    ];
    const { ok } = buildDigest(rows, { now: NOW, expected: ['sold'] }); // no rent expected here
    expect(ok).toBe(true);
  });
});
