import { describe, it, expect } from 'vitest';
import { extractionMatchesTarget, partitionByAddressMatch } from '../address-match';
import type { ExtractedPropertyData } from '@/types/property';

const TARGET = '120 Moondarra Drive, Berwick VIC 3806';

/** Build an extraction whose address lives in `raw.address` (as the LLM extractor emits). */
function ext(address: Record<string, unknown>): ExtractedPropertyData {
  return { source: 'realestate.com.au', raw: { address }, extractedAt: new Date(0) };
}

describe('extractionMatchesTarget', () => {
  it('matches the exact property (street number + name)', () => {
    expect(extractionMatchesTarget(ext({ streetNumber: '120', streetName: 'Moondarra' }), TARGET)).toBe('match');
  });

  it('mismatches a different street number (the neighbour townhouse)', () => {
    expect(extractionMatchesTarget(ext({ streetNumber: '118', streetName: 'Moondarra' }), TARGET)).toBe('mismatch');
  });

  it('mismatches a different street name', () => {
    expect(extractionMatchesTarget(ext({ streetNumber: '120', streetName: 'Loders' }), TARGET)).toBe('mismatch');
  });

  it('mismatches a different suburb when both present', () => {
    expect(
      extractionMatchesTarget(ext({ streetNumber: '120', streetName: 'Moondarra', suburb: 'Clyde' }), TARGET),
    ).toBe('mismatch');
  });

  it('abstains when the extraction has no usable address', () => {
    expect(extractionMatchesTarget(ext({}), TARGET)).toBe('abstain');
    expect(extractionMatchesTarget({ source: 's', raw: {}, extractedAt: new Date(0) }, TARGET)).toBe('abstain');
  });

  it('reads address from data.address when raw has none', () => {
    const e: ExtractedPropertyData = {
      source: 's',
      raw: {},
      data: { address: { streetNumber: '118', streetName: 'Moondarra' } },
      extractedAt: new Date(0),
    };
    expect(extractionMatchesTarget(e, TARGET)).toBe('mismatch');
  });

  it('derives fields from a displayAddress string when structured fields are absent', () => {
    expect(
      extractionMatchesTarget(ext({ displayAddress: '118 Moondarra Drive, Berwick VIC 3806' }), TARGET),
    ).toBe('mismatch');
    expect(
      extractionMatchesTarget(ext({ displayAddress: '120 Moondarra Drive, Berwick VIC 3806' }), TARGET),
    ).toBe('match');
  });

  it('matches on number + name even when suburb is absent on the extraction', () => {
    expect(extractionMatchesTarget(ext({ streetNumber: '120', streetName: 'Moondarra Drive' }), TARGET)).toBe('match');
  });
});

describe('partitionByAddressMatch (the merge drop-gate)', () => {
  it('keeps the matching 120 extraction and drops the 118 neighbour', () => {
    const e120 = ext({ streetNumber: '120', streetName: 'Moondarra' });
    const e118 = ext({ streetNumber: '118', streetName: 'Moondarra' });
    const { kept, droppedCount } = partitionByAddressMatch([e120, e118], TARGET);
    expect(droppedCount).toBe(1);
    expect(kept).toEqual([e120]);
  });

  it('drops all when every extraction mismatches (→ empty merge → feed-seed fallback)', () => {
    const { kept, droppedCount } = partitionByAddressMatch(
      [ext({ streetNumber: '118', streetName: 'Moondarra' }), ext({ streetNumber: '5', streetName: 'Loders' })],
      TARGET,
    );
    expect(kept).toHaveLength(0);
    expect(droppedCount).toBe(2);
  });

  it('keeps abstaining extractions (no usable address)', () => {
    const eAbstain = ext({});
    const { kept, droppedCount } = partitionByAddressMatch([eAbstain], TARGET);
    expect(droppedCount).toBe(0);
    expect(kept).toEqual([eAbstain]);
  });
});
