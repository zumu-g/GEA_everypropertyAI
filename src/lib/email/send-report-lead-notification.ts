import { Resend } from 'resend';

const NOTIFY_TO = 'stuart@grantsea.com.au';
// Resend requires a verified sending domain. The onboarding sandbox address
// below works without one, but Resend restricts sandbox sends to ONLY the
// account owner's own verified email — if NOTIFY_TO isn't that address, every
// send will silently fail (Resend errors, caught below and logged, but never
// surfaced to the user per KTD4). Set RESEND_FROM_EMAIL to a verified
// grantsea.com.au address once that domain is set up in the Resend dashboard.
const RESEND_SANDBOX_FROM = 'onboarding@resend.dev';
const NOTIFY_FROM = process.env.RESEND_FROM_EMAIL ?? RESEND_SANDBOX_FROM;

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

  if (NOTIFY_FROM === RESEND_SANDBOX_FROM) {
    console.warn(
      `[send-report-lead-notification] RESEND_FROM_EMAIL not set — sending from the Resend sandbox address, ` +
      `which only delivers to the account owner's own verified email. If ${NOTIFY_TO} is not that address, ` +
      `this send will fail. Set RESEND_FROM_EMAIL once a grantsea.com.au domain is verified in Resend.`
    );
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
