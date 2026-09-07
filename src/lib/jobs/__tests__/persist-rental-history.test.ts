import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/queries', () => ({
  insertPropertyRentalHistory: vi.fn(async () => {}),
}));

import { insertPropertyRentalHistory } from '@/lib/db/queries';
import { mapRentalHistoryToRecords, persistRentalHistory } from '@/lib/jobs/persist-rental-history';
import type { MergedPropertyProfile } from '@/types/property';

const SLUG = '12-smith-st-berwick-vic-3806';

function makeProfile(
  rentalHistory: unknown[],
  opts?: {
    omitAddress?: boolean;
    rentalHistoryConfidence?: number;
    rentalHistoryContributedBy?: string[];
    omitRentalHistoryConfidence?: boolean;
  }
): MergedPropertyProfile {
  return {
    data: {
      ...(opts?.omitAddress
        ? {}
        : {
            address: {
              streetNumber: '12',
              streetName: 'Smith',
              streetType: 'St',
              suburb: 'Berwick',
              state: 'VIC',
              postcode: '3806',
              displayAddress: '12 Smith St, Berwick VIC 3806',
            },
          }),
      rentalHistory,
    },
    fieldConfidences: {
      ...(opts?.omitAddress
        ? {}
        : { address: { confidence: 100, contributedBy: ['resolved-address'] } }),
      ...(opts?.omitRentalHistoryConfidence
        ? {}
        : {
            rentalHistory: {
              confidence: opts?.rentalHistoryConfidence ?? 60,
              contributedBy: opts?.rentalHistoryContributedBy ?? ['domain'],
            },
          }),
    },
    overallConfidence: 70,
    sources: [{ name: 'domain', extractedAt: new Date(), hasErrors: false }],
    mergedAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mapRentalHistoryToRecords', () => {
  it('maps entries with full dates and weekly rent to rows', () => {
    const profile = makeProfile([
      { date: '12 Mar 2019', weeklyRent: 450, agency: 'Ray White', agentName: 'Jo Bloggs', bond: 1800, leaseTerm: '12 months' },
      { date: '2015-06-01', weeklyRent: 380 },
    ]);
    const rows = mapRentalHistoryToRecords(profile, SLUG);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.source).toBe('profile-crawl');
      expect(row.address_slug).toBe(SLUG);
      expect(row.raw_address).toBe('12 Smith St, Berwick VIC 3806');
      expect(row.suburb).toBe('Berwick');
      expect(row.state).toBe('VIC');
      expect(row.postcode).toBe('3806');
    }
    expect(rows[0].lease_date).toBe('2019-03-12');
    expect(rows[0].weekly_rent).toBe(450);
    expect(rows[0].agency_name).toBe('Ray White');
    expect(rows[0].agent_name).toBe('Jo Bloggs');
    expect(rows[0].bond).toBe(1800);
    expect(rows[0].lease_term).toBe('12 months');
    expect(rows[1].lease_date).toBe('2015-06-01');
    expect(rows[1].bond).toBeUndefined();
  });

  it('skips entry with rent but no date', () => {
    const rows = mapRentalHistoryToRecords(makeProfile([{ weeklyRent: 450 }]), SLUG);
    expect(rows).toHaveLength(0);
  });

  it('skips month-only dates', () => {
    const rows = mapRentalHistoryToRecords(makeProfile([{ date: 'Mar 2019', weeklyRent: 450 }]), SLUG);
    expect(rows).toHaveLength(0);
  });

  it('skips zero/missing-rent entries', () => {
    const rows = mapRentalHistoryToRecords(
      makeProfile([{ date: '2019-03-12', weeklyRent: 0 }, { date: '2019-03-12' }]),
      SLUG
    );
    expect(rows).toHaveLength(0);
  });

  it('is deterministic — same profile twice yields identical rows', () => {
    const profile = makeProfile([{ date: '12 Mar 2019', weeklyRent: 450 }]);
    expect(mapRentalHistoryToRecords(profile, SLUG)).toEqual(mapRentalHistoryToRecords(profile, SLUG));
  });
});

describe('persistRentalHistory', () => {
  it('persists mapped rows via insertPropertyRentalHistory', async () => {
    await persistRentalHistory(makeProfile([{ date: '2019-03-12', weeklyRent: 450 }]), SLUG);
    expect(insertPropertyRentalHistory).toHaveBeenCalledTimes(1);
    const rows = vi.mocked(insertPropertyRentalHistory).mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('profile-crawl');
  });

  it('persists nothing when address grounding is missing', async () => {
    await persistRentalHistory(makeProfile([{ date: '2019-03-12', weeklyRent: 450 }], { omitAddress: true }), SLUG);
    expect(insertPropertyRentalHistory).not.toHaveBeenCalled();
  });

  it('persists nothing when rentalHistory has no provenance entry (seeded-only profile)', async () => {
    await persistRentalHistory(
      makeProfile([{ date: '2019-03-12', weeklyRent: 450 }], { omitRentalHistoryConfidence: true }),
      SLUG
    );
    expect(insertPropertyRentalHistory).not.toHaveBeenCalled();
  });

  it('persists nothing when rentalHistory confidence is low', async () => {
    await persistRentalHistory(
      makeProfile([{ date: '2019-03-12', weeklyRent: 450 }], { rentalHistoryConfidence: 40 }),
      SLUG
    );
    expect(insertPropertyRentalHistory).not.toHaveBeenCalled();
  });

  it('persists at rentalHistory confidence exactly 50 (gate boundary)', async () => {
    await persistRentalHistory(
      makeProfile([{ date: '2019-03-12', weeklyRent: 450 }], { rentalHistoryConfidence: 50 }),
      SLUG
    );
    expect(insertPropertyRentalHistory).toHaveBeenCalledTimes(1);
  });

  it('persists nothing at rentalHistory confidence 49 (below gate)', async () => {
    await persistRentalHistory(
      makeProfile([{ date: '2019-03-12', weeklyRent: 450 }], { rentalHistoryConfidence: 49 }),
      SLUG
    );
    expect(insertPropertyRentalHistory).not.toHaveBeenCalled();
  });

  it('persists nothing when rentalHistory has empty contributedBy (no real source)', async () => {
    await persistRentalHistory(
      makeProfile([{ date: '2019-03-12', weeklyRent: 450 }], { rentalHistoryContributedBy: [] }),
      SLUG
    );
    expect(insertPropertyRentalHistory).not.toHaveBeenCalled();
  });

  it('persists nothing when slug is empty', async () => {
    await persistRentalHistory(makeProfile([{ date: '2019-03-12', weeklyRent: 450 }]), '');
    expect(insertPropertyRentalHistory).not.toHaveBeenCalled();
  });

  it('does not throw when insert fails', async () => {
    vi.mocked(insertPropertyRentalHistory).mockRejectedValueOnce(new Error('db down'));
    await expect(
      persistRentalHistory(makeProfile([{ date: '2019-03-12', weeklyRent: 450 }]), SLUG)
    ).resolves.toBeUndefined();
  });

  it('skips the insert call entirely when nothing maps', async () => {
    await persistRentalHistory(makeProfile([{ date: 'Mar 2019', weeklyRent: 450 }]), SLUG);
    expect(insertPropertyRentalHistory).not.toHaveBeenCalled();
  });
});
