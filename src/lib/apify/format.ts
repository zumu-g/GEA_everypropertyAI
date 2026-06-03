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

/**
 * Convert Apify actor JSON output into LLM-readable markdown.
 * Produces the same shape as Firecrawl's markdown output so the extraction
 * pipeline can process it without modification.
 */
export function actorItemsToMarkdown(items: Record<string, unknown>[]): string {
  return items
    .map(item =>
      Object.entries(item)
        .filter(([key, v]) => {
          if (key.startsWith('#')) return false;
          if (SKIP_KEYS.has(key)) return false;
          if (v === null || v === undefined || v === '') return false;
          return true;
        })
        .map(([key, v]) => `**${labelFromKey(key)}:** ${formatValue(v)}`)
        .join('\n')
    )
    .join('\n\n---\n\n');
}
