/**
 * Geocoding using Nominatim (OpenStreetMap). No API key required.
 * Rate limited to 1 request per second.
 */

const STATE_EXPANSIONS: Record<string, string> = {
  VIC: 'Victoria',
  NSW: 'New South Wales',
  QLD: 'Queensland',
  SA: 'South Australia',
  WA: 'Western Australia',
  TAS: 'Tasmania',
  NT: 'Northern Territory',
  ACT: 'Australian Capital Territory',
};

const STREET_TYPE_EXPANSIONS: Record<string, string> = {
  St: 'Street',
  Rd: 'Road',
  Ave: 'Avenue',
  Dr: 'Drive',
  Cres: 'Crescent',
  Ct: 'Court',
  Pl: 'Place',
  Ln: 'Lane',
  Tce: 'Terrace',
  Pde: 'Parade',
  Cct: 'Circuit',
  Cl: 'Close',
  Bvd: 'Boulevard',
  Hwy: 'Highway',
  Gr: 'Grove',
};

// In-memory cache
const cache = new Map<string, { lat: number; lng: number } | null>();
let lastRequestTime = 0;

function normaliseKey(address: string): string {
  return address.toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ').trim();
}

function expandAbbreviations(address: string): string {
  let expanded = address;
  // Expand state abbreviations
  for (const [abbr, full] of Object.entries(STATE_EXPANSIONS)) {
    expanded = expanded.replace(new RegExp(`\\b${abbr}\\b`, 'g'), full);
  }
  // Expand street types
  for (const [abbr, full] of Object.entries(STREET_TYPE_EXPANSIONS)) {
    expanded = expanded.replace(new RegExp(`\\b${abbr}\\b`, 'g'), full);
  }
  return expanded;
}

async function nominatimQuery(
  query: string
): Promise<{ lat: number; lng: number } | null> {
  // Rate limit
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastRequestTime = Date.now();

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=au&limit=1`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'PropertyIQ/1.0',
      Accept: 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
  };
}

export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const key = normaliseKey(address);
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    // Try expanded version first
    const expanded = expandAbbreviations(address);
    let result = await nominatimQuery(expanded);

    // Fallback: try original
    if (!result && expanded !== address) {
      result = await nominatimQuery(address);
    }

    // Fallback: suburb-only geocoding
    if (!result) {
      const parts = address.split(',');
      if (parts.length >= 2) {
        const suburbPart = parts.slice(1).join(',').trim();
        result = await nominatimQuery(expandAbbreviations(suburbPart));
      }
    }

    cache.set(key, result);
    return result;
  } catch (err) {
    console.warn('[geocoding] Failed:', err);
    cache.set(key, null);
    return null;
  }
}
