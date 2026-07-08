import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/map-static?lat=&lng=[&zoom=][&w=][&h=]
 *
 * Same-origin proxy for the Mapbox Static Images API so MAPBOX_ACCESS_TOKEN
 * never reaches the browser. Uses the muted light-v11 style (discrete, low
 * colour) with a single steel marker at the property.
 */
const STYLE = 'light-v11';
const MARKER_COLOR = '2E5470'; // steel accent, no leading #

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  // Number(null) === 0, so missing params must be caught before coercion.
  const lat = sp.get('lat') === null ? NaN : Number(sp.get('lat'));
  const lng = sp.get('lng') === null ? NaN : Number(sp.get('lng'));
  const zoom = Math.min(Math.max(Number(sp.get('zoom')) || 16.5, 10), 19);
  const w = Math.min(Math.max(Number(sp.get('w')) || 1024, 100), 1280);
  const h = Math.min(Math.max(Number(sp.get('h')) || 480, 100), 1280);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng query params are required' }, { status: 400 });
  }

  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'Map service not configured' }, { status: 503 });
  }

  const url =
    `https://api.mapbox.com/styles/v1/mapbox/${STYLE}/static/` +
    `pin-l+${MARKER_COLOR}(${lng},${lat})/${lng},${lat},${zoom},0/${w}x${h}@2x` +
    `?access_token=${token}&attribution=true&logo=false`;

  let upstream: Response;
  try {
    upstream = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    return NextResponse.json({ error: 'Map service unreachable' }, { status: 502 });
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: `Map service returned ${upstream.status}` }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/png',
      // Property coordinates don't move — cache aggressively in the browser.
      'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800',
    },
  });
}
