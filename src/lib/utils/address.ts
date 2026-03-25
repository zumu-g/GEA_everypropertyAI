import type { StructuredAddress } from '@/types/property';

/**
 * Common Australian street type abbreviations mapped to their full forms.
 */
const STREET_TYPE_MAP: Record<string, string> = {
  st: 'Street',
  str: 'Street',
  street: 'Street',
  rd: 'Road',
  road: 'Road',
  ave: 'Avenue',
  avenue: 'Avenue',
  dr: 'Drive',
  drive: 'Drive',
  cres: 'Crescent',
  crescent: 'Crescent',
  ct: 'Court',
  court: 'Court',
  pl: 'Place',
  place: 'Place',
  ln: 'Lane',
  lane: 'Lane',
  cct: 'Circuit',
  circuit: 'Circuit',
  tce: 'Terrace',
  terrace: 'Terrace',
  pde: 'Parade',
  parade: 'Parade',
  hwy: 'Highway',
  highway: 'Highway',
  blvd: 'Boulevard',
  boulevard: 'Boulevard',
  cl: 'Close',
  close: 'Close',
  way: 'Way',
  gr: 'Grove',
  grove: 'Grove',
  esp: 'Esplanade',
  esplanade: 'Esplanade',
  cr: 'Crescent',
  prom: 'Promenade',
  promenade: 'Promenade',
};

/**
 * Australian state abbreviations for validation.
 */
const AUSTRALIAN_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

/**
 * Normalise a street type abbreviation to its full form.
 */
function normaliseStreetType(raw: string): string {
  return STREET_TYPE_MAP[raw.toLowerCase()] ?? raw;
}

/**
 * Parse a free-text Australian address into a StructuredAddress.
 *
 * Handles formats like:
 *   "5/42 Smith Street, Sydney NSW 2000"
 *   "Unit 5, 42 Smith St Sydney NSW 2000"
 *   "10 King Road Melbourne VIC 3000"
 *   "42 smith street sydney"
 */
export function parseAddress(raw: string): StructuredAddress {
  // Normalise whitespace and trim
  const cleaned = raw.trim().replace(/\s+/g, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ');

  let unit: string | undefined;
  let remaining = cleaned;

  // Extract unit — "Unit 5" or "5/" prefix
  const unitPrefixMatch = remaining.match(/^unit\s+(\w+)\s+/i);
  if (unitPrefixMatch) {
    unit = unitPrefixMatch[1];
    remaining = remaining.slice(unitPrefixMatch[0].length);
  } else {
    const slashUnitMatch = remaining.match(/^(\d+)\s*\/\s*/);
    if (slashUnitMatch) {
      unit = slashUnitMatch[1];
      remaining = remaining.slice(slashUnitMatch[0].length);
    }
  }

  const tokens = remaining.split(/\s+/).filter(Boolean);

  // Try to extract postcode (last token if 4 digits)
  let postcode = '';
  if (tokens.length > 0 && /^\d{4}$/.test(tokens[tokens.length - 1])) {
    postcode = tokens.pop()!;
  }

  // Try to extract state (last token if valid state abbreviation)
  let state = '';
  if (tokens.length > 0) {
    const candidateState = tokens[tokens.length - 1].toUpperCase();
    if (AUSTRALIAN_STATES.includes(candidateState)) {
      state = candidateState;
      tokens.pop();
    }
  }

  // First token should be street number
  let streetNumber = '';
  if (tokens.length > 0 && /^\d+[a-zA-Z]?$/.test(tokens[0])) {
    streetNumber = tokens.shift()!;
  }

  // Try to find a street type in the remaining tokens
  let streetTypeIndex = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (STREET_TYPE_MAP[tokens[i].toLowerCase()]) {
      streetTypeIndex = i;
      break;
    }
  }

  let streetName = '';
  let streetType = '';
  let suburb = '';

  if (streetTypeIndex >= 0) {
    streetName = tokens.slice(0, streetTypeIndex).join(' ');
    streetType = normaliseStreetType(tokens[streetTypeIndex]);
    suburb = tokens.slice(streetTypeIndex + 1).join(' ');
  } else {
    // No recognisable street type — heuristic: first token(s) are street name,
    // last token(s) are suburb. If only one token left, treat it as street name.
    if (tokens.length >= 2) {
      // Assume last token is suburb, rest is street name
      streetName = tokens.slice(0, -1).join(' ');
      suburb = tokens[tokens.length - 1];
    } else {
      streetName = tokens.join(' ');
    }
  }

  // Capitalise street name and suburb
  const capitalise = (s: string) =>
    s
      .split(' ')
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''))
      .join(' ');

  return {
    unit,
    streetNumber,
    streetName: capitalise(streetName),
    streetType,
    suburb: capitalise(suburb),
    state,
    postcode,
  };
}

/**
 * Convert a StructuredAddress into a URL-safe slug.
 *
 * Example: { streetNumber: "42", streetName: "Smith", streetType: "Street",
 *            suburb: "Sydney", state: "NSW", postcode: "2000" }
 *         -> "42-smith-street-sydney-nsw-2000"
 */
export function toSlug(address: StructuredAddress): string {
  const parts: string[] = [];

  if (address.unit) parts.push(address.unit);
  parts.push(
    address.streetNumber,
    address.streetName,
    address.streetType,
    address.suburb,
    address.state,
    address.postcode
  );

  return parts
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Format a StructuredAddress for human-readable display.
 *
 * Example: "Unit 5/42 Smith Street, Sydney NSW 2000"
 */
export function formatAddress(address: StructuredAddress): string {
  const streetParts: string[] = [];

  if (address.unit) {
    streetParts.push(`${address.unit}/${address.streetNumber}`);
  } else {
    streetParts.push(address.streetNumber);
  }

  streetParts.push(address.streetName);
  if (address.streetType) streetParts.push(address.streetType);

  const street = streetParts.filter(Boolean).join(' ');

  const locationParts: string[] = [];
  if (address.suburb) locationParts.push(address.suburb);
  if (address.state) locationParts.push(address.state);
  if (address.postcode) locationParts.push(address.postcode);

  const location = locationParts.join(' ');

  if (street && location) return `${street}, ${location}`;
  return street || location;
}
