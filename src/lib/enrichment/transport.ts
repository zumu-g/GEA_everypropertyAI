/**
 * Nearby transport enrichment using Nominatim search.
 * Finds train stations and major transport stops near a property.
 */

export interface NearbyTransport {
  name: string;
  type: 'train' | 'tram' | 'bus' | 'ferry' | 'light_rail';
  distanceKm: number;
  lat: number;
  lng: number;
  /** Route numbers serving the stop, e.g. "841;893". */
  routes?: string;
}

interface OverpassBusElement {
  id: number;
  lat: number;
  lon: number;
  tags?: {
    name?: string;
    route_ref?: string;
    [key: string]: string | undefined;
  };
}

const busCache = new Map<string, { data: NearbyTransport[]; at: number }>();
const BUS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Nearby bus stops via the Overpass API (same pattern as childcare.ts).
 * Returns [] on any failure.
 */
export async function fetchNearbyBusStops(
  lat: number,
  lng: number,
  radiusMetres: number = 1000
): Promise<NearbyTransport[]> {
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = busCache.get(cacheKey);
  if (cached && Date.now() - cached.at < BUS_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const query = `data=${encodeURIComponent(`[out:json][timeout:10];node["highway"="bus_stop"](around:${radiusMetres},${lat},${lng});out;`)}`;

    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      // No Accept: application/json and a real User-Agent — Overpass 406s otherwise.
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'PropertyIQ/1.0',
      },
      body: query,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`[transport] Overpass API returned ${res.status}`);
      return [];
    }

    const json: { elements?: OverpassBusElement[] } = await res.json();
    if (!Array.isArray(json.elements)) return [];

    const stops: NearbyTransport[] = json.elements
      .filter((el) => el.lat != null && el.lon != null)
      .map((el) => ({
        name: el.tags?.name ?? 'Bus stop',
        type: 'bus' as const,
        distanceKm: haversine(lat, lng, el.lat, el.lon),
        lat: el.lat,
        lng: el.lon,
        ...(el.tags?.route_ref ? { routes: el.tags.route_ref } : {}),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 3);

    busCache.set(cacheKey, { data: stops, at: Date.now() });
    return stops;
  } catch (err) {
    console.warn('[transport] Bus stop query failed:', err);
    return [];
  }
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

export async function fetchNearbyTransport(
  lat: number,
  lng: number,
  radiusKm: number = 3
): Promise<NearbyTransport[]> {
  const [trains, buses] = await Promise.all([
    fetchNearbyTrains(lat, lng, radiusKm),
    fetchNearbyBusStops(lat, lng),
  ]);
  return [...trains, ...buses];
}

async function fetchNearbyTrains(
  lat: number,
  lng: number,
  radiusKm: number
): Promise<NearbyTransport[]> {
  try {
    // Search for train stations near this location
    const url = `https://nominatim.openstreetmap.org/search?q=station&format=json&limit=15&countrycodes=au&viewbox=${lng - 0.04},${lat + 0.04},${lng + 0.04},${lat - 0.04}&bounded=1`;

    const res = await rateLimitedFetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    // Deduplicate by name
    const seen = new Set<string>();
    const stops: NearbyTransport[] = [];

    for (const item of data) {
      const name = (item.display_name ?? '').split(',')[0].trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());

      const sLat = parseFloat(item.lat);
      const sLng = parseFloat(item.lon);
      const dist = haversine(lat, lng, sLat, sLng);

      if (dist <= radiusKm) {
        stops.push({
          name,
          type: inferTransportType(name, item.type ?? ''),
          distanceKm: dist,
          lat: sLat,
          lng: sLng,
        });
      }
    }

    return stops
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 10);
  } catch (err) {
    console.warn('[transport] Query failed:', err);
    return [];
  }
}

function inferTransportType(name: string, type: string): NearbyTransport['type'] {
  const lower = (name + ' ' + type).toLowerCase();
  if (lower.includes('tram')) return 'tram';
  if (lower.includes('ferry')) return 'ferry';
  if (lower.includes('bus')) return 'bus';
  if (lower.includes('light rail')) return 'light_rail';
  return 'train';
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
