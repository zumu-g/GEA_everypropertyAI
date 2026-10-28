// Area normalisation for .mjs scripts — mirrors src/lib/utils/area.ts (scripts
// cannot import TS; keep in sync with normaliseAreaSqm there).

const SQM_PER_ACRE = 4046.8564224;
const SQM_PER_HECTARE = 10000;

function unitFromToken(token) {
  const t = token.toLowerCase().replace(/[.\s]/g, '');
  if (/^(m2|m²|sqm|sq m|squaremetres?|squaremeters?)$/.test(t)) return 'sqm';
  if (/^(ac|acre|acres)$/.test(t)) return 'acre';
  if (/^(ha|hectare|hectares)$/.test(t)) return 'hectare';
  return null;
}

function toSqm(value, unit) {
  switch (unit) {
    case 'acre': return value * SQM_PER_ACRE;
    case 'hectare': return value * SQM_PER_HECTARE;
    default: return value;
  }
}

/**
 * Normalise a source area value to square metres.
 * Returns m² rounded to 1 dp, or null for 0/negative/unparseable values and
 * unrecognised explicit units (never guess).
 */
export function normaliseAreaSqm(value, unitHint) {
  let numeric = null;
  let unit = null;

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
