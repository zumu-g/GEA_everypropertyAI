const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

let uaIndex = 0;

/**
 * Lightweight direct page fetch.
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
