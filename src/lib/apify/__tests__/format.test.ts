import { describe, it, expect } from 'vitest';
import { actorItemsToMarkdown } from '../format';

const TARGET = '120 Moondarra Drive, Berwick VIC 3806';

const item120 = { address: '120 Moondarra Drive, Berwick VIC 3806', bedrooms: 4, propertyType: 'House', landArea: 650 };
const item118 = { address: '118 Moondarra Drive, Berwick VIC 3806', bedrooms: 2, propertyType: 'Townhouse', landArea: 263 };
const itemNoAddr = { bedrooms: 3, propertyType: 'House' };

describe('actorItemsToMarkdown — target item selection (plan 008)', () => {
  it('with a target, formats only the matching item (drops the neighbour)', () => {
    const md = actorItemsToMarkdown([item120, item118], TARGET);
    expect(md).toContain('120 Moondarra Drive');
    expect(md).not.toContain('118 Moondarra Drive');
    expect(md).toContain('4'); // 120's bedrooms
    expect(md).not.toContain('Townhouse');
  });

  it('a single non-matching item yields empty markdown (no blend → feed-seed fallback)', () => {
    expect(actorItemsToMarkdown([item118], TARGET)).toBe('');
  });

  it('a single matching item is formatted', () => {
    const md = actorItemsToMarkdown([item120], TARGET);
    expect(md).toContain('120 Moondarra Drive');
    expect(md).toContain('House');
  });

  it('selects the clear match even when a garbled/address-less item is present', () => {
    const md = actorItemsToMarkdown([itemNoAddr, item120, item118], TARGET);
    expect(md).toContain('120 Moondarra Drive');
    expect(md).not.toContain('118 Moondarra Drive');
  });

  it('with no target, formats all items (back-compat)', () => {
    const md = actorItemsToMarkdown([item120, item118]);
    expect(md).toContain('120 Moondarra Drive');
    expect(md).toContain('118 Moondarra Drive');
    expect(md).toContain('---'); // both items, separated
  });

  it('reads an address object shape, not just a string', () => {
    const objItem = { address: { displayAddress: '118 Moondarra Drive, Berwick VIC 3806' }, bedrooms: 2 };
    expect(actorItemsToMarkdown([objItem], TARGET)).toBe(''); // mismatch dropped
  });
});
