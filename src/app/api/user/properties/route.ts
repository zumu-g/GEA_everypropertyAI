import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getUserProperties, claimProperty, getCachedProfile } from '@/lib/db/queries';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

async function getUserId(request: NextRequest): Promise<string | null> {
  // Try Bearer token first (from client-side fetches)
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data } = await supabase.auth.getUser(token);
    return data.user?.id ?? null;
  }

  // Fall back to cookie session
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }
  );
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
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
