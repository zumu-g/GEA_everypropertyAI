import { describe, it, expect } from 'vitest';
import { sourceRegistry } from '../index';

// Policy (2026-08-14): Apify is budgeted at ONE run per data source per day,
// spent by the morning feed crons. The per-property enrichment cascade fires
// on every /api/property cache miss during the day, so no enrichment source
// may route through an Apify actor — doing so burned the entire monthly cap
// (azzouzana REA: 2,846 runs; abotapi view: 800 runs).
describe('no daytime Apify policy', () => {
  it('no enrichment source configures an Apify actor or backend', () => {
    for (const source of Object.values(sourceRegistry)) {
      expect(source.options?.apifyActorId, `${source.name} configures apifyActorId`).toBeUndefined();
      expect(source.fetchBackend, `${source.name} uses the apify backend`).not.toBe('apify');
      expect(source.fallbackBackends ?? [], `${source.name} falls back to apify`).not.toContain('apify');
    }
  });
});
