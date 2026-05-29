import { Camoufox } from 'camoufox-js';
import type { Browser } from 'playwright-core';
import {
  BLOCKED_RESOURCE_TYPES,
  type Engine,
  type FetchOptions,
  type FetchPageResult,
  type ProxyConfig,
} from './types.js';

const DEFAULT_TIMEOUT = 60_000;

function envProxy(): ProxyConfig | undefined {
  const server = process.env.STEALTH_PROXY_SERVER;
  if (!server) return undefined;
  return {
    server,
    username: process.env.STEALTH_PROXY_USERNAME,
    password: process.env.STEALTH_PROXY_PASSWORD,
  };
}

/**
 * Camoufox engine — an anti-detect Firefox build with C++-level fingerprint
 * spoofing. A fresh browser is launched per request to keep fingerprints/IPs
 * isolated. `geoip: true` aligns the fingerprint timezone/locale to the proxy IP.
 */
export const camoufoxEngine: Engine = {
  name: 'camoufox',

  async fetchPage(url: string, options: FetchOptions): Promise<FetchPageResult> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const proxy = options.proxy ?? envProxy();

    let browser: Browser | undefined;
    try {
      browser = (await Camoufox({
        headless: true,
        humanize: true,
        geoip: Boolean(proxy),
        // camoufox-js types `proxy` as a string, but it forwards a Playwright
        // proxy object to the browser at runtime, so cast through unknown.
        ...(proxy
          ? {
              proxy: {
                server: proxy.server,
                username: proxy.username,
                password: proxy.password,
              } as unknown as string,
            }
          : {}),
      })) as unknown as Browser;

      const page = await browser.newPage();

      await page.route('**/*', (route) => {
        if (BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())) {
          return route.abort();
        }
        return route.continue();
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

      if (typeof options.waitFor === 'number') {
        await page.waitForTimeout(options.waitFor);
      } else if (typeof options.waitFor === 'string' && options.waitFor) {
        await page.waitForSelector(options.waitFor, { timeout }).catch(() => {});
      }

      const html = await page.content();
      const finalUrl = page.url();
      return { html, finalUrl };
    } finally {
      await browser?.close().catch(() => {});
    }
  },
};
