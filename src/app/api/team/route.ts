import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getSupabaseServerClient } from '@/lib/db/supabase';
import { hasAllowedDomain, isEmailAdmin, ALLOWED_EMAIL_DOMAIN } from '@/lib/auth/allowlist';

/**
 * Team / invite management. Mirrors the invite-only model in migration 009/010:
 * a teammate can sign in only if their email is on the @grantsea.com.au domain AND
 * present in `allowed_users`. Inviting adds the row (and emails a magic link);
 * revoking removes it. Admins only — the gate below is the security boundary, since
 * the older /api/admin/* routes have no auth of their own.
 */

/** Resolve the caller's email from a Bearer token or the cookie session. */
async function getSessionEmail(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data } = await supabase.auth.getUser(token);
    return data.user?.email ?? null;
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? null;
}

/** Admins-only gate. Returns the caller's normalised email, or a 401/403 response. */
async function requireAdmin(
  request: NextRequest,
): Promise<{ email: string } | { error: NextResponse }> {
  const email = await getSessionEmail(request);
  if (!email) {
    return { error: NextResponse.json({ error: 'Unauthorised' }, { status: 401 }) };
  }
  if (!(await isEmailAdmin(email))) {
    return { error: NextResponse.json({ error: 'Admins only' }, { status: 403 }) };
  }
  return { email: email.trim().toLowerCase() };
}

// ─── GET: list members ───────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const gate = await requireAdmin(request);
  if ('error' in gate) return gate.error;

  const { data, error } = await getSupabaseServerClient()
    .from('allowed_users')
    .select('email, invited_by, is_admin, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ members: data ?? [] });
}

// ─── POST: invite a teammate ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const gate = await requireAdmin(request);
  if ('error' in gate) return gate.error;

  let body: { email?: unknown; isAdmin?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const isAdmin = body.isAdmin === true;
  if (!email || !hasAllowedDomain(email)) {
    return NextResponse.json(
      { error: `Email must be a @${ALLOWED_EMAIL_DOMAIN} address` },
      { status: 400 },
    );
  }

  // Add to the allowlist (idempotent — re-inviting is a no-op on the row).
  const { error: insertError } = await getSupabaseServerClient()
    .from('allowed_users')
    .upsert(
      { email, invited_by: gate.email, is_admin: isAdmin },
      { onConflict: 'email', ignoreDuplicates: true },
    );
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Create the Supabase auth user and email a set-password (invite) link. This is
  // also where the invite-only guarantee is enforced on the credential: only this
  // admin-gated, allowlisted path ever creates an auth account (public sign-up is
  // disabled in Supabase). Best-effort on the email — the allowlist row already
  // records access, so a mail hiccup or an already-existing account doesn't fail
  // the invite.
  let emailed = true;
  try {
    const origin = new URL(request.url).origin;
    const { error: inviteError } = await getSupabaseServerClient().auth.admin.inviteUserByEmail(
      email,
      { redirectTo: `${origin}/auth/callback?returnTo=/auth/set-password` },
    );
    // "already registered" is fine — they have a credential already; not an error
    // worth failing the invite over.
    if (inviteError && !/already.*regist/i.test(inviteError.message)) emailed = false;
  } catch {
    emailed = false;
  }

  return NextResponse.json({ success: true, emailed }, { status: 201 });
}

// ─── DELETE: revoke a teammate ───────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const gate = await requireAdmin(request);
  if ('error' in gate) return gate.error;

  let body: { email?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }
  if (email === gate.email) {
    return NextResponse.json({ error: "You can't revoke your own access" }, { status: 400 });
  }

  const db = getSupabaseServerClient();

  // Refuse to remove the last admin, so the workspace can't be locked out.
  const { data: target } = await db
    .from('allowed_users')
    .select('is_admin')
    .eq('email', email)
    .maybeSingle();
  if (target?.is_admin) {
    const { count } = await db
      .from('allowed_users')
      .select('email', { count: 'exact', head: true })
      .eq('is_admin', true);
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: "Can't revoke the last admin" }, { status: 400 });
    }
  }

  const { error } = await db.from('allowed_users').delete().eq('email', email);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Destroy the credential too, so a revoked user can't sign in with a password
  // they already set. Fail-soft: the allowlist row is already gone and middleware
  // re-checks the allowlist on every protected request, so even if this delete
  // fails the user is locked out — we just report it.
  let credentialDeleted = true;
  try {
    const authUser = await findAuthUserByEmail(email);
    if (authUser) await db.auth.admin.deleteUser(authUser.id);
  } catch {
    credentialDeleted = false;
  }

  return NextResponse.json({ success: true, credentialDeleted });
}

/**
 * Find a Supabase auth user by email. supabase-js has no get-by-email, so we page
 * through admin.listUsers — fine for this small internal allowlist. Returns null if
 * not found (e.g. an invitee who never completed sign-up). Never throws.
 */
async function findAuthUserByEmail(email: string): Promise<{ id: string } | null> {
  const db = getSupabaseServerClient();
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const match = data.users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (match) return { id: match.id };
    if (data.users.length < 200) return null; // last page
  }
  return null;
}
