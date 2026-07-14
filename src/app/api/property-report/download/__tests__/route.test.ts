import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const buildPropertyReportPdf = vi.fn();
const sendReportLeadNotification = vi.fn();

vi.mock('@/lib/pdf/build-property-report', () => ({
  buildPropertyReportPdf: (...args: unknown[]) => buildPropertyReportPdf(...args),
}));

vi.mock('@/lib/email/send-report-lead-notification', () => ({
  sendReportLeadNotification: (...args: unknown[]) => sendReportLeadNotification(...args),
}));

function post(body: unknown) {
  return new NextRequest(new URL('/api/property-report/download', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/property-report/download', () => {
  beforeEach(() => {
    buildPropertyReportPdf.mockReset();
    sendReportLeadNotification.mockReset();
    sendReportLeadNotification.mockResolvedValue(undefined);
  });

  it('rejects an empty/whitespace-only name with 400 and does not build a PDF or send an email', async () => {
    const { POST } = await import('../route');
    const res = await POST(post({ name: '   ', email: 'a@b.com', address: '1 A St, Berwick VIC 3806' }));
    expect(res.status).toBe(400);
    expect(buildPropertyReportPdf).not.toHaveBeenCalled();
    expect(sendReportLeadNotification).not.toHaveBeenCalled();
  });

  it('rejects a malformed email with 400 and does not build a PDF or send an email', async () => {
    const { POST } = await import('../route');
    const res = await POST(post({ name: 'Jane Client', email: 'not-an-email', address: '1 A St, Berwick VIC 3806' }));
    expect(res.status).toBe(400);
    expect(buildPropertyReportPdf).not.toHaveBeenCalled();
    expect(sendReportLeadNotification).not.toHaveBeenCalled();
  });

  it('returns 404 when the address does not resolve', async () => {
    buildPropertyReportPdf.mockResolvedValue({ notFound: true });
    const { POST } = await import('../route');
    const res = await POST(post({ name: 'Jane Client', email: 'jane@example.com', address: 'nowhere' }));
    expect(res.status).toBe(404);
    expect(sendReportLeadNotification).not.toHaveBeenCalled();
  });

  it('returns the PDF as an attachment on valid input and triggers the lead notification with correct details', async () => {
    buildPropertyReportPdf.mockResolvedValue({
      pdf: Buffer.from('%PDF-fake'),
      address: '1 A St, Berwick VIC 3806',
    });
    const { POST } = await import('../route');
    const res = await POST(
      post({ name: 'Jane Client', email: 'jane@example.com', address: '1 A St, Berwick VIC 3806' })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('attachment');

    // Notification is fired (not awaited by the response path) — flush microtasks.
    await new Promise((r) => setTimeout(r, 0));
    expect(sendReportLeadNotification).toHaveBeenCalledWith({
      name: 'Jane Client',
      email: 'jane@example.com',
      address: '1 A St, Berwick VIC 3806',
    });
  });

  it('still returns 200 with the PDF when the Resend notification rejects', async () => {
    buildPropertyReportPdf.mockResolvedValue({
      pdf: Buffer.from('%PDF-fake'),
      address: '1 A St, Berwick VIC 3806',
    });
    sendReportLeadNotification.mockRejectedValue(new Error('Resend down'));
    const { POST } = await import('../route');
    const res = await POST(
      post({ name: 'Jane Client', email: 'jane@example.com', address: '1 A St, Berwick VIC 3806' })
    );
    expect(res.status).toBe(200);
  });
});
