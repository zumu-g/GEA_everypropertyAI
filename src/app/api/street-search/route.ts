import { NextRequest, NextResponse } from 'next/server';
import { fetchAddressSuggestions, type AddressSuggestion } from '@/lib/address-suggest';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/street-search?q=Rose+Garden+Ave+Officer+VIC
 *
 * Returns all known addresses on a given street by querying the REA suggest
 * API with the street name and filtering to consistent results.
 */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim();

  if (!query || query.length < 3) {
    return NextResponse.json(
      { suggestions: [], error: 'Query must be at least 3 characters.' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    // Fetch up to 20 suggestions matching the query
    const all = await fetchAddressSuggestions(query);

    // Derive the leading street tokens from the query (first 2–4 words before suburb/state/postcode)
    // e.g. "Rose Garden Ave Officer VIC" → leading tokens: ["rose", "garden", "ave"]
    const queryTokens = query.toLowerCase().split(/\s+/);
    const streetTokens = deriveStreetTokens(queryTokens);

    // Filter to suggestions whose streetAddress contains the key street words
    const filtered: AddressSuggestion[] = all.filter((s) => {
      const street = s.streetAddress.toLowerCase();
      return streetTokens.some((token) => street.includes(token));
    });

    // Deduplicate by fullAddress
    const seen = new Set<string>();
    const unique = filtered.filter((s) => {
      if (seen.has(s.fullAddress)) return false;
      seen.add(s.fullAddress);
      return true;
    });

    // Sort by street number numerically
    unique.sort((a, b) => {
      const numA = parseInt(a.streetAddress.match(/^\d+/)?.[0] ?? '0', 10);
      const numB = parseInt(b.streetAddress.match(/^\d+/)?.[0] ?? '0', 10);
      return numA - numB;
    });

    return NextResponse.json(
      { suggestions: unique.slice(0, 20), query },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error('[/api/street-search] Error:', error);
    return NextResponse.json(
      { suggestions: [], fallback: true },
      { status: 200, headers: CORS_HEADERS }
    );
  }
}

/**
 * Extract street-identifying tokens from the raw query words.
 * Strips trailing state abbreviations, postcodes, and suburb names
 * to leave just the street name words (e.g. "rose", "garden").
 */
function deriveStreetTokens(tokens: string[]): string[] {
  const stateAbbrs = new Set(['vic', 'nsw', 'qld', 'sa', 'wa', 'tas', 'nt', 'act']);
  const streetTypeSuffixes = new Set([
    'st', 'rd', 'ave', 'dr', 'cres', 'ct', 'pl', 'ln', 'tce', 'pde',
    'cct', 'cl', 'way', 'gr', 'blvd', 'hwy', 'esp', 'prom', 'circuit',
    'street', 'road', 'avenue', 'drive', 'crescent', 'court', 'place',
    'lane', 'terrace', 'parade', 'close', 'grove', 'boulevard', 'highway',
  ]);

  // Keep only tokens that are not states, postcodes, or street type suffixes
  // Take up to the first street type suffix (inclusive) to capture the street name
  const meaningful: string[] = [];
  for (const token of tokens) {
    if (/^\d{4}$/.test(token)) break; // postcode → stop
    if (stateAbbrs.has(token)) break; // state code → stop
    if (streetTypeSuffixes.has(token)) {
      meaningful.push(token);
      break; // include street type but stop after
    }
    meaningful.push(token);
  }

  // Return tokens that are at least 3 chars (avoids matching single letters)
  return meaningful.filter((t) => t.length >= 3);
}
