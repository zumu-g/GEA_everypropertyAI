import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/address-suggest', () => ({
  fetchAddressSuggestions: vi.fn(),
}));
vi.mock('@/lib/db/queries', () => ({
  searchAddressUniverse: vi.fn(async () => []),
}));

import { GET } from '../route';
import { fetchAddressSuggestions } from '@/lib/address-suggest';
import { searchAddressUniverse } from '@/lib/db/queries';
import { isAuthorizedApiKey } from '@/lib/auth/api-key';

const req = (q: string) =>
  new NextRequest(`http://localhost/api/address-suggest${q ? `?q=${encodeURIComponent(q)}` : ''}`);

describe('GET /api/address-suggest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns suggestions carrying fullAddress for a valid query', async () => {
    vi.mocked(fetchAddressSuggestions).mockResolvedValue([
      {
        display: '9 Bellbird Ave, Cockatoo, VIC 3781',
        suburb: 'Cockatoo',
        state: 'VIC',
        postcode: '3781',
        streetAddress: '9 Bellbird Ave',
        fullAddress: '9 Bellbird Ave, Cockatoo, VIC 3781',
      },
    ]);
    const res = await GET(req('bellbird'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.suggestions.length).toBeGreaterThan(0);
    expect(json.suggestions[0].fullAddress).toContain('Bellbird');
  });

  it('returns 400 with an empty suggestions array on a missing/short query', async () => {
    for (const q of ['', 'ab']) {
      const res = await GET(req(q));
      expect(res.status).toBe(400);
      expect((await res.json()).suggestions).toEqual([]);
    }
  });

  it('falls back to the local address universe when the portal has no match', async () => {
    vi.mocked(fetchAddressSuggestions).mockResolvedValue([]);
    vi.mocked(searchAddressUniverse).mockResolvedValue([
      {
        address_slug: '8-sunnyside-drive-berwick-vic-3806',
        raw_address: '8 SUNNYSIDE DRIVE, BERWICK VIC 3806',
        suburb: 'BERWICK',
        state: 'VIC',
        postcode: '3806',
      },
    ]);
    const res = await GET(req('8 sunnyside berwick'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.suggestions[0].fullAddress).toBe('8 Sunnyside Drive, Berwick, VIC 3806');
  });
});

describe('isAuthorizedApiKey (middleware 401 gate)', () => {
  const keys = ['epai_stsg_valid_token', 'epai_crm_other'];

  it('accepts a configured key', () => {
    expect(isAuthorizedApiKey('epai_stsg_valid_token', keys)).toBe(true);
  });

  it('rejects a missing token', () => {
    expect(isAuthorizedApiKey(undefined, keys)).toBe(false);
    expect(isAuthorizedApiKey('', keys)).toBe(false);
  });

  it('rejects wrong, prefix and superstring tokens', () => {
    expect(isAuthorizedApiKey('epai_stsg_wrong', keys)).toBe(false);
    expect(isAuthorizedApiKey('epai_stsg_valid', keys)).toBe(false);
    expect(isAuthorizedApiKey('epai_stsg_valid_token_extra', keys)).toBe(false);
  });

  it('rejects everything when no keys configured', () => {
    expect(isAuthorizedApiKey('epai_stsg_valid_token', [])).toBe(false);
  });
});
