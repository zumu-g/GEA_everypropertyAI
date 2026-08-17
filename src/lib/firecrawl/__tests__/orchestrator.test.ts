import { describe, it, expect } from 'vitest';
import { raceToFirstSuccess } from '../orchestrator';
import type { CrawlResult } from '@/types/crawl';

function result(status: CrawlResult['status'], source: string, delayMs: number): Promise<CrawlResult> {
  return new Promise((resolve) =>
    setTimeout(() => resolve({ source, url: '', status, crawledAt: new Date() }), delayMs)
  );
}

describe('raceToFirstSuccess', () => {
  it('resolves with the first success even if a slower attempt is still pending', async () => {
    const r = await raceToFirstSuccess([
      result('failed', 'slow-fail', 5),
      result('success', 'fast-success', 1),
      result('success', 'slow-success', 50),
    ]);
    expect(r.status).toBe('success');
    expect(r.source).toBe('fast-success');
  });

  it('resolves with the last failure when every attempt fails', async () => {
    const r = await raceToFirstSuccess([
      result('failed', 'first', 1),
      result('failed', 'second', 10),
    ]);
    expect(r.status).toBe('failed');
    expect(r.source).toBe('second');
  });

  it('does not wait for a rejected promise once a success has already resolved', async () => {
    const start = Date.now();
    const r = await raceToFirstSuccess([
      result('success', 'quick', 1),
      new Promise<CrawlResult>((_, reject) => setTimeout(() => reject(new Error('boom')), 200)),
    ]);
    expect(r.status).toBe('success');
    expect(Date.now() - start).toBeLessThan(150);
  });
});

// Policy (2026-08-18): Firecrawl removed entirely. Unconfigured sources
// default to the self-hosted stealth backend; fast mode never uses apify.
import { resolvePrimaryBackend } from '../orchestrator';

describe('resolvePrimaryBackend', () => {
  it('fast mode honours a configured non-apify backend', () => {
    expect(resolvePrimaryBackend({ fetchBackend: 'stealth' }, true)).toBe('stealth');
    expect(resolvePrimaryBackend({ fetchBackend: 'web-unlocker' }, true)).toBe('web-unlocker');
  });

  it('fast mode never uses apify, falling back to stealth', () => {
    expect(resolvePrimaryBackend({ fetchBackend: 'apify' }, true)).toBe('stealth');
    expect(resolvePrimaryBackend({ options: { apifyActorId: 'x/y' } }, true)).toBe('stealth');
  });

  it('full mode defaults to stealth, honours apify actor config', () => {
    expect(resolvePrimaryBackend({}, false)).toBe('stealth');
    expect(resolvePrimaryBackend({ fetchBackend: 'stealth' }, false)).toBe('stealth');
    expect(resolvePrimaryBackend({ options: { apifyActorId: 'x/y' } }, false)).toBe('apify');
  });
});
