import { NextRequest, NextResponse } from 'next/server';
import { parseAddress, formatAddress } from '@/lib/utils/address';
import type { StructuredAddress } from '@/types/property';

const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface AddressSuggestion {
  placeId?: string;
  description: string;
  structured: StructuredAddress;
}

/**
 * OPTIONS /api/search — CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/search?q=42+smith+street+sydney
 *
 * Returns address suggestions using Mapbox (preferred) or Google Places
 * Autocomplete, falling back to local address parsing if neither is configured.
 */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim();

  if (!query || query.length < 3) {
    return NextResponse.json(
      { error: 'Query parameter "q" must be at least 3 characters.' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const suggestions = MAPBOX_TOKEN
      ? await fetchMapboxSuggestions(query)
      : GOOGLE_API_KEY
        ? await fetchGoogleSuggestions(query)
        : getLocalSuggestions(query);

    return NextResponse.json(
      { suggestions },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error('[/api/search] Error:', error);

    // Fall back to local parsing on any Google API failure
    const fallback = getLocalSuggestions(query);

    return NextResponse.json(
      { suggestions: fallback, fallback: true },
      { status: 200, headers: CORS_HEADERS }
    );
  }
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
  url.searchParams.set('types', 'address');
  url.searchParams.set('limit', '5');
  url.searchParams.set('access_token', MAPBOX_TOKEN!);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Mapbox geocoding API returned ${response.status}`);
  }

  const data = await response.json();
  const features: Array<{ id?: string; properties?: { full_address?: string; place_formatted?: string } }> =
    data?.features ?? [];

  if (features.length === 0) {
    return getLocalSuggestions(query);
  }

  return features.map((feature) => {
    const description =
      feature.properties?.full_address ?? feature.properties?.place_formatted ?? query;
    return {
      placeId: feature.id,
      description,
      structured: parseAddress(description),
    };
  });
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

  return data.predictions.map(
    (prediction: { place_id: string; description: string }) => {
      // Parse the description text into a structured address
      const structured = parseAddress(prediction.description);

      return {
        placeId: prediction.place_id,
        description: prediction.description,
        structured,
      };
    }
  );
}

/**
 * Fallback: parse the raw query into a single structured address suggestion.
 * Used when no Google API key is configured.
 */
function getLocalSuggestions(query: string): AddressSuggestion[] {
  const structured = parseAddress(query);
  const description = formatAddress(structured);

  // Only return a suggestion if we got at least a street name
  if (!structured.streetName) {
    return [];
  }

  return [
    {
      description,
      structured,
    },
  ];
}
