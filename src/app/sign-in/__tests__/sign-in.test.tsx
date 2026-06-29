// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));

vi.mock('@/lib/db/supabase', () => ({
  getSupabaseBrowserClient: () => ({ auth: { signInWithPassword: h.signInWithPassword } }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));

import SignInPage from '../page';

function setForm(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.signInWithPassword.mockResolvedValue({ error: null });
  global.fetch = vi.fn();
});
afterEach(cleanup);

describe('sign-in form', () => {
  it('blocks a non-allowlisted email before attempting password sign-in', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ allowed: false }) });
    render(<SignInPage />);
    setForm('outsider@gmail.com', 'whatever123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toMatch(/isn't authorised/i);
    expect(h.signInWithPassword).not.toHaveBeenCalled();
  });

  it('shows a non-enumerating message on wrong password', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ allowed: true }) });
    h.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    render(<SignInPage />);
    setForm('mate@grantsea.com.au', 'wrongpass1');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // Generic — must not reveal whether the account exists.
    expect(screen.getByRole('alert').textContent).toBe('Email or password is incorrect.');
    expect(h.signInWithPassword).toHaveBeenCalledOnce();
  });
});
