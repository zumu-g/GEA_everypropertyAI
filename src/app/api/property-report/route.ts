import { NextRequest, NextResponse } from 'next/server';
import { buildPropertyReportPdf } from '@/lib/pdf/build-property-report';

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

async function buildReport(raw: string): Promise<NextResponse> {
  const result = await buildPropertyReportPdf(raw);
  if ('notFound' in result) {
    return NextResponse.json({ error: 'Address not resolvable' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(result.pdf), {
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
