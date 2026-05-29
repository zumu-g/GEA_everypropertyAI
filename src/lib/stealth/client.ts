import type { CrawlResult } from '@/types/crawl';

// ─── Environment ─────────────────────────────────────────────────────────────
// The stealth scraper is a SEPARATE long-running service (Camoufox/Patchright
// behind Playwright) — it cannot run on Vercel. The Next app talks to it over
// HTTP. When STEALTH_SCRAPER_URL is unset the whole backend fails soft: sources
// routed to it return a 'failed' CrawlResult and every other source is unaffected.

const STEALTH_URL = process.env.STEALTH_SCRAPER_URL ?? '';
const STEALTH_SECRET = process.env.STEALTH_SCRAPER_SECRET ?? '';

/**
 * Whether the stealth scraper service is configured.
 * Mirrors isSupabaseConfigured() — callers branch on this to skip stealth
 * fallbacks gracefully.
 */
export const isStealthConfigured = (): boolean => Boolean(STEALTH_URL);

interface StealthScrapeResponse {
  html?: string;
  markdown?: string;
  status?: 'success' | 'failed' | 'timeout';
  finalUrl?: string;
  error?: string;
}

/**
 * Fetch a URL via the stealth-browser scraper service and return a CrawlResult.
 *
 * Same contract as scrapeUrl()/scrapeWithApify(): never throws — on any error
 * (unconfigured, network, non-2xx, timeout) it returns a 'failed'/'timeout'
 * CrawlResult so one source can't break the parallel crawl.
 */
export async function scrapeWithStealth(
  url: string,
  source: string,
  options: {
    waitFor?: string | number;
    timeout?: number;
    engine?: 'camoufox' | 'patchright' | 'playwright';
  } = {}
): Promise<CrawlResult> {
  if (!isStealthConfigured()) {
    return {
      source,
      url,
      status: 'failed',
      crawledAt: new Date(),
      error: 'Stealth scraper not configured (STEALTH_SCRAPER_URL unset)',
    };
  }

  const timeout = options.timeout ?? 60_000;

  try {
    const res = await fetch(`${STEALTH_URL.replace(/\/$/, '')}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(STEALTH_SECRET ? { Authorization: `Bearer ${STEALTH_SECRET}` } : {}),
      },
      body: JSON.stringify({
        url,
        waitFor: options.waitFor,
        timeout,
        engine: options.engine,
      }),
      // Allow the service its full timeout plus headroom for cold start / proxy.
      signal: AbortSignal.timeout(timeout + 10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        source,
        url,
        status: 'failed',
        crawledAt: new Date(),
        error: `Stealth scraper returned ${res.status}: ${body.slice(0, 200)}`.trim(),
      };
    }

    const data = (await res.json()) as StealthScrapeResponse;

    if (data.status !== 'success' || !(data.markdown || data.html)) {
      return {
        source,
        url,
        status: data.status === 'timeout' ? 'timeout' : 'failed',
        crawledAt: new Date(),
        error: data.error ?? 'Stealth scraper returned no content',
      };
    }

    return {
      source,
      url,
      status: 'success',
      markdown: data.markdown,
      html: data.html,
      metadata: { engine: options.engine ?? 'default', finalUrl: data.finalUrl },
      crawledAt: new Date(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown stealth error';
    const isTimeout =
      message.toLowerCase().includes('timeout') ||
      message.toLowerCase().includes('timed out') ||
      message.toLowerCase().includes('abort');

    return {
      source,
      url,
      status: isTimeout ? 'timeout' : 'failed',
      crawledAt: new Date(),
      error: message,
    };
  }
}
