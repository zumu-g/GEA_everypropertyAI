export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

export interface FetchOptions {
  /** Navigation/total timeout in ms. */
  timeout?: number;
  /** Either a CSS selector to wait for, or a number of ms to wait after load. */
  waitFor?: string | number;
  /** Per-request residential proxy (overrides the service default). */
  proxy?: ProxyConfig;
}

export interface FetchPageResult {
  html: string;
  finalUrl: string;
}

/**
 * A stealth browser engine. Implementations launch a hardened browser, navigate
 * to the URL, and return the rendered HTML. Camoufox (Firefox), Patchright
 * (CDP-patched Chromium) and Playwright (stealth-plugin Chromium) conform to
 * this so the engine is swappable at runtime.
 */
export interface Engine {
  readonly name: 'camoufox' | 'patchright' | 'playwright';
  fetchPage(url: string, options: FetchOptions): Promise<FetchPageResult>;
}

/** Resource types blocked on every request to cut proxy bandwidth and latency. */
export const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);
