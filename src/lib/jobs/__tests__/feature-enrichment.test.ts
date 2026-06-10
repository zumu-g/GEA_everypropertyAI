import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlanningData } from '@/lib/enrichment/planning';
import type { NearbyTransport } from '@/lib/enrichment/transport';

// Mock the live source modules so the enricher is exercised without network.
const fetchPlanningData = vi.fn();
const fetchNearbyTransport = vi.fn();
const resolveSchoolZones = vi.fn();
vi.mock('@/lib/enrichment/planning', () => ({ fetchPlanningData: (...a: unknown[]) => fetchPlanningData(...a) }));
vi.mock('@/lib/enrichment/transport', () => ({ fetchNearbyTransport: (...a: unknown[]) => fetchNearbyTransport(...a) }));
vi.mock('@/lib/enrichment/school-zones', () => ({ resolveSchoolZones: (...a: unknown[]) => resolveSchoolZones(...a) }));

import { buildFeatureRow, enrichFeaturesForPoint, FEATURE_SOURCE } from '../feature-enrichment';

const ISO = '2026-06-10T00:00:00.000Z';
const ZONES = { primary: 'Berwick Primary School', secondary: 'Berwick Secondary College' };

const PLANNING: PlanningData = {
  zone: { code: 'GRZ1', name: 'General Residential Zone' },
  overlays: [{ code: 'BMO', name: 'Bushfire Management Overlay' }],
  council: 'Casey',
  source: 'vic-arcgis',
  fetchedAt: ISO,
};

const TRANSPORT: NearbyTransport[] = [
  { name: 'Bus Stop 12', type: 'bus', distanceKm: 0.3, lat: -38, lng: 145 },
  { name: 'Berwick Station', type: 'train', distanceKm: 1.4, lat: -38.03, lng: 145.34 },
];

describe('buildFeatureRow (pure)', () => {
  it('maps planning + nearest train station + school zones (happy path)', () => {
    const row = buildFeatureRow('14-loders-way-berwick-vic-3806', PLANNING, TRANSPORT, ZONES, ISO);
    expect(row).toMatchObject({
      address_slug: '14-loders-way-berwick-vic-3806',
      planning_zone_code: 'GRZ1',
      planning_zone_name: 'General Residential Zone',
      planning_lga: 'Casey',
      planning_overlays: [{ code: 'BMO', name: 'Bushfire Management Overlay' }],
      nearest_station_name: 'Berwick Station', // the train, not the closer bus stop
      nearest_station_km: 1.4,
      school_zone_primary: 'Berwick Primary School',
      school_zone_secondary: 'Berwick Secondary College',
      source: FEATURE_SOURCE,
      fetched_at: ISO,
    });
  });

  it('omits planning columns when planning is null (transport-only)', () => {
    const row = buildFeatureRow('s', null, TRANSPORT, {}, ISO);
    expect(row.planning_zone_code).toBeUndefined();
    expect(row.planning_overlays).toBeUndefined();
    expect(row.nearest_station_name).toBe('Berwick Station');
  });

  it('omits station columns when no transport found (planning-only)', () => {
    const row = buildFeatureRow('s', PLANNING, [], {}, ISO);
    expect(row.planning_zone_code).toBe('GRZ1');
    expect(row.nearest_station_name).toBeUndefined();
    expect(row.nearest_station_km).toBeUndefined();
  });

  it('falls back to the closest stop when no train-type stop exists', () => {
    const row = buildFeatureRow('s', null, [TRANSPORT[0]], {}, ISO);
    expect(row.nearest_station_name).toBe('Bus Stop 12');
  });

  it('omits an absent school zone (primary only)', () => {
    const row = buildFeatureRow('s', null, [], { primary: 'Berwick Primary School' }, ISO);
    expect(row.school_zone_primary).toBe('Berwick Primary School');
    expect(row.school_zone_secondary).toBeUndefined();
  });

  it('always carries slug + source + fetched_at even with no source data', () => {
    const row = buildFeatureRow('s', null, [], {}, ISO);
    expect(row).toEqual({ address_slug: 's', source: FEATURE_SOURCE, fetched_at: ISO });
  });
});

describe('enrichFeaturesForPoint (fail-soft per source)', () => {
  beforeEach(() => {
    fetchPlanningData.mockReset();
    fetchNearbyTransport.mockReset();
    resolveSchoolZones.mockReset();
    resolveSchoolZones.mockReturnValue({});
  });

  it('assembles planning + station + both school zones when all sources return data', async () => {
    fetchPlanningData.mockResolvedValue(PLANNING);
    fetchNearbyTransport.mockResolvedValue(TRANSPORT);
    resolveSchoolZones.mockReturnValue(ZONES);

    const row = await enrichFeaturesForPoint('s', -38, 145, 'VIC', ISO);
    expect(row.planning_zone_code).toBe('GRZ1');
    expect(row.nearest_station_name).toBe('Berwick Station');
    expect(row.school_zone_primary).toBe('Berwick Primary School');
    expect(row.school_zone_secondary).toBe('Berwick Secondary College');
  });

  it('a thrown planning lookup does not block the transport result (R4)', async () => {
    fetchPlanningData.mockRejectedValue(new Error('arcgis down'));
    fetchNearbyTransport.mockResolvedValue(TRANSPORT);

    const row = await enrichFeaturesForPoint('s', -38, 145, 'VIC', ISO);
    expect(row.planning_zone_code).toBeUndefined();
    expect(row.nearest_station_name).toBe('Berwick Station');
  });

  it('a thrown transport lookup does not block the planning result (R4)', async () => {
    fetchPlanningData.mockResolvedValue(PLANNING);
    fetchNearbyTransport.mockRejectedValue(new Error('nominatim 429'));

    const row = await enrichFeaturesForPoint('s', -38, 145, 'VIC', ISO);
    expect(row.planning_zone_code).toBe('GRZ1');
    expect(row.nearest_station_name).toBeUndefined();
  });

  it('a thrown school-zone lookup does not block planning/transport (R4)', async () => {
    fetchPlanningData.mockResolvedValue(PLANNING);
    fetchNearbyTransport.mockResolvedValue(TRANSPORT);
    resolveSchoolZones.mockImplementation(() => { throw new Error('bad reference data'); });

    const row = await enrichFeaturesForPoint('s', -38, 145, 'VIC', ISO);
    expect(row.planning_zone_code).toBe('GRZ1');
    expect(row.nearest_station_name).toBe('Berwick Station');
    expect(row.school_zone_primary).toBeUndefined();
  });
});
