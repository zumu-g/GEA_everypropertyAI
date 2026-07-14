import { NextRequest, NextResponse } from 'next/server';
import { buildPropertyReportPdf } from '@/lib/pdf/build-property-report';
import { sendReportLeadNotification } from '@/lib/email/send-report-lead-notification';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * POST /api/property-report/download
 * — public, client-facing. Requires { name, email, address }. Returns the
 * same GEA-branded property-details PDF as /api/property-report, gated by
 * a name/email capture instead of Bearer auth, and notifies
 * stuart@grantsea.com.au of the download via Resend (non-blocking — a
 * failed notification never prevents the download from succeeding).
 *
 * Errors: 400 missing/invalid name or email; 404 address not resolvable.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface DownloadRequestBody {
  name?: string;
  email?: string;
  address?: string;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function POST(request: NextRequest) {
  let body: DownloadRequestBody;
  try {
    body = (await request.json()) as DownloadRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const name = body.name?.trim();
  const email = body.email?.trim();
  const address = body.address?.trim();

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'a valid email is required' }, { status: 400 });
  }
  if (!address) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 });
  }

  const result = await buildPropertyReportPdf(address);
  if ('notFound' in result) {
    return NextResponse.json({ error: 'Address not resolvable' }, { status: 404 });
  }

  // Fire-and-forget: the download must not fail or wait on the notification.
  sendReportLeadNotification({ name, email, address: result.address }).catch((err) => {
    console.error('[/api/property-report/download] lead notification failed:', err);
  });

  const slug = result.address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return new NextResponse(new Uint8Array(result.pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slug || 'property'}-report.pdf"`,
    },
  });
}
