import { NextRequest, NextResponse } from 'next/server';
import { sendAppraisalRequest } from '@/lib/email/send-report-lead-notification';
import { isValidEmail } from '@/lib/utils/report-download';

export const runtime = 'nodejs';

/**
 * POST /api/appraisal-request — public, same-origin (called from AppraisalCta).
 * Requires { name, phone, address }; email optional. Emails Stuart via Resend
 * and awaits it: a failed send returns 502 so the form never shows false success.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const field = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
  const name = field('name');
  const phone = field('phone');
  const email = field('email') || undefined;
  const address = field('address');

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  // AU numbers: digits only after stripping spaces, dashes, brackets and a leading +.
  if (!/^\d{8,12}$/.test(phone.replace(/[\s\-()]/g, '').replace(/^\+/, ''))) {
    return NextResponse.json({ error: 'a valid phone number is required' }, { status: 400 });
  }
  if (email && !isValidEmail(email)) {
    return NextResponse.json({ error: 'email is invalid' }, { status: 400 });
  }
  if (!address) return NextResponse.json({ error: 'address is required' }, { status: 400 });

  try {
    await sendAppraisalRequest({ name, phone, email, address });
  } catch (err) {
    console.error('[/api/appraisal-request] send failed:', err);
    return NextResponse.json({ error: 'Could not send request' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
