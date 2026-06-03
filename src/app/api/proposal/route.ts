import { NextRequest, NextResponse } from 'next/server';
import { parseAddress } from '@/lib/utils/address';
import { fetchAndCacheProfile } from '@/lib/jobs/fetch-profile';

export const runtime = 'nodejs';
// Uncached lookups trigger a live multi-source crawl; cached return instantly.
export const maxDuration = 120;

/**
 * GET /api/proposal — authenticated, read-only. Presentation-ready property data
 * for a proposal document (subject attributes, price estimate, agency/agent, hero
 * photos, description). For GEA_ST_proposals (server-to-server, Bearer auth).
 *
 * Query: address (required, free text), fast=1 (optional — quick partial, fills
 * the rest in the background). Reuses the property pipeline + cache.
 *
 * NOTE: an uncached address runs the full crawl (~up to 120s); cached is instant.
 */

interface ProposalResponse {
  address: string;
  addressSlug: string;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landAreaSqm?: number;
  propertyType?: string;
  priceEstimate?: { low?: number; mid?: number; high?: number; source?: string } | unknown;
  formattedEstimate?: string;
  agency?: string;
  agentName?: string;
  heroPhotos: string[];
  suburb?: string;
  description?: string;
  confidence: number;
}

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

export async function GET(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const raw = request.nextUrl.searchParams.get('address')?.trim();
  if (!raw) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 });
  }
  const fast = ['1', 'true', 'yes'].includes(
    (request.nextUrl.searchParams.get('fast') ?? '').toLowerCase()
  );

  const address = parseAddress(raw);
  if (!address.streetName && !address.suburb) {
    return NextResponse.json({ error: 'Could not parse a usable address' }, { status: 400 });
  }

  let profile;
  let slug: string;
  try {
    const result = await fetchAndCacheProfile(address, { fast, skipIfCached: true });
    profile = result.profile;
    slug = result.slug;
  } catch (err) {
    console.error('[/api/proposal] pipeline error:', err);
    return NextResponse.json({ error: 'Failed to build proposal data' }, { status: 502 });
  }

  const d = (profile?.data ?? {}) as Record<string, unknown>;

  const low = asNumber(pick(d, ['priceLow']));
  const mid = asNumber(pick(d, ['priceMid']));
  const high = asNumber(pick(d, ['priceHigh']));
  const priceEstimate =
    low || mid || high
      ? { low, mid, high, source: pick<string>(d, ['priceSource']) }
      : pick(d, ['priceEstimate', 'enrichedEstimate', 'estimate', 'valuation', 'estimatedValue']);

  const heroPhotos = ((pick<unknown[]>(d, ['photos', 'media', 'images']) ?? []) as unknown[])
    .map((p) => (typeof p === 'string' ? p : (p as { url?: string })?.url))
    .filter((u): u is string => typeof u === 'string')
    .slice(0, 6);

  const composed = `${address.streetNumber ?? ''} ${address.streetName ?? ''} ${address.streetType ?? ''}, ${address.suburb ?? ''} ${address.state ?? ''} ${address.postcode ?? ''}`
    .replace(/\s+/g, ' ')
    .trim();

  const body: ProposalResponse = {
    address: address.displayAddress ?? composed,
    addressSlug: slug,
    bedrooms: asNumber(pick(d, ['bedrooms', 'beds'])),
    bathrooms: asNumber(pick(d, ['bathrooms', 'baths'])),
    carSpaces: asNumber(pick(d, ['carSpaces', 'carspaces', 'parking', 'garages'])),
    landAreaSqm: asNumber(pick(d, ['landAreaSqm', 'landSize', 'landArea'])),
    propertyType: pick<string>(d, ['propertyType', 'type']),
    priceEstimate,
    formattedEstimate:
      mid !== undefined
        ? mid.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })
        : undefined,
    agency: pick<string>(d, ['agency', 'agencyName']),
    agentName: pick<string>(d, ['agentName', 'agent']),
    heroPhotos,
    suburb: address.suburb || pick<string>(d, ['suburb']),
    description: pick<string>(d, ['description', 'summary']),
    confidence: asNumber(profile?.overallConfidence) ?? 0,
  };

  return NextResponse.json(body);
}
