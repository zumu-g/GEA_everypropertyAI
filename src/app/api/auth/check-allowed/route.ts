import { NextRequest, NextResponse } from 'next/server';
import { isEmailAllowed } from '@/lib/auth/allowlist';

/**
 * POST /api/auth/check-allowed  { email }  → { allowed: boolean }
 *
 * UX pre-check used by the sign-in form so non-invited emails get immediate
 * feedback (and we don't send them a magic link). NOT a security boundary — the
 * auth callback re-checks server-side after the link is verified.
 */
export async function POST(request: NextRequest) {
  let email = '';
  try {
    const body = (await request.json()) as { email?: unknown };
    email = typeof body.email === 'string' ? body.email : '';
  } catch {
    return NextResponse.json({ allowed: false }, { status: 400 });
  }
  const allowed = await isEmailAllowed(email);
  return NextResponse.json({ allowed });
}
