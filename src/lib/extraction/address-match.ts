/**
 * Address matching for extraction guard (plan 008).
 *
 * Decides whether a scraped/extracted property record actually refers to the
 * TARGET address, so a neighbouring listing can't contribute its attributes.
 * Returns a three-way verdict:
 *   - 'match'    — the record's address agrees with the target (no contradiction,
 *                  and at least a street number or name is present to confirm).
 *   - 'mismatch' — the record carries an address that CONTRADICTS the target
 *                  (different street number, street name, or suburb).
 *   - 'abstain'  — the record has no usable address; can't decide here (the
 *                  Apify item-selection gate is the primary defence in that case).
 *
 * Pure. The drop-gate in fetch-profile.ts discards only 'mismatch' (not 'abstain').
 */

import type { ExtractedPropertyData, StructuredAddress } from '@/types/property';
import { parseAddress } from '@/lib/utils/address';

export type AddressMatchVerdict = 'match' | 'mismatch' | 'abstain';

interface AddrParts {
  streetNumber?: string;
  streetName?: string;
  suburb?: string;
}

const norm = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

/** Street-name tokens of length > 2, minus common street-type words. */
const STREET_TYPE_WORDS = new Set([
  'st', 'street', 'rd', 'road', 'ave', 'avenue', 'dr', 'drive', 'cres', 'crescent',
  'ct', 'court', 'pl', 'place', 'ln', 'lane', 'tce', 'terrace', 'pde', 'parade',
  'cl', 'close', 'gr', 'grove', 'blvd', 'boulevard', 'hwy', 'highway', 'way', 'cct', 'circuit',
]);

function nameTokens(name: string): string[] {
  return norm(name)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STREET_TYPE_WORDS.has(t));
}

/** True when two street names share a meaningful token (or one contains the other). */
function streetNamesOverlap(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  return ta.some((t) => tb.includes(t));
}

/** Pull the comparable address parts out of an extraction (raw.address → data.address → displayAddress). */
function extractionParts(extraction: ExtractedPropertyData): AddrParts {
  const fromRaw = extraction.raw?.address as Record<string, unknown> | undefined;
  const fromData = extraction.data?.address as Record<string, unknown> | undefined;
  const addr = fromRaw ?? fromData ?? {};

  let streetNumber = norm(addr.streetNumber) || undefined;
  let streetName = norm(addr.streetName) || undefined;
  let suburb = norm(addr.suburb) || undefined;

  // Fall back to parsing a free-text displayAddress when structured fields are missing.
  if (!streetNumber && !streetName) {
    const display = addr.displayAddress ?? addr.fullAddress;
    if (typeof display === 'string' && display.trim()) {
      try {
        const p = parseAddress(display);
        streetNumber = norm(p.streetNumber) || undefined;
        streetName = norm(p.streetName) || undefined;
        suburb = suburb ?? (norm(p.suburb) || undefined);
      } catch {
        /* unparseable — leave as-is */
      }
    }
  }

  return { streetNumber, streetName, suburb };
}

function targetParts(target: string | StructuredAddress): AddrParts {
  const t = typeof target === 'string' ? parseAddress(target) : target;
  return {
    streetNumber: norm(t.streetNumber) || undefined,
    streetName: norm(t.streetName) || undefined,
    suburb: norm(t.suburb) || undefined,
  };
}

export function extractionMatchesTarget(
  extraction: ExtractedPropertyData,
  target: string | StructuredAddress,
): AddressMatchVerdict {
  const e = extractionParts(extraction);
  const t = targetParts(target);

  // No usable address on the extraction → can't decide here.
  if (!e.streetNumber && !e.streetName) return 'abstain';

  // Contradictions → mismatch.
  if (e.streetNumber && t.streetNumber && e.streetNumber !== t.streetNumber) return 'mismatch';
  if (e.streetName && t.streetName && !streetNamesOverlap(e.streetName, t.streetName)) return 'mismatch';
  if (e.suburb && t.suburb && e.suburb !== t.suburb) return 'mismatch';

  // Has a usable address and nothing contradicts the target.
  return 'match';
}

/**
 * Partition extractions into those kept for merge (verdict 'match' or 'abstain')
 * and a count of those dropped for a confident address 'mismatch'. The drop-gate
 * applied in fetch-profile.ts over all extractions (both LLM + Firecrawl-native).
 */
export function partitionByAddressMatch(
  extractions: ExtractedPropertyData[],
  target: string | StructuredAddress,
): { kept: ExtractedPropertyData[]; droppedCount: number } {
  const kept = extractions.filter((e) => extractionMatchesTarget(e, target) !== 'mismatch');
  return { kept, droppedCount: extractions.length - kept.length };
}
