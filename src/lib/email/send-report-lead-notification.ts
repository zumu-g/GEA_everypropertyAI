import { Resend } from 'resend';

const NOTIFY_TO = 'stuart@grantsea.com.au';
// Resend requires a verified sending domain; the onboarding sandbox address
// works without one for early testing. Swap for a grantsea.com.au address
// once that domain is verified in the Resend dashboard.
const NOTIFY_FROM = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';

export interface ReportLeadNotification {
  name: string;
  email: string;
  address: string;
}

/**
 * Notifies stuart@grantsea.com.au that a client downloaded a property report.
 * Non-blocking by design (see build-property-report-download-plan KTD4): a
 * failed or skipped send never prevents the PDF download from succeeding.
 * Callers should not `await` this in the response-critical path; call it and
 * attach a `.catch()` for logging instead.
 */
export async function sendReportLeadNotification(
  lead: ReportLeadNotification
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[send-report-lead-notification] RESEND_API_KEY not set — skipping notification email.');
    return;
  }

  const timestamp = new Date().toLocaleString('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Australia/Melbourne',
  });

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: NOTIFY_FROM,
    to: NOTIFY_TO,
    subject: `Report downloaded: ${lead.address}`,
    text: [
      `A property report was downloaded.`,
      ``,
      `Name: ${lead.name}`,
      `Email: ${lead.email}`,
      `Property: ${lead.address}`,
      `Downloaded: ${timestamp} (AEDT)`,
    ].join('\n'),
  });

  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
}
