/**
 * Planning & zoning enrichment using Victoria's spatial.planning.vic.gov.au ArcGIS server.
 * No API key required. Publicly accessible.
 */

export interface PlanningData {
  zone?: {
    code: string;
    name: string;
  };
  overlays: Array<{
    code: string;
    name: string;
  }>;
  council?: string;
  source: string;
  fetchedAt: string;
}

const ZONES_URL =
  'https://spatial.planning.vic.gov.au/gis/rest/services/planning_scheme_zones/MapServer/0/query';
const OVERLAYS_URL =
  'https://spatial.planning.vic.gov.au/gis/rest/services/planning_scheme_overlays/MapServer/0/query';

// In-memory cache
const cache = new Map<string, { data: PlanningData; at: number }>();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function fetchPlanningData(
  lat: number,
  lng: number,
  state: string
): Promise<PlanningData | null> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;

  if (state.toUpperCase() !== 'VIC') return null;

  const data = await fetchVicPlanData(lat, lng);
  if (data) cache.set(key, { data, at: Date.now() });
  return data;
}

async function fetchVicPlanData(
  lat: number,
  lng: number
): Promise<PlanningData | null> {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'ZONE_CODE,ZONE_DESCRIPTION,LGA',
    returnGeometry: 'false',
    f: 'json',
  });

  // Fetch zones and overlays in parallel
  const [zoneResult, overlayResult] = await Promise.allSettled([
    queryArcGIS(ZONES_URL, params),
    queryArcGIS(OVERLAYS_URL, params),
  ]);

  const result: PlanningData = {
    overlays: [],
    source: 'VicPlan (spatial.planning.vic.gov.au)',
    fetchedAt: new Date().toISOString(),
  };

  // Parse zones — pick the most relevant one
  if (zoneResult.status === 'fulfilled' && zoneResult.value) {
    const features = zoneResult.value.features ?? [];
    const priorityOrder = [
      'GRZ', 'NRZ', 'RGZ', 'LDRZ', 'MUZ', 'TZ', 'C1Z', 'C2Z', 'C3Z',
      'IN1Z', 'IN2Z', 'IN3Z', 'FZ', 'RLZ', 'RAZ', 'SUZ', 'CDZ',
    ];

    let bestZone: { code: string; name: string; lga?: string } | null = null;

    for (const f of features) {
      const a = f.attributes ?? {};
      const code = a.ZONE_CODE ?? '';
      const name = a.ZONE_DESCRIPTION ?? code;
      const lga = a.LGA ?? '';

      if (!bestZone) {
        bestZone = { code, name, lga };
      } else {
        const baseCode = code.replace(/\d+$/, '');
        const bestBase = bestZone.code.replace(/\d+$/, '');
        const newIdx = priorityOrder.indexOf(baseCode);
        const oldIdx = priorityOrder.indexOf(bestBase);
        if (newIdx >= 0 && (oldIdx < 0 || newIdx < oldIdx)) {
          bestZone = { code, name, lga };
        }
      }
    }

    if (bestZone) {
      result.zone = { code: bestZone.code, name: formatZoneName(bestZone.name) };
      if (bestZone.lga) result.council = bestZone.lga;
    }
  }

  // Parse overlays — deduplicate by code
  if (overlayResult.status === 'fulfilled' && overlayResult.value) {
    const features = overlayResult.value.features ?? [];
    const seen = new Set<string>();

    for (const f of features) {
      const a = f.attributes ?? {};
      const code = a.ZONE_CODE ?? '';
      if (code && !seen.has(code)) {
        seen.add(code);
        result.overlays.push({
          code,
          name: formatZoneName(a.ZONE_DESCRIPTION ?? code),
        });
      }
    }
  }

  if (!result.zone && result.overlays.length === 0) return null;
  return result;
}

interface ArcGISResponse {
  features: Array<{
    attributes: Record<string, string>;
  }>;
}

async function queryArcGIS(
  baseUrl: string,
  params: URLSearchParams
): Promise<ArcGISResponse | null> {
  try {
    const res = await fetch(`${baseUrl}?${params.toString()}`, {
      headers: {
        'User-Agent': 'PropertyIQ/1.0',
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`[planning] ArcGIS returned ${res.status}`);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.warn('[planning] ArcGIS query failed:', err);
    return null;
  }
}

function formatZoneName(raw: string): string {
  return raw
    .toLowerCase()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/ - /g, ' — ');
}
