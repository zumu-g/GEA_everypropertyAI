import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '@/lib/auth/session';
import { unclaimProperty, isPropertyClaimed } from '@/lib/db/queries';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: CORS });
  const { slug } = await params;
  const claimed = await isPropertyClaimed(userId, slug);
  return NextResponse.json({ claimed }, { headers: CORS });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401, headers: CORS });
  const { slug } = await params;
  await unclaimProperty(userId, slug);
  return new NextResponse(null, { status: 204, headers: CORS });
}
