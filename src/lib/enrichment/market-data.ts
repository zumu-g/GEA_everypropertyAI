/**
 * Suburb market data from YourInvestmentPropertyMag (CoreLogic data).
 * URL: /top-suburbs/{state}-{postcode}-{suburb}.aspx
 *
 * Data embedded as JS variables: window.suburbMarketTrends, window.suburbRentalTrends
 * No bot protection. No API key needed.
 */

export interface SuburbMarketData {
  suburb: string;
  state: string;
  postcode: string;

  // Houses
  houses: {
    medianPrice?: number;
    quarterlyGrowth?: number;
    annualGrowth?: number;
    medianRent?: number;
    grossYield?: number;
    salesCount?: number;
    avgDaysOnMarket?: number;
    monthlyMedians?: Array<{ month: string; value: number }>;
    monthlyRents?: Array<{ month: string; value: number }>;
  };

  // Units
  units: {
    medianPrice?: number;
    quarterlyGrowth?: number;
    annualGrowth?: number;
    medianRent?: number;
    grossYield?: number;
    salesCount?: number;
    avgDaysOnMarket?: number;
    monthlyMedians?: Array<{ month: string; value: number }>;
    monthlyRents?: Array<{ month: string; value: number }>;
  };

  // Demographics
  demographics?: {
    population?: number;
    populationGrowth?: number;
    medianHouseholdIncome?: number;
    predominantAgeGroup?: string;
    ownerOccupiedPercent?: number;
    topOccupation?: string;
  };

  source: string;
  fetchedAt: string;
}

const cache = new Map<string, { data: SuburbMarketData; at: number }>();
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

export async function fetchSuburbMarketData(
  suburb: string,
  state: string,
  postcode: string
): Promise<SuburbMarketData | null> {
  const key = `${suburb}-${state}-${postcode}`.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;

  try {
    const suburbSlug = suburb.toLowerCase().replace(/\s+/g, '-');
    const stateCode = state.toLowerCase();
    const url = `https://www.yourinvestmentpropertymag.com.au/top-suburbs/${stateCode}-${postcode}-${suburbSlug}.aspx`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      console.warn(`[market-data] YIPM returned ${res.status} for ${suburb}`);
      return null;
    }

    const html = await res.text();
    const data = parseMarketData(html, suburb, state, postcode);

    if (data) {
      cache.set(key, { data, at: Date.now() });
    }

    return data;
  } catch (err) {
    console.warn(`[market-data] Failed for ${suburb}:`, err);
    return null;
  }
}

function parseMarketData(
  html: string,
  suburb: string,
  state: string,
  postcode: string
): SuburbMarketData | null {
  const result: SuburbMarketData = {
    suburb,
    state,
    postcode,
    houses: {},
    units: {},
    source: 'CoreLogic via yourinvestmentpropertymag.com.au',
    fetchedAt: new Date().toISOString(),
  };

  // Structure: window.suburbMarketTrends = {
  //   "median-value": { monthly: { houses: [{dateTime, value}], units: [...] }, yearly: {...} },
  //   "median-growth": { monthly: { houses: [{dateTime, value}] } },  // value is decimal e.g. 0.0345
  //   "number-of-sales": { monthly: { houses: [{dateTime, value}] } },
  // }
  const marketMatch = html.match(/window\.suburbMarketTrends\s*=\s*(\{[\s\S]*?\});/);
  if (marketMatch) {
    try {
      const market = JSON.parse(marketMatch[1]);

      const medianValue = market['median-value'];
      const medianGrowth = market['median-growth'];
      const numSales = market['number-of-sales'];

      // Houses
      const houseValues = medianValue?.monthly?.houses;
      if (Array.isArray(houseValues) && houseValues.length > 0) {
        const latest = houseValues[houseValues.length - 1];
        result.houses.medianPrice = latest.value;
        result.houses.monthlyMedians = houseValues.map((m: { dateTime: string; value: number }) => ({
          month: m.dateTime, value: m.value,
        }));
      }
      const houseGrowth = medianGrowth?.monthly?.houses;
      if (Array.isArray(houseGrowth) && houseGrowth.length > 0) {
        const latest = houseGrowth[houseGrowth.length - 1];
        result.houses.annualGrowth = Math.round(latest.value * 10000) / 100; // decimal to %
        if (houseGrowth.length >= 4) {
          const q = houseGrowth[houseGrowth.length - 4];
          const qGrowth = latest.value - q.value;
          result.houses.quarterlyGrowth = Math.round(qGrowth * 10000) / 100;
        }
      }
      const houseSales = numSales?.monthly?.houses;
      if (Array.isArray(houseSales) && houseSales.length > 0) {
        result.houses.salesCount = houseSales[houseSales.length - 1].value;
      }

      // Units
      const unitValues = medianValue?.monthly?.units;
      if (Array.isArray(unitValues) && unitValues.length > 0) {
        const latest = unitValues[unitValues.length - 1];
        result.units.medianPrice = latest.value;
        result.units.monthlyMedians = unitValues.map((m: { dateTime: string; value: number }) => ({
          month: m.dateTime, value: m.value,
        }));
      }
      const unitGrowth = medianGrowth?.monthly?.units;
      if (Array.isArray(unitGrowth) && unitGrowth.length > 0) {
        const latest = unitGrowth[unitGrowth.length - 1];
        result.units.annualGrowth = Math.round(latest.value * 10000) / 100;
      }
      const unitSales = numSales?.monthly?.units;
      if (Array.isArray(unitSales) && unitSales.length > 0) {
        result.units.salesCount = unitSales[unitSales.length - 1].value;
      }
    } catch (e) { console.warn('[market-data] Failed to parse market trends:', e); }
  }

  // Structure: window.suburbRentalTrends = {
  //   "median-rent": { monthly: { houses: [{dateTime, value}] } },
  //   "rental-yield": { monthly: { houses: [{dateTime, value}] } },  // value is decimal e.g. 0.035
  // }
  const rentalMatch = html.match(/window\.suburbRentalTrends\s*=\s*(\{[\s\S]*?\});/);
  if (rentalMatch) {
    try {
      const rental = JSON.parse(rentalMatch[1]);

      const medianRent = rental['median-rent'];
      const rentalYield = rental['rental-yield'];

      const houseRents = medianRent?.monthly?.houses;
      if (Array.isArray(houseRents) && houseRents.length > 0) {
        result.houses.medianRent = houseRents[houseRents.length - 1].value;
      }
      const unitRents = medianRent?.monthly?.units;
      if (Array.isArray(unitRents) && unitRents.length > 0) {
        result.units.medianRent = unitRents[unitRents.length - 1].value;
      }
      const houseYield = rentalYield?.monthly?.houses;
      if (Array.isArray(houseYield) && houseYield.length > 0) {
        result.houses.grossYield = Math.round(houseYield[houseYield.length - 1].value * 10000) / 100;
      }
      const unitYield = rentalYield?.monthly?.units;
      if (Array.isArray(unitYield) && unitYield.length > 0) {
        result.units.grossYield = Math.round(unitYield[unitYield.length - 1].value * 10000) / 100;
      }
    } catch (e) { console.warn('[market-data] Failed to parse rental trends:', e); }
  }

  // Structure: window.suburbDemographics = {
  //   "total-population-2021": 50298, "total-population-2016": 47674, ...
  // }
  const demoMatch = html.match(/window\.suburbDemographics\s*=\s*(\{[\s\S]*?\});/);
  if (demoMatch) {
    try {
      const demo = JSON.parse(demoMatch[1]);
      const pop2021 = safeNum(demo['total-population-2021']);
      const pop2016 = safeNum(demo['total-population-2016']);
      result.demographics = {
        population: pop2021,
        populationGrowth: (pop2021 && pop2016) ? Math.round(((pop2021 - pop2016) / pop2016) * 1000) / 10 : undefined,
      };
    } catch { /* parsing failed */ }
  }

  // Regex fallback for days on market (from HTML, not JS vars)
  const domMatch = html.match(/(\d+)\s*(?:days?\s+on\s+market|average\s+days)/i);
  if (domMatch) {
    if (!result.houses.avgDaysOnMarket) result.houses.avgDaysOnMarket = parseInt(domMatch[1], 10);
  }
  const domMatch2 = html.match(/houses[^}]*?days[^}]*?(\d+)/i);
  if (!result.houses.avgDaysOnMarket) {
    const adm = html.match(/"avgDaysOnMarket"\s*:\s*(\d+)/);
    if (adm) result.houses.avgDaysOnMarket = parseInt(adm[1], 10);
  }

  // Check if we got any useful data
  const hasData = result.houses.medianPrice || result.units.medianPrice ||
    result.houses.medianRent || result.units.medianRent;

  return hasData ? result : null;
}

function safeNum(val: unknown): number | undefined {
  if (val == null) return undefined;
  const n = typeof val === 'string' ? parseFloat(val.replace(/[,$%]/g, '')) : Number(val);
  return isNaN(n) ? undefined : n;
}
