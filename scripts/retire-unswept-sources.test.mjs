import { describe, it, expect } from 'vitest';
import { retireFilter, retirePatch, UNSWEPT_SOURCES } from './retire-unswept-sources.mjs';

describe('retire-unswept-sources filter', () => {
  it('targets only ACTIVE rows of the two unswept sources', () => {
    expect(UNSWEPT_SOURCES).toEqual(['domain-apify', 'gea-legacy-db']);
    expect(retireFilter()).toBe('source=in.("domain-apify","gea-legacy-db")&active=eq.true');
  });
  it('closes as withdrawn with removed_at at the run start', () => {
    expect(retirePatch('2026-09-28T00:00:00.000Z')).toEqual({ active: false, removed_at: '2026-09-28T00:00:00.000Z', lifecycle_status: 'withdrawn' });
  });
});
