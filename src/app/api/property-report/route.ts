import { NextRequest, NextResponse } from 'next/server';
import { parseAddress } from '@/lib/utils/address';
import { fetchAndCacheProfile } from '@/lib/jobs/fetch-profile';
import { renderPropertyReport, type PropertyReportData } from '@/lib/pdf/property-report';

export const runtime = 'nodejs';
// Uncached lookups trigger a live multi-source crawl; cached return instantly.
export const maxDuration = 120;

/**
 * GET /api/property-report?address=<full address> (POST {address} also accepted)
 * — authenticated, read-only. GEA-branded property-details report as PDF bytes
 * (application/pdf), suitable for emailing to an owner ahead of an appraisal.
 * Details only: no comparables, no commentary, no agent profile.
 * For GEA_ST_SG_assistant (server-to-server, Bearer auth, epai_stsg_ key).
 *
 * Errors: 401 bad key; 404 address not resolvable; thin profiles render with
 * gaps noted in the footnote (200).
 */

/** Valid bearer tokens: EVERYPROPERTY_API_KEYS (comma-separated) ∪ EVERYPROPERTY_API_TOKEN. */
function validTokens(): Set<string> {
  const keys = (process.env.EVERYPROPERTY_API_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const single = process.env.EVERYPROPERTY_API_TOKEN?.trim();
  if (single) keys.push(single);
  return new Set(keys);
}

function isAuthorised(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  if (!auth?.toLowerCase().startsWith('bearer ')) return false;
  const token = auth.slice(7).trim();
  return token.length > 0 && validTokens().has(token);
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

async function buildReport(raw: string): Promise<NextResponse> {
  const address = parseAddress(raw);
  if (!address.streetName && !address.suburb) {
    return NextResponse.json({ error: 'Address not resolvable' }, { status: 404 });
  }

  let profile;
  try {
    const result = await fetchAndCacheProfile(address, { skipIfCached: true });
    profile = result.profile;
  } catch (err) {
    console.error('[/api/property-report] pipeline error:', err);
    return NextResponse.json({ error: 'Address not resolvable' }, { status: 404 });
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

  const data: PropertyReportData = {
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

  const pdf = await renderPropertyReport(data, generatedDate);

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="property-report.pdf"`,
    },
  });
}

export async function GET(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const raw = request.nextUrl.searchParams.get('address')?.trim();
  if (!raw) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 });
  }
  return buildReport(raw);
}

export async function POST(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let raw: string | undefined;
  try {
    raw = ((await request.json()) as { address?: string }).address?.trim();
  } catch {
    // fall through to 400
  }
  if (!raw) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 });
  }
  return buildReport(raw);
}
