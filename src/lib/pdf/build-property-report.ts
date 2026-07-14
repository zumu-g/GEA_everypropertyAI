import { parseAddress } from '@/lib/utils/address';
import { fetchAndCacheProfile } from '@/lib/jobs/fetch-profile';
import { renderPropertyReport, type PropertyReportData } from '@/lib/pdf/property-report';

/**
 * Shared report-building logic behind /api/property-report and
 * /api/property-report/download. Resolves an address, fetches/caches the
 * property profile, maps it into PropertyReportData, and renders the
 * GEA-branded PDF. Returns structured data rather than a NextResponse so
 * each route can decide its own response shape (headers, auth, side effects).
 */

export interface BuildPropertyReportResult {
  pdf: Buffer;
  address: string;
}

export interface BuildPropertyReportNotFound {
  notFound: true;
}

function pick<T = unknown>(d: Record<string, unknown>, keys: string[]): T | undefined {
  for (const k of keys) {
    const v = d[k];
    if (v !== undefined && v !== null && v !== '') return v as T;
  }
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : undefined;
}

/** Fetch up to `max` photos, skipping failures and unsupported formats. */
async function fetchPhotos(urls: string[], max: number): Promise<PropertyReportData['heroPhotos']> {
  const out: PropertyReportData['heroPhotos'] = [];
  for (const url of urls) {
    if (out.length >= max) break;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const type = res.headers.get('content-type') ?? '';
      const format = type.includes('png') ? 'png' : type.includes('jpeg') || type.includes('jpg') ? 'jpg' : null;
      if (!format) continue;
      out.push({ data: Buffer.from(await res.arrayBuffer()), format });
    } catch {
      // dead/slow CDN link — render without it
    }
  }
  return out;
}

export async function buildPropertyReportPdf(
  raw: string
): Promise<BuildPropertyReportResult | BuildPropertyReportNotFound> {
  const address = parseAddress(raw);
  if (!address.streetName && !address.suburb) {
    return { notFound: true };
  }

  let profile;
  try {
    const result = await fetchAndCacheProfile(address, { skipIfCached: true });
    profile = result.profile;
  } catch (err) {
    console.error('[build-property-report] pipeline error:', err);
    return { notFound: true };
  }

  const d = (profile?.data ?? {}) as Record<string, unknown>;

  const composed = `${address.streetNumber ?? ''} ${address.streetName ?? ''} ${address.streetType ?? ''}, ${address.suburb ?? ''} ${address.state ?? ''} ${address.postcode ?? ''}`
    .replace(/\s+/g, ' ')
    .trim();

  const low = asNumber(pick(d, ['priceLow']));
  const mid = asNumber(pick(d, ['priceMid']));
  const high = asNumber(pick(d, ['priceHigh']));

  const photoUrls = ((pick<unknown[]>(d, ['photos', 'media', 'images']) ?? []) as unknown[])
    .map((p) => (typeof p === 'string' ? p : (p as { url?: string })?.url))
    .filter((u): u is string => typeof u === 'string');

  const saleHistory = ((pick<unknown[]>(d, ['saleHistory', 'salesHistory']) ?? []) as Array<{
    date?: string;
    price?: number;
  }>)
    .filter((s) => s && (s.date || s.price))
    .map((s) => ({ date: s.date, price: asNumber(s.price) }));

  const reportData: PropertyReportData = {
    address: address.displayAddress ?? composed,
    propertyType: pick<string>(d, ['propertyType', 'type']),
    bedrooms: asNumber(pick(d, ['bedrooms', 'beds'])),
    bathrooms: asNumber(pick(d, ['bathrooms', 'baths'])),
    carSpaces: asNumber(pick(d, ['carSpaces', 'carspaces', 'parking', 'garages'])),
    landAreaSqm: asNumber(pick(d, ['landAreaSqm', 'landSize', 'landArea'])),
    buildingAreaSqm: asNumber(pick(d, ['buildingAreaSqm', 'buildingArea'])),
    priceEstimate: low || mid || high ? { low, mid, high } : undefined,
    confidence: asNumber(profile?.overallConfidence) ?? 0,
    saleHistory,
    listingStatus: pick<string>(d, ['listingStatus', 'status']),
    heroPhotos: await fetchPhotos(photoUrls, 2),
  };

  const generatedDate = new Date().toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Australia/Melbourne',
  });

  const pdf = await renderPropertyReport(reportData, generatedDate);

  return { pdf, address: reportData.address };
}
