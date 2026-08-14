import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scrapeWithApify } from '../client';

function mockApify(items: unknown[]) {
  return vi.fn(async (url: string) => {
    if (url.includes('/acts/')) {
      return new Response(
        JSON.stringify({
          data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' },
        }),
        { status: 201 }
      );
    }
    return new Response(JSON.stringify(items), { status: 200 });
  });
}

describe('scrapeWithApify', () => {
  beforeEach(() => {
    process.env.APIFY_API_TOKEN = 'test-token';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('treats an unsupported-URL rejection message as failure, not success', async () => {
    // azzouzana/real-estate-au-scraper-pro "succeeds" with a single message item
    // when given a /property/{slug} URL it does not support. That must fail so
    // the cascade falls through to the stealth backend instead of caching junk.
    vi.stubGlobal(
      'fetch',
      mockApify([{ message: "We only support scraping 'buy', 'rent', 'sold' search URLs.." }])
    );
    const r = await scrapeWithApify(
      'https://www.realestate.com.au/property/1-example-st-cranbourne-vic-3977',
      'realestate.com.au',
      'azzouzana/real-estate-au-scraper-pro'
    );
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/only support/i);
  });

  it('still succeeds on real listing items', async () => {
    vi.stubGlobal(
      'fetch',
      mockApify([{ address: '1 Example St, Cranbourne VIC 3977', price: '$750,000' }])
    );
    const r = await scrapeWithApify(
      'https://www.realestate.com.au/property/1-example-st-cranbourne-vic-3977',
      'realestate.com.au',
      'azzouzana/real-estate-au-scraper-pro'
    );
    expect(r.status).toBe('success');
  });
});
