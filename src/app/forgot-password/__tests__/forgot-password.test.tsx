// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({ resetPasswordForEmail: vi.fn() }));

vi.mock('@/lib/db/supabase', () => ({
  getSupabaseBrowserClient: () => ({ auth: { resetPasswordForEmail: h.resetPasswordForEmail } }),
}));

import ForgotPasswordPage from '../page';

beforeEach(() => {
  vi.clearAllMocks();
  h.resetPasswordForEmail.mockResolvedValue({ error: null });
  global.fetch = vi.fn();
});
afterEach(cleanup);

describe('forgot-password form', () => {
  it('emails a reset link for an allowlisted address', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ allowed: true }) });
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'mate@grantsea.com.au' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument());
    expect(h.resetPasswordForEmail).toHaveBeenCalledOnce();
  });

  it('shows the same neutral confirmation but sends nothing for a non-allowlisted address (no enumeration)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ allowed: false }) });
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'outsider@gmail.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument());
    expect(h.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
