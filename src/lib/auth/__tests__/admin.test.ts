import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Supabase server client so isEmailAdmin's DB lookup is controllable.
const maybeSingle = vi.fn();
vi.mock('@/lib/db/supabase', () => ({
  getSupabaseServerClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  }),
}));

import { isEmailAdmin } from '../allowlist';

describe('isEmailAdmin', () => {
  beforeEach(() => maybeSingle.mockReset());

  it('rejects non-@grantsea.com.au addresses without touching the DB', async () => {
    expect(await isEmailAdmin('someone@gmail.com')).toBe(false);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('returns true only when the row has is_admin = true', async () => {
    maybeSingle.mockResolvedValue({ data: { is_admin: true }, error: null });
    expect(await isEmailAdmin('admin@grantsea.com.au')).toBe(true);
  });

  it('returns false for a non-admin invitee', async () => {
    maybeSingle.mockResolvedValue({ data: { is_admin: false }, error: null });
    expect(await isEmailAdmin('staff@grantsea.com.au')).toBe(false);
  });

  it('fails closed on a missing row or DB error', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await isEmailAdmin('ghost@grantsea.com.au')).toBe(false);
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await isEmailAdmin('admin@grantsea.com.au')).toBe(false);
  });
});
