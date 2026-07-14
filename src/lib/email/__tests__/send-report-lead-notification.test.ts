import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const send = vi.fn();

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send } })),
}));

describe('sendReportLeadNotification', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({ data: { id: 'test' }, error: null });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('sends to stuart@grantsea.com.au with the lead details when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    const { sendReportLeadNotification } = await import('../send-report-lead-notification');

    await sendReportLeadNotification({
      name: 'Jane Client',
      email: 'jane@example.com',
      address: '1 A St, Berwick VIC 3806',
    });

    expect(send).toHaveBeenCalledTimes(1);
    const [payload] = send.mock.calls[0];
    expect(payload.to).toBe('stuart@grantsea.com.au');
    expect(payload.subject).toContain('1 A St, Berwick VIC 3806');
    expect(payload.text).toContain('Jane Client');
    expect(payload.text).toContain('jane@example.com');
  });

  it('no-ops without throwing when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    const { sendReportLeadNotification } = await import('../send-report-lead-notification');

    await expect(
      sendReportLeadNotification({ name: 'Jane Client', email: 'jane@example.com', address: '1 A St, Berwick VIC 3806' })
    ).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('throws when Resend returns an error, so the caller can log the failure', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    send.mockResolvedValue({ data: null, error: { message: 'domain not verified' } });
    const { sendReportLeadNotification } = await import('../send-report-lead-notification');

    await expect(
      sendReportLeadNotification({ name: 'Jane Client', email: 'jane@example.com', address: '1 A St, Berwick VIC 3806' })
    ).rejects.toThrow('domain not verified');
  });
});
