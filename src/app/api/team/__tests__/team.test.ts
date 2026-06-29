import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The route authenticates the caller via a Bearer token (getSessionEmail →
// supabase-js createClient(...).auth.getUser(token)) and gates on isEmailAdmin.
// We stub both so we can exercise the invite/revoke credential lifecycle directly.

const adminEmail = 'admin@grantsea.com.au';

// Hoisted so the vi.mock factories below can reference them safely.
const h = vi.hoisted(() => ({
  inviteUserByEmail: vi.fn(),
  deleteUser: vi.fn(),
  listUsers: vi.fn(),
  upsert: vi.fn(),
  delEq: vi.fn(),
  del: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { email: 'admin@grantsea.com.au' } } }) },
  }),
}));

vi.mock('@/lib/auth/allowlist', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/allowlist')>('@/lib/auth/allowlist');
  return { ...actual, isEmailAdmin: async () => true };
});

vi.mock('@/lib/db/supabase', () => ({
  getSupabaseServerClient: () => ({
    from: () => ({
      upsert: h.upsert,
      delete: h.del,
      select: () => ({ eq: () => ({ maybeSingle: h.maybeSingle }) }),
    }),
    auth: { admin: { inviteUserByEmail: h.inviteUserByEmail, listUsers: h.listUsers, deleteUser: h.deleteUser } },
  }),
}));

import { POST, DELETE } from '../route';

function req(method: string, body: unknown): NextRequest {
  return new NextRequest('https://app.example.com/api/team', {
    method,
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.inviteUserByEmail.mockResolvedValue({ error: null });
  h.deleteUser.mockResolvedValue({ error: null });
  h.listUsers.mockResolvedValue({
    data: { users: [{ id: 'user-123', email: 'mate@grantsea.com.au' }] },
    error: null,
  });
  h.upsert.mockResolvedValue({ error: null });
  h.delEq.mockResolvedValue({ error: null });
  h.del.mockReturnValue({ eq: h.delEq });
  h.maybeSingle.mockResolvedValue({ data: { is_admin: false } });
});

describe('POST /api/team (invite)', () => {
  it('upserts the allowlist and emails a set-password (invite) link', async () => {
    const res = await POST(req('POST', { email: 'mate@grantsea.com.au' }));
    expect(res.status).toBe(201);
    expect(h.upsert).toHaveBeenCalledOnce();
    expect(h.inviteUserByEmail).toHaveBeenCalledOnce();
    const [email, opts] = h.inviteUserByEmail.mock.calls[0] as [string, { redirectTo: string }];
    expect(email).toBe('mate@grantsea.com.au');
    expect(opts.redirectTo).toContain('/auth/callback?returnTo=/auth/set-password');
  });

  it('rejects a non-@grantsea.com.au email without inviting', async () => {
    const res = await POST(req('POST', { email: 'someone@gmail.com' }));
    expect(res.status).toBe(400);
    expect(h.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('still succeeds (emailed:false) when the user already exists', async () => {
    h.inviteUserByEmail.mockResolvedValueOnce({ error: { message: 'User already registered' } });
    const res = await POST(req('POST', { email: 'mate@grantsea.com.au' }));
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
  });
});

describe('DELETE /api/team (revoke)', () => {
  it('deletes the allowlist row AND destroys the auth credential', async () => {
    const res = await DELETE(req('DELETE', { email: 'mate@grantsea.com.au' }));
    expect(res.status).toBe(200);
    expect(h.del).toHaveBeenCalled();
    expect(h.deleteUser).toHaveBeenCalledWith('user-123');
  });

  it('blocks self-revoke and does not delete any credential', async () => {
    const res = await DELETE(req('DELETE', { email: adminEmail }));
    expect(res.status).toBe(400);
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it('blocks revoking the last admin', async () => {
    h.maybeSingle.mockResolvedValueOnce({ data: { is_admin: true } });
    const res = await DELETE(req('DELETE', { email: 'mate@grantsea.com.au' }));
    expect(res.status).toBe(400);
    expect(h.deleteUser).not.toHaveBeenCalled();
  });
});
