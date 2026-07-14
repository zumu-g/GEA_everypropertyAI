/**
 * Shared, pure helpers for the property-report download flow. Used by both
 * the client-side modal and the server-side route so validation and the
 * download filename can never drift between the two.
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

/** Turns an address into a filesystem/URL-safe slug for the PDF filename. */
export function addressToReportSlug(address: string): string {
  const slug = address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'property';
}
