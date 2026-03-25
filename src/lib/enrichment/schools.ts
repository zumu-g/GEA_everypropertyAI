/**
 * Nearby schools enrichment using Nominatim reverse search.
 * Falls back gracefully if API is unavailable.
 */

export interface NearbySchool {
  name: string;
  type: 'primary' | 'secondary' | 'combined' | 'unknown';
  sector: 'government' | 'catholic' | 'independent' | 'unknown';
  distanceKm: number;
  lat: number;
  lng: number;
}

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

export async function fetchNearbySchools(
  lat: number,
  lng: number,
  radiusKm: number = 3
): Promise<NearbySchool[]> {
  try {
    // Use Nominatim search for schools near this location
    const url = `https://nominatim.openstreetmap.org/search?q=school&format=json&limit=15&countrycodes=au&viewbox=${lng - 0.03},${lat + 0.03},${lng + 0.03},${lat - 0.03}&bounded=1`;

    const res = await rateLimitedFetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const schools: NearbySchool[] = data
      .filter((item: { display_name?: string }) => item.display_name)
      .map((item: { display_name: string; lat: string; lon: string; type?: string }) => {
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

    return schools;
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
