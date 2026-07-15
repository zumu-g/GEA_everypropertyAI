/**
 * Area normalisation for property land/building sizes.
 *
 * All stored and returned areas are square metres. Source data (Domain Apify
 * items, crawl extractions) is usually a bare number already in m², but
 * acreage listings can carry acres/hectares — either as an explicit unit hint
 * field or embedded in a string value ("2.5 ac", "1.2ha"). Zero and negative
 * values are treated as missing (never 0-as-data), per the sold-sales
 * enrichment plan: a 0 must come back null so a profile value can fill it.
 *
 * Never guess: a value with an explicit unit we don't recognise returns null.
 */

const SQM_PER_ACRE = 4046.8564224;
const SQM_PER_HECTARE = 10000;

type Unit = 'sqm' | 'acre' | 'hectare';

function unitFromToken(token: string): Unit | null {
  const t = token.toLowerCase().replace(/[.\s]/g, '');
  if (/^(m2|m²|sqm|sq m|squaremetres?|squaremeters?)$/.test(t)) return 'sqm';
  if (/^(ac|acre|acres)$/.test(t)) return 'acre';
  if (/^(ha|hectare|hectares)$/.test(t)) return 'hectare';
  return null;
}

function toSqm(value: number, unit: Unit): number {
  switch (unit) {
    case 'acre': return value * SQM_PER_ACRE;
    case 'hectare': return value * SQM_PER_HECTARE;
    default: return value;
  }
}

/**
 * Normalise a source area value to square metres.
 *
 * - `value`: number, or string possibly carrying an embedded unit token
 * - `unitHint`: explicit unit field from the source item, when present
 *
 * Returns m² rounded to 1 decimal place, or null for 0/negative/unparseable
 * values and unrecognised explicit units.
 */
export function normaliseAreaSqm(value: unknown, unitHint?: unknown): number | null {
  let numeric: number | null = null;
  let unit: Unit | null = null;

  if (typeof unitHint === 'string' && unitHint.trim()) {
    unit = unitFromToken(unitHint);
    if (unit === null) return null; // explicit unit we don't recognise — never guess
  }

  if (typeof value === 'number') {
    numeric = value;
  } else if (typeof value === 'string' && value.trim()) {
    // "1,012 m²" / "2.5 ac" / "650" — number first, optional trailing unit token
    const m = value.trim().match(/^([\d,]+(?:\.\d+)?)\s*([a-zA-Z²\s.]+)?$/);
    if (!m) return null;
    numeric = Number(m[1].replace(/,/g, ''));
    if (m[2] && m[2].trim()) {
      const embedded = unitFromToken(m[2]);
      if (embedded === null) return null; // explicit unit we don't recognise
      // an explicit unitHint param wins over an embedded token
      if (unit === null) unit = embedded;
    }
  } else {
    return null;
  }

  if (numeric === null || !Number.isFinite(numeric) || numeric <= 0) return null;

  const sqm = toSqm(numeric, unit ?? 'sqm');
  return Math.round(sqm * 10) / 10;
}

// ponytail: floor below which a "sqm" land value is implausible garbage (most
// likely an unconverted hectare/acre figure from extraction) rather than a
// real tiny lot — raise if a legitimate use case needs smaller values.
const MIN_PLAUSIBLE_LAND_SQM = 10;

/** Zero-as-missing guard for values already stored in m² (DB read path). */
export function sqmOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_PLAUSIBLE_LAND_SQM
    ? value
    : null;
}
