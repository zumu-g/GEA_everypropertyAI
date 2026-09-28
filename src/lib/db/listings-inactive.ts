import { getSupabaseServerClient, isSupabaseConfigured } from './supabase';
import { normaliseSuburbAlias } from '@/lib/utils/address';
import type { PropertyListingRecord, PropertyRentalRecord } from './queries';

/**
 * Suburb reads WITHOUT the active filter, for includeInactive=true (R6). Kept
 * apart from getListingsForSuburb / getRentalsForSuburb so the default path is
 * untouched. Ordered by last_seen_at desc so closed rows sit behind live ones.
 */
async function suburbAll<T>(table: string, suburb: string, state: string, limit: number): Promise<T[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseServerClient()
    .from(table)
    .select('*')
    .ilike('suburb', normaliseSuburbAlias(suburb))
    .eq('state', state.toUpperCase())
    .order('last_seen_at', { ascending: false })
    .limit(limit);
  if (error) { console.error(`[${table} all]`, error.message); return []; }
  return (data ?? []) as T[];
}

export const getListingsForSuburbAll = (suburb: string, state: string, limit = 200) =>
  suburbAll<PropertyListingRecord>('property_listings', suburb, state, limit);
export const getRentalsForSuburbAll = (suburb: string, state: string, limit = 200) =>
  suburbAll<PropertyRentalRecord>('property_rentals', suburb, state, limit);
