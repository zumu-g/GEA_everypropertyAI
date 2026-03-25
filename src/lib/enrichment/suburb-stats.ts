/**
 * Suburb statistics enrichment.
 * Scrapes suburb data from realestate.com.au and domain.com.au suburb profiles.
 */

export interface SuburbStats {
  suburb: string;
  state: string;
  postcode: string;
  medianHousePrice?: number;
  medianUnitPrice?: number;
  medianRentHouse?: number;
  medianRentUnit?: number;
  annualGrowthPercent?: number;
  fiveYearGrowthPercent?: number;
  averageDaysOnMarket?: number;
  auctionClearancePercent?: number;
  population?: number;
  medianAge?: number;
  ownerOccupiedPercent?: number;
  renterPercent?: number;
  familyPercent?: number;
  medianIncome?: number;
  source: string;
  fetchedAt: string;
}

// In-memory cache
const cache = new Map<string, { data: SuburbStats; at: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function fetchSuburbStats(
  suburb: string,
  state: string,
  postcode: string
): Promise<SuburbStats | null> {
  const key = `${suburb}-${state}-${postcode}`.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;

  try {
    const slug = suburb.toLowerCase().replace(/\s+/g, '-');
    const stateL = state.toLowerCase();
    const url = `https://www.realestate.com.au/neighbourhoods/${slug}-${postcode}-${stateL}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[suburb-stats] REA returned ${res.status} for ${suburb}`);
      return null;
    }

    const html = await res.text();
    const stats = parseSuburbPage(html, suburb, state, postcode);

    if (stats) {
      cache.set(key, { data: stats, at: Date.now() });
    }

    return stats;
  } catch (err) {
    console.warn(`[suburb-stats] Failed for ${suburb}:`, err);
    return null;
  }
}

function parseSuburbPage(
  html: string,
  suburb: string,
  state: string,
  postcode: string
): SuburbStats | null {
  const stats: SuburbStats = {
    suburb,
    state,
    postcode,
    source: 'realestate.com.au',
    fetchedAt: new Date().toISOString(),
  };

  // Median house price
  const medianHouse = html.match(
    /median\s+(?:house|property)\s+price[^$]*?\$\s*([\d,]+(?:\.\d+)?(?:\s*[mMkK])?)/i
  );
  if (medianHouse) stats.medianHousePrice = parsePrice(medianHouse[1]);

  // Median unit price
  const medianUnit = html.match(
    /median\s+(?:unit|apartment)\s+price[^$]*?\$\s*([\d,]+(?:\.\d+)?(?:\s*[mMkK])?)/i
  );
  if (medianUnit) stats.medianUnitPrice = parsePrice(medianUnit[1]);

  // Avg days on market
  const dom = html.match(/(\d+)\s*(?:days?\s+on\s+market|average\s+days)/i);
  if (dom) stats.averageDaysOnMarket = parseInt(dom[1], 10);

  // Annual growth
  const growth = html.match(
    /(?:annual|yearly|12\s*month)\s+growth[^-\d]*?(-?[\d.]+)\s*%/i
  );
  if (growth) stats.annualGrowthPercent = parseFloat(growth[1]);

  // Population
  const pop = html.match(/population[^0-9]*?([\d,]+)/i);
  if (pop) stats.population = parseInt(pop[1].replace(/,/g, ''), 10);

  // Median age
  const age = html.match(/median\s+age[^0-9]*?(\d+)/i);
  if (age) stats.medianAge = parseInt(age[1], 10);

  // Owner occupied
  const owner = html.match(/owner[- ]?occupied[^0-9]*?([\d.]+)\s*%/i);
  if (owner) stats.ownerOccupiedPercent = parseFloat(owner[1]);

  // Renter
  const renter = html.match(/rent(?:er|ing|ed)[^0-9]*?([\d.]+)\s*%/i);
  if (renter) stats.renterPercent = parseFloat(renter[1]);

  // Family
  const family = html.match(/famil(?:y|ies)[^0-9]*?([\d.]+)\s*%/i);
  if (family) stats.familyPercent = parseFloat(family[1]);

  return stats;
}

function parsePrice(raw: string): number {
  const cleaned = raw.replace(/[,\s]/g, '');
  let value = parseFloat(cleaned);
  if (/[mM]/.test(raw)) value *= 1_000_000;
  else if (/[kK]/.test(raw)) value *= 1_000;
  return value;
}
