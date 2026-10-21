// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AppraisalCta } from '../AppraisalCta';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADDRESS = '1 A St, Berwick VIC 3806';

function open() {
  render(<AppraisalCta address={ADDRESS} />);
  fireEvent.click(screen.getByRole('button', { name: /get a free market appraisal/i }));
}

describe('AppraisalCta', () => {
  it('blocks submit and shows errors when name and phone are empty', async () => {
    vi.stubGlobal('fetch', vi.fn());
    open();
    fireEvent.click(screen.getByRole('button', { name: /request appraisal/i }));
    expect(await screen.findByText(/enter your name/i)).toBeInTheDocument();
    expect(screen.getByText(/enter a valid phone/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts the details with the address and shows a thank-you', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    open();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0412 345 678' } });
    fireEvent.click(screen.getByRole('button', { name: /request appraisal/i }));

    expect(await screen.findByText(/be in touch/i)).toBeInTheDocument();
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/appraisal-request');
    expect(JSON.parse(init.body)).toEqual({ name: 'Jane', phone: '0412 345 678', email: '', address: ADDRESS, website: '' });
  });

  it('shows an error and no thank-you when the send fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    open();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0412 345 678' } });
    fireEvent.click(screen.getByRole('button', { name: /request appraisal/i }));

    expect(await screen.findByText(/couldn.t send/i)).toBeInTheDocument();
    expect(screen.queryByText(/be in touch/i)).toBeNull();
  });
});
