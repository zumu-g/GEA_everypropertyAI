import { chromium } from 'patchright';
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
 * Patchright engine — a stealth Chromium drop-in for Playwright that patches the
 * CDP/headless tells. Easier to deploy than Firefox and also defeats Kasada.
 * Used as the swappable fallback (STEALTH_ENGINE=patchright or per-request).
 */
export const patchrightEngine: Engine = {
  name: 'patchright',

  async fetchPage(url: string, options: FetchOptions): Promise<FetchPageResult> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const proxy = options.proxy ?? envProxy();

    let browser: Browser | undefined;
    try {
      browser = (await chromium.launch({
        headless: true,
        ...(proxy
          ? {
              proxy: {
                server: proxy.server,
                username: proxy.username,
                password: proxy.password,
              },
            }
          : {}),
      })) as unknown as Browser;

      const context = await browser.newContext();
      const page = await context.newPage();

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
