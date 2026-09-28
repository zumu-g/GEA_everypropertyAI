// expireNotSeen must be scoped to one source (KTD2): the Domain webhook's
// expiry can never deactivate a row that REA or Homely owns.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: { method: string; args: unknown[] }[] = [];
let upserts: { table: string; rows: Record<string, unknown>[] }[] = [];

vi.mock('../supabase', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseServerClient: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const m of ['update', 'in', 'eq', 'lt']) {
        builder[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return builder; };
      }
      builder.select = () => Promise.resolve({ data: [{ id: 1 }, { id: 2 }], error: null });
      builder.upsert = (rows: Record<string, unknown>[]) => { upserts.push({ table, rows }); return Promise.resolve({ error: null }); };
      return builder;
    },
  }),
}));

import { expireNotSeen, insertPropertyListings, insertPropertyRentals } from '../queries';

beforeEach(() => { calls.length = 0; upserts = []; });

describe('expireNotSeen', () => {
  it('applies source=eq alongside the suburb/state/active/last_seen_at filters', async () => {
    const n = await expireNotSeen('property_listings', 'domain-apify', ['Berwick'], '2026-09-28T00:00:00Z');
    expect(n).toBe(2);
    expect(calls).toContainEqual({ method: 'eq', args: ['source', 'domain-apify'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['active', true] });
    expect(calls).toContainEqual({ method: 'in', args: ['suburb', ['Berwick']] });
    expect(calls).toContainEqual({ method: 'lt', args: ['last_seen_at', '2026-09-28T00:00:00Z'] });
    expect(calls).toContainEqual({ method: 'update', args: [{ active: false, lifecycle_status: 'withdrawn', removed_at: '2026-09-28T00:00:00Z' }] });
  });
  it('rentals close with leased_at instead of removed_at', async () => {
    await expireNotSeen('property_rentals', 'domain-apify', ['Berwick'], '2026-09-28T00:00:00Z');
    expect(calls).toContainEqual({ method: 'update', args: [{ active: false, lifecycle_status: 'withdrawn', leased_at: '2026-09-28T00:00:00Z' }] });
  });
  it('refuses to run without a source', async () => {
    await expect(expireNotSeen('property_listings', '' as string, ['Berwick'], '2026-09-28T00:00:00Z')).rejects.toThrow(/source/);
    expect(calls).toHaveLength(0);
  });
});

describe('insert helpers stamp lifecycle_status active', () => {
  it('listings and rentals both carry lifecycle_status on every row, keeping last_seen_at/active as given', async () => {
    await insertPropertyListings([{ raw_address: '1 A St', state: 'VIC', source: 'domain-apify', last_seen_at: 'x', active: true }]);
    await insertPropertyRentals([{ raw_address: '2 A St', state: 'VIC', source: 'domain-apify', last_seen_at: 'y', active: true }]);
    expect(upserts[0].rows[0]).toMatchObject({ lifecycle_status: 'active', last_seen_at: 'x', active: true, miss_count: 0, removed_at: null });
    expect(upserts[0].rows[0]).not.toHaveProperty('leased_at');
    expect(upserts[1].rows[0]).toMatchObject({ lifecycle_status: 'active', last_seen_at: 'y', active: true, miss_count: 0, removed_at: null, leased_at: null });
  });
});
