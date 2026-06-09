/**
 * Source-grounding verifier.
 *
 * Guarantees that extracted property fields are *actually present* in the raw
 * scraped content they claim to come from. Any value that cannot be located in
 * the source text is dropped (fail-closed). This is the deterministic mechanism
 * that prevents LLM-hallucinated values (e.g. a fabricated "Jane Doe" agent and
 * a round-number sale price) from surfacing in a property profile — prompt-level
 * "do not fabricate" instructions are not relied upon.
 *
 * Verification is field-type-aware:
 *   - numbers  → a matching numeric token must appear in the source (allowing
 *                comma / $ / m / k / million format variants)
 *   - strings  → the value must appear as a substring (case- and
 *                whitespace-insensitive)
 *   - dates    → the year, and the month when present, must appear in the source
 *   - arrays   → each element verified; sale/rental entries kept only when their
 *                core (price + date) verifies, with unverifiable sub-fields dropped
 *   - nested address → sub-fields verified as strings
 *   - unknown keys → dropped (fail-closed)
 *
 * Address/coordinates seeded from the resolved StructuredAddress + geocode are a
 * trusted, non-LLM source and are NOT passed through this verifier by callers.
 */

const NUMBER_FIELDS = new Set([
  'bedrooms', 'bathrooms', 'ensuites', 'toilets', 'carSpaces', 'garages',
  'landArea', 'buildingArea', 'frontageMetres', 'depthMetres', 'yearBuilt',
  'storeys', 'currentPrice', 'priceNumeric', 'priceFrom', 'priceTo',
  'estimatedValue', 'estimatedValueLow', 'estimatedValueHigh', 'councilRates',
  'daysOnMarket',
]);

const STRING_FIELDS = new Set([
  'propertyType', 'priceLabel', 'listingStatus', 'listingAgent', 'listingAgency',
  'agencyName', 'agentName', 'agentPhone', 'description', 'headline',
  'floorPlanUrl', 'construction', 'roofType', 'council',
]);

const DATE_FIELDS = new Set(['dateFirstListed']);

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** Lowercase, strip non-alphanumerics (keep spaces), collapse whitespace. */
function normaliseText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Build the set of numeric values present in the source (format-variant aware). */
function buildNumberSet(source: string): Set<number> {
  const set = new Set<number>();
  const re = /\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(million|m|k)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const base = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(base)) continue;
    const suffix = (m[2] ?? '').toLowerCase();
    let value = base;
    if (suffix === 'm' || suffix === 'million') value = base * 1_000_000;
    else if (suffix === 'k') value = base * 1_000;
    set.add(Math.round(value));
    set.add(Math.round(base)); // also the un-suffixed reading
  }
  return set;
}

function verifyNumber(value: number, numberSet: Set<number>): boolean {
  return Number.isFinite(value) && numberSet.has(Math.round(value));
}

function verifyString(value: string, normSource: string): boolean {
  const norm = normaliseText(value);
  return norm.length > 0 && normSource.includes(norm);
}

/** A date value verifies when its year (and month, if present) appear in source. */
function verifyDate(value: string, source: string, normSource: string): boolean {
  const iso = value.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
  let year: string | undefined;
  let monthIdx: number | undefined;
  if (iso) {
    year = iso[1];
    monthIdx = parseInt(iso[2], 10) - 1;
  } else {
    const y = value.match(/\b(19|20)\d{2}\b/);
    if (y) year = y[0];
    const mName = MONTHS.findIndex((mn) => normaliseText(value).includes(mn));
    if (mName >= 0) monthIdx = mName;
  }
  if (!year || !source.includes(year)) return false;
  if (monthIdx === undefined || monthIdx < 0) return true; // year-only granularity
  const monthName = MONTHS[monthIdx];
  const monthNum = String(monthIdx + 1).padStart(2, '0');
  return (
    normSource.includes(monthName) ||
    normSource.includes(monthName.slice(0, 3)) ||
    source.includes(`-${monthNum}-`) ||
    source.includes(`/${monthNum}/`)
  );
}

// Sub-field verification config for sale/rental history entries.
const ENTRY_NUMBER_FIELDS = new Set(['price', 'listingPrice', 'weeklyRent', 'bond', 'daysOnMarket']);
const ENTRY_STRING_FIELDS = new Set(['agency', 'agentName', 'type', 'description', 'leaseTerm', 'source']);
const ENTRY_DATE_FIELDS = new Set(['date', 'settlementDate']);

function groundEntry(
  entry: Record<string, unknown>,
  ctx: { numberSet: Set<number>; source: string; normSource: string }
): Record<string, unknown> | null {
  const price = entry.price ?? entry.weeklyRent ?? entry.listingPrice;
  const date = entry.date ?? entry.settlementDate;

  // Core gate: any present core field must verify, and at least one must be present + verified.
  let verifiedCore = 0;
  if (price !== undefined && price !== null) {
    if (typeof price === 'number' && verifyNumber(price, ctx.numberSet)) verifiedCore++;
    else return null;
  }
  if (date !== undefined && date !== null) {
    if (typeof date === 'string' && verifyDate(date, ctx.source, ctx.normSource)) verifiedCore++;
    else return null;
  }
  if (verifiedCore === 0) return null;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (v === undefined || v === null || v === '') continue;
    if (ENTRY_NUMBER_FIELDS.has(k)) {
      if (typeof v === 'number' && verifyNumber(v, ctx.numberSet)) out[k] = v;
    } else if (ENTRY_DATE_FIELDS.has(k)) {
      if (typeof v === 'string' && verifyDate(v, ctx.source, ctx.normSource)) out[k] = v;
    } else if (ENTRY_STRING_FIELDS.has(k)) {
      if (typeof v === 'string' && verifyString(v, ctx.normSource)) out[k] = v;
    }
    // unknown entry keys dropped (fail-closed)
  }
  return out;
}

/**
 * Return only the fields whose values are provably present in `source`.
 * `fields` is a plain extraction map (e.g. ExtractedPropertyData.raw or .data).
 */
export function groundFields(
  fields: Record<string, unknown>,
  source: string
): Record<string, unknown> {
  const numberSet = buildNumberSet(source);
  const normSource = normaliseText(source);
  const ctx = { numberSet, source, normSource };
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;

    if (NUMBER_FIELDS.has(key)) {
      if (typeof value === 'number' && verifyNumber(value, numberSet)) out[key] = value;
      else if (typeof value === 'string' && verifyNumber(Number(value), numberSet)) out[key] = Number(value);
    } else if (STRING_FIELDS.has(key)) {
      if (typeof value === 'string' && verifyString(value, normSource)) out[key] = value;
    } else if (DATE_FIELDS.has(key)) {
      if (typeof value === 'string' && verifyDate(value, source, normSource)) out[key] = value;
    } else if (key === 'features') {
      if (Array.isArray(value)) {
        const kept = value.filter((f) => typeof f === 'string' && verifyString(f, normSource));
        if (kept.length > 0) out[key] = kept;
      }
    } else if (key === 'photos') {
      if (Array.isArray(value)) {
        const kept = value.filter((u) => typeof u === 'string' && source.includes(u));
        if (kept.length > 0) out[key] = kept;
      }
    } else if (key === 'saleHistory' || key === 'rentalHistory') {
      if (Array.isArray(value)) {
        const kept = (value as Record<string, unknown>[])
          .map((e) => (e && typeof e === 'object' ? groundEntry(e, ctx) : null))
          .filter((e): e is Record<string, unknown> => e !== null && Object.keys(e).length > 0);
        if (kept.length > 0) out[key] = kept;
      }
    } else if (key === 'address') {
      if (value && typeof value === 'object') {
        const addr: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (typeof v === 'string' && verifyString(v, normSource)) addr[k] = v;
          else if (typeof v === 'number' && verifyNumber(v, numberSet)) addr[k] = v;
        }
        if (Object.keys(addr).length > 0) out[key] = addr;
      }
    }
    // unknown keys dropped (fail-closed)
  }

  return out;
}
