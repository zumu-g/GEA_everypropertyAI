/**
 * Enriched price estimation using market data + sale history + rental yield.
 * Called AFTER enrichment data arrives, providing growth-adjusted estimates.
 */

export interface PriceEstimateInput {
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landAreaSqm?: number;
  priceNumeric?: number;
  priceFrom?: number;
  priceTo?: number;
  saleHistory?: Array<{
    date?: string;
    price?: number;
    isConfidential?: boolean;
  }>;
  rentalHistory?: Array<{
    date?: string;
    weeklyRent?: number;
  }>;
  listingStatus?: string;
  // Fields from regex/LLM extraction
  priceLow?: number;
  priceMid?: number;
  priceHigh?: number;
  currentPrice?: number;
  estimatedValue?: number;
}

export interface MarketDataInput {
  houses?: {
    medianPrice?: number;
    annualGrowth?: number;
    medianRent?: number;
    grossYield?: number;
  };
  units?: {
    medianPrice?: number;
    annualGrowth?: number;
    medianRent?: number;
    grossYield?: number;
  };
}

export interface PriceEstimateResult {
  priceLow: number;
  priceMid: number;
  priceHigh: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  confidenceBand: number;
  confidenceScore: number;
  priceSource: string;
  methodology: string;
  growthAdjustment?: {
    originalPrice: number;
    originalDate: string;
    monthsElapsed: number;
    annualGrowthUsed: number;
    adjustedPrice: number;
  };
}

export function calculateEnrichedPriceEstimate(
  property: PriceEstimateInput,
  marketData: MarketDataInput | null
): PriceEstimateResult | null {
  // Step 0: Determine property segment
  const isUnit = ['apartment', 'unit', 'studio'].includes(property.propertyType ?? '');
  const segment = isUnit ? marketData?.units : marketData?.houses;
  const annualGrowth = segment?.annualGrowth ?? 0;
  const monthlyGrowth = annualGrowth / 12 / 100;
  const suburbMedian = segment?.medianPrice;
  const grossYield = segment?.grossYield;
  const medianRent = segment?.medianRent;

  let priceLow: number;
  let priceMid: number;
  let priceHigh: number;
  let band: number;
  let confidence: number;
  let source: string;
  let methodology: string;
  let growthAdjustment: PriceEstimateResult['growthAdjustment'];

  // Priority 1: Active listing with price range
  const priceFrom = property.priceFrom;
  const priceTo = property.priceTo;
  if (priceFrom && priceTo && priceFrom > 100000 && priceTo > 100000) {
    priceLow = Math.min(priceFrom, priceTo);
    priceHigh = Math.max(priceFrom, priceTo);
    priceMid = Math.round((priceLow + priceHigh) / 2);
    // Add small buffer beyond the guide
    const buffer = Math.round((priceHigh - priceLow) * 0.15);
    priceLow = priceLow - buffer;
    priceHigh = priceHigh + buffer;
    band = 3;
    confidence = 90;
    source = 'listing-guide';
    methodology = `Based on listing price guide of ${fmtCurrency(priceFrom)} - ${fmtCurrency(priceTo)}.`;
    return buildResult(priceLow, priceMid, priceHigh, band, confidence, source, methodology);
  }

  // Priority 2: Active listing with single price
  const listingPrice = property.priceNumeric;
  if (listingPrice && listingPrice > 100000) {
    priceMid = listingPrice;
    band = 3;
    priceLow = Math.round(priceMid * 0.97);
    priceHigh = Math.round(priceMid * 1.03);
    confidence = 88;
    source = 'listing-price';
    methodology = `Based on current listing price of ${fmtCurrency(listingPrice)}.`;
    return buildResult(priceLow, priceMid, priceHigh, band, confidence, source, methodology);
  }

  // Priority 3: Sale history with growth adjustment
  const sales = property.saleHistory ?? [];
  const validSale = sales.find(s => s.price && s.price > 50000 && !s.isConfidential && s.date);

  if (validSale && validSale.price && validSale.date) {
    const saleDate = new Date(validSale.date);
    const now = new Date();
    const monthsAgo = Math.max(0, (now.getFullYear() - saleDate.getFullYear()) * 12 + (now.getMonth() - saleDate.getMonth()));

    // Apply compound growth
    let adjustedPrice = validSale.price * Math.pow(1 + monthlyGrowth, monthsAgo);

    // Cap adjustment to prevent absurd values (max 3x, min 0.33x)
    adjustedPrice = Math.max(validSale.price * 0.33, Math.min(validSale.price * 3.0, adjustedPrice));

    // Sanity check against suburb median if available
    if (suburbMedian && suburbMedian > 100000) {
      // If adjusted price is wildly different from suburb median (>2x or <0.3x), blend toward median
      const ratio = adjustedPrice / suburbMedian;
      if (ratio > 2.0) {
        adjustedPrice = adjustedPrice * 0.6 + suburbMedian * 1.5 * 0.4;
      } else if (ratio < 0.3) {
        adjustedPrice = adjustedPrice * 0.6 + suburbMedian * 0.5 * 0.4;
      }
    }

    priceMid = Math.round(adjustedPrice);

    // Band widens with age
    if (monthsAgo < 6) {
      band = 8; confidence = 80; source = 'recent-sale';
    } else if (monthsAgo < 24) {
      band = 12; confidence = 65; source = 'sale-adjusted';
    } else if (monthsAgo < 60) {
      band = 18; confidence = 45; source = 'sale-adjusted';
    } else {
      band = 25; confidence = 30; source = 'old-sale-adjusted';
    }

    const growthPct = ((adjustedPrice / validSale.price) - 1) * 100;
    methodology = `Based on last sale of ${fmtCurrency(validSale.price)} (${formatDateShort(validSale.date)}, ${monthsAgo} months ago)` +
      (annualGrowth ? `, adjusted ${growthPct > 0 ? '+' : ''}${growthPct.toFixed(1)}% using ${annualGrowth.toFixed(1)}% p.a. suburb growth` : '') +
      `. Confidence band: ±${band}%.`;

    growthAdjustment = {
      originalPrice: validSale.price,
      originalDate: validSale.date,
      monthsElapsed: monthsAgo,
      annualGrowthUsed: annualGrowth,
      adjustedPrice: priceMid,
    };

    // Cross-validate with rental yield if available
    const rentalCheck = crossValidateRental(property, grossYield, priceMid);
    if (rentalCheck.diverges) {
      band = Math.min(Math.round(band * 1.5), 30);
      confidence = Math.max(confidence - 15, 10);
      methodology += ` Note: rental-implied value (${fmtCurrency(rentalCheck.impliedValue!)}) diverges >30%.`;
    }

    priceLow = Math.round(priceMid * (1 - band / 100));
    priceHigh = Math.round(priceMid * (1 + band / 100));

    return buildResult(priceLow, priceMid, priceHigh, band, confidence, source, methodology, growthAdjustment);
  }

  // Priority 4: Rental-yield implied value (no sale history)
  const latestRent = (property.rentalHistory ?? []).find(r => r.weeklyRent && r.weeklyRent > 50);
  if (latestRent?.weeklyRent && grossYield && grossYield > 0) {
    const impliedValue = Math.round((latestRent.weeklyRent * 52) / (grossYield / 100));
    priceMid = impliedValue;
    band = 20;
    confidence = 40;
    source = 'rental-yield';
    priceLow = Math.round(priceMid * 0.80);
    priceHigh = Math.round(priceMid * 1.20);
    methodology = `Based on rental of ${fmtCurrency(latestRent.weeklyRent)}/wk at ${grossYield.toFixed(1)}% suburb yield. No sale history available.`;
    return buildResult(priceLow, priceMid, priceHigh, band, confidence, source, methodology);
  }

  // Priority 5: Suburb median with attribute adjustment
  if (suburbMedian && suburbMedian > 100000) {
    let adjustmentMultiplier = 1.0;
    const adjustmentNotes: string[] = [];

    // Bedroom adjustment
    const typicalBeds = isUnit ? 2 : 3;
    if (property.bedrooms != null) {
      const bedDiff = property.bedrooms - typicalBeds;
      const perBedAdjust = isUnit ? 0.18 : 0.12;
      adjustmentMultiplier += bedDiff * perBedAdjust;
      if (bedDiff !== 0) {
        adjustmentNotes.push(`${bedDiff > 0 ? '+' : ''}${(bedDiff * perBedAdjust * 100).toFixed(0)}% for ${property.bedrooms}-bed (suburb typical: ${typicalBeds})`);
      }
    }

    // Bathroom adjustment
    const typicalBaths = isUnit ? 1 : 2;
    if (property.bathrooms != null && property.bathrooms > typicalBaths) {
      const bathAdj = (property.bathrooms - typicalBaths) * 0.05;
      adjustmentMultiplier += bathAdj;
      adjustmentNotes.push(`+${(bathAdj * 100).toFixed(0)}% for ${property.bathrooms} bathrooms`);
    }

    // Land area adjustment (houses only)
    if (!isUnit && property.landAreaSqm != null) {
      const typicalLand = 600;
      const landRatio = property.landAreaSqm / typicalLand;
      if (landRatio > 1.2) {
        const landAdj = (Math.sqrt(landRatio) - 1) * 0.15;
        adjustmentMultiplier += landAdj;
        adjustmentNotes.push(`+${(landAdj * 100).toFixed(0)}% for ${property.landAreaSqm}sqm land`);
      } else if (landRatio < 0.8) {
        const landAdj = (landRatio - 1) * 0.20;
        adjustmentMultiplier += landAdj;
        adjustmentNotes.push(`${(landAdj * 100).toFixed(0)}% for ${property.landAreaSqm}sqm land`);
      }
    }

    // Clamp
    adjustmentMultiplier = Math.max(0.5, Math.min(2.5, adjustmentMultiplier));

    priceMid = Math.round(suburbMedian * adjustmentMultiplier);
    band = 20;
    confidence = 25;
    source = 'suburb-median';
    priceLow = Math.round(priceMid * 0.80);
    priceHigh = Math.round(priceMid * 1.20);

    const adjText = adjustmentNotes.length > 0 ? ` Adjusted: ${adjustmentNotes.join(', ')}.` : '';
    methodology = `Based on suburb median ${isUnit ? 'unit' : 'house'} price of ${fmtCurrency(suburbMedian)}.${adjText} No recent sale data available.`;

    return buildResult(priceLow, priceMid, priceHigh, band, confidence, source, methodology);
  }

  // Priority 6: Fallback — use whatever extraction produced
  if (property.estimatedValue && property.estimatedValue > 100000) {
    priceMid = property.estimatedValue;
    band = 20;
    priceLow = Math.round(priceMid * 0.80);
    priceHigh = Math.round(priceMid * 1.20);
    return buildResult(priceLow, priceMid, priceHigh, band, 20, 'portal-estimate', `Based on portal automated estimate of ${fmtCurrency(priceMid)}.`);
  }

  // Cannot estimate
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────

function crossValidateRental(
  property: PriceEstimateInput,
  grossYield: number | undefined,
  estimatedValue: number
): { diverges: boolean; impliedValue: number | null } {
  const latestRent = (property.rentalHistory ?? []).find(r => r.weeklyRent && r.weeklyRent > 50);
  if (!latestRent?.weeklyRent || !grossYield || grossYield <= 0) {
    return { diverges: false, impliedValue: null };
  }
  const impliedValue = Math.round((latestRent.weeklyRent * 52) / (grossYield / 100));
  const divergence = Math.abs(impliedValue - estimatedValue) / estimatedValue;
  return { diverges: divergence > 0.30, impliedValue };
}

function buildResult(
  priceLow: number,
  priceMid: number,
  priceHigh: number,
  band: number,
  confidence: number,
  source: string,
  methodology: string,
  growthAdjustment?: PriceEstimateResult['growthAdjustment']
): PriceEstimateResult {
  return {
    priceLow,
    priceMid,
    priceHigh,
    confidenceBand: band,
    confidenceScore: confidence,
    confidenceLevel: confidence >= 75 ? 'high' : confidence >= 45 ? 'medium' : 'low',
    priceSource: source,
    methodology,
    growthAdjustment,
  };
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDateShort(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}
