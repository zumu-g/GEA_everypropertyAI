import type { StructuredAddress } from '@/types/property';
import { VIC_SUBURBS } from '@/data/vic-suburbs';

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
 * Title-case a suburb name for consistent storage.
 * "BEACONSFIELD UPPER" / "beaconsfield upper" → "Beaconsfield Upper".
 */
export function titleCaseSuburb(s: string | null | undefined): string | null {
  if (s == null) return null;
  const out = s
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ');
  return out || null;
}

/**
 * Reverse-name suburb aliases, derived from VIC_SUBURBS (not hand-maintained).
 *
 * Domain stores direction-suffixed suburbs as "<Primary> <Direction>" (e.g.
 * "Beaconsfield Upper", postcode 3808) but people often query the official
 * reversed form ("Upper Beaconsfield"). For every canonical name ending in a
 * direction we register the reversed string → canonical, unless that reversed
 * string is itself a real suburb (don't shadow a genuine name).
 */
const _DIRECTION_SUFFIX = /^(.+)\s(Upper|Lower|North|South|East|West|Central)$/;
let _suburbAliasMap: Map<string, string> | null = null;
function suburbAliasMap(): Map<string, string> {
  if (_suburbAliasMap) return _suburbAliasMap;
  const canonical = new Set(VIC_SUBURBS.map((s) => s.name.toLowerCase()));
  const m = new Map<string, string>();
  for (const s of VIC_SUBURBS) {
    const mt = s.name.match(_DIRECTION_SUFFIX);
    if (!mt) continue;
    const aliasKey = `${mt[2]} ${mt[1]}`.toLowerCase(); // "upper beaconsfield"
    if (canonical.has(aliasKey)) continue; // don't shadow a real suburb
    if (!m.has(aliasKey)) m.set(aliasKey, s.name);
  }
  _suburbAliasMap = m;
  return m;
}

/**
 * Normalise a queried suburb to the canonical name stored in the DB.
 * Resolves reversed-name aliases ("Upper Beaconsfield" → "Beaconsfield Upper");
 * otherwise falls back to title-casing. Safe to pass to a case-insensitive
 * `ilike` filter.
 */
export function normaliseSuburbAlias(raw: string | null | undefined): string {
  if (raw == null) return '';
  const key = raw.trim().toLowerCase();
  if (!key) return '';
  return suburbAliasMap().get(key) ?? titleCaseSuburb(raw) ?? raw.trim();
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
  // Normalise the street type ("Dr" → "Drive") so slugs match regardless of
  // whether the address came from ingest (parseAddress, already expanded) or
  // an autocomplete/URL StructuredAddress carrying the abbreviation. A
  // mismatch here silently breaks the feed-seed lookup (photos, beds/baths).
  parts.push(
    address.streetNumber,
    address.streetName,
    address.streetType ? normaliseStreetType(address.streetType) : address.streetType,
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
