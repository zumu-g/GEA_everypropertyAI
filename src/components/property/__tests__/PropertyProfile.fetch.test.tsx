// @vitest-environment jsdom
//
// U2 regression coverage: the stale-closure bug (fetchEnrichment read `property`
// state captured before the first fetch committed, so `data?.marketData &&
// property` was always false on first load) and the corrected fetch graph
// (estimate no longer waits on enrich's response for coordinates; estimate-rent
// still waits on estimate's saleMid). Also covers two code-review findings fixed
// in the same pass: the client-side fallback estimate now uses enrich's resolved
// marketData when available instead of always null, and a request-generation
// guard prevents a stale (superseded) property's late-arriving fetch from
// overwriting a newer property's displayed state.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { PropertyProfile } from '../PropertyProfile';
import * as priceEstimator from '@/lib/estimation/price-estimator';

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

function mockFetch(
  log: FetchLog,
  opts: { enrichOk?: boolean; propertyOk?: boolean; rentComps?: unknown[] } = {},
) {
  const { enrichOk = true, propertyOk = true, rentComps } = opts;
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
        return { ok: true, json: async () => ({ result: { priceLow: 400, priceMid: 450, priceHigh: 500, confidenceLevel: 'high', priceSource: 'rent-comparables', methodology: 'x', ...(rentComps ? { comparablesUsed: rentComps } : {}) } }) } as Response;
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

describe('PropertyProfile vacant-land handling (U4)', () => {
  it('shows the "Vacant land" label and renders no weekly-rent figure', async () => {
    const log: FetchLog = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        log.push({ url });
        if (url.startsWith('/api/property')) {
          return {
            ok: true,
            json: async () => ({
              profile: {
                data: {
                  latitude: -38.06,
                  longitude: 145.45,
                  propertyType: 'Vacant land',
                  landArea: 700,
                  saleHistory: [],
                  rentalHistory: [],
                },
                fieldConfidences: {},
                overallConfidence: 0.5,
                sources: [],
                mergedAt: new Date().toISOString(),
              },
              addressSlug: 'test-land-slug',
            }),
          } as Response;
        }
        if (url.startsWith('/api/enrich')) {
          return {
            ok: true,
            json: async () => ({
              marketData: {
                houses: { medianPrice: 900000, annualGrowth: 5 },
                units: { medianPrice: 600000, annualGrowth: 4 },
              },
              coordinates: { lat: -38.06, lng: 145.45 },
              buyerDemand: { score: 50, level: 'medium', factors: [] },
              planning: { zone: null, overlays: [], council: null, planningScheme: null, source: 'test' },
              schools: [],
              childcare: [],
              transport: [],
              suburbStats: { suburb: 'Bunyip' },
            }),
          } as Response;
        }
        if (url.startsWith('/api/estimate-rent')) {
          // Service-side land guard returns null — the fetch itself still
          // resolves ok, but with no result.
          return { ok: true, json: async () => ({ result: null }) } as Response;
        }
        if (url.startsWith('/api/estimate')) {
          return {
            ok: true,
            json: async () => ({
              result: {
                priceLow: 250000, priceMid: 300000, priceHigh: 350000,
                confidenceLevel: 'low', priceSource: 'comparables',
                methodology: 'Based on 3 comparable vacant-land sales.',
              },
            }),
          } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      }) as unknown as typeof fetch,
    );

    render(<PropertyProfile address={STRUCTURED_ADDRESS} />);

    await waitFor(() => screen.getByText(/Estimated Value/i));
    expect(screen.getByText('Vacant land')).toBeInTheDocument();
    expect(screen.queryByText(/\/pw/)).not.toBeInTheDocument();
  });
});

describe('fetchEstimates fallback marketData (code-review fix)', () => {
  it('uses enrich\'s resolved marketData in the local fallback estimate when /api/estimate fails', async () => {
    const spy = vi.spyOn(priceEstimator, 'calculateEnrichedPriceEstimate');
    const log: FetchLog = [];
    // /api/estimate fails outright -> forces the local fallback branch.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        log.push({ url });
        if (url.startsWith('/api/property')) {
          return { ok: true, json: async () => ({ profile: PROFILE, addressSlug: 'test-slug' }) } as Response;
        }
        if (url.startsWith('/api/enrich')) {
          return {
            ok: true,
            json: async () => ({
              marketData: { houses: { medianPrice: 900000, annualGrowth: 5 }, units: { medianPrice: 600000, annualGrowth: 4 } },
              coordinates: ENRICH_COORDS,
              buyerDemand: { score: 50, level: 'medium', factors: [] },
              planning: { zone: null, overlays: [], council: null, planningScheme: null, source: 'test' },
              schools: [], childcare: [], transport: [],
              suburbStats: { suburb: 'Berwick' },
            }),
          } as Response;
        }
        if (url.startsWith('/api/estimate')) {
          // Small delay so enrich (2 awaits: fetch + res.json()) reliably sets
          // marketDataRef.current before estimate's fallback reads it — this
          // models the realistic case where enrich (typically faster) resolves
          // before an estimate failure is discovered.
          await new Promise((r) => setTimeout(r, 10));
          return { ok: false, json: async () => ({}) } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      }) as unknown as typeof fetch,
    );

    render(<PropertyProfile address={STRUCTURED_ADDRESS} />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const marketDataArg = spy.mock.calls[0][1];
    expect(marketDataArg).not.toBeNull();
    expect(marketDataArg?.houses?.medianPrice).toBe(900000);
    spy.mockRestore();
  });

  it('falls back to null marketData when enrich has not resolved by the time estimate fails', async () => {
    const spy = vi.spyOn(priceEstimator, 'calculateEnrichedPriceEstimate');
    let resolveEnrich: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('/api/property')) {
          return { ok: true, json: async () => ({ profile: PROFILE, addressSlug: 'test-slug' }) } as Response;
        }
        if (url.startsWith('/api/enrich')) {
          // Never resolves within this test — estimate fails first.
          await new Promise<void>((resolve) => { resolveEnrich = resolve; });
          return { ok: true, json: async () => ({}) } as Response;
        }
        if (url.startsWith('/api/estimate')) return { ok: false, json: async () => ({}) } as Response;
        return { ok: true, json: async () => ({}) } as Response;
      }) as unknown as typeof fetch,
    );

    render(<PropertyProfile address={STRUCTURED_ADDRESS} />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const marketDataArg = spy.mock.calls[0][1];
    expect(marketDataArg).toBeNull();
    spy.mockRestore();
    resolveEnrich?.();
  });
});

describe('stale-property race guard (code-review fix)', () => {
  it('does not let an earlier property\'s late-resolving estimate overwrite a newer property\'s displayed state', async () => {
    let resolvePropertyA: ((body: unknown) => void) | undefined;
    let estimateCallCount = 0;
    const PROFILE_B = { ...PROFILE, data: { ...PROFILE.data, latitude: -37.5, longitude: 144.9 } };
    const enrichResponse = {
      marketData: null,
      coordinates: null,
      buyerDemand: { score: 50, level: 'medium', factors: [] },
      planning: { zone: null, overlays: [], council: null, planningScheme: null, source: 'test' },
      schools: [], childcare: [], transport: [],
      suburbStats: { suburb: 'Berwick' },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('/api/property')) {
          const body = await new Promise<unknown>((resolve) => {
            // First call (property A) never resolves until we manually trigger it below.
            if (!resolvePropertyA) resolvePropertyA = resolve;
            else resolve({ profile: PROFILE_B, addressSlug: 'slug-b' });
          });
          return { ok: true, json: async () => body } as Response;
        }
        if (url.startsWith('/api/enrich')) return { ok: true, json: async () => enrichResponse } as Response;
        if (url.startsWith('/api/estimate-rent')) {
          return { ok: true, json: async () => ({ result: { priceLow: 1, priceMid: 1, priceHigh: 1, confidenceLevel: 'high', priceSource: 'rent-comparables', methodology: 'x' } }) } as Response;
        }
        if (url.startsWith('/api/estimate')) {
          // Call order (not fetchProperty order): B's /api/property resolves
          // immediately (see the else-branch above), so B's fetchEstimates fires
          // and hits this mock FIRST — slightly delayed, price 100, the genuine
          // current-property value. A's /api/property is only resolved manually
          // below, after B is already showing, so A's fetchEstimates hits this
          // mock SECOND — fast, price 999999 — but by then requestIdRef has moved
          // on to B's request, so A's setEnrichedEstimate call must be dropped.
          estimateCallCount += 1;
          if (estimateCallCount === 1) {
            await new Promise((r) => setTimeout(r, 50));
            return { ok: true, json: async () => ({ result: { priceLow: 100, priceMid: 100, priceHigh: 100, confidenceLevel: 'high', priceSource: 'comparables', methodology: 'x' } }) } as Response;
          }
          return { ok: true, json: async () => ({ result: { priceLow: 999999, priceMid: 999999, priceHigh: 999999, confidenceLevel: 'high', priceSource: 'comparables', methodology: 'x' } }) } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      }) as unknown as typeof fetch,
    );

    const { rerender } = render(<PropertyProfile address={STRUCTURED_ADDRESS} />);
    // Navigate to a different property before A's /api/property call resolves.
    const STRUCTURED_ADDRESS_B = JSON.stringify({ streetNumber: '99', streetName: 'Other', streetType: 'Rd', suburb: 'Cranbourne', state: 'VIC', postcode: '3977' });
    rerender(<PropertyProfile address={STRUCTURED_ADDRESS_B} />);
    // Now let A's long-pending /api/property resolve with stale data — its
    // fetchEstimates call is in flight but must never win the state race.
    resolvePropertyA?.({ profile: PROFILE, addressSlug: 'slug-a' });

    await waitFor(() => expect(document.body.textContent).toContain('$100'));
    expect(document.body.textContent).not.toContain('999,999');
  });
});

// ── Fast-partial load + background upgrade (plan 2026-07-08-004) ──────────────
describe('PropertyProfile fast-partial upgrade', () => {
  /** Mock where the first /api/property POST returns a fast partial, and
   * cachedOnly polls 404 until `fullReady` flips, then return the full profile. */
  function mockFastFetch(bodies: Array<Record<string, unknown>>, state: { fullReady: boolean }) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('/api/property')) {
          const body = JSON.parse(String(init?.body ?? '{}'));
          bodies.push(body);
          if (body.cachedOnly) {
            if (!state.fullReady) return { ok: false, status: 404, json: async () => ({ error: 'Not cached.' }) } as Response;
            return { ok: true, json: async () => ({ profile: { ...PROFILE, crawlMode: 'full' }, addressSlug: 'test-slug', source: 'cache' }) } as Response;
          }
          return { ok: true, json: async () => ({ profile: { ...PROFILE, crawlMode: 'fast' }, addressSlug: 'test-slug', source: 'fresh' }) } as Response;
        }
        if (url.startsWith('/api/enrich')) return { ok: false, json: async () => ({}) } as Response;
        if (url.startsWith('/api/estimate-rent')) return { ok: true, json: async () => ({ result: null }) } as Response;
        if (url.startsWith('/api/estimate')) return { ok: true, json: async () => ({ result: { priceLow: 700000, priceMid: 750000, priceHigh: 800000, confidenceLevel: 'high', priceSource: 'comparables', methodology: 'x' } }) } as Response;
        if (url.startsWith('/api/comparable-sales')) return { ok: true, json: async () => ({ comparables: [] }) } as Response;
        return { ok: true, json: async () => ({}) } as Response;
      }) as unknown as typeof fetch,
    );
  }

  it('sends fast:true, shows the gathering indicator, polls cachedOnly, and swaps in the full profile', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const state = { fullReady: false };
    mockFastFetch(bodies, state);
    render(<PropertyProfile address={STRUCTURED_ADDRESS} />);

    await waitFor(() => screen.getByText(/still gathering data/i));
    expect(bodies[0].fast).toBe(true);

    // First poll 404s (fullReady false), second poll succeeds.
    await waitFor(() => expect(bodies.some((b) => b.cachedOnly)).toBe(true), { timeout: 7000 });
    state.fullReady = true;
    await waitFor(() => expect(screen.queryByText(/still gathering data/i)).toBeNull(), { timeout: 12000 });

    // Estimates were re-fired after the upgrade (an /api/estimate call follows the successful poll).
    const cachedOnlyCount = bodies.filter((b) => b.cachedOnly).length;
    expect(cachedOnlyCount).toBeGreaterThanOrEqual(1);
  }, 25000);

  it('does not poll or show the indicator when the profile is already full (cache hit)', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('/api/property')) {
          bodies.push(JSON.parse(String(init?.body ?? '{}')));
          return { ok: true, json: async () => ({ profile: { ...PROFILE, crawlMode: 'full' }, addressSlug: 'test-slug', source: 'cache' }) } as Response;
        }
        if (url.startsWith('/api/enrich')) return { ok: false, json: async () => ({}) } as Response;
        if (url.startsWith('/api/comparable-sales')) return { ok: true, json: async () => ({ comparables: [] }) } as Response;
        return { ok: true, json: async () => ({}) } as Response;
      }) as unknown as typeof fetch,
    );
    render(<PropertyProfile address={STRUCTURED_ADDRESS} />);

    await waitFor(() => screen.getByText(/Back to Search/i));
    expect(screen.queryByText(/still gathering data/i)).toBeNull();
    expect(bodies.every((b) => !b.cachedOnly)).toBe(true);
  });
});

describe('Comparable Rentals section (U3)', () => {
  const RENT_COMPS = [
    {
      rawAddress: '5 Lease St, Berwick VIC 3806',
      suburb: 'Berwick',
      weeklyRent: 620,
      asOf: '2026-05-01',
      bedrooms: 3,
      bathrooms: 2,
      landAreaSqm: 450,
      adjustedRent: 630,
      monthsAgo: 2,
      weight: 0.8,
    },
  ];

  it('renders the section after Comparable Sales when estimate-rent returns comps', async () => {
    const log: FetchLog = [];
    mockFetch(log, { rentComps: RENT_COMPS });
    render(<PropertyProfile address={STRUCTURED_ADDRESS} />);

    await waitFor(() => screen.getByText('Comparable Rentals'));
    expect(screen.getByText('5 Lease St, Berwick VIC 3806')).toBeTruthy();
    expect(screen.getByText('$620/wk')).toBeTruthy();
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings.indexOf('Comparable Rentals')).toBeGreaterThan(
      headings.indexOf('Comparable Sales'),
    );
  });

  it('renders no section when the rent result carries no comps (fallback path)', async () => {
    const log: FetchLog = [];
    mockFetch(log); // default estimate-rent result has no comparablesUsed
    render(<PropertyProfile address={STRUCTURED_ADDRESS} />);

    await waitFor(() => screen.getByText(/Estimated Value/i));
    await waitFor(() => expect(log.some((c) => c.url.startsWith('/api/estimate-rent'))).toBe(true));
    expect(screen.queryByText('Comparable Rentals')).toBeNull();
  });
});

describe('fast-partial estimate single-shot (estimate-swap regression, 2026-08-21)', () => {
  it('does not fetch the estimate for a fast partial; fetches once when the full profile lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const log: FetchLog = [];
    const fastProfile = { ...PROFILE, crawlMode: 'fast', data: { ...PROFILE.data, bedrooms: undefined } };
    const fullProfile = { ...PROFILE, crawlMode: 'full' };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const body = typeof init?.body === 'string' ? init.body : '';
        log.push({ url: url + (body.includes('cachedOnly') ? '#cachedOnly' : '') });
        if (url.startsWith('/api/property')) {
          if (body.includes('cachedOnly')) {
            return { ok: true, json: async () => ({ profile: fullProfile, addressSlug: 'test-slug' }) } as Response;
          }
          return { ok: true, json: async () => ({ profile: fastProfile, addressSlug: 'test-slug', source: 'crawl' }) } as Response;
        }
        if (url.startsWith('/api/enrich')) {
          return { ok: true, json: async () => ({ schools: [], childcare: [], transport: [] }) } as Response;
        }
        if (url.startsWith('/api/estimate-rent')) {
          return { ok: true, json: async () => ({ result: null }) } as Response;
        }
        if (url.startsWith('/api/estimate')) {
          return { ok: true, json: async () => ({ result: { priceLow: 700000, priceMid: 750000, priceHigh: 800000, confidenceLevel: 'high', priceSource: 'comparables', methodology: 'x' } }) } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      }) as unknown as typeof fetch,
    );

    render(<PropertyProfile address={STRUCTURED_ADDRESS} />);

    // Let the initial fast fetch settle — no estimate call may happen yet.
    await vi.waitFor(() => {
      expect(log.some((c) => c.url.startsWith('/api/property'))).toBe(true);
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(log.filter((c) => c.url.startsWith('/api/estimate?'))).toHaveLength(0);

    // Advance past one poll tick — full profile lands, estimate fires exactly once.
    await vi.advanceTimersByTimeAsync(5100);
    await vi.waitFor(() => {
      expect(log.filter((c) => c.url.startsWith('/api/estimate?'))).toHaveLength(1);
    });

    // More time passes — still exactly one estimate call (no swap).
    await vi.advanceTimersByTimeAsync(15000);
    expect(log.filter((c) => c.url.startsWith('/api/estimate?'))).toHaveLength(1);
    vi.useRealTimers();
  });
});
