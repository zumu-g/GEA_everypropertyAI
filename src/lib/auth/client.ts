import { getSupabaseBrowserClient } from '@/lib/db/supabase';

export async function signInWithMagicLink(email: string, returnTo: string) {
  const supabase = getSupabaseBrowserClient();
  const redirectTo = `${window.location.origin}/auth/callback?returnTo=${encodeURIComponent(returnTo)}`;
  return supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
}

export async function signOut() {
  return getSupabaseBrowserClient().auth.signOut();
}

export async function getUser() {
  const { data } = await getSupabaseBrowserClient().auth.getUser();
  return data.user;
}

export async function getSession() {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  return data.session;
}
