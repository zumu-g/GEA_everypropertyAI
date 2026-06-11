/**
 * Convert a Domain.com.au property-profile PAGE (rendered HTML, e.g. fetched via
 * Web Unlocker) into LLM-ready markdown for the extraction pipeline.
 *
 * The profile page is a Next.js app whose data lives in
 *   <script id="__NEXT_DATA__">…</script>
 * under `props.pageProps.__APOLLO_STATE__`, keyed `Property:<base64 id>`. That
 * node carries the structured subject (beds/baths/parking/land/lot/plan/type),
 * Domain's APM valuation + rental estimate, photo URLs, the full sale/rental
 * timeline, and parameterised keys like `landArea({"unit":"SQUARE_METERS"})`.
 *
 * Returns null when the page is a shell or 404 (no Apollo Property node) so the
 * orchestrator treats the fetch as failed and continues the fallback chain.
 */

import { parseNextData } from './domain-page-extractor';
import type { ExtractedPropertyData } from '@/types/property';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Read a field that may be stored under a parameterised Apollo key, e.g.
 * `landArea({"unit":"SQUARE_METERS"})` — exact name first, then prefix match. */
function field(node: Obj, name: string): unknown {
  if (node[name] !== undefined) return node[name];
  const pref = `${name}(`;
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith(pref)) return v;
  }
  return undefined;
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

function money(v: unknown): string | undefined {
  const n = num(v);
  return n === undefined ? undefined : `$${Math.round(n).toLocaleString('en-AU')}`;
}

function isoDay(v: unknown): string | undefined {
  const s = str(v);
  return s ? s.slice(0, 10) : undefined;
}

/** Locate the `Property:*` node in __APOLLO_STATE__. */
function findPropertyNode(nextData: Obj): Obj | null {
  const apollo = (((nextData.props as Obj)?.pageProps as Obj)?.__APOLLO_STATE__ ?? null) as Obj | null;
  if (!isObj(apollo)) return null;
  for (const [k, v] of Object.entries(apollo)) {
    if (k.startsWith('Property:') && isObj(v)) return v;
  }
  return null;
}

function pushLine(lines: string[], label: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  lines.push(`**${label}:** ${value}`);
}

export function domainProfileHtmlToMarkdown(html: string): string | null {
  const nextData = parseNextData(html);
  if (!nextData) return null;
  const prop = findPropertyNode(nextData);
  if (!prop) return null; // shell / 404 page

  const lines: string[] = [];

  const address = field(prop, 'address');
  if (isObj(address)) pushLine(lines, 'Address', str(address.displayAddress));

  pushLine(lines, 'Property Type', str(field(prop, 'type')));
  pushLine(lines, 'Bedrooms', num(field(prop, 'bedrooms')));
  pushLine(lines, 'Bathrooms', num(field(prop, 'bathrooms')));
  pushLine(lines, 'Car Spaces', num(field(prop, 'parkingSpaces')));

  const landArea = num(field(prop, 'landArea'));
  if (landArea) pushLine(lines, 'Land Area', `${landArea} sqm`);
  const internalArea = num(field(prop, 'internalArea'));
  if (internalArea) pushLine(lines, 'Building Area', `${internalArea} sqm`);

  const lot = str(field(prop, 'lotNumber'));
  const plan = str(field(prop, 'planNumber'));
  if (lot || plan) pushLine(lines, 'Lot/Plan', [lot, plan].filter(Boolean).join('/'));

  const features = field(prop, 'features');
  if (Array.isArray(features) && features.length > 0) {
    pushLine(lines, 'Features', features.filter((f) => typeof f === 'string').join(', '));
  }

  const valuation = field(prop, 'valuation');
  if (isObj(valuation)) {
    const low = money(valuation.lowerPrice);
    const mid = money(valuation.midPrice);
    const high = money(valuation.upperPrice);
    if (mid) {
      pushLine(
        lines,
        'Price Estimate',
        `${mid}${low && high ? ` (range ${low} - ${high})` : ''}${str(valuation.priceConfidence) ? `, confidence ${valuation.priceConfidence}` : ''}`,
      );
    }
  }

  const rental = field(prop, 'rentalEstimate');
  if (isObj(rental)) {
    const wk = num(rental.weeklyRentEstimate);
    if (wk) {
      pushLine(
        lines,
        'Rental Estimate',
        `$${wk} per week${num(rental.percentYieldRentEstimate) ? ` (yield ${rental.percentYieldRentEstimate}%)` : ''}`,
      );
    }
  }

  const media = field(prop, 'media');
  if (Array.isArray(media)) {
    const urls = media
      .map((m) => (isObj(m) ? str(field(m, 'url')) : undefined))
      .filter((u): u is string => Boolean(u))
      .slice(0, 8);
    if (urls.length > 0) lines.push(`**Photos:**\n${urls.map((u) => `- ${u}`).join('\n')}`);
  }

  const timeline = field(prop, 'timeline');
  if (Array.isArray(timeline) && timeline.length > 0) {
    const events = timeline
      .filter(isObj)
      .map((e) => {
        const parts = [
          isoDay(e.eventDate),
          str(e.category),
          // Rental events carry $/week; sales carry the sale price.
          str(e.category) === 'Rental' ? (num(e.eventPrice) ? `$${e.eventPrice} per week` : undefined) : money(e.eventPrice),
          isObj(e.agency) ? str((e.agency as Obj).name) : undefined,
          num(e.daysOnMarket) !== undefined ? `${e.daysOnMarket} days on market` : undefined,
        ].filter(Boolean);
        return parts.length > 1 ? `- ${parts.join(' — ')}` : null;
      })
      .filter(Boolean);
    if (events.length > 0) lines.push(`**Property History:**\n${events.join('\n')}`);
  }

  // Need the structured subject at minimum — address alone is a useless page.
  return lines.length >= 3 ? lines.join('\n') : null;
}

/**
 * Deterministic extraction for the same page — field names match the merger's
 * SCALAR_FIELDS/array contracts (landArea, photos, saleHistory, …). Because the
 * Apollo state is structured, this bypasses the LLM extractor entirely (no
 * transcription errors, no dropped fields). Returns null on a shell/404 page.
 */
export function domainProfileHtmlToExtraction(html: string): ExtractedPropertyData | null {
  const nextData = parseNextData(html);
  if (!nextData) return null;
  const prop = findPropertyNode(nextData);
  if (!prop) return null;

  const raw: Obj = {};
  const set = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== '') raw[k] = v;
  };

  const address = field(prop, 'address');
  if (isObj(address)) {
    raw.address = {
      fullAddress: str(address.displayAddress),
      unit: str(address.unitNumber),
      streetNumber: str(address.streetNumber),
      streetName: str(address.streetName),
      streetType: str(address.streetTypeLong) ?? str(address.streetType),
      suburb: str(address.suburbName),
      state: str(address.state),
      postcode: str(address.postcode),
    };
  }

  set('propertyType', str(field(prop, 'type')));
  set('bedrooms', num(field(prop, 'bedrooms')));
  set('bathrooms', num(field(prop, 'bathrooms')));
  set('carSpaces', num(field(prop, 'parkingSpaces')));
  set('landArea', num(field(prop, 'landArea')));
  set('buildingArea', num(field(prop, 'internalArea')));

  const lot = str(field(prop, 'lotNumber'));
  const plan = str(field(prop, 'planNumber'));
  if (lot || plan) set('lotPlan', [lot, plan].filter(Boolean).join('/'));

  const features = field(prop, 'features');
  if (Array.isArray(features) && features.length > 0) {
    set('features', features.filter((f): f is string => typeof f === 'string'));
  }

  const valuation = field(prop, 'valuation');
  if (isObj(valuation)) {
    set('estimatedValueLow', num(valuation.lowerPrice));
    set('estimatedValue', num(valuation.midPrice));
    set('estimatedValueHigh', num(valuation.upperPrice));
  }

  const media = field(prop, 'media');
  if (Array.isArray(media)) {
    const urls = media
      .map((m) => (isObj(m) ? str(field(m, 'url')) : undefined))
      .filter((u): u is string => Boolean(u));
    if (urls.length > 0) set('photos', urls);
  }

  const timeline = field(prop, 'timeline');
  if (Array.isArray(timeline) && timeline.length > 0) {
    const sales: Obj[] = [];
    const rentals: Obj[] = [];
    for (const e of timeline) {
      if (!isObj(e)) continue;
      const entry: Obj = {};
      const date = isoDay(e.eventDate);
      if (date) entry.date = date;
      const agency = isObj(e.agency) ? str((e.agency as Obj).name) : undefined;
      if (agency) entry.agency = agency;
      const dom = num(e.daysOnMarket);
      if (dom !== undefined) entry.daysOnMarket = dom;
      if (str(e.category) === 'Rental') {
        const rent = num(e.eventPrice);
        if (rent !== undefined) entry.weeklyRent = rent;
        rentals.push(entry);
      } else {
        const price = num(e.eventPrice);
        if (price !== undefined) entry.price = price;
        entry.type = str(e.category) ?? 'Sale';
        sales.push(entry);
      }
    }
    if (sales.length > 0) set('saleHistory', sales);
    if (rentals.length > 0) set('rentalHistory', rentals);
  }

  // Subject attributes are the point — an address-only page is not useful.
  const hasSubject = ['bedrooms', 'bathrooms', 'landArea', 'propertyType'].some((k) => raw[k] !== undefined);
  if (!hasSubject) return null;

  return { source: 'domain.com.au', raw, extractedAt: new Date() };
}
