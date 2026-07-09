import { describe, it, expect } from 'vitest';
import { renderPropertyReport, buildFootnote, type PropertyReportData } from '../property-report';

const full: PropertyReportData = {
  address: '12 Example Street, Berwick VIC 3806',
  propertyType: 'House',
  bedrooms: 4,
  bathrooms: 2,
  carSpaces: 2,
  landAreaSqm: 650,
  buildingAreaSqm: 210,
  priceEstimate: { low: 850000, mid: 920000, high: 990000 },
  confidence: 82,
  saleHistory: [
    { date: '2019-03-14', price: 715000 },
    { date: '2012-11-02', price: 480000 },
  ],
  listingStatus: 'off-market',
  heroPhotos: [],
  sources: ['domain', 'homely'],
};

describe('renderPropertyReport', () => {
  it('renders a valid non-empty PDF for a full profile', async () => {
    const pdf = await renderPropertyReport(full, '8 July 2026');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('renders degraded content for a thin profile and notes the gaps', async () => {
    const thin: PropertyReportData = {
      address: '1 Bare Court, Pakenham VIC 3810',
      confidence: 20,
      saleHistory: [],
      heroPhotos: [],
    };
    const pdf = await renderPropertyReport(thin, '8 July 2026');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const note = buildFootnote(thin, '8 July 2026');
    expect(note).toContain('price estimate');
    expect(note).toContain('sales history');
    expect(note).toContain('photos');
  });
});
