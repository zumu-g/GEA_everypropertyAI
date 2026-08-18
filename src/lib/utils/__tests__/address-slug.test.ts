import { describe, it, expect } from 'vitest';
import { parseAddress, toSlug } from '@/lib/utils/address';
import { toAddressSlug } from '@/lib/firecrawl/address';
import type { StructuredAddress } from '@/types/property';

// An abbreviated StructuredAddress (Mapbox autocomplete / page URL) must slug
// identically to the ingest path (parseAddress over a raw feed address) —
// getFeedSeedBySlug matches on exact slug, so a mismatch silently drops the
// feed seed (hero photo, beds/baths) for the target property.
describe('address slug parity', () => {
  const structured: StructuredAddress = {
    streetNumber: '66A',
    streetName: 'Duncan',
    streetType: 'Dr',
    suburb: 'Pakenham',
    state: 'VIC',
    postcode: '3810',
    displayAddress: '66A Duncan Dr, Pakenham, VIC 3810',
  };

  it('expands abbreviated street types in toSlug', () => {
    expect(toSlug(structured)).toBe('66a-duncan-drive-pakenham-vic-3810');
  });

  it('matches the ingest slug for the same raw address', () => {
    expect(toSlug(structured)).toBe(toSlug(parseAddress('66a Duncan Drive, Pakenham VIC 3810')));
  });

  it('toAddressSlug agrees with toSlug', () => {
    expect(toAddressSlug(structured)).toBe(toSlug(structured));
  });
});
