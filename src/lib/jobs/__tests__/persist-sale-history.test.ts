import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/queries', () => ({
  insertPropertySales: vi.fn(async () => {}),
}));

import { insertPropertySales } from '@/lib/db/queries';
import { mapSaleHistoryToRecords, persistSaleHistory } from '@/lib/jobs/persist-sale-history';
import type { MergedPropertyProfile } from '@/types/property';

const SLUG = '12-smith-st-berwick-vic-3806';

function makeProfile(
  saleHistory: unknown[],
  opts?: {
    omitAddress?: boolean;
    saleHistoryConfidence?: number;
    saleHistoryContributedBy?: string[];
    omitSaleHistoryConfidence?: boolean;
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
      saleHistory,
    },
    fieldConfidences: {
      ...(opts?.omitAddress
        ? {}
        : { address: { confidence: 100, contributedBy: ['resolved-address'] } }),
      ...(opts?.omitSaleHistoryConfidence
        ? {}
        : {
            saleHistory: {
              confidence: opts?.saleHistoryConfidence ?? 60,
              contributedBy: opts?.saleHistoryContributedBy ?? ['domain'],
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

describe('mapSaleHistoryToRecords', () => {
  it('maps entries with full dates and prices to rows', () => {
    const profile = makeProfile([
      { date: '12 Mar 2019', price: 650000, agency: 'Ray White', agentName: 'Jo Bloggs' },
      { date: '2015-06-01', price: 480000 },
      { date: '3/11/2010', price: 350000, settlementDate: '2010-12-15' },
    ]);
    const rows = mapSaleHistoryToRecords(profile, SLUG);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.source).toBe('profile-crawl');
      expect(row.address_slug).toBe(SLUG);
      expect(row.raw_address).toBe('12 Smith St, Berwick VIC 3806');
      expect(row.suburb).toBe('Berwick');
      expect(row.state).toBe('VIC');
      expect(row.postcode).toBe('3806');
    }
    expect(rows[0].sale_date).toBe('2019-03-12');
    expect(rows[0].sale_price).toBe(650000);
    expect(rows[0].agency_name).toBe('Ray White');
    expect(rows[0].agent_name).toBe('Jo Bloggs');
    expect(rows[0].raw_data).toEqual({ date: '12 Mar 2019', price: 650000, agency: 'Ray White', agentName: 'Jo Bloggs' });
    expect(rows[1].sale_date).toBe('2015-06-01');
    expect(rows[2].sale_date).toBe('2010-11-03');
    expect(rows[2].settlement_date).toBe('2010-12-15');
  });

  it('skips entry with price but no date', () => {
    const rows = mapSaleHistoryToRecords(makeProfile([{ price: 500000 }]), SLUG);
    expect(rows).toHaveLength(0);
  });

  it('skips month-only dates', () => {
    const rows = mapSaleHistoryToRecords(makeProfile([{ date: 'Mar 2019', price: 500000 }]), SLUG);
    expect(rows).toHaveLength(0);
  });

  it('skips confidential/no-price entries', () => {
    const rows = mapSaleHistoryToRecords(
      makeProfile([
        { date: '2019-03-12', isConfidential: true },
        { date: '2019-03-12' },
        { date: '2019-03-12', price: 0 },
      ]),
      SLUG
    );
    expect(rows).toHaveLength(0);
  });

  it('is deterministic — same profile twice yields identical rows', () => {
    const profile = makeProfile([{ date: '12 Mar 2019', price: 650000 }]);
    expect(mapSaleHistoryToRecords(profile, SLUG)).toEqual(mapSaleHistoryToRecords(profile, SLUG));
  });
});

describe('persistSaleHistory', () => {
  it('persists mapped rows via insertPropertySales', async () => {
    await persistSaleHistory(makeProfile([{ date: '2019-03-12', price: 650000 }]), SLUG);
    expect(insertPropertySales).toHaveBeenCalledTimes(1);
    const rows = vi.mocked(insertPropertySales).mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('profile-crawl');
  });

  it('persists nothing when address grounding is missing', async () => {
    await persistSaleHistory(makeProfile([{ date: '2019-03-12', price: 650000 }], { omitAddress: true }), SLUG);
    expect(insertPropertySales).not.toHaveBeenCalled();
  });

  it('persists nothing when saleHistory has no provenance entry (seeded-only profile)', async () => {
    await persistSaleHistory(
      makeProfile([{ date: '2019-03-12', price: 650000 }], { omitSaleHistoryConfidence: true }),
      SLUG
    );
    expect(insertPropertySales).not.toHaveBeenCalled();
  });

  it('persists nothing when saleHistory confidence is low', async () => {
    await persistSaleHistory(
      makeProfile([{ date: '2019-03-12', price: 650000 }], { saleHistoryConfidence: 40 }),
      SLUG
    );
    expect(insertPropertySales).not.toHaveBeenCalled();
  });

  it('persists at saleHistory confidence exactly 50 (gate boundary)', async () => {
    await persistSaleHistory(
      makeProfile([{ date: '2019-03-12', price: 650000 }], { saleHistoryConfidence: 50 }),
      SLUG
    );
    expect(insertPropertySales).toHaveBeenCalledTimes(1);
  });

  it('persists nothing at saleHistory confidence 49 (below gate)', async () => {
    await persistSaleHistory(
      makeProfile([{ date: '2019-03-12', price: 650000 }], { saleHistoryConfidence: 49 }),
      SLUG
    );
    expect(insertPropertySales).not.toHaveBeenCalled();
  });

  it('persists nothing when saleHistory has empty contributedBy (no real source)', async () => {
    await persistSaleHistory(
      makeProfile([{ date: '2019-03-12', price: 650000 }], { saleHistoryContributedBy: [] }),
      SLUG
    );
    expect(insertPropertySales).not.toHaveBeenCalled();
  });

  it('persists nothing when slug is empty', async () => {
    await persistSaleHistory(makeProfile([{ date: '2019-03-12', price: 650000 }]), '');
    expect(insertPropertySales).not.toHaveBeenCalled();
  });

  it('does not throw when insert fails', async () => {
    vi.mocked(insertPropertySales).mockRejectedValueOnce(new Error('db down'));
    await expect(
      persistSaleHistory(makeProfile([{ date: '2019-03-12', price: 650000 }]), SLUG)
    ).resolves.toBeUndefined();
  });

  it('skips the insert call entirely when nothing maps', async () => {
    await persistSaleHistory(makeProfile([{ date: 'Mar 2019', price: 650000 }]), SLUG);
    expect(insertPropertySales).not.toHaveBeenCalled();
  });
});
