/**
 * Sign-in allowlist. Access is invite-only: an email may complete sign-in only if
 * BOTH hold — (1) it is on the @grantsea.com.au domain, and (2) it appears in the
 * `allowed_users` table (seeded by the admin; see migration 009).
 *
 * This is the server-side source of truth. It is enforced at the auth callback
 * (the bulletproof gate, after the magic link is verified) and surfaced earlier at
 * the sign-in step for UX via /api/auth/check-allowed. Never trust a client check
 * alone — the callback is the boundary.
 */
import { getSupabaseServerClient } from '@/lib/db/supabase';

export const ALLOWED_EMAIL_DOMAIN = 'grantsea.com.au';

/** Pure domain check — true only for @grantsea.com.au addresses. */
export function hasAllowedDomain(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

/**
 * Full allowlist check: correct domain AND present in `allowed_users`.
 * Returns false (deny) on any error — fail closed, never fail open.
 */
export async function isEmailAllowed(email: string | null | undefined): Promise<boolean> {
  if (!hasAllowedDomain(email)) return false;
  const normalised = email!.trim().toLowerCase();
  try {
    const { data, error } = await getSupabaseServerClient()
      .from('allowed_users')
      .select('email')
      .eq('email', normalised)
      .maybeSingle();
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}
