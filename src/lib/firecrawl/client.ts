import FirecrawlApp from '@mendable/firecrawl-js';
import type { CrawlResult } from '@/types/crawl';
import type { ExtractedPropertyData } from '@/types/property';
import { firecrawlPropertySchema } from '@/lib/extraction/schemas';

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

    // Firecrawl reports success:true even when the target returned an HTTP
    // error (e.g. a 404 "property not found" page or a 429 bot wall). Treat
    // those as failures so the orchestrator's search-URL / backend fallbacks
    // fire instead of caching a junk page as a successful crawl.
    const statusCode = (response.metadata as { statusCode?: number } | undefined)
      ?.statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400) {
      return {
        source,
        url,
        status: statusCode === 429 ? 'timeout' : 'failed',
        crawledAt: new Date(),
        error: `Target returned HTTP ${statusCode}`,
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

const FIRECRAWL_EXTRACT_PROMPT =
  'Extract structured property data for the single property this page is about. ' +
  'Only include fields present on the page; omit anything you are unsure of. ' +
  'Use square metres for areas and plain integers for bed/bath/car counts.';

/**
 * Scrape a URL and have Firecrawl return structured JSON directly (its native
 * /extract via jsonOptions) — no separate LLM call needed. Returns the parsed
 * fields as an ExtractedPropertyData (fields live in `.raw`, the shape the
 * merger reads). Returns null on failure so callers can fall back.
 */
export async function scrapeAndExtract(
  url: string,
  source: string
): Promise<ExtractedPropertyData | null> {
  try {
    const client = getFirecrawlClient();
    const response = await client.scrapeUrl(url, {
      formats: ['json'],
      jsonOptions: { schema: firecrawlPropertySchema, prompt: FIRECRAWL_EXTRACT_PROMPT },
      timeout: 45000,
    });

    if (!response.success) {
      console.warn(`[scrapeAndExtract] ${source} failed: ${response.error ?? 'unknown'}`);
      return null;
    }

    const json = (response as { json?: Record<string, unknown> }).json;
    if (!json || Object.keys(json).length === 0) {
      console.warn(`[scrapeAndExtract] ${source} returned no JSON`);
      return null;
    }

    // Normalise Firecrawl schema field names to the flat keys the merger reads.
    // Without this, area/price fields are silently dropped on the merge.
    const FIELD_ALIASES: Record<string, string> = {
      landAreaSqm: 'landArea',
      buildingAreaSqm: 'buildingArea',
      priceText: 'priceLabel',
    };
    for (const [from, to] of Object.entries(FIELD_ALIASES)) {
      if (json[from] !== undefined && json[to] === undefined) {
        json[to] = json[from];
      }
    }

    return { source, raw: json, extractedAt: new Date() };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown extract error';
    console.warn(`[scrapeAndExtract] ${source} error: ${message}`);
    return null;
  }
}

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

let uaIndex = 0;

/**
 * Lightweight direct page fetch — no Firecrawl.
 * Use for server-rendered listing pages that don't need anti-bot handling.
 * Returns raw HTML and HTTP status.
 */
export async function fetchPage(
  url: string,
  timeoutMs = 20000
): Promise<{ html: string; status: number; ok: boolean }> {
  const ua = USER_AGENTS[uaIndex++ % USER_AGENTS.length];
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Referer': 'https://www.google.com.au/',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const html = await res.text();
    return { html, status: res.status, ok: res.ok };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'fetch failed';
    console.warn(`[fetchPage] ${url} — ${msg}`);
    return { html: '', status: 0, ok: false };
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
