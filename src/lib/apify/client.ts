import type { CrawlResult } from '@/types/crawl';
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
  extraInput?: Record<string, unknown>
): Promise<CrawlResult> {
  try {
    const token = getToken();
    const input: Record<string, unknown> = {
      startUrls: [{ url }],
      maxItems: 5,
      ...extraInput,
    };

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

    return {
      source,
      url,
      status: 'success',
      markdown: actorItemsToMarkdown(items),
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
