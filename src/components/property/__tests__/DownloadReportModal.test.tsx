// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { DownloadReportModal } from '../DownloadReportModal';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  });
});

function mockFetchOk() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['%PDF-fake']),
    }),
  );
}

describe('DownloadReportModal', () => {
  it('shows a validation error and does not call fetch when name is empty', async () => {
    const onClose = vi.fn();
    mockFetchOk();
    render(<DownloadReportModal address="1 A St, Berwick VIC 3806" onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /download report/i }));

    expect(await screen.findByText(/enter your name/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a validation error and does not call fetch when email is malformed', async () => {
    const onClose = vi.fn();
    mockFetchOk();
    render(<DownloadReportModal address="1 A St, Berwick VIC 3806" onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane Client' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /download report/i }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('submits valid name/email, calls the download endpoint, triggers a download, and closes', async () => {
    const onClose = vi.fn();
    mockFetchOk();
    render(<DownloadReportModal address="1 A St, Berwick VIC 3806" onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane Client' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /download report/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/property-report/download',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Jane Client',
          email: 'jane@example.com',
          address: '1 A St, Berwick VIC 3806',
        }),
      }),
    ));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows an inline error and keeps the modal open when the API returns a non-200', async () => {
    const onClose = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );
    render(<DownloadReportModal address="1 A St, Berwick VIC 3806" onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane Client' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /download report/i }));

    expect(await screen.findByText(/couldn't generate a report/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape without submitting', () => {
    const onClose = vi.fn();
    mockFetchOk();
    render(<DownloadReportModal address="1 A St, Berwick VIC 3806" onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('closes on backdrop click without submitting', () => {
    const onClose = vi.fn();
    mockFetchOk();
    const { container } = render(<DownloadReportModal address="1 A St, Berwick VIC 3806" onClose={onClose} />);

    fireEvent.click(container.querySelector('[role="dialog"]')!);
    expect(onClose).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('focuses the name input on open', () => {
    const onClose = vi.fn();
    render(<DownloadReportModal address="1 A St, Berwick VIC 3806" onClose={onClose} />);
    expect(screen.getByLabelText('Name')).toHaveFocus();
  });
});
