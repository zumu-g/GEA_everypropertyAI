/**
 * Sentiment index (KTD7 / R19). Pure: the caller supplies the current period's
 * inputs and the trailing frozen, non-reconstructed monthly inputs.
 */

export interface SentimentInputs {
  saleToListRatio: number | null;
  monthsOfSupply: number | null;
  priceCutShare: number | null;
  medianDaysOnMarket: number | null;
  auctionClearanceRate: number | null;
}

export interface SentimentBasisInput {
  name: keyof SentimentInputs;
  value: number;
  rangeLow: number;
  rangeHigh: number;
  scaled: number;
  weight: number;
}

export interface SentimentBasis {
  formula: string;
  window: number;
  inputs: SentimentBasisInput[];
  reason?: 'insufficient-history';
}

export interface SentimentResult {
  sentimentIndex: number | null;
  sentimentBasis: SentimentBasis;
}

export const SENTIMENT_MIN_MONTHS = 6;
export const SENTIMENT_MIN_INPUTS = 2;
export const SENTIMENT_FORMULA =
  'round(100 * mean(scaled inputs)); scaled = clamp((value - min) / (max - min), 0, 1) over trailing frozen ' +
  'non-reconstructed months; monthsOfSupply, priceCutShare and medianDaysOnMarket inverted (1 - scaled)';

const INVERTED = new Set<keyof SentimentInputs>(['monthsOfSupply', 'priceCutShare', 'medianDaysOnMarket']);
const NAMES: Array<keyof SentimentInputs> = [
  'saleToListRatio', 'monthsOfSupply', 'priceCutShare', 'medianDaysOnMarket', 'auctionClearanceRate',
];

export function computeSentiment(current: SentimentInputs, history: SentimentInputs[]): SentimentResult {
  const none = (): SentimentResult => ({
    sentimentIndex: null,
    sentimentBasis: { formula: SENTIMENT_FORMULA, window: history.length, inputs: [], reason: 'insufficient-history' },
  });
  if (history.length < SENTIMENT_MIN_MONTHS) return none();

  const picked: Array<Omit<SentimentBasisInput, 'weight'>> = [];
  for (const name of NAMES) {
    const value = current[name];
    if (value == null) continue;
    const series = history.map((h) => h[name]).filter((v): v is number => v != null);
    if (series.length === 0) continue;
    const rangeLow = Math.min(...series);
    const rangeHigh = Math.max(...series);
    if (rangeHigh === rangeLow) continue; // degenerate range
    let scaled = Math.min(1, Math.max(0, (value - rangeLow) / (rangeHigh - rangeLow)));
    if (INVERTED.has(name)) scaled = 1 - scaled;
    picked.push({ name, value, rangeLow, rangeHigh, scaled });
  }
  if (picked.length < SENTIMENT_MIN_INPUTS) return none();

  const weight = 1 / picked.length;
  const inputs = picked.map((p) => ({ ...p, weight }));
  const mean = inputs.reduce((s, i) => s + i.scaled, 0) / inputs.length;
  return {
    sentimentIndex: Math.round(mean * 100),
    sentimentBasis: { formula: SENTIMENT_FORMULA, window: history.length, inputs },
  };
}
