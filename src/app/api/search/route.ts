import { NextRequest, NextResponse } from 'next/server';
import { parseAddress } from '@/lib/utils/address';

const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
// Victoria bounding box (minLon,minLat,maxLon,maxLat) — biases Mapbox results to VIC.
const VIC_BBOX = '140.96,-39.20,150.04,-33.98';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** Flat suggestion shape consumed by the proposal builder's autocomplete. */
interface AddressSuggestion {
  fullAddress: string;
  streetAddress?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  placeId?: string;
}

/** Normalised "Street, Suburb STATE Postcode" — clean for display and for passing
 * straight to /api/proposal. Falls back to the raw string if parts are missing. */
function composeFull(
  raw: string,
  parts: { streetAddress?: string; suburb?: string; state?: string; postcode?: string }
): string {
  if (parts.streetAddress && parts.suburb && parts.state) {
    return `${parts.streetAddress}, ${parts.suburb} ${parts.state}${parts.postcode ? ' ' + parts.postcode : ''}`;
  }
  return raw;
}

/** Build the flat suggestion from a full address string (+ optional provider id). */
function toSuggestion(fullAddress: string, placeId?: string): AddressSuggestion | null {
  const full = fullAddress?.trim();
  if (!full) return null; // fullAddress is required
  const s = parseAddress(full);
  const streetAddress = [s.streetNumber, s.streetName, s.streetType].filter(Boolean).join(' ').trim() || undefined;
  const parts = { streetAddress, suburb: s.suburb || undefined, state: s.state || undefined, postcode: s.postcode || undefined };
  return { fullAddress: composeFull(full, parts), ...parts, placeId };
}

/** Valid bearer tokens: EVERYPROPERTY_API_KEYS (comma-separated) ∪ EVERYPROPERTY_API_TOKEN. */
function validTokens(): Set<string> {
  const keys = (process.env.EVERYPROPERTY_API_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const single = process.env.EVERYPROPERTY_API_TOKEN?.trim();
  if (single) keys.push(single);
  return new Set(keys);
}

function isAuthorised(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  if (!auth?.toLowerCase().startsWith('bearer ')) return false;
  const token = auth.slice(7).trim();
  return token.length > 0 && validTokens().has(token);
}

/**
 * OPTIONS /api/search — CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/search?q=<partial address>
 *
 * Fast (<1s) address type-ahead for the proposal builder. Up to 8 VIC-biased
 * suggestions via Mapbox (preferred) → Google → local parse fallback. Never
 * triggers the property crawl. Auth: Bearer token (same as /api/proposal).
 *   - missing `q` param        → 400
 *   - `q` present but < 3 chars → 200 { suggestions: [] }
 */
export async function GET(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
  }

  const sp = request.nextUrl.searchParams;
  if (!sp.has('q')) {
    return NextResponse.json(
      { error: 'Query parameter "q" is required.' },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  const query = (sp.get('q') ?? '').trim();
  if (query.length < 3) {
    return NextResponse.json({ suggestions: [] }, { status: 200, headers: CORS_HEADERS });
  }

  let suggestions: AddressSuggestion[];
  try {
    suggestions = MAPBOX_TOKEN
      ? await fetchMapboxSuggestions(query)
      : GOOGLE_API_KEY
        ? await fetchGoogleSuggestions(query)
        : getLocalSuggestions(query);
  } catch (error) {
    console.error('[/api/search] Error:', error);
    suggestions = getLocalSuggestions(query); // fall back to local parse on provider failure
  }

  return NextResponse.json(
    { suggestions: suggestions.slice(0, 8) },
    { status: 200, headers: CORS_HEADERS }
  );
}

/**
 * Fetch address suggestions from the Mapbox forward-geocoding API (autocomplete
 * mode), restricted to AU addresses. Maps each feature to our AddressSuggestion
 * shape via the local address parser.
 */
async function fetchMapboxSuggestions(query: string): Promise<AddressSuggestion[]> {
  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  url.searchParams.set('q', query);
  url.searchParams.set('autocomplete', 'true');
  url.searchParams.set('country', 'au');
  url.searchParams.set('bbox', VIC_BBOX); // bias to Victoria
  url.searchParams.set('types', 'address');
  url.searchParams.set('limit', '8');
  url.searchParams.set('access_token', MAPBOX_TOKEN!);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Mapbox geocoding API returned ${response.status}`);
  }

  const data = await response.json();
  type Ctx = { name?: string; region_code?: string };
  const features: Array<{
    id?: string;
    properties?: {
      full_address?: string;
      place_formatted?: string;
      name?: string;
      context?: { address?: Ctx; locality?: Ctx; place?: Ctx; region?: Ctx; postcode?: Ctx };
    };
  }> = data?.features ?? [];

  if (features.length === 0) {
    return getLocalSuggestions(query);
  }

  // Use Mapbox's structured `context` for clean suburb/state/postcode rather than
  // string-parsing the full address (which mangles "Victoria 3806, Australia").
  return features
    .map((f): AddressSuggestion | null => {
      const p = f.properties ?? {};
      const raw = (p.full_address ?? p.place_formatted ?? '').trim();
      if (!raw) return null;
      const c = p.context ?? {};
      const parts = {
        streetAddress: p.context?.address?.name ?? p.name ?? undefined,
        suburb: c.locality?.name ?? c.place?.name ?? undefined,
        state: c.region?.region_code ?? c.region?.name ?? undefined,
        postcode: c.postcode?.name ?? undefined,
      };
      return { fullAddress: composeFull(raw, parts), ...parts, placeId: f.id };
    })
    .filter((s): s is AddressSuggestion => s !== null);
}

/**
 * Fetch address suggestions from Google Places Autocomplete API.
 */
async function fetchGoogleSuggestions(query: string): Promise<AddressSuggestion[]> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  url.searchParams.set('input', query);
  url.searchParams.set('types', 'address');
  url.searchParams.set('components', 'country:au');
  url.searchParams.set('key', GOOGLE_API_KEY!);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Google Places API returned ${response.status}`);
  }

  const data = await response.json();

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places API status: ${data.status}`);
  }

  if (!data.predictions || data.predictions.length === 0) {
    return getLocalSuggestions(query);
  }

  return data.predictions
    .map((prediction: { place_id: string; description: string }) => {
      // Google AU descriptions end with ", Australia" — strip it so parseAddress
      // reads the trailing "VIC 3806" as state/postcode rather than the country.
      const full = prediction.description.replace(/,\s*Australia\s*$/i, '').trim();
      return toSuggestion(full, prediction.place_id);
    })
    .filter((s: AddressSuggestion | null): s is AddressSuggestion => s !== null);
}

/**
 * Fallback: parse the raw query into a single suggestion. Used when no provider
 * key is configured or a provider call fails. Only suggests if we got a street
 * name (avoids echoing garbage).
 */
function getLocalSuggestions(query: string): AddressSuggestion[] {
  const structured = parseAddress(query);
  if (!structured.streetName) return [];
  const s = toSuggestion(query.trim());
  return s ? [s] : [];
}
