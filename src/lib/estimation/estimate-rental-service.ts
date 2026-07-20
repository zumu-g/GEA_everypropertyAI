/**
 * Server-side rental-estimate orchestration. Gathers comparable rentals from
 * property_rentals (radius/time ladder, then suburb fallback), runs the pure
 * rental estimator, and falls back to a suburb-median-rent range when comps are
 * too sparse. Import getRentalEstimate directly from server code.
 */

import {
  getRowsNearby,
  haversineKm,
  getRentalsForSuburb,
  type PropertyRentalRecord,
} from '@/lib/db/queries';
import { fetchSuburbMarketData } from '@/lib/enrichment/market-data';
import { typeBucket } from './comparables-estimator';
import type { PriceEstimateResult } from './price-estimator';
import {
  estimateRentFromComparables,
  MIN_COMPS,
  IDEAL_COMPS,
  MIN_RENT,
  MAX_RENT,
  type RentalComparable,
  type RentalSubject,
  type RentMarketInput,
  type RentalEstimateResult,
} from './rental-comparables-estimator';

export interface RentalEstimateSubjectInput {
  latitude?: number | null;
  longitude?: number | null;
  suburb: string;
  state?: string;
  postcode?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  landAreaSqm?: number;
  priorRent?: { weeklyRent: number; date: string };
  saleEstimateMid?: number;
  excludeAddress?: string;
}

const RADIUS_LADDER_KM = [1, 2, 5];
const MAX_WINDOW_MONTHS = 24;

function rentSane(r?: number): r is number {
  return typeof r === 'number' && r > MIN_RENT && r <= MAX_RENT;
}

function withinMonths(date: string | undefined, months: number, now: Date): boolean {
  if (!date) return false;
  const d = new Date(date);
  if (isNaN(d.getTime())) return false;
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
  return d >= cutoff;
}

function passesPrefilter(subject: RentalEstimateSubjectInput, r: PropertyRentalRecord): boolean {
  const sb = typeBucket(subject.propertyType);
  const cb = typeBucket(r.property_type);
  if (sb !== 'unknown' && cb !== 'unknown' && sb !== cb) return false;
  if (subject.bedrooms != null && r.bedrooms != null && Math.abs(r.bedrooms - subject.bedrooms) >= 2) {
    return false;
  }
  return true;
}

function toComparable(r: PropertyRentalRecord, distanceKm: number | null): RentalComparable {
  return {
    rawAddress: r.raw_address,
    suburb: r.suburb,
    weeklyRent: r.weekly_rent as number,
    asOf: (r.created_at ?? r.last_seen_at ?? '') as string,
    bedrooms: r.bedrooms ?? null,
    bathrooms: r.bathrooms ?? null,
    carSpaces: r.car_spaces ?? null,
    landAreaSqm: r.land_area_sqm ?? null,
    propertyType: r.property_type ?? null,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    distanceKm,
    source: r.source,
  };
}

function addComp(map: Map<string, RentalComparable>, c: RentalComparable, excludeAddress?: string) {
  const key = c.rawAddress.trim().toLowerCase();
  if (excludeAddress && key === excludeAddress.trim().toLowerCase()) return;
  const existing = map.get(key);
  if (!existing || c.asOf > existing.asOf) map.set(key, c);
}

export async function getRentalEstimate(
  subject: RentalEstimateSubjectInput,
  now: Date = new Date(),
): Promise<RentalEstimateResult | PriceEstimateResult | null> {
  // A weekly-rent figure is meaningless for a vacant block — there is nothing
  // to lease. No rent estimate for land subjects (KTD6).
  if (typeBucket(subject.propertyType) === 'land') return null;

  const state = (subject.state ?? 'VIC').toUpperCase();
  const hasGeo =
    typeof subject.latitude === 'number' && Number.isFinite(subject.latitude) &&
    typeof subject.longitude === 'number' && Number.isFinite(subject.longitude);

  const md = await fetchSuburbMarketData(subject.suburb, state, subject.postcode ?? '');
  const isUnit = typeBucket(subject.propertyType) === 'unit';
  const segment = isUnit ? md?.units : md?.houses;
  const market: RentMarketInput = {
    annualRentGrowth: segment?.annualRentGrowth,
    priceAnnualGrowth: segment?.annualGrowth,
    medianRent: segment?.medianRent,
    grossYield: segment?.grossYield,
  };

  const comps = new Map<string, RentalComparable>();

  if (hasGeo) {
    const lat = subject.latitude as number;
    const lng = subject.longitude as number;
    for (const radius of RADIUS_LADDER_KM) {
      const box = await getRowsNearby<PropertyRentalRecord>('property_rentals', lat, lng, radius, 500);
      for (const r of box) {
        if (r.active === false) continue;
        if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') continue;
        const dist = haversineKm(lat, lng, r.latitude, r.longitude);
        if (dist > radius) continue;
        if (!rentSane(r.weekly_rent)) continue;
        if (!withinMonths(r.created_at ?? r.last_seen_at, MAX_WINDOW_MONTHS, now)) continue;
        if (!passesPrefilter(subject, r)) continue;
        addComp(comps, toComparable(r, dist), subject.excludeAddress);
      }
      const recentEnough = [...comps.values()].filter((c) => withinMonths(c.asOf, 12, now)).length;
      if (recentEnough >= IDEAL_COMPS) break;
    }
  }

  if (comps.size < MIN_COMPS) {
    const suburbRentals = await getRentalsForSuburb(subject.suburb, state, 300);
    for (const r of suburbRentals) {
      if (r.active === false) continue;
      if (!rentSane(r.weekly_rent)) continue;
      if (!withinMonths(r.created_at ?? r.last_seen_at, MAX_WINDOW_MONTHS, now)) continue;
      if (!passesPrefilter(subject, r)) continue;
      addComp(comps, toComparable(r, null), subject.excludeAddress);
    }
  }

  const compList = [...comps.values()];
  const rentalSubject: RentalSubject = {
    latitude: subject.latitude,
    longitude: subject.longitude,
    suburb: subject.suburb,
    propertyType: subject.propertyType,
    bedrooms: subject.bedrooms,
    bathrooms: subject.bathrooms,
    landAreaSqm: subject.landAreaSqm,
    priorRent: subject.priorRent,
    saleEstimateMid: subject.saleEstimateMid,
  };

  if (compList.length >= MIN_COMPS) {
    const result = estimateRentFromComparables(rentalSubject, compList, market, now);
    if (result) return result;
  }

  // Fallback — suburb median rent ± 15% at low confidence.
  if (market.medianRent && market.medianRent > MIN_RENT) {
    const mid = Math.round(market.medianRent);
    return {
      priceLow: Math.round(mid * 0.85),
      priceMid: mid,
      priceHigh: Math.round(mid * 1.15),
      confidenceBand: 15,
      confidenceScore: 25,
      confidenceLevel: 'low',
      priceSource: 'suburb-median-rent',
      methodology:
        `Based on the suburb median ${isUnit ? 'unit' : 'house'} rent of $${mid}/wk. ` +
        'Insufficient comparable rentals nearby; asking-rent figure.',
    };
  }

  return null;
}
