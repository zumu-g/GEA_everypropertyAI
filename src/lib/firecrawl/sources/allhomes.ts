import type { StructuredAddress } from '@/types/property';
import type { SourceConfig } from '@/types/crawl';
import { toAddressSlug } from '../address';
import {
  allhomesProfileHtmlToMarkdown,
  allhomesProfileHtmlToExtraction,
} from '@/lib/ingest/allhomes-profile';

/**
 * allhomes.com.au — Domain-owned portal with per-property pages for OFF-MARKET
 * properties (attributes, photos from past listings, price/rental estimates,
 * sale & rental history). Serves fully server-rendered HTML to a plain fetch —
 * no bot wall — so the free direct backend is the primary.
 *
 * The URL path is exactly our canonical address slug (street type expanded),
 * e.g. /66a-duncan-drive-pakenham-vic-3810.
 */

const ORIGIN = 'https://www.allhomes.com.au';

function buildPropertyUrl(address: StructuredAddress): string {
  return `${ORIGIN}/${toAddressSlug(address)}`;
}

export const allhomesSource: SourceConfig = {
  name: 'allhomes.com.au',
  buildPropertyUrl,
  scrapeOptions: {
    timeout: 20000,
  },
  enabled: true,
  trustRank: 2,
  fetchBackend: 'direct',
  fallbackBackends: ['stealth'],
  htmlToMarkdown: allhomesProfileHtmlToMarkdown,
  htmlToExtraction: allhomesProfileHtmlToExtraction,
  refreshIntervalHours: 168,
};
