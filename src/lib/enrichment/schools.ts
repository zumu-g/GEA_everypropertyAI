/**
 * Nearby schools enrichment.
 *
 * Primary source: bundled open data (src/data/school-data.json, built by
 * scripts/build-school-data.py) — ACARA school locations/profiles (type,
 * sector, year range, enrolments, website) plus Vic DET school-zone polygons
 * (the data behind findmyschool.vic.gov.au). Covers the Casey/Cardinia region.
 *
 * Fallback outside the bundled bbox: Nominatim name search (type/sector
 * inferred from the name — not authoritative).
 */

import schoolData from '@/data/school-data.json';

export interface NearbySchool {
  name: string;
  type: 'primary' | 'secondary' | 'combined' | 'special' | 'unknown';
  sector: 'government' | 'catholic' | 'independent' | 'unknown';
  distanceKm: number;
  lat: number;
  lng: number;
  yearRange?: string;
  students?: number;
  website?: string;
  /** True if the property falls inside this government school's enrolment zone. */
  zonedPrimary?: boolean;
  zonedSecondary?: boolean;
}

interface BundledSchool {
  name: string;
  type: string;
  sector: string;
  yearRange?: string | null;
  students?: number | null;
  website?: string | null;
  lat: number;
  lng: number;
}

interface ZoneFeature {
  school: string;
  polygons: number[][][][]; // [polygon][ring][point][lng,lat]
}

const DATA = schoolData as unknown as {
  bbox: { min_lng: number; max_lng: number; min_lat: number; max_lat: number };
  schools: BundledSchool[];
  zones: { primary: ZoneFeature[]; secondary: ZoneFeature[] };
};

// ─── Zone lookup (point-in-polygon, findmyschool zones) ─────────────────────

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[j];
    if (y1 > lat !== y2 > lat && lng < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInFeature(lng: number, lat: number, f: ZoneFeature): boolean {
  for (const poly of f.polygons) {
    if (pointInRing(lng, lat, poly[0]) && !poly.slice(1).some((h) => pointInRing(lng, lat, h))) {
      return true;
    }
  }
  return false;
}

/** Zoned government school names for a point, per findmyschool.vic.gov.au data. */
export function findSchoolZones(lat: number, lng: number): {
  primary: string | null;
  secondary: string | null;
} {
  const primary = DATA.zones.primary.find((f) => pointInFeature(lng, lat, f));
  const secondary = DATA.zones.secondary.find((f) => pointInFeature(lng, lat, f));
  return { primary: primary?.school ?? null, secondary: secondary?.school ?? null };
}

// ─── Nearby schools ──────────────────────────────────────────────────────────

function inBundledBbox(lat: number, lng: number): boolean {
  const b = DATA.bbox;
  return lng >= b.min_lng && lng <= b.max_lng && lat >= b.min_lat && lat <= b.max_lat;
}

/** Loose name match between DET zone names and ACARA names (e.g. "P-9" vs "P–9"). */
function namesMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(a) === norm(b);
}

/**
 * Two closest primary + two closest secondary schools (combined schools count
 * for both), with the zoned school for each level always included and flagged.
 */
export async function fetchNearbySchools(
  lat: number,
  lng: number,
  radiusKm: number = 5
): Promise<NearbySchool[]> {
  if (!inBundledBbox(lat, lng)) return fetchNearbySchoolsOSM(lat, lng, Math.min(radiusKm, 3));

  const zones = findSchoolZones(lat, lng);

  const all: NearbySchool[] = DATA.schools.map((s) => ({
    name: s.name,
    type: (['primary', 'secondary', 'combined', 'special'].includes(s.type)
      ? s.type
      : 'unknown') as NearbySchool['type'],
    sector: (['government', 'catholic', 'independent'].includes(s.sector)
      ? s.sector
      : 'unknown') as NearbySchool['sector'],
    distanceKm: haversine(lat, lng, s.lat, s.lng),
    lat: s.lat,
    lng: s.lng,
    yearRange: s.yearRange ?? undefined,
    students: s.students ?? undefined,
    website: s.website ?? undefined,
    zonedPrimary: zones.primary != null && namesMatch(s.name, zones.primary),
    zonedSecondary: zones.secondary != null && namesMatch(s.name, zones.secondary),
  }));

  const byDistance = all
    .filter((s) => s.distanceKm <= radiusKm || s.zonedPrimary || s.zonedSecondary)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const pick = (level: 'primary' | 'secondary'): NearbySchool[] => {
    const zonedFlag = level === 'primary' ? 'zonedPrimary' : 'zonedSecondary';
    const candidates = byDistance.filter((s) => s.type === level || s.type === 'combined');
    const chosen = candidates.slice(0, 2);
    const zoned = candidates.find((s) => s[zonedFlag]);
    if (zoned && !chosen.includes(zoned)) chosen.push(zoned);
    return chosen;
  };

  // Dedup combined schools that qualify for both levels.
  const seen = new Set<string>();
  return [...pick('primary'), ...pick('secondary')].filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}

// ─── Nominatim fallback (outside bundled region) ─────────────────────────────

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastRequestTime = Date.now();

  return fetch(url, {
    headers: {
      'User-Agent': 'PropertyIQ/1.0',
      Accept: 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
}

async function fetchNearbySchoolsOSM(
  lat: number,
  lng: number,
  radiusKm: number
): Promise<NearbySchool[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=school&format=json&limit=15&countrycodes=au&viewbox=${lng - 0.03},${lat + 0.03},${lng + 0.03},${lat - 0.03}&bounded=1`;

    const res = await rateLimitedFetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
      .filter((item: { display_name?: string }) => item.display_name)
      .map((item: { display_name: string; lat: string; lon: string }) => {
        const name = item.display_name.split(',')[0].trim();
        const sLat = parseFloat(item.lat);
        const sLng = parseFloat(item.lon);
        return {
          name,
          type: inferSchoolType(name),
          sector: inferSector(name),
          distanceKm: haversine(lat, lng, sLat, sLng),
          lat: sLat,
          lng: sLng,
        };
      })
      .filter((s: NearbySchool) => s.distanceKm <= radiusKm)
      .sort((a: NearbySchool, b: NearbySchool) => a.distanceKm - b.distanceKm)
      .slice(0, 10);
  } catch (err) {
    console.warn('[schools] Query failed:', err);
    return [];
  }
}

function inferSchoolType(name: string): NearbySchool['type'] {
  const lower = name.toLowerCase();
  if (lower.includes('primary') || lower.includes('p.s.')) return 'primary';
  if (lower.includes('secondary') || lower.includes('high school') || lower.includes('college'))
    return 'secondary';
  if (lower.includes('grammar') || lower.includes('p-12') || lower.includes('k-12'))
    return 'combined';
  return 'unknown';
}

function inferSector(name: string): NearbySchool['sector'] {
  const lower = name.toLowerCase();
  if (lower.includes('catholic') || lower.includes('st ') || lower.includes('saint '))
    return 'catholic';
  if (lower.includes('christian') || lower.includes('grammar') || lower.includes('independent'))
    return 'independent';
  return 'government';
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
}
