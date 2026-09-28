import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const computeAndPersist = vi.fn(async () => ({ block: {}, provisional: false, reconstructed: false, computedAt: '' }));
vi.mock('@/lib/stats/suburb-stats', () => ({ computeAndPersist, SETTLE_DAYS: 60 }));
vi.mock('@/lib/utils/service-area', () => ({ SERVICE_AREA_SUBURBS: ['Berwick', 'Officer', 'Pakenham', 'Clyde'] }));

async function call(secret?: string, headers: Record<string, string> = {}) {
  vi.resetModules();
  if (secret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = secret;
  const { GET } = await import('../cron/suburb-stats/route');
  const res = await GET(new NextRequest(new URL('/api/cron/suburb-stats', 'http://localhost:3000'), { headers }));
  return { res, body: await res.json() };
}

describe('GET /api/cron/suburb-stats auth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a missing or wrong secret when CRON_SECRET is set', async () => {
    expect((await call('s3cret')).res.status).toBe(401);
    expect((await call('s3cret', { authorization: 'Bearer nope' })).res.status).toBe(401);
    expect(computeAndPersist).not.toHaveBeenCalled();
    expect((await call('s3cret', { authorization: 'Bearer s3cret' })).res.status).toBe(200);
  });

  it('allows when CRON_SECRET is unset (dev convention)', async () => {
    expect((await call(undefined)).res.status).toBe(200);
  });
});

describe('freeze window', () => {
  beforeEach(() => vi.clearAllMocks());

  it('freezes only periods whose settle date passed in the last two days', async () => {
    // Melbourne date 2026-10-02 (AEST). Settled ends: 2026-08-02 (today-61) and 2026-08-01 (today-62).
    // 2026-08-01 is a Saturday and a month end is 2026-07-31 (today-63): outside the window.
    vi.useFakeTimers({ now: new Date('2026-10-01T15:41:00Z'), toFake: ['Date'] });
    try {
      const { body } = await call(undefined);
      expect(body).toMatchObject({ suburbs: 4, periodsFrozen: 4, skipped: 0, errors: [] });
      // Only 2026-08-02 (Sunday) closes an ISO week; no month ends on either day.
      const calls = computeAndPersist.mock.calls as unknown as [string, string, string, string, string][];
      expect(calls).toHaveLength(4);
      for (const c of calls) expect(c.slice(1, 5)).toEqual(['VIC', 'week', '2026-07-27', '2026-08-02']);
      expect(calls.map((c) => c[0]).sort()).toEqual(['Berwick', 'Clyde', 'Officer', 'Pakenham']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('catches a missed night: month end 2026-08-31 is frozen on both 2026-10-31 and 2026-11-01', async () => {
    for (const nowIso of ['2026-10-30T15:41:00Z', '2026-10-31T15:41:00Z']) { // 02:41 AEDT 31 Oct / 1 Nov
      vi.clearAllMocks();
      vi.useFakeTimers({ now: new Date(nowIso), toFake: ['Date'] });
      try {
        await call(undefined);
        const months = computeAndPersist.mock.calls.filter((c) => (c as unknown as string[])[2] === 'month');
        expect(months.map((c) => (c as unknown as string[])[4])).toEqual(['2026-08-31', '2026-08-31', '2026-08-31', '2026-08-31']);
      } finally {
        vi.useRealTimers();
      }
    }
  });

  it('collects a single-suburb failure and continues', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-01T15:41:00Z'), toFake: ['Date'] });
    try {
      computeAndPersist.mockImplementationOnce(async () => { throw new Error('boom'); });
      const { res, body } = await call(undefined);
      expect(res.status).toBe(200);
      expect(body.periodsFrozen).toBe(3);
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0]).toMatch(/boom/);
    } finally {
      vi.useRealTimers();
    }
  });
});
