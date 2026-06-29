import { getSupabaseBrowserClient } from '@/lib/db/supabase';

export async function signInWithPassword(email: string, password: string) {
  return getSupabaseBrowserClient().auth.signInWithPassword({ email, password });
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
