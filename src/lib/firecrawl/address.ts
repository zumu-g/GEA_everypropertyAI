import type { StructuredAddress } from '@/types/property';
import { toSlug } from '@/lib/utils/address';

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
  // Delegates to the canonical slug builder so cache keys, profile slugs, and
  // feed-row slugs all agree (including street-type normalisation, Dr → Drive).
  return toSlug(address);
}
