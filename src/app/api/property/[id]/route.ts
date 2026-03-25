import { NextRequest, NextResponse } from 'next/server';
import { propertyCache } from '@/lib/cache';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * OPTIONS /api/property/:id — CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/property/:id
 *
 * Returns a cached property profile by its address slug (id).
 * Returns 404 if the property is not found or the cache entry has expired.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: 'Property ID is required.' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const profile = propertyCache.get(id);

  if (!profile) {
    return NextResponse.json(
      { error: 'Property not found.' },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    { profile },
    { status: 200, headers: CORS_HEADERS }
  );
}
