import { createClient, SupabaseClient } from '@supabase/supabase-js';

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
    browserClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
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
