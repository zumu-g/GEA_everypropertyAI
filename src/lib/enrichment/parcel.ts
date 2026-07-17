/**
 * Land-size lookup from Vicmap Property (Victoria's cadastre) via the open-data
 * GeoServer WFS. No API key required. Given a point, fetches the parcel polygon
 * containing it and computes its planar area in m².
 */

const WFS_URL = 'https://opendata.maps.vic.gov.au/geoserver/wfs';

// In-memory cache (parcels don't move)
const cache = new Map<string, number | null>();

interface GeoJSONFeature {
  geometry?: { type: string; coordinates: unknown };
}

/**
 * Area of the Vicmap parcel containing (lat, lng), in whole m², or null when
 * outside Victoria / no parcel / service failure. Fail-soft: never throws.
 */
export async function fetchParcelLandArea(lat: number, lng: number): Promise<number | null> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: 'open-data-platform:parcel_view',
    outputFormat: 'application/json',
    count: '1',
    srsName: 'EPSG:4326',
    // GeoServer WFS 2.0 EPSG:4326 uses lat,lng axis order in CQL geometry.
    CQL_FILTER: `INTERSECTS(geom,POINT(${lat} ${lng}))`,
  });

  let area: number | null = null;
  try {
    const res = await fetch(`${WFS_URL}?${params.toString()}`, {
      headers: { 'User-Agent': 'PropertyIQ/1.0', Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const json = (await res.json()) as { features?: GeoJSONFeature[] };
      const geom = json.features?.[0]?.geometry;
      if (geom) {
        const sqm = geometryAreaSqm(geom);
        // Sanity band: reject degenerate slivers and broadacre outliers that
        // would poison the estimator.
        if (sqm >= 20 && sqm <= 1_000_000) area = Math.round(sqm);
      }
    } else {
      console.warn(`[parcel] Vicmap WFS returned ${res.status}`);
    }
  } catch (err) {
    console.warn('[parcel] Vicmap WFS query failed:', err);
  }

  cache.set(key, area);
  return area;
}

/** Planar area (m²) of a GeoJSON Polygon/MultiPolygon in EPSG:4326. */
function geometryAreaSqm(geom: { type: string; coordinates: unknown }): number {
  const polys =
    geom.type === 'Polygon'
      ? [geom.coordinates as number[][][]]
      : geom.type === 'MultiPolygon'
        ? (geom.coordinates as number[][][][])
        : [];
  let total = 0;
  for (const poly of polys) {
    const [outer, ...holes] = poly;
    if (!outer) continue;
    total += ringAreaSqm(outer);
    for (const hole of holes) total -= ringAreaSqm(hole);
  }
  return total;
}

// ponytail: shoelace with cos(lat) scaling — fine at parcel scale; use a
// geodesic library only if we ever need broadacre precision.
function ringAreaSqm(ring: number[][]): number {
  if (ring.length < 4) return 0;
  const R = 6378137;
  const meanLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const k = Math.cos((meanLat * Math.PI) / 180);
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    a += x1 * k * y2 - x2 * k * y1;
  }
  return (Math.abs(a) / 2) * ((Math.PI / 180) * R) ** 2;
}
