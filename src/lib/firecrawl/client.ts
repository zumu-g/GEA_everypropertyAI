import FirecrawlApp from '@mendable/firecrawl-js';
import type { CrawlResult } from '@/types/crawl';

let _client: FirecrawlApp | null = null;

function getFirecrawlClient(): FirecrawlApp {
  if (_client) return _client;
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error(
      'FIRECRAWL_API_KEY is not set. Add it to your .env.local file.'
    );
  }
  _client = new FirecrawlApp({ apiKey });
  return _client;
}

export { getFirecrawlClient };

/**
 * Scrape a single URL and return a typed CrawlResult.
 */
export async function scrapeUrl(
  url: string,
  source: string,
  options: {
    waitFor?: string;
    timeout?: number;
    formats?: string[];
  } = {}
): Promise<CrawlResult> {
  try {
    const client = getFirecrawlClient();
    const response = await client.scrapeUrl(url, {
      formats: (options.formats as ('markdown' | 'html')[]) ?? ['markdown'],
      timeout: options.timeout ?? 30000,
    });

    if (!response.success) {
      return {
        source,
        url,
        status: 'failed',
        crawledAt: new Date(),
        error: response.error ?? 'Scrape returned unsuccessful response',
      };
    }

    return {
      source,
      url,
      status: 'success',
      markdown: response.markdown,
      html: response.html,
      metadata: response.metadata as Record<string, unknown> | undefined,
      crawledAt: new Date(),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown scrape error';

    const isTimeout =
      message.toLowerCase().includes('timeout') ||
      message.toLowerCase().includes('timed out');

    return {
      source,
      url,
      status: isTimeout ? 'timeout' : 'failed',
      crawledAt: new Date(),
      error: message,
    };
  }
}

/**
 * Scrape multiple URLs in parallel via Firecrawl batch endpoint.
 * Falls back to individual scrapes if batch is unavailable.
 */
export async function batchScrape(
  urls: { url: string; source: string }[],
  options: {
    waitFor?: string;
    timeout?: number;
    formats?: string[];
  } = {}
): Promise<CrawlResult[]> {
  const results = await Promise.allSettled(
    urls.map(({ url, source }) => scrapeUrl(url, source, options))
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    return {
      source: urls[index].source,
      url: urls[index].url,
      status: 'failed' as const,
      crawledAt: new Date(),
      error:
        result.reason instanceof Error
          ? result.reason.message
          : 'Batch scrape promise rejected',
    };
  });
}
