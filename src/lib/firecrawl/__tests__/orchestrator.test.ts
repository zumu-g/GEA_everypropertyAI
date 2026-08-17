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

// Policy (2026-08-17): Firecrawl is fallback-only for bot-walled sources. The
// fast path must honour each source's configured backend — forcing firecrawl
// against REA/Domain/view burned the entire free credit pool on failures.
import { resolvePrimaryBackend } from '../orchestrator';
import { sourceRegistry } from '../sources';

describe('resolvePrimaryBackend', () => {
  it('fast mode honours a configured non-apify backend', () => {
    expect(resolvePrimaryBackend({ fetchBackend: 'stealth' }, true)).toBe('stealth');
    expect(resolvePrimaryBackend({ fetchBackend: 'web-unlocker' }, true)).toBe('web-unlocker');
  });

  it('fast mode never uses apify, falling back to firecrawl', () => {
    expect(resolvePrimaryBackend({ fetchBackend: 'apify' }, true)).toBe('firecrawl');
    expect(resolvePrimaryBackend({ options: { apifyActorId: 'x/y' } }, true)).toBe('firecrawl');
  });

  it('full mode keeps prior behaviour', () => {
    expect(resolvePrimaryBackend({}, false)).toBe('firecrawl');
    expect(resolvePrimaryBackend({ fetchBackend: 'stealth' }, false)).toBe('stealth');
    expect(resolvePrimaryBackend({ options: { apifyActorId: 'x/y' } }, false)).toBe('apify');
  });

  it('no active source uses firecrawl as its primary backend', () => {
    for (const source of Object.values(sourceRegistry)) {
      if (!source.enabled) continue;
      expect(resolvePrimaryBackend(source, false), source.name).not.toBe('firecrawl');
      expect(resolvePrimaryBackend(source, true), source.name).not.toBe('firecrawl');
    }
  });
});
