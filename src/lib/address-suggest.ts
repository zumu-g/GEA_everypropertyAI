/**
 * Server-side address suggestion using realestate.com.au consumer suggest API.
 */

export interface AddressSuggestion {
  display: string;
  suburb: string;
  state: string;
  postcode: string;
  streetAddress: string;
  fullAddress: string;
  slug?: string;
}

interface REASuggestionSource {
  shortAddress?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  streetName?: string;
  streetNumber?: string;
  streetType?: string;
}

interface REASuggestion {
  display?: {
    text?: string;
    subtext?: string;
  };
  source?: REASuggestionSource;
  id?: string;
}

interface REAResponse {
  _embedded?: {
    suggestions?: REASuggestion[];
  };
}

const SUGGEST_URL =
  'https://suggest.realestate.com.au/consumer-suggest/suggestions';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Fetch address suggestions from realestate.com.au suggest API.
 * Optionally filter by Australian state code (e.g. 'VIC', 'NSW').
 */
export async function fetchAddressSuggestions(
  query: string,
  stateFilter?: string
): Promise<AddressSuggestion[]> {
  const url = new URL(SUGGEST_URL);
  url.searchParams.set('max', '20');
  url.searchParams.set('type', 'address');
  url.searchParams.set('src', 'homepage');
  url.searchParams.set('query', query);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`REA suggest API returned ${response.status}`);
  }

  const data: REAResponse = await response.json();
  const raw = data?._embedded?.suggestions ?? [];

  let suggestions = raw
    .map(parseSuggestion)
    .filter((s): s is AddressSuggestion => s !== null);

  // Filter by state if explicitly requested
  if (stateFilter) {
    const filtered = suggestions.filter(
      (s) => s.state.toUpperCase() === stateFilter.toUpperCase()
    );
    // Only apply filter if it leaves results; otherwise return all
    if (filtered.length > 0) {
      return filtered.slice(0, 8);
    }
  }

  return suggestions.slice(0, 20); // Return more so the API route can sort & trim
}

/**
 * Parse a single REA suggestion into our AddressSuggestion format.
 * Prefers structured `source` data; falls back to parsing `display.text`.
 */
function parseSuggestion(raw: REASuggestion): AddressSuggestion | null {
  const src = raw.source;
  const displayText = raw.display?.text ?? '';

  if (!displayText && !src) return null;

  // Prefer structured source data
  if (src?.suburb && src?.state) {
    const streetAddress =
      src.shortAddress ??
      [src.streetNumber, src.streetName, src.streetType]
        .filter(Boolean)
        .join(' ');

    const fullAddress = [
      streetAddress,
      `${src.suburb}, ${src.state} ${src.postcode ?? ''}`.trim(),
    ]
      .filter(Boolean)
      .join(', ');

    return {
      display: displayText || fullAddress,
      suburb: src.suburb,
      state: src.state,
      postcode: src.postcode ?? '',
      streetAddress,
      fullAddress,
      slug: raw.id ?? undefined,
    };
  }

  // Fallback: parse display.text
  return parseDisplayText(displayText, raw.id);
}

/**
 * Fallback parser for when `source` is missing.
 * Splits display.text on commas: "17 Rose Garden Ave, Officer, VIC 3809"
 */
function parseDisplayText(
  text: string,
  id?: string
): AddressSuggestion | null {
  if (!text) return null;

  const parts = text.split(',').map((p) => p.trim());
  if (parts.length < 2) return null;

  const streetAddress = parts[0];

  // Last part should contain "Suburb STATE Postcode" or "STATE Postcode"
  // Try to find state + postcode in the remaining parts
  const remainder = parts.slice(1).join(', ').trim();

  // Match pattern: "Suburb STATE 1234" or "Suburb, STATE 1234"
  const match = remainder.match(
    /^(.+?)[\s,]+([A-Z]{2,3})\s+(\d{4})$/
  );

  if (match) {
    return {
      display: text,
      suburb: match[1].replace(/,\s*$/, '').trim(),
      state: match[2],
      postcode: match[3],
      streetAddress,
      fullAddress: text,
      slug: id ?? undefined,
    };
  }

  // Simpler pattern: just "Suburb STATE"
  const simpleMatch = remainder.match(/^(.+?)[\s,]+([A-Z]{2,3})$/);
  if (simpleMatch) {
    return {
      display: text,
      suburb: simpleMatch[1].replace(/,\s*$/, '').trim(),
      state: simpleMatch[2],
      postcode: '',
      streetAddress,
      fullAddress: text,
      slug: id ?? undefined,
    };
  }

  return {
    display: text,
    suburb: remainder,
    state: '',
    postcode: '',
    streetAddress,
    fullAddress: text,
    slug: id ?? undefined,
  };
}
