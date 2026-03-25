import type { StructuredAddress } from '@/types/property';

/**
 * Convert a StructuredAddress into a URL-safe slug.
 *
 * Examples:
 *   { unit: "5", streetNumber: "42", streetName: "Smith", streetType: "Street",
 *     suburb: "Sydney", state: "NSW", postcode: "2000" }
 *   → "5-42-smith-street-sydney-nsw-2000"
 *
 *   { streetNumber: "10", streetName: "King", streetType: "Road",
 *     suburb: "Melbourne", state: "VIC", postcode: "3000" }
 *   → "10-king-road-melbourne-vic-3000"
 */
export function toAddressSlug(address: StructuredAddress): string {
  const parts: string[] = [];

  if (address.unit) {
    parts.push(address.unit);
  }

  parts.push(
    address.streetNumber,
    address.streetName,
    address.streetType,
    address.suburb,
    address.state,
    address.postcode
  );

  return parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-') // replace non-alphanumeric chars with hyphens
    .replace(/-+/g, '-')          // collapse consecutive hyphens
    .replace(/^-|-$/g, '');       // trim leading/trailing hyphens
}
