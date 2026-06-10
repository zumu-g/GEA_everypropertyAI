import type { ExtractedPropertyData, StructuredAddress } from '@/types/property';
import { extractionMatchesTarget } from '@/lib/extraction/address-match';

// Fields to skip when formatting actor output — internal Apify metadata
// and large arrays that add noise without value for LLM extraction.
const SKIP_KEYS = new Set([
  '#debug',
  '#error',
  '#version',
  'photos',
  'images',
  'floorplans',
  'videoUrl',
  'virtualTourUrl',
]);

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join(', ');
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return String(v);
}

function labelFromKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

function formatOneItem(item: Record<string, unknown>): string {
  return Object.entries(item)
    .filter(([key, v]) => {
      if (key.startsWith('#')) return false;
      if (SKIP_KEYS.has(key)) return false;
      if (v === null || v === undefined || v === '') return false;
      return true;
    })
    .map(([key, v]) => `**${labelFromKey(key)}:** ${formatValue(v)}`)
    .join('\n');
}

/**
 * Best-effort address string for an actor item across the various shapes
 * real-estate scrapers emit (string `address`, an address object, or flat
 * `streetAddress` + `suburb`). Used only to score the item against the target.
 */
function itemAddressString(item: Record<string, unknown>): string | undefined {
  const direct = item.address ?? item.addressText ?? item.displayAddress ?? item.fullAddress ?? item.title;
  if (typeof direct === 'string' && direct.trim()) return direct;
  if (direct && typeof direct === 'object') {
    const o = direct as Record<string, unknown>;
    const s = o.displayAddress ?? o.fullAddress ?? o.text ?? o.label;
    if (typeof s === 'string' && s.trim()) return s;
  }
  const street = item.streetAddress ?? item.street;
  const suburb = item.suburb ?? item.locality;
  if (typeof street === 'string' && street.trim()) {
    return [street, suburb].filter((p) => typeof p === 'string' && p).join(', ');
  }
  return undefined;
}

/** Verdict for an actor item by reusing the extraction address matcher. */
function itemVerdict(item: Record<string, unknown>, target: string | StructuredAddress) {
  const addrStr = itemAddressString(item);
  const wrapped: ExtractedPropertyData = {
    source: 'apify-item',
    raw: { address: addrStr ? { displayAddress: addrStr } : {} },
    extractedAt: new Date(),
  };
  return extractionMatchesTarget(wrapped, target);
}

/**
 * Convert Apify actor JSON output into LLM-readable markdown.
 * Produces the same shape as Firecrawl's markdown output so the extraction
 * pipeline can process it without modification.
 *
 * When `target` is supplied (plan 008), only the item(s) whose address matches
 * the target are formatted — so a neighbouring listing returned by a guessed
 * REA URL can't blend its beds/land/photos into the extraction. If no item
 * matches, address-confident *mismatches* are dropped and only address-less
 * ('abstain') items pass through; when nothing is usable the result is empty
 * (the caller then falls back to feed-seed/address-only).
 */
export function actorItemsToMarkdown(
  items: Record<string, unknown>[],
  target?: string | StructuredAddress,
): string {
  let selected = items;
  if (target && items.length > 0) {
    const scored = items.map((item) => ({ item, verdict: itemVerdict(item, target) }));
    const matches = scored.filter((s) => s.verdict === 'match');
    selected = (matches.length > 0 ? matches : scored.filter((s) => s.verdict === 'abstain')).map((s) => s.item);
  }
  return selected.map(formatOneItem).join('\n\n---\n\n');
}
