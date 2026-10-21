import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const sendAppraisalRequest = vi.fn();

vi.mock('@/lib/email/send-report-lead-notification', () => ({
  sendAppraisalRequest: (...args: unknown[]) => sendAppraisalRequest(...args),
}));

function post(body: unknown) {
  return new NextRequest(new URL('/api/appraisal-request', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const valid = { name: 'Jane Client', phone: '0412 345 678', email: 'jane@example.com', address: '1 A St, Berwick VIC 3806' };

describe('POST /api/appraisal-request', () => {
  beforeEach(() => {
    sendAppraisalRequest.mockReset();
    sendAppraisalRequest.mockResolvedValue(undefined);
  });

  it.each([
    ['blank name', { ...valid, name: '  ' }],
    ['blank phone', { ...valid, phone: '' }],
    ['phone too short', { ...valid, phone: '1234' }],
    ['phone with letters', { ...valid, phone: '0412 abc 678' }],
    ['bad email', { ...valid, email: 'not-an-email' }],
    ['blank address', { ...valid, address: ' ' }],
  ])('returns 400 for %s and sends nothing', async (_label, body) => {
    const { POST } = await import('../route');
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(sendAppraisalRequest).not.toHaveBeenCalled();
  });

  it('returns 200 and sends trimmed details; email is optional', async () => {
    const { POST } = await import('../route');
    const res = await POST(post({ ...valid, name: ' Jane Client ', email: '' }));
    expect(res.status).toBe(200);
    expect(sendAppraisalRequest).toHaveBeenCalledWith({
      name: 'Jane Client',
      phone: '0412 345 678',
      email: undefined,
      address: '1 A St, Berwick VIC 3806',
    });
  });

  it('accepts +61 format', async () => {
    const { POST } = await import('../route');
    const res = await POST(post({ ...valid, phone: '+61 412 345 678' }));
    expect(res.status).toBe(200);
  });

  it('returns 502 when the email send fails', async () => {
    sendAppraisalRequest.mockRejectedValue(new Error('Resend send failed'));
    const { POST } = await import('../route');
    const res = await POST(post(valid));
    expect(res.status).toBe(502);
  });
});
