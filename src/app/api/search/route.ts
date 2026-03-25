import { NextRequest, NextResponse } from 'next/server';
import { parseAddress, formatAddress } from '@/lib/utils/address';
import type { StructuredAddress } from '@/types/property';

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
 * Returns address suggestions using Google Places Autocomplete,
 * or falls back to local address parsing if no API key is configured.
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
    const suggestions = GOOGLE_API_KEY
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
