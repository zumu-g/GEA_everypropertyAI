import { describe, it, expect } from 'vitest';
import {
  onthehousePropertyJsonToExtraction,
  onthehousePropertyJsonToMarkdown,
  matchLocationPropertyId,
} from '../onthehouse-profile-json';

// Real odin /properties response shape (3 Norham Ct, Berwick — live capture).
const propertyJson = JSON.stringify({
  category: 'Property',
  clPropertyId: '9869527',
  othPropertyId: '7535383',
  address: {
    formattedAddress: '3 NORHAM CT, BERWICK, VIC 3806',
    streetNumber: '3',
    streetName: 'NORHAM',
    streetType: 'CT',
    suburb: 'BERWICK',
    stateCode: 'VIC',
    postCode: '3806',
    location: { lat: -38.04667516, lon: 145.34168343 },
  },
  beds: 3,
  baths: 2,
  carSpaces: 2,
  floorSize: 131,
  landSize: 836,
  landSizeUnit: 'squareMeter',
  yearBuilt: 1980,
  type: 'House',
  legalAttributes: { 'Lot/Plan': '16/LP121233', 'Local Government Authority': 'Casey' },
  guesstimate: { price: 885000, fromPrice: 800000, toPrice: 900000, confidence: 'Medium' },
  lastSale: {
    eventDate: '2010-06-29',
    salePrice: 330000,
    saleSource: 'VG',
    sellingAgency: { name: 'LJ Hooker Berwick' },
    type: 'SoldEvent',
  },
});

// Real odin /locations response shape (the street stub + one entry per number).
const locationsJson = JSON.stringify({
  content: [
    { propertyId: 'BERWICK+VIC+3806+NORHAM+CT', streetNumber: '', streetName: 'NORHAM', streetType: 'CT' },
    { propertyId: '7535383', streetNumber: '3', streetName: 'NORHAM', streetType: 'CT' },
    { propertyId: '4912473', streetNumber: '1', streetName: 'NORHAM', streetType: 'CT' },
  ],
});

describe('onthehousePropertyJsonToExtraction', () => {
  it('extracts subject attributes from the odin property JSON', () => {
    const ext = onthehousePropertyJsonToExtraction(propertyJson);
    expect(ext).not.toBeNull();
    const raw = ext!.raw as Record<string, unknown>;
    expect(ext!.source).toBe('onthehouse.com.au');
    expect(raw.bedrooms).toBe(3);
    expect(raw.bathrooms).toBe(2);
    expect(raw.carSpaces).toBe(2);
    expect(raw.landArea).toBe(836);
    expect(raw.buildingArea).toBe(131);
    expect(raw.yearBuilt).toBe(1980);
    expect(raw.propertyType).toBe('house');
    expect(raw.councilArea).toBe('Casey');
    expect(raw.estimatedValue).toBe(885000);
    const addr = raw.address as Record<string, unknown>;
    expect(addr.streetName).toBe('Norham');
    expect(addr.streetType).toBe('Court');
    expect(addr.suburb).toBe('Berwick');
    const sales = raw.saleHistory as Array<Record<string, unknown>>;
    expect(sales[0].price).toBe(330000);
    expect(sales[0].date).toBe('2010-06-29');
  });

  it('returns null for an error body or non-property JSON', () => {
    expect(onthehousePropertyJsonToExtraction('{"error":"An unexpected error has occurred"}')).toBeNull();
    expect(onthehousePropertyJsonToExtraction('not json')).toBeNull();
    expect(onthehousePropertyJsonToExtraction('')).toBeNull();
  });

  it('returns null when the record has no subject attributes', () => {
    const stub = JSON.stringify({ category: 'Property', othPropertyId: '1', address: { streetName: 'X' } });
    expect(onthehousePropertyJsonToExtraction(stub)).toBeNull();
  });

  it('tolerates a JSON body wrapped in surrounding markup', () => {
    const ext = onthehousePropertyJsonToExtraction(`<pre>${propertyJson}</pre>`);
    expect(ext).not.toBeNull();
    expect((ext!.raw as Record<string, unknown>).bedrooms).toBe(3);
  });
});

describe('onthehousePropertyJsonToMarkdown', () => {
  it('renders a subject summary', () => {
    const md = onthehousePropertyJsonToMarkdown(propertyJson);
    expect(md).toContain('Bedrooms: 3');
    expect(md).toContain('Land size (m²): 836');
    expect(md).toContain('Casey');
  });
  it('returns null for a non-property body', () => {
    expect(onthehousePropertyJsonToMarkdown('{"content":[]}')).toBeNull();
  });
});

describe('matchLocationPropertyId', () => {
  it('resolves the exact street number to its othPropertyId', () => {
    expect(matchLocationPropertyId(locationsJson, { streetNumber: '3', streetName: 'Norham' })).toBe('7535383');
  });
  it('does not match a different street number', () => {
    expect(matchLocationPropertyId(locationsJson, { streetNumber: '9', streetName: 'Norham' })).toBeNull();
  });
  it('ignores the non-numeric street-level stub', () => {
    expect(matchLocationPropertyId(locationsJson, { streetNumber: '', streetName: 'Norham' })).toBeNull();
  });
});
