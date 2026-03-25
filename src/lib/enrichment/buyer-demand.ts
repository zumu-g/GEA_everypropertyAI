/**
 * Buyer demand indicator for a suburb.
 *
 * Calculates demand based on:
 * - Days on market (lower = higher demand)
 * - Stock on market relative to sales volume
 * - Price growth (positive = higher demand)
 * - Auction clearance rates
 *
 * Uses Domain's suburb profile page for data.
 */

export interface BuyerDemand {
  level: 'very-low' | 'low' | 'moderate' | 'high' | 'very-high';
  score: number; // 0-100
  factors: DemandFactor[];
  medianHousePrice?: number;
  medianUnitPrice?: number;
  medianRentHouse?: number;
  medianRentUnit?: number;
  annualGrowth?: number;
  avgDaysOnMarket?: number;
  auctionClearance?: number;
  totalListings?: number;
  source: string;
  fetchedAt: string;
}

export interface DemandFactor {
  name: string;
  value: string;
  impact: 'positive' | 'neutral' | 'negative';
}

// Cache
const cache = new Map<string, { data: BuyerDemand; at: number }>();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

export async function fetchBuyerDemand(
  suburb: string,
  state: string,
  postcode: string
): Promise<BuyerDemand | null> {
  const key = `${suburb}-${state}-${postcode}`.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;

  try {
    // Fetch Domain suburb profile
    const slug = `${suburb.toLowerCase().replace(/\s+/g, '-')}-${state.toLowerCase()}-${postcode}`;
    const url = `https://www.domain.com.au/suburb-profile/${slug}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`[buyer-demand] Domain returned ${res.status} for ${suburb}`);
      return null;
    }

    const html = await res.text();
    const data = parseDomainSuburbProfile(html, suburb, state, postcode);

    if (data) {
      cache.set(key, { data, at: Date.now() });
    }

    return data;
  } catch (err) {
    console.warn(`[buyer-demand] Failed for ${suburb}:`, err);
    return null;
  }
}

function parseDomainSuburbProfile(
  html: string,
  suburb: string,
  state: string,
  postcode: string
): BuyerDemand | null {
  const factors: DemandFactor[] = [];
  let score = 50; // Start at neutral

  // Median house price
  const medianHouseMatch = html.match(/median\s+(?:house|property)\s+price[^$]*?\$\s*([\d,]+(?:\.\d+)?(?:\s*[mMkK])?)/i)
    ?? html.match(/\$\s*([\d,]+(?:\.\d+)?(?:\s*[mMkK])?)\s*median/i);
  const medianHousePrice = medianHouseMatch ? parseAUPrice(medianHouseMatch[1]) : undefined;

  // Median unit price
  const medianUnitMatch = html.match(/median\s+(?:unit|apartment)\s+price[^$]*?\$\s*([\d,]+(?:\.\d+)?(?:\s*[mMkK])?)/i);
  const medianUnitPrice = medianUnitMatch ? parseAUPrice(medianUnitMatch[1]) : undefined;

  // Median rent house
  const rentHouseMatch = html.match(/median\s+(?:house|property)\s+rent[^$]*?\$\s*([\d,]+)/i)
    ?? html.match(/\$\s*([\d,]+)\s*(?:\/|\s*per\s*)(?:wk|week)/i);
  const medianRentHouse = rentHouseMatch ? parseInt(rentHouseMatch[1].replace(/,/g, ''), 10) : undefined;

  // Median rent unit
  const rentUnitMatch = html.match(/median\s+(?:unit|apartment)\s+rent[^$]*?\$\s*([\d,]+)/i);
  const medianRentUnit = rentUnitMatch ? parseInt(rentUnitMatch[1].replace(/,/g, ''), 10) : undefined;

  // Annual growth
  const growthMatch = html.match(/(-?[\d.]+)\s*%\s*(?:annual|yearly|12[\s-]*month|year[\s-]on[\s-]year)\s*(?:growth|change|increase)/i)
    ?? html.match(/(?:annual|yearly)\s+(?:growth|change)[^-\d]*?(-?[\d.]+)\s*%/i);
  const annualGrowth = growthMatch ? parseFloat(growthMatch[1]) : undefined;

  if (annualGrowth != null) {
    if (annualGrowth > 10) { score += 15; factors.push({ name: 'Strong price growth', value: `${annualGrowth}%`, impact: 'positive' }); }
    else if (annualGrowth > 5) { score += 10; factors.push({ name: 'Healthy price growth', value: `${annualGrowth}%`, impact: 'positive' }); }
    else if (annualGrowth > 0) { score += 5; factors.push({ name: 'Modest price growth', value: `${annualGrowth}%`, impact: 'neutral' }); }
    else { score -= 10; factors.push({ name: 'Declining prices', value: `${annualGrowth}%`, impact: 'negative' }); }
  }

  // Days on market
  const domMatch = html.match(/(\d+)\s*(?:days?\s+on\s+market|average\s+days|median\s+days)/i);
  const avgDaysOnMarket = domMatch ? parseInt(domMatch[1], 10) : undefined;

  if (avgDaysOnMarket != null) {
    if (avgDaysOnMarket < 25) { score += 15; factors.push({ name: 'Properties selling fast', value: `${avgDaysOnMarket} days`, impact: 'positive' }); }
    else if (avgDaysOnMarket < 40) { score += 5; factors.push({ name: 'Average selling time', value: `${avgDaysOnMarket} days`, impact: 'neutral' }); }
    else { score -= 10; factors.push({ name: 'Slow market', value: `${avgDaysOnMarket} days`, impact: 'negative' }); }
  }

  // Auction clearance rate
  const auctionMatch = html.match(/(\d+(?:\.\d+)?)\s*%\s*(?:auction\s+)?clearance/i)
    ?? html.match(/clearance\s+rate[^0-9]*?(\d+(?:\.\d+)?)\s*%/i);
  const auctionClearance = auctionMatch ? parseFloat(auctionMatch[1]) : undefined;

  if (auctionClearance != null) {
    if (auctionClearance > 75) { score += 10; factors.push({ name: 'High auction clearance', value: `${auctionClearance}%`, impact: 'positive' }); }
    else if (auctionClearance > 60) { score += 5; factors.push({ name: 'Moderate auction clearance', value: `${auctionClearance}%`, impact: 'neutral' }); }
    else { score -= 5; factors.push({ name: 'Low auction clearance', value: `${auctionClearance}%`, impact: 'negative' }); }
  }

  // Total listings
  const listingsMatch = html.match(/(\d+)\s*(?:properties?\s+(?:for\s+sale|listed)|listings?\s+available|total\s+listings)/i);
  const totalListings = listingsMatch ? parseInt(listingsMatch[1], 10) : undefined;

  if (totalListings != null) {
    if (totalListings < 30) { score += 10; factors.push({ name: 'Low stock — seller\'s market', value: `${totalListings} listings`, impact: 'positive' }); }
    else if (totalListings < 80) { factors.push({ name: 'Balanced stock', value: `${totalListings} listings`, impact: 'neutral' }); }
    else { score -= 5; factors.push({ name: 'High stock — buyer\'s market', value: `${totalListings} listings`, impact: 'negative' }); }
  }

  // Rental yield factor
  if (medianHousePrice && medianRentHouse) {
    const yieldPct = ((medianRentHouse * 52) / medianHousePrice) * 100;
    if (yieldPct > 4) { score += 5; factors.push({ name: 'Strong rental yield', value: `${yieldPct.toFixed(1)}%`, impact: 'positive' }); }
    else if (yieldPct > 3) { factors.push({ name: 'Average rental yield', value: `${yieldPct.toFixed(1)}%`, impact: 'neutral' }); }
    else { factors.push({ name: 'Low rental yield', value: `${yieldPct.toFixed(1)}%`, impact: 'negative' }); }
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  const level: BuyerDemand['level'] =
    score >= 80 ? 'very-high' :
    score >= 65 ? 'high' :
    score >= 45 ? 'moderate' :
    score >= 25 ? 'low' : 'very-low';

  return {
    level,
    score,
    factors,
    medianHousePrice,
    medianUnitPrice,
    medianRentHouse,
    medianRentUnit,
    annualGrowth,
    avgDaysOnMarket,
    auctionClearance,
    totalListings,
    source: 'domain.com.au',
    fetchedAt: new Date().toISOString(),
  };
}

function parseAUPrice(raw: string): number {
  const cleaned = raw.replace(/[,\s]/g, '');
  let value = parseFloat(cleaned);
  if (/[mM]/.test(raw)) value *= 1_000_000;
  else if (/[kK]/.test(raw)) value *= 1_000;
  return value;
}
