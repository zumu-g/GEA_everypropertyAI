import { describe, it, expect } from 'vitest';
import {
  toEnrichedSoldResult,
  enrichSoldRows,
  selectFirstListedDate,
  deriveDaysOnMarket,
} from '../enrich';
import type { PropertySaleRecord } from '@/lib/db/queries';
import type { MergedPropertyProfile } from '@/types/property';

const baseRow: PropertySaleRecord = {
  address_slug: '42-smith-street-berwick-vic-3806',
  raw_address: '42 Smith Street, Berwick VIC 3806',
  suburb: 'Berwick',
  state: 'VIC',
  postcode: '3806',
  sale_price: 800000,
  sale_date: '2026-05-01',
  source: 'domain-apify',
};

function profileWith(data: Record<string, unknown>): MergedPropertyProfile {
  return { data } as MergedPropertyProfile;
}

describe('toEnrichedSoldResult', () => {
  it('treats land_area_sqm 0 as missing and backfills from profile', () => {
    const out = toEnrichedSoldResult(
      { ...baseRow, land_area_sqm: 0 },
      profileWith({ landAreaSqm: 612 })
    );
    expect(out.landAreaSqm).toBe(612);
  });

  it('sold record wins over a conflicting profile value', () => {
    const out = toEnrichedSoldResult(
      { ...baseRow, land_area_sqm: 700 },
      profileWith({ landAreaSqm: 612 })
    );
    expect(out.landAreaSqm).toBe(700);
  });

  it('merges buildingAreaSqm from legacy profile key buildingArea', () => {
    const out = toEnrichedSoldResult(baseRow, profileWith({ buildingArea: 182 }));
    expect(out.buildingAreaSqm).toBe(182);
  });

  it('profile never overrides beds present on the row', () => {
    const out = toEnrichedSoldResult({ ...baseRow, bedrooms: 3 }, profileWith({ bedrooms: 4 }));
    expect(out.bedrooms).toBe(3);
  });

  it('profile fills missing beds; null when both missing', () => {
    expect(toEnrichedSoldResult(baseRow, profileWith({ bedrooms: 4 })).bedrooms).toBe(4);
    expect(toEnrichedSoldResult(baseRow, profileWith({})).bedrooms).toBeNull();
    expect(toEnrichedSoldResult(baseRow).bedrooms).toBeNull();
  });

  it('carSpaces falls back through profile garages then carSpaces', () => {
    expect(toEnrichedSoldResult(baseRow, profileWith({ garages: 2 })).carSpaces).toBe(2);
    expect(toEnrichedSoldResult(baseRow, profileWith({ carSpaces: 1 })).carSpaces).toBe(1);
  });

  it('row with no sources returns all new fields null (never fabricate)', () => {
    const out = toEnrichedSoldResult(baseRow);
    expect(out.buildingAreaSqm).toBeNull();
    expect(out.landAreaSqm).toBeNull();
    expect(out.bedrooms).toBeNull();
    expect(out.bathrooms).toBeNull();
    expect(out.carSpaces).toBeNull();
    expect(out.firstListedDate).toBeNull();
    expect(out.daysOnMarket).toBeNull();
  });

  it('uses own listed_date when present, listings join when not', () => {
    const own = toEnrichedSoldResult({ ...baseRow, listed_date: '2026-04-01T00:00:00Z' });
    expect(own.firstListedDate).toBe('2026-04-01');
    expect(own.daysOnMarket).toBe(30);

    const joined = toEnrichedSoldResult(baseRow, null, ['2026-03-15']);
    expect(joined.firstListedDate).toBe('2026-03-15');
    expect(joined.daysOnMarket).toBe(47);
  });

  it('existing fields pass through unchanged (envelope regression)', () => {
    const out = toEnrichedSoldResult({
      ...baseRow,
      property_type: 'House',
      latitude: -38.03,
      longitude: 145.34,
      agency_name: 'Acme RE',
      agent_name: 'A. Agent',
      listing_url: 'https://example.com/x',
      image_url: 'https://example.com/x.jpg',
      settlement_date: '2026-06-01',
    });
    expect(out).toMatchObject({
      rawAddress: baseRow.raw_address,
      suburb: 'Berwick',
      postcode: '3806',
      salePrice: 800000,
      saleDate: '2026-05-01',
      settlementDate: '2026-06-01',
      propertyType: 'House',
      latitude: -38.03,
      longitude: 145.34,
      agencyName: 'Acme RE',
      agentName: 'A. Agent',
      listingUrl: 'https://example.com/x',
      imageUrl: 'https://example.com/x.jpg',
      source: 'domain-apify',
    });
  });
});

describe('selectFirstListedDate', () => {
  it('selects the preceding campaign among multiple candidates', () => {
    expect(selectFirstListedDate('2026-05-01', ['2026-06-10', '2026-03-20'])).toBe('2026-03-20');
  });

  it('selects the latest candidate that is still ≤ sale date', () => {
    expect(selectFirstListedDate('2026-05-01', ['2025-01-01', '2026-04-10'])).toBe('2026-04-10');
  });

  it('returns null when all candidates post-date the sale', () => {
    expect(selectFirstListedDate('2026-05-01', ['2026-06-10'])).toBeNull();
  });

  it('returns null with no sale date or no candidates', () => {
    expect(selectFirstListedDate(null, ['2026-03-20'])).toBeNull();
    expect(selectFirstListedDate('2026-05-01', [])).toBeNull();
    expect(selectFirstListedDate('2026-05-01', undefined)).toBeNull();
  });
});

describe('deriveDaysOnMarket', () => {
  it('computes whole days', () => {
    expect(deriveDaysOnMarket('2026-05-01', '2026-04-01')).toBe(30);
  });
  it('nulls negative diffs but keeps firstListedDate handling separate', () => {
    expect(deriveDaysOnMarket('2026-05-01', '2026-06-01')).toBeNull();
  });
  it('nulls when either date missing', () => {
    expect(deriveDaysOnMarket(null, '2026-04-01')).toBeNull();
    expect(deriveDaysOnMarket('2026-05-01', null)).toBeNull();
  });
});

describe('enrichSoldRows', () => {
  it('skips enrichment silently for rows with null address_slug', () => {
    const row: PropertySaleRecord = { ...baseRow, address_slug: undefined };
    const out = enrichSoldRows([row], new Map(), new Map());
    expect(out).toHaveLength(1);
    expect(out[0].buildingAreaSqm).toBeNull();
  });

  it('looks up profile and listing dates by slug', () => {
    const profiles = new Map([[baseRow.address_slug!, profileWith({ buildingAreaSqm: 150 })]]);
    const dates = new Map([[baseRow.address_slug!, ['2026-04-01']]]);
    const out = enrichSoldRows([baseRow], profiles, dates);
    expect(out[0].buildingAreaSqm).toBe(150);
    expect(out[0].firstListedDate).toBe('2026-04-01');
    expect(out[0].daysOnMarket).toBe(30);
  });
});
