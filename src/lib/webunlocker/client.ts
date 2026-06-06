import type { CrawlResult } from '@/types/crawl';

// ─── Environment ─────────────────────────────────────────────────────────────
// Bright Data Web Unlocker is a managed anti-bot fetch API: POST a URL, get back
// the fully-rendered HTML with the anti-bot challenge (PerimeterX/DataDome/etc.)
// solved server-side. Unlike the stealth scraper it needs no browser on our side
// and no fingerprint engineering. When the token/zone are unset the backend fails
// soft — callers fall back to another source/backend.

const WU_ENDPOINT = 'https://api.brightdata.com/request';
const WU_TOKEN = process.env.BRIGHTDATA_WEB_UNLOCKER_TOKEN ?? '';
const WU_ZONE = process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE ?? '';

const DEFAULT_TIMEOUT = 90_000; // Web Unlocker renders JS → 3–8s typical, allow headroom.
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 1_500;

/** Whether the Web Unlocker backend is configured. Mirrors isStealthConfigured(). */
export const isWebUnlockerConfigured = (): boolean => Boolean(WU_TOKEN && WU_ZONE);

interface ScrapeOptions {
  timeout?: number;
  /** Max fetch attempts (transient 4xx/5xx are retried with backoff). */
  maxAttempts?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL via Bright Data Web Unlocker and return a CrawlResult.
 *
 * Same contract as scrapeWithStealth()/scrapeWithApify(): never throws — on any
 * error (unconfigured, network, non-2xx after retries, timeout) it returns a
 * 'failed'/'timeout' CrawlResult so one backend can't break the caller. Transient
 * failures (429/5xx/network) are retried with linear backoff up to maxAttempts.
 */
export async function scrapeWithWebUnlocker(
  url: string,
  source: string,
  options: ScrapeOptions = {}
): Promise<CrawlResult> {
  if (!isWebUnlockerConfigured()) {
    return {
      source,
      url,
      status: 'failed',
      crawledAt: new Date(),
      error: 'Web Unlocker not configured (BRIGHTDATA_WEB_UNLOCKER_TOKEN / _ZONE unset)',
    };
  }

  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const maxAttempts = Math.max(1, options.maxAttempts ?? MAX_ATTEMPTS);
  let lastError = 'unknown error';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(WU_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${WU_TOKEN}`,
        },
        // format:'raw' → the response body IS the rendered HTML of `url`.
        body: JSON.stringify({ zone: WU_ZONE, url, format: 'raw' }),
        signal: AbortSignal.timeout(timeout),
      });

      if (res.ok) {
        const html = await res.text();
        if (!html) {
          lastError = 'Web Unlocker returned empty body';
        } else {
          return {
            source,
            url,
            status: 'success',
            html,
            metadata: { backend: 'web-unlocker', attempt },
            crawledAt: new Date(),
          };
        }
      } else {
        lastError = `Web Unlocker HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`.trim();
        // 4xx other than 429 are not retriable.
        if (res.status !== 429 && res.status < 500) break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Web Unlocker error';
      const isTimeout = /timeout|timed out|abort/i.test(message);
      if (isTimeout && attempt >= maxAttempts) {
        return { source, url, status: 'timeout', crawledAt: new Date(), error: message };
      }
      lastError = message;
    }

    if (attempt < maxAttempts) await sleep(BACKOFF_MS * attempt);
  }

  return { source, url, status: 'failed', crawledAt: new Date(), error: lastError };
}
