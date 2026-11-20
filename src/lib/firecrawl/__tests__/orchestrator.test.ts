import { describe, it, expect } from 'vitest';
import { raceToFirstSuccess, fetchUntilParsed } from '../orchestrator';
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

describe('fetchUntilParsed', () => {
  const ok = (html: string): CrawlResult => ({ source: 's', url: '', status: 'success', html, crawledAt: new Date() });
  const parse = (html: string) => (html.includes('DATA') ? 'md:' + html : null);

  it('re-fetches when a successful fetch returns a shell page the parser rejects', async () => {
    const pages = ['shell', 'DATA'];
    let calls = 0;
    const r = await fetchUntilParsed(async () => ok(pages[calls++]), parse, 3);
    expect(calls).toBe(2);
    expect(r.markdown).toBe('md:DATA');
  });

  it('stops after maxAttempts shell pages and returns null markdown', async () => {
    let calls = 0;
    const r = await fetchUntilParsed(async () => { calls++; return ok('shell'); }, parse, 3);
    expect(calls).toBe(3);
    expect(r.markdown).toBeNull();
  });

  it('does not re-fetch a failed fetch (the client already retried)', async () => {
    let calls = 0;
    const r = await fetchUntilParsed(async () => { calls++; return { source: 's', url: '', status: 'failed', crawledAt: new Date() }; }, parse, 3);
    expect(calls).toBe(1);
    expect(r.result.status).toBe('failed');
  });
});
