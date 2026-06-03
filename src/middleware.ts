import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * API-key gate for the public data routes (CLI / server-to-server consumers like
 * GEA_HR_recruitAI). Same-origin browser calls from the PropertyIQ website are
 * exempt so the UI keeps working. Enforced only when EVERYPROPERTY_API_KEYS is
 * set (comma-separated); unset = allow + warn (so dev/un-configured deploys don't
 * break). Note: Sec-Fetch-Site is browser-set and spoofable by non-browser
 * clients — this stops casual anonymous use, it is not a hard security boundary.
 */
function apiKeyGate(request: NextRequest): NextResponse | null {
  if (request.method === 'OPTIONS') return null; // let the route handle CORS preflight

  const site = request.headers.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'none') return null; // the website's own calls

  const keys = (process.env.EVERYPROPERTY_API_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length === 0) {
    console.warn('[middleware] EVERYPROPERTY_API_KEYS unset — API auth disabled (allowing request)');
    return null;
  }

  const auth = request.headers.get('authorization');
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : undefined;
  const provided = bearer ?? request.headers.get('x-api-key') ?? undefined;
  if (provided && keys.includes(provided)) return null;

  return NextResponse.json(
    { error: 'Unauthorized — missing or invalid API key' },
    { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } }
  );
}

export async function middleware(request: NextRequest) {
  // Data API routes: API-key gate (see config.matcher below).
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return apiKeyGate(request) ?? NextResponse.next();
  }

  // /my-properties: Supabase user-session gate.
  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const returnTo = encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(new URL(`/sign-in?returnTo=${returnTo}`, request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/my-properties',
    '/my-properties/:path*',
    // Public data routes consumed by the CLI / external apps (NOT ingest or cron,
    // which authenticate with their own secrets).
    '/api/search',
    '/api/address-suggest',
    '/api/property',
    '/api/property/:path*',
    '/api/comparable-sales',
    '/api/sold-sales',
    '/api/on-market-listings',
    '/api/rental-listings',
    '/api/street-details',
    '/api/enrich',
  ],
};
