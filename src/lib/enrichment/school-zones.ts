/**
 * School-zone (catchment) lookup — plan 005.
 *
 * Resolves a lat/lng to the Victorian government-school zones it falls within
 * (a primary and a representative secondary catchment) using bundled reference
 * data and a dependency-free point-in-polygon test. No per-request external
 * call (plan 002 U3's "cache static reference data locally" approach).
 *
 * The reference GeoJSON is produced offline by `scripts/prep-school-zones.md`
 * and committed under `./data`. Until it exists, lookups fail soft → {}.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// GeoJSON position is [longitude, latitude].
type Position = [number, number];
type Ring = Position[];
type PolygonCoords = Ring[]; // [exterior, ...holes]

export interface ZoneGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: PolygonCoords | PolygonCoords[];
}

export interface ZoneFeature {
  geometry: ZoneGeometry | null;
  properties?: { school?: string } | null;
}

export interface ZoneCollection {
  features: ZoneFeature[];
}

export interface SchoolZones {
  primary?: string;
  secondary?: string;
}

// Resolve from the project root (cwd) rather than __dirname: at runtime
// __dirname points into compiled .next chunks where the JSON isn't traced,
// whereas `next start` on Railway keeps the source tree under cwd. Fail-soft
// covers any environment where the path doesn't resolve.
const DATA_DIR = join(process.cwd(), 'src/lib/enrichment/data');
const PRIMARY_FILE = 'school-zones-primary.casey-cardinia.json';
const SECONDARY_FILE = 'school-zones-secondary.casey-cardinia.json';

/**
 * Ray-casting (even-odd) test for a point against a single linear ring.
 * Returns true when the point lies inside the ring's boundary.
 */
function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    // Does the horizontal ray at `lat` cross edge (j → i)?
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Point-in-polygon for one Polygon (exterior ring + optional holes). A point in
 * a hole is correctly excluded: even-odd across all rings means a hole flips the
 * exterior's "inside" back to outside.
 */
function inPolygon(lng: number, lat: number, rings: PolygonCoords): boolean {
  let inside = false;
  for (const ring of rings) {
    if (inRing(lng, lat, ring)) inside = !inside;
  }
  return inside;
}

/**
 * Point-in-polygon for any zone geometry. `Polygon` → its rings; `MultiPolygon`
 * → inside if the point is inside any constituent polygon. Pure — exported for
 * direct testing against hand-built fixtures.
 */
export function pointInGeometry(lng: number, lat: number, geometry: ZoneGeometry | null): boolean {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    return inPolygon(lng, lat, geometry.coordinates as PolygonCoords);
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates as PolygonCoords[]).some((poly) => inPolygon(lng, lat, poly));
  }
  return false;
}

/**
 * Return the `school` of the first zone feature whose geometry contains the
 * point, or undefined. First-match wins — a point exactly on a shared edge
 * resolves deterministically to the earlier feature. Pure — exported for tests.
 */
export function findSchoolInZones(
  lng: number,
  lat: number,
  collection: ZoneCollection | null
): string | undefined {
  if (!collection) return undefined;
  for (const feature of collection.features) {
    if (pointInGeometry(lng, lat, feature.geometry)) {
      return feature.properties?.school ?? undefined;
    }
  }
  return undefined;
}

// Lazy module-level cache (mirrors planning.ts). `null` = load attempted, no
// file; populated object = parsed collection.
let primaryCache: ZoneCollection | null | undefined;
let secondaryCache: ZoneCollection | null | undefined;

function loadCollection(file: string): ZoneCollection | null {
  try {
    const raw = readFileSync(join(DATA_DIR, file), 'utf8');
    const parsed = JSON.parse(raw) as ZoneCollection;
    if (!parsed || !Array.isArray(parsed.features)) return null;
    return parsed;
  } catch {
    // Missing/corrupt reference file — fail soft (see module header).
    return null;
  }
}

/**
 * Resolve a property's coordinates to its primary and secondary school zones.
 * Local + fail-soft: a missing/corrupt reference file yields {} (never throws),
 * so the caller's other enrichment is unaffected.
 */
export function resolveSchoolZones(lat: number, lng: number): SchoolZones {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
  if (primaryCache === undefined) primaryCache = loadCollection(PRIMARY_FILE);
  if (secondaryCache === undefined) secondaryCache = loadCollection(SECONDARY_FILE);

  const zones: SchoolZones = {};
  const primary = findSchoolInZones(lng, lat, primaryCache);
  if (primary) zones.primary = primary;
  const secondary = findSchoolInZones(lng, lat, secondaryCache);
  if (secondary) zones.secondary = secondary;
  return zones;
}

/** Test seam: reset the lazy caches so a test can control the loaded data. */
export function __resetSchoolZoneCacheForTest(): void {
  primaryCache = undefined;
  secondaryCache = undefined;
}
