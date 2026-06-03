/**
 * Nearby childcare centres enrichment using the OpenStreetMap Overpass API.
 * Falls back gracefully if API is unavailable.
 */

export interface NearbyChildcare {
  name: string;
  distanceKm: number;
  address?: string;
}

interface OverpassElement {
  id: number;
  lat: number;
  lon: number;
  tags: {
    name?: string;
    'addr:housenumber'?: string;
    'addr:street'?: string;
    'addr:suburb'?: string;
    [key: string]: string | undefined;
  };
}

interface OverpassResponse {
  elements: OverpassElement[];
}

const cache = new Map<string, { data: NearbyChildcare[]; at: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function fetchNearbyChildcare(
  lat: number,
  lng: number,
  radiusMetres: number = 1500
): Promise<NearbyChildcare[]> {
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const query = `data=[out:json][timeout:10];node["amenity"="childcare"](around:${radiusMetres},${lat},${lng});out body;`;

    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: query,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`[childcare] Overpass API returned ${res.status}`);
      return [];
    }

    const json: OverpassResponse = await res.json();
    if (!Array.isArray(json.elements)) return [];

    const centres: NearbyChildcare[] = json.elements
      .filter((el) => el.tags?.name)
      .map((el) => {
        const parts = [
          el.tags['addr:housenumber'],
          el.tags['addr:street'],
          el.tags['addr:suburb'],
        ].filter((p): p is string => p !== undefined && p.trim() !== '');

        return {
          name: el.tags.name as string,
          distanceKm: haversine(lat, lng, el.lat, el.lon),
          address: parts.length > 0 ? parts.join(' ') : undefined,
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 8);

    cache.set(cacheKey, { data: centres, at: Date.now() });
    return centres;
  } catch (err) {
    console.warn('[childcare] Query failed:', err);
    return [];
  }
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
