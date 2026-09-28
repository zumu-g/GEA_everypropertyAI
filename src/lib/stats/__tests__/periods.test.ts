import { describe, it, expect } from 'vitest';
import { resolvePeriod, melbourneDate, melbourneStartOfDay, addDays } from '../periods';

describe('resolvePeriod', () => {
  it('month containing 2026-08-15 is 1–31 August, prior July, year-ago Aug 2025', () => {
    const p = resolvePeriod('month', '2026-08-15');
    expect(p).toEqual({
      start: '2026-08-01', end: '2026-08-31',
      priorStart: '2026-07-01', priorEnd: '2026-07-31',
      yearAgoStart: '2025-08-01', yearAgoEnd: '2025-08-31',
    });
  });

  it('week containing a Sunday resolves to the Monday-start ISO week', () => {
    // 2026-08-16 is a Sunday
    const p = resolvePeriod('week', '2026-08-16');
    expect(p.start).toBe('2026-08-10');
    expect(p.end).toBe('2026-08-16');
    expect(p.priorStart).toBe('2026-08-03');
    expect(p.priorEnd).toBe('2026-08-09');
    expect(p.yearAgoStart).toBe('2025-08-11'); // 52 weeks earlier, still a Monday
    expect(p.yearAgoEnd).toBe('2025-08-17');
  });

  it('crosses the year boundary for prior and year-ago', () => {
    const m = resolvePeriod('month', '2026-01-10');
    expect(m.priorStart).toBe('2025-12-01');
    expect(m.priorEnd).toBe('2025-12-31');
    expect(m.yearAgoStart).toBe('2025-01-01');
    expect(m.yearAgoEnd).toBe('2025-01-31');
    const w = resolvePeriod('week', '2026-01-01'); // Thursday
    expect(w.start).toBe('2025-12-29');
    expect(w.end).toBe('2026-01-04');
  });
});

describe('Melbourne time helpers', () => {
  it('melbourneDate rolls the calendar day at Melbourne midnight, not UTC', () => {
    // 2026-08-15T15:00Z is 01:00 on 16 Aug in Melbourne (AEST, +10)
    expect(melbourneDate(new Date('2026-08-15T15:00:00Z'))).toBe('2026-08-16');
    // 2026-01-15T12:30Z is 23:30 on 15 Jan AEDT (+11)
    expect(melbourneDate(new Date('2026-01-15T12:30:00Z'))).toBe('2026-01-15');
  });

  it('melbourneStartOfDay honours DST', () => {
    expect(melbourneStartOfDay('2026-08-01').toISOString()).toBe('2026-07-31T14:00:00.000Z'); // AEST
    expect(melbourneStartOfDay('2026-01-01').toISOString()).toBe('2025-12-31T13:00:00.000Z'); // AEDT
  });

  it('addDays is plain calendar arithmetic', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});
