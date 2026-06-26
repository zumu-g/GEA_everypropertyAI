import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { isEmailAllowed } from '@/lib/auth/allowlist';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const returnTo = searchParams.get('returnTo') ?? '/my-properties';

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Invite-only gate (the bulletproof boundary): even with a valid magic link,
      // only @grantsea.com.au addresses on the allowlist may keep a session. Anyone
      // else is signed straight back out and bounced to sign-in. See allowlist.ts.
      const email = data.user?.email ?? null;
      if (await isEmailAllowed(email)) {
        return NextResponse.redirect(`${origin}${returnTo}`);
      }
      await supabase.auth.signOut();
      return NextResponse.redirect(`${origin}/sign-in?error=not_invited`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth_failed`);
}
