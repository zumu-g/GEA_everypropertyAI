import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '@/lib/auth/session';
import { getUserProperties, claimProperty, getCachedProfile } from '@/lib/db/queries';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: CORS });
  }

  const records = await getUserProperties(userId);

  // Enrich with cached estimated value
  const properties = await Promise.all(
    records.map(async (r) => {
      const cached = await getCachedProfile(r.address_slug);
      const data = cached?.data as Record<string, unknown> | undefined;
      return {
        slug: r.address_slug,
        fullAddress: r.full_address,
        claimedAt: r.claimed_at,
        estimatedValue: (data?.priceMid ?? data?.estimatedValue ?? null) as number | null,
      };
    })
  );

  return NextResponse.json({ properties }, { headers: CORS });
}

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: CORS });
  }

  let body: { slug?: string; fullAddress?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS });
  }

  const { slug, fullAddress } = body;
  if (!slug || !fullAddress) {
    return NextResponse.json({ error: 'slug and fullAddress required' }, { status: 400, headers: CORS });
  }

  await claimProperty(userId, slug, fullAddress);
  return NextResponse.json({ success: true }, { status: 201, headers: CORS });
}
