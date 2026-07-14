import { NextRequest, NextResponse } from 'next/server';
import { buildPropertyReportPdf } from '@/lib/pdf/build-property-report';
import { sendReportLeadNotification } from '@/lib/email/send-report-lead-notification';
import { isValidEmail, addressToReportSlug } from '@/lib/utils/report-download';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * POST /api/property-report/download
 * — public, client-facing (same-origin only, called from DownloadReportModal;
 * no CORS support — add it if a cross-origin caller is ever needed). Requires
 * { name, email, address }. Returns the same GEA-branded property-details PDF
 * as /api/property-report, gated by a name/email capture instead of Bearer
 * auth, and notifies stuart@grantsea.com.au of the download via Resend
 * (non-blocking — a failed notification never prevents the download from
 * succeeding).
 *
 * Errors: 400 missing/invalid name or email; 404 address not resolvable.
 */

interface DownloadRequestBody {
  name?: string;
  email?: string;
  address?: string;
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
  if (!email || !isValidEmail(email)) {
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

  const slug = addressToReportSlug(result.address);

  return new NextResponse(new Uint8Array(result.pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slug}-report.pdf"`,
    },
  });
}
