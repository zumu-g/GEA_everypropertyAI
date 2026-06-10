import { describe, it, expect } from 'vitest';
import {
  monthsSince,
  timeAdjust,
  indexLevelAt,
  indexMultiplier,
  timeAdjustToToday,
  type IndexPoint,
  MIN_INDEX_POINTS,
} from '../time-adjust';

const NOW = new Date('2026-06-15T00:00:00Z');

/** Build a monthly series ending at NOW, `n` points, linear from `start` to `end`. */
function series(n: number, start: number, end: number): IndexPoint[] {
  const out: IndexPoint[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(NOW.getFullYear(), NOW.getMonth() - (n - 1 - i), 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const value = start + ((end - start) * i) / (n - 1);
    out.push({ month, value });
  }
  return out;
}

describe('indexLevelAt', () => {
  it('returns the nearest-in-time level', () => {
    const s = series(12, 600_000, 720_000);
    expect(indexLevelAt(s, '2026-06')).toBe(720_000); // latest
    expect(indexLevelAt(s, '2025-07')).toBe(600_000); // earliest
  });

  it('clamps to series ends for out-of-range months (no extrapolation)', () => {
    const s = series(12, 600_000, 720_000);
    expect(indexLevelAt(s, '2020-01')).toBe(600_000); // before start → earliest
    expect(indexLevelAt(s, '2030-01')).toBe(720_000); // after end → latest
  });

  it('returns null for an empty series', () => {
    expect(indexLevelAt([], '2026-06')).toBeNull();
  });
});

describe('indexMultiplier', () => {
  it('rising suburb yields a >1 multiplier (sale 12mo ago)', () => {
    const s = series(13, 600_000, 720_000); // +20% over 12 months
    const m = indexMultiplier(s, '2025-06', NOW)!;
    expect(m).toBeGreaterThan(1.15);
    expect(m).toBeLessThan(1.25);
  });

  it('flat suburb yields ~1', () => {
    const s = series(13, 700_000, 700_000);
    expect(indexMultiplier(s, '2025-06', NOW)).toBeCloseTo(1, 5);
  });

  it('returns null when the series is too thin to trust', () => {
    expect(indexMultiplier(series(MIN_INDEX_POINTS - 1, 600_000, 700_000), '2025-06', NOW)).toBeNull();
  });

  it('returns null for a null series', () => {
    expect(indexMultiplier(null, '2025-06', NOW)).toBeNull();
  });

  it('clamps a wild ratio rather than returning it', () => {
    // A 20x jump in the series would imply a 20x multiplier; clamp caps it.
    const s = series(13, 50_000, 1_000_000);
    expect(indexMultiplier(s, '2025-06', NOW)).toBeLessThanOrEqual(3.0);
  });
});

describe('timeAdjustToToday', () => {
  it('uses the index multiplier when a usable series is supplied (rising)', () => {
    const s = series(13, 600_000, 720_000);
    const adjusted = timeAdjustToToday(800_000, '2025-06', s, 0, NOW);
    expect(adjusted).toBeGreaterThan(900_000); // ~ +20%
    expect(adjusted).toBeLessThan(1_000_000);
  });

  it('does NOT meaningfully move a near-current sale (within the same month)', () => {
    const s = series(13, 600_000, 720_000);
    // Sale this month → level_now / level_now ≈ 1.
    expect(timeAdjustToToday(800_000, '2026-06', s, 0, NOW)).toBeCloseTo(800_000, -3);
  });

  it('falls back to constant-growth compounding when no series', () => {
    const monthlyGrowth = 0.06 / 12; // 6% p.a.
    const viaFallback = timeAdjustToToday(800_000, '2025-06', null, monthlyGrowth, NOW);
    const direct = timeAdjust(800_000, monthsSince('2025-06', NOW), monthlyGrowth);
    expect(viaFallback).toBe(direct);
    expect(viaFallback).toBeGreaterThan(800_000);
  });

  it('falls back to constant-growth when the series is too thin', () => {
    const monthlyGrowth = 0.06 / 12;
    const thin = series(3, 600_000, 700_000);
    const viaFallback = timeAdjustToToday(800_000, '2025-06', thin, monthlyGrowth, NOW);
    expect(viaFallback).toBe(timeAdjust(800_000, monthsSince('2025-06', NOW), monthlyGrowth));
  });

  it('handles a malformed sale date without divide-by-zero or negatives', () => {
    const s = series(13, 600_000, 720_000);
    const adjusted = timeAdjustToToday(800_000, 'not-a-date', s, 0, NOW);
    expect(adjusted).toBeGreaterThan(0);
    expect(Number.isFinite(adjusted)).toBe(true);
  });
});
