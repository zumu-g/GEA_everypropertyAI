import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser } from 'playwright-core';
import {
  BLOCKED_RESOURCE_TYPES,
  type Engine,
  type FetchOptions,
  type FetchPageResult,
  type ProxyConfig,
} from './types.js';

const DEFAULT_TIMEOUT = 60_000;

// Register the stealth plugin once at module load. It patches the common
// headless/automation tells (navigator.webdriver, missing plugins, WebGL
// vendor, etc.) on the vanilla Playwright Chromium.
chromium.use(StealthPlugin());

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
 * Playwright engine — vanilla Playwright Chromium hardened with playwright-extra
 * and puppeteer-extra-plugin-stealth. An independently-maintained evasion stack
 * that sits alongside Camoufox (Firefox) and Patchright (CDP-patched Chromium),
 * useful as a fallback or A/B option when a target defeats the others.
 * Selected via STEALTH_ENGINE=playwright or per-request engine: 'playwright'.
 */
export const playwrightEngine: Engine = {
  name: 'playwright',

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
