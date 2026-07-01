import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

// ─── Environment Variables ──────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/**
 * Check whether Supabase credentials are configured.
 * Query functions use this to decide whether to fall back to in-memory cache.
 */
export const isSupabaseConfigured = (): boolean =>
  Boolean(supabaseUrl && supabaseAnonKey);

// ─── Browser Client (for client components) ─────────────────────────────────
// Uses the anon key — respects RLS policies.

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (!browserClient) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Set them in .env.local or fall back to in-memory mode.'
      );
    }
    // Use the SSR browser client so the session is written to COOKIES (not just
    // localStorage). The middleware authenticates via cookies (@supabase/ssr
    // createServerClient); a plain supabase-js client stores the session in
    // localStorage only, so password sign-in never set a cookie and every
    // protected route bounced back to /sign-in. createBrowserClient keeps the two
    // in sync. See src/middleware.ts.
    browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey) as SupabaseClient;
  }
  return browserClient;
}

// ─── Server Client (for API routes / server actions) ────────────────────────
// Uses the service role key — bypasses RLS. Never expose to the browser.

let serverClient: SupabaseClient | null = null;

export function getSupabaseServerClient(): SupabaseClient {
  if (!serverClient) {
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
        'Set them in .env.local or fall back to in-memory mode.'
      );
    }
    serverClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return serverClient;
}
