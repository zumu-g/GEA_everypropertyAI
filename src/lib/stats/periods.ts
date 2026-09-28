/**
 * Week and month period bounds in Australia/Melbourne time. Dates are plain
 * ISO calendar dates ('YYYY-MM-DD'); start and end are both inclusive. Weeks are
 * ISO weeks (Monday start); months are calendar months. No date library — the
 * day arithmetic is done on UTC Dates (which have no DST) and the only zone-aware
 * step is converting a Melbourne calendar day to an instant.
 */

export type PeriodType = 'week' | 'month';

export interface PeriodBounds {
  start: string;
  end: string;
  priorStart: string;
  priorEnd: string;
  yearAgoStart: string;
  yearAgoEnd: string;
}

export const MELBOURNE_TZ = 'Australia/Melbourne';

const DAY_MS = 86_400_000;

function toUtcDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromUtcDate(new Date(toUtcDate(iso).getTime() + days * DAY_MS));
}

function addMonths(iso: string, months: number): string {
  const d = toUtcDate(iso);
  return fromUtcDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)));
}

function monthEnd(monthStartIso: string): string {
  return addDays(addMonths(monthStartIso, 1), -1);
}

/** Melbourne calendar date for an instant. */
export function melbourneDate(at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MELBOURNE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}

/** UTC offset (minutes) Melbourne is at for a given instant. */
function melbourneOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MELBOURNE_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Instant at which the given Melbourne calendar day begins (00:00 local). */
export function melbourneStartOfDay(iso: string): Date {
  const guess = toUtcDate(iso).getTime();
  // Melbourne DST switches at 02:00/03:00, never at midnight, so one correction is exact.
  const offset = melbourneOffsetMinutes(new Date(guess - 10 * 60 * 60_000));
  return new Date(guess - offset * 60_000);
}

/** Exclusive end instant: start of the day after `endIso`. */
export function melbourneEndExclusive(endIso: string): Date {
  return melbourneStartOfDay(addDays(endIso, 1));
}

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fromUtcDate(toUtcDate(s)) === s;
}

export function resolvePeriod(period: PeriodType, asOf: string): PeriodBounds {
  if (period === 'month') {
    const start = asOf.slice(0, 7) + '-01';
    const priorStart = addMonths(start, -1);
    const yearAgoStart = addMonths(start, -12);
    return {
      start, end: monthEnd(start),
      priorStart, priorEnd: monthEnd(priorStart),
      yearAgoStart, yearAgoEnd: monthEnd(yearAgoStart),
    };
  }
  const dow = toUtcDate(asOf).getUTCDay(); // 0 = Sunday
  const start = addDays(asOf, -((dow + 6) % 7));
  const priorStart = addDays(start, -7);
  const yearAgoStart = addDays(start, -364); // 52 weeks: same weekday
  return {
    start, end: addDays(start, 6),
    priorStart, priorEnd: addDays(priorStart, 6),
    yearAgoStart, yearAgoEnd: addDays(yearAgoStart, 6),
  };
}
