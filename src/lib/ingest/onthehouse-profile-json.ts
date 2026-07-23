/**
 * Convert an onthehouse.com.au CoreLogic "odin" API response into LLM-ready
 * markdown + deterministic extraction.
 *
 * Unlike the portal sources, onthehouse serves NOTHING useful in its page HTML —
 * the detail is client-loaded from an unauthenticated JSON API:
 *   GET /odin/api/locations?query={address}   → resolve address → othPropertyId
 *   GET /odin/api/properties/{othPropertyId}  → the full structured record
 * (see sources/onthehouse.ts for the two-stage discovery that resolves the id).
 *
 * The detail record carries the subject (beds/baths/carSpaces/land/floor/type/
 * yearBuilt), a valuation estimate, and the last sale — all as clean JSON, so the
 * deterministic extraction below bypasses the LLM extractor (exact values, no
 * transcription drift).
 *
 * Both functions accept the raw response TEXT (the fetch backend hands us a
 * string) and return null when it isn't a valid property record (a shell/404/
 * error body) so the orchestrator treats the fetch as failed and continues the
 * fallback chain.
 */

import type { ExtractedPropertyData } from '@/types/property';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** ISO day (YYYY-MM-DD) from a date-ish string. */
const isoDay = (v: unknown): string | undefined => str(v)?.slice(0, 10);

/**
 * Parse the JSON object out of a fetch body. The Web Unlocker/firecrawl backends
 * return the raw JSON for an API endpoint, but a defensive slice to the first
 * balanced-looking `{…}` tolerates a body that arrives wrapped (e.g. `<pre>`).
 */
function parseJsonBody(text: string): Obj | null {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    const direct = JSON.parse(trimmed);
    return isObj(direct) ? direct : null;
  } catch {
    // fall through to substring extraction
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const sliced = JSON.parse(trimmed.slice(start, end + 1));
    return isObj(sliced) ? sliced : null;
  } catch {
    return null;
  }
}

/** A property record is the odin detail node (has category Property + an id). */
function asPropertyRecord(text: string): Obj | null {
  const obj = parseJsonBody(text);
  if (!obj) return null;
  const isProperty =
    str(obj.category) === 'Property' || str(obj.othPropertyId) !== undefined || isObj(obj.address);
  return isProperty ? obj : null;
}

/** Title-case a SHOUTED odin string ("NORHAM" → "Norham", "House" passthrough). */
function titleCase(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return v.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase());
}

/** Expand odin's abbreviated street type ("CT" → "Court") for a clean address. */
const STREET_TYPE_FULL: Record<string, string> = {
  st: 'Street', rd: 'Road', ave: 'Avenue', av: 'Avenue', dr: 'Drive', ct: 'Court',
  pl: 'Place', cr: 'Crescent', cres: 'Crescent', cl: 'Close', pde: 'Parade',
  tce: 'Terrace', hwy: 'Highway', bvd: 'Boulevard', blvd: 'Boulevard', ln: 'Lane',
  cct: 'Circuit', gr: 'Grove', sq: 'Square', esp: 'Esplanade', wy: 'Way',
};
function expandStreetType(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return STREET_TYPE_FULL[v.toLowerCase().replace(/\./g, '')] ?? titleCase(v);
}

// ─── Deterministic extraction ────────────────────────────────────────────────

export function onthehousePropertyJsonToExtraction(text: string): ExtractedPropertyData | null {
  const rec = asPropertyRecord(text);
  if (!rec) return null;

  const raw: Obj = {};
  const set = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== '') raw[k] = v;
  };

  const address = isObj(rec.address) ? rec.address : {};
  const location = isObj(address.location) ? address.location : {};
  if (Object.keys(address).length > 0) {
    raw.address = {
      fullAddress: titleCase(str(address.formattedAddress)),
      streetNumber: str(address.streetNumber),
      streetName: titleCase(str(address.streetName)),
      streetType: expandStreetType(str(address.streetType)),
      suburb: titleCase(str(address.suburb)),
      state: str(address.stateCode),
      postcode: str(address.postCode),
    };
    set('latitude', num(location.lat));
    set('longitude', num(location.lon));
  }

  set('propertyType', str(rec.type)?.toLowerCase());
  set('bedrooms', num(rec.beds));
  set('bathrooms', num(rec.baths));
  set('carSpaces', num(rec.carSpaces));
  set('landArea', num(rec.landSize));
  set('buildingArea', num(rec.floorSize));
  set('yearBuilt', num(rec.yearBuilt));

  const legal = isObj(rec.legalAttributes) ? rec.legalAttributes : {};
  set('lotPlan', str(legal['Lot/Plan']));
  set('councilArea', str(legal['Local Government Authority']));

  // Valuation estimate (onthehouse "guesstimate").
  const est = isObj(rec.guesstimate) ? rec.guesstimate : undefined;
  if (est) {
    set('estimatedValue', num(est.price));
    set('estimatedValueFrom', num(est.fromPrice));
    set('estimatedValueTo', num(est.toPrice));
  }

  // Last sale → saleHistory entry.
  const sale = isObj(rec.lastSale) ? rec.lastSale : undefined;
  if (sale) {
    const agency = isObj(sale.sellingAgency) ? sale.sellingAgency : undefined;
    const entry: Obj = {};
    const setE = (k: string, v: unknown) => {
      if (v !== undefined && v !== null && v !== '') entry[k] = v;
    };
    setE('date', isoDay(sale.eventDate));
    setE('price', num(sale.salePrice));
    setE('source', str(sale.saleSource));
    setE('agency', agency ? str(agency.name) : undefined);
    if (Object.keys(entry).length > 0) set('saleHistory', [entry]);
  }

  // Subject attributes are the point — an id/address-only record is not useful.
  const hasSubject = ['bedrooms', 'bathrooms', 'landArea', 'buildingArea', 'propertyType'].some(
    (k) => raw[k] !== undefined
  );
  if (!hasSubject) return null;

  return { source: 'onthehouse.com.au', raw, extractedAt: new Date() };
}

// ─── Markdown (LLM fallback / storage) ───────────────────────────────────────

export function onthehousePropertyJsonToMarkdown(text: string): string | null {
  const rec = asPropertyRecord(text);
  if (!rec) return null;

  const address = isObj(rec.address) ? rec.address : {};
  const lines: string[] = [];
  const push = (label: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== '') lines.push(`- ${label}: ${v}`);
  };

  const addr = titleCase(str(address.formattedAddress));
  if (addr) lines.push(`# ${addr}`, '');
  push('Property type', str(rec.type));
  push('Bedrooms', num(rec.beds));
  push('Bathrooms', num(rec.baths));
  push('Car spaces', num(rec.carSpaces));
  push('Land size (m²)', num(rec.landSize));
  push('Floor size (m²)', num(rec.floorSize));
  push('Year built', num(rec.yearBuilt));

  const legal = isObj(rec.legalAttributes) ? rec.legalAttributes : {};
  push('Lot/Plan', str(legal['Lot/Plan']));
  push('Council', str(legal['Local Government Authority']));

  const est = isObj(rec.guesstimate) ? rec.guesstimate : undefined;
  if (est) push('Estimated value', num(est.price));

  const sale = isObj(rec.lastSale) ? rec.lastSale : undefined;
  if (sale) {
    const agency = isObj(sale.sellingAgency) ? sale.sellingAgency : undefined;
    const parts = [isoDay(sale.eventDate), num(sale.salePrice) ? `$${num(sale.salePrice)}` : undefined, agency ? str(agency.name) : undefined]
      .filter(Boolean)
      .join(' · ');
    if (parts) push('Last sale', parts);
  }

  // Need the subject at minimum — an address-only stub is useless.
  const hasSubject = lines.some((l) => /Bedrooms|Bathrooms|Land size|Floor size|Property type/.test(l));
  return hasSubject ? lines.join('\n') : null;
}

// ─── Discovery: locations → othPropertyId ────────────────────────────────────

interface AddressKey {
  streetNumber?: string;
  streetName?: string;
  unitNumber?: string;
}

/**
 * Match an odin /locations response against a target address and return the
 * winning othPropertyId, or null when no exact street-number match exists.
 *
 * The locations endpoint returns the street itself (empty streetNumber) plus one
 * entry per house number; we require an exact streetNumber match so "3 Norham Ct"
 * never resolves to "1 Norham Ct".
 */
export function matchLocationPropertyId(text: string, target: AddressKey): string | null {
  const body = parseJsonBody(text);
  const content = body && Array.isArray(body.content) ? body.content : null;
  if (!content) return null;

  const wantNum = (target.streetNumber ?? '').trim().toLowerCase();
  const wantName = (target.streetName ?? '').trim().toLowerCase();
  const wantUnit = (target.unitNumber ?? '').trim().toLowerCase();
  if (!wantNum || !wantName) return null;

  for (const raw of content) {
    if (!isObj(raw)) continue;
    const id = str(raw.propertyId);
    // The street-level stub uses a non-numeric propertyId (e.g. "BERWICK+VIC…");
    // real properties have a numeric othPropertyId.
    if (!id || !/^\d+$/.test(id)) continue;
    const num_ = (str(raw.streetNumber) ?? '').toLowerCase();
    const name = (str(raw.streetName) ?? '').toLowerCase();
    const unit = (str(raw.unitNumber) ?? '').toLowerCase();
    if (num_ === wantNum && name === wantName && (!wantUnit || unit === wantUnit)) {
      return id;
    }
  }
  return null;
}
