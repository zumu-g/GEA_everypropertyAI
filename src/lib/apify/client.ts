import type { CrawlResult } from '@/types/crawl';
import type { StructuredAddress } from '@/types/property';
import { actorItemsToMarkdown } from './format';

const APIFY_BASE = 'https://api.apify.com/v2';

function getToken(): string {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN is not set.');
  return token;
}

interface ApifyRunData {
  id: string;
  status: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'ABORTED' | 'RUNNING';
  defaultDatasetId: string;
  statusMessage?: string;
}

async function startActorRun(
  actorId: string,
  input: Record<string, unknown>,
  waitSecs: number,
  token: string
): Promise<ApifyRunData> {
  const encodedId = encodeURIComponent(actorId);
  const res = await fetch(
    `${APIFY_BASE}/acts/${encodedId}/runs?token=${token}&waitForFinish=${waitSecs}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((waitSecs + 30) * 1000),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify run failed (${res.status}): ${body}`);
  }
  const json = await res.json() as { data: ApifyRunData };
  return json.data;
}

async function fetchDatasetItems(
  datasetId: string,
  token: string
): Promise<Record<string, unknown>[]> {
  const res = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&clean=true`,
    { signal: AbortSignal.timeout(30_000) }
  );
  if (!res.ok) {
    throw new Error(`Apify dataset fetch failed (${res.status})`);
  }
  const items = await res.json() as unknown;
  return Array.isArray(items) ? items : [];
}

/**
 * Run an Apify actor with the given input and return a CrawlResult.
 * Converts the actor's JSON output to LLM-ready markdown so it fits the
 * existing extraction pipeline without any other changes.
 *
 * Waits up to 90 seconds for the actor to finish before giving up.
 */
export async function scrapeWithApify(
  url: string,
  source: string,
  actorId: string,
  extraInput?: Record<string, unknown>,
  targetAddress?: string | StructuredAddress
): Promise<CrawlResult> {
  try {
    const token = getToken();
    const input: Record<string, unknown> = {
      startUrls: [{ url }],
      maxItems: 5,
      ...extraInput,
    };
    // Some actors (e.g. view.com.au) run in "url mode" and expect a `urls`
    // string array rather than `startUrls`. When a source opts into url mode
    // via apifyInput, supply the target URL in the shape the actor wants.
    if (input.mode === 'url' && !input.urls) {
      input.urls = [url];
    }

    const run = await startActorRun(actorId, input, 90, token);

    if (run.status !== 'SUCCEEDED') {
      return {
        source,
        url,
        status: 'failed',
        crawledAt: new Date(),
        error: `Apify actor ended with status ${run.status}: ${run.statusMessage ?? ''}`.trim(),
      };
    }

    const items = await fetchDatasetItems(run.defaultDatasetId, token);

    if (items.length === 0) {
      return {
        source,
        url,
        status: 'failed',
        crawledAt: new Date(),
        error: 'Apify actor returned no results',
      };
    }

    // Some actors "succeed" but emit an error-shaped payload (e.g. view.com.au
    // returns { error: true, message: 'No results found' } when the property
    // URL has no listing). Treat that as a failure so the cascade falls through
    // to the stealth backend instead of feeding the junk to the LLM extractor.
    const allErrors = items.every(
      (it) => it && typeof it === 'object' && (it as { error?: unknown }).error === true
    );
    if (allErrors) {
      const msg = (items[0] as { message?: unknown }).message;
      return {
        source,
        url,
        status: 'failed',
        crawledAt: new Date(),
        error: `Apify actor error: ${typeof msg === 'string' ? msg : 'unknown'}`,
      };
    }

    return {
      source,
      url,
      status: 'success',
      markdown: actorItemsToMarkdown(items, targetAddress),
      metadata: { apifyRunId: run.id, itemCount: items.length },
      crawledAt: new Date(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Apify error';
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
