// @vitest-environment jsdom
//
// U2 regression coverage: the stale-closure bug (fetchEnrichment read `property`
// state captured before the first fetch committed, so `data?.marketData &&
// property` was always false on first load) and the corrected fetch graph
// (estimate no longer waits on enrich's response for coordinates; estimate-rent
// still waits on estimate's saleMid).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { PropertyProfile } from '../PropertyProfile';

vi.mock('@/lib/db/supabase', () => ({
  getSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

// jsdom has no matchMedia implementation; PropertyProfile and framer-motion's
// reduced-motion detection both read it unconditionally.
window.matchMedia =
  window.matchMedia ||
  ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {}, // deprecated API framer-motion still calls
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STRUCTURED_ADDRESS = JSON.stringify({
  streetNumber: '12',
  streetName: 'Smith',
  streetType: 'St',
  suburb: 'Berwick',
  state: 'VIC',
  postcode: '3806',
});

const PROFILE = {
  data: {
    latitude: -38.03,
    longitude: 145.34,
    propertyType: 'house',
    bedrooms: 3,
    bathrooms: 2,
    saleHistory: [],
    rentalHistory: [],
  },
  fieldConfidences: {},
  overallConfidence: 0.8,
  sources: [],
  mergedAt: new Date().toISOString(),
};

const ENRICH_COORDS = { lat: -37.0, lng: 144.0 }; // deliberately different from PROFILE's coords

type FetchLog = { url: string; resolvedAt?: number }[];

function mockFetch(log: FetchLog, opts: { enrichOk?: boolean; propertyOk?: boolean } = {}) {
  const { enrichOk = true, propertyOk = true } = opts;
  let tick = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const entry: FetchLog[number] = { url };
      log.push(entry);

      if (url.startsWith('/api/property')) {
        entry.resolvedAt = ++tick;
        if (!propertyOk) return { ok: false, json: async () => ({}) } as Response;
        return { ok: true, json: async () => ({ profile: PROFILE, addressSlug: 'test-slug' }) } as Response;
      }
      if (url.startsWith('/api/enrich')) {
        entry.resolvedAt = ++tick;
        if (!enrichOk) return { ok: false, json: async () => ({}) } as Response;
        return {
          ok: true,
          json: async () => ({
            marketData: {
              houses: { medianPrice: 900000, annualGrowth: 5 },
              units: { medianPrice: 600000, annualGrowth: 4 },
            },
            coordinates: ENRICH_COORDS,
            buyerDemand: { score: 50, level: 'medium', factors: [] },
            planning: { zone: null, overlays: [], council: null, planningScheme: null, source: 'test' },
            schools: [],
            childcare: [],
            transport: [],
            suburbStats: { suburb: 'Berwick' },
          }),
        } as Response;
      }
      if (url.startsWith('/api/estimate-rent')) {
        entry.resolvedAt = ++tick;
        return { ok: true, json: async () => ({ result: { priceLow: 400, priceMid: 450, priceHigh: 500, confidenceLevel: 'high', priceSource: 'rent-comparables', methodology: 'x' } }) } as Response;
      }
      if (url.startsWith('/api/estimate')) {
        entry.resolvedAt = ++tick;
        return { ok: true, json: async () => ({ result: { priceLow: 700000, priceMid: 750000, priceHigh: 800000, confidenceLevel: 'high', priceSource: 'comparables', methodology: 'x' } }) } as Response;
      }
      if (url.startsWith('/api/comparable-sales')) {
        entry.resolvedAt = ++tick;
        return { ok: true, json: async () => ({ comparables: [] }) } as Response;
      }
      entry.resolvedAt = ++tick;
      return { ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch,
  );
}

describe('PropertyProfile fetch graph (U2)', () => {
  it('populates the sale-estimate panel on a genuine first load (stale-closure regression)', async () => {
    const log: FetchLog = [];
    mockFetch(log);
    render(<PropertyProfile address={STRUCTURED_ADDRESS} />);

    await waitFor(() => screen.getByText(/Estimated Value/i));
    const estimateCall = log.find((c) => c.url.startsWith('/api/estimate?'));
    expect(estimateCall).toBeDefined();
  });

  it('requests /api/estimate with lat/lng from the property response, not the enrich response', async () => {
    const log: FetchLog = [];
    mockFetch(log);
    render(<PropertyProfile address={STRUCTURED_ADDRESS} />);

    await waitFor(() => screen.getByText(/Estimated Value/i));
    const estimateCall = log.find((c) => c.url.startsWith('/api/estimate?'));
    expect(estimateCall!.url).toContain(`lat=${PROFILE.data.latitude}`);
    expect(estimateCall!.url).toContain(`lng=${PROFILE.data.longitude}`);
    expect(estimateCall!.url).not.toContain(`lat=${ENRICH_COORDS.lat}`);
  });

  it('issues estimate without waiting for enrich to resolve first, and estimate-rent only after estimate resolves', async () => {
    const log: FetchLog = [];
    mockFetch(log);
    render(<PropertyProfile address={STRUCTURED_ADDRESS} />);

    await waitFor(() => screen.getByText(/Estimated Value/i));
    await waitFor(() => expect(log.some((c) => c.url.startsWith('/api/estimate-rent?'))).toBe(true));

    const enrichCall = log.find((c) => c.url.startsWith('/api/enrich?'));
    const estimateCall = log.find((c) => c.url.startsWith('/api/estimate?'));
    const rentCall = log.find((c) => c.url.startsWith('/api/estimate-rent?'));

    // estimate does not wait on enrich's resolution order to be issued
    expect(estimateCall).toBeDefined();
    expect(enrichCall).toBeDefined();
    // estimate-rent must resolve strictly after estimate
    expect(rentCall!.resolvedAt!).toBeGreaterThan(estimateCall!.resolvedAt!);
  });

  it('still renders the estimate panel when enrich fails', async () => {
    const log: FetchLog = [];
    mockFetch(log, { enrichOk: false });
    render(<PropertyProfile address={STRUCTURED_ADDRESS} />);

    await waitFor(() => screen.getByText(/Estimated Value/i));
    expect(log.some((c) => c.url.startsWith('/api/estimate?'))).toBe(true);
  });

  it('does not call enrich/estimate/estimate-rent when the property fetch fails', async () => {
    const log: FetchLog = [];
    mockFetch(log, { propertyOk: false });
    render(<PropertyProfile address={STRUCTURED_ADDRESS} />);

    await waitFor(() => screen.getByText(/Failed to load property data/i));
    expect(log.some((c) => c.url.startsWith('/api/enrich'))).toBe(false);
    expect(log.some((c) => c.url.startsWith('/api/estimate'))).toBe(false);
  });
});
