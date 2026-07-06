// @vitest-environment jsdom
//
// U5 regression coverage: property photos render via next/image (not raw
// <img>), the hero is priority-loaded (no lazy-loading attribute, so it's
// eligible as the LCP candidate), and gallery thumbnails lazy-load.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { PropertyProfile } from '../PropertyProfile';

vi.mock('@/lib/db/supabase', () => ({
  getSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

window.matchMedia =
  window.matchMedia ||
  ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
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

const HERO_URL = 'https://rimh2.domainstatic.com.au/hero.jpg';
const THUMB_URL = 'https://rimh2.domainstatic.com.au/thumb2.jpg';

const PROFILE = {
  data: {
    latitude: -38.03,
    longitude: 145.34,
    propertyType: 'house',
    photos: [HERO_URL, THUMB_URL],
    saleHistory: [],
    rentalHistory: [],
    address: { fullAddress: '12 Smith St, Berwick VIC 3806' },
  },
  fieldConfidences: {},
  overallConfidence: 0.8,
  sources: [],
  mergedAt: new Date().toISOString(),
};

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/property')) {
        return { ok: true, json: async () => ({ profile: PROFILE, addressSlug: 'test-slug' }) } as Response;
      }
      if (url.startsWith('/api/enrich')) {
        return {
          ok: true,
          json: async () => ({
            marketData: null,
            coordinates: null,
            buyerDemand: { score: 50, level: 'medium', factors: [] },
            planning: { zone: null, overlays: [], council: null, planningScheme: null, source: 'test' },
            schools: [],
            childcare: [],
            transport: [],
            suburbStats: { suburb: 'Berwick' },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch,
  );
}

describe('PropertyProfile photo rendering (U5)', () => {
  it('renders the hero via next/image, eager (no lazy-loading attribute) for LCP', async () => {
    mockFetch();
    render(<PropertyProfile address={STRUCTURED_ADDRESS} />);

    const hero = await waitFor(() => screen.getByAltText('12 Smith St, Berwick VIC 3806'));
    expect(hero.tagName).toBe('IMG');
    expect(hero.getAttribute('data-nimg')).toBe('fill'); // proof it's next/image, not a raw <img>
    expect(hero.hasAttribute('loading')).toBe(false); // priority → no lazy-loading attribute
    expect(hero.getAttribute('srcset')).toBeTruthy();
  });

  it('renders gallery thumbnails via next/image, lazily (loading=lazy)', async () => {
    mockFetch();
    render(<PropertyProfile address={STRUCTURED_ADDRESS} />);

    const thumb = await waitFor(() => screen.getByAltText('Photo 2'));
    expect(thumb.getAttribute('data-nimg')).toBe('fill');
    expect(thumb.getAttribute('loading')).toBe('lazy');
  });
});
