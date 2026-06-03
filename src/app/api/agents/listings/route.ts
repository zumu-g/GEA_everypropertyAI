import { NextRequest, NextResponse } from 'next/server';
import {
  getAgentListings,
  type PropertyListingRecord,
  type PropertySaleRecord,
} from '@/lib/db/queries';

export const runtime = 'nodejs';

/**
 * GET /api/agents/listings — authenticated, read-only.
 *
 * Returns an agent's most-recent listings + sales (cap 20, newest first) for the
 * GEA_HR_recruitAI integration (server-to-server, no CORS). Auth: Bearer token in
 * the Authorization header, validated against EVERYPROPERTY_API_KEYS (or
 * EVERYPROPERTY_API_TOKEN). Unknown agent → 200 with empty listings (not 404).
 *
 * Query params:
 *   name    — agent full name (required unless agentId given)
 *   agency  — optional, disambiguates same-named agents
 *   agentId — optional derived id (base64url "name|agency"); used instead of name
 */

type ListingStatus = 'active' | 'sold' | 'under_offer' | 'withdrawn';

interface ReferenceListing {
  address: string;
  suburb: string | null;
  status: ListingStatus;
  price: string | null;
  date: string | null;
  url: string | null;
  imageUrl: string | null;
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
  if (!token) return false;
  return validTokens().has(token);
}

function deriveAgentId(name: string, agency: string | null): string {
  return Buffer.from(`${name}|${agency ?? ''}`, 'utf8').toString('base64url');
}

function decodeAgentId(id: string): { name: string; agency: string | null } | null {
  try {
    const [name, agency] = Buffer.from(id, 'base64url').toString('utf8').split('|');
    if (!name) return null;
    return { name, agency: agency || null };
  } catch {
    return null;
  }
}

function mapStatus(text: string | null | undefined, sold: boolean): ListingStatus {
  if (sold) return 'sold';
  const t = (text ?? '').toLowerCase();
  if (/under\s*(offer|contract|application)/.test(t)) return 'under_offer';
  if (/withdrawn|off[\s-]?market/.test(t)) return 'withdrawn';
  if (/\bsold\b/.test(t)) return 'sold';
  return 'active';
}

function isoDate(d: string | null | undefined): string | null {
  if (!d) return null;
  return String(d).slice(0, 10); // sale_date is DATE; created_at is ISO timestamp
}

/** Raw recency key for sorting (sale_date for sold, else created_at). */
function sortKey(row: PropertyListingRecord | PropertySaleRecord, sold: boolean): string {
  const v = sold ? (row as PropertySaleRecord).sale_date : (row as { created_at?: string }).created_at;
  return v ?? '';
}

function mapToReferenceListing(
  row: PropertyListingRecord | PropertySaleRecord,
  sold: boolean
): ReferenceListing | null {
  const address = row.raw_address?.trim();
  if (!address) return null; // address is required — drop items without one

  let price: string | null;
  if (sold) {
    const sp = (row as PropertySaleRecord).sale_price;
    price = sp != null ? `Sold $${Number(sp).toLocaleString('en-AU')}` : 'Sold';
  } else {
    price = (row as PropertyListingRecord).display_price ?? null;
  }

  return {
    address,
    suburb: row.suburb ?? null,
    status: mapStatus((row as PropertyListingRecord).status, sold),
    price,
    date: isoDate(sold ? (row as PropertySaleRecord).sale_date : (row as { created_at?: string }).created_at),
    url: row.listing_url ?? null,
    imageUrl: row.image_url ?? null,
  };
}

/** Most frequent non-null agency_name across the matched rows. */
function dominantAgency(rows: Array<{ agency_name?: string }>): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const a = r.agency_name?.trim();
    if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  let best = '';
  let max = 0;
  for (const [a, n] of counts) if (n > max) { best = a; max = n; }
  return best;
}

export async function GET(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const agentId = sp.get('agentId')?.trim() || undefined;
  let name = sp.get('name')?.trim() || undefined;
  let agency = sp.get('agency')?.trim() || undefined;

  if (agentId) {
    const decoded = decodeAgentId(agentId);
    if (decoded) {
      name = decoded.name;
      agency = decoded.agency ?? agency;
    }
  }

  if (!name) {
    return NextResponse.json({ error: 'name or agentId is required' }, { status: 400 });
  }

  const { listings, sales } = await getAgentListings({ name, agency, limit: 20 });

  const merged = [
    ...listings.map((r) => ({ row: r, sold: false, key: sortKey(r, false) })),
    ...sales.map((r) => ({ row: r, sold: true, key: sortKey(r, true) })),
  ]
    .sort((a, b) => b.key.localeCompare(a.key))
    .slice(0, 20);

  const items = merged
    .map(({ row, sold }) => mapToReferenceListing(row, sold))
    .filter((x): x is ReferenceListing => x !== null);

  const allRows = [...listings, ...sales];
  const agent =
    allRows.length === 0
      ? null
      : { id: deriveAgentId(name, agency ?? null), name, agency: dominantAgency(allRows) };

  return NextResponse.json({ agent, listings: items });
}
