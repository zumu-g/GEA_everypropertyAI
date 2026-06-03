import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Strip non-content elements before conversion — these never carry property data
// and only bloat the markdown the LLM extractor has to read.
turndown.remove(['script', 'style', 'noscript', 'svg', 'iframe', 'head']);

/**
 * Convert rendered HTML to LLM-ready markdown. This is the stealth-service
 * analogue of the Apify client's actorItemsToMarkdown() — it produces the same
 * markdown contract the PropertyIQ extraction pipeline already consumes.
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  try {
    return turndown.turndown(html).trim();
  } catch {
    return '';
  }
}
