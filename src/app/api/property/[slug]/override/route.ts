import { NextRequest, NextResponse } from 'next/server';
import { getOverrides, saveOverride, deleteOverride } from '@/lib/db/queries';

const ALLOWED_FIELDS = new Set([
  'bedrooms', 'bathrooms', 'carSpaces', 'landArea', 'buildingArea',
  'propertyType', 'yearBuilt', 'description',
]);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const overrides = await getOverrides(slug);
  return NextResponse.json({ overrides }, { headers: CORS });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  let body: { field?: string; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS });
  }

  const { field, value } = body;

  if (!field || !ALLOWED_FIELDS.has(field)) {
    return NextResponse.json(
      { error: `Field must be one of: ${[...ALLOWED_FIELDS].join(', ')}` },
      { status: 400, headers: CORS }
    );
  }

  if (value === null || value === undefined || String(value).trim() === '') {
    await deleteOverride(slug, field);
    return NextResponse.json({ success: true, action: 'deleted' }, { headers: CORS });
  }

  await saveOverride(slug, field, String(value));
  return NextResponse.json({ success: true, action: 'saved', field, value }, { headers: CORS });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { searchParams } = new URL(req.url);
  const field = searchParams.get('field');

  if (!field || !ALLOWED_FIELDS.has(field)) {
    return NextResponse.json({ error: 'Invalid field' }, { status: 400, headers: CORS });
  }

  await deleteOverride(slug, field);
  return NextResponse.json({ success: true }, { headers: CORS });
}
