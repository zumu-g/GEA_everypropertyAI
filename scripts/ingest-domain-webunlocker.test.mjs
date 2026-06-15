import { describe, it, expect } from 'vitest';
import { looksLikeData, extractListings } from './ingest-domain-webunlocker.mjs';

const NEXT_DATA = (listingsMap) =>
  `<!doctype html><html><body><script id="__NEXT_DATA__" type="application/json">` +
  JSON.stringify({ props: { pageProps: { componentProps: { listingsMap } } } }) +
  `</script></body></html>`;

// A realistic anti-bot interstitial: 200 OK, plenty of bytes, but NO __NEXT_DATA__.
const CHALLENGE_PAGE =
  '<html><head><title>Just a moment...</title></head><body>' +
  'Checking your browser before accessing domain.com.au. '.repeat(40) +
  '</body></html>';

describe('looksLikeData (body-validation gate)', () => {
  it('accepts a real page with __NEXT_DATA__', () => {
    expect(looksLikeData(NEXT_DATA({}))).toBe(true);
  });
  it('rejects an anti-bot challenge page returned as 200', () => {
    expect(CHALLENGE_PAGE.length).toBeGreaterThan(1000); // would pass the old length-only check
    expect(looksLikeData(CHALLENGE_PAGE)).toBe(false);
  });
  it('rejects empty / non-string bodies', () => {
    expect(looksLikeData('')).toBe(false);
    expect(looksLikeData(undefined)).toBe(false);
    expect(looksLikeData(null)).toBe(false);
  });
});

describe('extractListings', () => {
  it('extracts listing nodes from listingsMap', () => {
    const html = NEXT_DATA({ '1': { listingModel: { url: '/a' } }, '2': { listingModel: { url: '/b' } } });
    expect(extractListings(html)).toHaveLength(2);
  });
  it('returns [] when __NEXT_DATA__ is absent (challenge page)', () => {
    expect(extractListings(CHALLENGE_PAGE)).toEqual([]);
  });
  it('returns [] on malformed JSON', () => {
    expect(extractListings('<script id="__NEXT_DATA__">{not json}</script>')).toEqual([]);
  });
});
